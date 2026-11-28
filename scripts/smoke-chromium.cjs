// Optional developer smoke test. Requires Playwright and a Chromium binary.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
(async () => {
  const { build } = await import('./build.mjs');
  const root = await mkdtemp(join(tmpdir(), 'bootcat-browser-'));
  let context, pdfServer;
  try {
    const extension = await build('chromium', { outputRoot: join(root, 'build'), includeTests: true });
    const paragraph = 'Renewable energy requires careful planning and reliable electricity networks. Technical terminology describes generation capacity, storage systems and distribution. Translators need clear examples of these expressions in context. These paragraphs provide a realistic corpus extraction fixture without involving a remote website.';
    const { pdfFixture, docxFiles, wordXML } = await import('../tests/browser-tests.fixtures.js');
    const bigPDF = Buffer.from(pdfFixture({ paddingBytes: 15 * 1024 * 1024 }));
    const wrappedPDF = Buffer.from(pdfFixture({ wrapped: true, unpunctuated: true, paddingBytes: 15 * 1024 * 1024 }));
    // A real server verifies extension-worker fetches and cookie behavior without
    // relying on Playwright interception of protected PDF viewer requests.
    const pendingSearchResponses = new Map(), resolvedQueries = new Set(), pendingCorpusResponses = new Map(), corpusFetches = new Map(), resolvedCorpus = new Set();
    pdfServer = createServer((request, response) => {
      if (request.url.startsWith('/concurrent/')) {
        const name = request.url.split('/').at(-1);
        if (request.headers['sec-fetch-dest'] !== 'document') corpusFetches.set(name, (corpusFetches.get(name) || 0) + 1);
        const body = `<article><h1>Concurrent corpus fixture</h1>${Array.from({ length: 4 }, () => `<p>${paragraph}</p>`).join('')}</article>`;
        if (['failed', 'upload'].includes(name) && !resolvedCorpus.has(name)) { response.writeHead(403, { 'Content-Type': 'text/html' }); response.end('CAPTCHA required'); return; }
        response.writeHead(200, { 'Content-Type': 'text/html' });
        if (name === 'blocked') {
          response.write('<!doctype html>'); pendingCorpusResponses.set(name, () => response.end(body));
          response.on('close', () => pendingCorpusResponses.delete(name));
        } else response.end(body);
        return;
      }
      if (request.url === '/challenge-pending') {
        response.writeHead(200, { 'Content-Type': 'image/png' }); response.write(Buffer.from([137, 80, 78, 71])); return;
      }
      if (request.url.startsWith('/ecosia-fixture')) {
        const query = new URL(request.url, 'http://fixture').searchParams.get('q') || '';
        const ready = query.includes('challenge-good') || (request.headers.cookie || '').includes('bootcat_unlocked=1');
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(ready ? '<title>Ecosia results</title><a data-test-id="result-link" href="https://corpus.test/challenge-result">Result</a>' : '<title>Just a moment...</title><form id="challenge-form">Verify you are human</form><img src="/challenge-pending"><script>setInterval(() => { if (document.cookie.includes("bootcat_unlocked=1")) location.reload(); }, 100)</script>'); return;
      }
      if (request.url.startsWith('/search-fixture')) {
        const query = new URL(request.url, 'http://fixture').searchParams.get('q') || '';
        const body = query.startsWith('manual-empty') ? '<title>Empty search fixture</title><p>No results found</p>' : query === 'captcha' && !resolvedQueries.has(query) ? '<h1>CAPTCHA required</h1>' : `<a data-testid="result-title-a" href="https://corpus.test/search?q=${encodeURIComponent(query)}">Local result</a>${query === 'partial' ? '<a data-testid="result-title-a" href="https://duckduckgo.com/l/?opaque=1">Unresolved link</a>' : ''}`;
        response.writeHead(200, { 'Content-Type': 'text/html' });
        if (['delayed', 'close while loading'].includes(query)) {
          response.write('<!doctype html><title>Loading search fixture</title>');
          pendingSearchResponses.set(query, () => response.end(body));
          response.on('close', () => pendingSearchResponses.delete(query));
        } else response.end(body);
        return;
      }
      if (request.url === '/oversized.pdf') {
        response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(Buffer.alloc(50 * 1024 * 1024 + 1)); return;
      }
      if (request.url === '/login') {
        response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'pdfSession=allowed; Path=/; SameSite=Lax' });
        response.end('<p>Manual sign-in complete</p>'); return;
      }
      if (request.url === '/session-document' && request.headers.cookie?.includes('pdfSession=allowed')) {
        response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(bigPDF); return;
      }
      response.writeHead(403, { 'Content-Type': 'text/html' }); response.end('CAPTCHA required');
    });
    await new Promise(resolve => pdfServer.listen(0, '127.0.0.1', resolve));
    const pdfOrigin = `http://127.0.0.1:${pdfServer.address().port}`;
    // Extension-created tabs can navigate before Playwright attaches its routing
    // hooks. Point the batch-search provider at our real local server in this
    // temporary test build only. Production provider URLs are covered by unit tests.
    const enginesPath = join(extension, 'engines.js'), engineSource = await readFile(enginesPath, 'utf8');
    assert.ok(engineSource.includes('searchURL: "https://duckduckgo.com/"'));
    const fixtureEngines = engineSource
      .replace('searchURL: "https://duckduckgo.com/"', `searchURL: "${pdfOrigin}/search-fixture"`)
      .replace('searchURL: "https://www.ecosia.org/search"', `searchURL: "${pdfOrigin}/ecosia-fixture"`)
      .replace('const url = new URL(value);', `const url = new URL(value);\n    if (url.origin === '${pdfOrigin}' && url.pathname === '/search-fixture' && url.searchParams.get('q')) return ENGINES.find(engine => engine.id === 'duckduckgo');\n    if (url.origin === '${pdfOrigin}' && url.pathname === '/ecosia-fixture' && url.searchParams.get('q')) return ENGINES.find(engine => engine.id === 'ecosia');`)
      .replace('if (!expectedHost) return', `if (!expectedHost && page.origin !== '${pdfOrigin}') return`);
    await writeFile(enginesPath, fixtureEngines);
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      headless: true,
      channel: 'chromium',
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.env.BOOTCAT_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])]
    });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const origin = worker.url().slice(0, worker.url().lastIndexOf('/'));
    const { makeZIP } = await import('../src/zip.js');
    const docxBytes = Buffer.from(await makeZIP(docxFiles).arrayBuffer());
    const largeDOCX = Buffer.from(await makeZIP(docxFiles.map(file => file.name === 'word/document.xml' ? { ...file, data: wordXML.replace('Caffè 中文 corpus.', 'Larger DOCX corpus text. '.repeat(140000)) } : file)).arrayBuffer());
    const article = `<!doctype html><html lang="en"><head><title>Energy terminology</title></head><body><nav>MENU_SENTINEL</nav><article><h1>Energy terminology</h1>${Array.from({ length: 4 }, () => `<p>${paragraph}</p>`).join('')}</article><footer>FOOTER_SENTINEL</footer></body></html>`;
    // Fixtures only: this test never contacts real search engines or websites.
    await context.route(/^https?:/, route => {
      const url = new URL(route.request().url());
      if (url.origin === pdfOrigin) return route.continue();
      if (url.hostname === 'www.google.com') return route.fulfill({ contentType: 'text/html', body: '<div id="search"><a href="https://corpus.test/article"><h3>Energy article</h3></a></div>' });
      if (url.hostname === 'corpus.test' && url.pathname === '/document.pdf') return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(pdfFixture()) });
      if (url.hostname === 'corpus.test' && url.pathname === '/wrapped.pdf') return route.fulfill({ contentType: 'application/pdf', body: wrappedPDF });
      if (url.hostname === 'corpus.test' && url.pathname === '/empty.pdf') return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(pdfFixture({ empty: true })) });
      if (url.hostname === 'corpus.test' && url.pathname === '/document.docx') return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: docxBytes });
      if (url.hostname === 'corpus.test' && url.pathname === '/large.docx') return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: largeDOCX });
      if (url.hostname === 'corpus.test' && url.pathname === '/blocked' && !route.request().isNavigationRequest()) return route.fulfill({ status: 403, body: 'CAPTCHA required' });
      if (url.hostname === 'corpus.test') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: article });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin + '/tests/browser-tests.html');
    await page.waitForFunction(() => document.querySelector('#output').dataset.complete === 'true');
    const output = await page.locator('#output').innerText();
    assert.ok(!output.includes('FAIL:'), output);
    console.log(output);
    await page.goto(origin + '/downloader.html');
    const releaseVersion = await page.evaluate(() => (globalThis.browser ?? chrome).runtime.getManifest().version);
    const versionLabel = `BootCaT · ${releaseVersion.replace(/\.0$/, '')}`;
    await page.waitForFunction(label => document.querySelector('#app-version')?.textContent === label, versionLabel);
    const versionPopup = await context.newPage(); await versionPopup.goto(origin + '/popup.html');
    await versionPopup.waitForFunction(label => document.querySelector('#app-version')?.textContent === label, versionLabel);
    await versionPopup.close(); await page.bringToFront();

    const openPanels = async () => page.locator('.workspace-panel').evaluateAll(panels => panels.forEach(panel => { panel.open = true; }));
    const assertCollapsed = async () => {
      await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
      assert.deepEqual(await page.locator('.workspace-panel[open]').evaluateAll(panels => panels.map(panel => panel.closest('section').id)), ['project-section']);
      assert.equal(await page.locator('#more-search-options').getAttribute('open'), null);
    };
    const openSearchOptions = async () => {
      if (!await page.locator('#more-search-options').evaluate(panel => panel.open)) await page.locator('#more-search-options > summary').click();
    };
    async function checkCorpusReport(zipPath, language = 'Not checked') {
      execFileSync('python3', ['-c', `
import sys,json,zipfile,io,datetime,xml.etree.ElementTree as E
n={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
 assert not any('/captured/' in name for name in z.namelist())
 docs=sorted([d for d in json.loads(z.read('extraction.json'))['documents'] if d.get('textFilename')],key=lambda d:d['textFilename'])
 for name in ['results.json','extraction.json','searches.json']:
  assert json.loads(z.read(name))['version']==sys.argv[3]
 draft=json.loads(z.read('project.json'))['draft']
 for name,field in [('seeds.txt','seeds'),('tuples.txt','tuples')]:
  assert z.read(name).decode('utf-8')==draft.get(field,'')
 included=z.read('url_list.txt').decode('utf-8').splitlines()
 excluded=z.read('url_list_excluded.txt').decode('utf-8').splitlines()
 assert not set(included)&set(excluded)
 assert all(url in included or url in excluded for url in draft.get('urls','').splitlines() if url.startswith(('http://','https://')))
 when=datetime.datetime.fromisoformat(json.loads(z.read('results.json'))['exportedAt'].replace('Z','+00:00')).astimezone()
 expected=(when.year,when.month,when.day,when.hour,when.minute,when.second//2*2)
 assert all(i.date_time==expected for i in z.infolist())
 report=z.read('Report.xlsx')
 for d in docs:
  assert d['textFilename'] in z.namelist() and d['originalFilename'] in z.namelist()
with zipfile.ZipFile(io.BytesIO(report)) as z:
 assert z.testzip() is None
 for name in z.namelist(): E.fromstring(z.read(name))
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 assert not sheet.findall('.//m:f',n)
 rows=sheet.findall('m:sheetData/m:row',n)
 values=[]
 for row in rows:
  values.append([c.find('m:is/m:t',n).text if c.attrib.get('t')=='inlineStr' else int(c.find('m:v',n).text) for c in row])
 assert included==[row[1] for row in values[1:]]
 assert all(i.date_time==expected for i in z.infolist())
 assert values[0]==['Text file name','Source URL','Characters','Detected language']
 assert values[1:]==[[d['textFilename'].removeprefix('corpus/'),d['url'],d['characters'],sys.argv[2]] for d in docs]
 assert sheet.find('m:sheetViews/m:sheetView/m:pane',n).attrib['state']=='frozen'
`, zipPath, language, releaseVersion]);
    }

    await page.locator('#project-choice-dialog[open]').waitFor();
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#project-choice-dialog[open]').count(), 1);
    assert.equal(await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' })).project), null);
    for (const selector of ['#urls', '#start', '#export', '#seeds', '#tuples', '#engine', '#project-name']) assert.equal(await page.locator(selector).isDisabled(), true, selector);
    assert.deepEqual(await page.locator('#project-choice-dialog .actions button').allTextContents(), ['New Project', 'Open Project', 'Close BootCaT']);
    assert.equal(await page.locator('#project-choice-new').evaluate(button => button === document.activeElement), true);
    await page.click('#project-choice-new'); await page.locator('#project-dialog[open]').waitFor();
    await page.click('#project-dialog-cancel'); await page.locator('#project-choice-dialog[open]').waitFor();
    await page.click('#project-choice-new');
    await page.selectOption('#project-dialog-language', 'none'); await page.fill('#project-dialog-name', 'First corpus'); await submitProject();
    await page.locator('#project-dialog[open]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'First corpus' && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await assertCollapsed();
    assert.equal(await page.inputValue('#engine'), 'ecosia', 'fresh projects start with Ecosia');
    await page.locator('nav a[href="#search-section"]').click();
    await page.waitForFunction(() => document.querySelector('#engine-default-status').textContent.includes('Ecosia'));
    assert.equal(await page.locator('#make-default-engine').isDisabled(), true);
    await page.selectOption('#engine', 'google'); await page.click('#make-default-engine');
    await page.waitForFunction(() => document.querySelector('#engine-default-status').textContent.includes('Google') && document.querySelector('#make-default-engine').disabled);
    await page.reload(); await assertCollapsed();
    assert.equal(await page.inputValue('#engine'), 'google', 'project selection survives reload');
    assert.equal(await page.locator('.workspace-panel').count(), 5);
    assert.equal(await page.locator('#export-metadata, #metadata-export-status').count(), 0);
    assert.equal(await page.locator('#project-section #export').count(), 1);
    assert.equal(await page.locator('#review-section #export, #log-section, #save-searches, #collected-results, #project-tab-details').count(), 0);
    assert.equal(await page.locator('#search-form').count(), 0);
    await page.locator('nav a[href="#seeds-section"]').click();
    assert.equal(await page.locator('#seeds-section .workspace-panel').getAttribute('open'), '');
    await openPanels();
    assert.equal(await page.locator('#search-site').isVisible(), false);
    await openSearchOptions();
    assert.equal(await page.inputValue('#excluded-sites'), 'youtube.com\nfacebook.com\ninstagram.com\namazon.com');
    await openSearchOptions();
    await page.fill('#excluded-sites', '');
    await page.waitForFunction(() => !document.querySelector('#urls').disabled);
    assert.equal(await page.inputValue('#urls'), '');
    const examples = await page.locator('#urls').getAttribute('placeholder');
    assert.ok(examples.includes('https://www.iana.org/help/example-domains'));
    await page.focus('#urls');
    assert.equal(await page.locator('#urls').evaluate(el => getComputedStyle(el, '::placeholder').color), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.inputValue('#urls'), '');
    await page.locator('#urls-section summary').focus();
    assert.notEqual(await page.locator('#urls').evaluate(el => getComputedStyle(el, '::placeholder').color), 'rgba(0, 0, 0, 0)');
    let cancelUnload = false;
    const dialogMessages = [];
    page.on('dialog', dialog => {
      if (dialog.type() === 'beforeunload') return cancelUnload ? dialog.dismiss() : dialog.accept();
      errors.push('Unexpected browser dialog: ' + dialog.message()); return dialog.dismiss();
    });
    async function waitForSavedDraft() {
      await page.waitForFunction(async () => {
        const store = await import('./project-store.js');
        const saved = await store.loadWorkspace(await store.storedProjectId());
        return [['urls', 'urls'], ['seeds', 'seeds'], ['tuples', 'tuples'], ['search-site', 'searchSite'], ['excluded-sites', 'excludedSites']].every(([id, key]) => saved.draft[key] === document.getElementById(id).value);
      });
    }
    async function assertSectionPosition(id) {
      await page.waitForFunction(id => {
        const section = document.getElementById(id), bar = document.querySelector('.topbar');
        const top = section.getBoundingClientRect().top, offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
        return section.querySelector('.workspace-panel').open && top >= bar.getBoundingClientRect().bottom && Math.abs(top - offset) < 3;
      }, id);
    }
    async function closeTextReview() {
      if (await page.locator('#text-review-dialog').evaluate(dialog => dialog.open)) {
        await page.click('#text-review-close');
        await page.locator('#text-review-dialog[open]').waitFor({ state: 'hidden' });
      }
    }
    async function openIssues() {
      if (await page.locator('#attention-section').isVisible() && !await page.locator('#attention-section').evaluate(panel => panel.open)) await page.locator('#attention-section > summary').click();
    }
    async function waitForFinished() {
      try {
        await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
      } catch (error) {
        console.error('Download wait state:', await page.evaluate(async () => ({ status: document.querySelector('#status').textContent, saved: document.querySelector('#saved-status').textContent, urls: document.querySelector('#urls').value, locks: await navigator.locks.query() })));
        throw error;
      }
    }
    async function clickConfirmed(selector, accept = true) {
      await closeTextReview();
      if (selector.includes('#review-lists') || selector.includes('#problem-results')) await openIssues();
      if (selector === '#close-project') {
        await page.click(selector); await page.locator('#project-replace-dialog[open]').waitFor();
        if (accept === 'escape') await page.keyboard.press('Escape');
        else await page.click(accept ? '#project-replace-continue' : '#project-replace-dialog button[value=cancel]');
        await page.locator('#project-replace-dialog[open]').waitFor({ state: 'hidden' }); return;
      }
      await page.click(selector); await page.locator('#confirmation-dialog[open]').waitFor();
      dialogMessages.push(await page.locator('#confirmation-message').innerText());
      assert.equal(await page.locator('#confirmation-cancel').evaluate(button => button === document.activeElement), true);
      if (accept === 'escape') await page.keyboard.press('Escape');
      else await page.click(accept ? '#confirmation-accept' : '#confirmation-cancel');
      await page.locator('#confirmation-dialog[open]').waitFor({ state: 'hidden' });
    }
    async function submitProject() {
      const replacing = !!(await page.inputValue('#project-name'));
      const nextName = await page.inputValue('#project-dialog-name');
      await page.click('#project-dialog-submit');
      if (replacing) {
        await page.locator('#project-replace-dialog[open]').waitFor();
        assert.equal(await page.locator('#project-replace-message').innerText(), 'Creating a new project replaces the current one. Save the current project first if you want to keep it.');
        await page.click('#project-replace-continue');
        await page.locator('#project-replace-dialog[open]').waitFor({ state: 'hidden' });
      }
      await page.waitForFunction(name => document.querySelector('#project-name').value === name && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled, nextName);
    }
    await page.click('#open-settings');
    await page.waitForFunction(() => document.querySelector('#settings-dialog').open && !document.querySelector('#settings-save').disabled);
    assert.equal(await page.inputValue('#setting-fileMiB'), '50');
    assert.equal(await page.inputValue('#setting-minimumSeeds'), '5');
    await page.fill('#setting-minimumSeeds', '2');
    await page.fill('#setting-fileMiB', '55'); await page.fill('#setting-urlWarning', '2');
    await page.click('#settings-save'); await page.locator('#settings-dialog[open]').waitFor({ state: 'hidden' });
    await page.fill('#urls', 'https://one.test\nhttps://two.test\nhttps://three.test');
    await page.waitForFunction(() => document.querySelector('#urls-warning').textContent.includes('3 URLs'));
    assert.match(await page.locator('#download-limit-hint').innerText(), /55 MiB/);
    const settingsWindow = await context.newPage(); await settingsWindow.goto(origin + '/downloader.html');
    await settingsWindow.waitForFunction(() => document.querySelector('#download-limit-hint').textContent.includes('55 MiB'));
    await settingsWindow.click('#open-settings');
    await settingsWindow.waitForFunction(() => document.querySelector('#settings-dialog').open && !document.querySelector('#settings-save').disabled);
    assert.equal(await settingsWindow.inputValue('#setting-urlWarning'), '2');
    assert.equal(await settingsWindow.inputValue('#setting-minimumSeeds'), '2');
    await settingsWindow.click('#settings-reset'); await settingsWindow.click('#settings-save');
    await settingsWindow.locator('#settings-dialog[open]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#download-limit-hint').textContent.includes('50 MiB') && document.querySelector('#urls-warning').textContent === '');
    await settingsWindow.close(); await page.fill('#urls', '');
    const navNames = await page.locator('nav a').allTextContents();
    assert.equal(navNames.at(-2), 'Build Corpus'); assert.equal(await page.locator('#save-section').count(), 0); assert.equal(navNames.at(-1), 'Help');
    await page.locator('nav a[href="#project-section"]').click();
    assert.equal(await page.locator('#project-section .workspace-panel').getAttribute('open'), '');
    assert.equal(await page.evaluate(() => document.querySelector('[aria-labelledby="project-heading"]').nextElementSibling.id), 'seeds-section');
    assert.equal(await page.inputValue('#tuple-length'), '3');
    assert.equal(await page.locator('#generate-tuples').isDisabled(), true);
    assert.equal(await page.locator('#storage-status').count(), 0);
    for (const width of [600, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#search-section .workspace-panel').evaluate(panel => { panel.open = false; });
      await page.fill('#tuples', 'scroll test'); await page.click('#prepare-queries');
      await assertSectionPosition('search-section');
    }
    await page.fill('#tuples', 'manual query without seeds');
    await page.click('#prepare-queries'); assert.equal(await page.locator('#prepared-queries a').innerText(), 'manual query without seeds');
    await page.fill('#seeds', 'one\ntwo\nthree\nfour');
    assert.equal(await page.locator('#generate-tuples').isDisabled(), true);
    assert.equal(await page.locator('#tuples').isEnabled(), true);
    await page.fill('#seeds', 'renewable energy\nstorage\nelectricity network\ngeneration\ncapacity');
    await page.click('#generate-tuples');
    await page.waitForFunction(() => document.querySelector('#tuple-status').textContent.startsWith('10 unique tuples generated'));
    const generated = (await page.inputValue('#tuples')).split('\n');
    assert.equal(new Set(generated).size, 10); assert.ok(generated.some(line => line.includes('"renewable energy"')));
    assert.equal(await page.locator('#tuple-length').getAttribute('max'), '5');
    assert.equal(await page.locator('#tuple-count').getAttribute('max'), '10');
    assert.match(await page.locator('#seeds-counter').innerText(), /5 seeds/);
    assert.match(await page.locator('#tuples-counter').innerText(), /10 tuples/);
    await page.fill('#tuple-length', '1'); await page.click('#generate-tuples');
    await page.waitForFunction(() => document.querySelector('#tuple-status').textContent.startsWith('5 unique tuples generated'));
    assert.equal(await page.locator('#tuple-count').getAttribute('max'), '5');
    assert.equal(await page.inputValue('#tuple-count'), '5');
    await page.fill('#tuple-length', '3');
    const tabCount = context.pages().length;
    await page.fill('#tuples', '"custom phrase" energy\nstorage generation\nstorage generation');
    await page.click('#prepare-queries'); await page.selectOption('#engine', 'duckduckgo');
    assert.equal(await page.locator('#prepared-queries a').count(), 2); assert.equal(context.pages().length, tabCount);
    const queryURL = await page.locator('#prepared-queries a').first().getAttribute('href');
    assert.equal(new URL(queryURL).origin, pdfOrigin); assert.equal(new URL(queryURL).pathname, '/search-fixture');
    assert.equal(new URL(queryURL).searchParams.get('q'), '"custom phrase" energy');
    await waitForSavedDraft();
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelectorAll('#prepared-queries a').length === 2);
    assert.equal(await page.inputValue('#engine'), 'duckduckgo'); assert.ok((await page.inputValue('#seeds')).includes('renewable energy'));
    assert.equal(await page.inputValue('#tuples'), '"custom phrase" energy\nstorage generation\nstorage generation');
    const individualEvent = context.waitForEvent('page'); await page.locator('#prepared-queries a').first().click();
    const individual = await individualEvent; await individual.waitForLoadState('domcontentloaded');
    assert.equal(individual.url(), queryURL);
    await page.waitForFunction(async () => {
      const ext = globalThis.browser ?? chrome, data = await ext.storage.session.get('projectSearchTabs');
      const record = data.projectSearchTabs?.tabs[0];
      return record && (await ext.tabs.get(record.tabId)).status === 'complete';
    });
    // Exercise the same collect message sent by the toolbar popup. Unit tests
    // additionally verify the popup sender URL and both browser namespaces.
    const manualCollection = await page.evaluate(async () => {
      const ext = globalThis.browser ?? chrome, data = await ext.storage.session.get('projectSearchTabs');
      return ext.runtime.sendMessage({ type: 'collect', tabId: data.projectSearchTabs.tabs[0].tabId });
    });
    assert.equal(manualCollection.ok, true); assert.equal(individual.isClosed(), false);
    try {
      await page.waitForFunction(() => document.querySelector('#prepared-queries .query-tab-status').dataset.status === 'collected');
    } catch (error) {
      console.error('Query collection state:', JSON.stringify(await page.evaluate(async () => {
        const ext = globalThis.browser ?? chrome, projectId = (await ext.runtime.sendMessage({ type: 'get-project' })).project.id;
        return { queryStatus: document.querySelector('#query-status').textContent, tabStatus: document.querySelector('#project-tab-status').textContent, badges: [...document.querySelectorAll('.query-tab-status')].map(badge => badge.textContent), state: await ext.runtime.sendMessage({ type: 'get-project-search-tabs', projectId }) };
      })));
      throw error;
    }
    assert.equal(await page.locator('#prepared-queries li').first().evaluate(row =>
      row.children[0].classList.contains('query-tab-status') && row.children[1].textContent === 'Mark as no results' && row.children[2].getAttribute('aria-label') === 'Open search tab' && row.children[3].tagName === 'A'), true);
    assert.equal(await page.locator('#prepared-queries [aria-label="Open search tab"]').first().getAttribute('aria-label'), 'Open search tab');
    assert.equal(await page.locator('#prepared-queries [aria-label="Open search tab"]').first().innerText(), '');
    assert.equal(await page.locator('#prepared-queries .query-tab-action svg').count(), 2);
    await individual.close(); await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('0 of 0'));
    assert.match(await page.locator('#prepared-queries .query-tab-status').first().innerText(), /Collected/);
    console.log('Leading badge/open icon, popup collection status and manual-close retention passed.');
    await page.waitForFunction(() => document.querySelector('#open-all-queries').textContent === 'Run missing queries (1)' && !document.querySelector('#open-all-queries').disabled);
    await clickConfirmed('#open-all-queries', false);
    assert.equal(context.pages().length, tabCount); assert.equal(dialogMessages.at(-1), 'Open 1 DuckDuckGo search tab? The search engine may block requests or show CAPTCHAs.');
    const batchPages = [], recordQueryPage = tab => batchPages.push(tab); context.on('page', recordQueryPage);
    const allBatchCreated = context.waitForEvent('page', { predicate: () => batchPages.length >= 1 });
    await clickConfirmed('#open-all-queries');
    await allBatchCreated;
    await page.waitForFunction(() => document.querySelector('#query-status').textContent.startsWith('Opened 1 search tab.'));
    await Promise.all(batchPages.map(tab => tab.waitForLoadState('domcontentloaded'))); context.off('page', recordQueryPage);
    assert.equal(batchPages.length, 1);
    assert.deepEqual(batchPages.map(tab => new URL(tab.url()).searchParams.get('q')).sort(), ['storage generation']);
    await page.waitForFunction(() => document.querySelector('#open-all-queries').disabled && document.querySelector('#open-all-queries').textContent === 'No queries to open');
    const pagesBeforeRepeat = context.pages().length;
    await page.locator('#open-all-queries').evaluate(button => button.click());
    assert.equal(context.pages().length, pagesBeforeRepeat);
    const queryWindow = await context.newPage(); await queryWindow.goto(origin + '/downloader.html');
    await queryWindow.waitForFunction(() => document.querySelector('#open-all-queries').textContent === 'No queries to open' && document.querySelector('#open-all-queries').disabled);
    await batchPages[0].close();
    await page.waitForFunction(() => document.querySelector('#open-all-queries').textContent === 'Run missing queries (1)' && !document.querySelector('#open-all-queries').disabled);
    await queryWindow.waitForFunction(() => document.querySelector('#open-all-queries').textContent === 'Run missing queries (1)' && !document.querySelector('#open-all-queries').disabled);
    await page.bringToFront();
    const replacementTab = context.waitForEvent('page'); await clickConfirmed('#open-all-queries');
    batchPages[0] = await replacementTab; await batchPages[0].waitForLoadState('domcontentloaded');
    assert.equal(new URL(batchPages[0].url()).searchParams.get('q'), 'storage generation');
    await queryWindow.waitForFunction(() => document.querySelector('#open-all-queries').disabled && document.querySelector('#open-all-queries').textContent === 'No queries to open');
    await queryWindow.close();
    async function waitProjectTabsReady(count) {
      await page.waitForFunction(async count => {
        const ext = globalThis.browser ?? chrome, data = await ext.storage.session.get('projectSearchTabs');
        const records = data.projectSearchTabs?.tabs || [];
        if (records.length !== count) return false;
        const tabs = await Promise.all(records.map(record => ext.tabs.get(record.tabId)));
        return tabs.every(tab => tab.status === 'complete');
      }, count);
    }
    const unrelatedSearch = await context.newPage(); await unrelatedSearch.goto(pdfOrigin + '/search-fixture?q=unrelated');
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('1 of 1 project search tabs loaded.'));
    await waitProjectTabsReady(1);
    await page.locator('#urls-section .workspace-panel, #review-section .workspace-panel').evaluateAll(panels => panels.forEach(panel => { panel.open = false; }));
    const closedBatchPages = batchPages.map(tab => tab.waitForEvent('close'));
    await page.click('#collect-project-tabs'); await Promise.all(closedBatchPages);
    await page.waitForFunction(() => document.querySelector('#project-tab-status').textContent.startsWith('Finished.') && !document.querySelector('#project-tab-status').textContent.includes('0 tabs closed'));
    assert.match(await page.locator('#project-tab-status').innerText(), /1 result page saved; 1 tab closed/);
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector('#urls-section .workspace-panel').open && document.querySelector('#review-section .workspace-panel').open);
    await assertSectionPosition('urls-section');
    assert.equal(unrelatedSearch.isClosed(), false);
    await page.waitForFunction(() => document.querySelector('#urls').value.split('\n').filter(Boolean).length === 2);
    assert.ok(!(await page.inputValue('#urls')).includes('unrelated'));
    const pagesAfterCollection = context.pages().length;
    assert.equal(await page.locator('#open-all-queries').innerText(), 'No queries to open');
    assert.equal(await page.locator('#open-all-queries').isDisabled(), true);
    const completedTuples = await page.inputValue('#tuples');
    await page.fill('#tuples', 'escape confirmation'); await page.click('#prepare-queries');
    await clickConfirmed('#open-all-queries', 'escape');
    assert.equal(context.pages().length, pagesAfterCollection);
    await page.fill('#tuples', completedTuples); await page.click('#prepare-queries');
    assert.equal(await page.locator('#open-all-queries').isDisabled(), true);
    assert.equal(await page.locator('#clear-searches').count(), 0);
    assert.equal((await page.inputValue('#urls')).split('\n').length, 2);
    console.log('Styled confirmations, Save navigation and URL collection without Log passed.');

    await page.selectOption('#engine', 'google');
    assert.equal(new URL(await page.locator('#prepared-queries a').first().getAttribute('href')).hostname, 'www.google.com');
    console.log('Seed validation, unique tuples, phrase quoting, edits, query links, engine switching, batch confirmation and persistence passed.');
    await page.selectOption('#engine', 'duckduckgo');
    await page.fill('#tuples', 'delayed\nclose while loading'); await page.click('#prepare-queries');
    const loadingPages = [], recordLoading = tab => loadingPages.push(tab); context.on('page', recordLoading);
    const loadingCreated = context.waitForEvent('page', { predicate: () => loadingPages.length >= 2 });
    await clickConfirmed('#open-all-queries'); await loadingCreated; context.off('page', recordLoading);
    await Promise.all(loadingPages.map(tab => tab.waitForURL(url => url.origin === pdfOrigin && url.pathname === '/search-fixture', { waitUntil: 'commit' })));
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('0 of 2 project search tabs loaded.'));
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), true);
    assert.equal(await page.locator('.query-tab-status[data-status="loading"]').count(), 2);
    await loadingPages.find(tab => new URL(tab.url()).searchParams.get('q') === 'close while loading').close();
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('0 of 1 project search tabs loaded.'));
    assert.match(await page.locator('#prepared-queries li').nth(1).innerText(), /Closed without collecting/);
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), true);
    pendingSearchResponses.get('delayed')();
    await page.waitForFunction(() => !document.querySelector('#collect-project-tabs').disabled);
    assert.match(await page.locator('#prepared-queries li').first().innerText(), /Loaded/);
    await page.locator('#prepared-queries [aria-label="Open search tab"]').first().click(); await page.bringToFront();
    await page.click('#collect-project-tabs');
    await page.waitForFunction(() => document.querySelector('#prepared-queries .query-tab-status').dataset.status === 'collected' && document.querySelector('#project-tab-status').textContent.startsWith('Finished.'));
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), true);
    console.log('Loading indicators, manual closure, loaded-only readiness, focus and collected query history passed.');
    await page.fill('#tuples', 'captcha\npartial\nmoved'); await page.click('#prepare-queries');
    const troublePages = [], recordTrouble = tab => troublePages.push(tab); context.on('page', recordTrouble);
    const troubleReady = context.waitForEvent('page', { predicate: () => troublePages.length >= 3 });
    await clickConfirmed('#open-all-queries'); await troubleReady;
    await Promise.all(troublePages.map(tab => tab.waitForLoadState('domcontentloaded'))); context.off('page', recordTrouble);
    await page.waitForFunction(() => document.querySelector('#query-status').textContent.startsWith('Opened 3 search tabs.'));
    const movedPage = troublePages.find(tab => new URL(tab.url()).searchParams.get('q') === 'moved'); await movedPage.goto(pdfOrigin + '/login');
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('2 of 2 project search tabs loaded.'));
    await waitProjectTabsReady(2);
    await page.click('#collect-project-tabs');
    await page.waitForFunction(() => document.querySelector('#project-tab-status').textContent.startsWith('Finished.') && document.querySelector('#project-tab-status').textContent.includes('1 result page saved; 0 tabs closed'));
    assert.ok(troublePages.every(tab => !tab.isClosed())); assert.equal(unrelatedSearch.isClosed(), false);
    assert.match(await page.locator('#prepared-queries .query-tab-status').allTextContents().then(items => items.join(' ')), /Needs attention/);
    assert.equal(await page.locator('.query-tab-status[data-status="attention"]').count(), 2);
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), false);
    resolvedQueries.add('captcha');
    const captchaPage = troublePages.find(tab => new URL(tab.url()).searchParams.get('q') === 'captcha');
    await captchaPage.reload(); await page.bringToFront(); await waitProjectTabsReady(2);
    await page.waitForFunction(() => !document.querySelector('#collect-project-tabs').disabled);
    const captchaClosed = captchaPage.waitForEvent('close'); await page.click('#collect-project-tabs'); await captchaClosed;
    await page.waitForFunction(() => document.querySelector('#project-tab-status').textContent.startsWith('Finished.') && document.querySelector('#prepared-queries .query-tab-status').dataset.status === 'collected' && !document.querySelector('#collect-project-tabs').disabled);
    assert.match(await page.locator('#prepared-queries li').first().innerText(), /Collected/);
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), false);

    await page.click('#new-project');
    await page.selectOption('#project-dialog-language', 'none'); await page.fill('#project-dialog-name', 'Tab reset project'); await submitProject();
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && document.querySelector('#project-tab-count').textContent.startsWith('0 of 0 project search tabs loaded.'));
    await assertCollapsed(); await openPanels();
    await openSearchOptions();
    await page.fill('#excluded-sites', '');
    assert.ok(troublePages.filter(tab => tab !== captchaPage).every(tab => !tab.isClosed())); assert.equal(unrelatedSearch.isClosed(), false);
    for (const tab of [...troublePages, unrelatedSearch].filter(tab => !tab.isClosed())) await tab.close();
    console.log('Project-only background collection, save-before-close, CAPTCHA/partial/navigation safeguards and reset passed.');
    const search = await context.newPage();
    await search.goto('https://www.google.com/search?q=energy');
    const tabId = await worker.evaluate(async () => (await (globalThis.browser ?? chrome).tabs.query({})).find(tab => tab.url?.includes('www.google.com/search')).id);
    await page.locator('#urls-section .workspace-panel').evaluate(panel => { panel.open = false; });
    const collection = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'collect', tabId }), tabId);
    assert.equal(collection.ok, true); assert.equal(collection.count, 1);
    await page.waitForFunction(() => document.querySelector('#urls-section .workspace-panel').open);
    await page.waitForFunction(() => document.querySelector('#urls').value.includes('https://corpus.test/article'));
    await page.waitForFunction(() => document.querySelector('#urls').value === 'https://corpus.test/article');
    assert.equal(await page.locator('#use-collected').count(), 0);
    assert.equal(await page.locator('#project-name').getAttribute('readonly'), '');
    await page.click('#rename-project'); await page.fill('#project-dialog-name', 'Energy corpus'); await page.click('#project-dialog-submit');
    assert.equal(await page.inputValue('#urls'), 'https://corpus.test/article');
    async function deleteAllRows() {
      await closeTextReview(); await openIssues();
      let count;
      while ((count = await page.locator('#review-lists .delete-button').count())) {
        await clickConfirmed('#review-lists .delete-button');
        await page.waitForFunction(count => document.querySelectorAll('#review-lists tbody tr').length < count, count);
      }
    }
    for (const extractor of ['readability', 'defuddle']) {
      if (extractor === 'defuddle') {
        await clickConfirmed('#review-lists .delete-button');
        await page.waitForFunction(() => !document.querySelector('#review-lists tbody tr') && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
        await page.fill('#urls', 'https://corpus.test/article');
      }
      await page.click('#open-settings');
      await page.waitForFunction(()=>!document.querySelector('#project-corpus-settings-save').disabled);
      await page.selectOption('#extractor', extractor);
      await page.click('#project-corpus-settings-save');
      await page.locator('#settings-dialog[open]').waitFor({state:'hidden'});
      await page.click('#start');
      await waitForFinished();
      assert.match(await page.locator('#status').innerText(), /^Finished\.$/);
      assert.equal(await page.locator('#start').isDisabled(), true);
      assert.equal(await page.locator('#documents-count').innerText(), '1 document');
      assert.equal(await page.locator('#included-count').innerText(), '1 included');
      await page.locator('#export-guidance').waitFor();
      assert.equal(await page.locator('#export-guidance-title').innerText(), 'Your corpus is ready to export.');
      assert.equal(await page.locator('#export-guidance-issues').isVisible(), false);
      const projectPanel = page.locator('#project-section .workspace-panel');
      if (await projectPanel.evaluate(panel => panel.open)) await page.locator('#project-section .workspace-panel > summary').click();
      await page.locator('#go-to-export').click();
      assert.equal(await projectPanel.evaluate(panel => panel.open), true);
      assert.equal(await page.locator('#export').evaluate(button => button === document.activeElement), true);
      await page.locator('nav a[href="#review-section"]').click();
      await search.goto('https://corpus.test/article');
      assert.equal((await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-page-corpus-state', tabId }), tabId)).saved, true, 'batch downloads count as already saved');
      assert.equal(await page.inputValue('#preview-text'), '');
      assert.equal(await page.locator('#preview-section, nav a[href="#preview-section"]').count(), 0);
      assert.equal(await page.locator('#text-review-dialog[open]').count(), 0);
      await page.click('#review-lists .preview-button');
      await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy'));
      assert.ok((await page.inputValue('#preview-text')).includes('Renewable energy'));
      assert.ok(!(await page.inputValue('#preview-text')).includes('MENU_SENTINEL'));
      if (extractor === 'readability') {
        const baseline = await page.inputValue('#preview-text');
        assert.equal(await page.locator('#preview-text').evaluate(text => text.readOnly), true);
        assert.equal(await page.locator('#text-review-save').isDisabled(), true);
        await page.click('#text-review-edit');
        await page.fill('#preview-text', baseline + '\nManual corpus edit: café 中文 🐱.');
        await page.click('#text-review-close'); await page.locator('#confirmation-dialog[open]').waitFor();
        await page.click('#confirmation-cancel');
        assert.equal(await page.locator('#text-review-dialog[open]').count(), 1);
        assert.ok((await page.inputValue('#preview-text')).endsWith('Manual corpus edit: café 中文 🐱.'));
        await page.click('#text-review-save');
        await page.waitForFunction(() => document.querySelector('#text-review-status').textContent.startsWith('Text saved'));
        assert.equal(await page.locator('#preview-text').evaluate(text => text.readOnly), true);
        await closeTextReview(); await page.click('#review-lists .preview-button');
        await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Manual corpus edit'));
        assert.equal(await page.evaluate(async () => {
          const store = await import('./project-store.js'), { project } = await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' });
          const entry = (await store.loadWorkspace(project.id)).entries[0];
          return (await (await store.readOriginalText(project.id, entry.url)).text()).includes('Manual corpus edit');
        }), false);
      }

      const downloadEvent = page.waitForEvent('download'); await closeTextReview(); await page.click('#export');
      const download = await downloadEvent; await download.saveAs(join(root, `${extractor}.zip`));
      assert.equal(await download.failure(), null);
      assert.equal(download.suggestedFilename(), 'Corpus Energy corpus.zip');
      await checkCorpusReport(join(root, `${extractor}.zip`));
      if (extractor === 'readability') execFileSync('python3', ['-c', `
import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 doc=json.loads(z.read('extraction.json'))['documents'][0]
 assert 'Manual corpus edit' in z.read(doc['textFilename']).decode()
 assert 'Manual corpus edit' not in z.read(doc['originalTextFilename']).decode()
 assert doc['originalTextFilename'].startswith('raw-text/')
`, join(root, 'readability.zip')]);

      console.log(`${extractor}: search collection → download → extraction → ZIP passed`);
    }
    await deleteAllRows();
    // Hold one real download open while the user edits and recovers other URLs.
    const concurrentURLs = ['good', 'failed', 'upload', 'blocked', 'queued'].map(name => `${pdfOrigin}/concurrent/${name}`);
    await page.fill('#urls', concurrentURLs.join('\n')); await page.click('#start');
    const concurrentDeadline = Date.now() + 10000;
    while (!pendingCorpusResponses.has('blocked') && Date.now() < concurrentDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pendingCorpusResponses.has('blocked'), true, 'the delayed batch URL must begin downloading');
    await page.waitForFunction(() => !document.querySelector('#download-feedback-strip').hidden && document.querySelector('#header-download-progress').value < document.querySelector('#header-download-progress').max);
    assert.equal(await page.evaluate(async () => (globalThis.browser ?? chrome).action.getBadgeText({})), '…');
    await page.locator('nav a[href="#project-section"]').click();
    assert.equal(await page.locator('#download-feedback-strip').isVisible(), true, 'progress remains visible away from Build Corpus');
    // A real reload must offer the browser's confirmation and allow cancelling.
    cancelUnload = true;
    const unloadDialog = page.waitForEvent('dialog', dialog => dialog.type() === 'beforeunload');
    await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
    await unloadDialog;
    await page.waitForFunction(() => !document.querySelector('#stop').disabled);
    cancelUnload = false;
    assert.equal(await page.locator('#stop').isDisabled(), false);

    assert.equal(await page.locator('#attention-section').evaluate(panel => panel.open), false);
    assert.equal(await page.locator('#attention-heading').innerText(), 'Documents with issues');
    assert.equal(await page.locator('#export').isDisabled(), true);
    const parallelWorkspace = await context.newPage(); await parallelWorkspace.goto(origin + '/downloader.html');
    await parallelWorkspace.waitForFunction(() => document.querySelector('#download-activity').textContent.includes('another BootCaT window'));
    assert.equal(await parallelWorkspace.locator('#start').isDisabled(), true);
    await parallelWorkspace.waitForFunction(() => !document.querySelector('#download-feedback-strip').hidden);
    assert.match(await parallelWorkspace.title(), /processed/);
    assert.equal(await parallelWorkspace.locator('#export').isDisabled(), true);
    await page.bringToFront();
    const goodRow = page.locator('#results tr').filter({ has: page.locator(`a[href="${concurrentURLs[0]}"]`) });
    await goodRow.locator('.preview-button').click(); await page.locator('#text-review-edit').waitFor({ state: 'visible' });
    await page.click('#text-review-edit');
    const concurrentEdit = 'Edited while downloads continue. ' + paragraph;
    await page.fill('#preview-text', concurrentEdit);
    resolvedCorpus.add('failed'); await search.goto(concurrentURLs[1]);
    const concurrentCapture = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'save-page', tabId }), tabId);
    assert.equal(concurrentCapture.ok, true, JSON.stringify(concurrentCapture));
    await page.waitForFunction(url => [...document.querySelectorAll('#results a')].some(link => link.href === url), concurrentURLs[1]);
    assert.equal(await page.inputValue('#preview-text'), concurrentEdit);
    assert.equal(pendingCorpusResponses.has('blocked'), true, 'recovery must appear before the batch ends');
    await page.click('#text-review-save');
    await page.waitForFunction(() => document.querySelector('#text-review-status').textContent.startsWith('Text saved'));
    await closeTextReview(); await openIssues();
    const uploadRow = page.locator('#problem-results tr').filter({ has: page.locator(`a[href="${concurrentURLs[2]}"]`) });
    const concurrentChooser = page.waitForEvent('filechooser'); await uploadRow.locator('.import-document-button').click();
    await (await concurrentChooser).setFiles({ name: 'recovered.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfFixture()) });
    await page.waitForFunction(url => [...document.querySelectorAll('#results a')].some(link => link.href === url), concurrentURLs[2]);
    assert.equal(pendingCorpusResponses.has('blocked'), true);
    await search.goto(concurrentURLs[4]);
    assert.equal((await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'save-page', tabId }), tabId)).ok, true);
    await page.waitForFunction(url => [...document.querySelectorAll('#results a')].some(link => link.href === url), concurrentURLs[4]);
    await parallelWorkspace.waitForFunction(() => document.querySelectorAll('#results tr').length === 4);
    pendingCorpusResponses.get('blocked')();
    await waitForFinished();
    assert.equal(corpusFetches.get('queued') || 0, 0, 'queued manual recoveries must not download again');
    assert.equal(corpusFetches.get('blocked'), 1);
    assert.equal(await page.locator('#results tr').count(), 5);
    assert.deepEqual(await page.locator('#results tr td:nth-child(2) > a').evaluateAll(links=>links.map(a=>a.href)),concurrentURLs);
    assert.equal(await page.locator('#attention-section').isVisible(), false);
    await page.waitForFunction(() => document.title.startsWith('Downloads finished'));
    assert.equal(await page.evaluate(async () => (globalThis.browser ?? chrome).action.getBadgeText({})), '✓');
    await parallelWorkspace.waitForFunction(() => document.title.startsWith('Downloads finished'));
    await parallelWorkspace.reload();
    await parallelWorkspace.waitForFunction(() => document.querySelector('#download-feedback-summary').textContent === 'Your corpus is ready to export.');
    assert.deepEqual(await parallelWorkspace.locator('#results tr td:nth-child(2) > a').evaluateAll(links=>links.map(a=>a.href)),concurrentURLs);
    async function setProjectLength(minimum, maximum) {
      await page.click('#open-settings');
      await page.waitForFunction(()=>!document.querySelector('#project-corpus-settings-save').disabled);
      await page.fill('#project-minimum-characters',minimum);
      await page.fill('#project-maximum-characters',maximum);
      await page.click('#project-corpus-settings-save');
      await page.locator('#settings-dialog[open]').waitFor({state:'hidden'});
    }
    await setProjectLength('1000000','');
    await page.waitForFunction(()=>document.querySelectorAll('#problem-results tr').length===5);
    await openIssues();
    assert.match(await page.locator('#problem-results').innerText(),/Too short:/);
    await parallelWorkspace.waitForFunction(()=>document.querySelectorAll('#problem-results tr').length===5);
    await openIssues();
    await page.locator('#problem-results .accept-language').first().click();
    await page.waitForFunction(()=>document.querySelectorAll('#results tr').length===1);
    assert.match(await page.locator('#results .manual-intervention').getAttribute('title'),/Length warning accepted/);
    await setProjectLength('','1');
    await page.waitForFunction(()=>document.querySelectorAll('#problem-results tr').length===4 && document.querySelector('#problem-results').textContent.includes('Too long:'));
    assert.equal(await page.locator('#results tr').count(),1,'manual inclusion survives a range change');
    await setProjectLength('','');
    await page.waitForFunction(()=>document.querySelectorAll('#results tr').length===5 && document.querySelector('#attention-section').hidden);
    assert.deepEqual(await page.locator('#results tr td:nth-child(2) > a').evaluateAll(links=>links.map(a=>a.href)),concurrentURLs);
    await parallelWorkspace.waitForFunction(()=>document.querySelectorAll('#results tr').length===5);
    console.log('WP6: saved texts rechecked across windows, short/long reasons, manual override and clearing filters passed.');
    await parallelWorkspace.locator('#dismiss-download-feedback').click();
    await page.waitForFunction(() => document.querySelector('#download-feedback-strip').hidden);
    assert.equal(await page.evaluate(async () => (globalThis.browser ?? chrome).action.getBadgeText({})), '');
    await parallelWorkspace.close(); await deleteAllRows();
    console.log('Concurrent text editing, cross-window activity, manual capture/import and recovered-URL skipping passed.');
    await page.fill('#urls', 'https://corpus.test/document.pdf\nhttps://corpus.test/document.docx');
    await page.click('#start');
    await waitForFinished();
    assert.match(await page.locator('#status').innerText(), /^Finished\.$/);
    assert.equal(await page.inputValue('#preview-text'), '');
    assert.equal(await page.locator('#pdf-notice').count(), 0);
    const inclusionToggle = page.locator('#results input[type="checkbox"]').first();
    await inclusionToggle.scrollIntoViewIfNeeded(); await inclusionToggle.focus();
    const beforeInclusion = await inclusionToggle.evaluate(el => {
      globalThis.originalInclusionInput = el;
      globalThis.inclusionVisibility = [];
      globalThis.inclusionObserver = new MutationObserver(() => inclusionVisibility.push(document.querySelector('#export-guidance').hidden));
      inclusionObserver.observe(document.querySelector('#export-guidance'), { attributes: true });
      return { y: scrollY, height: el.closest('tr').getBoundingClientRect().height, width: document.querySelector('#included-count').getBoundingClientRect().width };
    });
    await inclusionToggle.uncheck();
    await page.waitForFunction(() => document.querySelector('#included-count').textContent === '1 included' && !document.querySelector('#results input[type="checkbox"]').disabled);
    const afterInclusion = await inclusionToggle.evaluate(el => {
      inclusionObserver.disconnect();
      return { y: scrollY, height: el.closest('tr').getBoundingClientRect().height, width: document.querySelector('#included-count').getBoundingClientRect().width, same: el === originalInclusionInput, focused: el === document.activeElement, hidden: inclusionVisibility };
    });
    assert.equal(afterInclusion.same, true); assert.equal(afterInclusion.focused, true);
    assert.ok(Math.abs(beforeInclusion.y - afterInclusion.y) < 2);
    assert.equal(afterInclusion.height, beforeInclusion.height); assert.equal(afterInclusion.width, beforeInclusion.width);
    assert.ok(afterInclusion.hidden.every(hidden => !hidden), 'inclusion saves must not blink the export banner');
    await inclusionToggle.check();
    await page.waitForFunction(() => document.querySelector('#included-count').textContent === '2 included' && !document.querySelector('#results input[type="checkbox"]').disabled);

    assert.ok(!(await page.locator('#review-lists').innerText()).includes('PDF reading order'));
    await page.locator('#review-lists .preview-button').nth(0).click();
    await page.waitForFunction(() => document.querySelector('#results tr')?.classList.contains('preview-selected'));
    assert.equal(await page.locator('#results tr.preview-selected').count(), 1);
    assert.equal(await page.locator('#results tr').nth(0).getAttribute('aria-current'), 'true');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy corpus'));
    assert.match(await page.inputValue('#preview-text'), /Renewable energy corpus/);
    await closeTextReview();
    await page.locator('#review-lists .preview-button').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('#results tr')[1]?.classList.contains('preview-selected'));
    assert.equal(await page.locator('#results tr.preview-selected').count(), 1);
    assert.equal(await page.locator('#results tr').nth(0).getAttribute('aria-current'), 'false');
    assert.equal(await page.locator('#results tr').nth(1).getAttribute('aria-current'), 'true');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Caffè 中文 corpus'));
    assert.match(await page.inputValue('#preview-text'), /Caffè 中文 corpus/);
    const documentsDownload = page.waitForEvent('download'); await closeTextReview(); await page.click('#export');
    await (await documentsDownload).saveAs(join(root, 'documents.zip'));
    await checkCorpusReport(join(root, 'documents.zip'));
    await page.waitForFunction(() => document.querySelector('#export').textContent === 'Corpus exported');
    await page.waitForFunction(() => !document.querySelector('#export-guidance').hidden && document.querySelector('#export-guidance-title').textContent === 'Your corpus download has started.');
    assert.equal(await page.locator('#go-to-export').isVisible(), false);
    assert.equal(await page.locator('#export').isDisabled(), true);
    assert.match(await page.locator('#export-status').innerText(), /Corpus saved.*Downloads folder/);
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.equal(await page.locator('#export').isDisabled(), true);
    assert.match(await page.locator('#export-status').innerText(), /Corpus saved/);
    await page.locator('#results input[type="checkbox"]').first().uncheck();
    await page.waitForFunction(() => document.querySelector('#included-count').textContent === '1 included');
    assert.equal(await page.locator('#documents-count').innerText(), '2 documents');
    await page.waitForFunction(() => !document.querySelector('#export').disabled);
    assert.match(await page.locator('#export-status').innerText(), /Project changed/);
    console.log('PDF/DOCX download, local extraction, preview and ZIP passed.');
    await deleteAllRows();
    await page.fill('#urls', 'https://corpus.test/large.docx'); await page.click('#start');
    await waitForFinished();
    assert.match(await page.locator('#status').innerText(), /^Finished\.$/);
    await page.click('#review-lists .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.length > 3 * 1024 * 1024 && document.querySelector('#preview-text').value.startsWith('Larger DOCX corpus text.'));
    await deleteAllRows();
    await page.fill('#urls', 'https://corpus.test/wrapped.pdf');
    await page.click('#start');
    await waitForFinished();
    assert.match(await page.locator('#status').innerText(), /^Finished\.$/);
    await page.click('#review-lists .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('This is the final line'));
    assert.equal(await page.inputValue('#preview-text'), 'These are words on a long line of corpus text Other new words on a long line of corpus text This is the final line');
    const rawPDF = await page.evaluate(async () => {
      const storage = await import('./project-store.js');
      const { project } = await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' });
      const entry = (await storage.loadWorkspace(project.id)).entries[0];
      return { name: entry.doc.rawTextFilename, text: await (await storage.readRawText(project.id, entry.url)).text(), joinedLines: entry.doc.extraction.formatting.joinedLines };
    });
    assert.equal(rawPDF.joinedLines, 2); assert.match(rawPDF.name, /^raw-pdf\//);
    assert.ok(rawPDF.text.includes('text\nOther new'));
    const rawDownload = page.waitForEvent('download'); await closeTextReview(); await page.click('#export');
    const rawPath = join(root, 'raw-formatted.zip'); await (await rawDownload).saveAs(rawPath);
    const rawZip = await readFile(rawPath); assert.ok(rawZip.includes(wrappedPDF));
    assert.ok(rawZip.includes(Buffer.from(rawPDF.name))); assert.ok(rawZip.includes(Buffer.from(rawPDF.text)));
    await deleteAllRows();
    await page.fill('#urls', pdfOrigin + '/oversized.pdf'); await page.click('#start');
    await waitForFinished();
    assert.equal(await page.locator('#problem-results tr').count(), 1);
    assert.equal(await page.locator('#results tr').count(), 0);
    assert.equal(await page.locator('#attention-section').isVisible(), true);
    assert.equal(await page.locator('#attention-section').evaluate(panel => panel.open), false);
    assert.equal(await page.locator('#attention-heading').innerText(), 'Documents with issues');
    await openIssues();
    assert.match(await page.locator('#review-lists').innerText(), /50 MiB download limit/);
    assert.ok(!(await page.locator('#review-lists').innerText()).includes('CAPTCHA'));
    assert.equal(await page.locator('#review-lists .import-document-button').count(), 0);
    await deleteAllRows();
    console.log('Large PDF batch download, layout cleanup, raw-text ZIP backup and explicit 50 MiB failure passed.');
    await page.fill('#urls', 'https://corpus.test/empty.pdf');
    await page.click('#start');
    await waitForFinished();
    await openIssues();
    assert.match(await page.locator('#review-lists').innerText(), /Extraction failed/);
    assert.equal(await page.locator('#review-lists .import-document-button').count(), 0, 'failed extraction uses manual text recovery from Details');
    await page.locator('#problem-results .preview-button').click();
    await page.waitForFunction(()=>document.querySelector('#text-review-dialog').open && !document.querySelector('#text-review-edit').disabled);
    assert.equal(await page.locator('#text-review-edit').isEnabled(),true);
    await page.click('#text-review-edit'); await page.fill('#preview-text','Manually recovered café 中文 🐱 corpus text.'); await page.click('#text-review-save');
    await page.waitForFunction(()=>document.querySelector('#text-review-status').textContent==='Text recovered');
    assert.equal(await page.locator('#problem-results tr').count(),0); assert.equal(await page.locator('#results tr').count(),1);
    assert.match(await page.locator('#results').innerText(),/Manually recovered/);
    const manualRecovery=await page.evaluate(async()=>{
      const store=await import('./project-store.js'), portable=await import('./portable-project.js');
      const {project}=await (globalThis.browser??chrome).runtime.sendMessage({type:'get-project'});
      const snapshot=await store.snapshotStoredProject(project);
      const restored=await portable.openProjectArchive(await portable.makeProjectArchive(snapshot));
      const entry=restored.stores.documents.find(entry=>entry.url==='https://corpus.test/empty.pdf');
      return {extraction:entry.doc.extraction,revision:entry.doc.editRevision,original:(await restored.stores.files.find(file=>file.name===entry.doc.filename).blob.text()).slice(0,5),baseline:await restored.stores.texts.find(text=>text.url===entry.url).originalBlob.text()};
    });
    assert.equal(manualRecovery.extraction.textSource,'manual'); assert.equal(manualRecovery.extraction.recovery.previousExtraction.status,'failed');
    assert.equal(manualRecovery.revision,1); assert.equal(manualRecovery.original,'%PDF-'); assert.equal(manualRecovery.baseline,'');
    await page.click('#text-review-close');
    await page.waitForFunction(()=>document.querySelector('#results tr')?.classList.contains('recovery-success'));
    console.log('Manual text recovery from Details, corpus-row feedback and portable provenance/original preservation passed.');

    await deleteAllRows();
    await page.fill('#urls', 'https://corpus.test/blocked');
    await page.click('#start');
    await waitForFinished();
    assert.match(await page.locator('#status').innerText(), /^Finished\.$/);
    await openIssues();
    assert.equal(await page.locator('#review-lists .import-document-button').count(), 1, 'failed downloads offer generic import');
    assert.match(await page.locator('#review-lists td').nth(2).innerText(), /Could not download page/);
    assert.doesNotMatch(await page.locator('#review-lists td').nth(2).innerText(),/HTTP 403/);
    await page.locator('.download-error-details > summary').click();
    assert.match(await page.locator('.download-error-details').innerText(),/HTTP 403/);
    assert.equal(await page.locator('#review-lists a').getAttribute('href'), 'https://corpus.test/blocked');
    await search.goto('https://corpus.test/blocked');
    await search.evaluate(() => {
      document.head.insertAdjacentHTML('beforeend', '<meta charset="windows-1252">');
      document.body.insertAdjacentHTML('beforeend', '<form><input value="PRIVATE_FIELD"><textarea>PRIVATE_FIELD</textarea></form><iframe src="about:blank"></iframe><p onclick="alert(1)">Event test</p>');
    });
    const saved = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'save-page', tabId }), tabId);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    // Inspect capture cleanup directly; the inbox is consumed automatically.
    const snapshots = [await search.evaluate(async source => (0, eval)(`(${source})()`), (await import('../src/page-capture.js')).captureCurrentPage.toString())];
    assert.equal(snapshots.length, 1);
    assert.ok(!snapshots[0].html.includes('PRIVATE_FIELD') && !snapshots[0].html.includes('onclick=') && !snapshots[0].html.includes('<iframe'));
    assert.ok(snapshots[0].html.includes('charset="utf-8"') && !snapshots[0].html.includes('windows-1252'));
    await page.waitForFunction(() => document.querySelector('#saved-status').textContent.startsWith('1 saved page added'));
    assert.equal((await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-page-corpus-state', tabId }), tabId)).saved, true);
    const duplicate = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'save-page', tabId }), tabId);
    assert.equal(duplicate.alreadySaved, true, 'reopened popup cannot create another capture');
    assert.equal(await page.locator('#review-lists tbody tr').count(), 1);
    assert.equal(await page.locator('#results tr').count(), 1);
    assert.equal(await page.locator('#attention-section').isVisible(), false);
    const capturedDownload = page.waitForEvent('download'); await closeTextReview(); await page.click('#export');
    const capturedZIP = join(root, 'captured-flat.zip'); await (await capturedDownload).saveAs(capturedZIP);
    await checkCorpusReport(capturedZIP);
    assert.equal(await page.inputValue('#preview-text'), '');
    await page.click('#review-lists .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy'));
    assert.ok((await page.inputValue('#preview-text')).includes('Renewable energy'));
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelectorAll('#review-lists tbody tr').length === 1 && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.equal(await page.inputValue('#preview-text'), '');
    await page.click('#review-lists .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy'));
    assert.ok((await page.inputValue('#preview-text')).includes('Renewable energy'));
    await clickConfirmed('#review-lists .delete-button', 'escape');
    assert.equal(await page.locator('#review-lists tbody tr').count(), 1);
    await clickConfirmed('#review-lists .delete-button');
    await page.waitForFunction(() => document.querySelectorAll('#review-lists tbody tr').length === 0);
    assert.equal(await page.locator('#review-lists tbody tr').count(), 0);
    assert.equal(await page.inputValue('#preview-text'), '');
    assert.equal(await page.locator('#export').isDisabled(), true);
    assert.equal(await page.locator('#add-saved, #clear-saved').count(), 0);
    await page.waitForFunction(async () => (await (await import('./page-store.js')).readSavedPages()).length === 0);
    console.log('Automatic failed URL recovery, inert UTF-8 snapshots and inbox consumption passed.');
    await page.fill('#urls', `${pdfOrigin}/session-document\n${pdfOrigin}/always-blocked.pdf`);
    await page.click('#start');
    await waitForFinished();
    assert.match(await page.locator('#status').innerText(), /^Finished\.$/);
    await search.goto(pdfOrigin + '/login');
    await search.goto(pdfOrigin + '/session-document', { waitUntil: 'domcontentloaded' });
    const recoveredPDF = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'save-page', tabId }), tabId);
    assert.equal(recoveredPDF.ok, true, JSON.stringify(recoveredPDF));
    const sessionRow = page.locator('#review-lists tbody tr').filter({ has: page.locator(`a[href="${pdfOrigin}/session-document"]`) });
    await sessionRow.locator('.preview-button').waitFor();
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.match(await sessionRow.innerText(), /PDF saved using browser session/);
    assert.ok(!(await sessionRow.innerText()).includes('PDF reading order'));
    await sessionRow.locator('.preview-button').click();
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy corpus'));
    await closeTextReview();
    const localRow = page.locator('#review-lists tbody tr').filter({ has: page.locator(`a[href="${pdfOrigin}/always-blocked.pdf"]`) });
    await openIssues();
    const invalidChooser = page.waitForEvent('filechooser'); await localRow.locator('.import-document-button').click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await (await invalidChooser).setFiles({ name: 'not-a-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>CAPTCHA</html>') });
    await page.waitForFunction(() => document.querySelector('#document-import-status').textContent.includes('File not imported'));
    assert.match(await localRow.locator('.document-import-feedback').innerText(), /Unsupported file contents/);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.match(await page.locator('#document-import-status').innerText(), /File not imported/);
    const chooserEvent = page.waitForEvent('filechooser'); await localRow.locator('.import-document-button').click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const largePDF = Buffer.from(pdfFixture({ paddingBytes: 15 * 1024 * 1024 }));
    await (await chooserEvent).setFiles({ name: 'downloaded.pdf', mimeType: 'application/pdf', buffer: largePDF });
    await localRow.locator('.preview-button').waitFor();
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.match(await localRow.innerText(), /Imported PDF/);
    assert.match(await localRow.locator('.manual-intervention').getAttribute('title'),/Imported file/);
    assert.equal(await localRow.locator('.manual-intervention').isVisible(),true);
    await page.waitForFunction(() => document.querySelector('#document-import-feedback').dataset.state === 'success');
    assert.match(await localRow.locator('.document-import-feedback').innerText(), /Download recovered/);
    await page.locator('#show-imported-document').click();
    await page.waitForFunction(url => {
      const row = [...document.querySelectorAll('#results tr')].find(row => row.querySelector('a')?.href === url);
      return row?.classList.contains('recovery-success') && row.getBoundingClientRect().top >= document.querySelector('.workspace-header').getBoundingClientRect().bottom;
    }, pdfOrigin + '/always-blocked.pdf');
    assert.equal(await page.locator('#review-lists tbody tr').count(), 2, 'recovery must replace failed rows');
    await page.fill('#urls', `${pdfOrigin}/session-document\n${pdfOrigin}/always-blocked.pdf\n${pdfOrigin}/always-blocked.docx`);
    await page.click('#start');
    await waitForFinished();
    const wordRow = page.locator('#review-lists tbody tr').filter({ has: page.locator(`a[href="${pdfOrigin}/always-blocked.docx"]`) });
    await openIssues();
    assert.equal(await wordRow.locator('.import-document-button').innerText(), 'Import downloaded file');
    const wordChooser = page.waitForEvent('filechooser'); await wordRow.locator('.import-document-button').click();
    assert.equal(await page.locator('#import-document-picker').getAttribute('accept'), '');
    await (await wordChooser).setFiles({ name: 'downloaded.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: largeDOCX });
    await wordRow.locator('.preview-button').waitFor();
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.match(await wordRow.innerText(), /Imported DOCX/);
    await wordRow.locator('.preview-button').click();
    await page.waitForFunction(() => document.querySelector('#preview-text').value.length > 3 * 1024 * 1024);
    const recoveredDownload = page.waitForEvent('download'); await closeTextReview(); await page.click('#export');
    const recoveredPath = join(root, 'recovered-pdfs.zip');
    await (await recoveredDownload).saveAs(recoveredPath);
    assert.ok((await readFile(recoveredPath)).includes(largePDF), 'ZIP must contain the complete imported PDF original');
    assert.ok((await readFile(recoveredPath)).includes(largeDOCX), 'ZIP must contain the complete imported DOCX original');
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelectorAll('#review-lists tbody tr').length === 3 && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.equal(await page.inputValue('#preview-text'), '');
    assert.match(await page.locator('#review-lists').innerText(), /Imported PDF/);
    assert.match(await page.locator('#review-lists').innerText(), /Imported DOCX/);
    await deleteAllRows();
    console.log('Session-aware PDF tab recovery, browser file chooser import, persistence and export passed.');
    // An imported original can be valid even when extraction still fails.
    await page.fill('#urls', pdfOrigin + '/always-blocked.pdf'); await page.click('#start'); await waitForFinished(); await openIssues();
    let retryRow = page.locator('#problem-results tr').filter({ has: page.locator(`a[href="${pdfOrigin}/always-blocked.pdf"]`) });
    let retryChooser = page.waitForEvent('filechooser'); await retryRow.locator('.import-document-button').click();
    await (await retryChooser).setFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfFixture({ empty: true })) });
    await page.waitForFunction(() => document.querySelector('#document-import-feedback').dataset.state === 'warning');
    assert.match(await page.locator('#document-import-status').innerText(), /text still unavailable/);
    assert.equal(await retryRow.locator('.preview-button').innerText(), 'Details');
    assert.equal(await page.locator('#results tr').count(), 0);
    await deleteAllRows();
    // Drop a real File onto the recovery button: use the full extension reader,
    // durable storage, language checks, row movement and success feedback.
    await page.fill('#urls', pdfOrigin + '/always-blocked.pdf'); await page.click('#start'); await waitForFinished(); await openIssues();
    await page.evaluate(({ url, bytes }) => {
      const row = [...document.querySelectorAll('#problem-results tr')].find(row => row.querySelector('a')?.href === url);
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'downloaded.pdf', { type: 'application/pdf' }));
      row.querySelector('.import-document-button').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, { url: pdfOrigin + '/always-blocked.pdf', bytes: Array.from(Buffer.from(pdfFixture())) });
    await page.waitForFunction(() => document.querySelector('#document-import-feedback').dataset.state === 'success');
    assert.equal(await page.locator('#document-import-status').innerText(), 'Download recovered');
    assert.equal(await page.locator('#results tr').count(), 1); assert.equal(await page.locator('#problem-results tr').count(), 0);
    const dropped = await page.evaluate(async url => {
      const store = await import('./project-store.js'), projectId = await store.storedProjectId();
      const entry = (await store.loadWorkspace(projectId)).entries.find(entry => entry.url === url);
      return { source: entry.record.source, size: (await store.readOriginal(projectId, entry.doc.filename)).size };
    }, pdfOrigin + '/always-blocked.pdf');
    assert.equal(dropped.source, 'local-file'); assert.equal(dropped.size, Buffer.byteLength(pdfFixture()));
    await deleteAllRows();
    // Usable text with a new language warning remains in Documents with issues.
    await page.selectOption('#project-language', 'ita');
    await page.fill('#urls', pdfOrigin + '/always-blocked.pdf'); await page.click('#start'); await waitForFinished(); await openIssues();
    retryRow = page.locator('#problem-results tr').filter({ has: page.locator(`a[href="${pdfOrigin}/always-blocked.pdf"]`) });
    retryChooser = page.waitForEvent('filechooser'); await retryRow.locator('.import-document-button').click();
    await (await retryChooser).setFiles({ name: 'english.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfFixture()) });
    await page.waitForFunction(() => document.querySelector('#document-import-feedback').dataset.state === 'warning');
    assert.match(await page.locator('#document-import-status').innerText(), /language review needed/);
    assert.match(await retryRow.innerText(), /language|Detected/i);
    assert.equal(await page.locator('#results tr').count(), 0);
    await deleteAllRows(); await page.selectOption('#project-language', 'none');
    console.log('Real imports distinguish successful recovery, failed extraction and remaining language warnings.');
    await page.evaluate(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'open-workspace' }));
    assert.equal(context.pages().filter(tab => tab.url().split('#')[0] === origin + '/downloader.html').length, 1);
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'Energy corpus');
    await page.fill('#urls', 'https://corpus.test/keep-on-cancel');
    await page.click('#new-project');
    assert.equal(await page.inputValue('#project-name'), 'Energy corpus');
    await page.click('#project-dialog-cancel');
    assert.equal(await page.inputValue('#urls'), 'https://corpus.test/keep-on-cancel');
    await page.click('#new-project');
    await page.selectOption('#project-dialog-language', 'none'); await page.fill('#project-dialog-name', 'Fresh corpus');
    await page.click('#project-dialog-submit'); await page.locator('#project-replace-dialog[open]').waitFor();
    await page.click('#project-replace-dialog button[value=cancel]'); await page.locator('#project-dialog[open]').waitFor();
    assert.equal(await page.inputValue('#project-name'), 'Energy corpus');
    assert.equal(await page.inputValue('#urls'), 'https://corpus.test/keep-on-cancel');
    assert.equal(await page.inputValue('#project-dialog-name'), 'Fresh corpus');
    await submitProject();
    await page.waitForFunction(() => document.querySelector('#project-name')?.value === 'Fresh corpus' && !document.querySelector('#new-project').disabled);
    await page.waitForFunction(() => !document.querySelector('#urls').disabled);
    assert.equal(await page.inputValue('#urls'), '');
    await assertCollapsed(); await openPanels();
    assert.equal(await page.inputValue('#seeds'), ''); assert.equal(await page.inputValue('#tuples'), '');
    assert.equal(await page.inputValue('#tuple-length'), '3'); assert.equal(await page.inputValue('#tuple-count'), '10');
    assert.equal(await page.locator('#prepared-queries a').count(), 0);
    assert.equal(await page.inputValue('#preview-text'), '');
    assert.equal(await page.locator('#review-lists tbody tr').count(), 0);
    assert.equal(await page.locator('#export').isDisabled(), true);
    assert.equal(await page.evaluate(async () => (await (await import('./page-store.js')).readSavedPages()).length), 0);
    await page.selectOption('#project-language', 'ita');
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await page.fill('#urls', 'https://corpus.test/article'); await page.click('#start');
    await waitForFinished();
    assert.equal(await page.locator('#problem-results tr').count(), 1);
    assert.equal(await page.locator('#problem-results input[type="checkbox"]').isChecked(), false);
    await openIssues();
    assert.match(await page.locator('#problem-results').innerText(), /Detected English/);
    await page.click('#problem-results .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy'));
    await closeTextReview();
    await page.click('#problem-results .accept-language');
    await page.waitForFunction(() => document.querySelectorAll('#results tr').length === 1 && !document.querySelector('#recheck-language').disabled);
    assert.equal(await page.locator('#attention-section').isVisible(), false);
    await page.waitForFunction(()=>document.querySelector('#document-import-status').textContent==='Language warning accepted');
    await page.waitForFunction(()=>document.querySelector('#results tr')?.classList.contains('recovery-success') && document.querySelector('#download-feedback-strip').dataset.state==='finished');
    assert.match(await page.locator('#results .manual-intervention').getAttribute('title'),/Language warning accepted/);
    assert.equal(await page.locator('#download-feedback-summary').innerText(),'Your corpus is ready to export.');
    const exportButtonColor = await page.locator('#export').evaluate(button=>getComputedStyle(button).backgroundColor);
    await page.locator('#download-feedback-link').click();
    assert.equal(await page.locator('#export').evaluate(button=>getComputedStyle(button).backgroundColor),exportButtonColor);
    assert.equal(await page.locator('#export').evaluate(button=>button===document.activeElement),true);
    assert.equal(await page.locator('#export-focus-area').evaluate(area=>area.classList.contains('export-highlight')),true);
    const exportArea = await page.locator('#export-focus-area').evaluate(area=>({area:area.getBoundingClientRect().width,button:area.querySelector('button').getBoundingClientRect().width,project:document.querySelector('#project-section').getBoundingClientRect().width}));
    assert.ok(exportArea.area>exportArea.button && exportArea.area<=exportArea.button+24 && exportArea.area<exportArea.project/2);
    await page.waitForFunction(()=>!document.querySelector('#export-focus-area').classList.contains('export-highlight'));
    assert.equal(await page.evaluate(async()=>await (globalThis.browser??chrome).action.getBadgeText({})),'✓');
    await page.click('#recheck-language');
    await page.waitForFunction(() => document.querySelector('#language-status').textContent.startsWith('1 of 1 saved texts rechecked') && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.equal(await page.locator('#results tr').count(), 1, 'manual override must survive recheck');
    const acceptedDownload = page.waitForEvent('download'); await closeTextReview(); await page.click('#export');
    const acceptedZIP = join(root, 'accepted-language.zip'); await (await acceptedDownload).saveAs(acceptedZIP);
    await checkCorpusReport(acceptedZIP, 'English');

    await page.uncheck('#results input[type="checkbox"]');
    await page.selectOption('#project-language', 'none'); await page.click('#recheck-language');
    await page.waitForFunction(() => document.querySelector('#language-status').textContent.startsWith('1 of 1 saved texts rechecked') && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.equal(await page.locator('#results input[type="checkbox"]').isChecked(), false, 'disabling detection must preserve manual exclusion');
    const languageDownload = page.waitForEvent('download'); await closeTextReview(); await page.click('#export');
    const languageZIP = join(root, 'language.zip'); await (await languageDownload).saveAs(languageZIP);
    assert.ok((await readFile(languageZIP)).includes(Buffer.from('languageCheck')));
    await checkCorpusReport(languageZIP);
    await deleteAllRows();
    console.log('Local franc mismatch, review/override, saved-text recheck and language metadata export passed.');
    assert.deepEqual(await page.locator('#search-filetype option').allTextContents(), ['No restriction', 'PDF', 'DOCX']);
    await openSearchOptions();
    await page.fill('#search-site', 'https://www.UNIBO.it/research');
    await page.fill('#excluded-sites', 'https://www.youtube.com/watch?v=1\nfacebook.com\nhttps://www.example.org/path');
    await page.selectOption('#search-filetype', 'pdf'); await page.fill('#tuples', 'energy storage'); await page.click('#prepare-queries');
    const filteredQuery = 'energy storage filetype:pdf site:unibo.it -site:youtube.com -site:facebook.com -site:example.org';
    assert.equal(await page.locator('#prepared-queries a').innerText(), filteredQuery);
    assert.equal(new URL(await page.locator('#prepared-queries a').getAttribute('href')).searchParams.get('q'), filteredQuery);
    await page.click('#save-site-defaults');
    await page.waitForFunction(() => document.querySelector('#site-default-status').textContent.startsWith('Default exclusions saved'));
    await waitForSavedDraft();
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelectorAll('#prepared-queries a').length === 1);
    assert.equal(await page.locator('#prepared-queries a').innerText(), filteredQuery);
    assert.equal(await page.inputValue('#search-site'), 'unibo.it');
    await openSearchOptions();
    await page.selectOption('#search-filetype', 'docx'); assert.equal(await page.locator('#prepared-queries a').count(), 1);
    assert.equal(await page.locator('#prepared-queries a').innerText(), filteredQuery.replace('filetype:pdf', 'filetype:docx'));
    const filteredTabsBefore = context.pages().length;
    await page.fill('#excluded-sites', 'example.net');
    await page.waitForFunction(() => document.querySelector('#prepared-queries a').textContent === 'energy storage filetype:docx site:unibo.it -site:example.net');
    assert.equal(context.pages().length, filteredTabsBefore);
    assert.equal(await page.inputValue('#tuples'), 'energy storage');
    await page.fill('#excluded-sites', 'example.net -site:bad.test');
    await page.waitForFunction(() => document.querySelector('#excluded-sites').getAttribute('aria-invalid') === 'true');
    assert.equal(await page.locator('#open-all-queries').isDisabled(), true);
    assert.equal(await page.locator('#prepared-queries a').getAttribute('href'), null);
    await page.fill('#excluded-sites', 'example.net');
    await page.waitForFunction(() => !document.querySelector('#open-all-queries').disabled);

    await page.fill('#search-site', 'https://research.example.edu/path');
    await page.waitForFunction(() => document.querySelector('#prepared-queries a').textContent.includes('site:research.example.edu'));
    assert.equal(context.pages().length, filteredTabsBefore);
    await waitForSavedDraft();
    await page.locator('#more-search-options > summary').click();
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled && document.querySelectorAll('#prepared-queries a').length === 1);
    assert.equal(await page.inputValue('#search-site'), 'https://research.example.edu/path');
    assert.ok((await page.locator('#prepared-queries a').innerText()).includes('site:research.example.edu'));
    await page.click('#new-project'); await page.fill('#project-dialog-name', 'Saved defaults');
    await page.selectOption('#project-dialog-language', 'none'); await submitProject();
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'Saved defaults' && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await assertCollapsed(); await openPanels();
    assert.equal(await page.inputValue('#excluded-sites'), 'youtube.com\nfacebook.com\nexample.org');
    assert.equal(await page.inputValue('#search-site'), '');
    assert.equal(await page.inputValue('#search-filetype'), ''); assert.equal(await page.locator('#prepared-queries a').count(), 0);
    console.log('Collapsed advanced options, site/file restrictions, canonical exclusions, regenerated links and cross-project defaults passed.');
    // Collection controls use the real worker, content world and popup document.
    const floatingSource = await context.newPage(); await floatingSource.goto('https://corpus.test/floating-original');
    assert.equal(await floatingSource.locator('[data-bootcat-floating-control]').count(), 0);
    async function setCollectionControls(patch) {
      const reply = await page.evaluate(patch => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'save-collection-controls', patch }), patch);
      assert.equal(reply.ok, true, JSON.stringify(reply)); assert.equal(reply.floatingWarning, undefined); return reply.preferences;
    }
    await setCollectionControls({ floatingEnabled: true });
    const floatingHost = floatingSource.locator('[data-bootcat-floating-control]'); await floatingHost.waitFor();
    assert.equal(await floatingHost.evaluate(node => node.style.top), '16px'); assert.equal(await floatingHost.evaluate(node => node.style.right), '16px');
    await setCollectionControls({ floatingPosition: 'bottom-left' });
    await floatingSource.waitForFunction(() => document.querySelector('[data-bootcat-floating-control]')?.style.left === '16px' && document.querySelector('[data-bootcat-floating-control]')?.style.bottom === '16px');
    let floatingBox = await floatingHost.boundingBox(); await floatingSource.mouse.click(floatingBox.x + 55, floatingBox.y + 20);
    await page.waitForFunction(() => [...document.querySelectorAll('#results a')].some(link => link.href === 'https://corpus.test/floating-original'));
    assert.equal(floatingSource.isClosed(), false);
    assert.equal(await page.evaluate(async () => {
      const { project } = await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' });
      const store = await import('./project-store.js'), saved = await store.readDownloadTarget(project.id, 'https://corpus.test/floating-original');
      return (await (await store.readOriginal(project.id, saved.entry.doc.filename)).text()).includes('data-bootcat-floating-control');
    }), false);
    await floatingHost.waitFor({ state: 'hidden' });
    async function popupFor(tab) {
      await tab.bringToFront(); const created = context.waitForEvent('page');
      await page.evaluate(() => (globalThis.browser ?? chrome).tabs.create({ url: (globalThis.browser ?? chrome).runtime.getURL('popup.html'), active: false }));
      const popup = await created; await popup.waitForFunction(() => !document.querySelector('#show-floating-controls').disabled); return popup;
    }
    const closeSource = await context.newPage(); await closeSource.goto('https://corpus.test/floating-close');
    await closeSource.locator('[data-bootcat-floating-control]').waitFor();
    const capturePopup = await popupFor(closeSource);
    await capturePopup.locator('#capture-action').waitFor(); await capturePopup.check('#close-captured-tab');
    await capturePopup.waitForFunction(() => !document.querySelector('#close-captured-tab').disabled && !document.querySelector('#close-collected-tab').disabled && document.querySelector('#controls-feedback').textContent === '');
    await capturePopup.selectOption('#floating-position', 'top-right');
    await capturePopup.waitForFunction(() => !document.querySelector('#floating-position').disabled);
    await page.locator('#review-section .workspace-panel').evaluate(panel => { panel.open = false; });
    const sourceClosed = closeSource.waitForEvent('close'); await capturePopup.click('#save-page'); await capturePopup.close(); await sourceClosed;
    await page.waitForFunction(() => [...document.querySelectorAll('#results a')].some(link => link.href === 'https://corpus.test/floating-close'));
    assert.equal(await page.locator('#review-section .workspace-panel').evaluate(panel => panel.open), true);
    const currentProject = await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' })).project.id);
    const trackedCreated = context.waitForEvent('page');
    await page.evaluate(projectId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'open-project-search', projectId, engine: 'duckduckgo', query: 'collection-controls', active: false }), currentProject);
    const trackedSource = await trackedCreated; await trackedSource.waitForLoadState('domcontentloaded');
    await waitProjectTabsReady(1);
    const collectPopup = await popupFor(trackedSource); await collectPopup.locator('#collect-action').waitFor(); await collectPopup.check('#close-collected-tab');
    await collectPopup.waitForFunction(() => !document.querySelector('#close-captured-tab').disabled && !document.querySelector('#close-collected-tab').disabled && document.querySelector('#controls-feedback').textContent === '');
    const searchClosed = trackedSource.waitForEvent('close'); await collectPopup.click('#collect'); await searchClosed; await collectPopup.close();
    assert.equal(await page.evaluate(async projectId => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project-search-tabs', projectId })).history.find(item => item.query === 'collection-controls')?.status, currentProject), 'collected');
    // Real worker/popup/content-script agreement on a same-URL DDG update.
    await setCollectionControls({ closeCollectedTab: false });
    const ddgHTML = await readFile(join(process.cwd(), 'tests/fixtures/duckduckgo-populated.html'), 'utf8');
    await context.route('https://duckduckgo.com/**', route => route.fulfill({contentType:'text/html',body:ddgHTML}));
    const dynamicDDG = await context.newPage(); await dynamicDDG.goto('https://duckduckgo.com/?q=sepalo+stame+petalo&ia=web');
    const dynamicHost = dynamicDDG.locator('[data-bootcat-floating-control]'); await dynamicHost.waitFor();
    const ddgTabId = await page.evaluate(async () => (await (globalThis.browser ?? chrome).tabs.query({})).find(tab => tab.url === 'https://duckduckgo.com/?q=sepalo+stame+petalo&ia=web').id);
    const collectDDG = () => page.evaluate(({projectId,tabId}) => (globalThis.browser ?? chrome).runtime.sendMessage({type:'collect',projectId,tabId}),{projectId:currentProject,tabId:ddgTabId});
    let ddgResult = await collectDDG(); assert.equal(ddgResult.ok,true); assert.equal(ddgResult.count,10); assert.equal(ddgResult.unresolved,0);
    await dynamicHost.waitFor({state:'hidden'});
    let ddgPopup = await popupFor(dynamicDDG); await ddgPopup.locator('#feedback.saved').waitFor(); await ddgPopup.close();
    await dynamicDDG.evaluate(() => { const a = document.createElement('a'); a.dataset.testid='result-title-a'; a.href='https://corpus.test/ddg-appended'; a.textContent='Appended result'; document.querySelector('main').append(a); });
    await dynamicHost.waitFor();
    ddgPopup = await popupFor(dynamicDDG); await ddgPopup.locator('#collect-action').waitFor(); assert.equal(await ddgPopup.locator('#collect').isEnabled(),true); await ddgPopup.close();
    ddgResult = await collectDDG(); assert.equal(ddgResult.count,11); assert.equal(ddgResult.added,1); await dynamicHost.waitFor({state:'hidden'});
    await dynamicDDG.evaluate(() => { const a=document.createElement('a'); a.dataset.testid='result-title-a'; a.href='/l/?opaque=unknown'; a.textContent='Unresolved'; document.querySelector('main').append(a); });
    await dynamicHost.waitFor(); ddgResult=await collectDDG(); assert.equal(ddgResult.unresolved,1); assert.equal(dynamicDDG.isClosed(),false);
    assert.equal(await dynamicHost.isVisible(),true,'unaccepted partial collection retains floating control');
    ddgPopup=await popupFor(dynamicDDG); await ddgPopup.locator('#continue-collected').waitFor(); await ddgPopup.close();
    await page.evaluate(projectId => (globalThis.browser ?? chrome).runtime.sendMessage({type:'accept-collected-results',projectId,pageURL:'https://duckduckgo.com/?q=sepalo+stame+petalo&ia=web'}), currentProject);
    await dynamicHost.waitFor({state:'hidden'});
    await dynamicDDG.evaluate(() => { history.pushState({},'',location.href+'&s=10'); document.body.append(document.createElement('p')); });
    await dynamicHost.waitFor(); await dynamicDDG.close();
    // An empty page stays unresolved until a user explicitly records the outcome.
    await page.locator('nav a[href="#seeds-section"]').click(); await page.fill('#tuples','manual-empty');
    await page.click('#prepare-queries'); await page.selectOption('#engine','duckduckgo');
    const manualQuery=await page.locator('#prepared-queries a').innerText();
    const emptyCreated=context.waitForEvent('page'); await clickConfirmed('#open-all-queries'); const emptyTab=await emptyCreated;
    await emptyTab.waitForLoadState('domcontentloaded'); await waitProjectTabsReady(1);
    await page.click('#collect-project-tabs');
    await page.getByRole('button',{name:'Mark as no results',exact:true}).waitFor();
    assert.equal(emptyTab.isClosed(),false);
    assert.equal(await page.getByRole('button',{name:'Mark as no results',exact:true}).evaluate(button=>button.previousElementSibling?.classList.contains('query-tab-status') && button.nextElementSibling?.getAttribute('aria-label')==='Open search tab'),true);
    await page.getByRole('button',{name:'Mark as no results',exact:true}).click();
    await page.locator('.query-tab-status[data-status="no-results"]').waitFor();
    assert.equal(await page.locator('#open-all-queries').isDisabled(),true);
    assert.equal(await page.evaluate(async projectId => (await (globalThis.browser??chrome).runtime.sendMessage({type:'get-project-search-tabs',projectId})).count,currentProject),0);
    const emptyPopup=await popupFor(emptyTab); await emptyPopup.locator('#rerun-no-results').waitFor();
    assert.match(await emptyPopup.locator('#feedback').innerText(),/No results \(marked manually\)/);
    const rerunCreated=context.waitForEvent('page'); await emptyPopup.click('#rerun-no-results'); const rerunTab=await rerunCreated;
    await rerunTab.waitForLoadState('domcontentloaded'); assert.notEqual(rerunTab,emptyTab); assert.equal(emptyTab.isClosed(),false);
    await page.waitForFunction(async query => !(await (globalThis.browser??chrome).storage.local.get('collections')).collections.some(item=>item.status==='no-results' && item.query===query),manualQuery);
    await rerunTab.close(); await emptyTab.close();
    // Also exercise the real content-script mark action on an untracked page.
    await context.route('https://duckduckgo.com/?q=manual-floating-empty',route=>route.fulfill({contentType:'text/html',body:'<title>Empty search fixture</title><p>No results found</p>'}));
    const floatingEmpty=await context.newPage(); await floatingEmpty.goto('https://duckduckgo.com/?q=manual-floating-empty');
    const emptyHost=floatingEmpty.locator('[data-bootcat-floating-control]'); await emptyHost.waitFor();
    const emptyBox=await emptyHost.boundingBox(); await floatingEmpty.mouse.click(emptyBox.x+55,emptyBox.y+20);
    const emptyAX=await context.newCDPSession(floatingEmpty);
    for(let attempt=0;attempt<100;attempt++) {
      const tree=await emptyAX.send('Accessibility.getFullAXTree');
      if(tree.nodes.some(node=>node.role?.value==='button'&&node.name?.value==='Mark as no results')) break;
      if(attempt===99) assert.fail('empty floating collection must offer a manual outcome');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await floatingEmpty.keyboard.press('Tab'); await floatingEmpty.keyboard.press('Tab'); await floatingEmpty.keyboard.press('Tab'); await floatingEmpty.keyboard.press('Enter');
    await page.waitForFunction(async () => (await (globalThis.browser??chrome).storage.local.get('collections')).collections.some(item=>item.status==='no-results'&&item.query==='manual-floating-empty'));
    assert.equal(floatingEmpty.isClosed(),false); await emptyHost.waitFor({state:'hidden'}); await emptyAX.detach(); await floatingEmpty.close();
    console.log('Manual empty outcome, batch skipping, persisted query status, popup rerun and floating action passed.');
    await setCollectionControls({closeCollectedTab:true});
    console.log('DDG live-DOM replay, same-URL additions, popup/floating agreement, partial acceptance and pagination passed.');
    const floatingKeep = await context.newPage(); await floatingKeep.goto('https://corpus.test/floating-keep');
    await floatingKeep.locator('[data-bootcat-floating-control]').waitFor();
    floatingBox = await floatingKeep.locator('[data-bootcat-floating-control]').boundingBox();
    await floatingKeep.mouse.click(floatingBox.x + floatingBox.width - 20, floatingBox.y + 20);
    await floatingKeep.locator('[data-bootcat-floating-control]').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-collection-controls' })).preferences.floatingEnabled), false);
    await setCollectionControls({ floatingEnabled: true }); await floatingKeep.locator('[data-bootcat-floating-control]').waitFor();
    console.log('Floating controls, corner preference, popup switches, durable capture before closure and tracked collection closure passed.');
    // Save/open through the native picker and the real extension worker.
    await page.waitForFunction(() => !document.querySelector('#open-project').disabled);
    const portableEngine = await page.inputValue('#engine');
    const personalEngine = portableEngine === 'ecosia' ? 'google' : 'ecosia';
    await page.evaluate(async engine => {
      const ext = globalThis.browser ?? chrome;
      const current = (await ext.runtime.sendMessage({ type: 'get-settings' })).settings;
      const reply = await ext.runtime.sendMessage({ type: 'save-settings', values: { ...current.values, defaultEngine: engine }, revision: current.revision });
      if (!reply.ok) throw new Error(reply.error);
    }, personalEngine);
    const portableDownload = page.waitForEvent('download'); await page.click('#save-project');
    const portableFile = join(root, 'complete.bootcat'); await (await portableDownload).saveAs(portableFile);
    execFileSync('python3', ['-c', "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; p=json.loads(z.read('project.json')); assert p['format']=='BootCaTProject' and p['version']==1; assert any(n.startswith('originals/') for n in z.namelist())", portableFile]);
    await page.waitForFunction(() => document.querySelector('#project-save-feedback').classList.contains('saved'));
    assert.equal(await page.locator('#save-project').isDisabled(), true);
    assert.match(await page.locator('#project-file-status').innerText(), /Project download started:.*\.bootcat/);
    const retryDownload = page.waitForEvent('download'); await page.click('#project-download-again');
    await (await retryDownload).saveAs(join(root, 'retry.bootcat'));
    await page.waitForFunction(() => document.querySelector('#project-save-feedback').classList.contains('saved'));
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelector('#project-save-feedback').classList.contains('saved') && document.querySelector('#save-project').disabled);
    const beforePortable = await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' })).project.id);
    let projectChooser = page.waitForEvent('filechooser'); await page.click('#open-project');
    await (await projectChooser).setFiles({ name: 'damaged.bootcat', mimeType: 'application/zip', buffer: Buffer.from('damaged project') });
    await page.waitForFunction(() => document.querySelector('#project-file-status').textContent.startsWith('Could not open project'));
    assert.equal(await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' })).project.id), beforePortable);
    await page.fill('#urls', 'https://corpus.test/unsaved-after-snapshot');
    await page.waitForFunction(() => !document.querySelector('#save-project').disabled);
    projectChooser = page.waitForEvent('filechooser'); await page.click('#open-project'); await (await projectChooser).setFiles(portableFile);
    await page.locator('#project-replace-dialog[open]').waitFor(); await page.click('#project-replace-dialog button[value=cancel]');
    assert.equal(await page.inputValue('#urls'), 'https://corpus.test/unsaved-after-snapshot');
    await page.waitForFunction(() => !document.querySelector('#open-project').disabled);
    projectChooser = page.waitForEvent('filechooser'); await page.click('#open-project'); await (await projectChooser).setFiles(portableFile);
    await page.locator('#project-replace-dialog[open]').waitFor();
    const saveBeforeReplace = page.waitForEvent('download'); await page.click('#project-replace-save'); await (await saveBeforeReplace).saveAs(join(root, 'before-replacement.bootcat'));
    await page.waitForFunction(() => !document.querySelector('#project-replace-continue').disabled);
    await page.click('#project-replace-continue');
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'Saved defaults' && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await assertCollapsed(); await openPanels();
    const afterPortable = await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project' })).project.id);
    assert.notEqual(afterPortable, beforePortable);
    await page.waitForFunction(async () => await (globalThis.browser ?? chrome).action.getBadgeText({}) === '');
    assert.equal(await page.locator('#download-feedback-strip').isVisible(), false, 'portable imports do not replay download feedback');
    assert.equal(await page.inputValue('#engine'), portableEngine, 'opening a portable project preserves its selected engine');
    assert.equal(await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-settings' })).settings.values.defaultEngine), personalEngine, 'opening a project preserves personal defaults');
    assert.equal((await page.inputValue('#urls')).includes('unsaved-after-snapshot'), false);
    assert.equal(await page.locator('#results a[href="https://corpus.test/floating-original"]').count(), 1);
    const restoredTracking = await page.evaluate(async projectId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-project-search-tabs', projectId }), afterPortable);
    assert.equal(restoredTracking.tabs.length, 0); assert.ok(restoredTracking.history.some(r => r.query === 'collection-controls' && r.status === 'collected'));
    console.log('Native portable project save/open, validation before replacement, cancellation, save-first and collected-query restoration passed.');
    await page.fill('#urls', Array.from({ length: 501 }, (_, i) => `https://corpus.test/large/${i}`).join('\n'));
    await waitForSavedDraft();
    assert.match(await page.locator('#urls-warning').innerText(), /501 URLs/);
    assert.equal(await page.locator('#urls-counter').innerText(), '501 URLs');
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelector('#urls').value.split('\n').length === 501 && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.match(await page.locator('#urls-warning').innerText(), /501 URLs/);
    assert.equal(await page.locator('#urls-counter').innerText(), '501 URLs');
    // Lifecycle closure propagates to other workspace windows and retains defaults.
    const secondWorkspace = await context.newPage(); await secondWorkspace.goto(origin + '/downloader.html');
    await secondWorkspace.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await page.bringToFront();
    await clickConfirmed('#close-project', false);
    assert.equal(await page.inputValue('#project-name'), 'Saved defaults');
    assert.equal(await page.locator('#save-project').isDisabled(), false);
    await clickConfirmed('#close-project');
    await floatingKeep.locator('[data-bootcat-floating-control]').waitFor({ state: 'hidden' });
    for (const workspace of [page, secondWorkspace]) {
      await workspace.waitForFunction(() => document.querySelector('#project-status').textContent.startsWith('No active project'));
      assert.equal(await workspace.locator('#project-section .workspace-panel').evaluate(panel => panel.open), true);
      assert.equal(await workspace.locator('.workspace-panel[open]').count(), 1);
      assert.equal(await workspace.locator('#close-project').isVisible(), false);
      assert.equal(await workspace.locator('#start').isDisabled(), true);
      assert.equal(await workspace.inputValue('#urls'), '');
      await workspace.locator('#project-choice-dialog[open]').waitFor();
      assert.equal(await workspace.locator('#project-choice-close').isVisible(), true);
    }
    const inactivePopup = await context.newPage(); await inactivePopup.goto(origin + '/popup.html');
    await inactivePopup.waitForFunction(() => document.querySelector('#popup-status').textContent.includes('Create a project'));
    assert.equal(await inactivePopup.locator('#collect-action, #capture-action').evaluateAll(items => items.every(item => item.hidden)), true);
    await inactivePopup.close();
    const workspaceClosed = secondWorkspace.waitForEvent('close');
    await secondWorkspace.click('#project-choice-close'); await workspaceClosed;
    assert.equal(page.isClosed(), false, 'Close BootCaT closes only its own workspace');
    await page.bringToFront();
    const inactiveOpen = page.waitForEvent('filechooser'); await page.click('#project-choice-open'); await (await inactiveOpen).setFiles(portableFile);
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'Saved defaults' && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await assertCollapsed(); await openPanels();
    await clickConfirmed('#close-project'); await page.locator('#project-choice-dialog[open]').waitFor();
    await page.click('#project-choice-new'); await page.fill('#project-dialog-name', 'After closing');
    await page.selectOption('#project-dialog-language', 'none'); await submitProject();
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'After closing' && !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    await assertCollapsed(); await openPanels(); await openSearchOptions();
    assert.equal(await page.inputValue('#excluded-sites'), 'youtube.com\nfacebook.com\nexample.org');
    assert.equal(await page.inputValue('#urls'), '');
    assert.equal(await page.locator('#review-lists tbody tr').count(), 0);
    await floatingKeep.locator('[data-bootcat-floating-control]').waitFor();
    const keptControls = await page.evaluate(async () => (await (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-collection-controls' })).preferences);
    assert.equal(keptControls.closeCollectedTab, true); assert.equal(keptControls.closeCapturedTab, true); assert.equal(keptControls.floatingPosition, 'top-right');
    await setCollectionControls({ floatingEnabled: false }); await floatingKeep.locator('[data-bootcat-floating-control]').waitFor({ state: 'hidden' });
    await floatingKeep.close(); await floatingSource.close();
    assert.equal(await page.inputValue('#engine'), personalEngine, 'later new projects inherit the saved personal engine');
    await page.selectOption('#engine', 'google'); await page.fill('#tuples', 'language preference test'); await page.click('#prepare-queries');
    await page.selectOption('#project-language', 'ita');
    await page.waitForFunction(() => new URL(document.querySelector('#prepared-queries a').href).searchParams.get('lr') === 'lang_it');
    assert.equal((await page.locator('#prepared-queries a').innerText()).includes('lang_it'), false);
    const italianCreated = context.waitForEvent('page'); await clickConfirmed('#open-all-queries');
    const italianSearch = await italianCreated; await italianSearch.waitForLoadState('domcontentloaded');
    assert.equal(new URL(italianSearch.url()).searchParams.get('lr'), 'lang_it');
    for (const name of ['gl', 'cr', 'hl', 'kl']) assert.equal(new URL(italianSearch.url()).searchParams.has(name), false);
    await waitProjectTabsReady(1); const italianClosed = italianSearch.waitForEvent('close'); await page.click('#collect-project-tabs'); await italianClosed;
    await page.waitForFunction(() => document.querySelector('#open-all-queries').disabled);
    await page.selectOption('#project-language', 'fra');
    await page.waitForFunction(() => new URL(document.querySelector('#prepared-queries a').href).searchParams.get('lr') === 'lang_fr' && !document.querySelector('#open-all-queries').disabled);
    await page.selectOption('#project-language', 'ita');
    await page.waitForFunction(() => document.querySelector('#open-all-queries').disabled);
    await page.selectOption('#project-language', 'none');
    await page.waitForFunction(() => !new URL(document.querySelector('#prepared-queries a').href).searchParams.has('lr'));
    await page.selectOption('#engine', 'duckduckgo'); await page.selectOption('#project-language', 'ita');
    await page.waitForFunction(() => !document.querySelector('#urls').disabled && !document.querySelector('#open-project').disabled);
    assert.equal(new URL(await page.locator('#prepared-queries a').getAttribute('href')).searchParams.has('kl'), false);
    console.log('Google-only language URLs, language-specific collection history and live project-language changes passed.');
    // Unreadable Google links use identical guidance through popup and floating actions.
    const googleMessage = 'BootCaT can’t read Google’s result links. Try signing in to Google and running the search again, or switch to a different search engine.';
    await context.route('https://www.google.com/search**', route => route.fulfill({ contentType: 'text/html', body: '<div id="search">' + Array.from({ length: 8 }, (_, i) => `<a href="/goto?url=opaque-${i}"><h3>Unreadable result</h3></a>`).join('') + '</div>' }));
    await setCollectionControls({ floatingEnabled: true, closeCollectedTab: false });
    const opaquePage = await context.newPage(); await opaquePage.goto('https://www.google.com/search?q=bootcat-opaque');
    const opaquePopup = await popupFor(opaquePage); await opaquePopup.click('#collect');
    await opaquePopup.waitForFunction(message => document.querySelector('#feedback').textContent === message, googleMessage); assert.equal(await opaquePopup.locator('#mark-no-results').isVisible(),false); await opaquePopup.close();
    await opaquePage.bringToFront(); const opaqueHost = opaquePage.locator('[data-bootcat-floating-control]'); await opaqueHost.waitFor();
    const opaqueBox = await opaqueHost.boundingBox(); await opaquePage.mouse.click(opaqueBox.x + 55, opaqueBox.y + 20);
    const accessibility = await context.newCDPSession(opaquePage);
    let readableFeedback = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const tree = await accessibility.send('Accessibility.getFullAXTree');
      if (tree.nodes.some(node => node.name?.value === googleMessage)) { readableFeedback = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(readableFeedback, true, 'floating errors must show the same Google guidance');
    await accessibility.detach(); await opaquePage.close();
    // Real DOM challenge pages retain a pending resource, so browser status stays loading.
    await page.bringToFront(); await page.selectOption('#engine', 'ecosia');
    await page.fill('#tuples', 'challenge-one\nchallenge-two\nchallenge-good'); await page.click('#prepare-queries');
    await clickConfirmed('#open-all-queries');
    await page.waitForFunction(async () => { const ext = globalThis.browser ?? chrome; const { project } = await ext.runtime.sendMessage({ type: 'get-project' }); const state = await ext.runtime.sendMessage({ type: 'get-project-search-tabs', projectId: project.id }); return state.blocked === 2 && state.loading === 0 && state.loaded === 1; });
    await page.click('#collect-project-tabs');
    try {
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('0 of 2') && document.querySelector('#stop-project-tabs').hidden);
    } catch (error) {
      console.log('Challenge batch diagnostics:', JSON.stringify(await page.evaluate(async () => { const ext = globalThis.browser ?? chrome; const { project } = await ext.runtime.sendMessage({ type: 'get-project' }); return { state: await ext.runtime.sendMessage({ type: 'get-project-search-tabs', projectId: project.id }), count: document.querySelector('#project-tab-count').textContent, status: document.querySelector('#project-tab-status').textContent }; })));
      throw error;
    }
    const blockedPages = context.pages().filter(tab => tab.url().startsWith(pdfOrigin + '/ecosia-fixture'));
    assert.equal(blockedPages.length, 2); assert.equal(await page.locator('#collect-project-tabs').isDisabled(), true);
    await blockedPages[0].evaluate(() => { document.cookie = 'bootcat_unlocked=1; Path=/'; });
    await page.waitForFunction(async () => { const ext = globalThis.browser ?? chrome; const { project } = await ext.runtime.sendMessage({ type: 'get-project' }); const state = await ext.runtime.sendMessage({ type: 'get-project-search-tabs', projectId: project.id }); return state.blocked === 0 && state.loaded === 2; });
    assert.ok(blockedPages.every(tab => !tab.isClosed()), 'unlocking must not collect or close sibling tabs');
    const closedChallenges = blockedPages.map(tab => tab.waitForEvent('close')); await page.click('#collect-project-tabs'); await Promise.all(closedChallenges);
    console.log('Project download feedback/retry, shared Google guidance, loading challenge detection and sibling recovery passed.');
    const partialPage = await context.newPage(); await partialPage.goto(pdfOrigin + '/search-fixture?q=partial');
    const partialPopup = await popupFor(partialPage); await partialPopup.click('#collect');
    await partialPopup.locator('#continue-collected').waitFor();
    assert.match(await partialPopup.locator('#feedback').innerText(), /1 URL added to your project/);
    await page.locator('#urls-section .workspace-panel, #review-section .workspace-panel').evaluateAll(panels => panels.forEach(panel => { panel.open = false; }));
    const partialPopupClosed = partialPopup.waitForEvent('close'); await partialPopup.click('#continue-collected'); await partialPopupClosed;
    await page.waitForFunction(() => document.querySelector('#urls-section details').open && document.querySelector('#review-section details').open);
    assert.equal(partialPage.isClosed(), false);
    const partialAccepted = await page.evaluate(async () => ((await (globalThis.browser ?? chrome).storage.local.get('collections')).collections).find(item => item.pageURL.includes('q=partial')));
    assert.equal(partialAccepted.acceptedPartial, true);
    const reopenedPartial = await popupFor(partialPage);
    await reopenedPartial.locator('#review-urls').waitFor(); assert.equal(await reopenedPartial.locator('#collect').isDisabled(), true); await reopenedPartial.close();
    const partialFloating = await context.newPage(); await partialFloating.goto(pdfOrigin + '/search-fixture?q=partial&case=floating');
    const partialHost = partialFloating.locator('[data-bootcat-floating-control]'); await partialHost.waitFor();
    const partialBox = await partialHost.boundingBox(); await partialFloating.mouse.click(partialBox.x + 55, partialBox.y + 20);
    const partialAX = await context.newCDPSession(partialFloating);
    for (let attempt = 0; attempt < 100; attempt++) {
      const tree = await partialAX.send('Accessibility.getFullAXTree');
      if (tree.nodes.some(node => node.role?.value === 'button' && node.name?.value === 'Continue with collected URLs')) break;
      if (attempt === 99) assert.fail('floating partial results must offer Continue');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await partialFloating.keyboard.press('Tab'); await partialFloating.keyboard.press('Tab'); await partialFloating.keyboard.press('Enter');
    await page.waitForFunction(async () => (await (globalThis.browser ?? chrome).storage.local.get('collections')).collections.some(item => item.pageURL.includes('case=floating') && item.acceptedPartial));
    assert.equal(partialFloating.isClosed(), false); await partialAX.detach();
    assert.ok((await page.locator('#queries-counter').innerText()).includes('3 queries'));
    assert.equal(await page.locator('#build-counter').innerText(), await page.locator('#included-count').innerText());
    assert.equal(await page.locator('.brand img').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    await partialPage.close(); await partialFloating.close();
    console.log('Counted partial results, explicit acceptance, popup/floating review actions and persistent heading counters passed.');

    assert.deepEqual(errors, []);
    console.log('Inactive state, initial cancellation, project closure across windows and preference retention passed.');
    console.log('Workspace reuse, saved-search persistence and zero page errors passed.');
  } finally { await context?.close(); if (pdfServer) await new Promise(resolve => pdfServer.close(resolve)); await rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

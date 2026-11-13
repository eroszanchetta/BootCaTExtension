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
    const pendingSearchResponses = new Map(), resolvedQueries = new Set();
    pdfServer = createServer((request, response) => {
      if (request.url.startsWith('/search-fixture')) {
        const query = new URL(request.url, 'http://fixture').searchParams.get('q') || '';
        const body = query === 'captcha' && !resolvedQueries.has(query) ? '<h1>CAPTCHA required</h1>' : `<a data-testid="result-title-a" href="https://corpus.test/search?q=${encodeURIComponent(query)}">Local result</a>${query === 'partial' ? '<a data-testid="result-title-a" href="https://duckduckgo.com/l/?opaque=1">Unresolved link</a>' : ''}`;
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
      .replace('const url = new URL(value);', `const url = new URL(value);\n    if (url.origin === '${pdfOrigin}' && url.pathname === '/search-fixture' && url.searchParams.get('q')) return ENGINES.find(engine => engine.id === 'duckduckgo');`)
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
    const assertCollapsed = async () => assert.equal(await page.locator('.workspace-panel[open]').count(), 0);
    async function checkCorpusReport(zipPath, language = 'Not checked') {
      execFileSync('python3', ['-c', `
import sys,json,zipfile,io,xml.etree.ElementTree as E
n={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
 assert not any('/captured/' in name for name in z.namelist())
 docs=sorted([d for d in json.loads(z.read('extraction.json'))['documents'] if d.get('textFilename')],key=lambda d:d['textFilename'])
 for name in ['results.json','extraction.json','searches.json']:
  assert json.loads(z.read(name))['version']==sys.argv[3]
 draft=json.loads(z.read('project.json'))['draft']
 for name,field in [('url_list.txt','urls'),('seeds.txt','seeds'),('tuples.txt','tuples')]:
  assert z.read(name).decode('utf-8')==draft.get(field,'')
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
 assert values[0]==['Text file name','Source URL','Characters','Detected language']
 assert values[1:]==[[d['textFilename'].removeprefix('corpus/'),d['url'],d['characters'],sys.argv[2]] for d in docs]
 assert sheet.find('m:sheetViews/m:sheetView/m:pane',n).attrib['state']=='frozen'
`, zipPath, language, releaseVersion]);
    }

    await page.locator('#project-dialog[open]').waitFor();
    await page.selectOption('#project-dialog-language', 'none'); await page.fill('#project-dialog-name', 'First corpus'); await page.click('#project-dialog-submit');
    await page.locator('#project-dialog[open]').waitFor({ state: 'hidden' });
    await assertCollapsed();
    assert.equal(await page.locator('.workspace-panel').count(), 6);
    assert.equal(await page.locator('#export-metadata, #metadata-export-status').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('#review-section .panel-content').lastElementChild.classList.contains('corpus-export')), true);
    assert.equal(await page.locator('#search-form').count(), 0);
    await page.locator('nav a[href="#seeds-section"]').click();
    assert.equal(await page.locator('#seeds-section .workspace-panel').getAttribute('open'), '');
    await openPanels();
    assert.equal(await page.inputValue('#excluded-sites'), 'youtube.com\nfacebook.com\ninstagram.com\namazon.com');
    await page.fill('#excluded-sites', '');
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('0 unique URLs'));
    const dialogMessages = [];
    page.on('dialog', dialog => {
      if (dialog.type() === 'beforeunload') return dialog.accept();
      errors.push('Unexpected browser dialog: ' + dialog.message()); return dialog.dismiss();
    });
    async function clickConfirmed(selector, accept = true) {
      await page.click(selector); await page.locator('#confirmation-dialog[open]').waitFor();
      dialogMessages.push(await page.locator('#confirmation-message').innerText());
      assert.equal(await page.locator('#confirmation-cancel').evaluate(button => button === document.activeElement), true);
      if (accept === 'escape') await page.keyboard.press('Escape');
      else await page.click(accept ? '#confirmation-accept' : '#confirmation-cancel');
      await page.locator('#confirmation-dialog[open]').waitFor({ state: 'hidden' });
    }
    const navNames = await page.locator('nav a').allTextContents();
    assert.equal(navNames.at(-2), 'Log'); assert.equal(navNames.at(-1), 'Help');
    await page.locator('nav a[href="#log-section"]').click();
    assert.equal(await page.locator('#log-section .workspace-panel').getAttribute('open'), '');
    assert.equal(await page.locator('#log-section #save-searches, #log-section #project-tab-details, #log-section #collected-results').count(), 3);
    assert.equal(await page.evaluate(() => document.querySelector('[aria-labelledby="project-heading"]').nextElementSibling.id), 'seeds-section');
    assert.equal(await page.inputValue('#tuple-length'), '3');
    assert.equal(await page.locator('#generate-tuples').isDisabled(), true);
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
    await page.waitForFunction(() => document.querySelector('#storage-status').textContent.startsWith('Saved in this browser'));
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
    await page.waitForFunction(() => document.querySelector('#prepared-queries .query-tab-status').dataset.status === 'collected');
    assert.equal(await page.locator('#prepared-queries li').first().evaluate(row =>
      row.children[0].classList.contains('query-tab-status') && row.children[1].classList.contains('query-tab-action') && row.children[2].tagName === 'A'), true);
    assert.equal(await page.locator('#prepared-queries .query-tab-action').first().getAttribute('aria-label'), 'Open search tab');
    assert.equal(await page.locator('#prepared-queries .query-tab-action').first().innerText(), '');
    assert.equal(await page.locator('#prepared-queries .query-tab-action svg').count(), 2);
    await individual.close(); await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('0 of 0'));
    assert.match(await page.locator('#prepared-queries .query-tab-status').first().innerText(), /Collected/);
    console.log('Leading badge/open icon, popup collection status and manual-close retention passed.');
    await clickConfirmed('#open-all-queries', false);
    assert.equal(context.pages().length, tabCount); assert.ok(dialogMessages.at(-1).includes('refuse automated batch queries'));
    const batchPages = [], recordQueryPage = tab => batchPages.push(tab); context.on('page', recordQueryPage);
    const allBatchCreated = context.waitForEvent('page', { predicate: () => batchPages.length >= 2 });
    await clickConfirmed('#open-all-queries');
    await allBatchCreated;
    await page.waitForFunction(() => document.querySelector('#query-status').textContent.startsWith('2 of 2 search tabs opened'));
    await Promise.all(batchPages.map(tab => tab.waitForLoadState('domcontentloaded'))); context.off('page', recordQueryPage);
    assert.equal(batchPages.length, 2);
    // Playwright can attach to newly created tabs in either order.
    assert.deepEqual(batchPages.map(tab => new URL(tab.url()).searchParams.get('q')).sort(), ['"custom phrase" energy', 'storage generation'].sort());
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
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('2 of 2 project search tabs loaded.'));
    await waitProjectTabsReady(2);
    await page.locator('#urls-section .workspace-panel').evaluate(panel => { panel.open = false; });
    const closedBatchPages = batchPages.map(tab => tab.waitForEvent('close'));
    await page.click('#collect-project-tabs'); await Promise.all(closedBatchPages);
    await page.waitForFunction(() => document.querySelector('#project-tab-status').textContent.startsWith('Finished.') && !document.querySelector('#project-tab-status').textContent.includes('0 tabs closed'));
    assert.match(await page.locator('#project-tab-status').innerText(), /2 result pages saved; 2 tabs closed/);
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector('#urls-section .workspace-panel').open);
    assert.equal(unrelatedSearch.isClosed(), false);
    await page.waitForFunction(() => document.querySelector('#urls').value.split('\n').filter(Boolean).length === 2);
    assert.ok(!(await page.inputValue('#urls')).includes('unrelated'));
    const pagesAfterCollection = context.pages().length;
    await clickConfirmed('#open-all-queries', 'escape');
    assert.equal(context.pages().length, pagesAfterCollection);
    const savedSearchDownload = page.waitForEvent('download'); await page.click('#save-searches');
    const savedSearchPath = join(root, 'saved-searches.json'); await (await savedSearchDownload).saveAs(savedSearchPath);
    const savedSearchJSON = JSON.parse(await readFile(savedSearchPath, 'utf8'));
    assert.equal(savedSearchJSON.results.length, 2); assert.equal(savedSearchJSON.version, releaseVersion);
    await clickConfirmed('#clear-searches', false);
    assert.equal(await page.locator('#collected-results tr').count(), 2);
    console.log('Styled confirmations, Escape cancellation, Log navigation and search JSON export passed.');

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
    await page.locator('#prepared-queries .query-tab-action').first().click(); await page.bringToFront();
    await page.click('#collect-project-tabs');
    await page.waitForFunction(() => document.querySelector('#prepared-queries .query-tab-status').dataset.status === 'collected' && document.querySelector('#project-tab-status').textContent.startsWith('Finished.'));
    assert.equal(await page.locator('#collect-project-tabs').isDisabled(), true);
    console.log('Loading indicators, manual closure, loaded-only readiness, focus and collected query history passed.');
    await page.fill('#tuples', 'captcha\npartial\nmoved'); await page.click('#prepare-queries');
    const troublePages = [], recordTrouble = tab => troublePages.push(tab); context.on('page', recordTrouble);
    const troubleReady = context.waitForEvent('page', { predicate: () => troublePages.length >= 3 });
    await clickConfirmed('#open-all-queries'); await troubleReady;
    await Promise.all(troublePages.map(tab => tab.waitForLoadState('domcontentloaded'))); context.off('page', recordTrouble);
    await page.waitForFunction(() => document.querySelector('#query-status').textContent.startsWith('3 of 3 search tabs opened'));
    const movedPage = troublePages.find(tab => new URL(tab.url()).searchParams.get('q') === 'moved'); await movedPage.goto(pdfOrigin + '/login');
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#project-tab-count').textContent.startsWith('2 of 2 project search tabs loaded.'));
    await waitProjectTabsReady(2);
    await page.click('#collect-project-tabs');
    await page.waitForFunction(() => document.querySelector('#project-tab-status').textContent.startsWith('Finished.') && document.querySelector('#project-tab-status').textContent.includes('1 result page saved; 0 tabs closed'));
    assert.ok(troublePages.every(tab => !tab.isClosed())); assert.equal(unrelatedSearch.isClosed(), false);
    await page.locator('summary').filter({ hasText: 'Project tab collection details' }).click();
    assert.match(await page.locator('#project-tab-details').innerText(), /CAPTCHA/);
    assert.match(await page.locator('#project-tab-details').innerText(), /Partial results saved/);
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

    const urlsBeforeClearing = await page.inputValue('#urls');
    await clickConfirmed('#clear-searches');
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('0 unique URLs'));
    assert.equal(await page.inputValue('#urls'), urlsBeforeClearing);
    await page.click('#new-project');
    await page.selectOption('#project-dialog-language', 'none'); await page.fill('#project-dialog-name', 'Tab reset project'); await page.click('#project-dialog-submit');
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('0 unique URLs') && document.querySelector('#project-tab-count').textContent.startsWith('0 of 0 project search tabs loaded.'));
    await assertCollapsed(); await openPanels();
    await page.fill('#excluded-sites', '');
    assert.ok(troublePages.filter(tab => tab !== captchaPage).every(tab => !tab.isClosed())); assert.equal(unrelatedSearch.isClosed(), false);
    for (const tab of [...troublePages, unrelatedSearch].filter(tab => !tab.isClosed())) await tab.close();
    console.log('Project-only background collection, save-before-close, CAPTCHA/partial/navigation safeguards and reset passed.');
    const search = await context.newPage();
    await search.goto('https://www.google.com/search?q=energy');
    const tabId = await worker.evaluate(async () => (await (globalThis.browser ?? chrome).tabs.query({})).find(tab => tab.url?.includes('www.google.com/search')).id);
    const collection = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'collect', tabId }), tabId);
    assert.equal(collection.ok, true); assert.equal(collection.count, 1);
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('1 unique URLs'));
    await page.waitForFunction(() => document.querySelector('#urls').value === 'https://corpus.test/article');
    assert.equal(await page.locator('#use-collected').count(), 0);
    await page.fill('#project-name', 'Energy corpus');
    assert.equal(await page.inputValue('#urls'), 'https://corpus.test/article');
    async function deleteAllRows() {
      let count;
      while ((count = await page.locator('#review-lists .delete-button').count())) {
        await clickConfirmed('#review-lists .delete-button');
        await page.waitForFunction(count => document.querySelectorAll('#review-lists tbody tr').length < count, count);
      }
    }
    for (const extractor of ['readability', 'defuddle']) {
      if (extractor === 'defuddle') {
        await clickConfirmed('#review-lists .delete-button');
        await page.fill('#urls', 'https://corpus.test/article');
      }
      await page.selectOption('#extractor', extractor);
      await page.click('#start');
      await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
      assert.match(await page.locator('#status').innerText(), /0 download errors, 0 extraction failures/);
      await search.goto('https://corpus.test/article');
      assert.equal((await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'get-page-corpus-state', tabId }), tabId)).saved, true, 'batch downloads count as already saved');
      assert.equal(await page.inputValue('#preview-text'), '');
      assert.equal(await page.locator('#preview-title').innerText(), 'Preview Text');
      await page.click('#review-lists .preview-button');
      await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy'));
      assert.ok((await page.inputValue('#preview-text')).includes('Renewable energy'));
      assert.ok(!(await page.inputValue('#preview-text')).includes('MENU_SENTINEL'));
      const downloadEvent = page.waitForEvent('download'); await page.click('#export');
      const download = await downloadEvent; await download.saveAs(join(root, `${extractor}.zip`));
      assert.equal(await download.failure(), null);
      console.log(`${extractor}: search collection → download → extraction → ZIP passed`);
    }
    await deleteAllRows();
    await page.fill('#urls', 'https://corpus.test/document.pdf\nhttps://corpus.test/document.docx');
    await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.match(await page.locator('#status').innerText(), /0 download errors, 0 extraction failures/);
    assert.equal(await page.inputValue('#preview-text'), '');
    assert.equal(await page.locator('#pdf-notice').count(), 1);
    assert.ok(!(await page.locator('#review-lists').innerText()).includes('PDF reading order'));
    await page.locator('#review-lists .preview-button').nth(0).click();
    assert.equal(await page.locator('#results tr.preview-selected').count(), 1);
    assert.equal(await page.locator('#results tr').nth(0).getAttribute('aria-current'), 'true');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy corpus'));
    assert.match(await page.inputValue('#preview-text'), /Renewable energy corpus/);
    await page.locator('#review-lists .preview-button').nth(1).click();
    assert.equal(await page.locator('#results tr.preview-selected').count(), 1);
    assert.equal(await page.locator('#results tr').nth(0).getAttribute('aria-current'), 'false');
    assert.equal(await page.locator('#results tr').nth(1).getAttribute('aria-current'), 'true');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Caffè 中文 corpus'));
    assert.match(await page.inputValue('#preview-text'), /Caffè 中文 corpus/);
    const documentsDownload = page.waitForEvent('download'); await page.click('#export');
    await (await documentsDownload).saveAs(join(root, 'documents.zip'));
    await checkCorpusReport(join(root, 'documents.zip'));
    console.log('PDF/DOCX download, local extraction, preview and ZIP passed.');
    await deleteAllRows();
    await page.fill('#urls', 'https://corpus.test/large.docx'); await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.match(await page.locator('#status').innerText(), /0 download errors, 0 extraction failures/);
    await page.click('#review-lists .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.length > 3 * 1024 * 1024 && document.querySelector('#preview-text').value.startsWith('Larger DOCX corpus text.'));
    await deleteAllRows();
    await page.fill('#urls', 'https://corpus.test/wrapped.pdf');
    await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.match(await page.locator('#status').innerText(), /0 download errors, 0 extraction failures/);
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
    const rawDownload = page.waitForEvent('download'); await page.click('#export');
    const rawPath = join(root, 'raw-formatted.zip'); await (await rawDownload).saveAs(rawPath);
    const rawZip = await readFile(rawPath); assert.ok(rawZip.includes(wrappedPDF));
    assert.ok(rawZip.includes(Buffer.from(rawPDF.name))); assert.ok(rawZip.includes(Buffer.from(rawPDF.text)));
    await deleteAllRows();
    await page.fill('#urls', pdfOrigin + '/oversized.pdf'); await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.equal(await page.locator('#problem-results tr').count(), 1);
    assert.equal(await page.locator('#results tr').count(), 0);
    assert.equal(await page.locator('#attention-section').isVisible(), true);
    assert.match(await page.locator('#review-lists').innerText(), /50 MiB download limit/);
    assert.ok(!(await page.locator('#review-lists').innerText()).includes('CAPTCHA'));
    assert.equal(await page.locator('#review-lists .import-document-button').count(), 0);
    await deleteAllRows();
    console.log('Large PDF batch download, layout cleanup, raw-text ZIP backup and explicit 50 MiB failure passed.');
    await page.fill('#urls', 'https://corpus.test/empty.pdf');
    await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.match(await page.locator('#review-lists').innerText(), /Extraction failed/);
    assert.equal(await page.locator('#review-lists .import-document-button').count(), 0, 'successful downloads with failed extraction must not offer recovery');
    await deleteAllRows();
    await page.fill('#urls', 'https://corpus.test/blocked');
    await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.match(await page.locator('#status').innerText(), /1 download errors/);
    assert.equal(await page.locator('#review-lists .import-document-button').count(), 1, 'failed downloads offer generic import');
    assert.match(await page.locator('#review-lists td').nth(2).innerText(), /Add page to corpus.*\(HTTP 403[^)]*\)$/);
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
    const capturedDownload = page.waitForEvent('download'); await page.click('#export');
    const capturedZIP = join(root, 'captured-flat.zip'); await (await capturedDownload).saveAs(capturedZIP);
    await checkCorpusReport(capturedZIP);
    assert.equal(await page.inputValue('#preview-text'), '');
    await page.click('#review-lists .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy'));
    assert.ok((await page.inputValue('#preview-text')).includes('Renewable energy'));
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelectorAll('#review-lists tbody tr').length === 1 && !document.querySelector('#start').disabled);
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
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.match(await page.locator('#status').innerText(), /2 download errors/);
    await search.goto(pdfOrigin + '/login');
    await search.goto(pdfOrigin + '/session-document', { waitUntil: 'domcontentloaded' });
    const recoveredPDF = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'save-page', tabId }), tabId);
    assert.equal(recoveredPDF.ok, true, JSON.stringify(recoveredPDF));
    const sessionRow = page.locator('#review-lists tbody tr').filter({ has: page.locator(`a[href="${pdfOrigin}/session-document"]`) });
    await sessionRow.locator('.preview-button').waitFor();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.match(await sessionRow.innerText(), /PDF saved using browser session/);
    assert.ok(!(await sessionRow.innerText()).includes('PDF reading order'));
    await sessionRow.locator('.preview-button').click();
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy corpus'));
    const localRow = page.locator('#review-lists tbody tr').filter({ has: page.locator(`a[href="${pdfOrigin}/always-blocked.pdf"]`) });
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
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.match(await localRow.innerText(), /Imported PDF/);
    assert.equal(await page.locator('#review-lists tbody tr').count(), 2, 'recovery must replace failed rows');
    await page.fill('#urls', `${pdfOrigin}/session-document\n${pdfOrigin}/always-blocked.pdf\n${pdfOrigin}/always-blocked.docx`);
    await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    const wordRow = page.locator('#review-lists tbody tr').filter({ has: page.locator(`a[href="${pdfOrigin}/always-blocked.docx"]`) });
    assert.equal(await wordRow.locator('.import-document-button').innerText(), 'Import downloaded file');
    const wordChooser = page.waitForEvent('filechooser'); await wordRow.locator('.import-document-button').click();
    assert.equal(await page.locator('#import-document-picker').getAttribute('accept'), '');
    await (await wordChooser).setFiles({ name: 'downloaded.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: largeDOCX });
    await wordRow.locator('.preview-button').waitFor();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.match(await wordRow.innerText(), /Imported DOCX/);
    await wordRow.locator('.preview-button').click();
    await page.waitForFunction(() => document.querySelector('#preview-text').value.length > 3 * 1024 * 1024);
    const recoveredDownload = page.waitForEvent('download'); await page.click('#export');
    const recoveredPath = join(root, 'recovered-pdfs.zip');
    await (await recoveredDownload).saveAs(recoveredPath);
    assert.ok((await readFile(recoveredPath)).includes(largePDF), 'ZIP must contain the complete imported PDF original');
    assert.ok((await readFile(recoveredPath)).includes(largeDOCX), 'ZIP must contain the complete imported DOCX original');
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelectorAll('#review-lists tbody tr').length === 3 && !document.querySelector('#start').disabled);
    assert.equal(await page.inputValue('#preview-text'), '');
    assert.match(await page.locator('#review-lists').innerText(), /Imported PDF/);
    assert.match(await page.locator('#review-lists').innerText(), /Imported DOCX/);
    await deleteAllRows();
    console.log('Session-aware PDF tab recovery, browser file chooser import, persistence and export passed.');
    await page.evaluate(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'open-workspace' }));
    assert.equal(context.pages().filter(tab => tab.url().split('#')[0] === origin + '/downloader.html').length, 1);
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('1 unique URLs'));
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'Energy corpus');
    await page.fill('#urls', 'https://corpus.test/keep-on-cancel');
    await page.click('#new-project');
    assert.equal(await page.inputValue('#project-name'), 'Energy corpus');
    await page.click('#project-dialog-cancel');
    assert.equal(await page.inputValue('#urls'), 'https://corpus.test/keep-on-cancel');
    await page.click('#new-project');
    await page.selectOption('#project-dialog-language', 'none'); await page.fill('#project-dialog-name', 'Fresh corpus'); await page.click('#project-dialog-submit');
    await page.waitForFunction(() => document.querySelector('#project-name')?.value === 'Fresh corpus' && !document.querySelector('#new-project').disabled);
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('0 unique URLs'));
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
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    await page.fill('#urls', 'https://corpus.test/article'); await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.equal(await page.locator('#problem-results tr').count(), 1);
    assert.equal(await page.locator('#problem-results input[type="checkbox"]').isChecked(), false);
    assert.match(await page.locator('#problem-results').innerText(), /Detected English/);
    await page.click('#problem-results .preview-button');
    await page.waitForFunction(() => document.querySelector('#preview-text').value.includes('Renewable energy'));
    await page.click('#problem-results .accept-language');
    await page.waitForFunction(() => document.querySelectorAll('#results tr').length === 1 && !document.querySelector('#recheck-language').disabled);
    assert.equal(await page.locator('#attention-section').isVisible(), false);
    await page.click('#recheck-language');
    await page.waitForFunction(() => document.querySelector('#language-status').textContent.startsWith('1 of 1 saved texts rechecked') && !document.querySelector('#start').disabled);
    assert.equal(await page.locator('#results tr').count(), 1, 'manual override must survive recheck');
    const acceptedDownload = page.waitForEvent('download'); await page.click('#export');
    const acceptedZIP = join(root, 'accepted-language.zip'); await (await acceptedDownload).saveAs(acceptedZIP);
    await checkCorpusReport(acceptedZIP, 'English');

    await page.uncheck('#results input[type="checkbox"]');
    await page.selectOption('#project-language', 'none'); await page.click('#recheck-language');
    await page.waitForFunction(() => document.querySelector('#language-status').textContent.startsWith('1 of 1 saved texts rechecked') && !document.querySelector('#start').disabled);
    assert.equal(await page.locator('#results input[type="checkbox"]').isChecked(), false, 'disabling detection must preserve manual exclusion');
    const languageDownload = page.waitForEvent('download'); await page.click('#export');
    const languageZIP = join(root, 'language.zip'); await (await languageDownload).saveAs(languageZIP);
    assert.ok((await readFile(languageZIP)).includes(Buffer.from('languageCheck')));
    await checkCorpusReport(languageZIP);
    await deleteAllRows();
    console.log('Local franc mismatch, review/override, saved-text recheck and language metadata export passed.');
    assert.deepEqual(await page.locator('#search-filetype option').allTextContents(), ['No restriction', 'PDF', 'DOCX']);
    await page.fill('#excluded-sites', 'https://www.youtube.com/watch?v=1\nfacebook.com\nhttps://www.example.org/path');
    await page.selectOption('#search-filetype', 'pdf'); await page.fill('#tuples', 'energy storage'); await page.click('#prepare-queries');
    const filteredQuery = 'energy storage filetype:pdf -site:youtube.com -site:facebook.com -site:example.org';
    assert.equal(await page.locator('#prepared-queries a').innerText(), filteredQuery);
    assert.equal(new URL(await page.locator('#prepared-queries a').getAttribute('href')).searchParams.get('q'), filteredQuery);
    await page.click('#save-site-defaults');
    await page.waitForFunction(() => document.querySelector('#site-default-status').textContent.startsWith('Default exclusions saved'));
    await page.waitForFunction(() => document.querySelector('#storage-status').textContent.startsWith('Saved in this browser'));
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelectorAll('#prepared-queries a').length === 1);
    assert.equal(await page.locator('#prepared-queries a').innerText(), filteredQuery);
    await page.selectOption('#search-filetype', 'docx'); assert.equal(await page.locator('#prepared-queries a').count(), 1);
    assert.equal(await page.locator('#prepared-queries a').innerText(), filteredQuery.replace('filetype:pdf', 'filetype:docx'));
    const filteredTabsBefore = context.pages().length;
    await page.fill('#excluded-sites', 'example.net');
    await page.waitForFunction(() => document.querySelector('#prepared-queries a').textContent === 'energy storage filetype:docx -site:example.net');
    assert.equal(context.pages().length, filteredTabsBefore);
    assert.equal(await page.inputValue('#tuples'), 'energy storage');
    await page.fill('#excluded-sites', 'example.net -site:bad.test');
    await page.waitForFunction(() => document.querySelector('#excluded-sites').getAttribute('aria-invalid') === 'true');
    assert.equal(await page.locator('#open-all-queries').isDisabled(), true);
    assert.equal(await page.locator('#prepared-queries a').getAttribute('href'), null);
    await page.fill('#excluded-sites', 'example.net');
    await page.waitForFunction(() => !document.querySelector('#open-all-queries').disabled);

    await page.click('#new-project'); await page.fill('#project-dialog-name', 'Saved defaults');
    await page.selectOption('#project-dialog-language', 'none'); await page.click('#project-dialog-submit');
    await page.waitForFunction(() => document.querySelector('#project-name').value === 'Saved defaults' && !document.querySelector('#start').disabled);
    await assertCollapsed(); await openPanels();
    assert.equal(await page.inputValue('#excluded-sites'), 'youtube.com\nfacebook.com\nexample.org');
    assert.equal(await page.inputValue('#search-filetype'), ''); assert.equal(await page.locator('#prepared-queries a').count(), 0);
    console.log('Search file restrictions, canonical site exclusions, regenerated links and cross-project defaults passed.');
    await page.fill('#urls', Array.from({ length: 501 }, (_, i) => `https://corpus.test/large/${i}`).join('\n'));
    await page.waitForFunction(() => document.querySelector('#storage-status').textContent.startsWith('Saved in this browser'));
    assert.match(await page.locator('#urls-warning').innerText(), /501 URLs/);
    assert.equal(await page.locator('#urls-counter').innerText(), '501 URLs');
    await page.reload(); await assertCollapsed(); await openPanels();
    await page.waitForFunction(() => document.querySelector('#urls').value.split('\n').length === 501 && !document.querySelector('#start').disabled);
    assert.match(await page.locator('#urls-warning').innerText(), /501 URLs/);
    assert.equal(await page.locator('#urls-counter').innerText(), '501 URLs');
    assert.deepEqual(errors, []);
    console.log('Workspace reuse, saved-search persistence and zero page errors passed.');
  } finally { await context?.close(); if (pdfServer) await new Promise(resolve => pdfServer.close(resolve)); await rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

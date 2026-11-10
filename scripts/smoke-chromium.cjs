// Optional developer smoke test. Requires Playwright and a Chromium binary.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
(async () => {
  const { build } = await import('./build.mjs');
  const root = await mkdtemp(join(tmpdir(), 'bootcat-browser-'));
  let context;
  try {
    const extension = await build('chromium', { outputRoot: join(root, 'build'), includeTests: true });
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
    const paragraph = 'Renewable energy requires careful planning and reliable electricity networks. Technical terminology describes generation capacity, storage systems and distribution. Translators need clear examples of these expressions in context. These paragraphs provide a realistic corpus extraction fixture without involving a remote website.';
    const article = `<!doctype html><html lang="en"><head><title>Energy terminology</title></head><body><nav>MENU_SENTINEL</nav><article><h1>Energy terminology</h1>${Array.from({ length: 4 }, () => `<p>${paragraph}</p>`).join('')}</article><footer>FOOTER_SENTINEL</footer></body></html>`;
    // Fixtures only: this test never contacts real search engines or websites.
    await context.route(/^https?:/, route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.google.com') return route.fulfill({ contentType: 'text/html', body: '<div id="search"><a href="https://corpus.test/article"><h3>Energy article</h3></a></div>' });
      if (url.hostname === 'corpus.test' && url.pathname === '/blocked' && !route.request().isNavigationRequest()) return route.fulfill({ status: 403, body: 'CAPTCHA required' });
      if (url.hostname === 'corpus.test') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: article });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin + '/tests/browser-tests.html');
    await page.waitForFunction(() => document.querySelector('#output').textContent.includes('/9 passed.'));
    const output = await page.locator('#output').innerText();
    assert.ok(!output.includes('FAIL:'), output);
    console.log(output);
    await page.goto(origin + '/downloader.html');
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('0 unique URLs'));
    page.on('dialog', dialog => dialog.accept().catch(() => {}));
    const search = await context.newPage();
    await search.goto('https://www.google.com/search?q=energy');
    const tabId = await worker.evaluate(async () => (await (globalThis.browser ?? chrome).tabs.query({})).find(tab => tab.url?.includes('www.google.com/search')).id);
    const collection = await page.evaluate(tabId => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'collect', tabId }), tabId);
    assert.equal(collection.ok, true); assert.equal(collection.count, 1);
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('1 unique URLs'));
    await page.click('#use-collected');
    assert.equal(await page.inputValue('#urls'), 'https://corpus.test/article');
    for (const extractor of ['readability', 'defuddle']) {
      await page.selectOption('#extractor', extractor);
      await page.click('#start');
      await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
      assert.match(await page.locator('#status').innerText(), /0 download errors, 0 extraction failures/);
      assert.ok((await page.inputValue('#preview-text')).includes('Renewable energy'));
      assert.ok(!(await page.inputValue('#preview-text')).includes('MENU_SENTINEL'));
      const downloadEvent = page.waitForEvent('download'); await page.click('#export');
      const download = await downloadEvent; await download.saveAs(join(root, `${extractor}.zip`));
      assert.equal(await download.failure(), null);
      console.log(`${extractor}: search collection → download → extraction → ZIP passed`);
    }
    await page.fill('#urls', 'https://corpus.test/blocked');
    await page.click('#start');
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#status').textContent.startsWith('Finished.'));
    assert.match(await page.locator('#status').innerText(), /1 download errors/);
    assert.equal(await page.locator('#results a').getAttribute('href'), 'https://corpus.test/blocked');
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
    assert.equal(await page.locator('#results tr').count(), 1);
    assert.ok((await page.inputValue('#preview-text')).includes('Renewable energy'));
    assert.equal(await page.locator('#add-saved, #clear-saved').count(), 0);
    await page.waitForFunction(async () => (await (await import('./page-store.js')).readSavedPages()).length === 0);
    console.log('Automatic failed URL recovery, inert UTF-8 snapshots and inbox consumption passed.');
    await page.evaluate(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'open-workspace' }));
    assert.equal((await worker.evaluate(async () => (await (globalThis.browser ?? chrome).tabs.query({})).filter(tab => tab.url?.endsWith('/downloader.html')).length)), 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#collection-status').textContent.includes('1 unique URLs'));
    assert.deepEqual(errors, []);
    console.log('Workspace reuse, saved-search persistence and zero page errors passed.');
  } finally { await context?.close(); await rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

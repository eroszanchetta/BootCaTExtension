// Render the real popup HTML/CSS/JS in both browser engines. The extension APIs
// are fixtures; the browser-owned toolbar panel itself still needs manual checks.
const { chromium, firefox } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = resolve(__dirname, '../src');
  const server = createServer(async (request, response) => {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/')) { response.writeHead(404); response.end(); return; }
    try {
      const body = await readFile(path);
      response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' })[extname(path)] || 'application/octet-stream');
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const scenario of ['setup', 'search', 'collected', 'page', 'saved', 'unsupported', 'error']) {
          const page = await browser.newPage({ viewport: { width: 360, height: 600 } });
          const errors = []; page.on('pageerror', error => errors.push(error.message));
          await page.addInitScript(({ name, scenario }) => {
            const project = { id: 'project', name: 'Corpus', nameConfirmed: scenario !== 'setup' };
            const url = ['search', 'collected', 'error'].includes(scenario) ? 'https://www.google.com/search?q=energy' : scenario === 'unsupported' ? 'about:config' : 'https://example.org/article';
            const collections = scenario === 'collected' ? [{ engine: 'google', pageURL: url }] : [];
            const api = {
              runtime: { getManifest: () => ({ version: '2.0.0' }), sendMessage: async message => {
                if (message.type === 'get-project') return { ok: true, project };
                if (message.type === 'get-page-corpus-state') return { ok: true, projectId: project.id, saved: scenario === 'saved' };
                if (message.type === 'collect') return scenario === 'error' ? { ok: false, error: 'Unable to collect. ' + 'VeryLongError'.repeat(200) } : { ok: true };
                return { ok: true };
              } },
              tabs: { query: async () => [{ id: 10, url }] },
              storage: { local: { get: async () => ({ collections }) }, onChanged: { addListener() {} } }
            };
            globalThis[name === 'firefox' ? 'browser' : 'chrome'] = api;
          }, { name, scenario });
          await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
          await page.waitForFunction(() => !document.querySelector('#popup-status').textContent.startsWith('Checking'));
          const measure = () => page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            y: document.documentElement.scrollHeight > innerHeight }));
          assert.equal((await measure()).x, false, `${name}: ${scenario} initial horizontal overflow`);
          assert.equal((await measure()).y, false, `${name}: ${scenario} initial vertical overflow`);
          // Firefox's toolbar host asks for intrinsic body sizing. A fixed-size
          // browser page alone cannot catch content-dependent preferred widths.
          const intrinsic = await page.evaluate(() => {
            const root = document.documentElement, body = document.body;
            const rootStyle = root.style.cssText, bodyStyle = body.style.cssText;
            try {
              root.style.width = 'max-content'; root.style.maxWidth = 'none';
              const fixed = root.getBoundingClientRect().width;
              body.style.width = '100%';
              const previous = root.getBoundingClientRect().width;
              return { fixed, previous };
            } finally { root.style.cssText = rootStyle; body.style.cssText = bodyStyle; }
          });
          assert.ok(intrinsic.fixed <= 361, `${name}: ${scenario} preferred popup width ${intrinsic.fixed}`);
          if (scenario === 'page' && name === 'firefox') {
            assert.ok(intrinsic.previous > intrinsic.fixed + 50,
              `${name}: capture fixture must reproduce the old intrinsic-width expansion: ${JSON.stringify(intrinsic)}`);
          }

          await page.setViewportSize({ width: 300, height: 300 });
          assert.equal((await measure()).x, false, `${name}: ${scenario} initial narrow overflow`);
          await page.setViewportSize({ width: 360, height: 600 });
          assert.equal(await page.locator('#workspace').isVisible(), true);
          assert.equal(await page.locator('#collect').isVisible(), ['search', 'error'].includes(scenario));
          assert.equal(await page.locator('#save-page').isVisible(), scenario === 'page');
          if (scenario === 'saved') assert.equal(await page.locator('#page-feedback').innerText(), 'Page already added to corpus');
          if (scenario === 'collected') assert.equal(await page.locator('#feedback').innerText(), 'Results added');
          if (scenario === 'search' || scenario === 'page') {
            const action = page.locator(scenario === 'search' ? '#collect' : '#save-page');
            assert.ok((await action.boundingBox()).width < (await page.locator('#workspace').boundingBox()).width);
            await action.click();
            await page.waitForFunction(() => !document.querySelector('#feedback').hidden || !document.querySelector('#page-feedback').hidden);
          }
          if (scenario === 'error') {
            await page.click('#collect');
            await page.waitForFunction(() => document.querySelector('#feedback').textContent.startsWith('Unable'));
          }
          assert.equal((await measure()).x, false, `${name}: ${scenario} horizontal overflow`);
          if (scenario !== 'error') assert.equal((await measure()).y, false, `${name}: ${scenario} normal-height overflow`);
          else {
            assert.equal((await measure()).y, true, 'long messages must remain scrollable');
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await page.waitForFunction(() => scrollY > 0);
          }
          await page.setViewportSize({ width: 300, height: 300 });
          assert.equal((await measure()).x, false, `${name}: ${scenario} narrow-panel overflow`);
          assert.deepEqual(errors, []); await page.close();
        }
        // Native nested disclosures and their real styles must also work in Firefox.
        // Only workspace startup is isolated here; the full Chromium extension suite
        // separately checks query updates, persistence and project resets.
        const workspace = await browser.newPage({ viewport: { width: 1050, height: 850 } });
        await workspace.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
          body: "import { initWorkspaceSections } from './workspace-sections.js'; initWorkspaceSections();" }));
        await workspace.addInitScript(() => {
          globalThis.chrome = { runtime: { sendMessage: async message => {
            const settings = await import('/settings.js');
            const area = { get: async key => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }), set: async patch => { for (const [key, value] of Object.entries(patch)) localStorage.setItem(key, JSON.stringify(value)); } };
            try {
              if (message.type === 'get-settings') return { ok: true, settings: await settings.readSettingsState(area) };
              if (message.type === 'save-settings') return { ok: true, settings: await settings.saveSettings(area, message.values, message.revision) };
              return { ok: true };
            } catch (error) { return { ok: false, error: error.message }; }
          } } };
        });
        await workspace.goto(`http://127.0.0.1:${server.address().port}/downloader.html`);
        const openSettings = async () => {
          await workspace.getByRole('button', { name: 'Settings', exact: true }).click();
          await workspace.waitForFunction(() => document.querySelector('#settings-dialog').open && !document.querySelector('#settings-save').disabled);
        };
        assert.deepEqual(await workspace.locator('nav .menu-item span').allTextContents(), ['Project', 'Seeds & Tuples', 'Search', 'URLs', 'Download', 'Save', 'Help', 'Settings']);
        assert.equal(await workspace.locator('nav .menu-item svg[aria-hidden="true"]').count(), 8);
        await openSettings();
        assert.equal(await workspace.inputValue('#setting-fileMiB'), '50');
        assert.equal(await workspace.locator('#settings-advanced').evaluate(panel => panel.open), false);
        await workspace.fill('#setting-fileMiB', '75');
        assert.match(await workspace.locator('#setting-fileMiB-warning').innerText(), /memory/);
        await workspace.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await workspace.locator('#open-settings').evaluate(button => button === document.activeElement), true);
        await openSettings(); assert.equal(await workspace.inputValue('#setting-fileMiB'), '50');
        await workspace.fill('#setting-fileMiB', '0'); await workspace.click('#settings-save');
        assert.equal(await workspace.locator('#settings-dialog').evaluate(dialog => dialog.open), true);
        await workspace.fill('#setting-fileMiB', '75'); await workspace.fill('#setting-urlWarning', '2');
        await workspace.click('#settings-save'); await workspace.locator('#settings-dialog[open]').waitFor({ state: 'hidden' });
        await workspace.reload(); await openSettings();
        assert.equal(await workspace.inputValue('#setting-fileMiB'), '75'); assert.equal(await workspace.inputValue('#setting-urlWarning'), '2');
        await workspace.click('#settings-reset'); assert.equal(await workspace.inputValue('#setting-fileMiB'), '50');
        await workspace.keyboard.press('Escape'); await openSettings();
        assert.equal(await workspace.inputValue('#setting-fileMiB'), '75', 'Escape must discard reset-to-defaults draft');
        await workspace.locator('#settings-advanced > summary').focus(); await workspace.keyboard.press('Enter');
        assert.equal(await workspace.locator('#setting-captureMiB').isVisible(), true);
        for (const width of [1050, 500, 320]) {
          await workspace.setViewportSize({ width, height: 850 });
          assert.equal(await workspace.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: icon menu overflow at ${width}px`);
          assert.equal(await workspace.locator('#settings-dialog').evaluate(dialog => dialog.scrollWidth > dialog.clientWidth), false, `${name}: settings overflow at ${width}px`);
        }
        await workspace.setViewportSize({ width: 1050, height: 850 });
        await workspace.click('#settings-reset'); await workspace.click('#settings-save'); await workspace.locator('#settings-dialog[open]').waitFor({ state: 'hidden' });

        assert.equal(await workspace.locator('#project-section .workspace-panel').evaluate(panel => panel.open), true);
        await workspace.locator('#project-section .workspace-panel > summary').focus(); await workspace.keyboard.press('Enter');
        assert.equal(await workspace.locator('#project-section .workspace-panel').evaluate(panel => panel.open), false);
        await workspace.locator('nav a[href="#project-section"]').click();
        assert.equal(await workspace.locator('#project-section .workspace-panel').evaluate(panel => panel.open), true);
        await workspace.locator('nav a[href="#review-section"]').click();
        await workspace.evaluate(() => { document.querySelector('#attention-section').hidden = false; });
        assert.equal(await workspace.locator('#attention-heading').innerText(), 'Documents with issues');
        assert.equal(await workspace.locator('#attention-section').evaluate(panel => panel.open), false);
        await workspace.locator('#attention-section > summary').focus(); await workspace.keyboard.press('Enter');
        assert.equal(await workspace.locator('#attention-section').evaluate(panel => panel.open), true);
        await workspace.keyboard.press('Enter');
        assert.equal(await workspace.locator('#attention-section').evaluate(panel => panel.open), false);
        await workspace.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: `
          import { initWorkspaceSections } from './workspace-sections.js';
          import { initProjectUI } from './project-ui.js';
          globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: true, project: null, promptForProject: false }) }, storage: { onChanged: { addListener() {} } } };
          initWorkspaceSections(); initProjectUI({ onReset() {}, onRename() {} });
        ` }));
        await workspace.reload(); await workspace.locator('#project-dialog[open]').waitFor();
        assert.equal(await workspace.locator('#project-dialog-cancel').isDisabled(), true);
        assert.equal(await workspace.locator('#project-dialog-close').isVisible(), true);
        await workspace.keyboard.press('Escape');
        assert.equal(await workspace.locator('#project-dialog[open]').count(), 1);
        // Resume the isolated disclosure/layout checks without an open modal.
        await workspace.evaluate(() => document.querySelector('#project-dialog').close());
        await workspace.locator('nav a[href="#search-section"]').click();
        assert.equal(await workspace.locator('#more-search-options').evaluate(panel => panel.open), false);
        assert.equal(await workspace.locator('#search-site').isVisible(), false);
        assert.equal(await workspace.locator('#more-search-options #search-filetype, #more-search-options #search-site, #more-search-options #excluded-sites').count(), 3);
        await workspace.locator('#more-search-options > summary').focus();
        await workspace.keyboard.press('Enter');
        assert.equal(await workspace.locator('#search-site').isVisible(), true);
        for (const width of [1050, 500]) {
          await workspace.setViewportSize({ width, height: 850 });
          assert.equal(await workspace.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: advanced options overflow at ${width}px`);
        }
        await workspace.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: "import { initWorkspaceSections } from './workspace-sections.js'; initWorkspaceSections();" }));
        await workspace.reload();
        assert.equal(await workspace.locator('#more-search-options').evaluate(panel => panel.open), false);
        await workspace.setViewportSize({ width: 1050, height: 850 });
        // Exercise the real text-review controller and native modal in both engines.
        await workspace.evaluate(async () => {
          const storage = await import('./project-store.js');
          const { initTextReview } = await import('./text-review.js');
          const { confirmAction } = await import('./dialogs.js');
          await storage.resetStoredProject('text-dialog');
          const url = 'https://example.org/article', filename = 'pages/article.html';
          await storage.saveDocument('text-dialog', { url, filename, outcome: 'downloaded' }, {
            url, filename, textFilename: 'corpus/article.txt', extraction: { status: 'ok', included: true, text: 'Corpus text for reading.', characters: 24, warnings: [], title: 'Readable document', extractor: 'fixture' }
          }, new Blob(['Original HTML']));
          globalThis.testTextReview = initTextReview({ confirm: confirmAction, run: async task => { await task(); return true; },
            getProjectId: () => 'text-dialog', getLanguage: () => 'none', isRunning: () => false, onSaved() {} });
          await testTextReview.open(url);
        });
        await workspace.locator('#text-review-dialog[open]').waitFor();
        assert.equal(await workspace.locator('#preview-section, nav a[href="#preview-section"]').count(), 0);
        assert.equal(await workspace.locator('#preview-text').evaluate(text => text.readOnly), true);
        assert.equal(await workspace.locator('#text-review-save').isDisabled(), true);
        const bounds = await workspace.locator('#text-review-dialog').boundingBox();
        assert.ok(bounds.height >= 600 && bounds.width >= 800, `${name}: comfortable desktop text dialog`);
        await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
        const cancelEdit = workspace.locator('#text-review-edit');
        assert.equal(await cancelEdit.innerText(), 'Cancel');
        assert.equal(await cancelEdit.isEnabled(), true);
        await workspace.mouse.move(0, 0);
        assert.equal(await cancelEdit.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(162, 45, 37)');
        await cancelEdit.click();
        assert.equal(await cancelEdit.innerText(), 'Edit');
        assert.equal(await workspace.locator('#preview-text').evaluate(text => text.readOnly), true);
        await cancelEdit.click();
        await workspace.fill('#preview-text', 'Discard this first edit.');
        await cancelEdit.focus(); await workspace.keyboard.press('Space');
        assert.equal(await workspace.inputValue('#preview-text'), 'Corpus text for reading.');
        assert.equal(await workspace.locator('#preview-text').evaluate(text => text.readOnly), true);
        assert.equal(await cancelEdit.innerText(), 'Edit');
        assert.equal(await cancelEdit.evaluate(button => button === document.activeElement), true);
        assert.equal(await cancelEdit.evaluate(button => button.classList.contains('danger')), false);
        assert.equal(await workspace.locator('#text-review-save').isDisabled(), true);
        await cancelEdit.click();
        await workspace.fill('#preview-text', 'Edited café 中文 🐱 corpus.');
        await workspace.keyboard.press('Escape'); await workspace.locator('#confirmation-dialog[open]').waitFor();
        await workspace.click('#confirmation-cancel');
        assert.equal(await workspace.locator('#text-review-dialog[open]').count(), 1);
        assert.equal(await workspace.inputValue('#preview-text'), 'Edited café 中文 🐱 corpus.');
        await workspace.click('#text-review-save');
        await workspace.waitForFunction(() => document.querySelector('#text-review-status').textContent.startsWith('Text saved'));
        assert.equal(await workspace.locator('#preview-text').evaluate(text => text.readOnly), true);
        assert.deepEqual(await workspace.evaluate(async () => {
          const storage = await import('./project-store.js');
          return [await (await storage.readText('text-dialog', 'https://example.org/article')).text(), await (await storage.readOriginalText('text-dialog', 'https://example.org/article')).text()];
        }), ['Edited café 中文 🐱 corpus.', 'Corpus text for reading.']);
        await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
        await workspace.fill('#preview-text', 'Discard this later edit.'); await cancelEdit.click();
        assert.equal(await workspace.inputValue('#preview-text'), 'Edited café 中文 🐱 corpus.');
        assert.equal(await workspace.locator('#preview-text').evaluate(text => text.readOnly), true);
        assert.equal(await cancelEdit.innerText(), 'Edit');
        assert.equal(await workspace.locator('#text-review-save').isDisabled(), true);
        await workspace.setViewportSize({ width: 390, height: 700 });
        assert.equal(await workspace.evaluate(() => document.querySelector('#text-review-dialog').scrollWidth > document.querySelector('#text-review-dialog').clientWidth), false, `${name}: mobile dialog overflow`);
        await workspace.click('#text-review-close');
        assert.equal(await workspace.locator('#text-review-dialog[open]').count(), 0);
        await workspace.close();
        console.log(`${name}: conditional popup actions, confirmations, advanced disclosure keyboard handling and responsive overflow passed.`);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

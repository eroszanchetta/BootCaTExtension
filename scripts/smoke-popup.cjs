// Render the real popup HTML/CSS/JS in both browser engines. The extension APIs
// are fixtures; the browser-owned toolbar panel itself still needs manual checks.
const { chromium, firefox } = require('playwright');
const { createServer } = require('node:http');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { resolve, extname, join } = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const temporary = await mkdtemp(join(require('node:os').tmpdir(), 'bootcat-popup-'));
  const { build } = await import('./build.mjs');
  const root = await build('chromium', { outputRoot: temporary, includeTests: true });
  const server = createServer(async (request, response) => {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/')) { response.writeHead(404); response.end(); return; }
    try {
      const body = await readFile(path);
      if (path.endsWith('/tests/browser-tests.html') || path.endsWith('/pdf.worker.mjs')) response.setHeader('Content-Security-Policy', "script-src 'self'; worker-src 'self'; object-src 'none'");
      response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
      const browser = await engine.launch({ headless: true });
      try {
        const extraction = await browser.newPage(); const extractionErrors = []; extraction.on('pageerror', error => extractionErrors.push(error.message));
        await extraction.goto(`http://127.0.0.1:${server.address().port}/tests/browser-tests.html`);
        await extraction.waitForFunction(() => document.querySelector('#output').textContent.includes('/12 passed.'));
        assert.match(await extraction.locator('#output').innerText(), /12\/12 passed\./); assert.deepEqual(extractionErrors, []);
        await extraction.close(); console.log(`${name}: prepared local PDF library/worker and all extraction fixtures passed under script-src self.`);
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
          assert.ok(await page.locator('.popup-brand').evaluate(header => {
            const icon = header.querySelector('img').getBoundingClientRect(), title = header.querySelector('#app-version').getBoundingClientRect();
            return title.left >= icon.right && Math.abs((icon.top + icon.bottom) / 2 - (title.top + title.bottom) / 2) < 2;
          }));
          assert.equal(await page.locator('.popup-action h3').count(), 0);

          assert.equal(await page.locator('#collect').isVisible(), ['search', 'error'].includes(scenario));
          assert.equal(await page.locator('#save-page').isVisible(), scenario === 'page');
          assert.equal(await page.locator('#close-collected-option').isVisible(), ['search', 'collected', 'error'].includes(scenario));
          assert.equal(await page.locator('#close-captured-option').isVisible(), ['page', 'saved'].includes(scenario));
          if (['saved', 'collected'].includes(scenario)) {
            const toggle = page.locator(scenario === 'saved' ? '#close-captured-tab' : '#close-collected-tab');
            const previous = await toggle.isChecked();
            await toggle.focus(); await page.keyboard.press('Space');
            await page.waitForFunction(() => !document.querySelector('#close-captured-tab').disabled && !document.querySelector('#close-collected-tab').disabled);
            assert.equal(await toggle.isChecked(), !previous);
            assert.equal(await page.locator('#collect, #save-page').evaluateAll(buttons => buttons.every(button => button.disabled)), true);
          }

          assert.equal(await page.locator('#floating-preferences').isVisible(), scenario !== 'setup');
          if (scenario !== 'setup') {
            const toggle = page.locator('#show-floating-controls');
            await toggle.focus();
            assert.equal(await toggle.getAttribute('role'), 'switch');
            assert.equal(await toggle.evaluate(el => getComputedStyle(el).appearance), 'none');
            const previousToggle = await toggle.isChecked();
            await page.keyboard.press('Space');
            await page.waitForFunction(() => !document.querySelector('#show-floating-controls').disabled);
            assert.equal(await toggle.isChecked(), !previousToggle);
            assert.equal(await page.locator('#controls-feedback').innerText(), '');
            await page.keyboard.press('Space');
            await page.waitForFunction(() => !document.querySelector('#show-floating-controls').disabled);
            assert.equal(await toggle.isChecked(), previousToggle);
          }
          if (scenario === 'saved') assert.equal(await page.locator('#page-feedback').innerText(), 'Page already added to corpus');
          if (scenario === 'collected') assert.equal(await page.locator('#feedback').innerText(), '0 URLs added to your project.');
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
        // Minimized populated live DDG DOM: the old selector saw ten documents
        // plus two related queries and incorrectly reported a partial collection.
        const ddgHTML = await readFile(resolve('tests/fixtures/duckduckgo-populated.html'), 'utf8');
        const { ENGINES, extractResults } = await import('../src/engines.js');
        const ddgAdapter = ENGINES.find(item => item.id === 'duckduckgo');
        const ddg = await browser.newPage();
        await ddg.route('https://duckduckgo.com/**', route => route.fulfill({ contentType: 'text/html', body: ddgHTML }));
        await ddg.goto('https://duckduckgo.com/?q=sepalo+stame+petalo&ia=web');
        let collected = await ddg.evaluate(extractResults, ddgAdapter);
        assert.equal(collected.results.length, 10); assert.equal(collected.unresolved, 0);
        assert.equal(collected.candidateDiagnostics.filter(item => item.reason === 'related-search').length, 2);
        const firstKey = collected.resultSetKey;
        await ddg.evaluate(() => { const a = document.createElement('a'); a.dataset.testid = 'result-title-a'; a.href = 'https://example.org/appended'; a.textContent = 'More results fixture'; document.querySelector('main').append(a); });
        collected = await ddg.evaluate(extractResults, ddgAdapter);
        assert.equal(collected.results.length, 11); assert.notEqual(collected.resultSetKey, firstKey);
        await ddg.evaluate(() => { const a = document.createElement('a'); a.dataset.testid = 'result-title-a'; a.href = '/l/?opaque=unresolved'; a.textContent = 'Unresolved destination'; document.querySelector('main').append(a); });
        collected = await ddg.evaluate(extractResults, ddgAdapter);
        assert.equal(collected.unresolved, 1); assert.ok(collected.candidateDiagnostics.some(item => item.href === '/l/?opaque=unresolved' && item.outcome === 'unresolved'));
        await ddg.close();
        const google=await browser.newPage();
        await google.route('https://www.google.com/**',route=>route.fulfill({contentType:'text/html',body:require('node:fs').readFileSync(resolve('tests/fixtures/google-goto.html'),'utf8')}));
        await google.goto('https://www.google.com/search?q=flowers');
        const opaque=await google.evaluate(extractResults,ENGINES.find(item=>item.id==='google'));
        assert.equal(opaque.results.length,0); assert.equal(opaque.unreadableGoogle,2); assert.equal(opaque.unresolved,2); await google.close();
        console.log(`${name}: populated DDG result selectors, related-search diagnostics, appended results and genuine partial results passed.`);
        // Run the real, self-contained floating control in both native DOMs.
        const floating = await browser.newPage({ viewport: { width: 640, height: 600 } });
        const floatingErrors = []; floating.on('pageerror', error => floatingErrors.push(error.message));
        await floating.addInitScript(name => {
          const fixture = globalThis.floatingFixture = { state: { enabled: true, projectId: 'p', action: 'save-page', saved: false, position: 'top-right', closeAfterSuccess: false }, actions: 0, workspace: 0, listeners: [], partial: false, fail: false };
          globalThis[name === 'firefox' ? 'browser' : 'chrome'] = { runtime: { id: 'floating-fixture', onMessage: { addListener(fn) { fixture.listeners.push(fn); } }, sendMessage: async message => {
            if (message.type === 'get-floating-state') return { ok: true, state: structuredClone(fixture.state) };
            if (message.type === 'floating-mark-no-results') { fixture.marked=(fixture.marked||0)+1; fixture.state.saved=true; return {ok:true}; }
            if (message.type === 'floating-hide') { fixture.state.enabled = false; return { ok: true }; }
            if (message.type === 'floating-open-workspace') { fixture.workspace++; return { ok: true }; }
            fixture.actions++;
            if (fixture.empty) return {ok:false,code:'no-results-collected',error:'No results collected. Check the search tab.'};
            if (fixture.fail) return { ok: false, error: 'Save failed. ' + 'LongError'.repeat(70) };
            if (fixture.partial) return { ok: true, unresolved: 1 };
            fixture.state.saved = true; return { ok: true };
          } } };
        }, name);
        await floating.goto(`http://127.0.0.1:${server.address().port}/about.html`);
        await floating.addStyleTag({ content: 'button { width: 200px !important; background: red !important } div { font-size: 80px !important }' });
        await floating.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/floating-control.js` });
        const host = floating.locator('[data-bootcat-floating-control]'); await host.waitFor();
        assert.equal(await host.evaluate(node => node.shadowRoot), null, `${name}: keep the controls isolated from the page`);
        const initial = await host.boundingBox(); assert.equal(Math.round(initial.y), 16); assert.equal(Math.round(initial.x + initial.width), 624); assert.ok(initial.width < 130);
        assert.equal(await floating.evaluate(async () => { const { captureCurrentPage } = await import('./page-capture.js'); return captureCurrentPage().html.includes('data-bootcat-floating-control'); }), false);
        await floating.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/floating-control.js` });
        assert.equal(await host.count(), 1); assert.equal(await floating.evaluate(() => floatingFixture.listeners.length), 1);
        await floating.evaluate(() => document.querySelector('[data-bootcat-floating-control]').remove());
        await host.waitFor(); assert.equal(await host.count(), 1, 'page replacement restores one floating control');
        await floating.evaluate(() => { floatingFixture.state.saved = true; for (const listener of floatingFixture.listeners) listener({type:'bootcat-floating-refresh'},{id:'floating-fixture'},()=>{}); });
        await host.waitFor({state:'hidden'});
        await floating.evaluate(() => { floatingFixture.state.saved = false; history.pushState({},'', '?changed=1'); document.body.append(document.createElement('p')); });
        await host.waitFor();

        for (const position of ['top-right', 'top-left', 'bottom-right', 'bottom-left']) {
          await floating.evaluate(position => { floatingFixture.state.position = position; for (const listener of floatingFixture.listeners) listener({ type: 'bootcat-floating-refresh' }, { id: 'floating-fixture' }, () => {}); }, position);
          await floating.waitForFunction(position => { const node = document.querySelector('[data-bootcat-floating-control]'); return node.style[position.startsWith('top') ? 'top' : 'bottom'] === '16px' && node.style[position.endsWith('left') ? 'left' : 'right'] === '16px'; }, position);
        }
        await floating.setViewportSize({ width: 320, height: 600 });
        let box = await host.boundingBox(); await floating.mouse.move(box.x + 20, box.y + 20);
        assert.equal(await floating.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await floating.mouse.click(box.x + 20, box.y + 20); await floating.waitForFunction(() => floatingFixture.workspace === 1);
        await floating.mouse.click(box.x + box.width - 20, box.y + 20); await host.waitFor({ state: 'hidden' });
        assert.equal(await floating.evaluate(() => floatingFixture.state.enabled), false);
        await floating.evaluate(() => { floatingFixture.state.enabled = true; floatingFixture.state.action = 'collect'; floatingFixture.partial = true; for (const listener of floatingFixture.listeners) listener({ type: 'bootcat-floating-refresh' }, { id: 'floating-fixture' }, () => {}); });
        await host.waitFor(); box = await host.boundingBox(); await floating.mouse.click(box.x + 55, box.y + 20);
        await floating.waitForFunction(() => floatingFixture.actions === 1); assert.equal(await host.isVisible(), true, 'partial collection leaves controls available');
        await floating.evaluate(() => { floatingFixture.partial = false; });
        await floating.mouse.click(box.x + 55, box.y + 20); await floating.waitForFunction(() => floatingFixture.actions === 2);
        assert.equal(await host.isVisible(), true, 'successful collection retains Review URLs');
        await floating.evaluate(() => { floatingFixture.state.saved = false; floatingFixture.state.enabled = false; for (const listener of floatingFixture.listeners) listener({ type: 'bootcat-floating-refresh' }, { id: 'floating-fixture' }, () => {}); });
        assert.equal(await host.count(), 0);

        await floating.evaluate(() => { floatingFixture.empty=true; floatingFixture.state={...floatingFixture.state,enabled:true,projectId:'empty',saved:false,action:'collect'}; for(const listener of floatingFixture.listeners) listener({type:'bootcat-floating-refresh'},{id:'floating-fixture'},()=>{}); });
        await host.waitFor(); box=await host.boundingBox(); await floating.mouse.click(box.x+55,box.y+20);
        await floating.waitForFunction(() => floatingFixture.actions===3);
        await floating.keyboard.press('Tab'); await floating.keyboard.press('Tab'); await floating.keyboard.press('Tab'); await floating.keyboard.press('Enter');
        await floating.waitForFunction(() => floatingFixture.marked===1); await host.waitFor({state:'hidden'});
        assert.deepEqual(floatingErrors, []); await floating.close();
        // Native nested disclosures and their real styles must also work in Firefox.
        // Only workspace startup is isolated here; the full Chromium extension suite
        // separately checks query updates, persistence and project resets.
        const workspace = await browser.newPage({ viewport: { width: 1050, height: 850 } });
        await workspace.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
          body: "import { initWorkspaceSections } from './workspace-sections.js'; initWorkspaceSections();" }));
        await workspace.addInitScript(() => {
          globalThis.settingsListeners = [];
          globalThis.chrome = { storage: { onChanged: { addListener(fn) { settingsListeners.push(fn); } } }, runtime: { sendMessage: async message => {
            const settings = await import('/settings.js');
            const area = { get: async key => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }), set: async patch => { for (const [key, value] of Object.entries(patch)) { localStorage.setItem(key, JSON.stringify(value)); for (const fn of settingsListeners) fn({ [key]: { newValue: value } }, 'local'); } } };
            try {
              if (message.type === 'get-project-corpus-options') {
                const storage = await import('/project-store.js'); await storage.ensureStoredProject('settings-project');
                const {draft} = await storage.loadWorkspace('settings-project');
                return {ok:true, projectId:'settings-project', options:draft, revision:draft.optionsRevision||0};
              }
              if (message.type === 'save-project-corpus-options') {
                const storage = await import('/project-store.js');
                return {ok:true,...await storage.saveCorpusOptions(message.projectId,message.values,message.revision)};
              }
              if (message.type === 'set-default-corpus-options') {
                const current = await settings.readSettingsState(area), v=message.values;
                return {ok:true,settings:await settings.saveSettings(area,{...current.values,defaultExtractor:v.extractor,defaultLanguageDetector:v.languageDetector,defaultMinimumCharacters:v.minimumCharacters,defaultMaximumCharacters:v.maximumCharacters},current.revision)};
              }
              if (message.type === 'get-settings') return { ok: true, settings: await settings.readSettingsState(area) };
              if (message.type === 'set-default-search-engine') { const current = await settings.readSettingsState(area); return { ok: true, settings: await settings.saveSettings(area, { ...current.values, defaultEngine: message.engine }, current.revision) }; }
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
        assert.deepEqual(await workspace.locator('nav .menu-item span').allTextContents(), ['Project', 'Seeds & Tuples', 'Search', 'URLs', 'Build Corpus', 'Help', 'Settings']);
        assert.equal(await workspace.locator('nav .menu-item svg[aria-hidden="true"]').count(), 7);
        assert.equal(await workspace.locator('#urls-section #start').count(), 0);
        assert.equal(await workspace.locator('#review-section #start').count(), 1);
        assert.equal(await workspace.locator('#results-heading').innerText(), 'Build Corpus');
        for (const width of [1280, 800, 640, 390]) {
          await workspace.setViewportSize({ width, height: 850 });
          const edges = await workspace.evaluate(() => {
            const content = document.querySelector('main > section').getBoundingClientRect();
            const logo = document.querySelector('.brand img').getBoundingClientRect();
            const menuRight = Math.max(...[...document.querySelectorAll('nav .menu-item')].map(item => item.getBoundingClientRect().right));
            return { left: Math.abs(logo.left - content.left), right: Math.abs(menuRight - content.right), overflow: document.documentElement.scrollWidth > innerWidth };
          });
          assert.ok(edges.left <= 1 && edges.right <= 1, `${name}: header alignment at ${width}px: ${JSON.stringify(edges)}`);
          assert.equal(edges.overflow, false);
        }
        await workspace.setViewportSize({ width: 1050, height: 850 });
        await openSettings();
        assert.equal(await workspace.inputValue('#setting-defaultEngine'), 'ecosia');
        await workspace.selectOption('#setting-defaultEngine', 'google');
        assert.equal(await workspace.inputValue('#setting-fileMiB'), '50');
        assert.equal(await workspace.locator('#settings-advanced').evaluate(panel => panel.open), false);
        await workspace.fill('#setting-fileMiB', '75');
        assert.match(await workspace.locator('#setting-fileMiB-warning').innerText(), /memory/);
        await workspace.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await workspace.locator('#open-settings').evaluate(button => button === document.activeElement), true);
        await openSettings(); assert.equal(await workspace.inputValue('#setting-fileMiB'), '50');
        assert.equal(await workspace.inputValue('#setting-defaultEngine'), 'ecosia', 'Cancel discards the engine preference');
        await workspace.selectOption('#setting-defaultEngine', 'google');
        await workspace.fill('#setting-fileMiB', '0'); await workspace.click('#settings-save');
        assert.equal(await workspace.locator('#settings-dialog').evaluate(dialog => dialog.open), true);
        await workspace.fill('#setting-fileMiB', '75'); await workspace.fill('#setting-urlWarning', '2');
        await workspace.click('#settings-save'); await workspace.locator('#settings-dialog[open]').waitFor({ state: 'hidden' });
        await workspace.reload(); await openSettings();
        assert.equal(await workspace.inputValue('#setting-fileMiB'), '75'); assert.equal(await workspace.inputValue('#setting-urlWarning'), '2');
        assert.equal(await workspace.inputValue('#setting-defaultEngine'), 'google', 'default persists after reload');
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

        await workspace.evaluate(async () => {
          const { initSeedsUI } = await import('./seeds-ui.js');
          const { queryPlan } = await import('./query-lifecycle.js');
          const select = document.querySelector('#engine');
          for (const [id, name] of [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['ecosia', 'Ecosia']]) {
            const option = document.createElement('option'); option.value = id; option.textContent = name; select.append(option);
          }
          select.value = 'ecosia';
          const state = globalThis.fixtureQueryState = { tabs: [], history: [] }; globalThis.fixtureQueryOpens = 0;
          const settingsMessage = chrome.runtime.sendMessage;
          chrome.runtime.sendMessage = async message => {
            if (message.type === 'set-default-search-engine' && globalThis.rejectEngineDefault) return { ok: false, error: 'Preference storage unavailable.' };
            if (message.type === 'get-project-search-tabs') return { ok: true, ...structuredClone(state) };
            if (message.type === 'open-project-search') {
              if (!queryPlan([message.query], message.engine, state).missing.length) return { ok: true, opened: false, ...structuredClone(state) };
              const tabId = ++globalThis.fixtureQueryOpens;
              state.tabs.push({ tabId, engine: message.engine, query: message.query, status: 'loading' });
              return { ok: true, opened: true, tabId, ...structuredClone(state) };
            }
            return settingsMessage(message);
          };
          const { initEngineDefaultUI } = await import('./engine-default-ui.js');
          globalThis.testEngineDefaultUI = initEngineDefaultUI({ getProjectId: () => 'query-fixture' });
          globalThis.testQueryUI = initSeedsUI({ draft: { preparedQueries: ['first', 'second'], excludedSites: '' }, getProjectId: () => 'query-fixture' });
          testQueryUI.updateTabState(state);
        });
        await workspace.locator('nav a[href="#search-section"]').click();
        await workspace.waitForFunction(() => document.querySelector('#engine-default-status').textContent.includes('Ecosia'));
        assert.equal(await workspace.locator('#make-default-engine').isDisabled(), true);
        const row = await workspace.evaluate(() => ({ select: document.querySelector('#engine').getBoundingClientRect().width,
          gap: document.querySelector('#make-default-engine').getBoundingClientRect().left - document.querySelector('#engine').getBoundingClientRect().right }));
        assert.ok(Math.abs(row.select - 560) < 1 && row.gap >= 8, `${name}: keep the 560px selector with Make default beside it`);
        await workspace.selectOption('#engine', 'duckduckgo'); await workspace.click('#make-default-engine');
        await workspace.waitForFunction(() => document.querySelector('#engine-default-status').textContent.includes('DuckDuckGo') && document.querySelector('#make-default-engine').disabled);
        await openSettings(); assert.equal(await workspace.inputValue('#setting-defaultEngine'), 'duckduckgo');
        await workspace.selectOption('#setting-defaultEngine', 'ecosia'); await workspace.click('#settings-save');
        await workspace.locator('#settings-dialog[open]').waitFor({ state: 'hidden' });
        await workspace.waitForFunction(() => document.querySelector('#engine-default-status').textContent.includes('Ecosia') && !document.querySelector('#make-default-engine').disabled);
        assert.equal(await workspace.inputValue('#engine'), 'duckduckgo', 'Settings changes only future projects');
        await workspace.evaluate(() => { globalThis.rejectEngineDefault = true; });
        await workspace.click('#make-default-engine');
        await workspace.waitForFunction(() => document.querySelector('#engine-default-status').textContent.includes('storage unavailable') && !document.querySelector('#make-default-engine').disabled);
        await openSettings(); assert.equal(await workspace.inputValue('#setting-defaultEngine'), 'ecosia'); await workspace.click('#settings-cancel');
        await workspace.evaluate(() => { globalThis.rejectEngineDefault = false; });
        const engineColors = [];
        for (const id of ['google', 'duckduckgo', 'ecosia']) {
          await workspace.selectOption('#engine', id);
          const cue = await workspace.locator('#engine').evaluate(select => ({ id: select.dataset.engine, name: select.selectedOptions[0].textContent,
            color: getComputedStyle(select).color, background: getComputedStyle(select).backgroundColor,
            border: getComputedStyle(select).borderInlineStartColor }));
          assert.equal(cue.id, id); assert.ok(cue.name); assert.equal(cue.border, cue.color);
          assert.equal(await workspace.locator('#query-summary').getAttribute('data-engine'), id);
          engineColors.push(cue.color);
        }
        assert.equal(new Set(engineColors).size, 3, `${name}: distinct named engine cues`);
        await workspace.selectOption('#engine', 'google');
        await workspace.getByRole('button', { name: 'Run all queries', exact: true }).click();
        await workspace.locator('#confirmation-dialog[open]').waitFor();
        assert.equal(await workspace.locator('#open-all-queries').isDisabled(), true);
        await workspace.locator('#confirmation-accept').click();
        await workspace.waitForFunction(() => document.querySelector('#open-all-queries').disabled && document.querySelector('#open-all-queries').textContent === 'No queries to open');
        await workspace.locator('#open-all-queries').evaluate(button => button.click());
        assert.equal(await workspace.evaluate(() => fixtureQueryOpens), 2);
        await workspace.evaluate(() => {
          const removed = fixtureQueryState.tabs.shift(); fixtureQueryState.history.push({ ...removed, status: 'closed' });
          testQueryUI.updateTabState(fixtureQueryState);
        });
        await workspace.getByRole('button', { name: 'Run missing queries (1)', exact: true }).click();
        await workspace.locator('#confirmation-dialog[open]').waitFor(); await workspace.locator('#confirmation-accept').click();
        await workspace.waitForFunction(() => document.querySelector('#open-all-queries').disabled && document.querySelector('#open-all-queries').textContent === 'No queries to open');
        assert.equal(await workspace.evaluate(() => fixtureQueryOpens), 3);
        await workspace.evaluate(() => {
          fixtureQueryState.history = fixtureQueryState.tabs.map(tab => ({ ...tab, status: 'collected' })); fixtureQueryState.tabs = [];
          testQueryUI.updateTabState(fixtureQueryState);
        });
        assert.match(await workspace.locator('#query-run-hint').innerText(), /All queries are completed/);
        await workspace.evaluate(() => { fixtureQueryState.history[0].status='no-results'; testQueryUI.updateTabState(fixtureQueryState); });
        assert.equal(await workspace.locator('.query-tab-status[data-status="no-results"]').count(),1);
        assert.equal(await workspace.getByRole('button',{name:'Rerun query',exact:true}).filter({visible:true}).count(),1);
        for (const width of [1050,390]) {
          await workspace.setViewportSize({width,height:850});
          await workspace.locator('nav a[href="#seeds-section"]').click();
          await workspace.fill('#seeds','one\ntwo\nthree\nfour\nfive'); await workspace.fill('#tuple-count','2');
          await workspace.click('#generate-tuples');
          await workspace.waitForFunction(() => document.querySelector('#tuple-status').textContent.startsWith('2 unique tuples'));
          await workspace.waitForFunction(() => { const box=document.querySelector('#tuples-label').getBoundingClientRect(), header=document.querySelector('.workspace-header').getBoundingClientRect(); return box.top>=header.bottom && box.top<header.bottom+40; });
          assert.equal(await workspace.evaluate(() => document.documentElement.scrollWidth>innerWidth),false);
        }
        await workspace.evaluate(() => testQueryUI.destroy());
        await workspace.setViewportSize({width:1050,height:850});

        await workspace.reload();
        assert.equal(await workspace.locator('#project-section .workspace-panel').evaluate(panel => panel.open), true);
        await workspace.locator('#project-section .workspace-panel > summary').focus(); await workspace.keyboard.press('Enter');
        assert.equal(await workspace.locator('#project-section .workspace-panel').evaluate(panel => panel.open), false);
        await workspace.locator('nav a[href="#project-section"]').click();
        assert.equal(await workspace.locator('#project-section .workspace-panel').evaluate(panel => panel.open), true);
        await workspace.locator('nav a[href="#review-section"]').click();
        await workspace.evaluate(() => {
          document.querySelector('#documents-count').textContent = '20 documents';
          document.querySelector('#included-count').textContent = '15 included';
        });
        assert.equal(await workspace.locator('#documents-section').evaluate(panel => panel.open), true);
        await workspace.locator('#documents-section > summary').focus(); await workspace.keyboard.press('Enter');
        assert.equal(await workspace.locator('#documents-section').evaluate(panel => panel.open), false);
        assert.equal(await workspace.locator('#documents-section table').isVisible(), false);
        assert.equal(await workspace.locator('#documents-count').isVisible(), true);
        assert.equal(await workspace.locator('#included-count').innerText(), '15 included');
        await workspace.keyboard.press('Space');
        assert.equal(await workspace.locator('#documents-section table').isVisible(), true);
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
        await workspace.reload(); await workspace.locator('#project-choice-dialog[open]').waitFor();
        assert.equal(await workspace.locator('#project-choice-close').isVisible(), true);
        await workspace.keyboard.press('Escape');
        assert.equal(await workspace.locator('#project-choice-dialog[open]').count(), 1);
        for (const width of [1050, 500, 390, 320]) {
          await workspace.setViewportSize({ width, height: 850 });
          const layout = await workspace.locator('#project-choice-dialog .actions').evaluate(actions => {
            const bounds = actions.getBoundingClientRect(), rows = new Map();
            for (const button of actions.querySelectorAll('button')) {
              const box = button.getBoundingClientRect(), key = Math.round(box.top);
              const row = rows.get(key) || []; row.push(box); rows.set(key, row);
            }
            return { offsets: [...rows.values()].map(row => Math.abs((Math.min(...row.map(b => b.left)) + Math.max(...row.map(b => b.right))) / 2 - (bounds.left + bounds.right) / 2)),
              overflow: actions.scrollWidth > actions.clientWidth };
          });
          assert.ok(layout.offsets.every(offset => offset < 2), `${name}: centered welcome rows at ${width}px: ${JSON.stringify(layout)}`);
          assert.equal(layout.overflow, false);
        }
        // Resume the isolated disclosure/layout checks without an open modal.
        await workspace.evaluate(() => { document.querySelector('#project-choice-dialog').close(); document.querySelector('#project-dialog').showModal(); });
        await workspace.locator('#project-dialog-name').focus();
        const focusGap = await workspace.evaluate(() => {
          const input = document.querySelector('#project-dialog-name'), label = document.querySelector('label[for="project-dialog-language"]');
          const style = getComputedStyle(input);
          return label.getBoundingClientRect().top - input.getBoundingClientRect().bottom - parseFloat(style.outlineWidth) - parseFloat(style.outlineOffset);
        });
        assert.ok(focusGap >= 8, `${name}: name focus ring must clear the language label: ${focusGap}`);
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
        // Real collection UI and layout: final tab status changes before navigation,
        // collapsed destinations, wrapped sticky menu, fast completion and partial work.
        for (const width of [1050, 390]) {
          await workspace.setViewportSize({ width, height: 850 });
          for (const outcome of ['success', 'fast', 'partial', 'stopped']) {
            await workspace.evaluate(async outcome => {
              const { initProjectTabsUI } = await import('./project-tabs-ui.js');
              const { SEARCH_TABS_KEY } = await import('./project-search-tabs.js');
              const batch = { id: outcome, total: 1, processed: 1, saved: 1, closed: 1, leftOpen: 0, skipped: 0, running: false };
              const final = { ok: true, count: 0, loaded: 0, tabs: [], batch };
              if (outcome === 'partial') { final.count = final.loaded = 1; batch.closed = 0; batch.leftOpen = 1; }
              if (outcome === 'stopped') batch.stopped = true;
              let current = { ok: true, count: 1, loaded: 1, tabs: [], batch: null }, changed;
              chrome.storage = { onChanged: { addListener(fn) { changed = fn; } } };
              chrome.runtime.sendMessage = async message => {
                if (message.type === 'collect-project-search-tabs') {
                  current = outcome === 'fast' ? final : { ...current, batch: { ...batch, running: true, processed: 0 } };
                  return current;
                }
                return current;
              };
              globalThis.collectionTest = initProjectTabsUI({ getProjectId: () => 'collection-fixture', onState: value => {
                if (value.batch && !value.batch.running) document.querySelector('#query-summary').textContent = 'Query status updated. '.repeat(100);
              } });
              globalThis.finishCollectionTest = () => { current = final; changed({ [SEARCH_TABS_KEY]: {} }, 'session'); };
              document.querySelector('#urls-section .workspace-panel').open = false;
              document.querySelector('#review-section .workspace-panel').open = false;
              document.querySelector('#search-section .workspace-panel').open = true;
              document.querySelector('#search-section').scrollIntoView({ behavior: 'instant' });
            }, outcome);
            await workspace.waitForFunction(() => !document.querySelector('#collect-project-tabs').disabled);
            const before = await workspace.evaluate(() => scrollY);
            await workspace.locator('#collect-project-tabs').evaluate(button => button.click());
            await workspace.evaluate(() => finishCollectionTest());
            await workspace.waitForFunction(() => document.querySelector('#project-tab-status').textContent.startsWith('Finished.') || document.querySelector('#project-tab-status').textContent.startsWith('Stopped.'));
            if (['success', 'fast'].includes(outcome)) {
              await workspace.waitForFunction(() => {
                const urls = document.querySelector('#urls-section'), bar = document.querySelector('.topbar').getBoundingClientRect();
                return urls.querySelector('.workspace-panel').open && document.querySelector('#review-section .workspace-panel').open &&
                  urls.getBoundingClientRect().top >= bar.bottom && urls.getBoundingClientRect().top < bar.bottom + 80;
              });
              // Move away first: re-scrolling to the same target is otherwise
              // indistinguishable from no navigation. Firefox can round the
              // anchored position by a pixel while disclosure layout settles.
              await workspace.evaluate(() => window.scrollBy({ top: -100, behavior: 'instant' }));
              await workspace.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              const y = await workspace.evaluate(() => scrollY);
              await workspace.evaluate(() => finishCollectionTest());
              await workspace.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              assert.ok(Math.abs(await workspace.evaluate(() => scrollY) - y) <= 2, `${name}: collection refresh must not repeat navigation`);
              assert.doesNotMatch(await workspace.locator('#project-tab-status').innerText(), /0 left open|0 skipped/);
              assert.equal(await workspace.locator('.collection-details').evaluate(panel => panel.open), false);
            } else {
              assert.equal(await workspace.locator('#urls-section .workspace-panel').evaluate(panel => panel.open), false);
              assert.ok(Math.abs(await workspace.evaluate(() => scrollY) - before) <= 2, `${name}: partial/stopped collection stays for review`);
            }
            await workspace.evaluate(() => collectionTest.destroy());
          }
        }
        await workspace.setViewportSize({ width: 1050, height: 850 });
        console.log(`${name}: WP2 preference persistence, Settings synchronization and save failure passed.`);
        console.log(`${name}: WP1 welcome layout, focus spacing, engine colors, document disclosure and collection navigation passed.`);
        // Collection scenarios replace the runtime fixture. Restore the Settings
        // fixture before exercising the new project controls.
        await workspace.reload();
        await openSettings();
        assert.equal(await workspace.locator('#urls-section #extractor').count(),0);
        await workspace.fill('#project-minimum-characters','500');
        await workspace.fill('#project-maximum-characters','100');
        await workspace.click('#project-corpus-settings-save');
        assert.match(await workspace.locator('#project-corpus-settings-status').innerText(),/Minimum characters cannot exceed/);
        await workspace.fill('#project-maximum-characters','1000');
        await workspace.selectOption('#extractor','defuddle');
        await workspace.selectOption('#project-language-detector','native');
        await workspace.click('#project-corpus-settings-save');
        await workspace.locator('#settings-dialog[open]').waitFor({state:'hidden'});
        await openSettings();
        const savedFileLimit = await workspace.inputValue('#setting-fileMiB');
        await workspace.fill('#project-minimum-characters','600'); await workspace.fill('#setting-fileMiB','99');
        const settingsClose = workspace.getByRole('button',{name:'Close Settings without saving',exact:true});
        assert.equal(await settingsClose.innerText(),'×');
        for (const width of [1050,390,320]) {
          await workspace.setViewportSize({width,height:850});
          await workspace.locator('#settings-dialog').evaluate(dialog=>{dialog.scrollTop=0;});
          const box = await settingsClose.evaluate(button=>({button:button.getBoundingClientRect().toJSON(),title:document.querySelector('#settings-title').getBoundingClientRect().toJSON(),dialog:button.closest('dialog').getBoundingClientRect().toJSON()}));
          assert.ok(box.button.left>=box.title.right && box.dialog.right-box.button.right<60,`${name}: close control at top right`);
          assert.equal(await workspace.locator('#settings-dialog').evaluate(dialog=>dialog.scrollWidth>dialog.clientWidth),false);
        }
        await settingsClose.focus(); await workspace.keyboard.press('Enter');
        await workspace.locator('#settings-dialog[open]').waitFor({state:'hidden'});
        assert.equal(await workspace.locator('#open-settings').evaluate(button=>button===document.activeElement),true);
        await workspace.setViewportSize({width:1050,height:850}); await openSettings();
        assert.equal(await workspace.inputValue('#project-minimum-characters'),'500');
        assert.equal(await workspace.inputValue('#project-language-detector'),'native');
        assert.equal(await workspace.inputValue('#setting-fileMiB'),savedFileLimit,'close discards personal draft too');
        await workspace.click('#project-corpus-settings-defaults');
        await workspace.waitForFunction(()=>document.querySelector('#project-corpus-settings-status').textContent==='Defaults saved for new projects.');
        assert.equal(await workspace.inputValue('#setting-defaultMinimumCharacters'),'500');
        assert.equal(await workspace.inputValue('#setting-defaultLanguageDetector'),'native');
        await workspace.click('#settings-cancel'); await openSettings();
        assert.equal(await workspace.inputValue('#project-minimum-characters'),'500');
        assert.equal(await workspace.inputValue('#project-language-detector'),'native');
        assert.equal(await workspace.inputValue('#extractor'),'defuddle');
        await workspace.fill('#project-minimum-characters',''); await workspace.fill('#project-maximum-characters','');
        await workspace.click('#project-corpus-settings-save');
        await workspace.locator('#settings-dialog[open]').waitFor({state:'hidden'});
        await openSettings();
        await workspace.click('#settings-reset'); await workspace.click('#settings-save');
        await workspace.locator('#settings-dialog[open]').waitFor({state:'hidden'});
        console.log(`${name}: WP6 project range validation, extractor persistence and new-project defaults passed.`);
        const detectorContract = await workspace.evaluate(async () => {
          const {checkLanguage} = await import('./language-detection.js');
          const {nativeSupports} = await import('./language-detectors/native.js');
          const text = 'Scientific prose describes flower development and compares the structure of leaves, stems and reproductive organs. Researchers record observations and publish their conclusions. '.repeat(40);
          const extraction = {status:'ok',included:true,text,characters:text.length,warnings:[]};
          const browserInfo = {name:'Firefox',version:'140.0'};
          const api = {i18n:{detectLanguage:async()=>({isReliable:true,languages:[{language:'en',percentage:100}]})}};
          const assessed = await checkLanguage(extraction,'eng',{strategy:'native-franc',api,browserInfo});
          const unavailable = await checkLanguage(extraction,'qug',{strategy:'native',api,browserInfo});
          const fallback = await checkLanguage(extraction,'eng',{strategy:'native-franc',api:{},browserInfo});
          return {check:assessed.languageCheck, unavailable:unavailable.languageCheck, fallback:fallback.languageCheck,latin:nativeSupports('lat',browserInfo)};
        });
        assert.equal(detectorContract.check.detector.id,'native');
        assert.equal(detectorContract.check.samples.length,3);
        assert.equal(detectorContract.check.samples[0].native.languages[0].percentage,100);
        assert.equal(detectorContract.unavailable.unavailable,true);
        assert.equal(detectorContract.fallback.detector.id,'franc');
        assert.equal(detectorContract.latin,false);
        console.log(`${name}: WP7 detector selection/defaults and native contract/fallback metadata passed (fixtures, not accuracy evaluation).`);
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
        // Failed/unsupported originals stay intact while pasted text becomes usable.
        for (const [kind,width] of [['pdf',1050],['html',390],['unsupported',390]]) {
          await workspace.setViewportSize({width,height:850});
          await workspace.evaluate(async kind => {
            const storage=await import('./project-store.js');
            const url='https://example.org/failed-'+kind, filename='pages/failed-'+kind+'.bin';
            await storage.saveDocument('text-dialog',{url,filename,outcome:'downloaded'}, {url,filename,textFilename:'corpus/failed-'+kind+'.txt',extraction:{status:kind==='unsupported'?'unsupported':'failed',included:false,text:'',characters:0,warnings:['Original extraction failed'],extractor:kind==='pdf'?'pdfjs':'fixture'}},new Blob(['Original '+kind]));
            await testTextReview.open(url);
          },kind);
          await workspace.locator('#text-review-dialog[open]').waitFor();
          assert.equal(await workspace.locator('#text-review-edit').isEnabled(),true);
          await workspace.click('#text-review-edit'); await workspace.fill('#preview-text','Cancelled recovery'); await workspace.click('#text-review-edit');
          assert.equal(await workspace.inputValue('#preview-text'),'');
          await workspace.click('#text-review-edit'); await workspace.fill('#preview-text','Pasted café 中文 🐱 text.'); await workspace.click('#text-review-save');
          await workspace.waitForFunction(()=>document.querySelector('#text-review-status').textContent==='Text recovered');
          const recovered=await workspace.evaluate(async kind=>{
            const storage=await import('./project-store.js'), url='https://example.org/failed-'+kind;
            const entry=(await storage.readDownloadTarget('text-dialog',url)).entry;
            return {extraction:entry.doc.extraction,original:await(await storage.readOriginal('text-dialog',entry.doc.filename)).text(),baseline:await(await storage.readOriginalText('text-dialog',url)).text(),text:await(await storage.readText('text-dialog',url)).text()};
          },kind);
          assert.equal(recovered.extraction.status,'ok'); assert.equal(recovered.extraction.textSource,'manual');
          assert.equal(recovered.extraction.recovery.previousExtraction.status,kind==='unsupported'?'unsupported':'failed');
          assert.equal(recovered.original,'Original '+kind); assert.equal(recovered.baseline,''); assert.equal(recovered.text,'Pasted café 中文 🐱 text.');
          assert.equal(await workspace.locator('#text-review-dialog').evaluate(dialog=>dialog.scrollWidth>dialog.clientWidth),false);
          await workspace.click('#text-review-close');
        }
        await workspace.evaluate(async()=>{
          const {createManualIndicator}=await import('./manual-intervention.js');
          const indicator=createManualIndicator({record:{outcome:'captured',source:'local-file'},doc:{extraction:{languageCheck:{accepted:true}}}});
          indicator.id='hand-fixture'; document.body.append(indicator);
        });
        const hand=workspace.locator('#hand-fixture');
        assert.equal(await hand.getAttribute('title'),'Imported file; Language warning accepted');
        await hand.focus(); assert.equal(await hand.evaluate(node=>document.activeElement===node),true);
        const handSize=await hand.locator('svg').boundingBox(); assert.equal(handSize.width,16); assert.equal(handSize.height,16);
        await hand.evaluate(node=>node.remove());
        console.log(`${name}: failed PDF/HTML and unsupported text recovery, cancellation, Unicode and original preservation passed.`);
        // Real recovery controller: nested table scrolling, disclosure layout,
        // retained messages, reduced motion and deferral behind a dirty editor.
        await workspace.evaluate(async () => {
          const { initRecoveryFeedback } = await import('./recovery-feedback.js');
          const rows = new Map();
          document.querySelector('#results').replaceChildren();
          for (let index = 0; index < 24; index++) {
            const row = document.createElement('tr'); row.dataset.recovery = String(index);
            for (const value of ['Include', 'https://example.org/document/' + index, 'Recovered document text and extraction details.', 'Delete']) {
              const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
            }
            document.querySelector('#results').append(row); rows.set(String(index), row);
          }
          const issue = document.createElement('tr'); issue.dataset.recovery = 'issue';
          const cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = 'Text recovered, but a language warning remains.'; issue.append(cell);
          document.querySelector('#problem-results').replaceChildren(issue); rows.set('issue', issue);
          globalThis.recoveryRows = rows;
          globalThis.testRecovery = initRecoveryFeedback({ getRow: url => rows.get(url), isBlocked: () => !!document.querySelector('dialog[open]') });
        });
        for (const width of [1050, 390]) {
          await workspace.setViewportSize({ width, height: 850 });
          await workspace.evaluate(() => {
            document.querySelector('#review-section .workspace-panel').open = false;
            document.querySelector('#documents-section').open = false;
          });
          await workspace.locator('nav a[href="#project-section"]').focus();
          await workspace.evaluate(() => { globalThis.recoveryFocus = document.activeElement; testRecovery.show({ url: '23', tone: 'success' }); });
          await workspace.waitForFunction(() => {
            const row = recoveryRows.get('23').getBoundingClientRect(), header = document.querySelector('.workspace-header').getBoundingClientRect();
            return recoveryRows.get('23').classList.contains('recovery-success') && row.top >= header.bottom && row.bottom <= innerHeight;
          });
          assert.equal(await workspace.evaluate(() => document.activeElement === recoveryFocus), true, `${name}: recovery must not steal focus`);
          assert.ok(await workspace.locator('#documents-section .table-wrap').evaluate(wrap => wrap.scrollTop) > 0, `${name}: scroll the table to the recovered row`);
          assert.equal(await workspace.locator('#documents-section').evaluate(panel => panel.open), true);
          await workspace.evaluate(() => {
            const old = recoveryRows.get('23'), next = old.cloneNode(true);
            next.className = ''; old.replaceWith(next); recoveryRows.set('23', next); testRecovery.apply(next, '23');
          });
          assert.equal(await workspace.locator('tr[data-recovery="23"]').evaluate(row => row.classList.contains('recovery-success')), true, `${name}: highlight survives row replacement`);
          await workspace.waitForFunction(() => !recoveryRows.get('23').classList.contains('recovery-success'));
        }
        await workspace.emulateMedia({ reducedMotion: 'reduce' });
        await workspace.evaluate(() => testRecovery.show({ url: '23', tone: 'success' }));
        await workspace.waitForFunction(() => recoveryRows.get('23').classList.contains('recovery-success'));
        assert.equal(await workspace.locator('tr[data-recovery="23"] td').first().evaluate(cell => getComputedStyle(cell).animationName), 'none');
        assert.equal(await workspace.locator('tr[data-recovery="23"] td').first().evaluate(cell => getComputedStyle(cell).backgroundColor), 'rgb(220, 252, 231)');
        await workspace.evaluate(() => testRecovery.show({ url: '23', tone: 'warning' }));
        await workspace.waitForFunction(() => recoveryRows.get('23').classList.contains('recovery-attention'));
        await workspace.evaluate(() => testRecovery.show({ url: '23', tone: 'success' }));
        await workspace.waitForFunction(() => recoveryRows.get('23').classList.contains('recovery-success') && !recoveryRows.get('23').classList.contains('recovery-attention'));
        assert.equal(await workspace.locator('tr[data-recovery="23"] td').first().evaluate(cell => getComputedStyle(cell).backgroundColor), 'rgb(220, 252, 231)', `${name}: retry uses the latest outcome color`);
        await workspace.emulateMedia({ reducedMotion: 'no-preference' });
        await workspace.evaluate(() => { document.querySelector('#attention-section').open = false; testRecovery.show({ url: 'issue', tone: 'warning' }); });
        await workspace.waitForFunction(() => recoveryRows.get('issue').classList.contains('recovery-attention'));
        assert.equal(await workspace.locator('#attention-section').evaluate(panel => panel.open && !panel.hidden), true);
        await workspace.evaluate(async () => {
          document.querySelector('#documents-section').open = false;
          await testTextReview.open('https://example.org/article');
        });
        await workspace.locator('#text-review-edit').click(); await workspace.fill('#preview-text', 'Keep this unsaved edit.');
        const recoveryScroll = await workspace.evaluate(() => scrollY);
        await workspace.evaluate(() => testRecovery.show({ url: '23', tone: 'success' }));
        assert.equal(await workspace.inputValue('#preview-text'), 'Keep this unsaved edit.');
        assert.equal(await workspace.evaluate(() => scrollY), recoveryScroll, `${name}: no scrolling behind an open editor`);
        assert.equal(await workspace.locator('#documents-section').evaluate(panel => panel.open), false);
        await workspace.locator('#text-review-edit').click(); await workspace.locator('#text-review-close').click();
        await workspace.waitForFunction(() => recoveryRows.get('23').classList.contains('recovery-success') && document.querySelector('#documents-section').open);
        await workspace.evaluate(() => testRecovery.destroy());
        console.log(`${name}: recovery row navigation, transient highlights, focus, reduced motion and editor deferral passed.`);
        // Browser-native DataTransfer/File events exercise both engines' drop
        // plumbing, including real signature validation and navigation guards.
        const dropPage = await browser.newPage({ viewport: { width: 1050, height: 850 } });
        await dropPage.route('**/settings-ui.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        await dropPage.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: `
          import { bindImportFileDrop, guardFileDropNavigation } from './import-file-drop.js';
          import { readImportedDocument } from './document-formats.js';
          import { pdfFixture } from './tests/browser-tests.fixtures.js';
          import { initWorkspaceSections } from './workspace-sections.js';
          initWorkspaceSections();
          document.querySelector('#review-section .workspace-panel').open = true;
          document.querySelector('#attention-section').hidden = false; document.querySelector('#attention-section').open = true;
          const row = document.createElement('tr'), cell = document.createElement('td'), button = document.createElement('button');
          cell.colSpan = 4; button.className = 'secondary import-document-button'; button.textContent = 'Import downloaded file'; button.id = 'drop-import';
          const hint = document.createElement('span'); hint.className = 'file-drop-hint'; hint.textContent = 'or drop here'; cell.append(button, hint); row.append(cell); document.querySelector('#problem-results').append(row);
          const status = document.querySelector('#document-import-status'); document.querySelector('#document-import-feedback').hidden = false;
          const fixture = globalThis.dropFixture = { imports: 0, busy: false, name: '', bytes: 0 };
          bindImportFileDrop({ button, canImport: () => !fixture.busy, onError: message => { status.textContent = message; }, onFile: async file => {
            const result = await readImportedDocument(file); fixture.imports++; fixture.name = result.format.id; fixture.bytes = result.bytes.length; status.textContent = 'Download recovered';
          } });
          guardFileDropNavigation({ root: window, onOutsideDrop: () => { status.textContent = 'Drop the file on an Import downloaded file button.'; } });
          fixture.transfer = mode => {
            const transfer = new DataTransfer();
            if (mode === 'link') transfer.setData('text/uri-list', 'https://example.org/document.pdf');
            else {
              transfer.items.add(new File([mode === 'invalid' ? '<html>Sign in</html>' : pdfFixture()], 'recovery.data', { type: 'application/octet-stream' }));
              if (mode === 'multiple') transfer.items.add(new File([pdfFixture()], 'second.pdf', { type: 'application/pdf' }));
              if (mode === 'mixed') transfer.setData('text/uri-list', 'https://example.org/document.pdf');
            }
            return transfer;
          };
          fixture.event = (type, mode, outside = false) => {
            const event = new DragEvent(type, { dataTransfer: fixture.transfer(mode), bubbles: true, cancelable: true });
            (outside ? document.body : button).dispatchEvent(event); return event.defaultPrevented;
          };
          globalThis.dropReady = true;
        ` }));
        await dropPage.goto(`http://127.0.0.1:${server.address().port}/downloader.html`); await dropPage.waitForFunction(() => globalThis.dropReady);
        assert.equal(await dropPage.evaluate(() => dropFixture.event('dragover', 'file')), true);
        assert.equal(await dropPage.locator('#drop-import').evaluate(button => button.classList.contains('file-drop-active')), true);
        assert.equal(await dropPage.locator('.file-drop-hint').innerText(), 'or drop here');
        await dropPage.evaluate(() => document.querySelector('#drop-import').dispatchEvent(new DragEvent('dragleave', { bubbles: true })));
        assert.equal(await dropPage.locator('#drop-import').evaluate(button => button.classList.contains('file-drop-active')), false);
        for (const [mode, message] of [['multiple', 'one file at a time'], ['link', 'not a link'], ['invalid', 'Unsupported file contents']]) {
          assert.equal(await dropPage.evaluate(mode => dropFixture.event('drop', mode), mode), true);
          await dropPage.waitForFunction(message => document.querySelector('#document-import-status').textContent.includes(message), message);
          assert.equal(await dropPage.evaluate(() => dropFixture.imports), 0);
        }
        await dropPage.evaluate(() => { dropFixture.busy = true; dropFixture.event('drop', 'file'); });
        assert.match(await dropPage.locator('#document-import-status').innerText(), /finish processing/);
        await dropPage.evaluate(() => { dropFixture.busy = false; dropFixture.event('drop', 'mixed'); });
        await dropPage.waitForFunction(() => dropFixture.imports === 1);
        assert.equal(await dropPage.evaluate(() => dropFixture.name), 'pdf', `${name}: actual bytes determine format`);
        assert.equal(await dropPage.locator('#document-import-status').innerText(), 'Download recovered');
        assert.equal(await dropPage.locator('#drop-import').evaluate(button => button.classList.contains('file-drop-active')), false);
        const dropURL = dropPage.url();
        assert.equal(await dropPage.evaluate(() => dropFixture.event('drop', 'file', true)), true);
        assert.equal(await dropPage.url(), dropURL); assert.equal(await dropPage.evaluate(() => dropFixture.imports), 1);
        assert.match(await dropPage.locator('#document-import-status').innerText(), /on an Import downloaded file button/);
        for (const width of [1050, 390]) { await dropPage.setViewportSize({ width, height: 850 }); assert.equal(await dropPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }
        await dropPage.close();
        console.log(`${name}: native file drops, mixed metadata, invalid/multiple/link rejection, busy guards and navigation protection passed.`);
        // Native sticky progress and completion in both browser engines. The
        // real background feedback controller is exercised with local fixtures.
        const feedbackPage = await browser.newPage({ viewport: { width: 1050, height: 850 } });
        await feedbackPage.route('**/settings-ui.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        await feedbackPage.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: `
          import { initWorkspaceSections } from './workspace-sections.js';
          import { createDownloadFeedback } from './download-feedback.js';
          import { initDownloadFeedbackUI } from './download-feedback-ui.js';
          initWorkspaceSections();
          for (const panel of document.querySelectorAll('.workspace-panel')) panel.open = true;
          const data = {}, listeners = [], badge = globalThis.feedbackBadge = {}; globalThis.feedbackEntries=[]; globalThis.feedbackExportSaved=false;
          let tail = Promise.resolve(), service;
          const api = globalThis.chrome = { runtime: { sendMessage: async message => ({ ok: true, ...(message.type === 'get-download-feedback' ? { feedback: await service.sync() } : await service.handle(message)) }) },
            storage: { local: { get: async key => ({ [key]: structuredClone(data[key]) }), set: async patch => {
              Object.assign(data, structuredClone(patch)); for (const [key, newValue] of Object.entries(patch)) for (const fn of listeners) fn({ [key]: { newValue } }, 'local');
            } }, onChanged: { addListener(fn) { listeners.push(fn); } } },
            action: { setBadgeText: async value => { badge.text = value.text; }, setTitle: async value => { badge.title = value.title; } } };
          service = globalThis.feedbackService = createDownloadFeedback({ ext: api, getProject: async () => ({ id: 'progress' }), getEntries:async()=>globalThis.feedbackEntries, batchActive: async () => true,
            serialize: task => { const next = tail.then(task); tail = next.catch(() => {}); return next; } });
          globalThis.feedbackUI = initDownloadFeedbackUI({ getProjectId: () => 'progress', getCorpusState: () => ({ included:feedbackEntries.filter(e=>e.doc?.extraction.included).length, exportSaved:feedbackExportSaved }) });
          globalThis.feedbackSignal = async (type, patch = {}) => api.runtime.sendMessage({ type: 'download-feedback-' + type, projectId: 'progress', runId: 'run', ...patch });
          globalThis.feedbackReady = true;
        ` }));
        await feedbackPage.goto(`http://127.0.0.1:${server.address().port}/downloader.html`);
        await feedbackPage.waitForFunction(() => globalThis.feedbackReady);
        for (const width of [1050, 390]) {
          await feedbackPage.setViewportSize({ width, height: 850 });
          await feedbackPage.evaluate(async () => { await feedbackSignal('start', { total: 2 }); await feedbackSignal('progress', { phase: 'extracting' }); });
          assert.equal(await feedbackPage.locator('#dismiss-download-feedback').isVisible(),false);
          assert.equal(await feedbackPage.locator('#header-download-progress').evaluate(bar => bar.value), 0, `${name}: extraction still pending`);
          assert.match(await feedbackPage.locator('#download-feedback-summary').innerText(), /Extracting text 1 of 2/);
          await feedbackPage.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
          await feedbackPage.waitForFunction(() => {
            const header = document.querySelector('.workspace-header').getBoundingClientRect();
            const nav = document.querySelector('.topbar').getBoundingClientRect(), strip = document.querySelector('#download-feedback-strip').getBoundingClientRect();
            return Math.abs(header.top) < 1 && Math.abs(strip.top - nav.bottom) < 1 && parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) >= header.height + 15;
          });
          assert.equal(await feedbackPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: sticky progress overflow at ${width}px`);
          await feedbackPage.evaluate(() => { feedbackEntries=[{doc:null}]; return feedbackSignal('finish', { state: 'finished', processed: 2, usable: 1, failed: 1 }); });
          assert.equal(await feedbackPage.locator('#header-download-progress').isVisible(), false);
          assert.match(await feedbackPage.title(), /Finished with issues/);
          assert.equal(await feedbackPage.evaluate(() => feedbackBadge.text), '!');
          await feedbackPage.locator('#download-run-details').evaluate(details=>{details.open=true});
          assert.match(await feedbackPage.locator('#download-completion-summary').innerText(), /1 failed/);
          await feedbackPage.evaluate(async()=>{feedbackEntries=[{doc:{extraction:{status:'ok',included:false}}}]; await feedbackService.sync();});
          await feedbackPage.waitForFunction(()=>document.querySelector('#download-feedback-strip').dataset.state==='finished');
          assert.equal(await feedbackPage.locator('#download-feedback-summary').innerText(),'No documents included.');
          assert.equal(await feedbackPage.locator('#download-feedback-link').isVisible(),false);
          await feedbackPage.evaluate(()=>{feedbackEntries[0].doc.extraction.included=true; feedbackUI.refresh();});
          assert.equal(await feedbackPage.locator('#download-feedback-summary').innerText(),'Your corpus is ready to export.');
          assert.equal(await feedbackPage.locator('#download-feedback-link').innerText(),'Go to export');
          assert.doesNotMatch(await feedbackPage.locator('#download-feedback-summary').innerText(),/1 failed/);
          assert.equal(await feedbackPage.evaluate(()=>feedbackBadge.text),'✓');
          await feedbackPage.locator('#download-feedback-link').click();
          await feedbackPage.waitForFunction(() => document.querySelector('#project-section').getBoundingClientRect().top >= document.querySelector('.workspace-header').getBoundingClientRect().bottom);
          await feedbackPage.evaluate(()=>{feedbackExportSaved=true; feedbackUI.refresh();});
          assert.equal(await feedbackPage.locator('#download-feedback-summary').innerText(),'Your corpus download has started.');
          assert.equal(await feedbackPage.locator('#download-feedback-link').isVisible(),false);
          await feedbackPage.evaluate(()=>{feedbackExportSaved=false; feedbackUI.refresh();});
          const close = feedbackPage.getByRole('button',{name:'Close download feedback',exact:true});
          assert.equal(await close.innerText(),'×');
          const geometry=await close.evaluate(button=>({button:button.getBoundingClientRect().toJSON(),bar:button.closest('.download-feedback-inner').getBoundingClientRect().toJSON()}));
          assert.ok(geometry.button.top>=geometry.bar.top && geometry.button.top<geometry.bar.top+12);
          assert.ok(geometry.bar.right-geometry.button.right<40);
          await close.focus(); await feedbackPage.keyboard.press('Enter');
          assert.equal(await feedbackPage.locator('#download-feedback-strip').isVisible(), false);
          assert.equal(await feedbackPage.evaluate(() => feedbackBadge.text), '');
          assert.equal(await feedbackPage.title(), 'BootCaT · Corpus workspace');
          assert.match(await feedbackPage.locator('#download-completion-summary').innerText(), /1 failed/);
          await feedbackPage.evaluate(async () => { await feedbackSignal('start', { total: 2 }); await feedbackSignal('finish', { state: 'stopped', processed: 1, cancelled: 1 }); });
          assert.equal(await feedbackPage.evaluate(() => feedbackBadge.text), 'STOP');
          assert.match(await feedbackPage.title(), /Downloads stopped/);
          await feedbackPage.evaluate(async () => { await feedbackSignal('start', { total: 1 }); await feedbackSignal('finish', { state: 'finished', processed: 1, usable: 1 }); });
          assert.equal(await feedbackPage.evaluate(() => feedbackBadge.text), '✓');
          assert.match(await feedbackPage.title(), /Downloads finished/);
        }
        await feedbackPage.close();
        console.log(`${name}: sticky progress, extraction timing, completion, failure counts, dismissal, stopped and clean badges passed.`);
        await workspace.close();
        console.log(`${name}: conditional popup actions, confirmations, advanced disclosure keyboard handling and responsive overflow passed.`);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

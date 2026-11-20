import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { openProjectSearch } from '../src/search-tabs-client.js';
import { SEARCH_TABS_KEY } from '../src/project-search-tabs.js';

test('search opening sends a project-scoped request and surfaces registration failure', async () => {
  const sent = [];
  globalThis.chrome = { runtime: { sendMessage: async message => { sent.push(message); return { ok: true, tabId: 4 }; } } };
  try {
    const result = await openProjectSearch({ projectId: 'p', engine: 'google', query: 'my query', active: false });
    assert.equal(result.tabId, 4); assert.deepEqual(sent, [{ type: 'open-project-search', projectId: 'p', engine: 'google', query: 'my query', active: false }]);
    chrome.runtime.sendMessage = async () => ({ ok: false, error: 'Tab opened but tracking failed' });
    await assert.rejects(openProjectSearch({ projectId: 'p', engine: 'google', query: 'x' }), /tracking failed/);
  } finally { delete globalThis.chrome; }
});

test('project-tab UI shows running/final outcomes and ignores replies from a destroyed project', async () => {
  const source = (await readFile(new URL('../src/project-tabs-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const elements = new Map(), requests = []; let changed, reply = { ok: true, count: 2, batch: null };
  const get = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', children: [], handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
    return elements.get(id);
  };
  const context = vm.createContext({ setTimeout, clearTimeout, openWorkspaceSection() {}, SEARCH_TABS_KEY, getProjectId: () => 'p', document: { getElementById: get, createElement: () => ({}) },
    getExtensionAPI: () => ({ storage: { onChanged: { addListener(fn) { changed = fn; } } }, runtime: { sendMessage: async message => { requests.push(message); return reply; } } }) });
  vm.runInContext(source + '\nglobalThis.ui = initProjectTabsUI({getProjectId});', context);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(get('collect-project-tabs').disabled, false);
  reply = { ok: true, count: 2, batch: { running: true, total: 2, processed: 0, saved: 0, closed: 0, skipped: 0, leftOpen: 0, details: [] } };
  await get('collect-project-tabs').handlers.click();
  assert.ok(requests.some(message => message.type === 'collect-project-search-tabs' && message.projectId === 'p'));
  assert.equal(get('collect-project-tabs').disabled, true); assert.equal(get('stop-project-tabs').hidden, false);
  reply = { ok: true, count: 1, batch: { ...reply.batch, running: false, processed: 2, saved: 1, closed: 1, leftOpen: 1, details: [{ query: 'captcha', reason: 'CAPTCHA: left open' }] } };
  changed({ [SEARCH_TABS_KEY]: {} }, 'session'); await new Promise(resolve => setImmediate(resolve));
  assert.match(get('project-tab-status').textContent, /1 result page saved; 1 tab closed/);
  assert.equal(elements.has('project-tab-details'), false, 'removed Log elements are never accessed');
  const previous = get('project-tab-status').textContent; vm.runInContext('ui.destroy()', context);
  reply = { ok: true, count: 100, batch: null }; changed({ [SEARCH_TABS_KEY]: {} }, 'session');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(get('project-tab-status').textContent, previous);
});

test('only the current fully successful collection jumps to URLs, once; partial, stopped and historical batches stay put', async () => {
  const source = (await readFile(new URL('../src/project-tabs-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const finished = { id: 'batch', running: false, total: 2, processed: 2, saved: 2, closed: 2, leftOpen: 0, skipped: 0, details: [] };
  for (const scenario of [
    { batch: finished, count: 0, jumps: 1 },
    { batch: finished, count: 1, jumps: 0 },
    { batch: { ...finished, closed: 1, leftOpen: 1 }, count: 1, jumps: 0 },
    { batch: { ...finished, closed: 1, skipped: 1 }, count: 0, jumps: 0 },
    { batch: { ...finished, stopped: true }, count: 0, jumps: 0 },
    { batch: { ...finished, interrupted: true }, count: 0, jumps: 0 },
    { batch: finished, count: 0, jumps: 1, fast: true }
  ]) {
    const elements = new Map(), jumps = []; let changed, reply = { ok: true, count: 0, batch: finished };
    const get = id => {
      if (!elements.has(id)) elements.set(id, { handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() {}, append() {} });
      return elements.get(id);
    };
    const context = vm.createContext({ setTimeout, clearTimeout, SEARCH_TABS_KEY, getProjectId: () => 'p', document: { getElementById: get, createElement: () => ({}) },
      openWorkspaceSection: (id, options = {}) => jumps.push([id, !!options.scroll]),
      getExtensionAPI: () => ({ storage: { onChanged: { addListener(fn) { changed = fn; } } }, runtime: { sendMessage: async () => reply } }) });
    vm.runInContext(source + '\nglobalThis.ui = initProjectTabsUI({getProjectId});', context);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(jumps.length, 0, 'restoring a historical completion must not jump');
    reply = { ok: true, count: 2, batch: { ...finished, running: true } };
    if (scenario.fast) reply = { ok: true, count: scenario.count, batch: scenario.batch };
    await get('collect-project-tabs').handlers.click();
    reply = { ok: true, count: scenario.count, batch: scenario.batch };
    changed({ [SEARCH_TABS_KEY]: {} }, 'session'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(jumps.length, scenario.jumps * 2);
    if (scenario.jumps) assert.deepEqual(jumps, [['review-section', false], ['urls-section', true]]);
    changed({ [SEARCH_TABS_KEY]: {} }, 'session'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(jumps.length, scenario.jumps * 2, 'refresh must not repeat a jump');
  }
});

test('collection waits for loading and opening; slow-tab fallback is explicit and manual closure unblocks it', async () => {
  const source = (await readFile(new URL('../src/project-tabs-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const elements = new Map(), requests = [];
  let reply = { ok: true, count: 2, loaded: 1, loading: 1, tabs: [{ status: 'loading', slow: false }], batch: null };
  const get = id => {
    if (!elements.has(id)) elements.set(id, { handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() {}, append() {} });
    return elements.get(id);
  };
  const context = vm.createContext({ setTimeout, clearTimeout, SEARCH_TABS_KEY, getProjectId: () => 'p', openWorkspaceSection() {},
    document: { getElementById: get, createElement: () => ({}) },
    getExtensionAPI: () => ({ storage: { onChanged: { addListener() {} } }, runtime: { sendMessage: async message => { requests.push(message); return reply; } } }) });
  vm.runInContext(source + '\nglobalThis.ui = initProjectTabsUI({getProjectId});', context);
  await new Promise(resolve => setImmediate(resolve));
  const ui = vm.runInContext('ui', context);
  assert.equal(get('collect-project-tabs').disabled, true); assert.equal(get('collect-loaded-tabs').hidden, true);
  reply.tabs[0].slow = true; await ui.refresh();
  assert.equal(get('collect-loaded-tabs').hidden, false); assert.equal(get('collect-loaded-tabs').disabled, false);
  ui.setOpening(true); assert.equal(get('collect-loaded-tabs').disabled, true);
  ui.setOpening(false); await get('collect-loaded-tabs').handlers.click();
  assert.ok(requests.some(message => message.type === 'collect-project-search-tabs' && message.loadedOnly === true));
  reply = { ok: true, count: 1, loaded: 1, loading: 0, tabs: [{ status: 'loaded' }], batch: null };
  await ui.refresh(); assert.equal(get('collect-project-tabs').disabled, false);
  ui.setOpening(true); assert.equal(get('collect-project-tabs').disabled, true);
  ui.setOpening(false); assert.equal(get('collect-project-tabs').disabled, false);
  reply = { ok: true, count: 0, loaded: 0, loading: 0, tabs: [], batch: null };
  await ui.refresh(); assert.equal(get('collect-project-tabs').disabled, true);
  ui.destroy();
});

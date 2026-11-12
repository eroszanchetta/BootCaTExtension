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
  const context = vm.createContext({ SEARCH_TABS_KEY, getProjectId: () => 'p', document: { getElementById: get, createElement: () => ({}) },
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
  assert.equal(get('project-tab-details').children[0].textContent, 'captcha: CAPTCHA: left open');
  const previous = get('project-tab-status').textContent; vm.runInContext('ui.destroy()', context);
  reply = { ok: true, count: 100, batch: null }; changed({ [SEARCH_TABS_KEY]: {} }, 'session');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(get('project-tab-status').textContent, previous);
});

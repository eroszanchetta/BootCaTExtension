import { loadWorkspace, saveDraft } from '../src/project-store.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { COLLECTION_CONTROLS_KEY } from '../src/collection-preferences.js';
import { readSavedPages } from '../src/page-store.js';
import { adapterForURL } from '../src/engines.js';
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
async function fixture(namespace, label) {
  globalThis.indexedDB = new IDBFactory();
  let listener, nextId = 10, captures = 0, unresolved = 0, refuseClose = false;
  const local = {}, session = {}, removed = [], changed = event(), tabs = new Map([[1, { id: 1, url: 'https://example.org/article', status: 'complete' }], [2, { id: 2, url: 'https://other.test', status: 'complete' }]]);
  const origin = `${namespace === 'browser' ? 'moz' : 'chrome'}-extension://controls/`;
  const area = (values, name) => ({ get: async key => key === null ? structuredClone(values) : { [key]: structuredClone(values[key]) }, set: async patch => { const changes = {}; for (const [key, value] of Object.entries(patch)) changes[key] = { oldValue: values[key], newValue: value }; Object.assign(values, structuredClone(patch)); changed.emit(changes, name); }, remove: async keys => { for (const key of keys) delete values[key]; } });
  const ext = globalThis[namespace] = {
    runtime: { id: 'controls', getURL: path => origin + path, onMessage: { addListener(fn) { listener = fn; } }, getContexts: async () => [{ documentUrl: origin + 'downloader.html', tabId: 999 }] },
    storage: { local: area(local, 'local'), session: area(session, 'session'), onChanged: changed },
    tabs: { onUpdated: event(), onRemoved: event(), onReplaced: event(), get: async id => { if (id === 999) return { id, url: origin + 'downloader.html', status: 'complete' }; if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; },
      query: async () => [...tabs.values()], sendMessage: async () => ({}),
      create: async value => { const tab = { ...value, id: nextId++, status: 'complete' }; tabs.set(tab.id, tab); return { ...tab }; },
      remove: async id => {
        if (refuseClose) throw new Error('Browser refused closure');
        const tab = tabs.get(id);
        assert.ok(local.collections?.some(item => item.pageURL === tab.url) || (await readSavedPages()).some(page => page.url === tab.url), 'source or collection must be stored before closing');
        tabs.delete(id); removed.push(id); ext.tabs.onRemoved.emit(id);
      }
    },
    scripting: { executeScript: async ({ target, func }) => {
      const tab = tabs.get(target.tabId);
      if (func.name === 'extractResults') return [{ result: { engine: adapterForURL(tab.url).id, pageURL: tab.url, query: new URL(tab.url).searchParams.get('q'), unresolved, results: [{ url: 'https://corpus.test/article', title: 'Article' }] } }];
      captures++; return [{ result: { url: tab.url, html: '<html><body><p>Safely stored original</p></body></html>', capturedAt: new Date().toISOString() } }];
    } }
  };
  await import(`../src/background.js?collection-controls=${namespace}-${label}`);
  const send = (message, sender = { id: 'controls', url: origin + 'popup.html' }) => new Promise(resolve => { if (listener(message, sender, resolve) !== true) resolve(undefined); });
  const content = (message, patch = {}) => send(message, { id: 'controls', url: tabs.get(1)?.url || 'https://example.org/article', tab: { id: 1 }, frameId: 0, ...patch });
  return { send, content, tabs, local, removed, ext, captures: () => captures, setPartial(value) { unresolved = value; }, refuseClosing() { refuseClose = true; } };
}
for (const namespace of ['chrome', 'browser']) {
  test(`${namespace}: popup and floating actions share durable save/close preferences and distrust page-supplied tab IDs`, async () => {
    const app = await fixture(namespace, 'save');
    try {
      await app.send({ type: 'save-collection-controls', patch: { floatingEnabled: true, closeCapturedTab: true, floatingPosition: 'bottom-left' } });
      assert.equal((await app.content({ type: 'get-floating-state' })).state.enabled, false, 'no controls without a project');
      const { project } = await app.send({ type: 'new-project', projectId: null, name: 'Corpus' });
      const state = (await app.content({ type: 'get-floating-state' })).state;
      assert.equal(state.action, 'save-page'); assert.equal(state.position, 'bottom-left'); assert.equal(state.closeAfterSuccess, true);
      assert.equal(await app.content({ type: 'close-project', projectId: project.id }), undefined);
      assert.equal(await app.content({ type: 'floating-save-page', projectId: project.id }, { frameId: 1 }), undefined);
      assert.equal(await app.content({ type: 'floating-save-page', projectId: project.id }, { id: 'other-extension' }), undefined);
      assert.equal((await app.content({ type: 'floating-save-page', projectId: 'old' })).ok, false);
      const result = await app.content({ type: 'floating-save-page', projectId: project.id, tabId: 2 });
      assert.equal(result.ok, true); assert.equal(result.closed, true); assert.deepEqual(app.removed, [1]); assert.equal(app.tabs.has(2), true);
      assert.match((await readSavedPages())[0].html, /Safely stored original/);
      await app.send({ type: 'close-project', projectId: project.id });
      assert.equal(app.local[COLLECTION_CONTROLS_KEY].values.closeCapturedTab, true);
      const next = await app.send({ type: 'new-project', projectId: null, name: 'Next corpus' });
      assert.equal((await app.send({ type: 'get-collection-controls' })).preferences.floatingPosition, 'bottom-left');
      assert.notEqual(next.project.id, project.id);
    } finally { delete globalThis[namespace]; delete globalThis.indexedDB; }
  });
  test(`${namespace}: tracked search collection is marked collected before closing; partial results and closure errors stay open`, async () => {
    const app = await fixture(namespace, 'collect');
    try {
      const { project } = await app.send({ type: 'new-project', projectId: null, name: 'Search corpus' });
      await app.send({ type: 'save-collection-controls', patch: { closeCollectedTab: true } });
      const opened = await app.send({ type: 'open-project-search', projectId: project.id, engine: 'google', query: 'energy' });
      const saved = await app.send({ type: 'collect', projectId: project.id, tabId: opened.tabId });
      assert.equal(saved.closed, true);
      const state = await app.send({ type: 'get-project-search-tabs', projectId: project.id });
      assert.equal(state.history.find(item => item.query === 'energy').status, 'collected'); assert.equal(state.count, 0);
      const partial = await app.send({ type: 'open-project-search', projectId: project.id, engine: 'google', query: 'partial' });
      app.setPartial(1); const incomplete = await app.send({ type: 'collect', projectId: project.id, tabId: partial.tabId });
      assert.equal(incomplete.closed, false); assert.equal(app.tabs.has(partial.tabId), true);
      app.setPartial(0); app.refuseClosing(); const denied = await app.send({ type: 'collect', projectId: project.id, tabId: partial.tabId });
      assert.equal(denied.ok, true); assert.match(denied.closeWarning, /Browser refused/); assert.equal(app.tabs.has(partial.tabId), true);
    } finally { delete globalThis[namespace]; delete globalThis.indexedDB; }
  });
  test(`${namespace}: a queued capture is already saved on reopening and floating Hide disables controls globally`, async () => {
    const app = await fixture(namespace, 'queued');
    try {
      const { project } = await app.send({ type: 'new-project', projectId: null, name: 'Queued corpus' });
      await app.send({ type: 'save-collection-controls', patch: { floatingEnabled: true } });
      const first = await app.send({ type: 'save-page', projectId: project.id, tabId: 1 }); assert.equal(first.ok, true);
      assert.equal((await app.send({ type: 'get-page-corpus-state', tabId: 1 })).saved, true);
      assert.equal((await app.send({ type: 'save-page', projectId: project.id, tabId: 1 })).alreadySaved, true); assert.equal(app.captures(), 1);
      assert.equal((await app.content({ type: 'get-floating-state' })).state.saved, true);
      assert.equal((await app.content({ type: 'floating-hide', projectId: project.id })).ok, true);
      assert.equal((await app.send({ type: 'get-collection-controls' })).preferences.floatingEnabled, false);
      assert.equal((await app.content({ type: 'get-floating-state' })).state.enabled, false);
    } finally { delete globalThis[namespace]; delete globalThis.indexedDB; }
  });
}


for (const namespace of ['chrome', 'browser']) {
  test(`${namespace}: engine defaults apply only to new projects and protect stale settings drafts`, async () => {
    const app = await fixture(namespace, 'engine-default');
    try {
      let { project } = await app.send({ type: 'new-project', projectId: null, name: 'First' });
      assert.equal((await loadWorkspace(project.id)).draft.engine, 'ecosia');
      await saveDraft(project.id, { engine: 'duckduckgo' });
      const before = (await app.send({ type: 'get-settings' })).settings;
      await app.send({ type: 'save-settings', values: { ...before.values, fileMiB: 75 }, revision: before.revision });
      const stale = (await app.send({ type: 'get-settings' })).settings;
      const saved = await app.send({ type: 'set-default-search-engine', projectId: project.id, engine: 'google' });
      assert.equal(saved.ok, true); assert.equal(saved.settings.values.fileMiB, 75);
      assert.equal(saved.settings.values.defaultEngine, 'google');
      assert.equal((await loadWorkspace(project.id)).draft.engine, 'duckduckgo');
      assert.equal((await app.send({ type: 'save-settings', values: stale.values, revision: stale.revision })).ok, false);
      assert.equal((await app.send({ type: 'set-default-search-engine', projectId: project.id, engine: 'bing' })).ok, false);
      assert.equal((await app.send({ type: 'get-settings' })).settings.values.defaultEngine, 'google');
      await app.send({ type: 'close-project', projectId: project.id });
      ({ project } = await app.send({ type: 'new-project', projectId: null, name: 'Second' }));
      assert.equal((await loadWorkspace(project.id)).draft.engine, 'google');
      // Legacy saved drafts may contain an empty engine (the old Google fallback).
      await saveDraft(project.id, { engine: '' });
      const current = (await app.send({ type: 'get-settings' })).settings;
      await app.send({ type: 'save-settings', values: { ...current.values, defaultEngine: 'ecosia' }, revision: current.revision });
      await app.send({ type: 'get-project' });
      assert.equal((await loadWorkspace(project.id)).draft.engine, '');
    } finally { delete globalThis[namespace]; delete globalThis.indexedDB; }
  });
}

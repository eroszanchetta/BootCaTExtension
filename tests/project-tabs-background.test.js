import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { adapterForURL } from '../src/engines.js';

for (const namespace of ['chrome', 'browser']) test(`${namespace}: background registers tabs, saves collections before closing, and leaves failed/unrelated pages`, async () => {
  globalThis.indexedDB = new IDBFactory();
  const local = {}, session = {}, tabs = new Map(), removed = []; let listener, nextId = 1;
  const origin = `${namespace === 'chrome' ? 'chrome' : 'moz'}-extension://test/`;
  const area = values => ({ get: async key => ({ [key]: structuredClone(values[key]) }), set: async patch => { Object.assign(values, structuredClone(patch)); }, clear: async () => { for (const key of Object.keys(values)) delete values[key]; } });
  globalThis[namespace] = {
    runtime: { id: 'test', getURL: path => origin + path, onMessage: { addListener(fn) { listener = fn; } }, getContexts: async () => [{ documentUrl: origin + 'downloader.html', tabId: 999 }] },
    storage: { local: area(local), session: area(session) },
    tabs: {
      create: async options => { const tab = { ...options, id: nextId++, status: 'complete' }; tabs.set(tab.id, tab); return tab; },
      get: async id => { if (id === 999) return { id, windowId: 1 }; if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; },
      remove: async id => {
        assert.ok(local.collections.some(collection => collection.pageURL === tabs.get(id).url), 'collection must be saved before removing the tab');
        removed.push(id); tabs.delete(id);
      }
    },
    scripting: { executeScript: async ({ target }) => {
      const tab = tabs.get(target.tabId), url = new URL(tab.url), engine = adapterForURL(tab.url);
      const query = url.searchParams.get('q');
      return [{ result: { engine: engine.id, pageURL: tab.url, query, unresolved: 0, results: query === 'captcha' ? [] : [{ url: 'https://corpus.test/' + query, title: query, positionOnPage: 1 }] } }];
    } }
  };
  await import(`../src/background.js?tracked-test=${namespace}`);
  const request = message => new Promise(resolve => listener(message, { id: 'test', url: origin + 'downloader.html' }, resolve));
  try {
    const { project } = await request({ type: 'get-project' });
    assert.equal(project.nameConfirmed, false);
    const named = await request({ type: 'rename-project', projectId: project.id, name: 'Initial corpus' });
    assert.equal(named.project.nameConfirmed, true);
    const language = await request({ type: 'set-project-language', projectId: project.id, language: 'ita' });
    assert.equal(language.project.language, 'ita');
    const renamed = await request({ type: 'rename-project', projectId: project.id, name: 'Renamed corpus' });
    assert.equal(renamed.project.language, 'ita', 'renaming must not discard language choice');
    assert.equal((await request({ type: 'set-project-language', projectId: project.id, language: 'bad' })).ok, false);
    const good = await request({ type: 'open-project-search', projectId: project.id, engine: 'google', query: 'energy' });
    const captcha = await request({ type: 'open-project-search', projectId: project.id, engine: 'google', query: 'captcha' });
    tabs.set(100, { id: 100, url: 'https://www.google.com/search?q=random', status: 'complete' });
    assert.equal(good.ok, true); assert.equal(captcha.ok, true);
    assert.equal((await request({ type: 'collect-project-search-tabs', projectId: project.id })).ok, true);
    let state;
    for (let i = 0; i < 500; i++) {
      state = await request({ type: 'get-project-search-tabs', projectId: project.id });
      if (!state.batch.running) break; await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.equal(state.batch.running, false); assert.equal(state.batch.closed, 1); assert.equal(state.batch.saved, 1);
    assert.deepEqual(removed, [good.tabId]); assert.ok(tabs.has(captcha.tabId)); assert.ok(tabs.has(100));
    assert.equal(local.collections.length, 1); assert.equal(local.collections[0].query, 'energy');
    const stale = await request({ type: 'new-project', projectId: 'stale', name: 'Must not clear' });
    assert.equal(stale.ok, false); assert.equal(local.collections.length, 1);
    const reset = await request({ type: 'new-project', projectId: project.id, name: '  Fresh corpus  ', language: 'fra' });
    assert.equal(reset.project.language, 'fra'); assert.equal(reset.project.name, 'Fresh corpus'); assert.equal(reset.project.nameConfirmed, true);
    assert.equal((await request({ type: 'get-project-search-tabs', projectId: reset.project.id })).count, 0);
    assert.ok(tabs.has(captcha.tabId)); assert.equal((await request({ type: 'collect-project-search-tabs', projectId: project.id })).ok, false);
  } finally { delete globalThis[namespace]; delete globalThis.indexedDB; }
});

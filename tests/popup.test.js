import { COLLECTION_CONTROLS_KEY, DEFAULT_COLLECTION_CONTROLS, collectionControlsFromRecord } from '../src/collection-preferences.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { adapterForURL } from '../src/engines.js';

const source = (await readFile(new URL('../src/popup.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
async function popup(state, url, fail = false) {
  const elements = new Map(), listeners = [];
  const get = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { disabled: false, textContent: '', handlers: {},
        addEventListener(type, fn) { this.handlers[type] = fn; },
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }
      });
    }
    return elements.get(id);
  };
  get('feedback').textContent = 'Collection hint';
  let requests = 0, reloads = 0;
  const notify = changes => listeners.forEach(fn => fn(changes, 'local'));
  const context = vm.createContext({
    COLLECTION_CONTROLS_KEY, DEFAULT_COLLECTION_CONTROLS, collectionControlsFromRecord,
    initVersionBadge: () => '2.0.0',
    document: { getElementById: get }, adapterForURL,
    window: { close() {}, location: { reload() { reloads++; } } },
    getExtensionAPI: () => ({
      tabs: { query: async () => [{ id: 10, url }] },
      storage: { local: { get: async () => ({ collections: state.collections }) }, onChanged: { addListener(fn) { listeners.push(fn); } } },
      runtime: { sendMessage: async message => {
        if (message.type === 'get-collection-controls') return { ok: true, preferences: state.preferences || DEFAULT_COLLECTION_CONTROLS };
        if (message.type === 'save-collection-controls') { state.preferences = { ...DEFAULT_COLLECTION_CONTROLS, ...state.preferences, ...message.patch }; notify({ [COLLECTION_CONTROLS_KEY]: { newValue: { version: 1, values: state.preferences } } }); return { ok: true, preferences: state.preferences }; }
        if (message.type === 'get-project') return { ok: true, project: state.project === undefined ? { id: 'current', name: 'Test corpus', nameConfirmed: true } : state.project };
        if (message.type === 'get-page-corpus-state') { if (state.pageGate) await state.pageGate; return { ok: true, projectId: 'current', saved: !!state.saved }; }
        if (message.type === 'save-page') { assert.equal(message.projectId, 'current'); if (state.saveGate) await state.saveGate; state.saved = true; return { ok: true }; }
        assert.equal(message.type, 'collect'); assert.equal(message.projectId, 'current'); requests++;
        if (state.collectGate) await state.collectGate;
        if (fail) return { ok: false, error: 'Please try again' };
        const engine = adapterForURL(url);
        state.collections = [...state.collections, { id: 'saved', engine: engine.id, pageURL: url, unresolved: 0 }];
        notify({ collections: { newValue: state.collections } });
        return { ok: true, count: 2, engine: engine.name };
      } }
    })
  });
  await vm.runInContext(`(async () => { ${source} })()`, context);
  return { get, notify, requests: () => requests, reloads: () => reloads };
}

for (const url of ['https://www.google.com/search?q=energy', 'https://duckduckgo.com/?q=energy', 'https://www.ecosia.org/search?q=energy']) {
  test(`${adapterForURL(url).name}: collect once, remember on reopen and allow a different results page`, async () => {
    const state = { collections: [] };
    const first = await popup(state, url);
    assert.equal(first.get('save-page').disabled, true, 'search results must not be saved as corpus pages');
    assert.equal(first.get('collect').disabled, false);
    assert.equal(first.get('collect-action').hidden, false); assert.equal(first.get('capture-action').hidden, true);
    await first.get('collect').handlers.click();
    assert.equal(first.get('collect').disabled, true);
    assert.equal(first.get('feedback').textContent, 'URLs added');
    assert.equal(first.get('collect-action').hidden, true); assert.equal(first.get('feedback').hidden, false);
    assert.equal(first.get('feedback').classList.contains('saved'), true);
    await first.get('collect').handlers.click();
    assert.equal(first.requests(), 1, 'must not collect twice');
    const reopened = await popup(state, url);
    assert.equal(reopened.get('collect').disabled, true);
    assert.equal(reopened.get('feedback').textContent, 'URLs added');
    assert.equal(reopened.get('close-collected-option').hidden, false);
    assert.equal(reopened.get('close-captured-option').hidden, true);
    reopened.get('close-collected-tab').checked = true; await reopened.get('close-collected-tab').handlers.change();
    assert.equal((await popup(state, url)).get('close-collected-tab').checked, true);
    assert.equal(reopened.requests(), 0, 'changing the preference must not collect again');
    const next = await popup(state, url + '&page=2');
    assert.equal(next.get('collect').disabled, false);
    assert.equal(next.get('save-page').disabled, true);
    state.collections = [];
    reopened.notify({ collections: { newValue: [] } });
    assert.equal(reopened.get('collect').disabled, false, 'clearing searches allows recollection');
    assert.equal(reopened.get('feedback').classList.contains('saved'), false);
  });
}

test('failed collection leaves the action enabled and shows no success marker', async () => {
  const ui = await popup({ collections: [] }, 'https://www.google.com/search?q=energy', true);
  await ui.get('collect').handlers.click();
  assert.equal(ui.get('collect').disabled, false);
  assert.equal(ui.get('feedback').textContent, 'Please try again');
  assert.equal(ui.get('feedback').classList.contains('saved'), false);
});

test('ordinary web pages allow corpus capture and keep result collection disabled', async () => {
  const ui = await popup({ collections: [] }, 'https://example.org/article');
  assert.equal(ui.get('save-page').disabled, false);
  assert.equal(ui.get('capture-action').hidden, false); assert.equal(ui.get('collect-action').hidden, true);
  assert.equal(ui.get('collect').disabled, true);
});

test('saved pages stay disabled on popup reopen, and become available after corpus deletion/reset', async () => {
  const state = { collections: [], saved: false }, url = 'https://example.org/article';
  const first = await popup(state, url);
  const button = first.get('save-page'); await button.handlers.click({ currentTarget: button });
  assert.equal(button.disabled, true);
  const reopened = await popup(state, url);
  assert.equal(reopened.get('save-page').disabled, true); assert.equal(reopened.get('page-feedback').textContent, 'Page already added to corpus');
  assert.equal(reopened.get('page-feedback').classList.contains('saved'), true);
  assert.equal(reopened.get('capture-action').hidden, true);
  assert.equal(reopened.get('close-captured-option').hidden, false);
  assert.equal(reopened.get('close-collected-option').hidden, true);
  reopened.get('close-captured-tab').checked = true; await reopened.get('close-captured-tab').handlers.change();
  assert.equal((await popup(state, url)).get('close-captured-tab').checked, true);
  state.saved = false; const removed = await popup(state, url); assert.equal(removed.get('save-page').disabled, false);
  state.saved = true; removed.notify({ captureRevision: { newValue: 'capture' } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(removed.get('save-page').disabled, true);
});

for (const project of [null, { id: 'current', name: 'Untitled project', nameConfirmed: false }]) test('project setup hides both actions and offers a clear next step', async () => {
  const ui = await popup({ collections: [], project }, 'https://www.google.com/search?q=energy');
  assert.equal(ui.get('collect-action').hidden, true); assert.equal(ui.get('capture-action').hidden, true);
  assert.equal(ui.get('floating-preferences').hidden, true);
  assert.equal(ui.get('close-collected-option').hidden, true); assert.equal(ui.get('close-captured-option').hidden, true);
  assert.match(ui.get('popup-status').textContent, /Create a project/);
  assert.equal(ui.get('collect').disabled, true); assert.equal(ui.get('save-page').disabled, true);
});

test('unsupported pages show neither action nor irrelevant explanatory text', async () => {
  const ui = await popup({ collections: [] }, 'about:config');
  assert.equal(ui.get('collect-action').hidden, true); assert.equal(ui.get('capture-action').hidden, true);
  assert.equal(ui.get('popup-status').textContent, 'This page cannot be collected.');
});

test('busy actions remain visible with clear labels until success replaces them', async () => {
  let resolveCollect, resolveSave;
  const collectGate = new Promise(resolve => { resolveCollect = resolve; });
  const collecting = await popup({ collections: [], collectGate }, 'https://www.google.com/search?q=energy');
  const pendingCollect = collecting.get('collect').handlers.click();
  assert.equal(collecting.get('collect').textContent, 'Collecting…'); assert.equal(collecting.get('collect').disabled, true);
  assert.equal(collecting.get('collect-action').hidden, false);
  resolveCollect(); await pendingCollect; assert.equal(collecting.get('collect-action').hidden, true);
  const saveGate = new Promise(resolve => { resolveSave = resolve; });
  const saving = await popup({ collections: [], saveGate }, 'https://example.org/article');
  const pendingSave = saving.get('save-page').handlers.click();
  assert.equal(saving.get('save-page').textContent, 'Saving…'); assert.equal(saving.get('capture-action').hidden, false);
  resolveSave(); await pendingSave;
  assert.equal(saving.get('capture-action').hidden, true); assert.equal(saving.get('page-feedback').textContent, 'Page already added to corpus');
});

test('a project switch hides actions immediately and ignores a pending old-page response', async () => {
  const state = { collections: [], saved: false }, ui = await popup(state, 'https://example.org/article');
  let release; state.pageGate = new Promise(resolve => { release = resolve; });
  ui.notify({ captureRevision: { newValue: 'refresh' } });
  ui.notify({ project: { oldValue: { id: 'current' }, newValue: { id: 'next', name: 'Next', nameConfirmed: true } } });
  assert.equal(ui.reloads(), 1); assert.equal(ui.get('capture-action').hidden, true);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.get('capture-action').hidden, true); assert.match(ui.get('popup-status').textContent, /Refreshing/);
});

test('completing project setup reloads before exposing potentially stale collection actions', async () => {
  const ui = await popup({ collections: [], project: { id: 'current', name: 'Untitled project', nameConfirmed: false } }, 'https://www.google.com/search?q=energy');
  ui.notify({ project: { newValue: { id: 'current', name: 'Corpus', nameConfirmed: true } } });
  assert.equal(ui.reloads(), 1); assert.equal(ui.get('collect-action').hidden, true);
});

test('collection switches and floating position persist across pages and popup reopening', async () => {
  const state = { collections: [] }, first = await popup(state, 'https://www.google.com/search?q=one');
  first.get('close-collected-tab').checked = true; await first.get('close-collected-tab').handlers.change();
  first.get('show-floating-controls').checked = true; await first.get('show-floating-controls').handlers.change();
  first.get('floating-position').value = 'bottom-left'; await first.get('floating-position').handlers.change();
  const next = await popup(state, 'https://example.org/article');
  assert.equal(next.get('close-collected-tab').checked, true); assert.equal(next.get('show-floating-controls').checked, true); assert.equal(next.get('floating-position').value, 'bottom-left');
  assert.equal(next.get('close-captured-tab').checked, false);
  next.get('close-captured-tab').checked = true; await next.get('close-captured-tab').handlers.change();
  assert.equal((await popup(state, 'https://other.test')).get('close-captured-tab').checked, true);
});

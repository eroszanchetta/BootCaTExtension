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
  let requests = 0;
  const notify = changes => listeners.forEach(fn => fn(changes, 'local'));
  const context = vm.createContext({
    initVersionBadge: () => '2.0.0',
    document: { getElementById: get }, adapterForURL,
    window: { close() {}, location: { reload() {} } },
    getExtensionAPI: () => ({
      tabs: { query: async () => [{ id: 10, url }] },
      storage: { local: { get: async () => ({ collections: state.collections }) }, onChanged: { addListener(fn) { listeners.push(fn); } } },
      runtime: { sendMessage: async message => {
        if (message.type === 'get-page-corpus-state') return { ok: true, projectId: 'current', saved: !!state.saved };
        if (message.type === 'save-page') { state.saved = true; return { ok: true }; }
        assert.equal(message.type, 'collect'); requests++;
        if (fail) return { ok: false, error: 'Please try again' };
        const engine = adapterForURL(url);
        state.collections = [...state.collections, { id: 'saved', engine: engine.id, pageURL: url, unresolved: 0 }];
        notify({ collections: { newValue: state.collections } });
        return { ok: true, count: 2, engine: engine.name };
      } }
    })
  });
  await vm.runInContext(`(async () => { ${source} })()`, context);
  return { get, notify, requests: () => requests };
}

for (const url of ['https://www.google.com/search?q=energy', 'https://duckduckgo.com/?q=energy', 'https://www.ecosia.org/search?q=energy']) {
  test(`${adapterForURL(url).name}: collect once, remember on reopen and allow a different results page`, async () => {
    const state = { collections: [] };
    const first = await popup(state, url);
    assert.equal(first.get('save-page').disabled, true, 'search results must not be saved as corpus pages');
    assert.equal(first.get('collect').disabled, false);
    await first.get('collect').handlers.click();
    assert.equal(first.get('collect').disabled, true);
    assert.equal(first.get('feedback').textContent, 'Results added');
    assert.equal(first.get('feedback').classList.contains('saved'), true);
    await first.get('collect').handlers.click();
    assert.equal(first.requests(), 1, 'must not collect twice');
    const reopened = await popup(state, url);
    assert.equal(reopened.get('collect').disabled, true);
    assert.equal(reopened.get('feedback').textContent, 'Results added');
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
  assert.equal(ui.get('collect').disabled, true);
});

test('saved pages stay disabled on popup reopen, and become available after corpus deletion/reset', async () => {
  const state = { collections: [], saved: false }, url = 'https://example.org/article';
  const first = await popup(state, url);
  const button = first.get('save-page'); await button.handlers.click({ currentTarget: button });
  assert.equal(button.disabled, true);
  const reopened = await popup(state, url);
  assert.equal(reopened.get('save-page').disabled, true); assert.equal(reopened.get('page-feedback').textContent, 'Page saved');
  assert.equal(reopened.get('page-feedback').classList.contains('saved'), true);
  state.saved = false; const removed = await popup(state, url); assert.equal(removed.get('save-page').disabled, false);
  state.saved = true; removed.notify({ captureRevision: { newValue: 'capture' } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(removed.get('save-page').disabled, true);
});

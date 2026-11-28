import * as storage from '../src/project-store.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { workspace, waitFor } from './helpers/workspace.js';
test('export guidance covers processing, partial success, navigation, inclusion changes and persisted export confirmation', async () => {
  globalThis.indexedDB = new IDBFactory();
  let started, release; const began = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const sections = [];
  try {
    const app = await workspace('guidance', { onOpenSection: id => sections.push(id), fetch: async url => {
      if (url.endsWith('/failed')) throw new Error('HTTP 403');
      started(); await gate; return { bytes: new Uint8Array([1]), contentType: 'text/html', finalURL: url, status: 200 };
    } });
    assert.equal(app.get('export-guidance').hidden, true);
    await app.input('urls', 'https://example.org/good\nhttps://example.org/failed');
    const download = app.click('start'); await began; assert.equal(app.get('export-guidance').hidden, true); release(); await download;
    assert.equal(app.get('export-guidance').hidden, false);
    assert.equal(app.get('export-guidance-title').textContent, 'Your corpus is ready to export.');
    assert.equal(app.get('export-guidance-detail').textContent, '1 document is included.');
    assert.equal(app.get('export-guidance-issues').hidden, false);
    let scrolled, focused, prevented;
    app.get('export').scrollIntoView = options => { scrolled = options; }; app.get('export').focus = options => { focused = options; };
    app.get('go-to-export').handlers.click({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(sections.at(-1), 'project-section');
    assert.equal(app.get('export-focus-area').classList.contains('export-highlight'), true);
    assert.equal(scrolled.block, 'center'); assert.equal(focused.preventScroll, true);
    let checkbox = app.get('results').children[0].children[0].children[0]; checkbox.checked = false; await checkbox.handlers.change();
    assert.equal(app.get('export-guidance').hidden, true);
    checkbox = app.get('results').children[0].children[0].children[0]; checkbox.checked = true; await checkbox.handlers.change();
    assert.equal(app.get('export-guidance').hidden, false);
    await app.click('export');
    assert.equal(app.get('export-guidance-title').textContent, 'Your corpus download has started.');
    assert.equal(app.get('go-to-export').hidden, true); assert.equal(app.get('export-guidance-issues').hidden, true);
    const reopened = await workspace('guidance'); assert.equal(reopened.get('export-guidance-title').textContent, 'Your corpus download has started.');
    await reopened.input('urls', 'https://example.org/good\nhttps://example.org/new');
    assert.equal(reopened.get('export-guidance-title').textContent, 'Your corpus is ready to export.'); assert.equal(reopened.get('go-to-export').hidden, false);
  } finally { release(); delete globalThis.indexedDB; }
});
test('failed export keeps the ready prompt and never announces a successful download', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const app = await workspace('guidance-error', { makeMetadataWorkbook: async () => { throw new Error('ZIP failed'); } });
    await app.input('urls', 'https://example.org/good'); await app.click('start'); await app.click('export');
    assert.equal(app.get('export-guidance').hidden, false); assert.equal(app.get('go-to-export').hidden, false);
    assert.equal(app.get('export-guidance-issues').hidden, true);
    assert.equal(app.get('export-guidance-title').textContent, 'Your corpus is ready to export.'); assert.equal(app.downloads(), 0);
  } finally { delete globalThis.indexedDB; }
});

test('inclusion saves preserve the row and guidance while pending, and failures retain the saved selection', async () => {
  globalThis.indexedDB = new IDBFactory();
  let release, fail = false;
  try {
    const app = await workspace('stable-inclusion', { storage: { ...storage, setIncluded: async (...args) => {
      await new Promise(resolve => { release = resolve; });
      if (fail) throw new Error('Selection could not be saved');
      return storage.setIncluded(...args);
    } } });
    await app.input('urls', 'https://example.org/one\nhttps://example.org/two'); await app.click('start');
    const row = app.get('results').children[0], checkbox = row.children[0].children[0];
    const readiness = app.get('download-readiness').textContent;
    checkbox.checked = false; let saving = checkbox.handlers.change();
    await waitFor(() => !!release);
    assert.equal(app.get('export-guidance').hidden, false);
    assert.equal(app.get('download-readiness').textContent, readiness);
    assert.equal(row.children[2].children.at(-1).textContent, '');
    release(); await saving;
    assert.equal(app.get('results').children[0], row);
    assert.equal(app.get('included-count').textContent, '1 included');
    assert.equal(app.get('export-guidance').hidden, false);
    fail = true; release = null; checkbox.checked = true; saving = checkbox.handlers.change();
    await waitFor(() => !!release); release(); await saving;
    assert.equal(checkbox.checked, false);
    assert.equal(app.get('included-count').textContent, '1 included');
    assert.match(app.get('status').textContent, /Selection could not be saved/);
  } finally { release?.(); delete globalThis.indexedDB; }
});

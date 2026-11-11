import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../src/project-store.js';
import { database } from '../src/storage-db.js';
import { savePage, readSavedPages } from '../src/page-store.js';
import { workspace, extracted, waitFor } from './helpers/workspace.js';

const fresh = () => { globalThis.indexedDB = new IDBFactory(); };
const document = (url, filename, text = 'Stored corpus text') => ({ url, filename, textFilename: filename.replace('pages/', 'corpus/').replace('.html', '.txt'), extraction: extracted(text) });
const record = (url, filename) => ({ url, filename, outcome: 'downloaded', bytes: 3 });

test('database v1 capture inbox upgrades without losing queued pages', async () => {
  fresh();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('bootcat-saved-pages', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pages', { keyPath: 'url' });
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('pages', 'readwrite');
      tx.objectStore('pages').put({ url: 'https://queued.test/', id: 'old', html: '<p>Queued</p>' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  });
  await storage.ensureStoredProject('project');
  assert.equal((await readSavedPages()).length, 1);
  const db = await database(); assert.equal(db.version, 2); db.close();
});

test('originals and text persist separately; metadata has no body; inclusion/deletion/reset are durable', async () => {
  fresh(); await storage.ensureStoredProject('one');
  const url = 'https://example.org/', filename = 'pages/0001-example.html';
  await storage.saveDocument('one', record(url, filename), document(url, filename), new Uint8Array([0, 255, 1]));
  await storage.saveDraft('one', { urls: url, query: 'energy', extractor: 'defuddle' });
  let loaded = await storage.loadWorkspace('one');
  assert.equal(loaded.entries[0].doc.extraction.text, undefined);
  assert.equal(loaded.entries[0].blob, undefined);
  assert.deepEqual([...new Uint8Array(await (await storage.readOriginal('one', filename)).arrayBuffer())], [0, 255, 1]);
  assert.equal(await (await storage.readText('one', url)).text(), 'Stored corpus text');
  await storage.setIncluded('one', url, false);
  assert.equal((await storage.loadWorkspace('one')).entries[0].doc.extraction.included, false);
  // A conflicting original filename aborts every write, including the new text.
  await assert.rejects(storage.saveDocument('one', record('https://different.test/', filename), document('https://different.test/', filename, 'Wrong text'), new Uint8Array([2])));
  assert.equal((await storage.loadWorkspace('one')).entries.length, 1);
  assert.equal(await storage.readText('one', 'https://different.test/'), null);
  await storage.removeDocument('one', url);
  assert.equal(await storage.readOriginal('one', filename), null); assert.equal(await storage.readText('one', url), null);
  loaded = await storage.loadWorkspace('one'); assert.equal(loaded.entries.length, 0); assert.equal(loaded.batch.storedBytes, 0); assert.equal(loaded.draft.urls, '');
  await savePage({ url, id: 'queued', html: '<p>Pending</p>' });
  await storage.resetStoredProject('two');
  assert.equal((await readSavedPages()).length, 0);
  await assert.rejects(storage.saveDraft('one', { urls: 'stale' }), /project changed/);
  assert.equal((await storage.loadWorkspace('two')).draft.urls, '');
});

test('workspace reload restores URLs, records and selections without eager text loads or unload warnings', async () => {
  fresh(); const first = await workspace('one');
  await first.input('urls', 'https://example.org/a\nhttps://example.org/b');
  await first.click('start');
  assert.equal(first.fetched.length, 2); assert.equal(first.get('preview-text').value, '');
  assert.equal(first.beforeUnload(), false, 'saved content alone must not block closing');
  const checkbox = first.get('results').children[0].children[0].children[0];
  checkbox.checked = false; await checkbox.handlers.change();
  const reopened = await workspace('one');
  assert.equal(reopened.get('urls').value, 'https://example.org/a\nhttps://example.org/b');
  assert.equal(reopened.get('results').children.length, 2); assert.equal(reopened.get('preview-text').value, '');
  assert.equal(reopened.get('results').children[0].children[0].children[0].checked, false);
  await reopened.click('start'); assert.equal(reopened.fetched.length, 0, 'completed pages must not download again');
  await reopened.get('results').children[1].children[2].children[1].handlers.click();
  assert.equal(reopened.get('preview-text').value, 'Downloaded corpus text');
  const trash = reopened.get('results').children[1].children[3].children[0];
  reopened.setConfirm(false); await trash.handlers.click(); assert.equal(reopened.state().entries.length, 2);
  reopened.setConfirm(true); await trash.handlers.click(); assert.equal(reopened.state().entries.length, 1);
  assert.equal(reopened.get('preview-text').value, '');
  assert.equal((await workspace('one')).get('results').children.length, 1);
});

test('unfinished work resumes without fetching completed pages and lists above 500 warn instead of rejecting', async () => {
  fresh(); await storage.ensureStoredProject('one');
  const url = 'https://example.org/0', filename = 'pages/0001-example.html';
  await storage.saveDocument('one', record(url, filename), document(url, filename), new Uint8Array([1, 2, 3]));
  await storage.saveDraft('one', { urls: url + '\nhttps://example.org/1' });
  await storage.saveBatch('one', { state: 'running', total: 2, processed: 1 });
  const app = await workspace('one');
  assert.equal(app.get('start').textContent, 'Resume downloads');
  await app.click('start'); assert.deepEqual(app.fetched, ['https://example.org/1']);
  await app.input('urls', Array.from({ length: 501 }, (_, i) => `https://large.test/${i}`).join('\n'));
  assert.match(app.get('urls-warning').textContent, /501 URLs/); assert.equal(app.get('start').disabled, false);
  assert.equal((await storage.loadWorkspace('one')).draft.urls.split('\n').length, 501);
});

test('captured pages are committed before acknowledging their inbox entry and remain after reload', async () => {
  fresh(); const app = await workspace('one');
  await savePage({ url: 'https://capture.test/', id: 'capture', html: '<p>Body</p>', capturedAt: '2026-11-11' });
  await app.notify({ captureRevision: { newValue: 'changed' } });
  await waitFor(async () => (await readSavedPages()).length === 0);
  const reopened = await workspace('one');
  assert.equal(reopened.get('results').children.length, 1); assert.equal(reopened.get('preview-text').value, '');
  assert.equal(reopened.state().entries[0].doc.captureId, 'capture');
});

test('storage quota failures stop processing while preserving completed pages and a resumable URL list', async () => {
  fresh(); let saves = 0;
  const app = await workspace('one', { storage: { ...storage, saveDocument: async (...args) => {
    if (++saves === 2) throw new DOMException('Storage quota exhausted', 'QuotaExceededError');
    return storage.saveDocument(...args);
  } } });
  await app.input('urls', 'https://quota.test/one\nhttps://quota.test/two'); await app.click('start');
  assert.match(app.get('status').textContent, /storage is full/);
  assert.equal((await storage.loadWorkspace('one')).entries.length, 1);
  const restored = await workspace('one');
  assert.equal(restored.get('results').children.length, 1);
  assert.equal(restored.get('start').textContent, 'Resume downloads');
  await restored.click('start'); assert.deepEqual(restored.fetched, ['https://quota.test/two']);
});

test('Stop persists completed pages and resume retries only unfinished URLs', async () => {
  fresh();
  const app = await workspace('one', { fetch: async (url, signal) => {
    if (url.endsWith('/two')) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    return { bytes: new Uint8Array([1]), contentType: 'text/html', finalURL: url, status: 200 };
  } });
  await app.input('urls', 'https://stop.test/one\nhttps://stop.test/two');
  const active = app.click('start');
  await waitFor(() => app.fetched.length === 2);
  await app.click('stop'); await active;
  const resumed = await workspace('one'); await resumed.click('start');
  assert.deepEqual(resumed.fetched, ['https://stop.test/two']);
  assert.equal((await storage.loadWorkspace('one')).entries.length, 2);
});

test('pending browser lock acquisition disables edits immediately so deletion cannot erase a subsequent edit', async () => {
  fresh();
  const navigator = { locks: { request: async (name, options, callback) => {
    await new Promise(resolve => setImmediate(resolve));
    return callback({});
  } } };
  const app = await workspace('one', { navigator });
  await app.input('urls', 'https://race.test/'); await app.click('start');
  const trash = app.get('results').children[0].children[3].children[0];
  const deletion = trash.handlers.click();
  assert.equal(app.get('urls').disabled, true, 'edits must be blocked before the lock callback starts');
  assert.equal(app.get('start').disabled, true);
  await deletion;
  await app.input('urls', 'https://race.test/');
  assert.equal((await storage.loadWorkspace('one')).draft.urls, 'https://race.test/');
});

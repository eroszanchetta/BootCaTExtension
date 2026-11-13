import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../src/project-store.js';
import { database } from '../src/storage-db.js';
import { savePage, readSavedPages } from '../src/page-store.js';
import { workspace, extracted, waitFor } from './helpers/workspace.js';
import { DownloadSizeError, FILE_LIMIT } from '../src/core.js';
import { execFileSync } from 'node:child_process';

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

test('PDF raw and formatted text persist as separate Blobs without bodies in metadata, export separately and delete together', async () => {
  fresh();
  const app = await workspace('raw', { extractor: async () => ({ ...extracted('Line one Line two'), rawText: 'Line one\nLine two', format: 'pdf', formatting: { version: '1', joinedLines: 1 } }) });
  await app.input('urls', 'https://example.org/doc.pdf'); await app.click('start');
  let entry = (await storage.loadWorkspace('raw')).entries[0];
  assert.equal(entry.doc.extraction.rawText, undefined); assert.equal(entry.doc.extraction.text, undefined);
  assert.match(entry.doc.rawTextFilename, /^raw-pdf\//);
  assert.equal(await (await storage.readRawText('raw', entry.url)).text(), 'Line one\nLine two');
  assert.equal(await (await storage.readText('raw', entry.url)).text(), 'Line one Line two');
  const reopened = await workspace('raw');
  await reopened.click('export'); let zip = await reopened.archive().text();
  assert.ok(zip.includes(entry.doc.rawTextFilename)); assert.ok(zip.includes('Line one\nLine two'));
  assert.ok(zip.includes(entry.doc.textFilename)); assert.ok(zip.includes('Line one Line two'));
  await storage.setIncluded('raw', entry.url, false); await reopened.focus(); await reopened.click('export');
  zip = await reopened.archive().text(); assert.ok(zip.includes(entry.doc.rawTextFilename));
  await storage.removeDocument('raw', entry.url);
  assert.equal(await storage.readRawText('raw', entry.url), null);
  assert.equal(await storage.readText('raw', entry.url), null);
});

test('size-limit failures persist explicit download status without suggesting CAPTCHA recovery or saving originals', async () => {
  fresh();
  const app = await workspace('size', { fetch: async () => { throw new DownloadSizeError(FILE_LIMIT); } });
  await app.input('urls', 'https://example.org/huge.pdf'); await app.click('start');
  const entry = (await storage.loadWorkspace('size')).entries[0];
  assert.equal(entry.record.errorCode, 'DOWNLOAD_TOO_LARGE'); assert.equal(entry.record.limitBytes, FILE_LIMIT);
  assert.equal(entry.fileNames.length, 0); assert.equal(entry.doc, null);
  const row = app.get('problem-results').children[0];
  assert.match(row.children[2].textContent, /50 MiB download limit/);
  assert.ok(!row.children[2].textContent.includes('CAPTCHA'));
  assert.equal(row.children[1].children.some(item => item.className === 'secondary import-pdf-button'), false);
  const reopened = await workspace('size'); assert.match(reopened.get('problem-results').children[0].children[2].textContent, /50 MiB download limit/);
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
  assert.match(reopened.state().entries[0].doc.filename, /^pages\/[^/]+$/);
  assert.match(reopened.state().entries[0].doc.textFilename, /^corpus\/[^/]+$/);
});

test('legacy captures export flat ZIP paths and matching XLSX metadata without renaming stored blobs or loading text for metadata', async () => {
  fresh(); await storage.ensureStoredProject('legacy-export');
  const url = 'https://capture.test/', filename = 'pages/captured/0001-capture.test.html';
  const doc = document(url, filename); doc.source = 'browser-tab';
  await storage.saveDocument('legacy-export', { ...record(url, filename), outcome: 'captured', source: 'browser-tab' }, doc, new Blob(['ORIGINAL_CAPTURE']));
  const app = await workspace('legacy-export'); await app.click('export');
  const zipResult = JSON.parse(execFileSync('python3', ['-c', `
import io,sys,json,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 names=z.namelist()
 assert not any('/captured/' in name for name in names)
 print(json.dumps({'names':names,'record':json.loads(z.read('results.json'))['results'][0], 'doc':json.loads(z.read('extraction.json'))['documents'][0]}))
`], { input: Buffer.from(await app.archive().arrayBuffer()), encoding: 'utf8' }));
  assert.ok(zipResult.names.includes('pages/0001-capture.test.html'));
  assert.ok(zipResult.names.includes('corpus/0001-capture.test.txt'));
  assert.equal(zipResult.record.filename, 'pages/0001-capture.test.html');
  assert.equal(zipResult.doc.textFilename, 'corpus/0001-capture.test.txt');
  assert.equal(zipResult.record.source, 'browser-tab');
  assert.equal((await storage.loadWorkspace('legacy-export')).entries[0].doc.filename, filename);
  assert.equal(await (await storage.readOriginal('legacy-export', filename)).text(), 'ORIGINAL_CAPTURE');
  const metadataOnly = await workspace('legacy-export', { storage: { ...storage,
    readText: () => assert.fail('Metadata export must not read text bodies'),
    readOriginal: () => assert.fail('Metadata export must not read original bodies') } });
  assert.equal(metadataOnly.get('export-metadata').disabled, false);
  await metadataOnly.click('export-metadata');
  const workbook = await metadataOnly.archive().text();
  assert.ok(workbook.includes('0001-capture.test.txt')); assert.ok(!workbook.includes('corpus/captured/'));
  await storage.setIncluded('legacy-export', url, false); await metadataOnly.focus();
  assert.equal(metadataOnly.get('export-metadata').disabled, true);
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

test('saved-page lookup covers downloads, imports, redirects and pending captures, but not failures or other projects', async () => {
  fresh(); await storage.ensureStoredProject('p');
  const url = 'https://example.org/original', finalURL = 'https://example.org/final?id=1';
  assert.equal(await storage.hasStoredPage('p', url), false);
  await storage.saveFailure('p', { url, outcome: 'error', error: '403' });
  assert.equal(await storage.hasStoredPage('p', url), false);
  for (const [index, source] of ['downloaded', 'browser-tab', 'local-file'].entries()) {
    const filename = `pages/${index}.html`, outcome = source === 'downloaded' ? 'downloaded' : 'captured';
    await storage.saveDocument('p', { ...record(url, filename), outcome, finalURL, source }, document(url, filename), new Blob(['original']));
    assert.equal(await storage.hasStoredPage('p', url + '#section'), true);
    assert.equal(await storage.hasStoredPage('p', finalURL + '#fragment'), true);
    assert.equal(await storage.hasStoredPage('p', 'https://example.org/final?id=2'), false);
    await storage.setIncluded('p', url, false); assert.equal(await storage.hasStoredPage('p', url), true);
    await storage.removeDocument('p', url); assert.equal(await storage.hasStoredPage('p', finalURL), false);
  }
  await savePage({ id: 'pending', url: url + '#capture', html: '<p>Queued</p>' });
  assert.equal(await storage.hasStoredPage('p', url), true);
  assert.equal(await storage.hasStoredPage('p', 'chrome://settings'), false);
  await storage.resetStoredProject('next'); assert.equal(await storage.hasStoredPage('next', url), false);
  await assert.rejects(storage.hasStoredPage('p', url), /project changed/);
});

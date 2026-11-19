import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createProjectWork, createExtractionQueue } from '../src/project-work.js';
import * as storage from '../src/project-store.js';
import { savePage, readSavedPages } from '../src/page-store.js';
import { workspace, waitFor } from './helpers/workspace.js';
import { pdfFixture } from './browser-tests.fixtures.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = url => ({ bytes: new Uint8Array([1]), contentType: 'text/html', finalURL: url, status: 200 });
const rowFor = (app, url, problems = false) => app.get(problems ? 'problem-results' : 'results').children.find(row => row.children[1].children[0].href === url);

test('completed text editing, inclusion and manual recovery work while another URL waits on the network; recovered queued URLs are skipped', async () => {
  globalThis.indexedDB = new IDBFactory();
  const blocked = deferred(); let active;
  try {
    const urls = ['good', 'failed', 'blocked', 'queued'].map(name => 'https://concurrent.test/' + name);
    const app = await workspace('concurrent', { navigator: { locks: navigator.locks }, fetch: async url => {
      if (url.endsWith('/failed')) throw new Error('HTTP 403');
      if (url.endsWith('/blocked')) await blocked.promise;
      return response(url);
    } });
    await app.input('urls', urls.join('\n')); active = app.click('start');
    await waitFor(() => app.fetched.includes(urls[2]));
    assert.equal(app.state().downloading, true); assert.equal(app.get('export').disabled, true);
    assert.equal(app.get('attention-section').open, false);
    assert.equal(rowFor(app, urls[1], true).children[1].children[1].disabled, false);
    await rowFor(app, urls[0]).children[2].children[1].handlers.click(); await app.click('text-review-edit');
    await app.input('preview-text', 'My edited corpus text.');
    await savePage({ id: 'failed-recovery', url: urls[1], html: '<p>Recovered body</p>' }, 'concurrent');
    await app.notify({ captureRevision: { newValue: 'one' } });
    assert.ok(rowFor(app, urls[1])); assert.equal(app.get('attention-section').hidden, true);
    assert.equal(app.get('preview-text').value, 'My edited corpus text.', 'incoming recovery must not reset an open draft');
    await app.click('text-review-save');
    assert.equal(await (await storage.readText('concurrent', urls[0])).text(), 'My edited corpus text.');
    assert.equal(app.state().downloading, true);
    await app.click('text-review-close');
    const checkbox = rowFor(app, urls[0]).children[0].children[0]; checkbox.checked = false; await checkbox.handlers.change();
    assert.equal((await storage.readDownloadTarget('concurrent', urls[0])).entry.doc.extraction.included, false);
    await savePage({ id: 'queued-recovery', url: urls[3], html: '<p>Queued recovery</p>' }, 'concurrent');
    await app.notify({ captureRevision: { newValue: 'two' } });
    assert.ok(rowFor(app, urls[3])); assert.equal(app.state().downloading, true);
    blocked.resolve(); await active;
    assert.equal(app.fetched.includes(urls[3]), false, 'a URL recovered before its turn must not download again');
    const saved = await storage.loadWorkspace('concurrent');
    assert.equal(saved.entries.length, 4); assert.equal(saved.entries.find(entry => entry.url === urls[1]).record.outcome, 'captured');
    assert.equal(saved.batch.processed, 4); assert.equal(saved.batch.state, 'idle');
  } finally { blocked.resolve(); await active; delete globalThis.indexedDB; }
});

test('a capture arriving during its own failed download is applied after that attempt, once, and survives its late failure', async () => {
  globalThis.indexedDB = new IDBFactory();
  const blocked = deferred(); let active, recovery;
  try {
    const url = 'https://race.test/';
    const app = await workspace('race', { navigator: { locks: navigator.locks }, fetch: async () => blocked.promise });
    await app.input('urls', url); active = app.click('start'); await waitFor(() => app.fetched.length === 1);
    await savePage({ id: 'manual', url, html: '<p>Human recovered page</p>' }, 'race');
    recovery = app.notify({ captureRevision: { newValue: 'manual' } });
    await waitFor(() => app.state().importing && /queued|received/i.test(app.get('saved-status').textContent));
    assert.match(app.get('saved-status').textContent, /queued|received/i);
    blocked.reject(new Error('Late HTTP 403')); await Promise.all([active, recovery]);
    const saved = await storage.loadWorkspace('race');
    assert.equal(saved.entries.length, 1); assert.equal(saved.entries[0].record.outcome, 'captured');
    assert.equal(saved.entries[0].doc.captureId, 'manual'); assert.equal(await (await storage.readText('race', url)).text(), 'Captured corpus text');
    assert.equal((await readSavedPages()).length, 0);
    await app.notify({ captureRevision: { newValue: 'duplicate-notification' } });
    assert.equal((await storage.loadWorkspace('race')).entries[0].fileNames.length, 1);
  } finally { blocked.reject(new Error('cleanup')); await Promise.allSettled([active, recovery]); delete globalThis.indexedDB; }
});

test('deleting a queued failed URL prevents its resurrection; stale background captures cannot undo deletion', async () => {
  globalThis.indexedDB = new IDBFactory();
  const blocked = deferred(); let active;
  try {
    const first = 'https://delete.test/blocked', queued = 'https://delete.test/queued';
    await storage.ensureStoredProject('delete'); await storage.saveFailure('delete', { url: queued, outcome: 'error', error: '403' });
    const app = await workspace('delete', { navigator: { locks: navigator.locks }, fetch: async url => { if (url === first) await blocked.promise; return response(url); } });
    await app.input('urls', first + '\n' + queued); active = app.click('start'); await waitFor(() => app.fetched.length === 1);
    const version = await storage.getDeletionVersion('delete', queued);
    await savePage({ url: queued + '#part', id: 'pending', html: '<p>Pending</p>' }, 'delete');
    await rowFor(app, queued, true).children[3].children[0].handlers.click();
    assert.equal((await readSavedPages()).length, 0);
    await assert.rejects(savePage({ url: queued, id: 'late', html: '<p>Late</p>' }, 'delete', { url: queued, version }), /deleted while/);
    blocked.resolve(); await active;
    assert.equal(app.fetched.includes(queued), false); assert.equal((await storage.loadWorkspace('delete')).entries.some(entry => entry.url === queued), false);
  } finally { blocked.resolve(); await active; delete globalThis.indexedDB; }
});

test('locks permit work on another document, reject a second batch and exclude export until all document work ends', async () => {
  const id = 'locks-' + crypto.randomUUID(), owner = createProjectWork({ locks: navigator.locks, getProjectId: () => id }), other = createProjectWork({ locks: navigator.locks, getProjectId: () => id });
  const held = deferred(), started = deferred();
  const batch = owner.batch(async () => owner.document('https://active.test/', async () => { started.resolve(); await held.promise; return true; }));
  await started.promise;
  assert.equal((await other.activity()).batch, true);
  assert.equal(await other.batch(() => assert.fail('duplicate runner')), false);
  assert.equal(await other.document('https://active.test/', () => assert.fail('busy document')), false);
  assert.equal(await other.document('https://finished.test/', () => true), true);
  assert.equal(await other.exclusive(() => assert.fail('incomplete export')), false);
  held.resolve(); await batch;
  assert.equal(await other.exclusive(() => true), true);
});

test('manual file import works during a batch, and Stop downloads does not cancel its extraction', async () => {
  globalThis.indexedDB = new IDBFactory();
  const extracting = deferred(), release = deferred(); let active, imported, manualSignal;
  try {
    const url = 'https://upload.test/failed';
    const app = await workspace('upload', { navigator: { locks: navigator.locks }, fetch: async (value, signal) => {
      if (value === url) throw new Error('HTTP 403');
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }, extractor: async (bytes, type, options) => {
      manualSignal = options.signal; extracting.resolve(); await release.promise;
      return { status: 'ok', text: 'Uploaded text', characters: 13, included: true, warnings: [] };
    } });
    await app.input('urls', url + '\nhttps://upload.test/blocked'); active = app.click('start');
    await waitFor(() => app.fetched.length === 2);
    await rowFor(app, url, true).children[1].children[1].handlers.click();
    app.get('import-document-picker').files = [new Blob([pdfFixture()], { type: 'application/pdf' })];
    imported = app.get('import-document-picker').handlers.change(); await extracting.promise;
    await app.click('stop'); await active;
    assert.equal(manualSignal.aborted, false);
    release.resolve(); await imported;
    assert.equal((await storage.readDownloadTarget('upload', url)).entry.record.source, 'local-file');
    assert.equal(await (await storage.readText('upload', url)).text(), 'Uploaded text');
  } finally { release.resolve(); await Promise.allSettled([active, imported]); delete globalThis.indexedDB; }
});

test('manual extraction has priority over the next batch job without interrupting the current extraction', async () => {
  const queue = createExtractionQueue(), release = deferred(), began = deferred(), order = [];
  const first = queue.run(async () => { order.push('active'); began.resolve(); await release.promise; }); await began.promise;
  const second = queue.run(() => order.push('next batch'));
  const manual = queue.run(() => order.push('manual recovery'), { priority: true });
  release.resolve(); await Promise.all([first, second, manual]);
  assert.deepEqual(order, ['active', 'manual recovery', 'next batch']);
});

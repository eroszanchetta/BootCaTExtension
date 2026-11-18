import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../src/project-store.js';
import { readSavedPages, savePage } from '../src/page-store.js';
import { transaction, STORES } from '../src/storage-db.js';
import { workspace, extracted } from './helpers/workspace.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const namespace of ['chrome', 'browser']) test(`${namespace}: inactive projects, closure, stale captures and interrupted-close recovery`, async () => {
  globalThis.indexedDB = new IDBFactory();
  const local = {}, session = {}, tabs = new Map(), captured = deferred(), releaseCapture = deferred();
  let listener, injections = 0, nextId = 10;
  const area = values => ({
    get: async key => key === null ? structuredClone(values) : { [key]: structuredClone(values[key]) },
    set: async patch => { Object.assign(values, structuredClone(patch)); },
    remove: async keys => { for (const key of keys) delete values[key]; }
  });
  const origin = `${namespace === 'chrome' ? 'chrome' : 'moz'}-extension://lifecycle/`;
  globalThis[namespace] = {
    runtime: { id: 'lifecycle', getURL: path => origin + path, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: area(local), session: area(session) },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
      create: async options => { const tab = { id: nextId++, status: 'complete', ...options }; tabs.set(tab.id, tab); return tab; },
      query: async () => [], remove: async () => { throw new Error('Closing a project must not close browser tabs'); }
    },
    scripting: { executeScript: async () => { injections++; captured.resolve(); await releaseCapture.promise; return [{ result: { url: 'https://corpus.test/', html: '<p>Late page</p>' } }]; } }
  };
  await import(`../src/background.js?lifecycle=${namespace}`);
  const request = message => new Promise(resolve => listener(message, { id: 'lifecycle', url: origin + 'downloader.html' }, resolve));
  try {
    for (let i = 0; i < 2; i++) {
      const initial = await request({ type: 'get-project' });
      assert.equal(initial.project, null); assert.equal(initial.promptForProject, true);
      assert.equal(await storage.storedProjectId(), undefined, 'reading project state must not seed a project');
    }
    for (const message of [
      { type: 'collect', tabId: 1 }, { type: 'save-page', tabId: 1 },
      { type: 'open-project-search', projectId: null, engine: 'google', query: 'energy' },
      { type: 'clear-collections' }, { type: 'close-project' },
      { type: 'new-project', projectId: null, name: '  ' }
    ]) assert.equal((await request(message)).ok, false, message.type);
    assert.equal(injections, 0); assert.equal(tabs.size, 0);
    const { project } = await request({ type: 'new-project', projectId: null, name: 'Corpus', language: 'none' });
    assert.ok(project.id); assert.equal(project.nameConfirmed, true);
    await request({ type: 'save-user-defaults', projectId: project.id, patch: { excludedSites: ['example.org'] } });
    const preferences = structuredClone(local.userDefaults);
    const url = 'https://corpus.test/', filename = 'pages/page.html';
    await storage.saveDraft(project.id, { seeds: 'seed', tuples: 'tuple', urls: url });
    await storage.saveDocument(project.id, { url, filename, outcome: 'downloaded' }, { url, filename, extraction: extracted('Saved text') }, new Blob(['Saved original']));
    await savePage({ id: 'queued', url: 'https://queued.test/', html: '<p>Pending</p>' }, project.id);
    await request({ type: 'open-project-search', projectId: project.id, engine: 'google', query: 'energy' });
    local.collections = [{ id: 'collection' }]; local.legacyProjectKey = 'old data';
    tabs.set(1, { id: 1, url: 'https://late.test/' });
    const pendingCapture = request({ type: 'save-page', projectId: project.id, tabId: 1 });
    await captured.promise;
    assert.equal((await request({ type: 'close-project', projectId: 'stale' })).ok, false);
    assert.equal((await storage.loadWorkspace(project.id)).entries.length, 1);
    const closed = await request({ type: 'close-project', projectId: project.id });
    assert.equal(closed.ok, true); assert.equal(closed.project, null);
    releaseCapture.resolve(); assert.equal((await pendingCapture).ok, false);
    assert.equal(local.project, null); assert.deepEqual(local.userDefaults, preferences);
    assert.equal((await request({ type: 'get-project' })).promptForProject, true, 'closing a project must offer creation again');
    assert.equal(local.legacyProjectKey, undefined); assert.deepEqual(local.collections, []);
    assert.deepEqual(session.projectSearchTabs, { tabs: [], history: [], batch: null });
    assert.equal(await storage.storedProjectId(), null); assert.deepEqual(await readSavedPages(), []);
    await transaction(STORES, 'readonly', (tx, done) => {
      for (const name of STORES) {
        const request = tx.objectStore(name).count();
        request.onsuccess = () => assert.equal(request.result, name === 'meta' ? 1 : 0, name);
      }
    });
    await assert.rejects(storage.ensureStoredProject(project.id), /project changed/);
    await assert.rejects(storage.saveDraft(project.id, { seeds: 'late' }), /project changed/);
    await assert.rejects(savePage({ id: 'late', url, html: 'late' }, project.id), /project changed/);
    // Simulate a shutdown after database clearing but before storage.local cleanup.
    local.project = project; local.collections = [{ id: 'stale' }];
    assert.equal((await request({ type: 'get-project' })).project, null);
    assert.equal(local.project, null); assert.deepEqual(local.collections, []); assert.deepEqual(local.userDefaults, preferences);
    const next = await request({ type: 'new-project', projectId: null, name: 'Next corpus', language: 'ita' });
    assert.equal(next.ok, true); assert.notEqual(next.project.id, project.id);
    assert.equal((await storage.loadWorkspace(next.project.id)).draft.excludedSites, 'example.org');
    assert.equal((await request({ type: 'close-project', projectId: project.id })).ok, false);
    assert.equal((await request({ type: 'clear-collections', projectId: project.id })).ok, false);
    assert.equal((await request({ type: 'new-project', projectId: null, name: 'Stale creation' })).ok, false);
    assert.equal((await request({ type: 'get-project' })).project.id, next.project.id);
    const originalFetch = globalThis.fetch, fetching = deferred(); let pdfAborted = false;
    try {
      globalThis.fetch = async (url, options) => {
        fetching.resolve();
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { pdfAborted = true; reject(options.signal.reason); }, { once: true }));
      };
      tabs.set(2, { id: 2, url: 'https://example.org/pending.pdf' });
      const pendingPDF = request({ type: 'save-page', projectId: next.project.id, tabId: 2 });
      await fetching.promise;
      assert.equal((await request({ type: 'close-project', projectId: next.project.id })).ok, true);
      assert.equal((await pendingPDF).ok, false); assert.equal(pdfAborted, true);
      assert.deepEqual(await readSavedPages(), []);
    } finally { globalThis.fetch = originalFetch; }
  } finally { releaseCapture.resolve(); delete globalThis[namespace]; delete globalThis.indexedDB; }
});

test('inactive workspace cannot download, export or persist edits', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const app = await workspace(null);
    assert.equal(app.state().ready, false);
    await app.input('urls', 'https://example.org/');
    await app.click('start'); await app.click('export');
    assert.equal(app.fetched.length, 0); assert.equal(app.archive(), undefined);
    assert.equal(await storage.storedProjectId(), undefined);
  } finally { delete globalThis.indexedDB; }
});

test('closing a workspace aborts its pending download and discards delayed extraction results', async () => {
  for (const stage of ['download', 'extraction']) {
    globalThis.indexedDB = new IDBFactory();
    const began = deferred(), released = deferred(); let aborted = false;
    try {
      const app = await workspace('closing', stage === 'download' ? { fetch: async (url, signal) => {
        began.resolve();
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
      } } : { extractor: async () => { began.resolve(); await released.promise; return extracted('Late text'); } });
      await app.input('urls', 'https://pending.test/');
      const run = app.click('start'); await began.promise;
      await storage.closeStoredProject('closing'); app.reset(); released.resolve(); await run;
      if (stage === 'download') assert.equal(aborted, true);
      assert.equal(app.state().ready, false); assert.equal(app.beforeUnload(), false);
      assert.equal(app.get('results').children.length, 0);
      assert.equal(await storage.storedProjectId(), null);
      await assert.rejects(storage.loadWorkspace('closing'), /project changed/);
    } finally { released.resolve(); delete globalThis.indexedDB; }
  }
});

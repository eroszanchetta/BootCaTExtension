import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../src/project-store.js';
import { stageProject } from '../src/project-transfer.js';
import { savePage } from '../src/page-store.js';
import { initPortableUI } from '../src/portable-ui.js';

class Element {
  constructor() { this.textContent = ''; this.hidden = false; this.disabled = false; this.handlers = {}; const classes = new Set(); this.classList = { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) }; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  remove() {}
}
test('project download feedback compares complete project data, persists across reopening and permits retry', async () => {
  globalThis.indexedDB = new IDBFactory();
  const previousDocument = globalThis.document, previousChrome = globalThis.chrome, previousTimer = globalThis.setTimeout;
  const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL;
  const project = { id: 'save-feedback', name: 'Test project', language: 'none', nameConfirmed: true }, local = { collections: [] };
  let elements, fail = false, downloads = 0;
  const get = id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
  function open() {
    elements = new Map();
    globalThis.document = { getElementById: get, body: { append() {} }, createElement() { const link = new Element(); link.click = () => { downloads++; }; return link; } };
    return initPortableUI({ getProject: () => project, isBusy: () => false, isDirty: () => false, flush: async () => {}, exclusive: task => task(), onBusy() {}, version: '2.1.0' });
  }
  globalThis.chrome = { runtime: { sendMessage: async () => {
    if (fail) throw new Error('Download preparation failed');
    const snapshot = await storage.snapshotStoredProject(project);
    snapshot.stores.meta = snapshot.stores.meta.map(record => record.key === 'searches' ? { key: 'searches', collections: local.collections } : record);
    return { ok: true, token: await stageProject(snapshot) };
  } }, storage: { local: { get: async key => ({ [key]: local[key] }), set: async patch => Object.assign(local, patch) }, onChanged: { addListener() {} } } };
  globalThis.setTimeout = (...args) => { const timer = previousTimer(...args); timer.unref(); return timer; };
  URL.createObjectURL = () => 'blob:fixture'; URL.revokeObjectURL = () => {};
  try {
    await storage.resetStoredProject(project.id, {}, project);
    const ui = open(); await ui.refresh();
    await ui.save(); assert.equal(downloads, 1); assert.equal(ui.isSaved(), true);
    assert.equal(get('save-project').disabled, true); assert.equal(get('project-save-feedback').classList.contains('saved'), true);
    assert.match(get('project-file-status').textContent, /Project download started: Test project.bootcat/);
    assert.equal(await ui.save(), false); assert.equal(downloads, 1);
    await get('project-download-again').handlers.click(); assert.equal(downloads, 2);
    const reopened = open(); await reopened.refresh(); assert.equal(reopened.isSaved(), true);
    await storage.saveCorpusExport(project.id, { fingerprint: 'export bookkeeping', filename: 'corpus.zip' });
    await reopened.refresh(); assert.equal(reopened.isSaved(), true, 'corpus download receipts are not project edits');
    local.bootcatSettings = { version: 1, values: { fileMiB: 75 } };
    await reopened.refresh(); assert.equal(reopened.isSaved(), true, 'browser preferences do not travel in the project');
    await storage.saveDraft(project.id, { seeds: 'new seed' }); await reopened.refresh(); assert.equal(reopened.isSaved(), false);
    await reopened.save();
    const url = 'https://example.org/document', filename = 'pages/document.html';
    const extraction = { status: 'ok', included: true, text: 'Original text', characters: 13, warnings: [] };
    await storage.saveDocument(project.id, { url, filename, outcome: 'downloaded' }, { url, filename, textFilename: 'corpus/document.txt', extraction }, new Blob(['original']));
    await reopened.refresh(); assert.equal(reopened.isSaved(), false); await reopened.save();
    await storage.setIncluded(project.id, url, false); await reopened.refresh(); assert.equal(reopened.isSaved(), false); await reopened.save();
    await storage.saveEditedText(project.id, url, { filename, revision: 0 }, 'Edited text', { ...extraction, text: undefined, included: false, characters: 11 });
    await reopened.refresh(); assert.equal(reopened.isSaved(), false); await reopened.save();
    project.name = 'Renamed project'; await reopened.refresh(); assert.equal(reopened.isSaved(), false); await reopened.save();
    project.language = 'ita'; await reopened.refresh(); assert.equal(reopened.isSaved(), false); await reopened.save();
    local.collections = [{ id: 'search', engine: 'google', query: 'query', pageURL: 'https://www.google.com/search?q=query', unresolved: 0, results: [] }];
    await reopened.refresh(); assert.equal(reopened.isSaved(), false); await reopened.save();
    await savePage({ id: 'pending-capture', url: 'https://example.org/', html: '<p>Pending page</p>' }, project.id);
    await reopened.refresh(); assert.equal(reopened.isSaved(), false, 'pending captures must invalidate the download state');
    fail = true; await assert.rejects(reopened.save(), /Download preparation failed/);
    assert.equal(get('save-project').disabled, false); assert.equal(get('project-save-feedback').classList.contains('saved'), false);
    assert.match(get('project-file-status').textContent, /Could not save project/);
  } finally {
    globalThis.document = previousDocument; globalThis.chrome = previousChrome; globalThis.setTimeout = previousTimer;
    URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke; delete globalThis.indexedDB;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { corpusFingerprint } from '../src/export-state.js';
import * as storage from '../src/project-store.js';
import { workspace } from './helpers/workspace.js';

test('export identity covers project settings, lists, review choices and search provenance, but not its own receipt', async () => {
  const saved = { draft: { seeds: 'energy', tuples: 'energy storage', urls: 'https://example.org/' }, batch: { state: 'idle' }, entries: [{ doc: { filename: 'pages/1.html', extraction: { included: true } } }] };
  const project = { id: 'p', name: 'Corpus', language: 'none' }, collections = [{ query: 'energy', results: [] }];
  const first = await corpusFingerprint(saved, project, collections);
  assert.equal(await corpusFingerprint(saved, { language: project.language, name: project.name, id: project.id }, collections), first);
  assert.equal(await corpusFingerprint({ ...saved, corpusExport: { fingerprint: first } }, project, collections), first);
  for (const key of ['seeds', 'tuples', 'urls']) assert.notEqual(await corpusFingerprint({ ...saved, draft: { ...saved.draft, [key]: 'edited' } }, project, collections), first);
  for (const key of ['name', 'language']) assert.notEqual(await corpusFingerprint(saved, { ...project, [key]: 'changed' }, collections), first);
  assert.notEqual(await corpusFingerprint({ ...saved, entries: [{ doc: { filename: 'pages/1.html', extraction: { included: false } } }] }, project, collections), first);
  assert.notEqual(await corpusFingerprint(saved, project, []), first);
});

test('saving once disables duplicate downloads across focus and reload; edits and cross-window changes enable an updated export', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const app = await workspace('saved');
    await app.input('urls', 'https://example.org/'); await app.click('start');
    const otherWindow = await workspace('saved');
    await app.click('export');
    assert.equal(app.downloads(), 1); assert.equal(app.get('export').disabled, true);
    assert.equal(app.filename(), 'Corpus Test corpus.zip');
    assert.match(app.get('export-status').textContent, /Corpus saved.*Downloads folder/);
    await app.click('export'); assert.equal(app.downloads(), 1);
    await otherWindow.click('export'); assert.equal(otherWindow.downloads(), 0, 'a stale second window must not repeat the saved download');
    await app.focus(); assert.equal(app.get('export').disabled, true);
    await app.get('results').children[0].children[2].children[1].handlers.click();
    assert.equal(app.get('export').disabled, true, 'previewing is not a project edit');
    const reopened = await workspace('saved');
    assert.equal(reopened.get('export').disabled, true); assert.match(reopened.get('export-status').textContent, /Corpus saved/);
    await reopened.input('urls', 'https://example.org/\nhttps://new.test/');
    assert.equal(reopened.get('export').disabled, false); assert.match(reopened.get('export-status').textContent, /Project changed/);
    await reopened.click('export'); assert.equal(reopened.downloads(), 1); assert.equal(reopened.get('export').disabled, true);
    await storage.setIncluded('saved', 'https://example.org/', false);
    await reopened.focus(); assert.equal(reopened.get('export').disabled, false);
    await reopened.click('export'); assert.equal(reopened.downloads(), 2);
    const receipt = (await storage.loadWorkspace('saved')).corpusExport;
    await storage.saveCorpusExport('saved', { ...receipt, filename: 'Test corpus-2026-11-18.zip' });
    await reopened.focus(); assert.equal(reopened.get('export').disabled, false, 'old timestamped downloads can be replaced by the clearer filename');
    await reopened.click('export'); assert.equal(reopened.filename(), 'Corpus Test corpus.zip');
    await storage.resetStoredProject('new');
    assert.equal((await storage.loadWorkspace('new')).corpusExport, undefined);
  } finally { delete globalThis.indexedDB; }
});

test('an export failure keeps saving available and stores no successful-export receipt', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const app = await workspace('failed', { makeMetadataWorkbook: async () => { throw new Error('ZIP preparation failed'); } });
    await app.input('urls', 'https://example.org/'); await app.click('start'); await app.click('export');
    assert.equal(app.get('export').disabled, false); assert.equal(app.downloads(), 0);
    assert.match(app.get('export-status').textContent, /Could not export corpus.*Please try again/);
    assert.equal((await storage.loadWorkspace('failed')).corpusExport, undefined);
  } finally { delete globalThis.indexedDB; }
});

test('an old-layout export receipt permits a new download with the corrected URL lists', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const app = await workspace('old-layout');
    await app.input('urls', 'https://included.test/'); await app.click('start');
    const saved = await storage.loadWorkspace('old-layout'), project = { id: 'old-layout', name: 'Test corpus', language: 'none' };
    const oldData = JSON.stringify({ layoutVersion: 2, project, draft: saved.draft, batch: saved.batch, entries: saved.entries, collections: [] }, (_, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
    });
    const oldFingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(oldData)))].map(value => value.toString(16).padStart(2, '0')).join('');
    assert.notEqual(await corpusFingerprint(saved, project, []), oldFingerprint);
    await storage.saveCorpusExport('old-layout', { fingerprint: oldFingerprint, filename: 'Corpus Test corpus.zip' });
    const reopened = await workspace('old-layout');
    assert.equal(reopened.get('export').disabled, false);
    await reopened.click('export'); assert.equal(reopened.downloads(), 1);
    assert.equal(reopened.get('export').disabled, true);
  } finally { delete globalThis.indexedDB; }
});

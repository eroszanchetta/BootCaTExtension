import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as store from '../src/project-store.js';
import { savePage } from '../src/page-store.js';
import { makeProjectArchive, openProjectArchive, restoredProjectSnapshot } from '../src/portable-project.js';
import { makeStoredZIP } from '../src/zip-blob.js';
import { readPortableZIP } from '../src/portable-zip.js';
async function projectFixture() {
  const project = { id: 'source', name: 'Corpus 中文 à', language: 'none', nameConfirmed: true };
  await store.resetStoredProject(project.id, {}, project);
  await store.saveDraft(project.id, { seeds: 'one\ntwo', tuples: 'one two', preparedQueries: ['one two'], urls: 'https://example.test/\nhttps://failed.test/' });
  const url = 'https://example.test/', filename = 'pages/000001.html';
  await store.saveDocument(project.id, { url, filename, outcome: 'downloaded' }, { url, filename, textFilename: 'corpus/000001.txt', extraction: { status: 'ok', warnings: [], characters: 8, included: false, text: 'original', rawText: 'raw PDF' } }, new Blob(['<p>original source</p>'], { type: 'text/html' }));
  await store.saveEditedText(project.id, url, { filename, revision: 0 }, 'edited text', { status: 'ok', warnings: [], characters: 11, included: false });
  await store.saveFailure(project.id, { url: 'https://failed.test/', outcome: 'error', error: 'HTTP 403' });
  await savePage({ id: 'pending', url: 'https://pending.test/', html: '<p>pending original</p>' }, project.id);
  await store.saveBatch(project.id, { state: 'running', nextFileIndex: 5 }, [{ id: 'search', engine: 'google', query: 'one two', pageURL: 'https://google.com/search?q=one', unresolved: 0, results: [{ url, title: 'Title', positionOnPage: 1 }] }]);
  return store.snapshotStoredProject(project);
}
test('portable project round trip preserves every store, text baseline, exclusion, failure and pending capture, including ZIP64', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const snapshot = await projectFixture();
    for (const forceZIP64 of [false, true]) {
      const file = await makeProjectArchive(snapshot, { forceZIP64, appVersion: '2.1.0' });
      execFileSync('python3', ['-c', `
import sys,io,json,zipfile,datetime
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 when=datetime.datetime.fromisoformat(json.loads(z.read('project.json'))['savedAt'].replace('Z','+00:00')).astimezone()
 expected=(when.year,when.month,when.day,when.hour,when.minute,when.second//2*2)
 assert all(i.date_time==expected for i in z.infolist())
`], { input: Buffer.from(await file.arrayBuffer()) });
      const decoded = await openProjectArchive(file), restored = restoredProjectSnapshot(decoded);
      assert.equal(decoded.project.name, 'Corpus 中文 à');
      assert.notEqual(restored.project.id, snapshot.project.id);
      assert.equal(restored.stores.meta.find(r => r.key === 'batch').state, 'stopped');
      await store.replaceStoredProject(snapshot.project.id, restored, restored.project);
      assert.equal(await (await store.readOriginal(restored.project.id, 'pages/000001.html')).text(), '<p>original source</p>');
      assert.equal(await (await store.readText(restored.project.id, 'https://example.test/')).text(), 'edited text');
      assert.equal(await (await store.readOriginalText(restored.project.id, 'https://example.test/')).text(), 'original');
      assert.equal(await (await store.readRawText(restored.project.id, 'https://example.test/')).text(), 'raw PDF');
      const loaded = await store.loadWorkspace(restored.project.id);
      assert.equal(loaded.entries.length, 2); assert.equal(loaded.entries.find(e => e.doc)?.doc.extraction.included, false);
      assert.equal(loaded.draft.preparedQueries[0], 'one two'); assert.equal(loaded.searches.collections[0].results[0].title, 'Title');
      const imported = await store.snapshotStoredProject(restored.project);
      assert.equal(imported.stores.pages[0].html, '<p>pending original</p>');
      assert.equal(imported.stores.files.length, snapshot.stores.files.length);
      await store.resetStoredProject(snapshot.project.id, {}, snapshot.project);
    }
  } finally { delete globalThis.indexedDB; }
});
test('corruption, unsupported versions, unsafe paths, missing data and invalid metadata fail before replacing the active project', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const snapshot = await projectFixture(), file = await makeProjectArchive(snapshot), entries = await readPortableZIP(file);
    const data = JSON.parse(await entries.get('project.json').text());
    async function altered(change) { const manifest = structuredClone(data); change(manifest); return makeStoredZIP([...entries].map(([name, blob]) => name === 'project.json' ? { name, data: JSON.stringify(manifest) } : { name, blob })); }
    await assert.rejects(openProjectArchive(await altered(d => { d.version = 99; })), /different version/);
    await assert.rejects(openProjectArchive(await altered(d => { d.snapshot.stores.documents[0].url = 'javascript:alert(1)'; })), /invalid document/);
    await assert.rejects(openProjectArchive(await altered(d => { d.snapshot.stores.files[0].blob.$blob = 'missing'; })), /missing or invalid/);
    await assert.rejects(openProjectArchive(await makeStoredZIP([{ name: '../project.json', data: '{}' }])), /Invalid/);
    const corrupt = new Uint8Array(await file.arrayBuffer()); corrupt[45] ^= 1;
    await assert.rejects(openProjectArchive(new Blob([corrupt])), /damaged|Damaged/);
    const restored = restoredProjectSnapshot(snapshot);
    await assert.rejects(store.replaceStoredProject('stale-id', restored, restored.project), /project changed/);
    assert.equal(await store.storedProjectId(), 'source');
    assert.equal(await (await store.readText('source', 'https://example.test/')).text(), 'edited text');
  } finally { delete globalThis.indexedDB; }
});
test('a failed replacement rolls back clears and writes in every project store', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const snapshot = await projectFixture(), replacement = restoredProjectSnapshot(snapshot);
    replacement.stores.files.push(replacement.stores.files[0]);
    await assert.rejects(store.replaceStoredProject('source', replacement, replacement.project));
    assert.equal(await store.storedProjectId(), 'source');
    assert.equal(await (await store.readOriginal('source', 'pages/000001.html')).text(), '<p>original source</p>');
    assert.equal((await store.snapshotStoredProject(snapshot.project)).stores.pages.length, 1);
  } finally { delete globalThis.indexedDB; }
});

test('portable projects preserve a manual no-results outcome without inventing URLs or documents', async () => {
  globalThis.indexedDB=new IDBFactory();
  try {
    const snapshot=await projectFixture();
    const searches=snapshot.stores.meta.find(item=>item.key==='searches');
    const empty={id:'manual-empty',engine:'duckduckgo',query:'gynoecium corolla',pageURL:'https://duckduckgo.com/?q=gynoecium+corolla',status:'no-results',manual:true,unresolved:0,results:[],resultSetKey:'[[],0,[]]'};
    searches.collections.push(empty);
    const restored=await openProjectArchive(await makeProjectArchive(snapshot));
    assert.deepEqual(restored.stores.meta.find(item=>item.key==='searches').collections.at(-1),empty);
    const count=snapshot.stores.documents.length;
    assert.equal(restored.stores.documents.length,count);
    empty.results.push({url:'https://example.org/',title:'Not empty',positionOnPage:1});
    await assert.rejects(makeProjectArchive(snapshot),/invalid manual no-results/);
  } finally {delete globalThis.indexedDB;}
});

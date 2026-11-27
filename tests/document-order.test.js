import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as store from '../src/project-store.js';
import { transaction } from '../src/storage-db.js';
import { makeProjectArchive, openProjectArchive, restoredProjectSnapshot } from '../src/portable-project.js';
import { workspace, extracted } from './helpers/workspace.js';

const urls = ['z', 'a', 'm'].map(name => `https://example.org/${name}`);
test('URL order survives out-of-order saves, recovery, URL edits and portable reopening', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const project = { id: 'order', name: 'Order', language: 'none', nameConfirmed: true };
    await store.resetStoredProject(project.id, {}, project);
    await store.saveDraft(project.id, { urls: urls.join('\n') });
    for (const url of [...urls].reverse()) await store.saveFailure(project.id, { url, outcome: 'error' });
    assert.deepEqual((await store.loadWorkspace(project.id)).entries.map(e => e.url), urls);
    const url = urls[1], filename = 'pages/recovered.html';
    const recovered = await store.saveDocument(project.id, { url, filename, outcome: 'downloaded' }, {
      url, filename, textFilename: 'corpus/recovered.txt', extraction: extracted('Recovered text')
    }, new Blob(['source']));
    assert.equal(recovered.listPosition, 1);
    const added = 'https://example.org/00-new';
    await store.saveDraft(project.id, { urls: [added, ...urls].reverse().join('\n') });
    await store.saveFailure(project.id, { url: added, outcome: 'error' });
    const expected = [...urls, added];
    assert.deepEqual((await store.loadWorkspace(project.id)).entries.map(e => e.url), expected);
    const snapshot = await store.snapshotStoredProject(project);
    const restored = restoredProjectSnapshot(await openProjectArchive(await makeProjectArchive(snapshot)));
    await store.replaceStoredProject(project.id, restored, restored.project);
    assert.deepEqual((await store.loadWorkspace(restored.project.id)).entries.map(e => e.url), expected);
  } finally { delete globalThis.indexedDB; }
});

test('legacy projects use their saved URL list and retain it after the next write', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    await store.resetStoredProject('legacy-order');
    await store.saveDraft('legacy-order', { urls: urls.join('\n') });
    await transaction(['documents'], 'readwrite', tx => {
      for (const url of urls) tx.objectStore('documents').put({ url, record: { url, outcome: 'error' }, doc: null, fileNames: [], originalBytes: 0 });
    });
    assert.deepEqual((await store.loadWorkspace('legacy-order')).entries.map(e => e.url), urls);
    await store.saveFailure('legacy-order', { url: urls[1], outcome: 'error' });
    await store.saveDraft('legacy-order', { urls: [...urls].reverse().join('\n') });
    assert.deepEqual((await store.loadWorkspace('legacy-order')).entries.map(e => e.url), urls);
  } finally { delete globalThis.indexedDB; }
});

test('both visible lists keep URL order when issues are resolved in reverse order', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const english = 'Renewable energy requires careful planning and reliable electricity networks. Technical terminology describes generation capacity, storage systems and distribution. '.repeat(8);
    const app = await workspace('visible-order', { language: 'ita', extractor: async () => extracted(english) });
    await app.input('urls', urls.join('\n')); await app.click('start');
    const visible = id => app.get(id).children.map(row => row.children[1].children[0].href);
    assert.deepEqual(visible('problem-results'), urls);
    for (const index of [2, 0, 1]) {
      const row = app.get('problem-results').children.find(row => row.children[1].children[0].href === urls[index]);
      await row.children[2].children.find(node => node.textContent === 'Include anyway').handlers.click();
      const included = new Set(visible('results'));
      assert.deepEqual(visible('results'), urls.filter(url => included.has(url)));
      assert.deepEqual(visible('problem-results'), urls.filter(url => !included.has(url)));
    }
    await app.focus(); assert.deepEqual(visible('results'), urls);
    const reopened = await workspace('visible-order', { language: 'ita' });
    assert.deepEqual(reopened.get('results').children.map(row => row.children[1].children[0].href), urls);
  } finally { delete globalThis.indexedDB; }
});

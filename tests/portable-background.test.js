import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as store from '../src/project-store.js';
import { stageProject, readStagedProject, removeStagedProject } from '../src/project-transfer.js';
for (const namespace of ['chrome', 'browser']) test(`${namespace}: portable background handoff preserves preferences and provenance and rejects stale imports`, async () => {
  globalThis.indexedDB = new IDBFactory();
  const local = { bootcatSettings: { version: 1, revision: 2, values: { fileMiB: 25 } }, collectionControls: { version: 1, values: { floatingPosition: 'bottom-left' } }, userDefaults: { version: 1, values: {} } }, session = {};
  const preferences = structuredClone(local); let listener;
  const area = data => ({ get: async key => key === null ? structuredClone(data) : { [key]: structuredClone(data[key]) }, set: async patch => Object.assign(data, structuredClone(patch)), remove: async keys => { for (const key of keys) delete data[key]; } });
  const origin = `${namespace === 'browser' ? 'moz' : 'chrome'}-extension://portable/`;
  globalThis[namespace] = { runtime: { id: 'portable', getURL: path => origin + path, onMessage: { addListener(fn) { listener = fn; } } }, storage: { local: area(local), session: area(session) }, tabs: { query: async () => [] } };
  try {
    await import(`../src/background.js?portable=${namespace}`);
    const request = message => new Promise(resolve => listener(message, { id: 'portable', url: origin + 'downloader.html' }, resolve));
    const { project } = await request({ type: 'new-project', projectId: null, name: 'Original', language: 'none' });
    await store.saveDraft(project.id, { seeds: 'saved seeds' });
    const collections = [{ id: 'one', engine: 'google', query: 'seeds', pageURL: 'https://google.com/search?q=seeds', unresolved: 0, results: [{ url: 'https://result.test/', title: 'Result', positionOnPage: 1 }] }];
    local.collections = collections;
    const prepared = await request({ type: 'prepare-project-save', projectId: project.id }); assert.equal(prepared.ok, true, prepared.error);
    const snapshot = await readStagedProject(prepared.token); assert.deepEqual(snapshot.stores.meta.find(r => r.key === 'searches').collections, collections);
    await removeStagedProject(prepared.token);
    const token = await stageProject(snapshot);
    assert.equal((await request({ type: 'open-portable-project', projectId: 'stale', token })).ok, false);
    assert.equal(await store.storedProjectId(), project.id);
    const opened = await request({ type: 'open-portable-project', projectId: project.id, token }); assert.equal(opened.ok, true, opened.error);
    assert.notEqual(opened.project.id, project.id); assert.deepEqual(local.collections, collections);
    for (const key of Object.keys(preferences)) assert.deepEqual(local[key], preferences[key]);
    assert.equal((await store.loadWorkspace(opened.project.id)).draft.seeds, 'saved seeds');
    assert.deepEqual(session.projectSearchTabs.tabs, []);
    assert.equal(await readStagedProject(token), undefined);
    assert.equal((await request({ type: 'open-portable-project', projectId: opened.project.id, token })).ok, false);
    // Recover an interruption between the database commit and local notification.
    local.project = project; local.collections = [];
    const recovered = await request({ type: 'get-project' });
    assert.equal(recovered.project.id, opened.project.id); assert.deepEqual(local.collections, collections);
  } finally { delete globalThis[namespace]; delete globalThis.indexedDB; }
});

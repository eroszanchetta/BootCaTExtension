import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { validateCorpusOptions, applyLengthFilter, hasLengthWarning, lengthMessage, corpusDefaults } from '../src/corpus-options.js';
import { DEFAULT_SETTINGS, validateSettings } from '../src/settings.js';
import * as store from '../src/project-store.js';
import { checkEditedText } from '../src/text-review.js';
import { makeProjectArchive, openProjectArchive, restoredProjectSnapshot } from '../src/portable-project.js';
import { workspace, extracted, waitFor } from './helpers/workspace.js';

test('optional inclusive character ranges validate independently of processing limits', () => {
  assert.deepEqual(validateCorpusOptions({}), { extractor: 'readability', languageDetector: 'franc', minimumCharacters: null, maximumCharacters: null });
  for (const value of [0, -1, 1.5, NaN, Infinity, 100000001, '10']) assert.throws(() => validateCorpusOptions({ minimumCharacters: value }));
  assert.throws(() => validateCorpusOptions({ minimumCharacters: 20, maximumCharacters: 10 }), /Minimum/);
  assert.throws(() => validateCorpusOptions({ extractor: 'unknown' }));
  assert.throws(() => validateSettings({ defaultMinimumCharacters: 20, defaultMaximumCharacters: 10 }));
  assert.deepEqual(corpusDefaults(DEFAULT_SETTINGS), validateCorpusOptions({languageDetector:'native-franc'}));
  for (const characters of [10, 20]) assert.equal(hasLengthWarning(applyLengthFilter(extracted('a'.repeat(characters)), { minimumCharacters: 10, maximumCharacters: 20 })), false);
  const short = applyLengthFilter(extracted('a'.repeat(9)), { minimumCharacters: 10 });
  assert.equal(short.included, false); assert.match(lengthMessage(short), /Too short: 9 characters/);
  assert.equal(applyLengthFilter(short, {}).included, true);
  const manual = applyLengthFilter({ ...short, inclusionOverride: false }, {});
  assert.equal(manual.included, false);
});

test('length and language checks compose without restoring a blocked inclusion', () => {
  const e = { ...extracted('hello'), languageCheck: { outcome: 'mismatch', target: 'ita', detected: 'eng', inclusionBeforeCheck: true } };
  const short = applyLengthFilter(e, { minimumCharacters: 10 });
  assert.equal(hasLengthWarning(short), true); assert.equal(short.included, false);
  assert.equal(applyLengthFilter(short, {}).included, false, 'clearing length does not accept language');
  const accepted = { ...short, inclusionOverride: true, languageCheck: { ...e.languageCheck, accepted: true } };
  assert.equal(applyLengthFilter(accepted, { maximumCharacters: 1 }).included, true);
  assert.equal(applyLengthFilter({ ...accepted, languageCheck: { ...e.languageCheck, accepted: false } }, {}).included, false);
});

test('project filters recheck persisted text, preserve choices, reassess Unicode edits and survive portable transfer', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const project = { id: 'length', name: 'Length', language: 'none', nameConfirmed: true };
    await store.resetStoredProject(project.id, {}, project);
    const url = 'https://example.org/text', filename = 'pages/text.html';
    await store.saveDocument(project.id, { url, filename, outcome: 'downloaded' }, { url, filename, textFilename: 'corpus/text.txt', extraction: extracted('abc') }, new Blob(['original']));
    await store.saveCorpusOptions(project.id, { minimumCharacters: 5, extractor: 'defuddle' }, 0);
    let entry = (await store.loadWorkspace(project.id)).entries[0];
    assert.equal(hasLengthWarning(entry.doc.extraction), true); assert.equal(entry.doc.extraction.included, false);
    const text = 'a😀\nbc'; // Five Unicode code points, including the line break.
    const e = await checkEditedText(entry.doc.extraction, text, 'none');
    entry = await store.saveEditedText(project.id, url, { filename, revision: 0 }, text, e);
    assert.equal(entry.doc.extraction.characters, 5); assert.equal(entry.doc.extraction.included, true);
    await store.setIncluded(project.id, url, false);
    await store.saveCorpusOptions(project.id, { maximumCharacters: 2 }, 1);
    await store.saveCorpusOptions(project.id, {}, 2);
    entry = (await store.loadWorkspace(project.id)).entries[0];
    assert.equal(entry.doc.extraction.included, false, 'manual exclusion survives filter changes');
    await store.saveCorpusOptions(project.id, { maximumCharacters: 2 }, 3);
    entry = await store.acceptDocumentIssues(project.id, url);
    assert.equal(entry.doc.extraction.included, true); assert.equal(hasLengthWarning(entry.doc.extraction), false);
    assert.ok(entry.doc.manualInterventions.includes('length-override'));
    await store.saveCorpusOptions(project.id, { maximumCharacters: 1 }, 4);
    await assert.rejects(store.saveCorpusOptions(project.id, {}, 0), /another window/);
    const snapshot = await store.snapshotStoredProject(project);
    const restored = restoredProjectSnapshot(await openProjectArchive(await makeProjectArchive(snapshot)));
    await store.replaceStoredProject(project.id, restored, restored.project);
    const reopened = await store.loadWorkspace(restored.project.id);
    assert.equal(reopened.draft.maximumCharacters, 1);
    assert.equal(reopened.entries[0].doc.extraction.included, true);
    assert.equal(await (await store.readText(restored.project.id, url)).text(), text);
    assert.equal(await (await store.readOriginal(restored.project.id, filename)).text(), 'original');
  } finally { delete globalThis.indexedDB; }
});

test('length issues move between visible sections with concise feedback and preserved order', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const events = [], app = await workspace('length-ui', { onRecoveryFeedback: value => events.push(value) });
    await app.input('urls', 'https://example.org/z\nhttps://example.org/a'); await app.click('start');
    await store.saveCorpusOptions('length-ui', { minimumCharacters: 1000 }, 0);
    await app.notify({ workspaceRevision: { newValue: { projectId: 'length-ui', reason: 'corpus-options' } } });
    await waitFor(() => app.get('problem-results').children.length === 2);
    const row = app.get('problem-results').children[1];
    assert.ok(row.children[2].children.some(node => node.className === 'hint length-status' && node.textContent.includes('Too short:')));
    await row.children[2].children.find(node => node.textContent === 'Include anyway').handlers.click();
    assert.equal(app.get('document-import-status').textContent, 'Length warning accepted');
    await store.saveCorpusOptions('length-ui', {}, 1);
    await app.notify({ workspaceRevision: { newValue: { projectId: 'length-ui', reason: 'corpus-options' } } });
    await waitFor(() => app.get('results').children.length === 2);
    assert.equal(app.get('problem-results').children.length, 0);
    assert.deepEqual(app.get('results').children.map(row => row.children[1].children[0].href), ['https://example.org/z', 'https://example.org/a']);
    const count = events.length; await app.focus(); assert.equal(events.length, count);
  } finally { delete globalThis.indexedDB; }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { IDBFactory } from 'fake-indexeddb';
import { workspace, extracted } from './helpers/workspace.js';
import * as storage from '../src/project-store.js';
import { transaction } from '../src/storage-db.js';
import { checkEditedText } from '../src/text-review.js';
import { checkLanguage } from '../src/language-detection.js';

const preview = async app => app.get('results').children[0].children[2].children[1].handlers.click();
const edit = async (app, value) => { await app.click('text-review-edit'); await app.input('preview-text', value); };

test('Cancel restores the current edit baseline and exits editing without saving', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const url = 'https://example.org/undo', original = 'Downloaded corpus text';
    const app = await workspace('undo'); await app.input('urls', url); await app.click('start'); await app.click('export');
    await preview(app);
    assert.equal(app.get('text-review-edit').textContent, 'Edit');
    await app.click('text-review-edit');
    assert.equal(app.get('text-review-edit').textContent, 'Cancel');
    assert.equal(app.get('text-review-edit').classList.contains('danger'), true);
    assert.equal(app.get('text-review-edit').classList.contains('secondary'), false);
    assert.equal(app.get('text-review-edit').disabled, false);
    await app.click('text-review-edit');
    assert.equal(app.get('text-review-edit').textContent, 'Edit');
    assert.equal(app.get('preview-text').readOnly, true, 'Cancel exits editing even without changes');
    await app.click('text-review-edit');
    await app.input('preview-text', 'Unsaved first edit');
    assert.equal(app.beforeUnload(), true);
    await app.click('text-review-edit');
    assert.equal(app.get('preview-text').value, original);
    assert.equal(app.get('preview-text').readOnly, true);
    assert.equal(app.get('text-review-edit').textContent, 'Edit');
    assert.equal(app.get('text-review-edit').classList.contains('danger'), false);
    assert.equal(app.get('text-review-edit').classList.contains('secondary'), true);
    assert.equal(app.get('text-review-save').disabled, true);
    assert.equal(app.beforeUnload(), false);
    assert.equal(app.get('export').disabled, true, 'Cancel does not invalidate the saved corpus');
    assert.equal((await storage.loadWorkspace('undo')).entries[0].doc.editRevision || 0, 0);
    await edit(app, 'Saved first edit'); await app.click('text-review-save');
    assert.equal(app.get('text-review-edit').textContent, 'Edit');
    await app.click('text-review-close'); await preview(app);
    await edit(app, 'Unsaved second edit'); await app.click('text-review-edit');
    assert.equal(app.get('preview-text').value, 'Saved first edit');
    assert.equal(app.get('preview-text').readOnly, true);
    assert.equal(app.get('text-review-edit').textContent, 'Edit');
    assert.equal(await (await storage.readText('undo', url)).text(), 'Saved first edit');
    assert.equal(await (await storage.readOriginalText('undo', url)).text(), original);
    assert.equal((await storage.loadWorkspace('undo')).entries[0].doc.editRevision, 1);
    await edit(app, 'Saved second edit'); await app.click('text-review-save');
    assert.equal(await (await storage.readText('undo', url)).text(), 'Saved second edit');
  } finally { delete globalThis.indexedDB; }
});

test('edited text persists, updates counts/report, invalidates export and preserves source, baseline and raw PDF in the ZIP', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const baseline = 'Cleaned PDF extraction.', raw = 'Cleaned PDF\nextraction.';
    const app = await workspace('editing', { extractor: async () => ({ ...extracted(baseline), rawText: raw, format: 'pdf' }) });
    await app.input('urls', 'https://example.org/document.pdf'); await app.click('start'); await app.click('export');
    assert.equal(app.get('export').disabled, true);
    await preview(app); assert.equal(app.get('text-review-dialog').open, true); assert.equal(app.get('preview-text').readOnly, true);
    assert.equal(app.get('text-review-save').disabled, true); assert.equal(app.get('export').disabled, true);
    const edited = 'Edited café 中文 🐱\nSecond paragraph.';
    await edit(app, edited); assert.equal(app.beforeUnload(), true);
    await app.click('text-review-save');
    assert.equal(app.get('preview-text').readOnly, true); assert.equal(app.get('text-review-save').disabled, true);
    assert.match(app.get('text-review-status').textContent, /Text saved in this project/);
    assert.equal(app.get('export').disabled, false); assert.equal(app.beforeUnload(), false);
    let entry = (await storage.loadWorkspace('editing')).entries[0];
    assert.equal(entry.doc.editRevision, 1); assert.ok(entry.doc.editedAt);
    assert.equal(entry.doc.extraction.characters, Array.from(edited).length);
    assert.equal(entry.doc.extraction.text, undefined);
    assert.equal(await (await storage.readOriginalText('editing', entry.url)).text(), baseline);
    assert.equal(await (await storage.readRawText('editing', entry.url)).text(), raw);
    assert.equal(await (await storage.readOriginal('editing', entry.doc.filename)).text(), 'source');
    await edit(app, edited + '\nAnother edit.'); await app.click('text-review-save');
    assert.equal(await (await storage.readOriginalText('editing', entry.url)).text(), baseline);
    await app.click('text-review-close'); assert.equal(app.get('text-review-dialog').open, false);
    const reopened = await workspace('editing'); await preview(reopened);
    assert.equal(reopened.get('preview-text').value, edited + '\nAnother edit.');
    await reopened.click('text-review-close'); await reopened.click('export');
    entry = (await storage.loadWorkspace('editing')).entries[0];
    const result = JSON.parse(execFileSync('python3', ['-c', `
import io,sys,json,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 doc=json.loads(z.read('extraction.json'))['documents'][0]
 with zipfile.ZipFile(io.BytesIO(z.read('Report.xlsx'))) as report:
  row=E.fromstring(report.read('xl/worksheets/sheet1.xml')).findall('{*}sheetData/{*}row')[1]
  characters=int(row.findall('{*}c')[2].find('{*}v').text)
 print(json.dumps({'text':z.read(doc['textFilename']).decode(), 'baseline':z.read(doc['originalTextFilename']).decode(), 'raw':z.read(doc['rawTextFilename']).decode(), 'original':z.read(doc['originalFilename']).decode(), 'characters':characters,'revision':doc['editRevision']}))
`], { input: Buffer.from(await reopened.archive().arrayBuffer()), encoding: 'utf8' }));
    assert.equal(result.text, edited + '\nAnother edit.\n'); assert.equal(result.baseline, baseline); assert.equal(result.raw, raw + '\n'); assert.equal(result.original, 'source');
    assert.equal(result.characters, entry.doc.extraction.characters); assert.equal(result.revision, 2);
    await storage.removeDocument('editing', entry.url); assert.equal(await storage.readOriginalText('editing', entry.url), null);
  } finally { delete globalThis.indexedDB; }
});

test('closing by button or Escape protects dirty edits; empty saves fail without changing stored text', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const app = await workspace('discard'); await app.input('urls', 'https://example.org/'); await app.click('start');
    await preview(app); await edit(app, 'Unsaved edit');
    app.setConfirm(false); await app.click('text-review-close');
    assert.equal(app.get('text-review-dialog').open, true); assert.equal(app.get('preview-text').value, 'Unsaved edit');
    await app.focus(); assert.equal(app.get('preview-text').value, 'Unsaved edit');
    await app.input('preview-text', '   '); await app.click('text-review-save');
    assert.match(app.get('text-review-status').textContent, /Enter some text/); assert.equal(app.get('preview-text').readOnly, false);
    assert.equal(await (await storage.readText('discard', 'https://example.org/')).text(), 'Downloaded corpus text');
    app.setConfirm(true); await app.click('text-review-close');
    assert.equal(app.get('text-review-dialog').open, false); assert.equal(app.beforeUnload(), false);
    await preview(app); assert.equal(app.get('preview-text').value, 'Downloaded corpus text');
    await edit(app, 'Escape edit'); let prevented = false;
    app.get('text-review-dialog').handlers.cancel({ preventDefault() { prevented = true; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prevented, true); assert.equal(app.get('text-review-dialog').open, false);
  } finally { delete globalThis.indexedDB; }
});

test('legacy baselines backfill on first edit and optimistic revision checks prevent overwriting newer edits', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const app = await workspace('legacy'); await app.input('urls', 'https://example.org/'); await app.click('start');
    const entry = (await storage.loadWorkspace('legacy')).entries[0];
    await transaction(['texts', 'documents'], 'readwrite', tx => {
      const text = tx.objectStore('texts').get(entry.url), document = tx.objectStore('documents').get(entry.url);
      text.onsuccess = () => { delete text.result.originalBlob; tx.objectStore('texts').put(text.result); };
      document.onsuccess = () => { delete document.result.doc.originalTextFilename; delete document.result.doc.editRevision; tx.objectStore('documents').put(document.result); };
    });
    await preview(app); await edit(app, 'My pending edit');
    const other = await checkEditedText(entry.doc.extraction, 'Other window saved text', 'none'); delete other.text;
    await storage.saveEditedText('legacy', entry.url, { filename: entry.doc.filename, revision: 0 }, 'Other window saved text', other);
    await app.click('text-review-save');
    assert.match(app.get('text-review-status').textContent, /changed in another window/);
    assert.equal(app.get('preview-text').value, 'My pending edit'); assert.equal(app.get('preview-text').readOnly, false);
    assert.equal(await (await storage.readText('legacy', entry.url)).text(), 'Other window saved text');
    assert.equal(await (await storage.readOriginalText('legacy', entry.url)).text(), 'Downloaded corpus text');
    await storage.resetStoredProject('next');
    await assert.rejects(storage.saveEditedText('legacy', entry.url, { filename: entry.doc.filename, revision: 1 }, 'stale', other), /project changed/);
  } finally { delete globalThis.indexedDB; }
});

test('editing rechecks language, clears acceptance of the previous text, and preserves deliberate exclusion', async () => {
  const english = 'Renewable energy requires careful planning and reliable electricity networks. Technical terminology describes generation capacity, storage systems and distribution. Translators need clear examples of these expressions in context. '.repeat(5);
  let original = await checkLanguage(extracted(english), 'eng');
  original.languageCheck = { ...original.languageCheck, accepted: true, acceptedAt: 'old' };
  const edited = await checkEditedText(original, english, 'ita');
  assert.ok(['mismatch', 'uncertain'].includes(edited.languageCheck.outcome)); assert.equal(edited.languageCheck.target, 'ita'); assert.equal(edited.languageCheck.accepted, false); assert.equal(edited.languageCheck.acceptedAt, undefined); assert.equal(edited.included, false);
  original.included = false; original.languageCheck.inclusionBeforeCheck = false;
  assert.equal((await checkEditedText(original, english, 'eng')).included, false);
});

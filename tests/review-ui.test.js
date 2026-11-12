import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { workspace, extracted } from './helpers/workspace.js';

const source = row => row.children[1].children[0].href;
const preview = row => row.children[2].children[1].handlers.click();
const trash = row => row.children[3].children[0].handlers.click();

test('review separates all problem types, recovers failed downloads, and hides attention after recovery/deletion', async () => {
  globalThis.indexedDB = new IDBFactory(); let recover = false;
  const app = await workspace('review', {
    fetch: async url => { if (url.endsWith('/failed') && !recover) throw new Error('HTTP 403'); return { bytes: new Uint8Array([1]), contentType: 'text/html', finalURL: url, status: 200 }; },
    extractor: async (bytes, type, options) => options.sourceURL.endsWith('/unsupported') ? { ...extracted(''), status: 'unsupported', included: false, warnings: ['Unsupported format'] }
      : options.sourceURL.endsWith('/scanned') ? { ...extracted(''), status: 'failed', included: false, warnings: ['No text. OCR may be required.'] } : extracted('Usable text')
  });
  assert.equal(app.get('attention-section').hidden, true);
  await app.input('urls', ['good', 'failed', 'unsupported', 'scanned'].map(path => 'https://example.org/' + path).join('\n')); await app.click('start');
  assert.equal(app.get('results').children.length, 1); assert.equal(app.get('problem-results').children.length, 3);
  assert.equal(app.get('attention-section').hidden, false); assert.equal(app.get('attention-count').textContent, '3 documents');
  const included = app.get('results').children[0].children[0].children[0]; included.checked = false; await included.handlers.change();
  assert.equal(app.get('results').children.length, 1, 'unchecked usable text stays in the main list');
  const restored = await workspace('review'); assert.equal(restored.get('problem-results').children.length, 3);
  recover = true; await app.click('start');
  assert.equal(app.get('results').children.length, 2); assert.equal(app.get('problem-results').children.length, 2);
  assert.ok(app.get('results').children.some(row => source(row).endsWith('/failed')));
  while (app.get('problem-results').children.length) await trash(app.get('problem-results').children[0]);
  assert.equal(app.get('attention-section').hidden, true); assert.equal(app.get('attention-count').textContent, '0 documents');
});

test('preview highlight follows the selected row across lists and refreshes, and clears after deleting it', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('selection', { extractor: async (bytes, type, options) => options.sourceURL.endsWith('/bad') ? { ...extracted(''), status: 'failed', included: false } : extracted('Preview body') });
  await app.input('urls', 'https://example.org/first\nhttps://example.org/second\nhttps://example.org/bad'); await app.click('start');
  let [first, second] = app.get('results').children;
  assert.equal(first.classList.contains('preview-selected'), false);
  await preview(first); assert.equal(first.classList.contains('preview-selected'), true); assert.equal(first.attributes['aria-current'], 'true');
  await preview(second); assert.equal(first.classList.contains('preview-selected'), false); assert.equal(second.classList.contains('preview-selected'), true);
  await app.focus(); [first, second] = app.get('results').children;
  assert.equal(second.classList.contains('preview-selected'), true);
  const bad = app.get('problem-results').children[0]; await preview(bad);
  assert.equal(second.classList.contains('preview-selected'), false); assert.equal(bad.classList.contains('preview-selected'), true);
  await trash(bad); assert.equal(app.get('preview-text').value, ''); assert.equal(app.get('attention-section').hidden, true);
  assert.ok(app.get('results').children.every(row => !row.classList.contains('preview-selected')));
  const reopened = await workspace('selection'); assert.ok(reopened.get('results').children.every(row => !row.classList.contains('preview-selected')));
});

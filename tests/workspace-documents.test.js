import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDownloadedDocument } from '../src/binary-extraction.js';
import { pdfFixture } from './browser-tests.fixtures.js';
import { workspace } from './helpers/workspace.js';
import { loadWorkspace } from '../src/project-store.js';

test('persistent workspace awaits PDF extraction and exports original bytes plus corpus metadata', async () => {
  globalThis.indexedDB = new IDBFactory();
  const bytes = pdfFixture();
  const app = await workspace('pdf-project', {
    fetch: async url => ({ bytes, finalURL: url, status: 200, contentType: 'application/pdf' }),
    extractor: (bytes, type, options) => extractDownloadedDocument(bytes, type, { ...options, loadPDF: async () => pdfjs })
  });
  await app.input('urls', 'https://example.org/download');
  await app.click('start');
  const saved = await loadWorkspace('pdf-project');
  assert.equal(saved.entries[0].doc.extraction.status, 'ok'); assert.equal(saved.entries[0].doc.extraction.extractor, 'pdfjs');
  assert.equal(saved.entries[0].doc.extraction.text, undefined);
  assert.equal(app.get('preview-text').value, '');
  await app.click('export');
  const zipText = new TextDecoder().decode(await app.archive().arrayBuffer());
  assert.ok(zipText.includes('%PDF-1.4')); assert.ok(zipText.includes('Renewable energy corpus.'));
  assert.ok(zipText.includes('project.json')); assert.ok(zipText.includes('pdfjs'));
});

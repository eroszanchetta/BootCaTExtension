import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { readImportedDocument, readDocumentFile } from '../src/document-formats.js';
import { DOCX_MIME } from '../src/docx.js';
import { makeZIP } from '../src/zip.js';
import { docxFiles, pdfFixture } from './browser-tests.fixtures.js';
import { workspace, extracted } from './helpers/workspace.js';
import * as storage from '../src/project-store.js';

test('recovery detects bytes independently of misleading filenames and MIME labels', async () => {
  const docx = new File([await makeZIP(docxFiles).arrayBuffer()], 'report.pdf', { type: 'application/pdf' });
  assert.equal((await readImportedDocument(docx)).format.id, 'docx');
  assert.equal((await readImportedDocument(new File([pdfFixture()], 'report.docx', { type: DOCX_MIME }))).format.id, 'pdf');
  assert.equal((await readImportedDocument(new File([pdfFixture()], 'download'))).format.id, 'pdf');
  await assert.rejects(readImportedDocument(new Blob(['<html>CAPTCHA</html>'])), /Unsupported file contents/);
  await assert.rejects(readImportedDocument(makeZIP([{ name: 'ppt/presentation.xml', data: '<x/>' }])), /Unsupported file contents/);
  await assert.rejects(readImportedDocument(new Blob()), /non-empty/);
  await assert.rejects(readImportedDocument(new Blob(['12345']), 4), /file limit/);
  await assert.rejects(readImportedDocument(new Blob(['PKbroken'])), /Could not read the selected file/);
});
test('selected document validation checks actual PDF or DOCX bytes and rejects HTML and other ZIP formats', async () => {
  const docx = makeZIP(docxFiles);
  assert.ok((await readDocumentFile(docx, 'docx')).length > 0);
  assert.ok((await readDocumentFile(new Blob([pdfFixture()]), 'pdf')).length > 0);
  await assert.rejects(readDocumentFile(new Blob(['<html>CAPTCHA</html>']), 'docx'), /does not contain a DOCX/);
  await assert.rejects(readDocumentFile(new Blob([pdfFixture()]), 'docx'), /does not contain a DOCX/);
  await assert.rejects(readDocumentFile(makeZIP([{ name: 'ppt/presentation.xml', data: '<x/>' }]), 'docx'), /does not contain a DOCX/);
  await assert.rejects(readDocumentFile(docx, 'pdf'), /does not contain a PDF/);
  const alternative = docxFiles.map(file => ({ name: file.name === 'word/document.xml' ? 'content/main.xml' : file.name, data: file.data.replaceAll('word/document.xml', 'content/main.xml') }));
  assert.ok((await readDocumentFile(makeZIP(alternative), 'docx')).length > 0);
});
test('all failed download URLs share generic guidance and an unrestricted picker', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('formats', { fetch: async () => { throw new Error('HTTP 403'); } });
  await app.input('urls', 'https://example.org/page.html\nhttps://example.org/report.pdf\nhttps://example.org/report.docx\nhttps://example.org/download?id=1'); await app.click('start');
  const rows = app.get('problem-results').children, button = row => row.children[1].children.find(item => item.className === 'secondary import-document-button');
  for (const row of rows) {
    assert.equal(button(row).textContent, 'Import downloaded file');
    assert.match(row.children[2].textContent, /Add this page to corpus/);
    assert.match(row.children[2].textContent, /Import downloaded file/);
    assert.doesNotMatch(row.children[2].textContent, /PDF|DOCX/);
  }
  button(rows[2]).handlers.click(); assert.equal(app.get('import-document-picker').accept, '');
});
test('DOCX recovery replaces only its failed row, preserves the original and persists/extracts/exports as DOCX', async () => {
  globalThis.indexedDB = new IDBFactory();
  const original = new Uint8Array(await makeZIP(docxFiles).arrayBuffer());
  const app = await workspace('docx-import', { fetch: async () => { throw new Error('HTTP 403'); }, extractor: async (bytes, type) => {
    assert.equal(type, DOCX_MIME); assert.deepEqual(bytes, original); return { ...extracted('Recovered DOCX text'), format: 'docx' };
  } });
  await app.input('urls', 'https://example.org/blocked.pdf'); await app.click('start');
  app.get('problem-results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  app.get('import-document-picker').files = [new Blob([original])]; await app.get('import-document-picker').handlers.change();
  const entry = (await storage.loadWorkspace('docx-import')).entries[0];
  assert.equal(entry.record.contentType, DOCX_MIME); assert.match(entry.doc.filename, /\.docx$/); assert.equal(entry.record.source, 'local-file');
  assert.match(app.get('document-import-status').textContent, /Text recovered successfully/);
  assert.match(app.get('results').children[0].children[2].children[0].textContent, /^Imported DOCX/);
  assert.deepEqual(new Uint8Array(await (await storage.readOriginal('docx-import', entry.doc.filename)).arrayBuffer()), original);
  const reopened = await workspace('docx-import'); await reopened.get('results').children[0].children[2].children[1].handlers.click();
  assert.equal(reopened.get('preview-text').value, 'Recovered DOCX text'); await reopened.click('export');
  const zip = await reopened.archive().text(); assert.ok(zip.includes(entry.doc.filename)); assert.ok(zip.includes('Recovered DOCX text'));
});
test('response MIME hints do not change generic recovery controls', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('mime', { fetch: async () => { throw Object.assign(new Error('HTTP 403'), { contentType: DOCX_MIME, finalURL: 'https://example.org/resource?id=1' }); } });
  await app.input('urls', 'https://example.org/resource?id=1'); await app.click('start');
  const entry = (await storage.loadWorkspace('mime')).entries[0]; assert.equal(entry.record.contentType, DOCX_MIME);
  assert.equal(app.get('problem-results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').textContent, 'Import downloaded file');
});

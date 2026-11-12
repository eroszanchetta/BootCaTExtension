import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { recoveryFormat, readDocumentFile, formatAccept, formatById } from '../src/document-formats.js';
import { DOCX_MIME } from '../src/docx.js';
import { makeZIP } from '../src/zip.js';
import { docxFiles, pdfFixture } from './browser-tests.fixtures.js';
import { workspace, extracted } from './helpers/workspace.js';
import * as storage from '../src/project-store.js';

test('recovery format requires a supported extension, filename hint or MIME type; HTML and unknown pages have no default', () => {
  for (const url of ['https://example.org/', 'https://example.org/page.html', 'https://example.org/download?id=42', 'https://example.org/file.pptx', 'https://google.com/search?q=file.pdf']) assert.equal(recoveryFormat({ url }), null);
  for (const [record, expected] of [
    [{ url: 'https://example.org/a.PDF?download=1' }, 'pdf'],
    [{ url: 'https://example.org/a%2Edocx' }, 'docx'],
    [{ url: 'https://example.org/download?filename=notes.docx' }, 'docx'],
    [{ url: 'https://example.org/download', finalURL: 'https://files.test/a.pdf' }, 'pdf'],
    [{ url: 'https://example.org/download', contentType: DOCX_MIME }, 'docx'],
    [{ url: 'https://example.org/a.docx', contentType: 'text/html' }, 'docx']
  ]) assert.equal(recoveryFormat(record)?.id, expected);
  assert.ok(formatAccept(formatById('docx')).includes('.docx'));
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
test('failed HTML has no document button; failed PDF and DOCX have the correct labels and picker filters', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('formats', { fetch: async () => { throw new Error('HTTP 403'); } });
  await app.input('urls', 'https://example.org/page.html\nhttps://example.org/report.pdf\nhttps://example.org/report.docx'); await app.click('start');
  const rows = app.get('results').children, button = row => row.children[1].children.find(item => item.className === 'secondary import-document-button');
  assert.equal(button(rows[0]), undefined); assert.ok(!rows[0].children[2].textContent.includes('PDF'));
  assert.equal(button(rows[1]).textContent, 'Choose downloaded PDF'); assert.equal(button(rows[2]).textContent, 'Choose downloaded DOCX');
  button(rows[2]).handlers.click(); assert.ok(app.get('import-document-picker').accept.includes('.docx'));
  assert.ok(!app.get('import-document-picker').accept.includes('.pdf'));
});
test('DOCX recovery replaces only its failed row, preserves the original and persists/extracts/exports as DOCX', async () => {
  globalThis.indexedDB = new IDBFactory();
  const original = new Uint8Array(await makeZIP(docxFiles).arrayBuffer());
  const app = await workspace('docx-import', { fetch: async () => { throw new Error('HTTP 403'); }, extractor: async (bytes, type) => {
    assert.equal(type, DOCX_MIME); assert.deepEqual(bytes, original); return { ...extracted('Recovered DOCX text'), format: 'docx' };
  } });
  await app.input('urls', 'https://example.org/blocked.docx'); await app.click('start');
  app.get('results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  app.get('import-document-picker').files = [new Blob([original])]; await app.get('import-document-picker').handlers.change();
  const entry = (await storage.loadWorkspace('docx-import')).entries[0];
  assert.equal(entry.record.contentType, DOCX_MIME); assert.match(entry.doc.filename, /\.docx$/); assert.equal(entry.record.source, 'local-file');
  assert.match(app.get('document-import-status').textContent, /DOCX imported/);
  assert.match(app.get('results').children[0].children[2].children[0].textContent, /^Imported DOCX/);
  assert.deepEqual(new Uint8Array(await (await storage.readOriginal('docx-import', entry.doc.filename)).arrayBuffer()), original);
  const reopened = await workspace('docx-import'); await reopened.get('results').children[0].children[2].children[1].handlers.click();
  assert.equal(reopened.get('preview-text').value, 'Recovered DOCX text'); await reopened.click('export');
  const zip = await reopened.archive().text(); assert.ok(zip.includes(entry.doc.filename)); assert.ok(zip.includes('Recovered DOCX text'));
});
test('failed extensionless downloads keep MIME evidence for format-specific recovery', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('mime', { fetch: async () => { throw Object.assign(new Error('HTTP 403'), { contentType: DOCX_MIME, finalURL: 'https://example.org/resource?id=1' }); } });
  await app.input('urls', 'https://example.org/resource?id=1'); await app.click('start');
  const entry = (await storage.loadWorkspace('mime')).entries[0]; assert.equal(entry.record.contentType, DOCX_MIME);
  assert.equal(app.get('results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').textContent, 'Choose downloaded DOCX');
});

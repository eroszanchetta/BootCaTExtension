import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { captureTabDocument, readPDFFile, fileWarnings, PDF_REVIEW_NOTICE } from '../src/pdf-recovery.js';
import { validateSavedPages, savePage, readSavedPages } from '../src/page-store.js';
import * as storage from '../src/project-store.js';
import { workspace, waitFor, extracted } from './helpers/workspace.js';
import { FILE_LIMIT, PDF_IMPORT_LIMIT, fetchFile } from '../src/core.js';

const pdf = new TextEncoder().encode('%PDF-1.4\nPDF fixture bytes');
const blocked = { executeScript: async () => { throw new Error('Cannot access PDF viewer'); } };
test('PDF tab recovery uses session cookies, accepts extensionless URLs and never saves viewer HTML', async () => {
  const original = globalThis.fetch;
  let requests = 0, injections = 0;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/example.org\//);
    assert.equal(options.credentials, 'include'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal instanceof AbortSignal); requests++;
    return new Response(pdf, { headers: { 'content-type': 'application/octet-stream' } });
  };
  try {
    for (const [url, scripting] of [
      ['https://example.org/paper.pdf#page=2', { executeScript: () => { injections++; throw new Error('Should not inject'); } }],
      ['https://example.org/download?id=42', blocked],
      ['https://example.org/document', { executeScript: async () => [{ result: { pdf: true, url: 'https://example.org/document' } }] }]
    ]) {
      const page = await captureTabDocument({ id: 1, url }, scripting);
      assert.equal(page.kind, 'pdf'); assert.equal(page.source, 'browser-session');
      assert.equal(page.url, url.split('#')[0]); assert.equal(page.html, undefined);
      assert.deepEqual(new Uint8Array(await page.blob.arrayBuffer()), pdf);
    }
    assert.equal(requests, 3); assert.equal(injections, 0);
    const page = { url: 'https://example.org/article', html: '<p>Rendered page</p>' };
    assert.equal(await captureTabDocument({ id: 1, url: page.url }, { executeScript: async () => [{ result: page }] }), page);
    assert.equal(requests, 3, 'HTML snapshots must not be re-fetched');
    for (const url of ['chrome://extensions', 'file:///document.pdf', 'https://user:secret@example.org/document.pdf']) {
      await assert.rejects(captureTabDocument({ id: 1, url }, blocked), /HTTP or HTTPS/);
    }
    assert.equal(requests, 3);
  } finally { globalThis.fetch = original; }
});

test('session retry rejects HTTP errors, challenge HTML even with PDF MIME, and oversized streams; batch fetch still omits cookies', async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      () => new Response('CAPTCHA', { status: 403 }),
      () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'application/pdf' } }),
      () => new Response(new Uint8Array(FILE_LIMIT + 1))
    ]) {
      globalThis.fetch = async () => response();
      await assert.rejects(captureTabDocument({ id: 1, url: 'https://example.org/p.pdf' }, blocked), /Import downloaded file/);
    }
    globalThis.fetch = async (url, options) => { assert.equal(options.credentials, 'omit'); return new Response(pdf); };
    await fetchFile('https://example.org/p.pdf', new AbortController().signal);
  } finally { globalThis.fetch = original; }
});

test('local PDF input is bounded and mixed inbox size counts PDF Blob bytes', async () => {
  assert.deepEqual(await readPDFFile(new Blob([pdf])), pdf);
  await assert.rejects(readPDFFile(new Blob(['<html>Challenge</html>'])), /does not contain a PDF/);
  await assert.rejects(readPDFFile(new Blob([])), /non-empty/);
  await assert.rejects(readPDFFile({ size: PDF_IMPORT_LIMIT + 1, arrayBuffer() { assert.fail('must reject before reading'); } }), /50 MiB/);
  await assert.rejects(readPDFFile({ size: FILE_LIMIT + 1, arrayBuffer() { assert.fail('must reject before reading'); } }, FILE_LIMIT), /50 MiB/);
  validateSavedPages([{ kind: 'pdf', blob: { size: FILE_LIMIT } }, { html: 'HTML' }]);
  assert.throws(() => validateSavedPages([
    { kind: 'pdf', blob: { size: FILE_LIMIT } },
    { kind: 'pdf', blob: { size: FILE_LIMIT } }, { html: 'x' }
  ]), /100 MiB/);
});

test('queued PDF automatically replaces its failed URL, commits before acknowledgement and persists exact original bytes', async () => {
  globalThis.indexedDB = new IDBFactory();
  const url = 'https://example.org/download?id=42';
  const app = await workspace('pdf', { fetch: async () => { throw new Error('HTTP 403'); }, extractor: async (bytes, type) => {
    assert.equal(type, 'application/pdf'); assert.deepEqual(bytes, pdf); return { ...extracted('Recovered PDF corpus'), format: 'pdf' };
  } });
  await app.input('urls', url); await app.click('start');
  assert.equal(app.state().entries[0].doc, null);
  await savePage({ url, finalURL: 'https://example.org/final.pdf', kind: 'pdf', source: 'browser-session', blob: new Blob([pdf]), id: 'pdf-capture', capturedAt: '2026-11-11' });
  await app.notify({ captureRevision: { newValue: 'pdf' } });
  await waitFor(async () => (await readSavedPages()).length === 0);
  const saved = (await storage.loadWorkspace('pdf')).entries;
  assert.equal(saved.length, 1); assert.equal(saved[0].url, url);
  assert.equal(saved[0].record.source, 'browser-session'); assert.equal(saved[0].doc.captureId, 'pdf-capture');
  assert.equal(saved[0].record.previousAttempt.error, 'HTTP 403');
  assert.match(saved[0].doc.filename, /\.pdf$/);
  assert.deepEqual(new Uint8Array(await (await storage.readOriginal('pdf', saved[0].doc.filename)).arrayBuffer()), pdf);
  const reopened = await workspace('pdf');
  assert.equal(reopened.get('preview-text').value, '');
  await reopened.get('results').children[0].children[2].children[1].handlers.click();
  assert.equal(reopened.get('preview-text').value, 'Recovered PDF corpus');
  await reopened.click('export');
  assert.ok((await reopened.archive().text()).includes('%PDF-1.4'));
});

test('local PDF chooser keeps failures intact on invalid input and replaces only the selected URL on success', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('local', { fetch: async () => { throw new Error('HTTP 403'); } });
  await app.input('urls', 'https://example.org/one.pdf\nhttps://example.org/two.pdf'); await app.click('start');
  const button = app.get('problem-results').children[1].children[1].children.find(item => item.className === 'secondary import-document-button');
  const input = app.get('import-document-picker');
  button.handlers.click();
  const row = app.get('problem-results').children[1];
  await app.focus();
  assert.equal(app.get('problem-results').children[1], row, 'returning from the chooser must not rebuild its target row');
  input.files = [new Blob(['Not PDF'])]; await input.handlers.change();
  assert.equal((await storage.loadWorkspace('local')).entries.filter(entry => entry.doc).length, 0);
  assert.match(app.get('document-import-status').textContent, /Unsupported file contents/);
  assert.equal(app.get('status').textContent, 'Finished.', 'a file-picker error must not overwrite the batch outcome');
  assert.match(app.get('document-import-status').textContent, /File not imported/);
  await app.focus();
  assert.match(app.get('problem-results').children[1].children[1].children.find(item => item.className === 'hint document-import-feedback').textContent, /File not imported/);
  app.get('problem-results').children[1].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  input.files = [new Blob([pdf])]; await input.handlers.change();
  const entries = (await storage.loadWorkspace('local')).entries;
  assert.equal(entries.length, 2); assert.equal(entries.find(entry => entry.url.endsWith('/one.pdf')).doc, null);
  const imported = entries.find(entry => entry.url.endsWith('/two.pdf'));
  assert.equal(imported.record.source, 'local-file'); assert.match(imported.doc.filename, /\.pdf$/);
  await app.click('start');
  assert.deepEqual(app.fetched, ['https://example.org/one.pdf', 'https://example.org/two.pdf', 'https://example.org/one.pdf']);
});

test('manually selected PDF above 10 MiB imports and exports exact original', async () => {
  globalThis.indexedDB = new IDBFactory();
  const bytes = new Uint8Array(15690948); bytes.set(pdf);
  const app = await workspace('large', { fetch: async () => { throw new Error('HTTP 403'); }, extractor: async (data, type, options) => {
    assert.equal(data.length, bytes.length);
    return { ...extracted('Large PDF text'), format: 'pdf' };
  } });
  await app.input('urls', 'https://example.org/L15.pdf'); await app.click('start');
  app.get('problem-results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  app.get('import-document-picker').files = [new Blob([bytes])]; await app.get('import-document-picker').handlers.change();
  const entry = (await storage.loadWorkspace('large')).entries[0];
  assert.equal(entry.record.bytes, 15690948); assert.equal(entry.doc.extraction.status, 'ok');
  assert.match(app.get('document-import-status').textContent, /Download recovered/);
  assert.deepEqual(new Uint8Array(await (await storage.readOriginal('large', entry.doc.filename)).arrayBuffer()), bytes);
  await app.click('export'); assert.ok(app.archive().size > bytes.length);
});

test('successful downloads with failed PDF or HTML extraction do not offer PDF recovery', async () => {
  for (const format of ['pdf', 'html']) {
    globalThis.indexedDB = new IDBFactory();
    const app = await workspace('failed-extraction', { extractor: async () => ({ ...extracted(''), status: 'failed', included: false, format, warnings: ['No text'] }) });
    await app.input('urls', `https://example.org/document.${format}`); await app.click('start');
    const entry = app.state().entries[0]; assert.ok(entry.doc);
    assert.ok(await storage.readOriginal('failed-extraction', entry.doc.filename));
    assert.equal(app.get('problem-results').children[0].children[1].children.some(item => item.className === 'secondary import-document-button'), false);
  }
});

test('cancelling the native PDF chooser allows focus refresh and a subsequent selection', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('cancel', { fetch: async () => { throw new Error('HTTP 403'); } });
  await app.input('urls', 'https://example.org/failed.pdf'); await app.click('start');
  app.get('problem-results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  app.get('import-document-picker').handlers.cancel();
  await app.focus();
  assert.match(app.get('document-import-status').textContent, /selection cancelled/);
  app.get('problem-results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  app.get('import-document-picker').files = [new Blob([pdf])]; await app.get('import-document-picker').handlers.change();
  assert.ok(app.state().entries[0].doc);
});

test('old generic PDF notices are hidden without losing specific warnings', () => {
  assert.deepEqual(fileWarnings({ warnings: [PDF_REVIEW_NOTICE, '1 page(s) contain no extractable text; scans may require OCR.'] }), ['1 page(s) contain no extractable text; scans may require OCR.']);
});

 test('PDF review details retain layout and OCR advice without repeating it in every row', () => {
  const extraction = { warnings: [PDF_REVIEW_NOTICE, 'Specific warning'] };
  assert.deepEqual(fileWarnings(extraction), ['Specific warning']);
  assert.deepEqual(fileWarnings(extraction, { details: true }), ['Check PDF text layout before use. OCR is not performed.', 'Specific warning']);
 });


test('a saved import with failed extraction remains an issue and reports the actual reason', async () => {
  globalThis.indexedDB = new IDBFactory();
  const feedback = [];
  const app = await workspace('import-still-failed', { fetch: async () => { throw new Error('HTTP 403'); },
    onRecoveryFeedback: value => feedback.push(value), extractor: async () => ({ status: 'failed', text: '', characters: 0, included: false, warnings: ['No extractable text found.'], format: 'pdf' }) });
  await app.input('urls', 'https://example.org/scan.pdf'); await app.click('start');
  app.get('problem-results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  app.get('import-document-picker').files = [new Blob([pdf])]; await app.get('import-document-picker').handlers.change();
  assert.equal(app.get('results').children.length, 0);
  assert.equal(app.get('problem-results').children.length, 1);
  assert.match(app.get('document-import-status').textContent, /text still unavailable/);
  assert.match(app.get('problem-results').children[0].children[2].children.find(item => item.className === 'hint').textContent, /No extractable text/);
  assert.equal(feedback.at(-1).tone, 'warning');
  const entry = (await storage.loadWorkspace('import-still-failed')).entries[0];
  assert.deepEqual(new Uint8Array(await (await storage.readOriginal('import-still-failed', entry.doc.filename)).arrayBuffer()), pdf);
});

test('a successful import keeps its message on the moved corpus row', async () => {
  globalThis.indexedDB = new IDBFactory();
  const feedback = [];
  const app = await workspace('import-success-message', { fetch: async () => { throw new Error('HTTP 403'); }, onRecoveryFeedback: value => feedback.push(value) });
  await app.input('urls', 'https://example.org/recovered.pdf'); await app.click('start');
  app.get('problem-results').children[0].children[1].children.find(item => item.className === 'secondary import-document-button').handlers.click();
  app.get('import-document-picker').files = [new Blob([pdf])]; await app.get('import-document-picker').handlers.change();
  assert.equal(app.get('problem-results').children.length, 0);
  const message = app.get('results').children[0].children[1].children.find(item => item.className === 'hint document-import-feedback');
  assert.match(message.textContent, /Download recovered/);
  assert.equal(message.attributes['data-state'], 'success'); assert.equal(feedback.at(-1).tone, 'success');
  await app.focus();
  assert.match(app.get('results').children[0].children[1].children.find(item => item.className === 'hint document-import-feedback').textContent, /Download recovered/);
});


test('dropped recovery files use the same durable import path and affect only their target URL', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('drop-target', { fetch: async () => { throw new Error('HTTP 403'); } });
  await app.input('urls', 'https://example.org/one.pdf\nhttps://example.org/two.pdf'); await app.click('start');
  const button = app.get('problem-results').children[1].children[1].children.find(item => item.className === 'secondary import-document-button');
  const drop = files => ({ dataTransfer: { types: ['Files'], files }, preventDefault() {}, stopPropagation() {} });
  await button.handlers.drop(drop([new Blob([pdf]), new Blob([pdf])]));
  assert.equal((await storage.loadWorkspace('drop-target')).entries.filter(entry => entry.doc).length, 0);
  assert.match(app.get('document-import-status').textContent, /one file/);
  await button.handlers.drop(drop([new Blob(['not a document'])]));
  assert.equal((await storage.loadWorkspace('drop-target')).entries.filter(entry => entry.doc).length, 0);
  assert.match(app.get('document-import-status').textContent, /Unsupported file contents/);
  await button.handlers.drop(drop([new Blob([pdf])]));
  const entries = (await storage.loadWorkspace('drop-target')).entries;
  assert.equal(entries[0].doc, null); assert.equal(entries[1].record.source, 'local-file');
  assert.equal(app.get('document-import-status').textContent, 'Download recovered');
  assert.deepEqual(new Uint8Array(await (await storage.readOriginal('drop-target', entries[1].doc.filename)).arrayBuffer()), pdf);
  // A stale button retained during a row rebuild cannot overwrite the recovered file.
  await button.handlers.drop(drop([new Blob([pdf])]));
  assert.equal((await storage.loadWorkspace('drop-target')).entries[1].doc.filename, entries[1].doc.filename);
});

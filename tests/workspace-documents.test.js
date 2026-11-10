import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDownloadedDocument, extractionContentType } from '../src/binary-extraction.js';
import { parseURLs, filenameFor, FILE_LIMIT, BATCH_LIMIT } from '../src/core.js';
import { makeZIP } from '../src/zip.js';
import { corpusFiles, extractionMetadata } from '../src/corpus.js';
import { pdfFixture } from './browser-tests.fixtures.js';
class Element {
  constructor() { this.value = ''; this.children = []; this.handlers = {}; }
  querySelector() { return new Element(); }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  setAttribute() {}
  append(...items) { this.children.push(...items); }
  replaceChildren() { this.children = []; }
  click() {}
  remove() {}
}
test('workspace awaits binary extraction, leaves preview blank and exports original PDF plus corpus metadata', async () => {
  const elements = new Map(), get = id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
  get('urls').value = 'https://example.org/download'; get('extractor').value = 'defuddle';
  const bytes = pdfFixture(); let archive;
  const context = vm.createContext({
    URL: { createObjectURL: blob => { archive = blob; return 'blob:test'; }, revokeObjectURL() {} }, Date, console, TextEncoder, AbortController,
    setTimeout: (fn, delay) => { if (delay < 1000) queueMicrotask(fn); return 0; }, clearTimeout() {},
    document: { getElementById: get, createElement: () => new Element(), createElementNS: () => new Element(), createTextNode: text => ({ textContent: text }), body: new Element() },
    window: { addEventListener() {}, confirm: () => true },
    getExtensionAPI: () => ({ storage: { onChanged: { addListener() {} } } }),
    initSearchUI: () => ({ flush() {} }), initProjectUI: () => ({ ready: Promise.resolve(), snapshot: () => ({ name: 'PDF test' }) }), projectFilename: name => name,
    readCollections: async () => [], readSavedPages: async () => [], DEFUDDLE_AVAILABLE: true,
    parseURLs, filenameFor, FILE_LIMIT, BATCH_LIMIT, extractionContentType,
    fetchFile: async () => ({ bytes, finalURL: 'https://example.org/download', status: 200, contentType: 'application/octet-stream' }),
    extractDownloadedDocument: (bytes, type, options) => extractDownloadedDocument(bytes, type, { ...options, loadPDF: async () => pdfjs }),
    makeZIP, corpusFiles, extractionMetadata
  });
  const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  await get('start').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  const state = JSON.parse(vm.runInContext('JSON.stringify({ records, documents, files: files.map(file => ({ name: file.name, bytes: file.data.length })) })', context));
  assert.equal(state.documents[0].extraction.status, 'ok');
  assert.equal(state.documents[0].extraction.extractor, 'pdfjs', 'HTML extractor selection must not affect PDFs');
  assert.ok(state.files[0].name.endsWith('.pdf')); assert.equal(state.files[0].bytes, bytes.length);
  assert.equal(get('preview-text').value, '');
  get('export').handlers.click();
  const zip = new Uint8Array(await archive.arrayBuffer());
  const text = new TextDecoder().decode(zip);
  assert.ok(text.includes('Renewable energy corpus.')); assert.ok(text.includes('project.json')); assert.ok(text.includes('pdfjs'));
  assert.ok(text.includes('%PDF-1.4'), 'ZIP must retain the binary original');
});

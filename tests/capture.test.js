import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateSavedPages } from '../src/page-store.js';
import { captureCurrentPage } from '../src/page-capture.js';
import { parseURLs, filenameFor, BATCH_LIMIT } from '../src/core.js';
import { corpusFiles, extractionMetadata } from '../src/corpus.js';

test('snapshot queue bounds use UTF-8 bytes and number of pages', () => {
  validateSavedPages([{ html: 'caffè 中文' }]);
  assert.throws(() => validateSavedPages(Array.from({ length: 21 }, () => ({ html: '' }))), /20/);
  assert.throws(() => validateSavedPages([{ html: '中'.repeat(7 * 1024 * 1024) }]), /20 MiB/);
});

test('injected capture rejects restricted pages and PDF viewers without module closure', () => {
  for (const [protocol, contentType] of [['chrome:', 'text/html'], ['https:', 'application/pdf']]) {
    const result = vm.runInNewContext(`(${captureCurrentPage.toString()})()`, { location: { protocol }, document: { contentType } });
    assert.match(result.error, /HTML page/);
  }
});

class Element {
  constructor() { this.children = []; this.disabled = false; this.value = ''; this.textContent = ''; this.handlers = {}; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  querySelector() { return new Element(); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren() { this.children = []; }
  replaceWith(other) { const i = this.parent.children.indexOf(this); this.parent.children[i] = other; other.parent = this.parent; }
  setAttribute() {}
}

test('workspace recovers a failed URL without fetching again, replaces repeated captures, and retains provenance', async () => {
  const elements = new Map();
  const get = id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
  get('urls').value = 'https://example.org/blocked'; get('extractor').value = 'readability';
  let pages = [], fetches = 0, extractionChoices = [];
  const context = vm.createContext({
    console, URL, TextEncoder, AbortController, Date, setTimeout: (fn, delay) => { if (delay < 1000) queueMicrotask(fn); return 0; }, clearTimeout() {},
    document: { getElementById: get, createElement: () => new Element(), createTextNode: text => Object.assign(new Element(), { textContent: text }) },
    window: { addEventListener() {}, confirm: () => true },
    getExtensionAPI: () => ({ storage: { onChanged: { addListener() {} } } }),
    parseURLs, filenameFor, BATCH_LIMIT, FILE_LIMIT: 10 * 1024 * 1024,
    fetchFile: async () => { fetches++; throw new Error('HTTP 403 Forbidden'); },
    initSearchUI() {}, readCollections: async () => [], DEFUDDLE_AVAILABLE: true,
    readSavedPages: async () => pages, clearSavedPages: async () => {},
    extractDocument: (bytes, type, options) => {
      extractionChoices.push(options.extractor);
      return { status: 'ok', included: true, characters: bytes.length, text: 'Recovered corpus text', title: 'Recovered page', warnings: [], extractor: options.extractor };
    }, corpusFiles, extractionMetadata
  });
  const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  await get('start').handlers.click();
  assert.equal(fetches, 1);
  assert.equal(get('results').children.length, 1);
  const link = get('results').children[0].children[1].children[0];
  assert.equal(link.href, 'https://example.org/blocked'); assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  pages = [{ id: 'one', url: 'https://example.org/blocked', html: '<article>Recovered</article>', capturedAt: '2026-11-10T12:00:00Z' }];
  get('extractor').value = 'defuddle';
  await get('add-saved').handlers.click();
  await get('add-saved').handlers.click();
  assert.equal(extractionChoices.length, 1, 'same snapshot should import once');
  pages = [{ ...pages[0], id: 'two' }];
  await get('add-saved').handlers.click();
  assert.equal(fetches, 1, 'import must not request the URL again');
  assert.deepEqual(extractionChoices, ['defuddle', 'defuddle']);
  assert.equal(get('results').children.length, 1);
  const result = JSON.parse(vm.runInContext('JSON.stringify({ records, documents, text: corpusFiles(documents), metadata: extractionMetadata(documents), files: files.map(file => file.name) })', context));
  assert.equal(result.records.length, 1); assert.equal(result.documents.length, 1); assert.equal(result.text.length, 1);
  assert.equal(result.records[0].previousAttempt.previousAttempt.error, 'HTTP 403 Forbidden');
  assert.equal(result.metadata[0].source, 'browser-tab'); assert.equal(result.metadata[0].captureId, 'two');
  assert.equal(result.metadata[0].capturedAt, pages[0].capturedAt);
  assert.equal(new Set(result.files).size, 2, 'new captures retain uniquely named originals');
  assert.equal(get('export').disabled, false);
});

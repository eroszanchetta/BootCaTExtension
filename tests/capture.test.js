import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateSavedPages } from '../src/page-store.js';
import { captureCurrentPage } from '../src/page-capture.js';
import { corpusFiles, extractionMetadata } from '../src/corpus.js';

test('snapshot queue bounds use UTF-8 bytes and number of pages', () => {
  validateSavedPages([{ html: 'caffè 中文' }]);
  assert.throws(() => validateSavedPages(Array.from({ length: 21 }, () => ({ html: '' }))), /20/);
  // Mixed inbox totals count UTF-8 HTML bytes and PDF Blob sizes.
  assert.throws(() => validateSavedPages([{ kind: 'pdf', blob: { size: 100 * 1024 * 1024 - 2 } }, { html: '中' }]), /100 MiB/);
});

test('injected capture rejects restricted pages without module closure', () => {
  for (const [protocol, contentType] of [['chrome:', 'text/html']]) {
    const result = vm.runInNewContext(`(${captureCurrentPage.toString()})()`, { location: { protocol }, document: { contentType } });
    assert.match(result.error, /HTML page/);
  }
});

test('injected capture identifies a PDF without capturing viewer HTML', () => {
  const result = vm.runInNewContext(`(${captureCurrentPage.toString()})()`, { location: { protocol: 'https:', href: 'https://example.org/pdf' }, document: { contentType: 'application/pdf' } });
  assert.equal(result.pdf, true); assert.equal(result.url, 'https://example.org/pdf'); assert.equal(result.html, undefined);
});

class Element {
  constructor() { this.children = []; this.disabled = false; this.value = ''; this.textContent = ''; this.handlers = {}; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  querySelector() { return new Element(); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren() { this.children = []; }
  replaceWith(other) { const i = this.parent.children.indexOf(this); this.parent.children[i] = other; other.parent = this.parent; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
  setAttribute() {}
}

for (const success of [true, false]) test(`popup ${success ? 'keeps save disabled and confirms success' : 'allows retry after a failed save'}`, async () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) {
      const element = new Element();
      const classes = new Set();
      element.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    initVersionBadge: () => '2.0.0',
    document: { getElementById: get }, window: { close() {} },
    adapterForURL: () => null,
    getExtensionAPI: () => ({
      storage: { onChanged: { addListener() {} } },
      tabs: { query: async () => [{ id: 9, url: 'https://example.org/article' }] },
      runtime: { sendMessage: async message => { if (message.type === 'get-project') return { ok: true, project: { id: 'p', name: 'Test corpus', nameConfirmed: true } }; if (message.type === 'get-page-corpus-state') return { ok: true, saved: false, projectId: 'p' }; assert.equal(message.type, 'save-page'); assert.equal(message.tabId, 9); return success ? { ok: true } : { ok: false, error: 'Could not read page' }; } }
    })
  });
  const source = (await readFile(new URL('../src/popup.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  await vm.runInContext(`(async () => { ${source} })()`, context);
  const button = get('save-page');
  assert.equal(button.disabled, false);
  await button.handlers.click({ currentTarget: button });
  assert.equal(button.disabled, success);
  assert.equal(get('page-feedback').textContent, success ? 'Page already added to corpus' : 'Could not read page');
  assert.equal(get('page-feedback').classList.contains('saved'), success);
});

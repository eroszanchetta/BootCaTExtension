import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as storage from '../../src/project-store.js';
import * as pages from '../../src/page-store.js';
import { parseURLs, filenameFor, FILE_LIMIT, urlListWarning } from '../../src/core.js';
import { makeStoredZIP } from '../../src/zip-blob.js';
import { extractionMetadata } from '../../src/corpus.js';
import { fileWarnings, readPDFFile } from '../../src/pdf-recovery.js';
import { formatByMIME, readImportedDocument } from '../../src/document-formats.js';
class Element {
  constructor() { this.value = ''; this.textContent = ''; this.children = []; this.handlers = {}; this.disabled = false; this.attributes = {}; this.classList = { toggle: (name, enabled) => { const classes = new Set((this.className || '').split(/\s+/).filter(Boolean)); if (enabled) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); }, contains: name => (this.className || '').split(/\s+/).includes(name) }; }
  querySelector() { return new Element(); }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
  get parentNode() { return this.parent; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren() { this.children = []; }
  replaceWith(node) { const index = this.parent.children.indexOf(this); this.parent.children[index] = node; node.parent = this.parent; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  click() {}
}
export async function waitFor(predicate) {
  for (let i = 0; i < 500; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw new Error('Workspace did not reach expected state');
}
export const extracted = text => ({ status: 'ok', included: true, text, characters: Array.from(text).length, warnings: [], title: 'Test page', extractor: 'test' });
export async function workspace(projectId, options = {}) {
  const elements = new Map(), listeners = [], windowListeners = {};
  const get = id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
  let archive, confirm = true, reset, fetched = [];
  const context = vm.createContext({
    console, navigator: options.navigator || {}, Blob, URL: { createObjectURL: value => { archive = value; return 'blob:test'; }, revokeObjectURL() {} },
    AbortController, TextEncoder, Date, queueMicrotask,
    setTimeout: (fn, delay) => { if (delay < 1000) { queueMicrotask(fn); return 0; } return setTimeout(fn, delay); }, clearTimeout,
    document: { getElementById: get, createElement: () => new Element(), createElementNS: () => new Element(), createTextNode: text => ({ textContent: text }), body: new Element() },
    window: { confirm: () => confirm, location: { reload() {} }, addEventListener(type, fn) { windowListeners[type] = fn; } },
    getExtensionAPI: () => ({ storage: { onChanged: { addListener(fn) { listeners.push(fn); } } } }),
    initProjectUI: callbacks => { reset = callbacks.onReset; return { ready: Promise.resolve(), snapshot: () => ({ id: projectId, name: 'Test corpus' }) }; },
    initSearchUI: () => ({ flush() {} }), readCollections: async () => [], projectFilename: name => name,
    initWorkspaceSections() {}, openWorkspaceSection() {},
    initSeedsUI: () => ({ restore() {}, isBusy: () => false, destroy() {} }),
    initProjectTabsUI: () => ({ refresh() {}, destroy() {} }),
    DEFUDDLE_AVAILABLE: true, storage: options.storage || storage, ...pages, parseURLs, filenameFor, FILE_LIMIT, urlListWarning, makeStoredZIP, extractionMetadata, fileWarnings, readPDFFile, formatByMIME, readImportedDocument,
    extractionContentType: (bytes, type) => type,
    extractDownloadedDocument: options.extractor || (async () => extracted('Downloaded corpus text')),
    extractDocument: () => extracted('Captured corpus text'),
    fetchFile: async (url, signal, limit) => {
      fetched.push(url);
      if (options.fetch) return options.fetch(url, signal, limit);
      return { bytes: new TextEncoder().encode('source'), contentType: 'text/html', finalURL: url, status: 200 };
    }
  });
  const source = (await readFile(new URL('../../src/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  await waitFor(() => vm.runInContext('ready', context));
  await waitFor(() => !vm.runInContext('running', context));
  return {
    get, fetched, reset: () => reset(), setConfirm: value => { confirm = value; }, archive: () => archive,
    state: () => vm.runInContext('({ entries, ready, running, pendingWrites, state })', context),
    async input(id, value) { get(id).value = value; await get(id).handlers.input?.(); await waitFor(() => !vm.runInContext('pendingWrites', context)); },
    click: id => get(id).handlers.click(),
    async focus() { await windowListeners.focus(); },
    async notify(changes) { for (const listener of listeners) listener(changes, 'local'); await waitFor(() => !vm.runInContext('running', context)); },
    beforeUnload: () => { let prevented = false; windowListeners.beforeunload({ preventDefault() { prevented = true; } }); return prevented; }
  };
}

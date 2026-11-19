import { createProjectWork, createExtractionQueue } from '../../src/project-work.js';
import { initTextReview } from '../../src/text-review.js';
import { corpusFingerprint, corpusSavedMessage } from '../../src/export-state.js';
import { checkLanguage, hasLanguageWarning, languageMessage } from '../../src/language-detection.js';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as storage from '../../src/project-store.js';
import * as pages from '../../src/page-store.js';
import { parseURLs, filenameFor, FILE_LIMIT, urlListWarning } from '../../src/core.js';
import { makeStoredZIP } from '../../src/zip-blob.js';
import { makeMetadataWorkbook } from '../../src/metadata-xlsx.js';
import { createExportLayout, originalTextFilename } from '../../src/export-layout.js';
import { extractionMetadata } from '../../src/corpus.js';
import { fileWarnings, readPDFFile } from '../../src/pdf-recovery.js';
import { formatByMIME, readImportedDocument } from '../../src/document-formats.js';
class Element {
  constructor() { this.value = ''; this.textContent = ''; this.children = []; this.handlers = {}; this.disabled = false; this.attributes = {}; this.classList = { toggle: (name, enabled) => { const classes = new Set((this.className || '').split(/\s+/).filter(Boolean)); if (enabled) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); }, contains: name => (this.className || '').split(/\s+/).includes(name) }; }
  showModal() { this.open = true; }
  close() { this.open = false; this.handlers.close?.(); }
  focus() {}
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
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
  let archive, lastFilename, downloads = 0, confirm = true, reset, fetched = [], language = options.language || 'none';
  const context = vm.createContext({
    console, navigator: options.navigator || {}, Blob, URL: { createObjectURL: value => { archive = value; downloads++; return 'blob:test'; }, revokeObjectURL() {} },
    AbortController, TextEncoder, Date, queueMicrotask, corpusFingerprint, corpusSavedMessage, initTextReview, createProjectWork, createExtractionQueue,
    setTimeout: (fn, delay) => { if (delay < 1000) { queueMicrotask(fn); return 0; } return setTimeout(fn, delay); }, clearTimeout,
    document: { getElementById: get, createElement: tag => { const node = new Element(); if (tag === 'a') node.click = () => { lastFilename = node.download; }; return node; }, createElementNS: () => new Element(), createTextNode: text => ({ textContent: text }), body: new Element() },
    confirmAction: async () => confirm,
    window: { location: { reload() {} }, addEventListener(type, fn) { windowListeners[type] = fn; } },
    getExtensionAPI: () => ({ storage: { onChanged: { addListener(fn) { listeners.push(fn); } } } }),
    initProjectUI: callbacks => { reset = callbacks.onReset; return { ready: Promise.resolve(), snapshot: () => projectId ? { id: projectId, name: 'Test corpus', language } : null, setLanguage: async value => { language = value; } }; },
    checkLanguage, hasLanguageWarning, languageMessage,
    initSearchUI: () => ({ flush() {}, destroy() {} }), readCollections: async () => [], projectFilename: name => name,
    initVersionBadge: () => '2.0.0',
    initWorkspaceSections() {}, openWorkspaceSection() {}, setProjectSectionState() {},
    initSeedsUI: () => ({ restore() {}, isBusy: () => false, destroy() {} }),
    initProjectTabsUI: () => ({ refresh() {}, destroy() {} }),
    DEFUDDLE_AVAILABLE: true, storage: options.storage || storage, ...pages, parseURLs, filenameFor, FILE_LIMIT, urlListWarning, makeStoredZIP, makeMetadataWorkbook: options.makeMetadataWorkbook || makeMetadataWorkbook, createExportLayout, originalTextFilename, extractionMetadata, fileWarnings, readPDFFile, formatByMIME, readImportedDocument,
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
  // The final expression is the workspace startup promise. Await the complete
  // metadata/activity check and capture drain before simulating user actions.
  await vm.runInContext(source, context);
  await waitFor(() => vm.runInContext(projectId ? 'ready' : "document.getElementById('status').textContent.startsWith('No active project')", context));
  await waitFor(() => !vm.runInContext('running || importing || documentJobs.size', context));
  return {
    get, fetched, reset: () => reset(), setConfirm: value => { confirm = value; }, archive: () => archive, downloads: () => downloads, filename: () => lastFilename,
    state: () => vm.runInContext('({ entries, ready, running, downloading, importing, jobs: documentJobs.size, pendingWrites, state })', context),
    async input(id, value) { get(id).value = value; await get(id).handlers.input?.(); await waitFor(() => !vm.runInContext('pendingWrites', context)); },
    click: id => get(id).handlers.click(),
    async focus() { await windowListeners.focus(); },
    async notify(changes) { for (const listener of listeners) listener(changes, 'local'); await waitFor(() => !vm.runInContext('running || importing', context)); },
    beforeUnload: () => { let prevented = false; windowListeners.beforeunload({ preventDefault() { prevented = true; } }); return prevented; }
  };
}

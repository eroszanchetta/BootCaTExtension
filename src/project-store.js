import { DEFAULT_EXCLUDED_SITES } from './search-filters.js';
import { hasLanguageWarning } from './language-detection.js';
import { transaction, STORES } from './storage-db.js';
import { parseURLs } from './core.js';
const initialDraft = (defaults = {}) => ({ key: 'draft', urls: '', query: '', engine: '', extractor: 'readability', seenCollections: [], seeds: '', tupleLength: '3', tupleCount: '10', tuples: '', preparedQueries: [], preparedQueryBases: null, preparedFilters: null, searchFileType: '', excludedSites: (defaults.excludedSites ?? DEFAULT_EXCLUDED_SITES).join('\n') });
const initialBatch = () => ({ key: 'batch', startedAt: null, state: 'idle', processed: 0, total: 0, nextFileIndex: 0, storedBytes: 0, lastStatus: 'Ready when you are.' });
function seed(tx, projectId, defaults) {
  const store = tx.objectStore('meta');
  store.put({ key: 'active', projectId }); store.put(initialDraft(defaults)); store.put(initialBatch()); store.put({ key: 'searches', collections: [] });
}
export function ensureStoredProject(projectId, defaults) {
  if (!projectId) throw new Error('Project identity is missing. Reopen BootCaT.');
  return transaction(['meta'], 'readwrite', (tx, done, fail) => {
    const request = tx.objectStore('meta').get('active');
    request.onsuccess = () => {
      if (!request.result) seed(tx, projectId, defaults);
      else if (request.result.projectId !== projectId) fail(new Error('The project changed. Reopen BootCaT.'));
    };
  });
}
export function resetStoredProject(projectId, defaults) {
  return transaction(STORES, 'readwrite', tx => {
    for (const name of STORES) tx.objectStore(name).clear();
    seed(tx, projectId, defaults);
  });
}
function projectTransaction(projectId, names, mode, operation) {
  return transaction([...new Set(['meta', ...names])], mode, (tx, done, fail) => {
    const request = tx.objectStore('meta').get('active');
    request.onsuccess = () => {
      if (request.result?.projectId !== projectId) { fail(new Error('The project changed. Reopen BootCaT.')); return; }
      try { operation(tx, done, fail); } catch (error) { fail(error); }
    };
  });
}
export function loadWorkspace(projectId) {
  return projectTransaction(projectId, ['documents'], 'readonly', (tx, done) => {
    const results = {};
    for (const key of ['draft', 'batch', 'searches']) {
      const request = tx.objectStore('meta').get(key);
      request.onsuccess = () => { results[key] = request.result; };
    }
    const docs = tx.objectStore('documents').getAll();
    docs.onsuccess = () => { results.entries = docs.result; };
    done(results);
  });
}
// Inspect only document metadata and pending capture keys, never original/text Blobs.
// One transaction covers inbox-to-corpus handoff without a temporary false negative.
export function hasStoredPage(projectId, url) {
  const canonical = value => { try { const parsed = new URL(value); if (!/^https?:$/.test(parsed.protocol)) return null; parsed.hash = ''; return parsed.href; } catch { return null; } };
  const target = canonical(url);
  return projectTransaction(projectId, ['documents', 'pages'], 'readonly', (tx, done) => {
    if (!target) { done(false); return; }
    let found = false, remaining = 2;
    const finish = () => { if (!--remaining) done(found); };
    const documents = tx.objectStore('documents').openCursor();
    documents.onsuccess = () => {
      const cursor = documents.result;
      if (!cursor || found) { finish(); return; }
      const entry = cursor.value;
      if (entry.doc && ['downloaded', 'captured'].includes(entry.record.outcome) && !entry.record.processingIncomplete && [entry.url, entry.record.finalURL, entry.doc.url].some(value => canonical(value) === target)) {
        found = true; finish();
      } else cursor.continue();
    };
    const pending = tx.objectStore('pages').openKeyCursor();
    pending.onsuccess = () => {
      const cursor = pending.result;
      if (!cursor || found) { finish(); return; }
      if (canonical(cursor.key) === target) { found = true; finish(); } else cursor.continue();
    };
  });
}
export function saveDraft(projectId, patch) {
  return projectTransaction(projectId, [], 'readwrite', tx => {
    const store = tx.objectStore('meta'), request = store.get('draft');
    request.onsuccess = () => {
      const next = { ...request.result };
      for (const key of ['urls', 'query', 'engine', 'extractor', 'seenCollections', 'seeds', 'tupleLength', 'tupleCount', 'tuples', 'preparedQueries', 'preparedQueryBases', 'preparedFilters', 'searchFileType', 'excludedSites']) if (Object.hasOwn(patch, key)) next[key] = patch[key];
      store.put(next);
    };
  });
}
export function saveBatch(projectId, patch, collections) {
  return projectTransaction(projectId, [], 'readwrite', tx => {
    const store = tx.objectStore('meta'), request = store.get('batch');
    request.onsuccess = () => store.put({ ...request.result, ...patch, key: 'batch' });
    if (collections) store.put({ key: 'searches', collections });
  });
}
export function allocateFileIndex(projectId) {
  return projectTransaction(projectId, [], 'readwrite', (tx, done) => {
    const store = tx.objectStore('meta'), request = store.get('batch');
    request.onsuccess = () => {
      const batch = request.result; done(batch.nextFileIndex++); store.put(batch);
    };
  });
}
// Commit original bytes, extracted text, metadata and progress together. No
// document is shown as saved until this transaction has completed successfully.
export function saveDocument(projectId, record, document, original, { advance = false } = {}) {
  const { text, rawText, ...extraction } = document.extraction;
  const doc = { ...document, extraction, ...(typeof rawText === 'string' ? { rawTextFilename: document.filename.replace(/^pages\//, 'raw-pdf/').replace(/\.[^.]+$/, '.txt') } : {}) };
  const blob = original instanceof Blob ? original : new Blob([original]);
  return projectTransaction(projectId, ['documents', 'files', 'texts'], 'readwrite', (tx, done) => {
    const documents = tx.objectStore('documents'), request = documents.get(record.url);
    request.onsuccess = () => {
      const previous = request.result;
      const entry = { url: record.url, record: { ...record }, doc, fileNames: [...(previous?.fileNames || []), record.filename], originalBytes: (previous?.originalBytes || 0) + blob.size };
      if (previous?.record) entry.record.previousAttempt = previous.record;
      documents.put(entry);
      tx.objectStore('files').add({ name: record.filename, blob });
      tx.objectStore('texts').put({ url: record.url, blob: new Blob([text || ''], { type: 'text/plain;charset=utf-8' }), ...(typeof rawText === 'string' ? { rawBlob: new Blob([rawText], { type: 'text/plain;charset=utf-8' }) } : {}) });
      const meta = tx.objectStore('meta'), batchRequest = meta.get('batch');
      batchRequest.onsuccess = () => {
        const batch = batchRequest.result;
        batch.storedBytes += blob.size; if (advance) batch.processed++;
        meta.put(batch);
      };
      done(entry);
    };
  });
}
export function saveFailure(projectId, record) {
  return projectTransaction(projectId, ['documents'], 'readwrite', (tx, done) => {
    const documents = tx.objectStore('documents'), request = documents.get(record.url);
    request.onsuccess = () => {
      const entry = { url: record.url, record, doc: null, fileNames: request.result?.fileNames || [], originalBytes: request.result?.originalBytes || 0 };
      if (request.result?.record) entry.record.previousAttempt = request.result.record;
      documents.put(entry); done(entry);
      const meta = tx.objectStore('meta'), batch = meta.get('batch');
      batch.onsuccess = () => { const value = batch.result; value.processed++; meta.put(value); };
    };
  });
}
export function setIncluded(projectId, url, included) {
  return projectTransaction(projectId, ['documents'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('documents'), request = store.get(url);
    request.onsuccess = () => {
      if (!request.result?.doc) { fail(new Error('Document not found')); return; }
      const entry = request.result;
      entry.doc.extraction.included = entry.doc.extraction.status === 'ok' && !hasLanguageWarning(entry.doc.extraction) && included;
      if (entry.doc.extraction.languageCheck && !hasLanguageWarning(entry.doc.extraction)) entry.doc.extraction.languageCheck.inclusionBeforeCheck = included;
      store.put(entry);
    };
  });
}
// Compare the original filename to avoid attaching a result to a replaced document.
export function saveLanguageCheck(projectId, url, filename, languageCheck, included) {
  return projectTransaction(projectId, ['documents'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('documents'), request = store.get(url);
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry?.doc || entry.doc.filename !== filename) { fail(new Error('Document changed. Recheck its language again.')); return; }
      entry.doc.extraction.languageCheck = languageCheck;
      entry.doc.extraction.included = entry.doc.extraction.status === 'ok' && included;
      store.put(entry); done(entry);
    };
  });
}
export function removeDocument(projectId, url) {
  return projectTransaction(projectId, ['documents', 'files', 'texts'], 'readwrite', tx => {
    const docs = tx.objectStore('documents'), request = docs.get(url);
    request.onsuccess = () => {
      const meta = tx.objectStore('meta'), batch = meta.get('batch');
      const removedBytes = request.result?.originalBytes || 0;
      for (const name of request.result?.fileNames || []) tx.objectStore('files').delete(name);
      docs.delete(url); tx.objectStore('texts').delete(url);
      batch.onsuccess = () => {
        const value = batch.result; value.storedBytes = Math.max(0, value.storedBytes - removedBytes); meta.put(value);
      };
      const draft = meta.get('draft');
      draft.onsuccess = () => {
        const value = draft.result;
        value.urls = value.urls.split(/\r?\n/).filter(line => parseURLs(line).urls[0] !== url).join('\n'); meta.put(value);
      };
    };
  });
}
function readBlob(projectId, storeName, key, field = 'blob') {
  return projectTransaction(projectId, [storeName], 'readonly', (tx, done) => {
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => done(request.result?.[field] || null);
  });
}
export const readOriginal = (id, name) => readBlob(id, 'files', name);
export const readText = (id, url) => readBlob(id, 'texts', url);
export const readRawText = (id, url) => readBlob(id, 'texts', url, 'rawBlob');

export function storedProjectId() {
  return transaction(['meta'], 'readonly', (tx, done) => { const request = tx.objectStore('meta').get('active'); request.onsuccess = () => done(request.result?.projectId); });
}

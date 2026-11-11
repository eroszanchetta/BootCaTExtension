import { transaction, STORES } from './storage-db.js';
import { parseURLs } from './core.js';
const initialDraft = () => ({ key: 'draft', urls: '', query: '', engine: '', extractor: 'readability', seenCollections: [] });
const initialBatch = () => ({ key: 'batch', startedAt: null, state: 'idle', processed: 0, total: 0, nextFileIndex: 0, storedBytes: 0, lastStatus: 'Ready when you are.' });
function seed(tx, projectId) {
  const store = tx.objectStore('meta');
  store.put({ key: 'active', projectId }); store.put(initialDraft()); store.put(initialBatch()); store.put({ key: 'searches', collections: [] });
}
export function ensureStoredProject(projectId) {
  if (!projectId) throw new Error('Project identity is missing. Reopen BootCaT.');
  return transaction(['meta'], 'readwrite', (tx, done, fail) => {
    const request = tx.objectStore('meta').get('active');
    request.onsuccess = () => {
      if (!request.result) seed(tx, projectId);
      else if (request.result.projectId !== projectId) fail(new Error('The project changed. Reopen BootCaT.'));
    };
  });
}
export function resetStoredProject(projectId) {
  return transaction(STORES, 'readwrite', tx => {
    for (const name of STORES) tx.objectStore(name).clear();
    seed(tx, projectId);
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
export function saveDraft(projectId, patch) {
  return projectTransaction(projectId, [], 'readwrite', tx => {
    const store = tx.objectStore('meta'), request = store.get('draft');
    request.onsuccess = () => {
      const next = { ...request.result };
      for (const key of ['urls', 'query', 'engine', 'extractor', 'seenCollections']) if (Object.hasOwn(patch, key)) next[key] = patch[key];
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
  const { text, ...extraction } = document.extraction;
  const doc = { ...document, extraction };
  const blob = original instanceof Blob ? original : new Blob([original]);
  return projectTransaction(projectId, ['documents', 'files', 'texts'], 'readwrite', (tx, done) => {
    const documents = tx.objectStore('documents'), request = documents.get(record.url);
    request.onsuccess = () => {
      const previous = request.result;
      const entry = { url: record.url, record: { ...record }, doc, fileNames: [...(previous?.fileNames || []), record.filename], originalBytes: (previous?.originalBytes || 0) + blob.size };
      if (previous?.record) entry.record.previousAttempt = previous.record;
      documents.put(entry);
      tx.objectStore('files').add({ name: record.filename, blob });
      tx.objectStore('texts').put({ url: record.url, blob: new Blob([text || ''], { type: 'text/plain;charset=utf-8' }) });
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
      entry.doc.extraction.included = entry.doc.extraction.status === 'ok' && included;
      store.put(entry);
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
function readBlob(projectId, storeName, key) {
  return projectTransaction(projectId, [storeName], 'readonly', (tx, done) => {
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => done(request.result?.blob || null);
  });
}
export const readOriginal = (id, name) => readBlob(id, 'files', name);
export const readText = (id, url) => readBlob(id, 'texts', url);

export function storedProjectId() {
  return transaction(['meta'], 'readonly', (tx, done) => { const request = tx.objectStore('meta').get('active'); request.onsuccess = () => done(request.result?.projectId); });
}

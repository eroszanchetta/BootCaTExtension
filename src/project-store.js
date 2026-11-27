import { manualActions } from './manual-intervention.js';
import { LEGACY_SEARCH_ENGINE } from './search-engine-options.js';
import { DEFAULT_EXCLUDED_SITES } from './search-filters.js';
import { hasLanguageWarning } from './language-detection.js';
import { transaction, STORES } from './storage-db.js';
import { parseURLs } from './core.js';
const initialDraft = (defaults = {}) => ({ key: 'draft', urls: '', query: '', engine: defaults.engine ?? LEGACY_SEARCH_ENGINE, extractor: 'readability', seenCollections: [], seeds: '', tupleLength: '3', tupleCount: '10', tuples: '', preparedQueries: [], preparedQueryBases: null, preparedFilters: null, searchFileType: '', searchSite: '', excludedSites: (defaults.excludedSites ?? DEFAULT_EXCLUDED_SITES).join('\n') });
const initialBatch = () => ({ key: 'batch', startedAt: null, state: 'idle', processed: 0, total: 0, nextFileIndex: 0, storedBytes: 0, lastStatus: 'Ready when you are.' });
// Reserve the whole URL list before the first result, so completion/recovery
// timing cannot change document order. Later URLs always follow existing ones.
function documentURLs(draft, entries, order) {
  return [...new Set([...(order?.urls || []), ...parseURLs(draft?.urls || '').urls, ...entries.map(entry => entry.url)])];
}
function saveOrderedEntry(tx, entry) {
  const meta = tx.objectStore('meta'), documents = tx.objectStore('documents');
  const order = meta.get('documentOrder');
  order.onsuccess = () => {
    const position = order.result?.urls.indexOf(entry.url) ?? -1;
    if (position >= 0) { entry.listPosition = position; documents.put(entry); return; }
    const draft = meta.get('draft');
    draft.onsuccess = () => {
      const save = entries => {
        const urls = documentURLs(draft.result, [...entries, entry], order.result);
        entry.listPosition = urls.indexOf(entry.url);
        documents.put(entry); meta.put({ key: 'documentOrder', urls });
      };
      if (order.result) save([]);
      else { const existing = documents.getAll(); existing.onsuccess = () => save(existing.result); }
    };
  };
}
function seed(tx, projectId, defaults, project) {
  const store = tx.objectStore('meta');
  store.put({ key: 'active', projectId, ...(project ? { project } : {}) }); store.put(initialDraft(defaults)); store.put(initialBatch()); store.put({ key: 'searches', collections: [] });
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
export function resetStoredProject(projectId, defaults, project) {
  if (!projectId) throw new Error('Project identity is missing.');
  return transaction(STORES, 'readwrite', tx => {
    for (const name of STORES) tx.objectStore(name).clear();
    seed(tx, projectId, defaults, project);
  });
}
// Keep an explicit inactive marker: stale windows cannot seed a closed project,
// and a restart between database deletion and storage.local notification is safe.
export function closeStoredProject(projectId) {
  return projectTransaction(projectId, STORES, 'readwrite', tx => {
    for (const name of STORES) tx.objectStore(name).clear();
    tx.objectStore('meta').put({ key: 'active', projectId: null });
  });
}
export function storedProjectState() {
  return transaction(['meta'], 'readonly', (tx, done) => { const request = tx.objectStore('meta').get('active'); request.onsuccess = () => done(request.result); });
}
function projectTransaction(projectId, names, mode, operation) {
  return transaction([...new Set(['meta', ...names])], mode, (tx, done, fail) => {
    const request = tx.objectStore('meta').get('active');
    request.onsuccess = () => {
      if (!projectId || request.result?.projectId !== projectId) { fail(new Error('The project changed. Reopen BootCaT.')); return; }
      try { operation(tx, done, fail); } catch (error) { fail(error); }
    };
  });
}
export function loadWorkspace(projectId) {
  return projectTransaction(projectId, ['documents'], 'readonly', (tx, done) => {
    const results = {};
    for (const key of ['draft', 'batch', 'searches', 'corpusExport', 'deleteRevision', 'documentOrder']) {
      const request = tx.objectStore('meta').get(key);
      request.onsuccess = () => { results[key] = request.result; };
    }
    const docs = tx.objectStore('documents').getAll();
    docs.onsuccess = () => {
      const positions = new Map(documentURLs(results.draft, docs.result, results.documentOrder).map((url, index) => [url, index]));
      results.entries = docs.result.map(entry => ({ ...entry, listPosition: positions.get(entry.url) })).sort((a, b) => a.listPosition - b.listPosition);
    };
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
      for (const key of ['urls', 'query', 'engine', 'extractor', 'seenCollections', 'seeds', 'tupleLength', 'tupleCount', 'tuples', 'preparedQueries', 'preparedQueryBases', 'preparedFilters', 'searchFileType', 'searchSite', 'excludedSites']) if (Object.hasOwn(patch, key)) next[key] = patch[key];
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
  const doc = { ...document, extraction, editRevision: 0, ...(extraction.status === 'ok' ? { originalTextFilename: document.filename.replace(/^pages\//, 'raw-text/').replace(/\.[^.]+$/, '.txt') } : {}), ...(typeof rawText === 'string' ? { rawTextFilename: document.filename.replace(/^pages\//, 'raw-pdf/').replace(/\.[^.]+$/, '.txt') } : {}) };
  const blob = original instanceof Blob ? original : new Blob([original]);
  return projectTransaction(projectId, ['documents', 'files', 'texts'], 'readwrite', (tx, done, fail) => {
    const documents = tx.objectStore('documents'), request = documents.get(record.url);
    request.onsuccess = () => {
      const previous = request.result;
      if (previous?.doc?.editRevision > 0) { fail(new Error('This document has manual text edits. They were kept. Remove the document before replacing its original.')); return; }
      const entry = { url: record.url, record: { ...record }, doc, fileNames: [...(previous?.fileNames || []), record.filename], originalBytes: (previous?.originalBytes || 0) + blob.size };
      if (previous?.record) entry.record.previousAttempt = previous.record;
      entry.doc.manualInterventions = [...new Set([...manualActions(previous || {}), ...manualActions(entry)])];
      saveOrderedEntry(tx, entry);
      tx.objectStore('files').add({ name: record.filename, blob });
      const textBlob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' });
      tx.objectStore('texts').put({ url: record.url, blob: textBlob, ...(extraction.status === 'ok' ? { originalBlob: textBlob } : {}), ...(typeof rawText === 'string' ? { rawBlob: new Blob([rawText], { type: 'text/plain;charset=utf-8' }) } : {}) });
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
export function saveFailure(projectId, record, { advance = true } = {}) {
  return projectTransaction(projectId, ['documents'], 'readwrite', (tx, done, fail) => {
    const documents = tx.objectStore('documents'), request = documents.get(record.url);
    request.onsuccess = () => {
      if (request.result?.doc?.editRevision > 0) { fail(new Error('This document has manual text edits. They were kept.')); return; }
      const entry = { url: record.url, record, doc: null, fileNames: request.result?.fileNames || [], originalBytes: request.result?.originalBytes || 0 };
      if (request.result?.record) entry.record.previousAttempt = request.result.record;
      saveOrderedEntry(tx, entry); done(entry);
      const meta = tx.objectStore('meta'), batch = meta.get('batch');
      batch.onsuccess = () => { const value = batch.result; if (advance) value.processed++; meta.put(value); };
    };
  });
}
export function setIncluded(projectId, url, included) {
  return projectTransaction(projectId, ['documents'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('documents'), request = store.get(url);
    request.onsuccess = () => {
      if (!request.result?.doc) { fail(new Error('Document not found')); return; }
      const entry = request.result;
      const next = entry.doc.extraction.status === 'ok' && !hasLanguageWarning(entry.doc.extraction) && included;
      if (next !== entry.doc.extraction.included) entry.doc.manualInterventions = [...new Set([...manualActions(entry), 'inclusion-change'])];
      entry.doc.extraction.included = next;
      if (entry.doc.extraction.languageCheck && !hasLanguageWarning(entry.doc.extraction)) entry.doc.extraction.languageCheck.inclusionBeforeCheck = included;
      store.put(entry);
    };
  });
}
// Compare the original filename to avoid attaching a result to a replaced document.
export function saveLanguageCheck(projectId, url, filename, languageCheck, included, { manualRecheck = false } = {}) {
  return projectTransaction(projectId, ['documents'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('documents'), request = store.get(url);
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry?.doc || entry.doc.filename !== filename) { fail(new Error('Document changed. Recheck its language again.')); return; }
      if (manualRecheck) entry.doc.manualInterventions = [...new Set([...manualActions(entry), 'language-recheck'])];
      if (languageCheck?.accepted) entry.doc.manualInterventions = [...new Set([...manualActions(entry), 'language-override'])];
      entry.doc.extraction.languageCheck = languageCheck;
      entry.doc.extraction.included = entry.doc.extraction.status === 'ok' && included;
      store.put(entry); done(entry);
    };
  });
}
export const deletionKey = value => { try { const url = new URL(value); url.hash = ''; return 'deleted:' + url.href; } catch { return 'deleted:' + value; } };
export function getDeletionVersion(projectId, url) {
  return projectTransaction(projectId, [], 'readonly', (tx, done) => {
    const request = tx.objectStore('meta').get(deletionKey(url)); request.onsuccess = () => done(request.result?.version || 0);
  });
}
export function readDownloadTarget(projectId, url) {
  return projectTransaction(projectId, ['documents'], 'readonly', (tx, done) => {
    const target = {}, entry = tx.objectStore('documents').get(url), deleted = tx.objectStore('meta').get(deletionKey(url));
    entry.onsuccess = () => { target.entry = entry.result; };
    deleted.onsuccess = () => { target.deletedVersion = deleted.result?.version || 0; };
    done(target);
  });
}
export function removeDocument(projectId, url) {
  return projectTransaction(projectId, ['documents', 'files', 'texts', 'pages'], 'readwrite', tx => {
    const docs = tx.objectStore('documents'), request = docs.get(url);
    request.onsuccess = () => {
      const meta = tx.objectStore('meta'), batch = meta.get('batch');
      const removedBytes = request.result?.originalBytes || 0;
      const aliases = [...new Set([url, request.result?.record.finalURL].filter(Boolean))];
      const revision = meta.get('deleteRevision');
      revision.onsuccess = () => {
        const version = (revision.result?.value || 0) + 1;
        meta.put({ key: 'deleteRevision', value: version });
        for (const alias of aliases) meta.put({ key: deletionKey(alias), version });
        const keys = new Set(aliases.map(deletionKey)), pages = tx.objectStore('pages'), cursor = pages.openKeyCursor();
        cursor.onsuccess = () => { if (!cursor.result) return; if (keys.has(deletionKey(cursor.result.key))) pages.delete(cursor.result.key); cursor.result.continue(); };
      };
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

// Read text and its identity together, so a preview can later detect replacement
// or an edit committed in another workspace while its dialog was open.
export function readTextSnapshot(projectId, url) {
  return projectTransaction(projectId, ['documents', 'texts'], 'readonly', (tx, done) => {
    const snapshot = {};
    const doc = tx.objectStore('documents').get(url), text = tx.objectStore('texts').get(url);
    doc.onsuccess = () => { snapshot.entry = doc.result; };
    text.onsuccess = () => { snapshot.blob = text.result?.blob; };
    done(snapshot);
  });
}
export function readOriginalText(projectId, url) {
  return projectTransaction(projectId, ['texts'], 'readonly', (tx, done) => {
    const request = tx.objectStore('texts').get(url);
    request.onsuccess = () => done(request.result?.originalBlob || request.result?.blob || null);
  });
}
export function saveEditedText(projectId, url, expected, text, extraction) {
  return projectTransaction(projectId, ['documents', 'texts'], 'readwrite', (tx, done, fail) => {
    const documents = tx.objectStore('documents'), request = documents.get(url);
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry?.doc || entry.doc.filename !== expected.filename || (entry.doc.editRevision || 0) !== expected.revision) {
        fail(new Error('This document changed in another window. Your edits have not been saved. Copy them before closing, then reopen the document.')); return;
      }
      const texts = tx.objectStore('texts'), original = texts.get(url);
      original.onsuccess = () => {
        if (!original.result?.blob) { fail(new Error('The saved document text is missing. Your edits have not been saved.')); return; }
        // Legacy records acquire their baseline atomically on the first edit.
        texts.put({ ...original.result, originalBlob: original.result.originalBlob || original.result.blob, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) });
        entry.doc.manualInterventions = [...new Set([...manualActions(entry), entry.doc.extraction.status === 'ok' ? 'text-edit' : 'manual-text'])];
        entry.doc.extraction = extraction;
        entry.doc.editRevision = (entry.doc.editRevision || 0) + 1;
        entry.doc.editedAt = new Date().toISOString();
        entry.doc.originalTextFilename ||= entry.doc.filename.replace(/^pages\//, 'raw-text/').replace(/\.[^.]+$/, '.txt');
        documents.put(entry); done(entry);
      };
    };
  });
}

export function storedProjectId() {
  return transaction(['meta'], 'readonly', (tx, done) => { const request = tx.objectStore('meta').get('active'); request.onsuccess = () => done(request.result?.projectId); });
}

// This receipt describes the downloaded snapshot, not a new project content edit.
export function saveCorpusExport(projectId, receipt) {
  return projectTransaction(projectId, [], 'readwrite', tx => {
    tx.objectStore('meta').put({ ...receipt, key: 'corpusExport' });
  });
}

// All stores are read in one transaction: an inbox handoff or edit is captured
// entirely before or after its commit, never halfway through it.
export function snapshotStoredProject(project) {
  return projectTransaction(project.id, STORES, 'readonly', (tx, done) => {
    const snapshot = { project: { ...project }, stores: {} };
    for (const name of STORES) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { snapshot.stores[name] = r.result; }; }
    done(snapshot);
  });
}
export function replaceStoredProject(expectedId, snapshot, project) {
  return transaction(STORES, 'readwrite', (tx, done, fail) => {
    const active = tx.objectStore('meta').get('active');
    active.onsuccess = () => {
      if ((active.result?.projectId ?? null) !== expectedId) { fail(new Error('The project changed. Open the project file again.')); return; }
      for (const name of STORES) {
        const store = tx.objectStore(name); store.clear();
        for (const record of snapshot.stores[name]) store.add(record);
      }
      tx.objectStore('meta').put({ key: 'active', projectId: project.id, project, collections: snapshot.stores.meta.find(r => r.key === 'searches').collections });
    };
  });
}

import { checkLanguage, hasLanguageWarning, languageMessage } from './language-detection.js';
import { initWorkspaceSections, openWorkspaceSection } from './workspace-sections.js';
import { extractDownloadedDocument, extractionContentType } from './binary-extraction.js';
import { fileWarnings, readPDFFile } from './pdf-recovery.js';
import { formatByMIME, readImportedDocument } from './document-formats.js';
import { initProjectUI, projectFilename } from './project-ui.js';
import { listSavedPages, readSavedPage, removeSavedPage } from './page-store.js';
import * as storage from './project-store.js';
import { getExtensionAPI } from './extension-api.js';
import { parseURLs, filenameFor, fetchFile, FILE_LIMIT, urlListWarning } from './core.js';
import { makeStoredZIP } from './zip-blob.js';
import { initSearchUI, readCollections } from './search-ui.js';
import { initSeedsUI } from './seeds-ui.js';
import { initProjectTabsUI } from './project-tabs-ui.js';
import { extractDocument } from './extraction.js';
import { extractionMetadata } from './corpus.js';
import { DEFUDDLE_AVAILABLE } from './defuddle-loader.js';

initWorkspaceSections();
const ext = getExtensionAPI(), VERSION = '0.4.0';
const ui = Object.fromEntries(['urls', 'start', 'stop', 'export', 'status', 'progress', 'results', 'problem-results', 'attention-section', 'attention-count', 'project-language', 'recheck-language', 'language-status', 'corpus-status', 'preview-title', 'preview-meta', 'preview-text', 'extractor', 'urls-warning', 'storage-status', 'saved-status', 'engine', 'import-document-picker', 'document-import-status'].map(id => [id, document.getElementById(id)]));
let ready = false, running = false, stopping = false, resetting = false, controller = null;
let projectId, state, entries = [], searchUI, seedsUI, projectTabsUI, archiveURL = null, previewURL = null, previewFilename = null;
let writes = Promise.resolve(), pendingWrites = 0, writeError = null, capturesPending = false, refreshing = false;
let pickingDocument = false, documentImportTarget = null, documentImportStatus = { url: null, message: '' };
const rows = new Map(), controls = new Map();
ui.start.disabled = ui.export.disabled = true;
ui.extractor.querySelector('option[value="defuddle"]').disabled = !DEFUDDLE_AVAILABLE;
if (!DEFUDDLE_AVAILABLE) ui.extractor.querySelector('option[value="defuddle"]').textContent = 'Defuddle — library unavailable';
const projectUI = initProjectUI({
  onRename: invalidateArchive,
  onReset: () => {
    resetting = true; controller?.abort(); seedsUI?.destroy(); projectTabsUI?.destroy(); running = false;
    invalidateArchive(); ui.urls.value = ''; clearPreview();
    document.getElementById('project-name').value = 'Untitled project';
    window.location.reload();
  }
});
window.addEventListener('beforeunload', event => {
  if (!resetting && (running || seedsUI?.isBusy() || pendingWrites || projectUI.isSaving?.())) { event.preventDefault(); event.returnValue = ''; }
});
function invalidateArchive() { if (archiveURL) { URL.revokeObjectURL(archiveURL); archiveURL = null; } }
function storageMessage() {
  const bytes = entries.reduce((sum, entry) => sum + (entry.originalBytes || 0), 0);
  ui['storage-status'].textContent = pendingWrites ? 'Saving changes…' : `Saved in this browser · ${(bytes / 1024 / 1024).toFixed(1)} MiB of originals. Export a ZIP backup before clearing browser data or uninstalling BootCaT.`;
}
function report(error) {
  if (resetting) return;
  const full = error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '');
  ui.status.textContent = full ? 'Browser storage is full. Completed pages remain saved. Export your corpus and free space before continuing.' : `Could not complete the operation: ${error.message}`;
}
function warnURLs() { const count = parseURLs(ui.urls.value).urls.length; document.getElementById('urls-counter').textContent = `${count.toLocaleString()} URL${count === 1 ? '' : 's'}`; ui['urls-warning'].textContent = urlListWarning(count); }
function queueDraft(patch) {
  if (!ready || resetting) return writes;
  invalidateArchive(); Object.assign(state.draft, patch); pendingWrites++; storageMessage();
  writes = writes.then(() => storage.saveDraft(projectId, patch)).then(() => { writeError = null; }, error => { writeError = error; report(error); }).finally(() => { pendingWrites--; if (!writeError) storageMessage(); });
  return writes;
}
async function flushWrites() { await writes; if (writeError) throw writeError; }
function pendingURLs() {
  const complete = new Set(entries.filter(entry => ['downloaded', 'captured'].includes(entry.record.outcome) && !entry.record.processingIncomplete).map(entry => entry.url));
  return parseURLs(ui.urls.value).urls.filter(url => !complete.has(url));
}
function updateControls() {
  ui.start.disabled = !ready || running; ui.export.disabled = !ready || running || !entries.length;
  ui.urls.disabled = ui.extractor.disabled = running;
  ui['project-language'].disabled = !ready || running; ui['recheck-language'].disabled = !ready || running || !entries.some(entry => entry.doc?.extraction.status === 'ok');
  ui.start.textContent = !running && ready && ['running', 'stopped'].includes(state.batch.state) && pendingURLs().length ? 'Resume downloads' : 'Download URLs';
  for (const items of controls.values()) { items.trash.disabled = running; if (items.importDocument) items.importDocument.disabled = running; if (items.acceptLanguage) items.acceptLanguage.disabled = running; if (items.checkbox) items.checkbox.disabled = running || items.failed; }
}
const needsAttention = entry => !entry.doc || entry.doc.extraction.status !== 'ok' || hasLanguageWarning(entry.doc.extraction);
function markPreviewRow(url, row) {
  const selected = url === previewURL;
  row.classList.toggle('preview-selected', selected);
  row.setAttribute('aria-current', selected ? 'true' : 'false');
}
function updatePreviewSelection() {
  for (const [url, row] of rows) markPreviewRow(url, row);
}
function updateCounts() {
  const problems = entries.filter(needsAttention).length;
  ui['attention-section'].hidden = !problems;
  ui['attention-count'].textContent = `${problems.toLocaleString()} document${problems === 1 ? '' : 's'}`;
  const documents = entries.filter(entry => entry.doc?.extraction.status === 'ok');
  const included = documents.filter(entry => entry.doc.extraction.included);
  ui['corpus-status'].textContent = `${included.length} of ${documents.length} extracted texts included · ${included.reduce((sum, entry) => sum + entry.doc.extraction.characters, 0).toLocaleString()} characters. Unchecked pages retain their originals.`;
  storageMessage();
}
function clearPreview() {
  previewURL = previewFilename = null; updatePreviewSelection();
  ui['preview-title'].textContent = 'Preview Text'; ui['preview-meta'].textContent = 'Click a Preview text button in the review list to display its text here.'; ui['preview-text'].value = '';
}
async function preview(doc) {
  openWorkspaceSection('preview-section', { scroll: true });
  const e = doc.extraction;
  const warnings = [...fileWarnings(e), languageMessage(e)].filter(Boolean);
  previewURL = doc.url; previewFilename = doc.filename; const selected = doc.filename; updatePreviewSelection();
  ui['preview-meta'].textContent = `${e.title ? e.title + ' · ' : ''}${doc.url} · ${e.extractor || 'Unsupported format'} · ${e.characters.toLocaleString()} characters${e.pageCount ? ` · ${e.pageCount} pages` : ''}${warnings.length ? ` · ${warnings.join(' ')}` : ''}`;
  ui['preview-text'].value = 'Loading text…';
  try {
    const blob = await storage.readText(projectId, doc.url), text = blob ? await blob.text() : '';
    if (previewURL === doc.url && previewFilename === selected) ui['preview-text'].value = text || 'No corpus text available. The original is retained; see the extraction message above.';
  } catch (error) { if (previewFilename === selected) ui['preview-text'].value = ''; report(error); }
}
function errorTip(record) {
  if (record.errorCode === 'DOWNLOAD_TOO_LARGE') return record.error;
  if (record.outcome === 'cancelled') return 'Stopped by user. Click Resume downloads to try again.';
  return `Could not download this page or file. Open its URL and complete any CAPTCHA or sign-in. Then use Add page to corpus in the BootCaT popup, or download the file using your browser and choose Import downloaded file here. (${record.error || 'Download interrupted'})`;
}
function renderRow(entry) {
  const { url, record, doc } = entry;
  const tr = document.createElement('tr');
  const selection = document.createElement('td'), source = document.createElement('td'), result = document.createElement('td'), actions = document.createElement('td');
  const link = document.createElement('a'); link.href = url; link.textContent = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; source.append(link);
  let checkbox;
  if (!doc) { selection.textContent = '—'; result.textContent = errorTip(record); tr.className = 'error'; }
  else {
    const e = doc.extraction;
    checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = e.included;
    checkbox.setAttribute('aria-label', `Include ${e.title || url} in corpus`);
    checkbox.addEventListener('change', async () => {
      const value = checkbox.checked;
      await work(async () => {
        await storage.setIncluded(projectId, url, value); e.included = value; invalidateArchive(); updateCounts();
      });
      checkbox.checked = e.included;
    });
    selection.append(checkbox);
    const origin = record.source === 'local-file' ? `Imported ${formatByMIME(record.contentType)?.label || 'document'}` : record.source === 'browser-session' ? 'PDF saved using browser session' : record.outcome === 'captured' ? 'Saved from browser tab' : 'Downloaded';
    result.append(document.createTextNode(`${origin} · ${e.status === 'ok' ? `${e.characters.toLocaleString()} characters` : e.status === 'unsupported' ? 'Unsupported extraction format' : 'Extraction failed'}`));
    const button = document.createElement('button'); button.className = 'secondary preview-button'; button.textContent = e.status === 'ok' ? 'Preview text' : 'Details';
    button.addEventListener('click', () => preview(doc)); result.append(button);
    const warnings = fileWarnings(e);
    const languageStatus = languageMessage(e);
    if (languageStatus) { const languageHint = document.createElement('p'); languageHint.className = 'hint'; languageHint.textContent = languageStatus; result.append(languageHint); }
    if (warnings.length) { const warning = document.createElement('p'); warning.className = 'hint'; warning.textContent = warnings.join(' '); result.append(warning); }
  }
  let acceptLanguage;
  if (doc && hasLanguageWarning(doc.extraction)) {
    acceptLanguage = document.createElement('button'); acceptLanguage.type = 'button'; acceptLanguage.className = 'secondary accept-language'; acceptLanguage.textContent = 'Include anyway';
    acceptLanguage.addEventListener('click', () => work(async () => {
      const current = (await storage.loadWorkspace(projectId)).entries.find(entry => entry.url === url);
      if (!current?.doc || current.doc.extraction.status !== 'ok') return;
      const check = { ...current.doc.extraction.languageCheck, accepted: true, acceptedAt: new Date().toISOString(), inclusionBeforeCheck: true };
      remember(await storage.saveLanguageCheck(projectId, url, current.doc.filename, check, true)); updateControls();
    }));
    acceptLanguage.disabled = running; result.append(acceptLanguage);
  }
  // A failed request cannot establish the format: inspect only selected file bytes.
  let importDocument, importFeedback;
  if (!doc && record.outcome === 'error' && record.errorCode !== 'DOWNLOAD_TOO_LARGE') {
    importDocument = document.createElement('button'); importDocument.type = 'button'; importDocument.className = 'secondary import-document-button'; importDocument.textContent = 'Import downloaded file';
    importDocument.addEventListener('click', () => {
      if (running || resetting || pickingDocument) return;
      documentImportTarget = { url, finalURL: record.finalURL || url, projectId };
      pickingDocument = true;
      documentImportMessage(url, 'Choose the file downloaded for this URL (up to 50 MiB).');
      // Keep the input outside the table: focus/storage updates may rebuild rows
      // while the native file chooser is open, before its change event arrives.
      ui['import-document-picker'].accept = '';
      ui['import-document-picker'].value = ''; ui['import-document-picker'].click();
    });
    importFeedback = document.createElement('p'); importFeedback.className = 'hint document-import-feedback'; importFeedback.setAttribute('role', 'status');
    importFeedback.textContent = documentImportStatus.url === url ? documentImportStatus.message : '';
    source.append(importDocument, importFeedback);
  }
  const trash = document.createElement('button'); trash.type = 'button'; trash.className = 'delete-button'; trash.title = 'Delete page'; trash.setAttribute('aria-label', `Delete ${doc?.extraction.title || url}`);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' })) icon.setAttribute(name, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'); icon.append(path); trash.append(icon);
  trash.addEventListener('click', () => work(async () => {
    if (!window.confirm('Delete this page and its text completely? Its saved originals, extracted text and download metadata will be removed from this project and future exports.')) return;
    await flushWrites(); await storage.removeDocument(projectId, url);
    entries = entries.filter(item => item.url !== url); rows.get(url)?.remove(); rows.delete(url); controls.delete(url);
    ui.urls.value = ui.urls.value.split(/\r?\n/).filter(line => parseURLs(line).urls[0] !== url).join('\n');
    state.draft.urls = ui.urls.value;
    if (previewURL === url) clearPreview(); invalidateArchive(); updateCounts(); warnURLs();
    ui.status.textContent = 'Page deleted from the saved project and future exports.';
  }));
  actions.append(trash); tr.append(selection, source, result, actions);
  const target = needsAttention(entry) ? ui['problem-results'] : ui.results;
  const old = rows.get(url);
  if (old?.parentNode === target) old.replaceWith(tr);
  else { old?.remove(); target.append(tr); }
  rows.set(url, tr); markPreviewRow(url, tr); controls.set(url, { trash, checkbox, acceptLanguage, importDocument, importFeedback, failed: doc?.extraction.status !== 'ok' || hasLanguageWarning(doc?.extraction) });
  if (importDocument) importDocument.disabled = running;
  trash.disabled = running; if (checkbox) checkbox.disabled = running || doc.extraction.status !== 'ok' || hasLanguageWarning(doc.extraction);
}
function documentImportMessage(url, message) {
  documentImportStatus = { url, message };
  ui['document-import-status'].textContent = `${url} · ${message}`;
  const feedback = controls.get(url)?.importFeedback;
  if (feedback) feedback.textContent = message;
}
ui['import-document-picker'].addEventListener('cancel', () => {
  pickingDocument = false;
  if (documentImportTarget) documentImportMessage(documentImportTarget.url, 'File selection cancelled.');
  documentImportTarget = null;
});
ui['import-document-picker'].addEventListener('change', async () => {
  const target = documentImportTarget, file = ui['import-document-picker'].files?.[0];
  pickingDocument = false;
  if (!target || !file || resetting || target.projectId !== projectId) { documentImportTarget = null; return; }
  let started = false;
  await work(async () => {
    started = true;
    try {
      documentImportMessage(target.url, 'Importing file… Reading and extracting text may take up to 30 seconds.');
      await flushWrites();
      const { bytes, format } = await readImportedDocument(file);
      await storeCapture({ ...target, bytes, contentType: format.mime, source: 'local-file', capturedAt: new Date().toISOString() });
      if (resetting) return;
      documentImportMessage(target.url, `${format.label} imported. Original file saved; review its extraction result below.`);
      ui['saved-status'].textContent = `Downloaded ${format.label} added to the review list. Review its text before saving your corpus.`;
    } catch (error) {
      documentImportMessage(target.url, `File not imported: ${error.message}`);
      throw error;
    }
  });
  if (!started && !resetting) documentImportMessage(target.url, 'File not imported: another operation is running. Choose the file again when it finishes.');
  documentImportTarget = null; ui['import-document-picker'].value = '';
});
function remember(entry) {
  const index = entries.findIndex(item => item.url === entry.url);
  if (index < 0) entries.push(entry); else entries[index] = entry;
  if (previewURL === entry.url) clearPreview(); renderRow(entry); invalidateArchive(); updateCounts();
}
function renderEntries() {
  ui.results.replaceChildren(); ui['problem-results'].replaceChildren(); rows.clear(); controls.clear();
  for (const entry of entries) renderRow(entry);
}
async function restore({ draft = true } = {}) {
  if (resetting) return;
  const saved = await storage.loadWorkspace(projectId); if (resetting) return;
  invalidateArchive(); state = saved; entries = saved.entries;
  if (draft) { ui.urls.value = saved.draft.urls; ui.extractor.value = saved.draft.extractor; if (saved.draft.engine) ui.engine.value = saved.draft.engine; seedsUI?.restore(saved.draft); }
  renderEntries();
  const selected = entries.find(entry => entry.url === previewURL)?.doc;
  if (previewURL && selected?.filename !== previewFilename) clearPreview();
  ui.progress.max = Math.max(1, state.batch.total); ui.progress.value = state.batch.processed;
  ui.status.textContent = state.batch.state === 'running' ? 'Saved project restored. An interrupted download can be resumed with Resume downloads. Completed pages will be skipped.' : state.batch.lastStatus;
  updateCounts(); warnURLs(); updateControls();
  projectTabsUI?.refresh();
}
async function work(task) {
  if (!ready || running || resetting) return false;
  // Reserve this window immediately; Web Lock acquisition is asynchronous.
  // Otherwise a quick follow-up edit could race a pending deletion/download.
  running = true; updateControls();
  const execute = async lock => {
    try {
      if (!lock) { ui.status.textContent = 'Another BootCaT window is processing this project. Return here when it finishes.'; return false; }
      await task(); return true;
    }
    catch (error) { report(error); return false; }
    finally {
      running = false; if (!resetting) { updateControls(); searchUI?.flush(); }
    }
  };
  const result = await (navigator.locks ? navigator.locks.request('bootcat-project-work', { ifAvailable: true }, execute) : execute({}));
  // Drain the inbox only after the cross-window lock has actually been released.
  if (capturesPending && !resetting) { capturesPending = false; queueMicrotask(importSavedPages); }
  return result;
}
ui.stop.addEventListener('click', () => { stopping = true; controller?.abort(); ui.stop.disabled = true; ui.status.textContent = 'Stopping… Completed pages are saved in this browser.'; });
ui.start.addEventListener('click', () => work(async () => {
  openWorkspaceSection('review-section', { scroll: true });
  await flushWrites();
  const parsed = parseURLs(ui.urls.value);
  if (parsed.errors.length || !parsed.urls.length) { ui.status.textContent = parsed.errors.join(' · ') || 'Please enter at least one URL.'; return; }
  // Refresh metadata after acquiring the cross-window runner lock.
  entries = (await storage.loadWorkspace(projectId)).entries; renderEntries();
  const urls = pendingURLs();
  if (!urls.length) { ui.status.textContent = 'All listed pages are already saved. Add URLs to download more pages.'; return; }
  stopping = false; ui.stop.disabled = false; controller = null;
  const startedAt = state.batch.startedAt || new Date().toISOString();
  await storage.saveBatch(projectId, { startedAt, state: 'running', processed: 0, total: urls.length }, await readCollections());
  state.batch = { ...state.batch, startedAt, state: 'running', total: urls.length, processed: 0 };
  ui.progress.max = urls.length; ui.progress.value = 0;
  let processed = 0;
  try {
    for (const url of urls) {
      if (stopping || resetting) break;
      ui.status.textContent = `Downloading and extracting ${processed + 1} of ${urls.length} remaining pages…`;
      controller = new AbortController(); let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
      let downloaded = false;
      try {
        const response = await fetchFile(url, controller.signal, FILE_LIMIT); downloaded = true; clearTimeout(timer);
        if (resetting) return;
        const index = await storage.allocateFileIndex(projectId);
        const filename = filenameFor(url, extractionContentType(response.bytes, response.contentType), index);
        const extraction = await extractDownloadedDocument(response.bytes, response.contentType, { extractor: ui.extractor.value, sourceURL: response.finalURL || url, signal: controller.signal });
        if (resetting) return;
        const record = { url, finalURL: response.finalURL, outcome: 'downloaded', httpStatus: response.status, contentType: response.contentType, bytes: response.bytes.length, filename, processingIncomplete: controller.signal.aborted, downloadedAt: new Date().toISOString() };
        const checkedExtraction = await checkLanguage(extraction, projectUI.snapshot().language || 'none');
        const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction: checkedExtraction };
        remember(await storage.saveDocument(projectId, record, doc, response.bytes, { advance: true }));
      } catch (error) {
        if (resetting) return;
        // Storage failures must stop the run, not masquerade as network errors.
        if (downloaded || error.name === 'QuotaExceededError') throw error;
        const message = stopping ? 'Stopped by user' : timedOut ? 'Timed out after 30 seconds' : error.message;
        remember(await storage.saveFailure(projectId, { url, outcome: stopping ? 'cancelled' : 'error', error: message, ...(error.contentType ? { contentType: error.contentType } : {}), ...(error.finalURL ? { finalURL: error.finalURL } : {}), ...(error.code === 'DOWNLOAD_TOO_LARGE' ? { errorCode: error.code, limitBytes: error.limitBytes } : {}) }));
      } finally { clearTimeout(timer); controller = null; }
      processed++; ui.progress.value = processed;
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!resetting) {
      const message = `${stopping ? 'Stopped' : 'Finished'}. ${entries.filter(item => item.doc).length} saved pages, ${entries.filter(item => item.record.outcome === 'error').length} download errors, ${entries.filter(item => item.doc?.extraction.status === 'failed').length} extraction failures. Changes are saved in this browser.`;
      await storage.saveBatch(projectId, { state: stopping ? 'stopped' : 'idle', processed, lastStatus: message });
      state.batch.state = stopping ? 'stopped' : 'idle'; ui.status.textContent = message;
    }
  } finally { ui.stop.disabled = true; }
}));
async function storeCapture({ url, finalURL, bytes, contentType, source, capturedAt, captureId }) {
  const index = await storage.allocateFileIndex(projectId);
  const filename = filenameFor(url, contentType, index).replace(/^pages\//, 'pages/captured/');
  const extraction = formatByMIME(contentType)
    ? await extractDownloadedDocument(bytes, contentType, { sourceURL: finalURL })
    : extractDocument(bytes, contentType, { extractor: ui.extractor.value, sourceURL: finalURL });
  if (resetting) return;
  const checkedExtraction = await checkLanguage(extraction, projectUI.snapshot().language || 'none');
  const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction: checkedExtraction, captureId, source, capturedAt };
  const record = { url, finalURL, outcome: 'captured', source, capturedAt, captureId, filename, contentType, bytes: bytes.length };
  remember(await storage.saveDocument(projectId, record, doc, bytes));
  if (!state.batch.startedAt) { state.batch.startedAt = new Date().toISOString(); await storage.saveBatch(projectId, { startedAt: state.batch.startedAt }, await readCollections()); }
}
async function importSavedPages() {
  if (!ready || resetting) return;
  if (running) { capturesPending = true; return; }
  await work(async () => {
    const pending = await listSavedPages(); if (!pending.length) return;
    entries = (await storage.loadWorkspace(projectId)).entries; renderEntries();
    let count = 0;
    for (const item of pending) {
      if (resetting) return;
      const page = await readSavedPage(item.url); if (!page) continue;
      if (entries.some(entry => entry.doc?.captureId === page.id)) { await removeSavedPage(page); continue; }
      const previous = entries.find(entry => entry.url === page.url || entry.record.finalURL === page.url);
      const url = previous?.url || page.url;
      const bytes = page.kind === 'pdf' ? await readPDFFile(page.blob, FILE_LIMIT) : new TextEncoder().encode(page.html);
      await storeCapture({ url, finalURL: page.finalURL || page.url, bytes,
        contentType: page.kind === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8',
        source: page.source || 'browser-tab', capturedAt: page.capturedAt, captureId: page.id });
      await removeSavedPage(page); count++;
    }
    if (count) ui['saved-status'].textContent = `${count} saved page${count === 1 ? '' : 's'} added to the review list. Review the text before saving your corpus.`;
  });
}
ui['project-language'].addEventListener('change', () => work(async () => {
  const value = ui['project-language'].value;
  await projectUI.setLanguage(value); invalidateArchive();
  ui['language-status'].textContent = 'Language setting saved. Click Recheck saved texts to apply it to existing documents. Manual overrides and exclusions are preserved.';
}));
ui['recheck-language'].addEventListener('click', () => work(async () => {
  await flushWrites(); const target = projectUI.snapshot().language || 'none';
  const saved = await storage.loadWorkspace(projectId), documents = saved.entries.filter(entry => entry.doc?.extraction.status === 'ok');
  stopping = false; ui.stop.disabled = false; let checked = 0;
  try {
    for (const entry of documents) {
      if (resetting || stopping) break;
      const blob = await storage.readText(projectId, entry.url);
      const result = await checkLanguage({ ...entry.doc.extraction, text: blob ? await blob.text() : '' }, target);
      if (resetting) return;
      remember(await storage.saveLanguageCheck(projectId, entry.url, entry.doc.filename, result.languageCheck, result.included));
      checked++; ui['language-status'].textContent = `Rechecked ${checked} of ${documents.length} saved texts…`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    ui['language-status'].textContent = `${stopping ? 'Stopped. ' : ''}${checked} of ${documents.length} saved texts rechecked. No documents were downloaded again.`;
  } finally { ui.stop.disabled = true; }
}));
ui.export.addEventListener('click', () => work(async () => {
  await flushWrites();
  const saved = await storage.loadWorkspace(projectId), project = projectUI.snapshot();
  const exportedAt = new Date().toISOString(), signal = (controller = new AbortController()).signal;
  ui.status.textContent = 'Preparing ZIP from saved pages… Your project remains saved if export fails.';
  try {
    invalidateArchive();
    {
      async function* files() {
        for (const entry of saved.entries) {
          for (const name of entry.fileNames) {
            const blob = await storage.readOriginal(projectId, name);
            if (!blob) throw new Error('An original file is missing from browser storage');
            yield { name, blob };
          }
          if (entry.doc?.extraction.status === 'ok' && entry.doc.extraction.included) {
            const blob = await storage.readText(projectId, entry.url);
            if (!blob) throw new Error('An extracted text is missing from browser storage');
            yield { name: entry.doc.textFilename, blob: new Blob([blob, '\n']) };
          }
          if (entry.doc?.rawTextFilename) {
            const blob = await storage.readRawText(projectId, entry.url);
            if (!blob) throw new Error('A raw PDF extraction is missing from browser storage');
            yield { name: entry.doc.rawTextFilename, blob: new Blob([blob, '\n']) };
          }
        }
        const json = [
          ['project.json', { ...project, draft: saved.draft, batch: saved.batch }],
          ['results.json', { version: VERSION, project, startedAt: saved.batch.startedAt, exportedAt, results: saved.entries.map(entry => entry.record) }],
          ['extraction.json', { version: VERSION, project, exportedAt, documents: extractionMetadata(saved.entries.filter(entry => entry.doc).map(entry => entry.doc)) }],
          ['searches.json', { version: VERSION, project, collections: await readCollections() }]
        ];
        for (const [name, value] of json) yield { name, blob: new Blob([JSON.stringify(value, null, 2)]) };
      }
      archiveURL = URL.createObjectURL(await makeStoredZIP(files(), { signal }));
    }
    const link = document.createElement('a'); link.href = archiveURL;
    link.download = `${projectFilename(project.name)}-${exportedAt.replace(/[:.]/g, '-')}.zip`;
    document.body.append(link); link.click(); link.remove(); ui.status.textContent = 'ZIP prepared. Your project is still saved in this browser.';
  } finally { controller = null; }
}));
for (const [id, key, type] of [['urls', 'urls', 'input'], ['engine', 'engine', 'change'], ['extractor', 'extractor', 'change']]) {
  ui[id].addEventListener(type, () => { queueDraft({ [key]: ui[id].value }); if (id === 'urls') warnURLs(); });
}
ext.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.captureRevision) importSavedPages(); });
window.addEventListener('focus', async () => {
  if (!ready || running || seedsUI?.isBusy() || pickingDocument || pendingWrites || refreshing || resetting) return;
  refreshing = true;
  try { await restore(); await importSavedPages(); } catch (error) { report(error); } finally { refreshing = false; }
});
(async () => {
  try {
    await projectUI.ready; projectId = projectUI.snapshot().id;
    await storage.ensureStoredProject(projectId);
    await restore();
    searchUI = initSearchUI({ isRunning: () => running, seenCollectionIds: state.draft.seenCollections, getProjectId: () => projectId, onChange: patch => { queueDraft(patch); warnURLs(); } });
    if (state.draft.engine) ui.engine.value = state.draft.engine;
    ready = true; seedsUI = initSeedsUI({ draft: state.draft, onChange: queueDraft, getProjectId: () => projectId });
    projectTabsUI = initProjectTabsUI({ getProjectId: () => projectId });
    updateControls(); await importSavedPages();
  } catch (error) { report(error); }
})();

import { extractDownloadedDocument, extractionContentType } from './binary-extraction.js';
import { initProjectUI, projectFilename } from './project-ui.js';
import { listSavedPages, readSavedPage, removeSavedPage } from './page-store.js';
import * as storage from './project-store.js';
import { getExtensionAPI } from './extension-api.js';
import { parseURLs, filenameFor, fetchFile, FILE_LIMIT, urlListWarning } from './core.js';
import { makeStoredZIP } from './zip-blob.js';
import { initSearchUI, readCollections } from './search-ui.js';
import { extractDocument } from './extraction.js';
import { extractionMetadata } from './corpus.js';
import { DEFUDDLE_AVAILABLE } from './defuddle-loader.js';

const ext = getExtensionAPI(), VERSION = '0.4.0';
const ui = Object.fromEntries(['urls', 'start', 'stop', 'export', 'status', 'progress', 'results', 'corpus-status', 'preview-title', 'preview-meta', 'preview-text', 'extractor', 'urls-warning', 'storage-status', 'saved-status', 'query', 'engine'].map(id => [id, document.getElementById(id)]));
let ready = false, running = false, stopping = false, resetting = false, controller = null;
let projectId, state, entries = [], searchUI, archiveURL = null, previewURL = null, previewFilename = null;
let writes = Promise.resolve(), pendingWrites = 0, writeError = null, capturesPending = false, refreshing = false;
const rows = new Map(), controls = new Map();
ui.start.disabled = ui.export.disabled = true;
ui.extractor.querySelector('option[value="defuddle"]').disabled = !DEFUDDLE_AVAILABLE;
if (!DEFUDDLE_AVAILABLE) ui.extractor.querySelector('option[value="defuddle"]').textContent = 'Defuddle — library unavailable';
const projectUI = initProjectUI({
  onRename: invalidateArchive,
  onReset: () => {
    resetting = true; controller?.abort(); running = false;
    invalidateArchive(); ui.urls.value = ''; ui.query.value = ''; clearPreview();
    document.getElementById('project-name').value = 'Untitled project';
    window.location.reload();
  }
});
window.addEventListener('beforeunload', event => {
  if (!resetting && (running || pendingWrites || projectUI.isSaving?.())) { event.preventDefault(); event.returnValue = ''; }
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
function warnURLs() { ui['urls-warning'].textContent = urlListWarning(parseURLs(ui.urls.value).urls.length); }
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
  ui.start.textContent = !running && ready && ['running', 'stopped'].includes(state.batch.state) && pendingURLs().length ? 'Resume downloads' : 'Download URLs';
  for (const items of controls.values()) { items.trash.disabled = running; if (items.checkbox) items.checkbox.disabled = running || items.failed; }
}
function updateCounts() {
  const documents = entries.filter(entry => entry.doc?.extraction.status === 'ok');
  const included = documents.filter(entry => entry.doc.extraction.included);
  ui['corpus-status'].textContent = `${included.length} of ${documents.length} extracted texts included · ${included.reduce((sum, entry) => sum + entry.doc.extraction.characters, 0).toLocaleString()} characters. Unchecked pages retain their originals.`;
  storageMessage();
}
function clearPreview() {
  previewURL = previewFilename = null;
  ui['preview-title'].textContent = 'Preview text'; ui['preview-meta'].textContent = 'Click a Preview text button in the review list to display its text here.'; ui['preview-text'].value = '';
}
async function preview(doc) {
  const e = doc.extraction;
  previewURL = doc.url; previewFilename = doc.filename; const selected = doc.filename;
  ui['preview-meta'].textContent = `${e.title ? e.title + ' · ' : ''}${doc.url} · ${e.extractor || 'Unsupported format'} · ${e.characters.toLocaleString()} characters${e.pageCount ? ` · ${e.pageCount} pages` : ''}${e.warnings.length ? ` · ${e.warnings.join(' ')}` : ''}`;
  ui['preview-text'].value = 'Loading text…';
  try {
    const blob = await storage.readText(projectId, doc.url), text = blob ? await blob.text() : '';
    if (previewURL === doc.url && previewFilename === selected) ui['preview-text'].value = text || 'No corpus text available. The original is retained; see the extraction message above.';
  } catch (error) { if (previewFilename === selected) ui['preview-text'].value = ''; report(error); }
}
function errorTip(record) {
  return record.outcome === 'cancelled' ? 'Stopped by user. Click Resume downloads to try again.' : `Could not download this page. Click its URL to open it in a new tab. Complete any CAPTCHA or sign-in, then click the BootCaT toolbar icon → Add page to corpus. The page will appear here automatically. (${record.error || 'Download interrupted'})`;
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
    result.append(document.createTextNode(`${record.outcome === 'captured' ? 'Saved from browser tab' : 'Downloaded'} · ${e.status === 'ok' ? `${e.characters.toLocaleString()} characters` : e.status === 'unsupported' ? 'Unsupported extraction format' : 'Extraction failed'}`));
    const button = document.createElement('button'); button.className = 'secondary preview-button'; button.textContent = e.status === 'ok' ? 'Preview text' : 'Details';
    button.addEventListener('click', () => preview(doc)); result.append(button);
    if (e.warnings.length) { const warning = document.createElement('p'); warning.className = 'hint'; warning.textContent = e.warnings.join(' '); result.append(warning); }
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
  const old = rows.get(url); if (old) old.replaceWith(tr); else ui.results.append(tr);
  rows.set(url, tr); controls.set(url, { trash, checkbox, failed: doc?.extraction.status !== 'ok' });
  trash.disabled = running; if (checkbox) checkbox.disabled = running || doc.extraction.status !== 'ok';
}
function remember(entry) {
  const index = entries.findIndex(item => item.url === entry.url);
  if (index < 0) entries.push(entry); else entries[index] = entry;
  if (previewURL === entry.url) clearPreview(); renderRow(entry); invalidateArchive(); updateCounts();
}
function renderEntries() {
  ui.results.replaceChildren(); rows.clear(); controls.clear();
  for (const entry of entries) renderRow(entry);
}
async function restore({ draft = true } = {}) {
  if (resetting) return;
  const saved = await storage.loadWorkspace(projectId); if (resetting) return;
  invalidateArchive(); state = saved; entries = saved.entries;
  if (draft) { ui.urls.value = saved.draft.urls; ui.query.value = saved.draft.query; ui.extractor.value = saved.draft.extractor; if (saved.draft.engine) ui.engine.value = saved.draft.engine; }
  renderEntries();
  const selected = entries.find(entry => entry.url === previewURL)?.doc;
  if (previewURL && selected?.filename !== previewFilename) clearPreview();
  ui.progress.max = Math.max(1, state.batch.total); ui.progress.value = state.batch.processed;
  ui.status.textContent = state.batch.state === 'running' ? 'Saved project restored. An interrupted download can be resumed with Resume downloads. Completed pages will be skipped.' : state.batch.lastStatus;
  updateCounts(); warnURLs(); updateControls();
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
        const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction };
        remember(await storage.saveDocument(projectId, record, doc, response.bytes, { advance: true }));
      } catch (error) {
        if (resetting) return;
        // Storage failures must stop the run, not masquerade as network errors.
        if (downloaded || error.name === 'QuotaExceededError') throw error;
        const message = stopping ? 'Stopped by user' : timedOut ? 'Timed out after 30 seconds' : error.message;
        remember(await storage.saveFailure(projectId, { url, outcome: stopping ? 'cancelled' : 'error', error: message }));
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
      const url = previous?.url || page.url, bytes = new TextEncoder().encode(page.html);
      const index = await storage.allocateFileIndex(projectId);
      const filename = filenameFor(page.url, 'text/html', index).replace(/^pages\//, 'pages/captured/');
      const extraction = extractDocument(bytes, 'text/html; charset=utf-8', { extractor: ui.extractor.value, sourceURL: page.url });
      const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction, captureId: page.id, source: 'browser-tab', capturedAt: page.capturedAt };
      const record = { url, finalURL: page.url, outcome: 'captured', source: 'browser-tab', capturedAt: page.capturedAt, captureId: page.id, filename, contentType: 'text/html; charset=utf-8', bytes: bytes.length };
      remember(await storage.saveDocument(projectId, record, doc, bytes));
      if (!state.batch.startedAt) { state.batch.startedAt = new Date().toISOString(); await storage.saveBatch(projectId, { startedAt: state.batch.startedAt }, await readCollections()); }
      await removeSavedPage(page); count++;
    }
    if (count) ui['saved-status'].textContent = `${count} saved page${count === 1 ? '' : 's'} added to the review list. Review the text before saving your corpus.`;
  });
}
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
for (const [id, key, type] of [['urls', 'urls', 'input'], ['query', 'query', 'input'], ['engine', 'engine', 'change'], ['extractor', 'extractor', 'change']]) {
  ui[id].addEventListener(type, () => { queueDraft({ [key]: ui[id].value }); if (id === 'urls') warnURLs(); });
}
ext.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.captureRevision) importSavedPages(); });
window.addEventListener('focus', async () => {
  if (!ready || running || pendingWrites || refreshing || resetting) return;
  refreshing = true;
  try { await restore(); await importSavedPages(); } catch (error) { report(error); } finally { refreshing = false; }
});
(async () => {
  try {
    await projectUI.ready; projectId = projectUI.snapshot().id;
    await storage.ensureStoredProject(projectId);
    await restore();
    searchUI = initSearchUI({ isRunning: () => running, seenCollectionIds: state.draft.seenCollections, onChange: patch => { queueDraft(patch); warnURLs(); } });
    if (state.draft.engine) ui.engine.value = state.draft.engine;
    ready = true; updateControls(); await importSavedPages();
  } catch (error) { report(error); }
})();

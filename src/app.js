import { extractDownloadedDocument, extractionContentType } from './binary-extraction.js';
import { initProjectUI, projectFilename } from './project-ui.js';
import { readSavedPages, removeSavedPage } from './page-store.js';
import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { parseURLs, filenameFor, fetchFile, FILE_LIMIT, BATCH_LIMIT } from './core.js';
import { makeZIP } from './zip.js';
import { initSearchUI, readCollections } from './search-ui.js';
import { extractDocument } from './extraction.js';
import { corpusFiles, extractionMetadata } from './corpus.js';
import { DEFUDDLE_AVAILABLE } from './defuddle-loader.js';

const VERSION = '0.4.0';
const ui = Object.fromEntries(['urls', 'start', 'stop', 'export', 'status', 'progress', 'results', 'corpus-status', 'preview-title', 'preview-meta', 'preview-text', 'extractor'].map(id => [id, document.getElementById(id)]));
let running = false, stopping = false, controller = null;
let projectResetting = false, previewURL = null, nextCaptureIndex = 0;
let files = [], records = [], documents = [], archiveURL = null, startedAt = null;
const resultRows = new Map(), deleteButtons = new Map();
let batchCollections = [];
let batchExtractor = 'readability';
ui.extractor.querySelector('option[value="defuddle"]').disabled = !DEFUDDLE_AVAILABLE;
if (!DEFUDDLE_AVAILABLE) ui.extractor.querySelector('option[value="defuddle"]').textContent = 'Defuddle — library unavailable';
const searchUI = initSearchUI({ isRunning: () => running });
const projectUI = initProjectUI({
  onRename: invalidateArchive,
  onReset: () => {
    projectResetting = true; stopping = true; controller?.abort();
    running = false; files = []; records = []; documents = []; invalidateArchive();
    ui.urls.value = ''; ui.results.replaceChildren(); clearPreview();
    document.getElementById('query').value = '';
    document.getElementById('project-name').value = 'Untitled project';
    ui.extractor.value = 'readability'; ui.progress.value = 0;
    // Reload every open workspace with empty state and suppress the old unload prompt.
    window.location.reload();
  }
});
window.addEventListener('beforeunload', event => {
  if (running || files.length) { event.preventDefault(); event.returnValue = ''; }
});
function invalidateArchive() {
  if (archiveURL) { URL.revokeObjectURL(archiveURL); archiveURL = null; }
}
function updateCorpusStatus() {
  const extracted = documents.filter(doc => doc.extraction.status === 'ok');
  const included = extracted.filter(doc => doc.extraction.included);
  ui['corpus-status'].textContent = `${included.length} of ${extracted.length} extracted texts included · ${included.reduce((n, doc) => n + doc.extraction.characters, 0).toLocaleString()} characters. Excluded documents remain in the originals folder.`;
}
function clearPreview() {
  previewURL = null;
  ui['preview-title'].textContent = 'Preview text';
  ui['preview-meta'].textContent = 'Click a Preview text button in the review list to display its text here.';
  ui['preview-text'].value = '';
}
function enableDeleteButtons() {
  for (const button of deleteButtons.values()) button.disabled = running;
}
function deleteDocument(url) {
  if (running) return;
  if (!window.confirm('Delete this page and its text completely? Its original files, extracted text and download metadata will be removed from the review list and future exports.')) return;
  const names = new Set();
  function remember(record) {
    if (!record) return;
    if (record.filename) names.add(record.filename);
    remember(record.previousAttempt);
  }
  records.filter(item => item.url === url).forEach(remember);
  documents.filter(item => item.url === url).forEach(doc => names.add(doc.filename));
  files = files.filter(file => !names.has(file.name));
  records = records.filter(item => item.url !== url);
  documents = documents.filter(item => item.url !== url);
  resultRows.get(url)?.remove(); resultRows.delete(url); deleteButtons.delete(url);
  ui.urls.value = ui.urls.value.split(/\r?\n/).filter(line => parseURLs(line).urls[0] !== url).join('\n');
  if (previewURL === url) clearPreview();
  invalidateArchive(); updateCorpusStatus(); ui.export.disabled = !records.length;
  ui.status.textContent = 'Page deleted. It will not be included in future exports.';
}
function preview(doc) {
  const e = doc.extraction;
  previewURL = doc.url;
  ui['preview-meta'].textContent = `${e.title ? e.title + ' · ' : ''}${doc.url} · ${e.extractor || 'Unsupported format'} · ${e.characters.toLocaleString()} characters${e.encoding ? ` · ${e.encoding}` : ''}${e.language ? ` · ${e.language}` : ''}${e.warnings.length ? ` · ${e.warnings.join(' ')}` : ''}`;
  ui['preview-text'].value = e.text || 'No corpus text available. The original download is retained. See the extraction message above.';
}
function row(url, message, doc = null) {
  const tr = document.createElement('tr');
  const selection = document.createElement('td'), source = document.createElement('td'), result = document.createElement('td');
  const link = document.createElement('a');
  link.href = url; link.textContent = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  source.append(link);
  if (!doc) { selection.textContent = '—'; result.textContent = message; tr.className = 'error'; }
  else {
    const e = doc.extraction;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = e.included; checkbox.disabled = e.status !== 'ok';
    checkbox.setAttribute('aria-label', `Include ${e.title || url} in corpus`);
    checkbox.addEventListener('change', () => { e.included = checkbox.checked; invalidateArchive(); updateCorpusStatus(); });
    selection.append(checkbox);
    result.append(document.createTextNode(`${message} · ${e.status === 'ok' ? `${e.characters.toLocaleString()} characters` : e.status === 'unsupported' ? 'Unsupported extraction format' : 'Extraction failed'}`));
    const button = document.createElement('button');
    button.className = 'secondary preview-button'; button.textContent = e.status === 'ok' ? 'Preview text' : 'Details';
    button.addEventListener('click', () => preview(doc)); result.append(button);
    if (e.warnings.length) {
      const warning = document.createElement('p'); warning.className = 'hint'; warning.textContent = e.warnings.join(' '); result.append(warning);
    }
  }
  const actions = document.createElement('td');
  const trash = document.createElement('button');
  trash.type = 'button'; trash.className = 'delete-button'; trash.title = 'Delete page';
  trash.disabled = running;
  trash.setAttribute('aria-label', `Delete ${doc?.extraction.title || url}`);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '2');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');
  icon.append(path); trash.append(icon); trash.addEventListener('click', () => deleteDocument(url));
  actions.append(trash); deleteButtons.set(url, trash);
  tr.append(selection, source, result, actions);
  const previous = resultRows.get(url);
  if (previous) previous.replaceWith(tr); else ui.results.append(tr);
  resultRows.set(url, tr);
}
ui.stop.addEventListener('click', () => {
  stopping = true; controller?.abort(); ui.stop.disabled = true;
  ui.status.textContent = 'Stopping… Completed files and texts will remain available.';
});
ui.start.addEventListener('click', async () => {
  const parsed = parseURLs(ui.urls.value);
  if (parsed.errors.length || !parsed.urls.length) { ui.status.textContent = parsed.errors.join(' · ') || 'Please enter at least one URL.'; return; }
  if (files.length && !window.confirm('Start a new batch? Save your current ZIP first if you want to keep it.')) return;
  ui.start.disabled = true;
  batchExtractor = ui.extractor.value;
  try { batchCollections = await readCollections(); if (projectResetting) return; }
  catch (error) { if (projectResetting) return; ui.start.disabled = false; ui.status.textContent = `Cannot read saved searches: ${error.message}`; return; }
  invalidateArchive();
  running = true; stopping = false; nextCaptureIndex = 0; files = []; records = []; documents = []; startedAt = new Date().toISOString();
  deleteButtons.clear(); resultRows.clear(); ui.results.replaceChildren(); ui.urls.disabled = true; ui.extractor.disabled = true; ui.stop.disabled = false; ui.export.disabled = true;
  clearPreview();
  ui.progress.max = parsed.urls.length; ui.progress.value = 0; updateCorpusStatus();
  let total = 0;
  try {
    for (const [index, url] of parsed.urls.entries()) {
      if (projectResetting) return;
      if (stopping) { records.push({ url, outcome: 'not-attempted' }); continue; }
      ui.status.textContent = `Downloading and extracting ${index + 1} of ${parsed.urls.length}…`;
      controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
      try {
        const response = await fetchFile(url, controller.signal, Math.min(FILE_LIMIT, BATCH_LIMIT - total));
        if (projectResetting) return;
        clearTimeout(timer); // The timeout bounds network I/O, not synchronous parsing.
        const filename = filenameFor(url, extractionContentType(response.bytes, response.contentType), index);
        files.push({ name: filename, data: response.bytes }); total += response.bytes.length;
        records.push({ url, finalURL: response.finalURL, outcome: 'downloaded', httpStatus: response.status, contentType: response.contentType, bytes: response.bytes.length, filename, downloadedAt: new Date().toISOString() });
        const extraction = await extractDownloadedDocument(response.bytes, response.contentType, { extractor: batchExtractor, sourceURL: response.finalURL || url, signal: controller.signal });
        if (projectResetting) return;
        const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction };
        documents.push(doc);
        row(url, `Downloaded · ${(response.bytes.length / 1024).toFixed(1)} KiB`, doc); updateCorpusStatus();
      } catch (error) {
        if (projectResetting) return;
        const message = stopping ? 'Stopped by user' : timedOut ? 'Timed out after 30 seconds' : error.message;
        records.push({ url, outcome: stopping ? 'cancelled' : 'error', error: message });
        const tip = `Could not download this page. Click its URL to open it in a new tab. Complete any CAPTCHA or sign-in, then click the BootCaT toolbar icon → Add page to corpus. The page will appear here automatically. (${message})`;
        row(url, stopping ? message : tip);
      } finally { clearTimeout(timer); controller = null; }
      ui.progress.value = index + 1;
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    if (projectResetting) return;
    running = false; ui.start.disabled = false; ui.urls.disabled = false; ui.extractor.disabled = false; ui.stop.disabled = true; ui.export.disabled = false;
    enableDeleteButtons(); searchUI.flush(); importSavedPages();
    const failed = records.filter(r => r.outcome === 'error').length;
    ui.status.textContent = `${stopping ? 'Stopped' : 'Finished'}. ${files.length} downloaded, ${failed} download errors, ${documents.filter(doc => doc.extraction.status === 'failed').length} extraction failures. Review the corpus selection and save the ZIP.`;
  }
});
ui.export.addEventListener('click', () => {
  try {
    const project = projectUI.snapshot();
    if (!archiveURL) {
      const exportedAt = new Date().toISOString();
      archiveURL = URL.createObjectURL(makeZIP([
        ...files, ...corpusFiles(documents),
        { name: 'project.json', data: JSON.stringify(project, null, 2) },
        { name: 'results.json', data: JSON.stringify({ version: VERSION, project, startedAt, exportedAt, results: records }, null, 2) },
        { name: 'extraction.json', data: JSON.stringify({ version: VERSION, project, exportedAt, documents: extractionMetadata(documents) }, null, 2) },
        { name: 'searches.json', data: JSON.stringify({ version: VERSION, project, collections: batchCollections }, null, 2) }
      ]));
    }
    const link = document.createElement('a');
    link.href = archiveURL; link.download = `${projectFilename(project.name)}-${startedAt.replace(/[:.]/g, '-')}.zip`;
    document.body.append(link); link.click(); link.remove();
  } catch (error) { ui.status.textContent = `Could not create ZIP: ${error.message}`; }
});

// Saved snapshots are a durable inbox until a workspace has imported them.
// Coalesce notifications and defer imports while a download batch is running.
let importingSavedPages = false;
let savedPagesPending = false;
async function importSavedPages() {
  savedPagesPending = true;
  if (projectResetting || running || importingSavedPages) return;
  importingSavedPages = true;
  const status = document.getElementById('saved-status');
  try {
    while (savedPagesPending && !running && !projectResetting) {
      savedPagesPending = false;
      await importPendingPages(status);
    }
  } finally { importingSavedPages = false; }
}
async function importPendingPages(status) {
  // Keep the batch stable across asynchronous inbox reads and acknowledgements.
  running = true; enableDeleteButtons(); ui.start.disabled = true; ui.extractor.disabled = true;
  let imported = 0;
  try {
    const pages = await readSavedPages();
    if (projectResetting || !pages.length) return;
    if (!startedAt) {
      batchCollections = await readCollections();
      if (projectResetting) return;
      startedAt = new Date().toISOString();
    }
    let total = files.reduce((n, file) => n + file.data.length, 0);
    for (const page of pages) {
      if (projectResetting) return;
      if (documents.some(doc => doc.captureId === page.id)) { await removeSavedPage(page); continue; }
      const bytes = new TextEncoder().encode(page.html);
      if (total + bytes.length > BATCH_LIMIT) throw new Error('Batch limit reached (100 MiB). Export this corpus and start a new batch.');
      // Match redirects too, so a snapshot replaces the corresponding downloaded text.
      const index = records.findIndex(record => record.url === page.url || record.finalURL === page.url);
      const previous = index < 0 ? null : records[index];
      const url = previous?.url || page.url;
      const filename = filenameFor(page.url, 'text/html', nextCaptureIndex++).replace(/^pages\//, 'pages/captured/');
      const extraction = extractDocument(bytes, 'text/html; charset=utf-8', { extractor: ui.extractor.value, sourceURL: page.url });
      const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction, captureId: page.id, source: 'browser-tab', capturedAt: page.capturedAt };
      const record = { url, finalURL: page.url, outcome: 'captured', source: 'browser-tab', capturedAt: page.capturedAt, captureId: page.id, filename, contentType: 'text/html; charset=utf-8', bytes: bytes.length };
      if (previous) {
        record.previousAttempt = previous;
        records[index] = record;
      } else records.push(record);
      const oldDocument = documents.findIndex(item => item.url === url);
      if (oldDocument < 0) documents.push(doc); else documents[oldDocument] = doc;
      // Retain previous raw downloads for provenance; only one corpus text per URL.
      files.push({ name: filename, data: bytes }); total += bytes.length;
      invalidateArchive();
      if (previewURL === url) clearPreview();
      row(url, 'Saved from browser tab', doc); updateCorpusStatus(); imported++;
      await removeSavedPage(page);
    }
    if (imported) status.textContent = `${imported} saved page${imported === 1 ? '' : 's'} added to the review list. Review the text before saving your corpus.`;
  } catch (error) { status.textContent = `Could not add all saved pages: ${error.message} Your remaining saved pages are retained. Export and start a new batch if it is full.`; }
  finally {
    if (projectResetting) return;
    running = false; ui.start.disabled = false; ui.extractor.disabled = false;
    ui.export.disabled = !records.length; enableDeleteButtons(); searchUI.flush();
  }
}
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captureRevision) importSavedPages();
});
window.addEventListener('focus', importSavedPages);
projectUI.ready.then(importSavedPages);

import { readSavedPages, clearSavedPages } from './page-store.js';
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
let files = [], records = [], documents = [], archiveURL = null, startedAt = null;
const resultRows = new Map();
let batchCollections = [];
let batchExtractor = 'readability';
ui.extractor.querySelector('option[value="defuddle"]').disabled = !DEFUDDLE_AVAILABLE;
if (!DEFUDDLE_AVAILABLE) ui.extractor.querySelector('option[value="defuddle"]').textContent = 'Defuddle — library unavailable';
initSearchUI({ isRunning: () => running });
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
function preview(doc) {
  const e = doc.extraction;
  ui['preview-title'].textContent = e.title || doc.url;
  ui['preview-meta'].textContent = `${doc.url} · ${e.extractor || 'Unsupported format'} · ${e.characters.toLocaleString()} characters${e.encoding ? ` · ${e.encoding}` : ''}${e.language ? ` · ${e.language}` : ''}${e.warnings.length ? ` · ${e.warnings.join(' ')}` : ''}`;
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
  tr.append(selection, source, result);
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
  try { batchCollections = await readCollections(); }
  catch (error) { ui.start.disabled = false; ui.status.textContent = `Cannot read saved searches: ${error.message}`; return; }
  invalidateArchive();
  running = true; refreshSavedControls(); stopping = false; files = []; records = []; documents = []; startedAt = new Date().toISOString();
  resultRows.clear(); ui.results.replaceChildren(); ui.urls.disabled = true; ui.extractor.disabled = true; ui.stop.disabled = false; ui.export.disabled = true;
  ui['preview-title'].textContent = 'Text preview'; ui['preview-meta'].textContent = 'Choose Preview text beside a downloaded document.'; ui['preview-text'].value = '';
  ui.progress.max = parsed.urls.length; ui.progress.value = 0; updateCorpusStatus();
  let total = 0;
  try {
    for (const [index, url] of parsed.urls.entries()) {
      if (stopping) { records.push({ url, outcome: 'not-attempted' }); continue; }
      ui.status.textContent = `Downloading and extracting ${index + 1} of ${parsed.urls.length}…`;
      controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
      try {
        const response = await fetchFile(url, controller.signal, Math.min(FILE_LIMIT, BATCH_LIMIT - total));
        clearTimeout(timer); // The timeout bounds network I/O, not synchronous parsing.
        const filename = filenameFor(url, response.contentType, index);
        files.push({ name: filename, data: response.bytes }); total += response.bytes.length;
        records.push({ url, finalURL: response.finalURL, outcome: 'downloaded', httpStatus: response.status, contentType: response.contentType, bytes: response.bytes.length, filename, downloadedAt: new Date().toISOString() });
        const extraction = extractDocument(response.bytes, response.contentType, { extractor: batchExtractor, sourceURL: response.finalURL || url });
        const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction };
        documents.push(doc);
        row(url, `Downloaded · ${(response.bytes.length / 1024).toFixed(1)} KiB`, doc); updateCorpusStatus();
        if (documents.length === 1) preview(doc);
      } catch (error) {
        const message = stopping ? 'Stopped by user' : timedOut ? 'Timed out after 30 seconds' : error.message;
        records.push({ url, outcome: stopping ? 'cancelled' : 'error', error: message }); row(url, message);
      } finally { clearTimeout(timer); controller = null; }
      ui.progress.value = index + 1;
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    running = false; ui.start.disabled = false; ui.urls.disabled = false; ui.extractor.disabled = false; ui.stop.disabled = true; ui.export.disabled = false;
    refreshSavedControls();
    const failed = records.filter(r => r.outcome === 'error').length;
    ui.status.textContent = `${stopping ? 'Stopped' : 'Finished'}. ${files.length} downloaded, ${failed} download errors, ${documents.filter(doc => doc.extraction.status === 'failed').length} extraction failures. Review the corpus selection and save the ZIP.`;
  }
});
ui.export.addEventListener('click', () => {
  try {
    if (!archiveURL) {
      const exportedAt = new Date().toISOString();
      archiveURL = URL.createObjectURL(makeZIP([
        ...files, ...corpusFiles(documents),
        { name: 'results.json', data: JSON.stringify({ version: VERSION, startedAt, exportedAt, results: records }, null, 2) },
        { name: 'extraction.json', data: JSON.stringify({ version: VERSION, exportedAt, documents: extractionMetadata(documents) }, null, 2) },
        { name: 'searches.json', data: JSON.stringify({ version: VERSION, collections: batchCollections }, null, 2) }
      ]));
    }
    const link = document.createElement('a');
    link.href = archiveURL; link.download = `bootcat-corpus-${startedAt.replace(/[:.]/g, '-')}.zip`;
    document.body.append(link); link.click(); link.remove();
  } catch (error) { ui.status.textContent = `Could not create ZIP: ${error.message}`; }
});

const savedUI = {
  add: document.getElementById('add-saved'), clear: document.getElementById('clear-saved'),
  status: document.getElementById('saved-status')
};
let savedCount = 0;
function refreshSavedControls() {
  savedUI.add.disabled = running || !savedCount;
  savedUI.clear.disabled = running || !savedCount;
}
async function refreshSavedPages() {
  try {
    savedCount = (await readSavedPages()).length;
    savedUI.status.textContent = `${savedCount} saved page${savedCount === 1 ? '' : 's'} available. Import to review and extract text; clear only after exporting.`;
    refreshSavedControls();
  } catch (error) { savedUI.status.textContent = `Cannot read saved pages: ${error.message}`; }
}
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captureRevision) refreshSavedPages();
});
window.addEventListener('focus', refreshSavedPages);
savedUI.clear.addEventListener('click', async () => {
  if (running || !window.confirm('Clear saved page snapshots? Export your corpus first. Pages already imported in this workspace will remain until you close it or start a new batch.')) return;
  try {
    await clearSavedPages();
    try { await ext.storage.local.set({ captureRevision: crypto.randomUUID() }); } catch {}
    await refreshSavedPages();
  } catch (error) { savedUI.status.textContent = error.message; }
});
savedUI.add.addEventListener('click', async () => {
  if (running) return;
  running = true; refreshSavedControls(); ui.start.disabled = true; ui.extractor.disabled = true;
  let imported = 0;
  try {
    const pages = await readSavedPages();
    if (!startedAt) {
      batchCollections = await readCollections();
      startedAt = new Date().toISOString();
    }
    let total = files.reduce((n, file) => n + file.data.length, 0);
    for (const page of pages) {
      if (documents.some(doc => doc.captureId === page.id)) continue;
      const bytes = new TextEncoder().encode(page.html);
      if (total + bytes.length > BATCH_LIMIT) throw new Error('Batch limit reached (100 MiB). Export this corpus and start a new batch.');
      // Match redirects too, so a snapshot replaces the corresponding downloaded text.
      const index = records.findIndex(record => record.url === page.url || record.finalURL === page.url);
      const previous = index < 0 ? null : records[index];
      const url = previous?.url || page.url;
      const filename = filenameFor(page.url, 'text/html', files.length).replace(/\.html$/, '.captured.html');
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
      row(url, 'Saved from browser tab', doc); updateCorpusStatus(); preview(doc); imported++;
    }
    ui.status.textContent = `${imported} saved page${imported === 1 ? '' : 's'} added. Review the text before saving your corpus.`;
  } catch (error) { ui.status.textContent = `${imported} saved pages added. ${error.message}`; }
  finally {
    running = false; ui.start.disabled = false; ui.extractor.disabled = false;
    ui.export.disabled = !files.length; refreshSavedControls();
  }
});
refreshSavedPages();

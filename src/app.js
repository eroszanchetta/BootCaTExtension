import { hasDocumentWarning, hasLengthWarning, lengthMessage } from './corpus-options.js';
import { createManualIndicator, updateManualIndicator } from './manual-intervention.js';
import { bindImportFileDrop, guardFileDropNavigation } from './import-file-drop.js';
import { initRecoveryFeedback, recoveryOutcome, preserveRecoveryInclusion } from './recovery-feedback.js';
import { initDownloadFeedbackUI } from './download-feedback-ui.js';
import { initEngineDefaultUI } from './engine-default-ui.js';
import { initPortableUI } from './portable-ui.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY, readSettings, fileLimit } from './settings.js';
import { createProjectWork, createExtractionQueue } from './project-work.js';
import { initTextReview } from './text-review.js';
import { corpusFingerprint, corpusSavedMessage } from './export-state.js';
import { checkLanguage, hasLanguageWarning, languageMessage } from './language-detection.js';
import { confirmAction } from './dialogs.js';
import { initWorkspaceSections, openWorkspaceSection, setProjectSectionState } from './workspace-sections.js';
import { extractDownloadedDocument, extractionContentType } from './binary-extraction.js';
import { fileWarnings, readPDFFile } from './pdf-recovery.js';
import { formatByMIME, readImportedDocument } from './document-formats.js';
import { initProjectUI, projectFilename } from './project-ui.js';
import { listSavedPages, readSavedPage, removeSavedPage } from './page-store.js';
import * as storage from './project-store.js';
import { getExtensionAPI } from './extension-api.js';
import { parseURLs, filenameFor, fetchFile, urlListWarning } from './core.js';
import { makeStoredZIP } from './zip-blob.js';
import { createExportLayout, originalTextFilename } from './export-layout.js';
import { makeMetadataWorkbook, corpusURLList, excludedURLList } from './metadata-xlsx.js';
import { initVersionBadge } from './version.js';
import { initSearchUI, readCollections } from './search-ui.js';
import { initSeedsUI } from './seeds-ui.js';
import { initProjectTabsUI } from './project-tabs-ui.js';
import { extractDocument } from './extraction.js';
import { extractionMetadata } from './corpus.js';

initWorkspaceSections();
const ext = getExtensionAPI(), VERSION = initVersionBadge();
const ui = Object.fromEntries(['urls', 'start', 'stop', 'export', 'status', 'progress', 'results', 'problem-results', 'attention-section', 'attention-count', 'project-language', 'recheck-language', 'language-status', 'corpus-status', 'urls-warning', 'saved-status', 'engine', 'import-document-picker', 'document-import-status', 'export-status'].map(id => [id, document.getElementById(id)]));
let currentSettings = DEFAULT_SETTINGS;
async function loadSettings() { currentSettings = await readSettings(ext.storage.local); warnURLs(); updateLimitHints(); seedsUI?.setMinimumSeeds?.(currentSettings.minimumSeeds); return currentSettings; }
function updateLimitHints() {
  const hint = document.getElementById('download-limit-hint');
  hint.textContent = `Maximum file size: ${currentSettings.fileMiB} MiB.`;
}
let portableBusy = false, portableUI;
let ready = false, running = false, downloading = false, importing = false, stopping = false, resetting = false, controller = null;
let projectId, state, entries = [], searchUI, seedsUI, projectTabsUI, archiveURL = null, previewURL = null, previewFilename = null, textReview;
let exportSaved = false, exportRevision = 0, exportHighlightTimer;
let writes = Promise.resolve(), pendingWrites = 0, writeError = null, capturesPending = false, refreshing = false;
let pickingDocument = false, documentImportTarget = null, documentImportStatus = { url: null, message: '' };
const documentImportMessages = new Map(), pendingResolutions = new Map();
const rows = new Map(), controls = new Map(), documentJobs = new Map(), inclusionJobs = new Set(), operationControllers = new Set();
const coordinator = createProjectWork({ locks: navigator.locks, getProjectId: () => projectId });
const extractionQueue = createExtractionQueue(navigator.locks);
let metadataRevision = 0, captureSignal = 0;
let remoteActivity = { batch: false, exclusive: false, documents: new Set() }, activityTimer, activityRefreshing = false, metadataRefreshing = false;
const isDocumentBusy = url => portableBusy || running || remoteActivity.exclusive || documentJobs.has(url) || remoteActivity.documents.has(url);
const isBatchActive = () => downloading || remoteActivity.batch;
const hasDocumentWork = () => documentJobs.size > 0 || remoteActivity.documents.size > 0;

ui.start.disabled = ui.export.disabled = true;
let engineDefaultUI, downloadFeedbackUI, recoveryFeedback, removeFileDropGuard;
const projectUI = initProjectUI({
  onRename: () => { invalidateArchive(); seedsUI?.refreshLanguage?.(); },
  onSaveProject: () => portableUI.save(), onOpenProject: () => portableUI.choose(),
  getBusy: () => portableBusy || running || isBatchActive() || importing || hasDocumentWork() || remoteActivity.exclusive,
  confirmReplacement: options => portableUI.confirmReplacement(options),
  onReset: () => {
    resetting = true; ready = false; stopping = true; clearTimeout(activityTimer); controller?.abort(); for (const active of operationControllers) active.abort(); seedsUI?.destroy(); searchUI?.destroy(); projectTabsUI?.destroy(); engineDefaultUI?.destroy(); downloadFeedbackUI?.destroy(); recoveryFeedback?.destroy(); removeFileDropGuard?.(); documentImportMessages.clear(); pendingResolutions.clear(); running = downloading = importing = false; updateControls();
    invalidateArchive(); ui.urls.value = ''; clearPreview();
    document.getElementById('project-name').value = '';
    entries = []; state = null; documentImportTarget = null; ui['import-document-picker'].value = '';
    renderEntries();
    window.location.reload();
  }
});
textReview = initTextReview({ root: document, confirm: confirmAction, run: (task, { url }) => documentWork(url, task),
  getSettings: () => readSettings(ext.storage.local), getProjectId: () => projectId, getLanguage: () => projectUI.snapshot()?.language || 'none', isRunning: url => isDocumentBusy(url),
  onSaved: (entry, { recovered = false } = {}) => {
    remember(entry, { keepPreview: true });
    if (recovered && needsAttention(entry)) {
      documentImportMessage(entry.url, hasLengthWarning(entry.doc.extraction) ? 'Text saved · length review needed' : 'Text saved · language review needed', 'warning');
      recoveryFeedback?.show({url:entry.url,tone:'warning'});
    }
  },
  onSelect: doc => { previewURL = doc?.url || null; previewFilename = doc?.filename || null; updatePreviewSelection(); },
  onClosed: url => {
    rows.get(url)?.querySelector('.preview-button')?.focus();
    if (capturesPending && !resetting && !running) { capturesPending = false; queueMicrotask(importSavedPages); }
  }
});
window.addEventListener('beforeunload', event => {
  if (!resetting && (portableBusy || running || downloading || importing || documentJobs.size || seedsUI?.isBusy() || pendingWrites || textReview?.isDirty() || projectUI.isSaving?.())) { event.preventDefault(); event.returnValue = ''; }
});
function revokeArchive() {
  if (archiveURL) { URL.revokeObjectURL(archiveURL); archiveURL = null; }
}
function invalidateArchive() {
  portableUI?.refresh?.();
  exportRevision++; revokeArchive();
  if (exportSaved) ui['export-status'].textContent = 'Project changed. Export your corpus again to download an updated ZIP.';
  exportSaved = false; ui['export-status'].classList.toggle('saved', false);
  document.getElementById('export-label').textContent = 'Export Corpus';
  ui.export.disabled = !ready || running || isBatchActive() || importing || hasDocumentWork() || remoteActivity.exclusive || exportSaved || !entries.length;
  renderExportGuidance();
}
async function refreshExportState(saved) {
  const revision = exportRevision, id = projectId;
  const fingerprint = await corpusFingerprint(saved, projectUI.snapshot(), await readCollections());
  if (resetting || id !== projectId || revision !== exportRevision) return;
  exportSaved = saved.corpusExport?.fingerprint === fingerprint && saved.corpusExport.filename === `Corpus ${projectFilename(projectUI.snapshot().name)}.zip`;
  ui['export-status'].textContent = exportSaved ? corpusSavedMessage(saved.corpusExport.filename) : 'Export your corpus as a ZIP file to your computer.';
  ui['export-status'].classList.toggle('saved', exportSaved);
  document.getElementById('export-label').textContent = exportSaved ? 'Corpus exported' : 'Export Corpus';
  renderExportGuidance();
}
function report(error) {
  if (resetting) return;
  const full = error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '');
  ui.status.textContent = full ? 'Browser storage is full. Completed pages remain saved. Export your corpus and free space before continuing.' : `Could not complete the operation: ${error.message}`;
}
function warnURLs() { const count = parseURLs(ui.urls.value).urls.length; document.getElementById('urls-counter').textContent = `${count.toLocaleString()} URL${count === 1 ? '' : 's'}`; ui['urls-warning'].textContent = urlListWarning(count, currentSettings.urlWarning); }
function revealAddedURLs(previous, next) {
  if (!ready) return;
  const existing = new Set(parseURLs(previous).urls);
  if (parseURLs(next).urls.some(url => !existing.has(url))) openWorkspaceSection('urls-section');
}
function revealAddedDocument(previous, next) {
  if (ready && !previous?.doc && next.doc) openWorkspaceSection('review-section');
}
function queueDraft(patch) {
  if (!ready || resetting) return writes;
  if (Object.hasOwn(patch, 'urls')) revealAddedURLs(state.draft.urls, patch.urls);
  invalidateArchive(); Object.assign(state.draft, patch); pendingWrites++;
  if (Object.hasOwn(patch, 'urls')) updateControls();
  writes = writes.then(() => storage.saveDraft(projectId, patch)).then(() => { writeError = null; }, error => { writeError = error; report(error); }).finally(() => { pendingWrites--; renderExportGuidance(); portableUI?.refresh?.(); });
  return writes;
}
async function flushWrites() { await writes; if (writeError) throw writeError; }
function pendingURLs() {
  const complete = new Set(entries.filter(entry => ['downloaded', 'captured'].includes(entry.record.outcome) && (entry.doc?.editRevision > 0 || !entry.record.processingIncomplete)).map(entry => entry.url));
  return parseURLs(ui.urls.value).urls.filter(url => !complete.has(url));
}
function updateControls() {
  projectUI.refreshControls?.();
  if (portableUI?.isSaved?.()) document.getElementById('save-project').disabled = true;
  renderExportGuidance();
  ui.progress.hidden = !isBatchActive();
  const batch = isBatchActive(), exclusive = running || remoteActivity.exclusive || portableBusy;
  const idle = ready && !exclusive && !batch && !importing && !hasDocumentWork();
  const pending = idle ? pendingURLs().length : 0;
  ui.start.disabled = !idle || !pending;
  const parsed = idle ? parseURLs(ui.urls.value) : null;
  if (!inclusionJobs.size) document.getElementById('download-readiness').textContent = !idle ? '' : parsed.errors.length ? parsed.errors[0] : pending ? '' : parsed.urls.length ? 'All listed URLs have been downloaded. Add more URLs to download additional documents.' : 'Add URLs in the URLs section to start building your corpus.';
  ui.export.disabled = !ready || exclusive || batch || importing || hasDocumentWork() || exportSaved || !entries.length;
  ui.urls.disabled = !ready || exclusive || batch;
  ui['project-language'].disabled = !ready || exclusive || batch || hasDocumentWork();
  ui['recheck-language'].disabled = !ready || exclusive || batch || hasDocumentWork() || !entries.some(entry => entry.doc?.extraction.status === 'ok');
  ui.start.textContent = !exclusive && !batch && ready && ['running', 'stopped'].includes(state.batch.state) && pending ? 'Resume downloads' : 'Download URLs';
  textReview?.refreshControls();
  for (const [url, items] of controls) {
    const busy = !ready || isDocumentBusy(url);
    items.activity.textContent = busy && !inclusionJobs.has(url) ? 'Processing this document…' : '';
    items.trash.disabled = busy;
    if (items.importDocument) items.importDocument.disabled = busy;
    if (items.acceptLanguage) items.acceptLanguage.disabled = busy;
    if (items.checkbox) items.checkbox.disabled = busy || items.failed;
  }
  const activity = document.getElementById('download-activity');
  activity.textContent = remoteActivity.batch && !downloading ? 'Downloads are running in another BootCaT window. You can work on completed documents here.' : '';
}
const needsAttention = entry => !entry.doc || entry.doc.extraction.status !== 'ok' || hasDocumentWarning(entry.doc.extraction);
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
  if (!problems) ui['attention-section'].open = false;
  ui['attention-count'].textContent = `${problems.toLocaleString()} document${problems === 1 ? '' : 's'}`;
  const listed = entries.filter(entry => !needsAttention(entry));
  document.getElementById('documents-count').textContent = `${listed.length.toLocaleString()} document${listed.length === 1 ? '' : 's'}`;
  const documents = entries.filter(entry => entry.doc?.extraction.status === 'ok');
  const included = documents.filter(entry => entry.doc.extraction.included);
  document.getElementById('included-count').textContent = `${included.length.toLocaleString()} included`;
  document.getElementById('build-counter').textContent = `${included.length.toLocaleString()} included`;
  ui['corpus-status'].textContent = included.length ? `${included.reduce((sum, entry) => sum + entry.doc.extraction.characters, 0).toLocaleString()} characters included.` : '';
  renderExportGuidance();
  if (!isBatchActive() && /^(Finished|Stopped)\./.test(ui.status.textContent)) ui.status.textContent = completionMessage(ui.status.textContent.startsWith('Stopped'));
}
function renderExportGuidance() {
  downloadFeedbackUI?.refresh?.();
  const banner = document.getElementById('export-guidance');
  const busy = !ready || resetting || running || isBatchActive() || importing || hasDocumentWork() || remoteActivity.exclusive || portableBusy || pendingWrites || capturesPending || writeError;
  if (busy) {
    // A brief inclusion save does not change the corpus's readiness until committed.
    const inclusionOnly = inclusionJobs.size && ready && !resetting && !running && !isBatchActive() && !importing && !remoteActivity.exclusive && !portableBusy && !pendingWrites && !capturesPending && !writeError && [...documentJobs.keys(), ...remoteActivity.documents].every(url => inclusionJobs.has(url));
    if (!inclusionOnly) banner.hidden = true;
    return;
  }
  const included = entries.filter(entry => !needsAttention(entry) && entry.doc.extraction.included).length;
  banner.hidden = !included;
  if (!included) return;
  document.getElementById('export-guidance-title').textContent = exportSaved ? 'Your corpus download has started.' : 'Your corpus is ready to export.';
  document.getElementById('export-guidance-detail').textContent = exportSaved ? 'Check your browser’s downloads for the corpus ZIP file.' : `${included.toLocaleString()} document${included === 1 ? ' is' : 's are'} included.`;
  document.getElementById('export-guidance-issues').hidden = exportSaved || !entries.some(needsAttention);
  document.getElementById('go-to-export').hidden = exportSaved;
}
function goToExport() {
  if (document.getElementById('export-guidance').hidden || ui.export.disabled) return;
  openWorkspaceSection('project-section');
  ui.export.scrollIntoView({ block: 'center' });
  ui.export.focus({ preventScroll: true });
  ui.export.classList.toggle('export-highlight', true);
  clearTimeout(exportHighlightTimer);
  exportHighlightTimer = setTimeout(() => ui.export.classList.toggle('export-highlight', false), 2000);
}
document.getElementById('go-to-export').addEventListener('click', event => { event.preventDefault(); goToExport(); });

function completionMessage(stopped) {
  return stopped ? 'Stopped. You can resume downloads.' : 'Finished.';
}
function clearPreview() { textReview?.clear(); }
async function preview(doc) { await textReview.open(doc.url); }
function errorTip(record) {
  if (record.errorCode === 'DOWNLOAD_TOO_LARGE') return record.error;
  if (record.outcome === 'cancelled') return 'Stopped by user. Click Resume downloads to try again.';
  return 'Could not download page. Open it manually, then use “Add this page to corpus” in the BootCaT popup, or download the file and choose “Import downloaded file”.';
}
function renderRow(entry) {
  const { url, record, doc } = entry;
  const tr = document.createElement('tr');
  const manualIndicator = createManualIndicator(entry), manualSlot = document.createElement('span');
  manualSlot.className = 'manual-indicator-space'; manualSlot.append(manualIndicator);
  const selection = document.createElement('td'), source = document.createElement('td'), result = document.createElement('td'), actions = document.createElement('td');
  const link = document.createElement('a'); link.href = url; link.textContent = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; source.append(link, manualSlot);
  let checkbox;
  if (!doc) {
    selection.textContent = '—'; result.textContent = errorTip(record); tr.className = 'error';
    const details = document.createElement('details'); details.className = 'download-error-details';
    const summary = document.createElement('summary'); summary.textContent = 'Details';
    const reason = document.createElement('p'); reason.textContent = record.error || (record.httpStatus ? `HTTP ${record.httpStatus}` : 'Download interrupted');
    details.append(summary, reason); result.append(details);
  }
  else {
    const e = doc.extraction;
    checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = entries.find(entry => entry.url === url)?.doc?.extraction.included || false;
    checkbox.setAttribute('aria-label', `Include ${e.title || url} in corpus`);
    checkbox.addEventListener('change', async () => {
      const value = checkbox.checked, hadFocus = document.activeElement === checkbox;
      await documentWork(url, async () => {
        await storage.setIncluded(projectId, url, value);
        const latest = await storage.readDownloadTarget(projectId, url);
        if (latest.entry) remember(latest.entry, { keepPreview: true, updateRow: false });
      }, { inclusion: true });
      checkbox.checked = entries.find(entry => entry.url === url)?.doc?.extraction.included || false;
      if (hadFocus && document.activeElement === document.body) checkbox.focus({ preventScroll: true });
    });
    selection.append(checkbox);
    const origin = record.source === 'local-file' ? `Imported ${formatByMIME(record.contentType)?.label || 'document'}` : record.source === 'browser-session' ? 'PDF saved using browser session' : record.outcome === 'captured' ? 'Saved from browser tab' : 'Downloaded';
    result.append(document.createTextNode(`${origin}${e.recovery ? ' · Manually recovered' : ''} · ${e.status === 'ok' ? `${e.characters.toLocaleString()} characters` : e.status === 'unsupported' ? 'Unsupported extraction format' : 'Extraction failed'}`));
    const button = document.createElement('button'); button.className = 'secondary preview-button'; button.textContent = e.status === 'ok' ? 'Preview text' : 'Details';
    button.addEventListener('click', () => preview(doc)); result.append(button);
    const warnings = fileWarnings(e);
    const lengthStatus = lengthMessage(e);
    if (lengthStatus) { const hint = document.createElement('p'); hint.className = 'hint length-status'; hint.textContent = lengthStatus; result.append(hint); }
    const languageStatus = languageMessage(e);
    if (languageStatus) { const languageHint = document.createElement('p'); languageHint.className = 'hint'; languageHint.textContent = languageStatus; result.append(languageHint); }
    if (warnings.length) { const warning = document.createElement('p'); warning.className = 'hint'; warning.textContent = warnings.join(' '); result.append(warning); }
  }
  let acceptLanguage;
  if (doc && hasDocumentWarning(doc.extraction)) {
    acceptLanguage = document.createElement('button'); acceptLanguage.type = 'button'; acceptLanguage.className = 'secondary accept-language'; acceptLanguage.textContent = 'Include anyway';
    acceptLanguage.addEventListener('click', async () => {
      const hadFocus = document.activeElement === acceptLanguage;
      await documentWork(url, async () => {
        const current = (await storage.loadWorkspace(projectId)).entries.find(entry => entry.url === url);
        if (!current?.doc || current.doc.extraction.status !== 'ok') return;
        const label = hasLengthWarning(current.doc.extraction) ? (hasLanguageWarning(current.doc.extraction) ? 'Review warnings accepted' : 'Length warning accepted') : 'Language warning accepted';
        remember(await storage.acceptDocumentIssues(projectId, url), { resolution: label }); updateControls();
      });
      if (hadFocus && document.activeElement === document.body) rows.get(url)?.querySelector('.preview-button')?.focus({preventScroll:true});
    });
    acceptLanguage.disabled = isDocumentBusy(url); result.append(acceptLanguage);
  }
  // A failed request cannot establish the format: inspect only selected file bytes.
  let importDocument, importFeedback;
  if (!doc && record.outcome === 'error' && record.errorCode !== 'DOWNLOAD_TOO_LARGE') {
    importDocument = document.createElement('button'); importDocument.type = 'button'; importDocument.className = 'secondary import-document-button'; importDocument.textContent = 'Import downloaded file';
    const importTarget = { url, finalURL: record.finalURL || url, projectId };
    const canImport = () => !resetting && !pickingDocument && importTarget.projectId === projectId && !isDocumentBusy(url) && controls.get(url)?.importDocument === importDocument;
    importDocument.addEventListener('click', () => {
      if (!canImport()) return;
      recoveryFeedback?.begin();
      documentImportTarget = { ...importTarget };
      pickingDocument = true;
      documentImportMessage(url, `Choose the file downloaded for this URL (up to ${currentSettings.fileMiB} MiB).`);
      // Keep the input outside the table: focus/storage updates may rebuild rows
      // while the native file chooser is open, before its change event arrives.
      ui['import-document-picker'].accept = '';
      ui['import-document-picker'].value = ''; ui['import-document-picker'].click();
    });
    const dropHint = document.createElement('span'); dropHint.className = 'file-drop-hint'; dropHint.textContent = 'or drop here';
    dropHint.id = 'import-file-hint-' + encodeURIComponent(url); importDocument.setAttribute('aria-describedby', dropHint.id);
    bindImportFileDrop({ button: importDocument, canImport, onFile: file => importRecoveryFile(importTarget, file), onError: (message, tone = 'error') => {
      if (resetting || importTarget.projectId !== projectId || controls.get(url)?.importDocument !== importDocument) return;
      recoveryFeedback?.begin(); documentImportMessage(url, message, tone);
    } });
    source.append(importDocument, dropHint);
  }
  if (importDocument || documentImportMessages.has(url)) {
    importFeedback = document.createElement('p'); importFeedback.className = 'hint document-import-feedback';
    const message = documentImportMessages.get(url);
    importFeedback.textContent = message?.message || ''; importFeedback.setAttribute('data-state', message?.tone || 'hint');
    source.append(importFeedback);
  }
  const trash = document.createElement('button'); trash.type = 'button'; trash.className = 'delete-button'; trash.title = 'Delete page'; trash.setAttribute('aria-label', `Delete ${doc?.extraction.title || url}`);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' })) icon.setAttribute(name, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'); icon.append(path); trash.append(icon);
  trash.addEventListener('click', () => documentWork(url, async () => {
    if (!await confirmAction({ title: 'Delete document?', message: 'This removes the document and its text from the project.', confirmLabel: 'Delete document', destructive: true })) return;
    ui.urls.value = ui.urls.value.split(/\r?\n/).filter(line => parseURLs(line).urls[0] !== url).join('\n');
    await queueDraft({ urls: ui.urls.value }); await flushWrites(); await storage.removeDocument(projectId, url);
    metadataRevision++; documentImportMessages.delete(url); pendingResolutions.delete(url); recoveryFeedback?.forget(url);
    if (documentImportStatus.url === url) document.getElementById('document-import-feedback').hidden = true;
    entries = entries.filter(item => item.url !== url); rows.get(url)?.remove(); rows.delete(url); controls.delete(url);
    ui.urls.value = ui.urls.value.split(/\r?\n/).filter(line => parseURLs(line).urls[0] !== url).join('\n');
    state.draft.urls = ui.urls.value;
    if (previewURL === url) clearPreview(); invalidateArchive(); updateCounts(); warnURLs();
    ui['saved-status'].textContent = 'Page deleted from the saved project and future exports.';
  }));
  actions.append(trash); tr.append(selection, source, result, actions);
  const target = needsAttention(entry) ? ui['problem-results'] : ui.results;
  tr.setAttribute('data-document-position', entry.listPosition);
  const old = rows.get(url);
  if (old?.parentNode === target) old.replaceWith(tr);
  else {
    old?.remove();
    const next = [...target.children].find(row => Number(row.getAttribute('data-document-position')) > entry.listPosition);
    target.insertBefore(tr, next || null);
  }
  const activity = document.createElement('p'); activity.className = 'hint document-activity'; activity.setAttribute('role', 'status'); result.append(activity);
  rows.set(url, tr); recoveryFeedback?.apply(tr, url); markPreviewRow(url, tr); controls.set(url, { manualIndicator, activity, trash, checkbox, acceptLanguage, importDocument, importFeedback, failed: doc?.extraction.status !== 'ok' || hasDocumentWarning(doc?.extraction) });
  if (importDocument) importDocument.disabled = isDocumentBusy(url);
  trash.disabled = isDocumentBusy(url); if (checkbox) checkbox.disabled = isDocumentBusy(url) || doc.extraction.status !== 'ok' || hasDocumentWarning(doc.extraction);
}
function documentImportMessage(url, message, tone = 'hint') {
  documentImportStatus = { url, message, tone }; documentImportMessages.set(url, documentImportStatus);
  const banner = document.getElementById('document-import-feedback'); banner.hidden = false; banner.setAttribute('data-state', tone);
  ui['document-import-status'].textContent = message;
  const control = controls.get(url);
  if (control && !control.importFeedback) {
    const hint = document.createElement('p'); hint.className = 'hint document-import-feedback';
    rows.get(url)?.children[1]?.append(hint); control.importFeedback = hint;
  }
  const feedback = control?.importFeedback;
  if (feedback) { feedback.textContent = message; feedback.setAttribute('data-state', tone); }
}
ui['import-document-picker'].addEventListener('cancel', () => {
  pickingDocument = false; recoveryFeedback?.begin();
  if (documentImportTarget) documentImportMessage(documentImportTarget.url, 'File selection cancelled.');
  documentImportTarget = null;
});
ui['import-document-picker'].addEventListener('change', async () => {
  const target = documentImportTarget, file = ui['import-document-picker'].files?.[0];
  pickingDocument = false;
  try { await importRecoveryFile(target, file); }
  finally { if (documentImportTarget === target) { documentImportTarget = null; ui['import-document-picker'].value = ''; } }
});
// Picker selections and dropped Files share validation, locking and feedback.
async function importRecoveryFile(target, file) {
  if (!target || !file || resetting || target.projectId !== projectId) return;
  recoveryFeedback?.begin();
  let started = false;
  await documentWork(target.url, async () => {
    started = true;
    try {
      const settings = await readSettings(ext.storage.local);
      ui['saved-status'].textContent = '';
      documentImportMessage(target.url, `Importing file… Reading and extracting text may take up to ${settings.extractionSeconds} seconds.`);
      await flushWrites();
      const { bytes, format } = await readImportedDocument(file, fileLimit(settings));
      const entry = await storeCapture({ ...target, settings, bytes, contentType: format.mime, source: 'local-file', capturedAt: new Date().toISOString() });
      if (resetting) return;
      const outcome = recoveryOutcome(entry, format.label);
      documentImportMessage(target.url, outcome.message, outcome.tone);
      recoveryFeedback?.show({ url: target.url, tone: outcome.tone });
    } catch (error) {
      if (resetting) return;
      documentImportMessage(target.url, `File not imported: ${error.message}`, 'error');
      recoveryFeedback?.show({ url: target.url, tone: 'error' });
    }
  }, { wait: true });
  if (!started && !resetting) documentImportMessage(target.url, 'File not imported: another operation is running. Choose the file again when it finishes.', 'warning');
}
function remember(entry, { keepPreview = false, updateRow = true, feedback = true, resolution } = {}) {
  metadataRevision++;
  const index = entries.findIndex(item => item.url === entry.url);
  const previous = entries[index];
  if (feedback && previous && needsAttention(previous) && !needsAttention(entry)) {
    const message = resolution || (!previous.doc ? 'Download recovered' : hasLengthWarning(previous.doc.extraction) ? 'Length review cleared' : previous.doc.extraction.status !== 'ok' ? 'Text recovered' : entry.doc.extraction.languageCheck?.outcome === 'disabled' ? 'Language review cleared' : 'Language check passed');
    pendingResolutions.set(entry.url, message);
  }
  revealAddedDocument(previous, entry);
  if (index < 0) entries.push(entry); else entries[index] = entry;
  entries.sort((a, b) => a.listPosition - b.listPosition);
  if (previewURL === entry.url && !keepPreview && !textReview?.isDirty()) clearPreview(); if (updateRow) renderRow(entry); else updateManualIndicator(controls.get(entry.url)?.manualIndicator, entry); invalidateArchive(); updateCounts();
}
function flushResolutions() {
  if (resetting || running || downloading || importing || !pendingResolutions.size) return;
  const items = [...pendingResolutions].filter(([url]) => { const entry = entries.find(item => item.url === url); return entry && !needsAttention(entry); });
  pendingResolutions.clear(); if (!items.length) return;
  const [url, message] = items[0];
  const same = items.every(([, value]) => value === message);
  documentImportMessage(url, items.length === 1 ? message : same ? `${message} (${items.length} documents)` : `${items.length} issues resolved`, 'success');
  recoveryFeedback?.show({url, urls:items.map(([url])=>url), tone:'success'});
}
function renderEntries() {
  ui.results.replaceChildren(); ui['problem-results'].replaceChildren(); rows.clear(); controls.clear();
  for (const entry of entries) renderRow(entry);
}
async function restore({ draft = true } = {}) {
  if (resetting) return;
  const saved = await storage.loadWorkspace(projectId); if (resetting) return;
  if (ready) {
    revealAddedURLs(state.draft.urls, saved.draft.urls);
    const previous = new Map(entries.map(entry => [entry.url, entry]));
    for (const entry of saved.entries) revealAddedDocument(previous.get(entry.url), entry);
  }
  revokeArchive(); state = saved; entries = saved.entries;
  if (draft) { ui.urls.value = saved.draft.urls; if (saved.draft.engine) ui.engine.value = saved.draft.engine; seedsUI?.restore(saved.draft); engineDefaultUI?.refreshSelection(); }
  renderEntries();
  const selected = entries.find(entry => entry.url === previewURL)?.doc;
  if (previewURL && selected?.filename !== previewFilename) clearPreview();
  ui.progress.max = Math.max(1, state.batch.total); ui.progress.value = state.batch.processed;
  ui.status.textContent = state.batch.state === 'running' ? 'Saved project restored. An interrupted download can be resumed with Resume downloads. Completed pages will be skipped.' : state.batch.state === 'idle' ? '' : state.batch.lastStatus;
  await refreshExportState(saved);
  updateCounts(); warnURLs(); updateControls();
  projectTabsUI?.refresh(); portableUI?.refresh?.();
}
async function notifyWorkspace() {
  if (resetting || !ext.storage.local?.set) return;
  try { await ext.storage.local.set({ workspaceRevision: { projectId, revision: crypto.randomUUID() } }); } catch {}
}
async function applyProjectOptionsFeedback() {
  const saved = await storage.loadWorkspace(projectId);
  if (resetting) return;
  for (const key of ['extractor', 'minimumCharacters', 'maximumCharacters', 'optionsRevision']) state.draft[key] = saved.draft[key];
  for (const entry of saved.entries) remember(entry);
  flushResolutions(); updateControls(); await refreshActivity();
}
async function refreshMetadata() {
  if (!ready || resetting || metadataRefreshing) return;
  metadataRefreshing = true; const revision = metadataRevision;
  try {
    const saved = await storage.loadWorkspace(projectId); if (resetting || revision !== metadataRevision) return;
    let changed = false;
    const previous = new Map(entries.map(entry => [entry.url, entry]));
    for (const entry of saved.entries) {
      revealAddedDocument(previous.get(entry.url), entry);
      if (JSON.stringify(previous.get(entry.url)) !== JSON.stringify(entry)) { if (!inclusionJobs.has(entry.url)) renderRow(entry); changed = true; }
      previous.delete(entry.url);
    }
    for (const url of previous.keys()) { rows.get(url)?.remove(); rows.delete(url); controls.delete(url); changed = true; }
    entries = saved.entries; state.batch = saved.batch; state.deleteRevision = saved.deleteRevision;
    if (!pendingWrites) { revealAddedURLs(state.draft.urls, saved.draft.urls); state.draft.urls = saved.draft.urls; ui.urls.value = saved.draft.urls; warnURLs(); }
    if (changed) invalidateArchive();
    updateCounts(); updateControls(); portableUI?.refresh?.();
  } catch (error) { report(error); } finally { metadataRefreshing = false; }
}
async function refreshActivity() {
  if (!ready || resetting || activityRefreshing) return;
  activityRefreshing = true; clearTimeout(activityTimer);
  try { remoteActivity = await coordinator.activity(); await refreshMetadata(); updateControls(); }
  catch (error) { report(error); }
  finally {
    activityRefreshing = false;
    if (!resetting && (isBatchActive() || remoteActivity.exclusive || hasDocumentWork())) {
      activityTimer = setTimeout(refreshActivity, 1000); activityTimer?.unref?.();
    }
  }
}
async function documentWork(url, task, { wait = false, propagate = false, inclusion = false } = {}) {
  if (!ready || resetting || running || (!wait && isDocumentBusy(url))) return false;
  if (inclusion) inclusionJobs.add(url);
  documentJobs.set(url, (documentJobs.get(url) || 0) + 1); updateControls();
  let executed = false, succeeded = false;
  try {
    await coordinator.document(url, async () => {
      if (resetting || !ready) return;
      executed = true; await notifyWorkspace(); await task(); succeeded = true;
    }, { wait });
    if (!executed && !resetting) ui['saved-status'].textContent = 'This document is being processed in another BootCaT window. Please try again when it finishes.';
  } catch (error) { if (propagate) throw error; report(error); }
  finally {
    const remaining = (documentJobs.get(url) || 1) - 1;
    if (remaining) documentJobs.set(url, remaining); else documentJobs.delete(url);
    if (inclusion) {
      // Clear our released lock from the activity snapshot before unfreezing feedback.
      try { remoteActivity = await coordinator.activity(); } catch (error) { report(error); }
      inclusionJobs.delete(url);
    }
    if (!resetting) { updateControls(); await notifyWorkspace(); refreshActivity(); flushResolutions(); }
  }
  return executed && succeeded;
}
async function work(task) {
  if (!ready || running || isBatchActive() || importing || hasDocumentWork() || resetting) return false;
  running = true; updateControls();
  let executed = false;
  try {
    await coordinator.exclusive(async () => {
      if (resetting || !ready) return;
      executed = true; await notifyWorkspace(); await task();
    });
    if (!executed && !resetting) ui.status.textContent = 'Another BootCaT window is processing this project. Return here when it finishes.';
  } catch (error) { report(error); }
  finally {
    controller = null; running = false;
    if (!resetting) { updateControls(); searchUI?.flush(); await notifyWorkspace(); refreshActivity(); flushResolutions(); }
  }
  if (capturesPending && !resetting) { capturesPending = false; queueMicrotask(importSavedPages); }
  return executed;
}
ui.stop.addEventListener('click', () => { stopping = true; if (activeFeedback) publishDownloadFeedback('download-feedback-progress', { phase: 'stopping' }); controller?.abort(); ui.stop.disabled = true; ui.status.textContent = 'Stopping…'; });
let activeFeedback = null;
async function publishDownloadFeedback(type, patch = {}) {
  if (!activeFeedback || resetting) return;
  const { runId, total, visited, ownerTabId } = activeFeedback;
  const selected = entries.filter(entry => visited.has(entry.url));
  const wasCancelled = entry => entry.record.outcome === 'cancelled' || (entry.record.processingIncomplete && !entry.doc?.editRevision);
  const cancelled = selected.filter(wasCancelled).length;
  const usable = selected.filter(entry => !wasCancelled(entry) && entry.doc?.extraction.status === 'ok').length;
  const failed = selected.length - usable - cancelled;
  const flagged = selected.filter(entry => !wasCancelled(entry) && entry.doc?.extraction.status === 'ok' && hasLanguageWarning(entry.doc.extraction)).length;
  const processed = visited.size;
  try {
    await ext.runtime?.sendMessage?.({ type, projectId, runId, ownerTabId, total, processed, usable, failed, cancelled, flagged, skipped: processed - selected.length, ...patch });
  } catch { /* Optional attention feedback never changes the download result. */ }
}
ui.start.addEventListener('click', async () => {
  if (!ready || running || downloading || resetting) return;
  downloading = true; updateControls(); let acquired = false;
  try {
    await coordinator.batch(async () => {
      const settings = await readSettings(ext.storage.local);
      acquired = true; await notifyWorkspace(); refreshActivity();
      openWorkspaceSection('review-section', { scroll: true }); await flushWrites();
      const parsed = parseURLs(ui.urls.value);
      if (parsed.errors.length || !parsed.urls.length) { ui.status.textContent = parsed.errors.join(' · ') || 'Please enter at least one URL.'; return; }
      const saved = await storage.loadWorkspace(projectId); state.batch = saved.batch;
      const complete = new Set(saved.entries.filter(entry => entry.doc && ['downloaded', 'captured'].includes(entry.record.outcome) && (entry.doc?.editRevision > 0 || !entry.record.processingIncomplete)).map(entry => entry.url));
      const queueRevision = saved.deleteRevision?.value || 0, urls = parsed.urls.filter(url => !complete.has(url)), extractor = saved.draft.extractor;
      if (!urls.length) { ui.status.textContent = 'All listed pages are already saved. Add URLs to download more pages.'; return; }
      stopping = false; ui.stop.disabled = false;
      const startedAt = state.batch.startedAt || new Date().toISOString();
      await storage.saveBatch(projectId, { startedAt, state: 'running', processed: 0, total: urls.length }, await readCollections());
      metadataRevision++; state.batch = { ...state.batch, startedAt, state: 'running', total: urls.length, processed: 0 };
      ui.progress.max = urls.length; ui.progress.value = 0; let processed = 0;
      let owner;
      try { owner = await ext.tabs?.getCurrent?.(); } catch { /* Optional ownership hint. */ }
      activeFeedback = { runId: crypto.randomUUID(), ownerTabId: owner?.id, total: urls.length, visited: new Set() };
      await publishDownloadFeedback('download-feedback-start');
      for (const url of urls) {
        if (stopping || resetting) break;
        const completed = await documentWork(url, async () => {
          if (stopping || resetting) return;
          const target = await storage.readDownloadTarget(projectId, url);
          if (target.deletedVersion > queueRevision || (target.entry?.doc && ['downloaded', 'captured'].includes(target.entry.record.outcome) && (target.entry.doc.editRevision > 0 || !target.entry.record.processingIncomplete))) {
            if (target.entry) remember(target.entry, { keepPreview: true }); return;
          }
          ui.status.textContent = `Downloading ${processed + 1} of ${urls.length}…`;
          await publishDownloadFeedback('download-feedback-progress', { phase: 'downloading' });
          const active = controller = new AbortController(); let timedOut = false, downloaded = false;
          const timer = setTimeout(() => { timedOut = true; active.abort(); }, settings.downloadSeconds * 1000);
          try {
            const response = await fetchFile(url, active.signal, fileLimit(settings)); downloaded = true; clearTimeout(timer);
            if (resetting) return;
            const index = await storage.allocateFileIndex(projectId);
            const filename = filenameFor(url, extractionContentType(response.bytes, response.contentType), index);
            await publishDownloadFeedback('download-feedback-progress', { phase: 'extracting' });
            const extraction = await extractionQueue.run(async () => {
              if (resetting) return;
              return extractDownloadedDocument(response.bytes, response.contentType, { settings, extractor, sourceURL: response.finalURL || url, signal: active.signal });
            });
            if (resetting) return;
            const record = { url, finalURL: response.finalURL, outcome: 'downloaded', httpStatus: response.status, contentType: response.contentType, bytes: response.bytes.length, filename, processingIncomplete: active.signal.aborted, downloadedAt: new Date().toISOString() };
            const checkedExtraction = await checkLanguage(extraction, projectUI.snapshot().language || 'none');
            const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction: checkedExtraction };
            remember(await storage.saveDocument(projectId, record, doc, response.bytes));
          } catch (error) {
            if (resetting) return;
            if (downloaded || error.name === 'QuotaExceededError') throw error;
            const message = stopping ? 'Stopped by user' : timedOut ? `Timed out after ${settings.downloadSeconds} seconds` : error.message;
            remember(await storage.saveFailure(projectId, { url, outcome: stopping ? 'cancelled' : 'error', error: message, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error.contentType ? { contentType: error.contentType } : {}), ...(error.finalURL ? { finalURL: error.finalURL } : {}), ...(error.code === 'DOWNLOAD_TOO_LARGE' ? { errorCode: error.code, limitBytes: error.limitBytes } : {}) }, { advance: false }));
          } finally { clearTimeout(timer); if (controller === active) controller = null; }
        }, { wait: true, propagate: true });
        if (resetting) return;
        activeFeedback.visited.add(url);
        processed++; ui.progress.value = processed;
        await storage.saveBatch(projectId, { processed }); metadataRevision++; state.batch.processed = processed;
        await publishDownloadFeedback('download-feedback-progress', { phase: stopping ? 'stopping' : 'downloading' });
        if (!completed) { stopping = true; break; }
        if (!stopping) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!resetting) {
        await refreshMetadata();
        const message = completionMessage(stopping);
        await storage.saveBatch(projectId, { state: stopping ? 'stopped' : 'idle', processed, lastStatus: message });
        metadataRevision++; state.batch.state = stopping ? 'stopped' : 'idle'; ui.status.textContent = message;
        await publishDownloadFeedback('download-feedback-finish', { state: stopping ? 'stopped' : 'finished' });
      }
    });
    if (!acquired && !resetting) ui.status.textContent = 'Another BootCaT window is already downloading or processing this project.';
  } catch (error) { report(error); await publishDownloadFeedback('download-feedback-finish', { state: 'interrupted' }); }
  finally { activeFeedback = null; downloading = false; ui.stop.disabled = true; if (!resetting) { await notifyWorkspace(); await refreshActivity(); updateControls(); searchUI?.flush(); flushResolutions(); } }
});
async function storeCapture({ url, finalURL, bytes, contentType, source, capturedAt, captureId, settings }) {
  const index = await storage.allocateFileIndex(projectId), filename = filenameFor(url, contentType, index);
  const active = new AbortController(); operationControllers.add(active);
  try {
    const extraction = await extractionQueue.run(async () => {
      active.signal.throwIfAborted();
      return formatByMIME(contentType)
        ? extractDownloadedDocument(bytes, contentType, { settings, sourceURL: finalURL, signal: active.signal })
        : extractDocument(bytes, contentType, { settings, extractor: (await storage.loadWorkspace(projectId)).draft.extractor, sourceURL: finalURL });
    }, { priority: true });
    if (resetting) return;
    const previous = source === 'local-file' ? (await storage.readDownloadTarget(projectId, url)).entry?.doc?.extraction : null;
    const checkedExtraction = await checkLanguage(preserveRecoveryInclusion(extraction, previous), projectUI.snapshot().language || 'none');
    const doc = { url, filename, textFilename: filename.replace(/^pages\//, 'corpus/').replace(/\.[^.]+$/, '.txt'), extraction: checkedExtraction, captureId, source, capturedAt };
    const record = { url, finalURL, outcome: 'captured', source, capturedAt, captureId, filename, contentType, bytes: bytes.length };
    if (!state.batch.startedAt) { const startedAt = new Date().toISOString(); await storage.saveBatch(projectId, { startedAt }, await readCollections()); state.batch.startedAt = startedAt; }
    const saved = await storage.saveDocument(projectId, record, doc, bytes);
    remember(saved, { feedback: source !== 'local-file' }); return saved;
  } finally { operationControllers.delete(active); }
}
async function importSavedPages() {
  if (!ready || resetting) return;
  const signal = ++captureSignal;
  if (portableBusy || running || importing) { capturesPending = true; return; }
  importing = true; capturesPending = false; updateControls();
  try {
    const pending = await listSavedPages(); if (!pending.length) return;
    ui['saved-status'].textContent = 'Captured page received. Recovery is queued for processing…';
    let count = 0;
    for (const item of pending) {
      if (resetting) return;
      const latest = await storage.loadWorkspace(projectId);
      const previous = latest.entries.find(entry => entry.url === item.url || entry.record.finalURL === item.url);
      const url = previous?.url || item.url;
      if (previewURL === url && textReview?.isDirty()) {
        capturesPending = true; ui['saved-status'].textContent = 'Captured page is waiting until you finish reviewing its unsaved text edits.'; continue;
      }
      const processed = await documentWork(url, async () => {
        const page = await readSavedPage(item.url); if (!page) return;
        const current = (await storage.readDownloadTarget(projectId, url)).entry;
        if (current?.doc?.captureId === page.id || current?.doc?.editRevision > 0) { await removeSavedPage(page); return; }
        ui['saved-status'].textContent = 'Processing captured page…';
        const settings = await readSettings(ext.storage.local);
        const bytes = page.kind === 'pdf' ? await readPDFFile(page.blob, fileLimit(settings)) : new TextEncoder().encode(page.html);
        await storeCapture({ settings, url, finalURL: page.finalURL || page.url, bytes, contentType: page.kind === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8', source: page.source || 'browser-tab', capturedAt: page.capturedAt, captureId: page.id });
        if (resetting) return;
        await removeSavedPage(page); count++;
      }, { wait: true });
      if (!processed && !resetting) ui['saved-status'].textContent = 'Captured page could not be processed. It remains saved for another attempt.';
    }
    if (count && !resetting) ui['saved-status'].textContent = `${count} saved page${count === 1 ? '' : 's'} added to the review list. Review the text before saving your corpus.`;
  } catch (error) { report(error); }
  finally { importing = false; if (!resetting) { updateControls(); await notifyWorkspace(); refreshActivity(); flushResolutions(); if (captureSignal !== signal) queueMicrotask(importSavedPages); } }
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
      remember(await storage.saveLanguageCheck(projectId, entry.url, entry.doc.filename, result.languageCheck, result.included, {manualRecheck:true}));
      checked++; ui['language-status'].textContent = `Rechecked ${checked} of ${documents.length} saved texts…`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    ui['language-status'].textContent = `${stopping ? 'Stopped. ' : ''}${checked} of ${documents.length} saved texts rechecked. No documents were downloaded again.`;
  } finally { ui.stop.disabled = true; }
}));
ui.export.addEventListener('click', () => {
  if (ui.export.disabled) return;
  return work(async () => {
    openWorkspaceSection('project-section', { scroll: true });
    if ((await listSavedPages()).length) { capturesPending = true; ui['export-status'].textContent = 'Captured pages are waiting to be processed. Save your corpus after recovery finishes.'; return; }
    await flushWrites();
    const saved = await storage.loadWorkspace(projectId), project = projectUI.snapshot();
    const collections = await readCollections();
    const fingerprint = await corpusFingerprint(saved, project, collections);
    // Another workspace window may have saved this snapshot since our last focus.
    if (saved.corpusExport?.fingerprint === fingerprint && saved.corpusExport.filename === `Corpus ${projectFilename(project.name)}.zip`) { await refreshExportState(saved); return; }
    if (resetting) return;
    const layout = createExportLayout(saved.entries);
    const exportedAt = new Date().toISOString(), signal = (controller = new AbortController()).signal;
    ui.status.textContent = 'Preparing ZIP from saved pages… Your project remains saved if export fails.';
    try {
      invalidateArchive();
      document.getElementById('export-label').textContent = 'Saving corpus…';
      ui['export-status'].textContent = 'Preparing your corpus ZIP…';
      {
        async function* files() {
          yield { name: 'Report.xlsx', blob: await makeMetadataWorkbook(saved.entries, { signal, timestamp: new Date(exportedAt) }) };
          yield { name: 'url_list.txt', blob: new Blob([corpusURLList(saved.entries)], { type: 'text/plain;charset=utf-8' }) };
          yield { name: 'url_list_excluded.txt', blob: new Blob([excludedURLList(saved.entries, saved.draft.urls)], { type: 'text/plain;charset=utf-8' }) };
          for (const [name, field] of [['seeds.txt', 'seeds'], ['tuples.txt', 'tuples']]) {
            yield { name, blob: new Blob([saved.draft[field] || ''], { type: 'text/plain;charset=utf-8' }) };
          }
          for (const entry of saved.entries) {
            for (const name of entry.fileNames) {
              const blob = await storage.readOriginal(projectId, name);
              if (!blob) throw new Error('An original file is missing from browser storage');
              yield { name: layout.nameFor(name), blob };
            }
            if (entry.doc?.extraction.status === 'ok' && entry.doc.extraction.included) {
              const blob = await storage.readText(projectId, entry.url);
              if (!blob) throw new Error('An extracted text is missing from browser storage');
              yield { name: layout.nameFor(entry.doc.textFilename), blob: new Blob([blob, '\n']) };
            }
            if (entry.doc?.extraction.status === 'ok') {
              const blob = await storage.readOriginalText(projectId, entry.url);
              if (!blob) throw new Error('An original extracted text is missing from browser storage');
              yield { name: layout.nameFor(originalTextFilename(entry.doc)), blob };
            }
            if (entry.doc?.rawTextFilename) {
              const blob = await storage.readRawText(projectId, entry.url);
              if (!blob) throw new Error('A raw PDF extraction is missing from browser storage');
              yield { name: layout.nameFor(entry.doc.rawTextFilename), blob: new Blob([blob, '\n']) };
            }
          }
          const json = [
            ['project.json', { ...project, draft: saved.draft, batch: saved.batch }],
            ['results.json', { version: VERSION, project, startedAt: saved.batch.startedAt, exportedAt, results: layout.entries.map(entry => entry.record) }],
            ['extraction.json', { version: VERSION, project, exportedAt, documents: extractionMetadata(layout.entries.filter(entry => entry.doc).map(entry => entry.doc)) }],
            ['searches.json', { version: VERSION, project, collections }]
          ];
          for (const [name, value] of json) yield { name, blob: new Blob([JSON.stringify(value, null, 2)]) };
        }
        const archive = await makeStoredZIP(files(), { signal, timestamp: new Date(exportedAt) });
        if (resetting || signal.aborted) return;
        archiveURL = URL.createObjectURL(archive);
      }
      const link = document.createElement('a'); link.href = archiveURL;
      link.download = `Corpus ${projectFilename(project.name)}.zip`;
      document.body.append(link); link.click(); link.remove();
      const receipt = { fingerprint, filename: link.download, exportedAt };
      await storage.saveCorpusExport(projectId, receipt);
      if (resetting) return;
      await flushWrites();
      await refreshExportState({ ...(await storage.loadWorkspace(projectId)), corpusExport: receipt });
      ui.status.textContent = 'Corpus ZIP sent to your browser. Your project is still saved in this browser.';
    } catch (error) {
      if (!resetting) { document.getElementById('export-label').textContent = 'Export Corpus'; ui['export-status'].textContent = `Could not export corpus: ${error.message}. Please try again.`; }
      throw error;
    } finally { controller = null; }
  });
});
for (const [id, key, type] of [['urls', 'urls', 'input'], ['engine', 'engine', 'change']]) {
  ui[id].addEventListener(type, () => { queueDraft({ [key]: ui[id].value }); if (id === 'urls') warnURLs(); });
}
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || resetting) return;
  if (changes[SETTINGS_KEY]) loadSettings().catch(report);
  if (changes.captureRevision) importSavedPages();
  if (changes.workspaceRevision?.newValue?.projectId === projectId) {
    if (changes.workspaceRevision.newValue.reason === 'corpus-options') applyProjectOptionsFeedback().catch(report);
    else refreshActivity();
  }
});
window.addEventListener('focus', async () => {
  if (!ready || running || seedsUI?.isBusy() || pickingDocument || pendingWrites || refreshing || resetting) return;
  refreshing = true;
  try {
    if (downloading || textReview?.isOpen() || hasDocumentWork()) await refreshActivity();
    else { await restore(); await refreshActivity(); }
    await importSavedPages();
  } catch (error) { report(error); } finally { refreshing = false; }
});

portableUI = initPortableUI({
  getProject: () => projectUI.snapshot(),
  isBusy: () => !ready && !!projectUI.snapshot() || running || isBatchActive() || importing || hasDocumentWork() || remoteActivity.exclusive || seedsUI?.isBusy(),
  isDirty: () => textReview?.isDirty(), flush: flushWrites,
  exclusive: task => coordinator.exclusive(task),
  onBusy: value => { portableBusy = value; updateControls(); if (!value && capturesPending) queueMicrotask(importSavedPages); }, version: VERSION, onStateChange: updateControls
});

(async () => {
  try {
    await projectUI.ready; projectId = projectUI.snapshot()?.id;
    if (!projectId) {
      setProjectSectionState(false); ui.export.disabled = true;
      for (const id of ['seeds-section', 'search-section', 'urls-section', 'review-section']) {
        for (const control of document.getElementById(id).querySelectorAll('button, input, select, textarea')) control.disabled = true;
      }
      ui.status.textContent = 'No active project. Create a project to download and extract documents.';
      document.getElementById('collection-status').textContent = 'No active project.';
      document.getElementById('project-tab-count').textContent = 'No active project.';
      return;
    }
    await storage.ensureStoredProject(projectId);
    await restore();
    await loadSettings(); ready = true;
    searchUI = initSearchUI({ onCollectionsChange: invalidateArchive, isRunning: () => running, seenCollectionIds: state.draft.seenCollections, getProjectId: () => projectId, onChange: patch => { queueDraft(patch); warnURLs(); } });
    if (state.draft.engine) ui.engine.value = state.draft.engine;
    seedsUI = initSeedsUI({ minimumSeeds: currentSettings.minimumSeeds, draft: state.draft, onChange: queueDraft, getLanguage: () => projectUI.snapshot()?.language || 'none', getProjectId: () => projectId, onOpeningChange: value => projectTabsUI?.setOpening(value) });
    removeFileDropGuard = guardFileDropNavigation({ root: window, onOutsideDrop: event => {
      if (resetting) return;
      recoveryFeedback?.begin();
      const banner = document.getElementById('document-import-feedback'); banner.hidden = false; banner.setAttribute('data-state', 'warning');
      ui['document-import-status'].textContent = event.target?.closest?.('.import-document-button') ? 'Wait for this document to finish processing.' : 'Drop the file on an Import downloaded file button.';
    } });
    recoveryFeedback = initRecoveryFeedback({ getRow: url => rows.get(url), isBlocked: () => resetting || pickingDocument || !!document.querySelector('dialog[open]') });
    downloadFeedbackUI = initDownloadFeedbackUI({ getProjectId: () => projectId, onExport: goToExport, getCorpusState: () => ({
      included: entries.filter(entry => !needsAttention(entry) && entry.doc.extraction.included).length, exportSaved
    }) });
    engineDefaultUI = initEngineDefaultUI({ getProjectId: () => projectId });
    projectTabsUI = initProjectTabsUI({ getProjectId: () => projectId, onState: value => seedsUI?.updateTabState(value) });
    updateControls(); await refreshActivity(); await importSavedPages();
  } catch (error) { report(error); }
})();

function reviewCollectedURLs() {
  openWorkspaceSection('review-section'); openWorkspaceSection('urls-section', { scroll: true });
}
ext.runtime?.onMessage?.addListener((message, sender) => {
  if (sender.id === ext.runtime.id && message.type === 'bootcat-review-urls') ext.tabs.getCurrent().then(tab => { if (tab?.id === message.tabId) reviewCollectedURLs(); }).catch(() => {});
});
if (globalThis.location?.hash === '#urls-section') projectUI.ready.then(() => requestAnimationFrame(reviewCollectedURLs));

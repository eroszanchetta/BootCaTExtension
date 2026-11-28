import { hasLengthWarning, lengthMessage } from './corpus-options.js';
import { DEFAULT_SETTINGS } from './settings.js';
import * as storage from './project-store.js';
import { checkLanguage, languageMessage, hasLanguageWarning } from './language-detection.js';
import { fileWarnings } from './pdf-recovery.js';

export const EDIT_TEXT_LIMIT = DEFAULT_SETTINGS.editCharacters;
export async function checkEditedText(extraction, text, language, settings = DEFAULT_SETTINGS) {
  if (!text.trim()) throw new Error('Enter some text before saving. To omit a document, uncheck Include in the download list.');
  if (text.length > settings.editCharacters) throw new Error(`Edited text exceeds the ${settings.editCharacters.toLocaleString()} character limit. Your changes have not been saved.`);
  let characters = 0; for (const char of text) characters++;
  // An acceptance applied to an earlier text must not silently approve newly
  // edited text in another language. Preserve deliberate inclusion/exclusion.
  const previous = extraction.status === 'ok' ? extraction.languageCheck : undefined;
  const languageCheck = previous ? { ...previous, accepted: false } : undefined;
  if (languageCheck) delete languageCheck.acceptedAt;
  const recovering = extraction.status !== 'ok';
  const { text: ignoredText, rawText: ignoredRaw, ...previousExtraction } = extraction;
  const warnings = recovering ? [] : [...extraction.warnings];
  if (recovering && characters < 200) warnings.push('Very little text entered (under 200 characters). Review before including.');
  return checkLanguage({ ...extraction, status: 'ok', textSource: 'manual', text, characters, languageCheck,
    included: recovering ? true : extraction.included, warnings,
    ...(recovering ? { recovery: { method: 'manual-text', recoveredAt: new Date().toISOString(), previousExtraction } } : {}) }, language);
}

export function initTextReview({ root = document, confirm, run, getProjectId, getLanguage, isRunning, onSaved, onSelect = () => {}, onClosed = () => {}, getSettings = async () => DEFAULT_SETTINGS }) {
  const el = id => root.getElementById(id), dialog = el('text-review-dialog'), text = el('preview-text');
  const edit = el('text-review-edit'), save = el('text-review-save'), close = el('text-review-close'), status = el('text-review-status');
  let current = null, baseText = '', editing = false, loading = false, saving = false, opened = false, generation = 0, confirming = false;
  const dirty = () => editing && text.value !== baseText;
  function controls() {
    edit.textContent = editing ? 'Cancel' : 'Edit';
    edit.classList.toggle('danger', editing);
    edit.classList.toggle('secondary', !editing);
    edit.disabled = !current || loading || saving || (!editing && isRunning(current?.entry.url));
    save.disabled = loading || saving || isRunning(current?.entry.url) || !dirty(); close.disabled = saving || confirming;
    text.readOnly = !editing || saving;
    dialog.setAttribute('aria-busy', String(loading || saving));
  }
  function metadata() {
    const doc = current.entry.doc, extraction = doc.extraction;
    el('preview-title').textContent = extraction.title || 'Document text';
    el('preview-source').href = doc.url; el('preview-source').textContent = doc.url;
    const warnings = [...fileWarnings(extraction, { details: true }), languageMessage(extraction), lengthMessage(extraction)].filter(Boolean);
    el('preview-meta').textContent = `${extraction.recovery ? 'Manually recovered text · ' : ''}${extraction.extractor || 'Unsupported format'} · ${extraction.characters.toLocaleString()} characters${extraction.pageCount ? ` · ${extraction.pageCount} pages` : ''}${doc.editedAt ? ' · Manually edited' : ''}${warnings.length ? ` · ${warnings.join(' ')}` : ''}`;
  }
  function clear() {
    const wasOpen = opened, url = current?.entry.url;
    generation++; opened = loading = editing = saving = false; current = null; baseText = ''; text.value = ''; text.readOnly = true;
    if (dialog.open) dialog.close();
    status.textContent = ''; controls(); onSelect(null);
    if (wasOpen) onClosed(url);
  }
  async function requestClose() {
    if (saving || confirming) return false;
    if (dirty()) {
      confirming = true; controls();
      let discard;
      try { discard = await confirm({ title: 'Discard text changes?', message: 'Your unsaved edits will be lost. Choose Cancel to return to the text and save your changes.', confirmLabel: 'Discard changes', destructive: true }); }
      finally { confirming = false; controls(); }
      if (!discard) return false;
    }
    clear(); return true;
  }
  async function open(url) {
    if (opened && !await requestClose()) return;
    const id = getProjectId(); if (!id) return;
    const request = ++generation;
    opened = loading = true; editing = false; text.value = ''; status.textContent = 'Loading text…';
    el('preview-title').textContent = 'Document text'; el('preview-meta').textContent = '';
    el('preview-source').textContent = ''; el('preview-source').removeAttribute('href');
    if (!dialog.open) dialog.showModal(); controls(); close.focus();
    try {
      const snapshot = await storage.readTextSnapshot(id, url);
      const value = snapshot.blob ? await snapshot.blob.text() : '';
      if (request !== generation || id !== getProjectId()) return;
      if (!snapshot.entry?.doc) throw new Error('This document is no longer in the project.');
      if (snapshot.entry.doc.extraction.status === 'ok' && !snapshot.blob) throw new Error('The saved document text is missing.');
      current = { id, entry: snapshot.entry }; baseText = value; text.value = value; metadata(); onSelect(snapshot.entry.doc);
      status.textContent = snapshot.entry.doc.extraction.status === 'ok' ? 'Read only. Choose Edit to change the corpus text.' : 'No usable text was extracted. Choose Edit to paste text from the original page or document.';
    } catch (error) { if (request === generation) status.textContent = `Could not open text: ${error.message}`; }
    finally { if (request === generation) { loading = false; controls(); } }
  }
  edit.addEventListener('click', () => {
    if (edit.disabled) return;
    if (editing) {
      text.value = baseText;
      editing = false;
      status.textContent = 'Edit cancelled. Read only. Choose Edit to change the corpus text.';
    } else {
      editing = true;
      status.textContent = 'Editing. Save to use the modified text in your corpus, or Cancel to discard this edit.';
    }
    controls(); if (editing) text.focus(); else edit.focus();
  });
  text.addEventListener('input', () => {
    if (!editing || saving) return;
    status.textContent = dirty() ? 'Unsaved changes. Save to update this project’s corpus text.' : 'No changes to save.'; controls();
  });
  save.addEventListener('click', async () => {
    if (save.disabled || !current) return;
    const selected = current, request = generation, value = text.value;
    saving = true; status.textContent = 'Saving text and checking language…'; controls();
    let committed = false, failed = false;
    try {
      const settings = await getSettings();
      const ran = await run(async () => {
        try {
          const latest = await storage.readTextSnapshot(selected.id, selected.entry.url), doc = latest.entry?.doc;
          if (!doc || doc.filename !== selected.entry.doc.filename || (doc.editRevision || 0) !== (selected.entry.doc.editRevision || 0)) throw new Error('This document changed in another window. Copy your edits before closing, then reopen the document.');
          const recovered = doc.extraction.status !== 'ok';
          const language = getLanguage(), extraction = await checkEditedText(doc.extraction, value, language, settings);
          if (request !== generation || selected.id !== getProjectId()) return;
          if (getLanguage() !== language) throw new Error('The project language changed. Please try Save again.');
          const { text: ignored, ...metadata } = extraction;
          const entry = await storage.saveEditedText(selected.id, selected.entry.url, { filename: doc.filename, revision: doc.editRevision || 0 }, value, metadata);
          if (request !== generation) return;
          current = { id: selected.id, entry }; baseText = value; editing = false; committed = true;
          onSaved(entry, { recovered }); onSelect(entry.doc); metadataView(recovered);
        } catch (error) { failed = true; if (request === generation) status.textContent = `Text not saved: ${error.message}`; }
      }, { url: selected.entry.url });
      if (request === generation && !committed && !failed && !ran) status.textContent = 'Could not save now. Another BootCaT window may be processing this project. Try Save again.';
    } catch (error) {
      if (request === generation) status.textContent = `Text not saved: ${error.message}`;
    } finally { if (request === generation) { saving = false; controls(); } }
  });
  function metadataView(recovered = false) { metadata(); status.textContent = recovered ? (hasLengthWarning(current.entry.doc.extraction) ? 'Text saved · length review needed' : hasLanguageWarning(current.entry.doc.extraction) ? 'Text saved · language review needed' : 'Text recovered') : 'Text saved in this project. Save corpus to download the updated corpus.'; }
  close.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  dialog.addEventListener('close', () => { if (opened) clear(); });
  controls();
  return { open, clear, requestClose, isDirty: dirty, isOpen: () => opened, refreshControls: controls };
}

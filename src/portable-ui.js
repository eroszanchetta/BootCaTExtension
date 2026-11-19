import { makeProjectArchive, openProjectArchive } from './portable-project.js';
import { stageProject, readStagedProject, removeStagedProject } from './project-transfer.js';
import { projectFilename } from './project-ui.js';
import { getExtensionAPI } from './extension-api.js';
export function initPortableUI({ getProject, isBusy, isDirty, flush, exclusive, onBusy, version }) {
  const ext = getExtensionAPI(), el = id => document.getElementById(id);
  const picker = el('project-file-picker'), status = el('project-file-status');
  let busy = false, choosingId;
  const identity = () => getProject()?.id ?? null;
  function available() {
    if (isDirty()) throw new Error('Save or cancel the current text edit before saving or changing projects.');
    if (isBusy()) throw new Error('Stop or wait for active processing before saving or changing projects.');
  }
  function setBusy(value) { busy = value; onBusy(value); }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function save({ nested = false } = {}) {
    if (busy && !nested) return false;
    available(); const project = getProject(); if (!project) throw new Error('Open or create a project first.');
    const previousBusy = busy; setBusy(true); status.textContent = 'Preparing complete project…';
    let token;
    try {
      await flush();
      const result = await exclusive(async () => {
        if (identity() !== project.id) throw new Error('The project changed. Save it again.');
        const reply = await ext.runtime.sendMessage({ type: 'prepare-project-save', projectId: project.id });
        if (!reply?.ok) throw new Error(reply?.error || 'Could not prepare the project.');
        token = reply.token; const snapshot = await readStagedProject(token);
        if (!snapshot) throw new Error('The project snapshot is no longer available. Try again.');
        const archive = await makeProjectArchive(snapshot, { appVersion: version });
        if (identity() !== project.id) throw new Error('The project changed. Save it again.');
        const filename = `${projectFilename(project.name)}.bootcat`;
        download(archive, filename); status.textContent = `Download started: ${filename}. Keep this file to reopen the complete project.`;
        return true;
      });
      if (!result) throw new Error('Another BootCaT window is processing this project. Wait for it to finish.');
      return true;
    } catch (error) { status.textContent = `Could not save project: ${error.message}`; throw error; }
    finally { if (token) await removeStagedProject(token).catch(() => {}); setBusy(previousBusy); }
  }
  async function confirmReplacement({ title, message, confirmLabel = 'Continue' }) {
    available(); await flush();
    const dialog = el('project-replace-dialog'); if (dialog.open) return false;
    el('project-replace-title').textContent = title; el('project-replace-message').textContent = message;
    const note = el('project-replace-status'), saveButton = el('project-replace-save'), proceed = el('project-replace-continue');
    note.textContent = ''; proceed.textContent = confirmLabel; saveButton.disabled = false;
    const saveFirst = async () => {
      saveButton.disabled = proceed.disabled = true;
      try { await save({ nested: true }); note.textContent = 'Project download started. Check that you have the file before continuing.'; }
      catch (error) { note.textContent = error.message; }
      finally { saveButton.disabled = proceed.disabled = false; }
    };
    saveButton.addEventListener('click', saveFirst); dialog.returnValue = 'cancel';
    return new Promise((resolve, reject) => {
      const closed = () => { saveButton.removeEventListener('click', saveFirst); resolve(dialog.returnValue === 'confirm'); };
      dialog.addEventListener('close', closed, { once: true });
      try { dialog.showModal(); dialog.querySelector('button[value=cancel]').focus(); } catch (error) { dialog.removeEventListener('close', closed); saveButton.removeEventListener('click', saveFirst); reject(error); }
    });
  }
  function choose() {
    if (busy) return;
    choosingId = identity(); picker.value = ''; picker.click();
  }
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0]; if (!file || busy) return;
    let token; const expected = choosingId;
    try {
      available(); setBusy(true); status.textContent = 'Checking project file…';
      const snapshot = await openProjectArchive(file);
      if (identity() !== expected) throw new Error('The project changed. Open the file again.');
      if (getProject() && !await confirmReplacement({ title: 'Open another project?', message: 'Opening this file replaces the current project in this browser. Save the current project first to keep all originals, texts and work. Your preferences will be kept.', confirmLabel: 'Open project' })) { status.textContent = 'Open cancelled. The current project is unchanged.'; return; }
      await flush(); token = await stageProject(snapshot);
      const result = await exclusive(async () => {
        const reply = await ext.runtime.sendMessage({ type: 'open-portable-project', projectId: expected, token });
        if (!reply?.ok) throw new Error(reply?.error || 'Could not open project.');
        // Normally the background project notification reloads every workspace.
        // Also reload if that notification arrived before this view subscribed.
        window.location.reload(); return true;
      });
      if (!result) throw new Error('Another BootCaT window is processing this project. Wait for it to finish.');
    } catch (error) {
      status.textContent = `Could not open project: ${error.message}`;
      el('project-choice-error').textContent = status.textContent;
    } finally { if (token) await removeStagedProject(token).catch(() => {}); setBusy(false); picker.value = ''; }
  });
  return { save, choose, confirmReplacement };
}

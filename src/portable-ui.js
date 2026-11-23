import { projectFingerprint } from './project-save-state.js';
import { snapshotStoredProject } from './project-store.js';
import { prepareDownloadBlob } from './download-blob.js';
import { makeProjectArchive, openProjectArchive } from './portable-project.js';
import { stageProject, readStagedProject, removeStagedProject } from './project-transfer.js';
import { projectFilename } from './project-ui.js';
import { getExtensionAPI } from './extension-api.js';
export function initPortableUI({ getProject, isBusy, isDirty, flush, exclusive, onBusy, version, onStateChange = () => {} }) {
  const ext = getExtensionAPI(), el = id => document.getElementById(id);
  const picker = el('project-file-picker'), status = el('project-file-status');
  let busy = false, choosingId, receipt = null, saved = false, refreshRevision = 0, saveError = false;
  const feedback = el('project-save-feedback'), retry = el('project-download-again');
  const identity = () => getProject()?.id ?? null;
  function available() {
    if (isDirty()) throw new Error('Save or cancel the current text edit before saving or changing projects.');
    if (isBusy()) throw new Error('Stop or wait for active processing before saving or changing projects.');
  }
  function present() {
    feedback.classList.toggle('saved', saved && !busy && !saveError);
    retry.hidden = !saved; retry.disabled = busy || isBusy() || isDirty();
    el('save-project').disabled = busy || isBusy() || !getProject() || saved;
    onStateChange();
  }
  function setBusy(value) { busy = value; onBusy(value); present(); }
  async function refresh() {
    const revision = ++refreshRevision, project = getProject();
    if (busy) return;
    try {
      const area = ext.storage?.local;
      receipt = (await area?.get('projectSaveReceipt'))?.projectSaveReceipt || receipt;
      if (project && receipt?.projectId === project.id && (isBusy() || isDirty())) return;
      let matches = false;
      if (project && receipt?.projectId === project.id && !isBusy() && !isDirty()) {
        const snapshot = await snapshotStoredProject(project);
        const collections = (await area?.get('collections'))?.collections;
        if (collections) snapshot.stores.meta = snapshot.stores.meta.map(record => record.key === 'searches' ? { key: 'searches', collections } : record);
        matches = await projectFingerprint(snapshot) === receipt.fingerprint;
      }
      if (revision !== refreshRevision || busy || identity() !== (project?.id ?? null)) return;
      saved = matches && !saveError;
      if (saved) status.textContent = `Project download started: ${receipt.filename}. Check your browser’s downloads for the file.`;
      else if (receipt?.projectId === project?.id && !saveError) status.textContent = 'Project changed. Save Project to download an updated file.';
      present();
    } catch {
      if (revision === refreshRevision && !busy) { saved = false; present(); }
    }
  }
  retry.addEventListener('click', () => save({ again: true }).catch(() => {}));
  ext.storage?.onChanged?.addListener((changes, area) => { if (area === 'local' && (changes.projectSaveReceipt || changes.collections || changes.captureRevision || changes.workspaceRevision || changes.project)) refresh(); });
  refresh();
  async function download(blob, filename) {
    status.textContent = 'Preparing project download…';
    const independent = await prepareDownloadBlob(blob);
    const url = URL.createObjectURL(independent), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function save({ nested = false, again = false } = {}) {
    if ((busy && !nested) || (saved && !again && !nested)) return false;
    available(); const project = getProject(); if (!project) throw new Error('Open or create a project first.');
    const previousBusy = busy; saveError = false; ++refreshRevision; setBusy(true); status.textContent = 'Preparing complete project…';
    let token;
    try {
      await flush();
      const result = await exclusive(async () => {
        if (identity() !== project.id) throw new Error('The project changed. Save it again.');
        const reply = await ext.runtime.sendMessage({ type: 'prepare-project-save', projectId: project.id });
        if (!reply?.ok) throw new Error(reply?.error || 'Could not prepare the project.');
        token = reply.token; const snapshot = await readStagedProject(token);
        if (!snapshot) throw new Error('The project snapshot is no longer available. Try again.');
        const fingerprint = await projectFingerprint(snapshot);
        const archive = await makeProjectArchive(snapshot, { appVersion: version });
        if (identity() !== project.id) throw new Error('The project changed. Save it again.');
        const filename = `${projectFilename(project.name)}.bootcat`;
        await download(archive, filename);
        receipt = { projectId: project.id, fingerprint, filename }; saved = true;
        await ext.storage?.local?.set({ projectSaveReceipt: receipt });
        status.textContent = `Project download started: ${filename}. Check your browser’s downloads for the file.`;
        return true;
      });
      if (!result) throw new Error('Another BootCaT window is processing this project. Wait for it to finish.');
      return true;
    } catch (error) { saved = false; saveError = true; status.textContent = `Could not save project: ${error.message}`; throw error; }
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
      try { await save({ nested: true, again: true }); note.textContent = 'Project download started. Check that you have the file before continuing.'; }
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
      if (getProject() && !await confirmReplacement({ title: 'Open another project?', message: 'Opening this project replaces the current one. Save the current project first if you want to keep it.', confirmLabel: 'Open project' })) { status.textContent = 'Open cancelled. The current project is unchanged.'; return; }
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
      saveError = true; saved = false;
      status.textContent = `Could not open project: ${error.message}`;
      el('project-choice-error').textContent = status.textContent;
    } finally { if (token) await removeStagedProject(token).catch(() => {}); setBusy(false); picker.value = ''; }
  });
  return { save, choose, confirmReplacement, refresh, isSaved: () => saved };
}

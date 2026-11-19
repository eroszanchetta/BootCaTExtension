import { confirmAction } from './dialogs.js';
import { setProjectSectionState } from './workspace-sections.js';
import { fillLanguageSelect } from './language-options.js';
import { validateLanguage } from './language-detection.js';
import { getExtensionAPI } from './extension-api.js';
export function initProjectUI({ onReset, onRename, onSaveProject = async () => {}, onOpenProject = () => {}, getBusy = () => false, confirmReplacement = async options => confirmAction(options) }) {
  const ext = getExtensionAPI();
  const name = document.getElementById('project-name');
  const button = document.getElementById('new-project'), close = document.getElementById('close-project');
  const status = document.getElementById('project-status');
  const dialog = document.getElementById('project-dialog'), form = document.getElementById('project-form');
  const language = document.getElementById('project-language'), dialogLanguage = document.getElementById('project-dialog-language');
  const dialogName = document.getElementById('project-dialog-name'), submit = document.getElementById('project-dialog-submit');
  const cancel = document.getElementById('project-dialog-cancel'), error = document.getElementById('project-dialog-error');
  const closeBootCaT = document.getElementById('project-choice-close');
  const chooser = document.getElementById('project-choice-dialog'), choiceError = document.getElementById('project-choice-error');
  const open = document.getElementById('open-project'), save = document.getElementById('save-project'), rename = document.getElementById('rename-project');
  name.readOnly = true;
  function showChooser() { if (!project && !changingProject && !chooser.open) chooser.showModal(); }
  chooser.addEventListener('cancel', event => event.preventDefault());
  document.getElementById('project-choice-new').addEventListener('click', () => { chooser.close(); showDialog('new'); });
  document.getElementById('project-choice-open').addEventListener('click', () => onOpenProject());
  open.addEventListener('click', () => onOpenProject());
  save.addEventListener('click', () => onSaveProject().catch(failure => { status.textContent = failure.message; }));
  rename.addEventListener('click', () => showDialog('name'));
  let project = null, saving = 0, mode = 'new', targetId = null, changingProject = false, applied = false, revision = 0;
  function controls() {
    button.disabled = open.disabled = !!saving || changingProject || getBusy();
    save.disabled = rename.disabled = !project || !!saving || changingProject || getBusy();
    name.disabled = !project || !!saving || changingProject;
    close.hidden = !project; close.disabled = !project || !!saving || changingProject || getBusy();
  }
  function showDialog(nextMode) {
    if (saving || changingProject) return;
    if (chooser.open) chooser.close();
    mode = nextMode; targetId = project?.id ?? null; error.textContent = '';
    fillLanguageSelect(dialogLanguage, { requiredChoice: true, value: mode === 'new' ? '' : project?.language || '' });
    dialogName.value = mode === 'new' || project?.name === 'Untitled project' ? '' : project?.name || '';
    document.getElementById('project-dialog-title').textContent = mode === 'new' ? 'Create a new project' : 'Rename project';
    cancel.disabled = false;
    document.getElementById('project-dialog-description').textContent = mode === 'new' ? 'Choose a name for your new corpus project.' : 'Choose a new name for this project.';
    document.getElementById('project-dialog-language-fields').hidden = mode === 'name' && project?.nameConfirmed === true;
    submit.textContent = mode === 'new' ? 'Create project' : 'Rename';
    if (!dialog.open) dialog.showModal();
    dialogName.focus();
  }
  name.disabled = button.disabled = true;
  function apply(next) {
    next ||= null;
    if (applied && (next?.id ?? null) !== (project?.id ?? null)) {
      project = next;
      if (dialog.open) dialog.close(); if (chooser.open) chooser.close();
      if (!changingProject) { changingProject = true; controls(); onReset(); }
      return;
    }
    if (dialog.open && mode === 'name' && next?.nameConfirmed) dialog.close();
    project = next;
    if (!applied) setProjectSectionState(!!project);
    applied = true;
    fillLanguageSelect(language, { value: next?.language || 'none' });
    if (document.activeElement !== name) name.value = next?.name || '';
    status.textContent = next ? '' : 'No active project. Open or create a project to start collecting.';
    controls(); onRename();
  }
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.project) { revision++; apply(changes.project.newValue); }
  });
  const initialRevision = revision;
  const ready = ext.runtime.sendMessage({ type: 'get-project' }).then(reply => {
    if (!reply?.ok) throw new Error(reply?.error || 'Could not load project');
    if (revision === initialRevision) apply(reply.project);
    if (!changingProject && (!project || project?.nameConfirmed === false || (project?.nameConfirmed == null && project?.name === 'Untitled project'))) project ? showDialog('name') : showChooser();
  }).catch(error => { status.textContent = error.message; throw error; });
  button.addEventListener('click', () => showDialog('new'));
  function cancelCreation() {
    if (saving) return;
    dialog.close(); if (!project) showChooser();
  }
  cancel.addEventListener('click', cancelCreation);
  closeBootCaT.addEventListener('click', async () => {
    if (project || saving || changingProject) return;
    closeBootCaT.disabled = submit.disabled = dialogName.disabled = dialogLanguage.disabled = true; choiceError.textContent = '';
    try {
      // getCurrent identifies only this workspace, including manually opened tabs.
      const tab = await ext.tabs.getCurrent();
      if (!Number.isInteger(tab?.id)) throw new Error('Could not identify this BootCaT tab. Close it using your browser.');
      await ext.tabs.remove(tab.id);
    } catch (failure) { choiceError.textContent = failure.message; closeBootCaT.disabled = submit.disabled = dialogName.disabled = dialogLanguage.disabled = false; }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancelCreation(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || changingProject || (project?.id ?? null) !== targetId) return;
    const value = dialogName.value.trim();
    if (!value) { error.textContent = 'Enter a project name.'; dialogName.focus(); return; }
    let chosenLanguage;
    try { chosenLanguage = validateLanguage(mode === 'name' && project?.nameConfirmed === true ? project.language || 'none' : dialogLanguage.value); } catch (failure) { error.textContent = failure.message; dialogLanguage.focus(); return; }
    if (mode === 'new' && project) {
      // Close the naming dialog before opening our reusable confirmation modal.
      // A cancelled replacement returns to the entered name and language.
      saving++; dialog.close();
      let approved = false;
      try {
        approved = await confirmReplacement({ title: 'Replace current project?', message: 'Creating a new project permanently deletes the current project’s seeds, tuples, searches, URLs, original files and extracted texts from this browser, and stops pending work. All data that you have not exported will be lost. Save your project first if you want to keep all of it. Your preferences will be kept.', confirmLabel: 'Create new project', destructive: true });
      } catch (failure) { error.textContent = failure.message; }
      finally { saving--; }
      if (changingProject || project?.id !== targetId) return;
      if (!approved) { dialog.showModal(); dialogName.focus(); return; }
    }
    if (!dialog.open) dialog.showModal();
    saving++; dialogLanguage.disabled = true; submit.disabled = cancel.disabled = dialogName.disabled = closeBootCaT.disabled = true;
    name.disabled = button.disabled = true; error.textContent = '';
    try {
      const reply = await ext.runtime.sendMessage({ type: mode === 'new' ? 'new-project' : 'rename-project', projectId: targetId, name: value, language: chosenLanguage });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not save project');
      apply(reply.project); if (dialog.open) dialog.close();
    } catch (failure) { error.textContent = failure.message; }
    finally {
      saving--; dialogLanguage.disabled = false; submit.disabled = dialogName.disabled = closeBootCaT.disabled = false; cancel.disabled = false;
      controls();
    }
  });
  close.addEventListener('click', async () => {
    if (!project || saving || changingProject) return;
    const closingId = project.id;
    const approved = await confirmReplacement({ title: 'Close project?', message: 'Stop pending work and permanently delete this project’s seeds, tuples, searches, tab tracking, URLs, original files and extracted texts from this browser. Save your project first if you want to keep it. Your saved preferences will be kept.', confirmLabel: 'Close project', destructive: true });
    if (!approved || changingProject || project?.id !== closingId) return;
    saving++; controls();
    try {
      const reply = await ext.runtime.sendMessage({ type: 'close-project', projectId: closingId });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not close project');
      apply(reply.project);
    } catch (error) { status.textContent = error.message; }
    finally { saving--; controls(); }
  });
  async function setLanguage(value) {
    if (!project) throw new Error('Project is not ready.');
    validateLanguage(value); saving++;
    try {
      const reply = await ext.runtime.sendMessage({ type: 'set-project-language', projectId: project.id, language: value });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not save project language');
      apply(reply.project);
    } finally { saving--; }
  }
  return { ready, setLanguage, refreshControls: controls, showChooser, isSaving: () => saving > 0, snapshot: () => project ? { ...project, name: name.value.trim() || 'Untitled project' } : null };
}
export function projectFilename(name) {
  return (name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'bootcat-corpus');
}

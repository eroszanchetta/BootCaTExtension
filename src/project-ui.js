import { fillLanguageSelect } from './language-options.js';
import { validateLanguage } from './language-detection.js';
import { getExtensionAPI } from './extension-api.js';
export function initProjectUI({ onReset, onRename }) {
  const ext = getExtensionAPI();
  const name = document.getElementById('project-name');
  const button = document.getElementById('new-project');
  const status = document.getElementById('project-status');
  const dialog = document.getElementById('project-dialog'), form = document.getElementById('project-form');
  const language = document.getElementById('project-language'), dialogLanguage = document.getElementById('project-dialog-language');
  const dialogName = document.getElementById('project-dialog-name'), submit = document.getElementById('project-dialog-submit');
  const cancel = document.getElementById('project-dialog-cancel'), error = document.getElementById('project-dialog-error');
  let project = null, saving = 0, mode = 'name', targetId = null, changingProject = false;
  function showDialog(nextMode) {
    if (!project || saving) return;
    mode = nextMode; targetId = project.id; error.textContent = '';
    fillLanguageSelect(dialogLanguage, { requiredChoice: true, value: mode === 'new' ? '' : project.language || '' });
    dialogName.value = mode === 'new' || project.name === 'Untitled project' ? '' : project.name;
    document.getElementById('project-dialog-title').textContent = mode === 'new' ? 'Create a new project' : 'Name your project';
    document.getElementById('project-dialog-warning').hidden = mode !== 'new';
    submit.textContent = mode === 'new' ? 'Create project' : 'Save project name';
    if (!dialog.open) dialog.showModal();
    dialogName.focus();
  }
  name.disabled = button.disabled = true;
  function apply(next) {
    if (!next) return;
    if (project && next.id !== project.id) { if (dialog.open) dialog.close(); if (!changingProject) { changingProject = true; onReset(); } return; }
    if (dialog.open && mode === 'name' && next.nameConfirmed) dialog.close();
    project = next; fillLanguageSelect(language, { value: next.language || 'none' }); if (document.activeElement !== name) name.value = next.name; onRename();
    name.disabled = button.disabled = false;
  }
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.project?.newValue) apply(changes.project.newValue);
  });
  const ready = ext.runtime.sendMessage({ type: 'get-project' }).then(reply => {
    if (!reply?.ok) throw new Error(reply?.error || 'Could not load project');
    apply(reply.project);
    if (project && (project.nameConfirmed === false || (project.nameConfirmed == null && project.name === 'Untitled project'))) showDialog('name');
  }).catch(error => { status.textContent = error.message; });
  // Persist edits as they are made; do not depend on a blur before export.
  name.addEventListener('input', async () => {
    if (!project) return;
    const value = name.value;
    project = { ...project, name: value }; onRename();
    saving++;
    try {
      const reply = await ext.runtime.sendMessage({ type: 'rename-project', projectId: project.id, name: value });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not save project name');
    } catch (error) { status.textContent = error.message; }
    finally { saving--; }
  });
  button.addEventListener('click', () => showDialog('new'));
  cancel.addEventListener('click', () => { if (!saving) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !project || project.id !== targetId) return;
    const value = dialogName.value.trim();
    if (!value) { error.textContent = 'Enter a project name.'; dialogName.focus(); return; }
    let chosenLanguage;
    try { chosenLanguage = validateLanguage(dialogLanguage.value); } catch (failure) { error.textContent = failure.message; dialogLanguage.focus(); return; }
    saving++; dialogLanguage.disabled = true; submit.disabled = cancel.disabled = dialogName.disabled = true;
    name.disabled = button.disabled = true; error.textContent = '';
    try {
      const reply = await ext.runtime.sendMessage({ type: mode === 'new' ? 'new-project' : 'rename-project', projectId: targetId, name: value, language: chosenLanguage });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not save project');
      apply(reply.project); if (dialog.open) dialog.close();
    } catch (failure) { error.textContent = failure.message; }
    finally {
      saving--; dialogLanguage.disabled = false; submit.disabled = cancel.disabled = dialogName.disabled = false;
      name.disabled = button.disabled = false;
    }
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
  return { ready, setLanguage, isSaving: () => saving > 0, snapshot: () => project ? { ...project, name: name.value.trim() || 'Untitled project' } : { name: 'Untitled project' } };
}
export function projectFilename(name) {
  return (name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'bootcat-corpus');
}

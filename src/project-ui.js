import { getExtensionAPI } from './extension-api.js';
export function initProjectUI({ onReset, onRename }) {
  const ext = getExtensionAPI();
  const name = document.getElementById('project-name');
  const button = document.getElementById('new-project');
  const status = document.getElementById('project-status');
  let project = null;
  name.disabled = button.disabled = true;
  function apply(next) {
    if (!next) return;
    if (project && next.id !== project.id) { onReset(); return; }
    project = next; if (document.activeElement !== name) name.value = next.name; onRename();
    name.disabled = button.disabled = false;
  }
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.project?.newValue) apply(changes.project.newValue);
  });
  const ready = ext.runtime.sendMessage({ type: 'get-project' }).then(reply => {
    if (!reply?.ok) throw new Error(reply?.error || 'Could not load project');
    apply(reply.project);
  }).catch(error => { status.textContent = error.message; });
  // Persist edits as they are made; do not depend on a blur before export.
  name.addEventListener('input', async () => {
    if (!project) return;
    const value = name.value;
    project = { ...project, name: value }; onRename();
    try {
      const reply = await ext.runtime.sendMessage({ type: 'rename-project', projectId: project.id, name: value });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not save project name');
    } catch (error) { status.textContent = error.message; }
  });
  button.addEventListener('click', async () => {
    if (!window.confirm('Create a new project? This clears the current project name, saved searches, URL list, downloaded pages, corpus texts, selections, pending page saves and preview everywhere in BootCaT. Export your corpus first if you want to keep it.')) return;
    name.disabled = button.disabled = true;
    try {
      const reply = await ext.runtime.sendMessage({ type: 'new-project' });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not create project');
    } catch (error) {
      status.textContent = error.message; name.disabled = button.disabled = false;
    }
  });
  return { ready, snapshot: () => project ? { ...project, name: name.value.trim() || 'Untitled project' } : { name: 'Untitled project' } };
}
export function projectFilename(name) {
  return (name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'bootcat-corpus');
}

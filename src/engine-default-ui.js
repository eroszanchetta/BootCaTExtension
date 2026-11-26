import { SETTINGS_KEY } from './settings.js';
import { SEARCH_ENGINE_NAMES } from './search-engine-options.js';
import { getExtensionAPI } from './extension-api.js';

export function initEngineDefaultUI({ getProjectId }) {
  const ext = getExtensionAPI(), select = document.getElementById('engine');
  const button = document.getElementById('make-default-engine'), status = document.getElementById('engine-default-status');
  let defaultEngine = null, revision = -1, saving = false, destroyed = false;
  function controls() { button.disabled = destroyed || saving || !defaultEngine || !getProjectId() || select.value === defaultEngine; }
  function apply(settings) {
    if (destroyed || settings.revision < revision) return;
    revision = settings.revision; defaultEngine = settings.values.defaultEngine;
    status.textContent = `Default for new projects: ${SEARCH_ENGINE_NAMES[defaultEngine]}.`;
    controls();
  }
  async function refresh() {
    try {
      const reply = await ext.runtime.sendMessage({ type: 'get-settings' });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not load the default search engine.');
      apply(reply.settings);
    } catch (error) { if (!destroyed) { status.textContent = error.message; controls(); } }
  }
  select.addEventListener('change', () => {
    if (!saving && defaultEngine) status.textContent = `Default for new projects: ${SEARCH_ENGINE_NAMES[defaultEngine]}.`;
    controls();
  });
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const engine = select.value;
    saving = true; controls(); status.textContent = 'Saving default search engine…';
    try {
      const reply = await ext.runtime.sendMessage({ type: 'set-default-search-engine', projectId: getProjectId(), engine });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not save the default search engine.');
      apply(reply.settings);
    } catch (error) { if (!destroyed) status.textContent = error.message; }
    finally { saving = false; controls(); }
  });
  ext.storage.onChanged.addListener((changes, area) => { if (!destroyed && area === 'local' && changes[SETTINGS_KEY]) refresh(); });
  refresh();
  return { refreshSelection: controls, destroy() { destroyed = true; controls(); } };
}

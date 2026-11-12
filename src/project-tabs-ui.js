import { getExtensionAPI } from './extension-api.js';
import { SEARCH_TABS_KEY } from './project-search-tabs.js';
export function initProjectTabsUI({ getProjectId }) {
  const ext = getExtensionAPI(), el = id => document.getElementById(id);
  let destroyed = false, revision = 0, state = { count: 0, batch: null };
  function render() {
    const batch = state.batch;
    el('project-tab-count').textContent = `${state.count} project search tab${state.count === 1 ? '' : 's'} tracked in this browser session.`;
    el('collect-project-tabs').disabled = !!batch?.running || !state.count;
    el('stop-project-tabs').hidden = !batch?.running;
    el('stop-project-tabs').disabled = !!batch?.stopping;
    el('project-tab-details').replaceChildren();
    if (!batch) { el('project-tab-status').textContent = 'Open queries using BootCaT to include their tabs here.'; return; }
    const prefix = batch.interrupted ? 'Collection was interrupted. Saved results remain; click Collect again to continue. ' : batch.stopping ? 'Stopping… ' : batch.stopped ? 'Stopped. ' : batch.running ? 'Collecting… ' : 'Finished. ';
    el('project-tab-status').textContent = `${prefix}${batch.processed} of ${batch.total} tab${batch.total === 1 ? '' : 's'} processed. ${batch.saved} result page${batch.saved === 1 ? '' : 's'} saved; ${batch.closed} tab${batch.closed === 1 ? '' : 's'} closed; ${batch.leftOpen} left open; ${batch.skipped} skipped.${batch.processed > 100 ? ' Showing the first 100 outcomes below.' : ''}`;
    for (const detail of batch.details) {
      const item = document.createElement('li'); item.textContent = `${detail.query}: ${detail.reason}`; el('project-tab-details').append(item);
    }
  }
  async function refresh() {
    const request = ++revision, projectId = getProjectId();
    if (!projectId || destroyed) return;
    try {
      const reply = await ext.runtime.sendMessage({ type: 'get-project-search-tabs', projectId });
      if (destroyed || request !== revision || getProjectId() !== projectId) return;
      if (!reply?.ok) throw new Error(reply?.error || 'Could not read project search tabs.');
      state = reply; render();
    } catch (error) { if (!destroyed && request === revision) el('project-tab-status').textContent = error.message; }
  }
  async function action(type) {
    el('collect-project-tabs').disabled = true;
    if (type === 'stop-project-search-tabs') el('stop-project-tabs').disabled = true;
    try {
      const reply = await ext.runtime.sendMessage({ type, projectId: getProjectId() });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not collect project search tabs.');
      await refresh();
    } catch (error) {
      if (!destroyed) { revision++; render(); el('project-tab-status').textContent = error.message; }
    }
  }
  el('collect-project-tabs').addEventListener('click', () => action('collect-project-search-tabs'));
  el('stop-project-tabs').addEventListener('click', () => action('stop-project-search-tabs'));
  ext.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes[SEARCH_TABS_KEY] && !destroyed) refresh(); });
  refresh();
  return { refresh, destroy() { destroyed = true; revision++; } };
}

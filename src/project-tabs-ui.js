import { openWorkspaceSection } from './workspace-sections.js';
import { getExtensionAPI } from './extension-api.js';
import { SEARCH_TABS_KEY } from './project-search-tabs.js';
export function initProjectTabsUI({ getProjectId, onState = () => {} }) {
  const ext = getExtensionAPI(), el = id => document.getElementById(id);
  let collectingBatchId = null, opening = false, timer;
  let destroyed = false, revision = 0, state = { count: 0, batch: null };
  function render() {
    const batch = state.batch;
    const loading = state.loading || 0, loaded = state.loaded ?? state.count;
    el('project-tab-count').textContent = `${loaded} of ${state.count} project search tabs loaded.${opening ? ' Opening search tabs…' : loading ? ' Waiting for loading to finish.' : ''}`;
    el('collect-project-tabs').disabled = opening || !!batch?.running || !state.count || loading > 0;
    const skip = el('collect-loaded-tabs');
    skip.hidden = !loading || !(state.tabs || []).some(tab => tab.slow);
    skip.disabled = opening || !!batch?.running || !loaded;
    el('project-tab-loading-hint').textContent = skip.hidden ? '' : 'Some tabs are taking a long time to load. Inspect or close them, or collect the loaded tabs and leave the others open.';
    el('stop-project-tabs').hidden = !batch?.running;
    el('stop-project-tabs').disabled = !!batch?.stopping;
    el('project-tab-details').replaceChildren();
    if (!batch) { el('project-tab-status').textContent = 'Open queries using BootCaT to include their tabs here.'; return; }
    const prefix = batch.interrupted ? 'Collection was interrupted. Saved results remain; click Collect again to continue. ' : batch.stopping ? 'Stopping… ' : batch.stopped ? 'Stopped. ' : batch.running ? 'Collecting… ' : 'Finished. ';
    el('project-tab-status').textContent = `${prefix}${batch.processed} of ${batch.total} tab${batch.total === 1 ? '' : 's'} processed. ${batch.saved} result page${batch.saved === 1 ? '' : 's'} saved; ${batch.closed} tab${batch.closed === 1 ? '' : 's'} closed; ${batch.leftOpen} left open; ${batch.skipped} skipped.${batch.processed > 100 ? ' Showing the first 100 outcomes below.' : ''}`;
    if (collectingBatchId && batch.id === collectingBatchId && !batch.running) {
      collectingBatchId = null;
      if (!state.count && batch.total > 0 && batch.closed === batch.total && batch.saved === batch.total && batch.processed === batch.total && !batch.leftOpen && !batch.skipped && !batch.stopped && !batch.stopping && !batch.interrupted) {
        openWorkspaceSection('urls-section', { scroll: true });
      }
    }
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
      state = reply; render(); onState(state);
      clearTimeout(timer);
      if (state.loading) timer = setTimeout(refresh, 1000);
    } catch (error) { if (!destroyed && request === revision) el('project-tab-status').textContent = error.message; }
  }
  async function action(type, loadedOnly = false) {
    el('collect-project-tabs').disabled = true;
    if (type === 'stop-project-search-tabs') { collectingBatchId = null; el('stop-project-tabs').disabled = true; }
    try {
      const reply = await ext.runtime.sendMessage({ type, projectId: getProjectId(), ...(loadedOnly ? { loadedOnly: true } : {}) });
      if (destroyed) return;
      if (!reply?.ok) throw new Error(reply?.error || 'Could not collect project search tabs.');
      if (type === 'collect-project-search-tabs') collectingBatchId = reply.batch?.id || null;
      await refresh();
    } catch (error) {
      collectingBatchId = null;
      if (!destroyed) { revision++; render(); el('project-tab-status').textContent = error.message; }
    }
  }
  el('collect-project-tabs').addEventListener('click', () => action('collect-project-search-tabs'));
  el('collect-loaded-tabs').addEventListener('click', () => action('collect-project-search-tabs', true));
  el('stop-project-tabs').addEventListener('click', () => action('stop-project-search-tabs'));
  ext.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes[SEARCH_TABS_KEY] && !destroyed) refresh(); });
  refresh();
  return { refresh, setOpening(value) { opening = value; if (!destroyed) render(); }, destroy() { destroyed = true; clearTimeout(timer); collectingBatchId = null; revision++; } };
}

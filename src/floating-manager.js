import { COLLECTION_CONTROLS_KEY, readCollectionControls } from './collection-preferences.js';
const SCRIPT_ID = 'bootcat-floating-controls';
const web = tab => Number.isInteger(tab?.id) && /^https?:\/\//.test(tab.url || '');
export function createFloatingManager({ ext, getProject }) {
  let chain = Promise.resolve();
  const supported = () => typeof ext.scripting?.getRegisteredContentScripts === 'function';
  async function notify(tab) {
    if (!web(tab)) return;
    try { await ext.tabs.sendMessage(tab.id, { type: 'bootcat-floating-refresh' }, { frameId: 0 }); } catch {}
  }
  async function install(tab) {
    if (!web(tab)) return;
    try { await ext.scripting.executeScript({ target: { tabId: tab.id }, files: ['floating-control.js'] }); } catch { /* Protected pages keep the popup fallback. */ }
  }
  async function synchronize() {
    if (!supported()) return;
    const preferences = await readCollectionControls(ext.storage.local), project = await getProject();
    const enabled = preferences.floatingEnabled && !!project;
    const registered = await ext.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (enabled && !registered.length) await ext.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: ['http://*/*', 'https://*/*'], js: ['floating-control.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]);
    if (!enabled && registered.length) await ext.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    const tabs = await ext.tabs.query({});
    // Bound bursts of injections when an existing project has many open tabs.
    for (let i = 0; i < tabs.length; i += 8) await Promise.allSettled(tabs.slice(i, i + 8).map(tab => enabled ? install(tab) : notify(tab)));
  }
  function sync() { const next = chain.then(synchronize); chain = next.catch(() => {}); return next; }
  ext.storage.onChanged?.addListener((changes, area) => { if (area !== 'local') return;
    if (changes.project || changes[COLLECTION_CONTROLS_KEY]) sync().catch(() => {});
    else if (changes.captureRevision || changes.collections || changes.workspaceRevision) readCollectionControls(ext.storage.local).then(preferences => preferences.floatingEnabled ? ext.tabs.query({}).then(tabs => Promise.allSettled(tabs.map(notify))) : undefined).catch(() => {}); });
  ext.tabs.onUpdated?.addListener((id, change, tab) => { if (supported() && (change.status === 'complete' || change.url)) {
    readCollectionControls(ext.storage.local).then(async preferences => { if (preferences.floatingEnabled && await getProject()) return install({ ...tab, id }); }).catch(() => {});
  } });
  ext.runtime.onStartup?.addListener(() => sync().catch(() => {}));
  ext.runtime.onInstalled?.addListener(() => sync().catch(() => {}));
  sync().catch(() => {});
  return { sync };
}

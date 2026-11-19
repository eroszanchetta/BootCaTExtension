const pageURL = value => { const url = new URL(value); url.hash = ''; return url.href; };
// Background-owned work survives the popup closing. Only tabs participating in
// an action are watched; navigation/reload fences apply to tracked and untracked tabs.
export function createCollectionActions({ ext, serialize, assertProject }) {
  const watchers = new Map(), pending = new Map();
  ext.tabs.onUpdated?.addListener((id, change) => {
    if (change.url || change.status === 'loading' || change.discarded) for (const item of watchers.get(id) || []) item.changed = true;
  });
  ext.tabs.onRemoved?.addListener(id => { for (const item of watchers.get(id) || []) item.closed = true; });
  async function closeSaved(snapshot) {
    try {
      return await serialize(async () => {
        await assertProject(snapshot.projectId);
        if (snapshot.closed) return { closed: true };
        let tab;
        try { tab = await ext.tabs.get(snapshot.tab.id); }
        catch { return { closed: true }; }
        if (snapshot.changed || snapshot.tab.status !== 'complete' || tab.status !== 'complete' || tab.discarded || pageURL(tab.pendingUrl || tab.url) !== pageURL(snapshot.tab.url)) return { closed: false, closeWarning: 'Saved successfully. The tab changed or is loading, so it was left open.' };
        await ext.tabs.remove(tab.id);
        return { closed: true };
      });
    } catch (error) { return { closed: false, closeWarning: `Saved successfully, but the tab was left open: ${error.message}` }; }
  }
  async function run({ projectId, tabId, action, closeAfterSuccess }, task) {
    const tab = await ext.tabs.get(tabId), url = pageURL(tab.url);
    if (!/^https?:\/\//.test(url)) throw new Error('Open a web page first.');
    const key = JSON.stringify([projectId, tabId, action, url]);
    if (pending.has(key)) return pending.get(key);
    const snapshot = { projectId, tab, changed: false, closed: false };
    if (!watchers.has(tabId)) watchers.set(tabId, new Set());
    watchers.get(tabId).add(snapshot);
    const work = (async () => {
      try {
        const result = await Promise.resolve().then(() => task(tab));
        if (!closeAfterSuccess) return result;
        if (result.unresolved) return { ...result, closed: false, closeWarning: 'Some search links could not be collected. The tab was left open for review.' };
        return { ...result, ...await closeSaved(snapshot) };
      } finally {
        watchers.get(tabId)?.delete(snapshot);
        if (!watchers.get(tabId)?.size) watchers.delete(tabId);
        pending.delete(key);
      }
    })();
    pending.set(key, work); return work;
  }
  return { run };
}

import { captureCurrentPage } from './page-capture.js';
import { savePage } from './page-store.js';
import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { adapterForURL, extractResults } from "./engines.js";
import { addCollection } from "./collection.js";

// Serialize storage read/modify/write operations, including Clear.
let writes = Promise.resolve();
function serialize(task) {
  const next = writes.then(task);
  writes = next.catch(() => {});
  return next;
}
async function handle(message) {
  if (message.type === "open-workspace") {
    const url = ext.runtime.getURL("downloader.html");
    const tabs = (await ext.tabs.query({})).filter(tab => tab.url === url);
    if (tabs.length) {
      await ext.tabs.update(tabs[0].id, { active: true });
      await ext.windows.update(tabs[0].windowId, { focused: true });
    } else await ext.tabs.create({ url });
    return {};
  }
  if (message.type === "clear-collections") return serialize(async () => {
    await ext.storage.local.set({ collections: [] });
    return {};
  });
  if (message.type === 'save-page') {
    const tab = await ext.tabs.get(message.tabId);
    if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Open a web page first.');
    const injected = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: captureCurrentPage });
    const page = injected[0]?.result;
    if (!page || page.error) throw new Error(page?.error || 'Could not read this page.');
    await savePage({ ...page, id: crypto.randomUUID() });
    // The snapshot remains saved even if the optional UI notification fails.
    try { await ext.storage.local.set({ captureRevision: crypto.randomUUID() }); } catch {}
    const url = ext.runtime.getURL('downloader.html');
    if (!(await ext.tabs.query({})).some(tab => tab.url === url)) {
      await ext.tabs.create({ url, active: false });
    }
    return {};
  }
  if (message.type !== "collect") throw new Error("Unknown request");
  const tab = await ext.tabs.get(message.tabId);
  const adapter = adapterForURL(tab.url);
  if (!adapter) throw new Error("Open a Google, DuckDuckGo or Ecosia web results page first.");
  const injected = await ext.scripting.executeScript({
    target: { tabId: tab.id }, func: extractResults, args: [adapter]
  });
  const result = injected[0]?.result;
  if (!result || result.error) throw new Error(result?.error || "Could not read this results page.");
  if (!result.results.length) throw new Error(`No usable results found. ${result.unresolved ? `${result.unresolved} candidate links could not be resolved. ` : ""}The page may be a consent screen, CAPTCHA, or an unsupported layout. Try another engine or paste URLs in the workspace.`);
  return serialize(async () => {
    const { collections = [] } = await ext.storage.local.get("collections");
    const collection = { ...result, id: crypto.randomUUID(), collectedAt: new Date().toISOString() };
    await ext.storage.local.set({ collections: addCollection(collections, collection) });
    return { count: result.results.length, unresolved: result.unresolved, engine: adapter.name };
  });
}
ext.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our bundled UI can call this handler. There are no content scripts.
  if (sender.id !== ext.runtime.id || !sender.url?.startsWith(ext.runtime.getURL(""))) return;
  handle(message).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
  return true; // Keep the asynchronous reply channel open.
});

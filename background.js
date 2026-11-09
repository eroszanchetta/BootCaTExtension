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
    const url = chrome.runtime.getURL("downloader.html");
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else await chrome.tabs.create({ url });
    return {};
  }
  if (message.type === "clear-collections") return serialize(async () => {
    await chrome.storage.local.set({ collections: [] });
    return {};
  });
  if (message.type !== "collect") throw new Error("Unknown request");
  const tab = await chrome.tabs.get(message.tabId);
  const adapter = adapterForURL(tab.url);
  if (!adapter) throw new Error("Open a Google, DuckDuckGo or Ecosia web results page first.");
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, func: extractResults, args: [adapter]
  });
  const result = injected[0]?.result;
  if (!result || result.error) throw new Error(result?.error || "Could not read this results page.");
  if (!result.results.length) throw new Error(`No usable results found. ${result.unresolved ? `${result.unresolved} candidate links could not be resolved. ` : ""}The page may be a consent screen, CAPTCHA, or an unsupported layout. Try another engine or paste URLs in the workspace.`);
  return serialize(async () => {
    const { collections = [] } = await chrome.storage.local.get("collections");
    const collection = { ...result, id: crypto.randomUUID(), collectedAt: new Date().toISOString() };
    await chrome.storage.local.set({ collections: addCollection(collections, collection) });
    return { count: result.results.length, unresolved: result.unresolved, engine: adapter.name };
  });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our bundled UI can call this handler. There are no content scripts.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  handle(message).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
  return true; // Keep the asynchronous reply channel open.
});

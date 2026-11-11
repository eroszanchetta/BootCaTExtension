import { ensureStoredProject, resetStoredProject, storedProjectId } from './project-store.js';
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
async function ensureProject() {
  let { project } = await ext.storage.local.get('project');
  const storedId = await storedProjectId();
  if (storedId && project?.id !== storedId) {
    // Recover a reset interrupted between the atomic database clear and the
    // storage.local notification. Never attach an old project's collections.
    project = { id: storedId, name: 'Untitled project' };
    await ext.storage.local.clear();
    await ext.storage.local.set({ project, collections: [], captureRevision: crypto.randomUUID() });
  }
  if (!project) {
    project = { id: crypto.randomUUID(), name: 'Untitled project' };
    await ext.storage.local.set({ project });
  }
  await ensureStoredProject(project.id);
  return project;
}
async function assertProject(id) {
  if ((await ensureProject()).id !== id) throw new Error('The project changed. Collect or save the page again for the new project.');
}
async function ensureWorkspace() {
  const url = ext.runtime.getURL('downloader.html');
  if (!(await ext.tabs.query({})).some(tab => tab.url === url)) await ext.tabs.create({ url, active: false });
}
async function handle(message) {
  if (message.type === 'get-project') return serialize(async () => ({ project: await ensureProject() }));
  if (message.type === 'rename-project') return serialize(async () => {
    await assertProject(message.projectId);
    const project = { id: message.projectId, name: String(message.name).slice(0, 120) };
    await ext.storage.local.set({ project });
    return { project };
  });
  if (message.type === 'new-project') return serialize(async () => {
    // Serialize with collection/capture writes so stale work cannot survive reset.
    const project = { id: crypto.randomUUID(), name: 'Untitled project' };
    await resetStoredProject(project.id);
    await ext.storage.local.clear();
    await ext.storage.local.set({ project, collections: [], captureRevision: crypto.randomUUID() });
    return { project };
  });
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
    const project = await serialize(ensureProject);
    const tab = await ext.tabs.get(message.tabId);
    if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Open a web page first.');
    if (adapterForURL(tab.url)) throw new Error('Use Collect results from this tab for a search results page.');
    const injected = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: captureCurrentPage });
    const page = injected[0]?.result;
    if (!page || page.error) throw new Error(page?.error || 'Could not read this page.');
    return serialize(async () => {
      await assertProject(project.id);
      await savePage({ ...page, id: crypto.randomUUID() });
      try { await ext.storage.local.set({ captureRevision: crypto.randomUUID() }); } catch {}
      await ensureWorkspace();
      return {};
    });
  }
  if (message.type !== "collect") throw new Error("Unknown request");
  const project = await serialize(ensureProject);
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
    await assertProject(project.id);
    const { collections = [] } = await ext.storage.local.get("collections");
    const collection = { ...result, id: crypto.randomUUID(), collectedAt: new Date().toISOString() };
    await ext.storage.local.set({ collections: addCollection(collections, collection) });
    await ensureWorkspace();
    return { count: result.results.length, unresolved: result.unresolved, engine: adapter.name };
  });
}
ext.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our bundled UI can call this handler. There are no content scripts.
  if (sender.id !== ext.runtime.id || !sender.url?.startsWith(ext.runtime.getURL(""))) return;
  handle(message).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
  return true; // Keep the asynchronous reply channel open.
});

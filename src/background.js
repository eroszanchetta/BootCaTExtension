import { resetProjectLocalState } from './project-local-state.js';
import { readUserDefaults, saveUserDefaults } from './user-defaults.js';
import { validateLanguage } from './language-detection.js';
import { ensureStoredProject, resetStoredProject, storedProjectId, hasStoredPage } from './project-store.js';
import { captureTabDocument } from './pdf-recovery.js';
import { savePage } from './page-store.js';
import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { adapterForURL, extractResults } from "./engines.js";
import { addCollection } from "./collection.js";
import { createProjectSearchTabs, matchesProjectSearch } from './project-search-tabs.js';
let searchTabs;

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
    project = { id: storedId, name: 'Untitled project', nameConfirmed: false };
    await searchTabs?.resetInQueue();
    await resetProjectLocalState(ext.storage.local, project);
  }
  if (!project) {
    project = { id: crypto.randomUUID(), name: 'Untitled project', nameConfirmed: false };
    await ext.storage.local.set({ project });
  }
  await ensureStoredProject(project.id, !storedId ? await readUserDefaults(ext.storage.local) : undefined);
  return project;
}
async function assertProject(id) {
  if ((await ensureProject()).id !== id) throw new Error('The project changed. Collect or save the page again for the new project.');
}
async function workspaceTabs() {
  const url = ext.runtime.getURL('downloader.html');
  if (typeof ext.runtime.getContexts === 'function') {
    // Own extension pages can have their URL hidden in tabs.query without the
    // broad tabs permission. Contexts exposes only this extension's documents.
    const contexts = await ext.runtime.getContexts({ contextTypes: ['TAB'] });
    const ids = [...new Set(contexts.filter(context => context.documentUrl?.split('#')[0] === url && context.tabId >= 0).map(context => context.tabId))];
    const tabs = await Promise.all(ids.map(id => ext.tabs.get(id).catch(() => null)));
    return tabs.filter(Boolean);
  }
  return (await ext.tabs.query({})).filter(tab => tab.url?.split('#')[0] === url);
}
async function ensureWorkspace() {
  if (!(await workspaceTabs()).length) await ext.tabs.create({ url: ext.runtime.getURL('downloader.html'), active: false });
}
async function collectPage(tabId, projectId, expected) {
  const tab = await ext.tabs.get(tabId);
  const adapter = adapterForURL(tab.url);
  if (!adapter) throw new Error('Open a Google, DuckDuckGo or Ecosia web results page first.');
  const marker = expected ? null : await searchTabs.collectionMarker(projectId, tabId, tab.url);
  const injected = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: extractResults, args: [adapter] });
  const result = injected[0]?.result;
  if (!result || result.error) throw new Error(result?.error || 'Could not read this results page.');
  if (expected && (!matchesProjectSearch(expected.record, result.pageURL) || new URL(result.pageURL).href.split('#')[0] !== expected.url)) throw new Error('The tab changed during collection; left open.');
  if (!result.results.length) throw new Error(`No usable results found. ${result.unresolved ? `${result.unresolved} candidate links could not be resolved. ` : ''}The page may be a consent screen, CAPTCHA, or an unsupported layout. Try another engine or paste URLs in the workspace.`);
  return serialize(async () => {
    await assertProject(projectId);
    const { collections = [] } = await ext.storage.local.get('collections');
    const collection = { ...result, id: crypto.randomUUID(), collectedAt: new Date().toISOString() };
    await ext.storage.local.set({ collections: addCollection(collections, collection) });
    if (marker) await searchTabs.markCollectedInQueue(marker, result);
    await ensureWorkspace();
    return { count: result.results.length, unresolved: result.unresolved, engine: adapter.name };
  });
}
searchTabs = createProjectSearchTabs({ ext, serialize, assertProject, collectPage });
async function handle(message) {
  if (message.type === 'open-project-search') return searchTabs.open(message);
  if (message.type === 'get-project-search-tabs') return searchTabs.getState(message.projectId);
  if (message.type === 'collect-project-search-tabs') return searchTabs.start(message.projectId, { loadedOnly: message.loadedOnly === true });
  if (message.type === 'focus-project-search-tab') return searchTabs.focus(message.projectId, message.tabId);
  if (message.type === 'stop-project-search-tabs') return searchTabs.stop(message.projectId);
  if (message.type === 'save-user-defaults') return serialize(async () => {
    await assertProject(message.projectId);
    return { defaults: await saveUserDefaults(ext.storage.local, message.patch) };
  });
  if (message.type === 'get-project') return serialize(async () => ({ project: await ensureProject() }));
  if (message.type === 'rename-project') return serialize(async () => {
    await assertProject(message.projectId);
    const current = await ensureProject();
    const project = { ...current, id: message.projectId, ...(message.language !== undefined ? { language: validateLanguage(message.language) } : {}), name: String(message.name).slice(0, 120), nameConfirmed: Boolean(String(message.name).trim()) };
    await ext.storage.local.set({ project });
    return { project };
  });
  if (message.type === 'set-project-language') return serialize(async () => {
    await assertProject(message.projectId);
    const project = { ...(await ensureProject()), language: validateLanguage(message.language) };
    await ext.storage.local.set({ project }); return { project };
  });
  if (message.type === 'new-project') return serialize(async () => {
    // Serialize with collection/capture writes so stale work cannot survive reset.
    if (message.projectId) await assertProject(message.projectId);
    const chosenName = typeof message.name === 'string' ? message.name.trim().slice(0, 120) : '';
    const project = { language: validateLanguage(message.language ?? 'none'), id: crypto.randomUUID(), name: chosenName || 'Untitled project', nameConfirmed: Boolean(chosenName) };
    await resetStoredProject(project.id, await readUserDefaults(ext.storage.local));
    await searchTabs.resetInQueue();
    await resetProjectLocalState(ext.storage.local, project);
    return { project };
  });
  if (message.type === "open-workspace") {
    const url = ext.runtime.getURL("downloader.html");
    const tabs = await workspaceTabs();
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
  if (message.type === 'get-page-corpus-state') {
    const tab = await ext.tabs.get(message.tabId);
    return serialize(async () => {
      const project = await ensureProject();
      return { projectId: project.id, saved: await hasStoredPage(project.id, tab.url) };
    });
  }
  if (message.type === 'save-page') {
    const project = await serialize(ensureProject);
    const tab = await ext.tabs.get(message.tabId);
    if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Open a web page first.');
    if (adapterForURL(tab.url)) throw new Error('Use Collect results from this tab for a search results page.');
    const saved = await serialize(async () => { await assertProject(project.id); return hasStoredPage(project.id, tab.url); });
    if (saved) { await ensureWorkspace(); return { alreadySaved: true }; }
    const page = await captureTabDocument(tab, ext.scripting);
    return serialize(async () => {
      await assertProject(project.id);
      if (await hasStoredPage(project.id, page.url)) return { alreadySaved: true };
      await savePage({ ...page, id: crypto.randomUUID() });
      try { await ext.storage.local.set({ captureRevision: crypto.randomUUID() }); } catch {}
      await ensureWorkspace();
      return {};
    });
  }
  if (message.type !== "collect") throw new Error("Unknown request");
  const project = await serialize(ensureProject);
  return collectPage(message.tabId, project.id);
}
ext.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our bundled UI can call this handler. There are no content scripts.
  if (sender.id !== ext.runtime.id || !sender.url?.startsWith(ext.runtime.getURL(""))) return;
  handle(message).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
  return true; // Keep the asynchronous reply channel open.
});

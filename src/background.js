import { createDownloadFeedback } from './download-feedback.js';
import { collectionFailure, collectionLinkWarning } from './search-feedback.js';
import { stageProject, readStagedProject, removeStagedProject } from './project-transfer.js';
import { validateProjectSnapshot, restoredProjectSnapshot } from './portable-project.js';
import { readCollectionControls, saveCollectionControls } from './collection-preferences.js';
import { createCollectionActions } from './collection-actions.js';
import { createFloatingManager } from './floating-manager.js';
import { readSettings, readSettingsState, saveSettings } from './settings.js';
import { resetProjectLocalState } from './project-local-state.js';
import { readUserDefaults, saveUserDefaults } from './user-defaults.js';
import { validateLanguage } from './language-detection.js';
import { loadWorkspace, ensureStoredProject, resetStoredProject, closeStoredProject, storedProjectState, hasStoredPage, getDeletionVersion, snapshotStoredProject, replaceStoredProject } from './project-store.js';
import { captureTabDocument } from './pdf-recovery.js';
import { savePage, listSavedPages } from './page-store.js';
import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { adapterForURL, extractResults } from "./engines.js";
import { parseURLs } from './core.js';
import { matchingCollection, addCollection } from "./collection.js";
import { createProjectSearchTabs, matchesProjectSearch } from './project-search-tabs.js';
let searchTabs;
const captures = new Map();

// Serialize storage read/modify/write operations, including Clear.
let writes = Promise.resolve();
function serialize(task) {
  const next = writes.then(task);
  writes = next.catch(() => {});
  return next;
}
async function ensureProject() {
  let { project } = await ext.storage.local.get('project');
  const stored = await storedProjectState(), storedId = stored?.projectId;
  if (storedId === null) {
    await searchTabs?.resetInQueue();
    if (project) await resetProjectLocalState(ext.storage.local, null);
    return null;
  }
  if (storedId && project?.id !== storedId) {
    // Recover a reset interrupted between the atomic database clear and the
    // storage.local notification. Never attach an old project's collections.
    project = stored.project || { id: storedId, name: 'Untitled project', nameConfirmed: false };
    await searchTabs?.resetInQueue();
    await resetProjectLocalState(ext.storage.local, project, stored.collections || []);
  }
  if (!project) {
    return null;
  }
  await ensureStoredProject(project.id, !storedId ? await readUserDefaults(ext.storage.local) : undefined);
  return project;
}
async function assertProject(id) {
  const project = await ensureProject();
  if (!project) throw new Error('No active project. Create a project in BootCaT first.');
  if (project.id !== id) throw new Error('The project changed. Collect or save the page again for the new project.');
  return project;
}
async function requireProject() {
  const project = await ensureProject();
  if (!project) throw new Error('No active project. Create a project in BootCaT first.');
  return project;
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
async function workspaceNotice() {
  try { await ensureWorkspace(); return {}; }
  catch { return { workspaceWarning: 'Saved in BootCaT. Open the workspace from the extension popup to continue.' }; }
}
async function collectPage(tabId, projectId, expected, expectedURL) {
  const settings = await readSettings(ext.storage.local);
  const tab = await ext.tabs.get(tabId);
  if (expectedURL && canonicalURL(tab.url) !== canonicalURL(expectedURL)) throw new Error('The tab changed. Collect the current page again.');
  const adapter = adapterForURL(tab.url);
  if (!adapter) throw new Error('Open a Google, DuckDuckGo or Ecosia web results page first.');
  const marker = expected ? null : await searchTabs.collectionMarker(projectId, tabId, tab.url);
  const injected = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: extractResults, args: [adapter] });
  const result = injected[0]?.result;
  if (expectedURL && result?.pageURL && canonicalURL(result.pageURL) !== canonicalURL(expectedURL)) throw new Error('The tab changed during collection. Collect the current page again.');
  if (!result || result.error) throw new Error(result?.error || 'Could not read this results page.');
  if (expected && (!matchesProjectSearch(expected.record, result.pageURL) || new URL(result.pageURL).href.split('#')[0] !== expected.url)) throw new Error('The tab changed during collection; left open.');
  if (!result.results.length) throw new Error(collectionFailure(result));
  return serialize(async () => {
    await assertProject(projectId);
    const { collections = [] } = await ext.storage.local.get('collections');
    const workspace = await loadWorkspace(projectId);
    const known = new Set([...parseURLs(workspace.draft.urls || '').urls, ...collections.flatMap(item => item.results.map(result => result.url))]);
    const added = result.results.filter(item => !known.has(item.url)).length;
    const duplicates = result.results.length - added;
    const collection = { ...result, added, duplicates, id: crypto.randomUUID(), collectedAt: new Date().toISOString() };
    await ext.storage.local.set({ collections: addCollection(collections, collection, settings) });
    if (marker) await searchTabs.markCollectedInQueue(marker, result);
    const notice = await workspaceNotice();
    return { count: result.results.length, added, duplicates, collectionId: collection.id, resultSetKey: result.resultSetKey, unresolved: result.unresolved, engine: adapter.name, linkWarning: collectionLinkWarning(result), ...notice };
  });
}
searchTabs = createProjectSearchTabs({ ext, serialize, assertProject, collectPage });

const canonicalURL = value => { const url = new URL(value); url.hash = ''; return url.href; };
const namedProject = project => !!project && (project.nameConfirmed === true || (project.nameConfirmed == null && !!project.name?.trim() && project.name !== 'Untitled project'));
const collectionActions = createCollectionActions({ ext, serialize, assertProject, verifyBeforeClose: async (tab, result) => {
  const adapter = adapterForURL(tab.url);
  if (adapter?.id !== 'duckduckgo') return true;
  const snapshot = (await ext.scripting.executeScript({ target: { tabId: tab.id }, func: extractResults, args: [adapter] }))[0]?.result;
  return !!result.resultSetKey && snapshot?.resultSetKey === result.resultSetKey && canonicalURL(snapshot.pageURL) === canonicalURL(tab.url);
} });
const floatingControls = createFloatingManager({ ext, getProject: () => serialize(ensureProject) });
async function isSavedPage(projectId, url) {
  if (await hasStoredPage(projectId, url)) return true;
  return (await listSavedPages()).some(page => canonicalURL(page.url) === canonicalURL(url));
}
async function capturePage(message, project, tab) {

    if (message.projectId && message.projectId !== project.id) throw new Error('The project changed. Reopen the BootCaT popup.');

    if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Open a web page first.');
    if (adapterForURL(tab.url)) throw new Error('Use Add URLs from this tab to corpus for a search results page.');
    const saved = await serialize(async () => { await assertProject(project.id); return isSavedPage(project.id, tab.url); });
    if (saved) return { alreadySaved: true, ...await workspaceNotice() };
    const controller = new AbortController(), token = crypto.randomUUID();
    const deletionVersion = await serialize(async () => { await assertProject(project.id); const version = await getDeletionVersion(project.id, tab.url); captures.set(token, controller); return version; });
    try {
      const page = await captureTabDocument(tab, ext.scripting, { signal: controller.signal, settings: await readSettings(ext.storage.local) });
      return await serialize(async () => {
        await assertProject(project.id);
        if (canonicalURL(page.url) !== canonicalURL(tab.url)) throw new Error('The tab changed during capture. Add the current page again.');
        if (await isSavedPage(project.id, page.url)) return { alreadySaved: true };
        await savePage({ ...page, id: crypto.randomUUID() }, project.id, { url: tab.url, version: deletionVersion });
        try { await ext.storage.local.set({ captureRevision: crypto.randomUUID() }); } catch {}
        return workspaceNotice();
      });
    } finally { captures.delete(token); }
}
async function runPageAction(message) {
  const project = await serialize(requireProject);
  if (message.projectId && message.projectId !== project.id) throw new Error('The project changed. Reopen the BootCaT controls.');
  const preferences = await readCollectionControls(ext.storage.local), collect = message.type === 'collect';
  return collectionActions.run({ projectId: project.id, tabId: message.tabId, action: message.type, closeAfterSuccess: collect ? preferences.closeCollectedTab : preferences.closeCapturedTab },
    tab => collect ? collectPage(tab.id, project.id, undefined, tab.url) : capturePage(message, project, tab));
}
async function currentCollection(tab) {
  const engine = adapterForURL(tab.url);
  if (!engine) return null;
  let snapshot;
  if (engine.id === 'duckduckgo') {
    try {
      snapshot = (await ext.scripting.executeScript({ target: { tabId: tab.id }, func: extractResults, args: [engine] }))[0]?.result;
      if (!snapshot || canonicalURL(snapshot.pageURL) !== canonicalURL(tab.url)) return null;
    } catch { return null; } // Unreadable pages must keep the retry action available.
  }
  const { collections = [] } = await ext.storage.local.get('collections');
  return matchingCollection(collections, engine.id, tab.url, snapshot);
}
async function floatingState(tabId) {
  const preferences = await readCollectionControls(ext.storage.local), project = await serialize(ensureProject);
  if (!preferences.floatingEnabled || !namedProject(project)) return { enabled: false };
  const tab = await ext.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url || '')) return { enabled: false };
  const engine = adapterForURL(tab.url);
  const saved = await serialize(async () => {
    await assertProject(project.id);
    if (engine) {
      const item = await currentCollection(tab);
      return !!(item && (!item.unresolved || item.acceptedPartial));
    }
    return isSavedPage(project.id, tab.url);
  });
  return { enabled: true, projectId: project.id, action: engine ? 'collect' : 'save-page', saved, position: preferences.floatingPosition,
    closeAfterSuccess: engine ? preferences.closeCollectedTab : preferences.closeCapturedTab };
}
async function handleFloating(message, sender) {
  const tab = await ext.tabs.get(sender.tab.id);
  // A content script can survive same-document history changes. sender.url can
  // retain its original document address; verify its origin and the isolated
  // script's current address against the browser-owned tab instead.
  if (!/^https?:\/\//.test(tab.url || '') || new URL(tab.url).origin !== new URL(sender.url).origin || canonicalURL(tab.url) !== canonicalURL(message.pageURL || sender.url)) throw new Error('The page changed. Use the controls on the current page.');
  if (message.type === 'get-floating-state') return { state: await floatingState(tab.id) };
  const state = await floatingState(tab.id);
  if (!state.enabled || message.projectId !== state.projectId) throw new Error('Floating controls are unavailable for this project.');
  if (message.type === 'floating-hide') {
    const preferences = await serialize(() => saveCollectionControls(ext.storage.local, { floatingEnabled: false }));
    await floatingControls.sync(); return { preferences };
  }
  if (message.type === 'floating-open-workspace') return handle({ type: 'open-workspace' });
  if (message.type === 'floating-review-urls') {
    if (message.acceptPartial) await handle({ type: 'accept-collected-results', projectId: message.projectId, pageURL: tab.url });
    return handle({ type: 'open-workspace', section: 'urls-section' });
  }
  const action = message.type === 'floating-collect' ? 'collect' : message.type === 'floating-save-page' ? 'save-page' : null;
  if (!action || action !== state.action) throw new Error('This action is not available on this page.');
  return runPageAction({ type: action, projectId: state.projectId, tabId: tab.id });
}

const downloadFeedback = createDownloadFeedback({ ext, getProject: ensureProject, serialize });

async function handle(message) {
  if (message.type === 'get-download-feedback') return { feedback: await downloadFeedback.sync() };
  if (['download-feedback-start', 'download-feedback-progress', 'download-feedback-finish', 'download-feedback-dismiss'].includes(message.type)) return downloadFeedback.handle(message);
  if (message.type === 'get-collection-controls') return { preferences: await readCollectionControls(ext.storage.local) };
  if (message.type === 'save-collection-controls') {
    const preferences = await serialize(() => saveCollectionControls(ext.storage.local, message.patch));
    let floatingWarning;
    try { await floatingControls.sync(); } catch { floatingWarning = 'Preferences saved. Some pages may need a reload before floating controls can appear.'; }
    return { preferences, floatingWarning };
  }
  if (message.type === 'get-settings') return { settings: await readSettingsState(ext.storage.local) };
  if (message.type === 'save-settings') return serialize(async () => ({ settings: await saveSettings(ext.storage.local, message.values, message.revision) }));
  if (message.type === 'set-default-search-engine') return serialize(async () => {
    await assertProject(message.projectId);
    const current = await readSettingsState(ext.storage.local);
    return { settings: await saveSettings(ext.storage.local, { ...current.values, defaultEngine: message.engine }, current.revision) };
  });
  if (message.type === 'open-project-search') return searchTabs.open(message);
  if (message.type === 'get-project-search-tabs') return searchTabs.getState(message.projectId);
  if (message.type === 'collect-project-search-tabs') return searchTabs.start(message.projectId, { loadedOnly: message.loadedOnly === true });
  if (message.type === 'focus-project-search-tab') return searchTabs.focus(message.projectId, message.tabId);
  if (message.type === 'stop-project-search-tabs') return searchTabs.stop(message.projectId);
  if (message.type === 'save-user-defaults') return serialize(async () => {
    await assertProject(message.projectId);
    return { defaults: await saveUserDefaults(ext.storage.local, message.patch) };
  });
  if (message.type === 'get-project') return serialize(async () => {
    const project = await ensureProject();
    return { project, promptForProject: !project };
  });
  if (message.type === 'prepare-project-save') return serialize(async () => {
    await assertProject(message.projectId);
    const tracking = (await ext.storage.session.get('projectSearchTabs')).projectSearchTabs;
    if (captures.size || tracking?.batch?.running) throw new Error('Wait for collection and page saving to finish before saving a project.');
    const project = await ensureProject(), snapshot = await snapshotStoredProject(project);
    const { collections = [] } = await ext.storage.local.get('collections');
    snapshot.stores.meta = snapshot.stores.meta.map(r => r.key === 'searches' ? { key: 'searches', collections } : r);
    validateProjectSnapshot(snapshot);
    return { token: await stageProject(snapshot) };
  });
  if (message.type === 'open-portable-project') return serialize(async () => {
    const current = await ensureProject(), expected = message.projectId ?? null;
    if (expected !== (current?.id ?? null)) throw new Error('The project changed. Open the project file again.');
    const snapshot = await readStagedProject(message.token);
    if (!snapshot) throw new Error('The project file is no longer available. Select it again.');
    const restored = restoredProjectSnapshot(snapshot), project = restored.project;
    for (const controller of captures.values()) controller.abort();
    await replaceStoredProject(expected, restored, project);
    // The active database marker is authoritative. A restart after this commit
    // recovers both identity and imported search results before notifying views.
    try { await searchTabs.resetInQueue(); }
    finally { await resetProjectLocalState(ext.storage.local, project, restored.stores.meta.find(r => r.key === 'searches').collections); }
    await removeStagedProject(message.token).catch(() => {});
    return { project };
  });
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
    const current = await ensureProject();
    if ((message.projectId ?? null) !== (current?.id ?? null)) throw new Error('The project changed. Reopen BootCaT before creating a project.');
    const chosenName = typeof message.name === 'string' ? message.name.trim().slice(0, 120) : '';
    if (!chosenName) throw new Error('Enter a project name.');
    const project = { language: validateLanguage(message.language ?? 'none'), id: crypto.randomUUID(), name: chosenName, nameConfirmed: true };
    for (const controller of captures.values()) controller.abort();
    await resetStoredProject(project.id, { ...await readUserDefaults(ext.storage.local), engine: (await readSettings(ext.storage.local)).defaultEngine }, project);
    await searchTabs.resetInQueue();
    await resetProjectLocalState(ext.storage.local, project);
    return { project };
  });
  if (message.type === 'close-project') return serialize(async () => {
    await assertProject(message.projectId);
    for (const controller of captures.values()) controller.abort();
    await closeStoredProject(message.projectId);
    try { await searchTabs.resetInQueue(); }
    finally { await resetProjectLocalState(ext.storage.local, null); }
    return { project: null };
  });
  if (message.type === 'accept-collected-results') return serialize(async () => {
    await assertProject(message.projectId);
    const { collections = [] } = await ext.storage.local.get('collections');
    const accepted = collections.filter(item => item.results.length && item.unresolved && !item.acceptedPartial && (!message.pageURL || item.pageURL === message.pageURL));
    const ids = new Set(accepted.map(item => item.id));
    await ext.storage.local.set({ collections: collections.map(item => ids.has(item.id) ? { ...item, acceptedPartial: true } : item) });
    await searchTabs.acceptCollectedInQueue(message.projectId, accepted);
    return {};
  });
  if (message.type === "open-workspace") {
    const url = ext.runtime.getURL("downloader.html");
    const tabs = await workspaceTabs();
    if (tabs.length) {
      await ext.tabs.update(tabs[0].id, { active: true });
      if (message.section === 'urls-section') await ext.runtime.sendMessage({ type: 'bootcat-review-urls', tabId: tabs[0].id }).catch(() => {});
      await ext.windows.update(tabs[0].windowId, { focused: true });
    } else await ext.tabs.create({ url: message.section === 'urls-section' ? `${url}#urls-section` : url });
    return {};
  }
  if (message.type === "clear-collections") return serialize(async () => {
    await assertProject(message.projectId);
    await ext.storage.local.set({ collections: [] });
    return {};
  });
  if (message.type === 'get-search-collection-state') {
    const tab = await ext.tabs.get(message.tabId);
    return serialize(async () => { const project = await ensureProject(); return { projectId: project?.id ?? null, collection: project ? await currentCollection(tab) : null }; });
  }
  if (message.type === 'get-page-corpus-state') {
    const tab = await ext.tabs.get(message.tabId);
    return serialize(async () => {
      const project = await ensureProject();
      return { projectId: project?.id ?? null, saved: project ? await isSavedPage(project.id, tab.url) : false };
    });
  }
  if (message.type === 'save-page' || message.type === 'collect') return runPageAction(message);
  throw new Error('Unknown request');
}
ext.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== ext.runtime.id || message?.type === 'bootcat-review-urls') return;
  const ownUI = sender.url?.startsWith(ext.runtime.getURL(''));
  const floatingTypes = new Set(['get-floating-state', 'floating-hide', 'floating-open-workspace', 'floating-review-urls', 'floating-collect', 'floating-save-page']);
  const content = !ownUI && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && /^https?:\/\//.test(sender.url || '') && floatingTypes.has(message?.type);
  if (!ownUI && !content) return;
  (content ? handleFloating(message, sender) : handle(message)).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
  return true; // Keep the asynchronous reply channel open.
});

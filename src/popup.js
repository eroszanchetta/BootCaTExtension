import { getExtensionAPI } from './extension-api.js';
import { initVersionBadge } from './version.js';
import { adapterForURL } from './engines.js';
const ext = getExtensionAPI();
initVersionBadge();
const el = id => document.getElementById(id);
const collect = el('collect'), savePage = el('save-page');
const feedback = el('feedback'), pageFeedback = el('page-feedback'), status = el('popup-status');
let project, activeTab, engine, initialized = false, reloading = false;
let collecting = false, savingPage = false, alreadyCollected = false, unresolved = 0;
let pageState = 'checking', pageRevision = 0, collectionRevision = 0, projectRevision = 0;
let pageError = '', collectionError = '', generalError = '';
const namedProject = () => !!project && (project.nameConfirmed === true ||
  (project.nameConfirmed == null && !!project.name?.trim() && project.name !== 'Untitled project'));
function reloadProject() {
  reloading = true; pageRevision++; render(); window.location.reload();
}
function message(element, text, saved = false) {
  element.textContent = text; element.hidden = !text;
  if (saved) element.classList.add('saved'); else element.classList.remove('saved');
}
function render() {
  el('collect-action').hidden = el('capture-action').hidden = true;
  collect.disabled = savePage.disabled = true;
  collect.textContent = collecting ? 'Collecting…' : 'Collect results from this tab';
  savePage.textContent = savingPage ? 'Saving…' : 'Add page to corpus';
  message(feedback, ''); message(pageFeedback, '');
  if (reloading) { message(status, 'Project changed. Refreshing…'); return; }
  if (generalError) { message(status, generalError); return; }
  if (!initialized) { message(status, 'Checking project and current tab…'); return; }
  if (!namedProject()) { message(status, 'Create a project in BootCaT to start collecting.'); return; }
  if (!/^https?:\/\//.test(activeTab?.url || '')) { message(status, 'This page cannot be collected.'); return; }
  message(status, '');
  if (engine) {
    if (alreadyCollected && !collecting) {
      message(feedback, `Results added${unresolved ? `. ${unresolved} candidate links were skipped because their destinations could not be resolved.` : ''}`, true);
    } else {
      el('collect-action').hidden = false; collect.disabled = collecting;
      el('page-info').textContent = `${engine.name}${engine.experimental ? ' (experimental)' : ''} web results detected.`;
      message(feedback, collectionError);
    }
  } else if (pageState === 'checking' && !savingPage) {
    message(status, 'Checking whether this page is already in the corpus…');
  } else if (pageState === 'saved' && !savingPage) {
    message(pageFeedback, 'Page already added to corpus', true);
  } else if (pageState === 'error' && !savingPage) {
    message(pageFeedback, pageError);
  } else {
    el('capture-action').hidden = false; savePage.disabled = savingPage;
    message(pageFeedback, pageError);
  }
}
async function refreshPageState() {
  if (!initialized || reloading || !namedProject() || engine || !/^https?:\/\//.test(activeTab?.url || '') || savingPage) return;
  const revision = ++pageRevision, projectId = project.id;
  pageState = 'checking'; pageError = ''; render();
  try {
    const result = await ext.runtime.sendMessage({ type: 'get-page-corpus-state', tabId: activeTab.id });
    if (revision !== pageRevision || savingPage || reloading || project.id !== projectId) return;
    if (!result?.ok) throw new Error(result?.error || 'Could not check whether this page is saved. Reopen the popup to retry.');
    if (result.projectId !== projectId) { reloadProject(); return; }
    pageState = result.saved ? 'saved' : 'available';
  } catch (error) {
    if (revision !== pageRevision || reloading) return;
    pageState = 'error'; pageError = error.message;
  }
  render();
}
function updateCollectionState(collections) {
  const saved = engine && collections.find(item => item.engine === engine.id && item.pageURL === activeTab?.url);
  alreadyCollected = !!saved; unresolved = saved?.unresolved || 0;
  if (!collecting) collectionError = '';
  render();
}
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || reloading) return;
  if (changes.project) {
    projectRevision++;
    const wasNamed = namedProject();
    const next = changes.project.newValue, previousId = project?.id || changes.project.oldValue?.id;
    if (!next || (previousId && next.id !== previousId)) { reloadProject(); return; }
    project = next;
    if (initialized && !wasNamed && namedProject()) { reloadProject(); return; }
    pageRevision++; render(); refreshPageState();
  }
  if (changes.captureRevision) refreshPageState();
  if (changes.collections) { collectionRevision++; updateCollectionState(changes.collections.newValue || []); }
});
async function initialize() {
  try {
    const revision = projectRevision;
    const [reply, tabs] = await Promise.all([
      ext.runtime.sendMessage({ type: 'get-project' }), ext.tabs.query({ active: true, currentWindow: true })
    ]);
    if (!reply?.ok) throw new Error(reply?.error || 'Could not check the project. Open BootCaT to retry.');
    if (revision === projectRevision) project = reply.project;
    if (!reloading) {
      [activeTab] = tabs; engine = adapterForURL(activeTab?.url);
      if (namedProject() && engine) {
        const collectionRead = collectionRevision;
        const { collections = [] } = await ext.storage.local.get('collections');
        if (collectionRead === collectionRevision) updateCollectionState(collections);
      }
      initialized = true; render(); await refreshPageState();
    }
  } catch (error) { generalError = error.message; render(); }
}
collect.addEventListener('click', async () => {
  if (collect.disabled || reloading || !namedProject() || !engine) return;
  const projectId = project.id;
  collecting = true; collectionError = ''; render();
  try {
    const result = await ext.runtime.sendMessage({ type: 'collect', projectId, tabId: activeTab.id });
    if (reloading || project.id !== projectId) return;
    if (!result?.ok) throw new Error(result?.error || 'Collection failed. Try again.');
    alreadyCollected = true; unresolved = result.unresolved || 0;
  } catch (error) { if (!reloading && project.id === projectId) collectionError = error.message; }
  finally { collecting = false; render(); }
});
savePage.addEventListener('click', async () => {
  if (savePage.disabled || reloading || !namedProject() || engine) return;
  const projectId = project.id;
  savingPage = true; pageRevision++; pageError = ''; render();
  try {
    const result = await ext.runtime.sendMessage({ type: 'save-page', projectId, tabId: activeTab.id });
    if (reloading || project.id !== projectId) return;
    if (!result?.ok) throw new Error(result?.error || 'Could not save this page. Try again.');
    pageState = 'saved';
  } catch (error) {
    if (!reloading && project.id === projectId) { pageState = 'available'; pageError = error.message; }
  } finally { savingPage = false; render(); }
});
el('workspace').addEventListener('click', async () => {
  try {
    const result = await ext.runtime.sendMessage({ type: 'open-workspace' });
    if (!result?.ok) throw new Error(result?.error || 'Could not open workspace');
    window.close();
  } catch (error) { generalError = error.message; render(); }
});

render();
await initialize();

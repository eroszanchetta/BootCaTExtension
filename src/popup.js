import { collectionLinkWarning, collectionSummary } from './search-feedback.js';
import { COLLECTION_CONTROLS_KEY, DEFAULT_COLLECTION_CONTROLS, collectionControlsFromRecord } from './collection-preferences.js';
import { getExtensionAPI } from './extension-api.js';
import { initVersionBadge } from './version.js';
import { matchingCollection } from './collection.js';
import { adapterForURL } from './engines.js';
const ext = getExtensionAPI();
initVersionBadge();
const el = id => document.getElementById(id);
const collect = el('collect'), savePage = el('save-page');
const feedback = el('feedback'), pageFeedback = el('page-feedback'), status = el('popup-status');
let project, activeTab, engine, initialized = false, reloading = false;
let collectedResult = null, acceptedPartial = false, canMarkNoResults = false;
let collecting = false, savingPage = false, alreadyCollected = false, unresolved = 0;
let pageState = 'checking', pageRevision = 0, collectionRevision = 0, projectRevision = 0;
let pageError = '', collectionError = '', generalError = '', pageWarning = '', collectionWarning = '';
let preferences = DEFAULT_COLLECTION_CONTROLS, preferencesLoaded = false, preferenceRevision = 0;
const savingPreferences = new Set();
const preferenceFields = [['close-collected-tab', 'closeCollectedTab'], ['close-captured-tab', 'closeCapturedTab'], ['show-floating-controls', 'floatingEnabled'], ['floating-position', 'floatingPosition']];
function renderPreferences() {
  for (const [id, key] of preferenceFields) {
    const input = el(id); if (key === 'floatingPosition') input.value = preferences[key]; else input.checked = preferences[key];
    input.disabled = !preferencesLoaded || savingPreferences.has(key);
  }
}
for (const [id, key] of preferenceFields) el(id).addEventListener('change', async () => {
  if (!preferencesLoaded || savingPreferences.has(key)) return;
  const value = key === 'floatingPosition' ? el(id).value : el(id).checked;
  const previousValue = preferences[key], readRevision = preferenceRevision, hadFocus = document.activeElement === el(id);
  preferences = { ...preferences, [key]: value }; savingPreferences.add(key); renderPreferences(); render();
  el('controls-feedback').textContent = '';
  try {
    const reply = await ext.runtime.sendMessage({ type: 'save-collection-controls', patch: { [key]: value } });
    if (!reply?.ok) throw new Error(reply?.error || 'Could not save collection preferences.');
    if (preferenceRevision === readRevision) preferences = collectionControlsFromRecord({ version: 1, values: { ...preferences, [key]: reply.preferences?.[key] ?? value } });
    el('controls-feedback').textContent = reply.floatingWarning || '';
  } catch (error) { if (preferenceRevision === readRevision) preferences = { ...preferences, [key]: previousValue }; el('controls-feedback').textContent = error.message; }
  finally { savingPreferences.delete(key); renderPreferences(); render(); if (hadFocus && document.activeElement === document.body) el(id).focus({ preventScroll: true }); }
});
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
  el('close-collected-option').hidden = el('close-captured-option').hidden = true;
  el('floating-preferences').hidden = !initialized || reloading || !namedProject();
  collect.disabled = savePage.disabled = true;
  renderPreferences();
  collect.textContent = collecting ? 'Collecting…' : 'Add URLs from this tab to corpus';
  savePage.textContent = savingPage ? 'Saving…' : 'Add this page to corpus';
  message(feedback, ''); message(pageFeedback, '');
  el('collection-choices').hidden = true;
  for (const id of ['review-urls', 'continue-collected', 'review-search-tab', 'return-workspace', 'mark-no-results', 'rerun-no-results']) el(id).hidden = true;
  if (reloading) { message(status, 'Project changed. Refreshing…'); return; }
  if (generalError) { message(status, generalError); return; }
  if (!initialized) { message(status, 'Checking project and current tab…'); return; }
  if (!namedProject()) { message(status, 'Create a project in BootCaT to start collecting.'); return; }
  if (!/^https?:\/\//.test(activeTab?.url || '')) { message(status, 'This page cannot be collected.'); return; }
  message(status, '');
  el('close-collected-option').hidden = !engine;
  el('close-captured-option').hidden = !!engine;
  if (engine) {
    if (collectedResult?.status === 'no-results') {
      el('rerun-no-results').disabled = collecting;
      message(feedback, ['No results (marked manually).', collectionError].filter(Boolean).join(' '), true); el('collection-choices').hidden = false; el('rerun-no-results').hidden = false; return;
    }
    const partial = alreadyCollected && unresolved && !acceptedPartial;
    if (alreadyCollected && (!unresolved || acceptedPartial) && !collecting) {
      message(feedback, [collectionSummary(collectedResult), collectionWarning].filter(Boolean).join(' '), true);
    } else {
      el('collect-action').hidden = false; collect.disabled = collecting || !preferencesLoaded || savingPreferences.size > 0;
      el('page-info').textContent = `${engine.name}${engine.experimental ? ' (experimental)' : ''} web results detected.`;
      message(feedback, [alreadyCollected ? collectionSummary(collectedResult) : '', collectionError || collectionWarning].filter(Boolean).join(' '));
    }
    if (!collecting && (alreadyCollected || collectionError)) {
      el('collection-choices').hidden = false;
      el('mark-no-results').hidden = !canMarkNoResults;
      el('review-urls').hidden = !alreadyCollected || !!partial;
      el('continue-collected').hidden = !partial;
      el('review-search-tab').hidden = !partial && !collectionError;
      el('return-workspace').hidden = !collectionError || alreadyCollected;
    }
  } else if (pageState === 'checking' && !savingPage) {
    message(status, 'Checking whether this page is already in the corpus…');
  } else if (pageState === 'saved' && !savingPage) {
    message(pageFeedback, `Page already added to corpus${pageWarning ? `. ${pageWarning}` : ''}`, true);
  } else if (pageState === 'error' && !savingPage) {
    message(pageFeedback, pageError);
  } else {
    el('capture-action').hidden = false; savePage.disabled = savingPage || !preferencesLoaded || savingPreferences.size > 0;
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
  const saved = engine && matchingCollection(collections, engine.id, activeTab?.url);
  applyCollectionState(saved);
  if (engine?.id === 'duckduckgo' || collections.some(item => item.status === 'no-results' && item.engine === engine?.id)) refreshSearchCollection();
}
function applyCollectionState(saved) {
  canMarkNoResults = false;
  alreadyCollected = !!saved; unresolved = saved?.unresolved || 0; collectedResult = saved; acceptedPartial = !!saved?.acceptedPartial;
  if (!collecting) { collectionError = ''; collectionWarning = saved?.acceptedPartial ? '' : collectionLinkWarning(saved); }
  render();
}
let searchRead = 0;
async function refreshSearchCollection() {
  const read = ++searchRead, projectId = project?.id;
  try {
    const reply = await ext.runtime.sendMessage({ type: 'get-search-collection-state', tabId: activeTab.id });
    if (read !== searchRead || collecting || reloading || project?.id !== projectId) return;
    if (reply?.ok && reply.projectId === projectId) applyCollectionState(reply.collection);
  } catch { /* Keep the collect action available when inspection fails. */ }
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
  if (changes[COLLECTION_CONTROLS_KEY]) {
    preferenceRevision++;
    try { preferences = collectionControlsFromRecord(changes[COLLECTION_CONTROLS_KEY].newValue); preferencesLoaded = true; }
    catch (error) { preferencesLoaded = false; el('controls-feedback').textContent = error.message; }
    renderPreferences(); render();
  }
  if (changes.captureRevision || changes.workspaceRevision) refreshPageState();
  if (changes.collections) { collectionRevision++; updateCollectionState(changes.collections.newValue || []); }
});
async function initialize() {
  try {
    const revision = projectRevision, preferenceRead = preferenceRevision;
    const [reply, tabs, controls] = await Promise.all([
      ext.runtime.sendMessage({ type: 'get-project' }), ext.tabs.query({ active: true, currentWindow: true }), ext.runtime.sendMessage({ type: 'get-collection-controls' })
    ]);
    if (!reply?.ok) throw new Error(reply?.error || 'Could not check the project. Open BootCaT to retry.');
    if (!controls?.ok) throw new Error(controls?.error || 'Could not read collection preferences.');
    if (preferenceRead === preferenceRevision) { preferences = collectionControlsFromRecord({ version: 1, values: controls.preferences }); preferencesLoaded = true; }
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
  searchRead++; collecting = true; collectionError = collectionWarning = ''; render();
  try {
    const result = await ext.runtime.sendMessage({ type: 'collect', projectId, tabId: activeTab.id });
    if (reloading || project.id !== projectId) return;
    if (!result?.ok) { canMarkNoResults = result?.code === 'no-results-collected'; throw new Error(result?.error || 'Collection failed. Try again.'); }
    canMarkNoResults = false;
    alreadyCollected = true; collectedResult = result; acceptedPartial = false; unresolved = result.unresolved || 0; collectionWarning = result.closeWarning || result.workspaceWarning || result.linkWarning || '';
  } catch (error) { if (!reloading && project.id === projectId) collectionError = error.message; }
  finally { collecting = false; render(); }
});
savePage.addEventListener('click', async () => {
  if (savePage.disabled || reloading || !namedProject() || engine) return;
  const projectId = project.id;
  savingPage = true; pageRevision++; pageError = pageWarning = ''; render();
  try {
    const result = await ext.runtime.sendMessage({ type: 'save-page', projectId, tabId: activeTab.id });
    if (reloading || project.id !== projectId) return;
    if (!result?.ok) throw new Error(result?.error || 'Could not save this page. Try again.');
    pageState = 'saved'; pageWarning = result.closeWarning || result.workspaceWarning || result.linkWarning || '';
  } catch (error) {
    if (!reloading && project.id === projectId) { pageState = 'available'; pageError = error.message; }
  } finally { savingPage = false; render(); }
});
async function reviewURLs(acceptPartial = false) {
  try {
    if (acceptPartial) {
      const accepted = await ext.runtime.sendMessage({ type: 'accept-collected-results', projectId: project.id, pageURL: activeTab.url });
      if (!accepted?.ok) throw new Error(accepted?.error || 'Could not keep the collected URLs.');
    }
    const reply = await ext.runtime.sendMessage({ type: 'open-workspace', section: 'urls-section' });
    if (!reply?.ok) throw new Error(reply?.error || 'Could not open BootCaT.');
    window.close();
  } catch (error) { collectionError = error.message; render(); }
}
el('mark-no-results').addEventListener('click', async () => {
  if (!canMarkNoResults || collecting || reloading) return;
  const projectId = project.id; searchRead++; collecting = true; render();
  try {
    const reply = await ext.runtime.sendMessage({type:'mark-search-no-results',projectId,tabId:activeTab.id,pageURL:activeTab.url});
    if (reloading || project.id !== projectId) return;
    if (!reply?.ok) throw new Error(reply?.error || 'Could not mark this query.');
    applyCollectionState(reply.collection);
  } catch(error) { if (!reloading && project.id === projectId) collectionError = error.message; }
  finally { collecting = false; render(); }
});
el('rerun-no-results').addEventListener('click', async () => {
  if (collecting || reloading || collectedResult?.status !== 'no-results') return;
  searchRead++; collecting = true; render();
  try {
    const reply = await ext.runtime.sendMessage({type:'open-project-search',projectId:project.id,engine:engine.id,query:collectedResult.query,active:true});
    if (!reply?.ok) throw new Error(reply?.error || 'Could not rerun this query.');
    window.close();
  } catch(error) { collectionError = error.message; }
  finally { collecting = false; render(); }
});
el('review-urls').addEventListener('click', () => reviewURLs());
el('continue-collected').addEventListener('click', () => reviewURLs(true));
el('review-search-tab').addEventListener('click', async () => {
  try { await ext.tabs.update(activeTab.id, { active: true }); window.close(); }
  catch (error) { collectionError = error.message; render(); }
});
el('return-workspace').addEventListener('click', () => el('workspace').click());
el('workspace').addEventListener('click', async () => {
  try {
    const result = await ext.runtime.sendMessage({ type: 'open-workspace' });
    if (!result?.ok) throw new Error(result?.error || 'Could not open workspace');
    window.close();
  } catch (error) { generalError = error.message; render(); }
});

render();
await initialize();

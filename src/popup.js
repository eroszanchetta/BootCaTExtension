import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { adapterForURL } from "./engines.js";
const collect = document.getElementById("collect");
const feedback = document.getElementById("feedback");
collect.disabled = true;
const collectionHint = feedback.textContent;
const savePage = document.getElementById('save-page');
let activeTab, engine, collecting = false, alreadyCollected = false, collectionRevision = 0;
function showResultsAdded(unresolved = 0) {
  feedback.textContent = `Results added${unresolved ? `. ${unresolved} candidate links were skipped because their destinations could not be resolved.` : ''}`;
  feedback.classList.add('saved');
}
function updateCollectionState(collections) {
  const saved = engine && collections.find(item => item.engine === engine.id && item.pageURL === activeTab?.url);
  alreadyCollected = !!saved;
  collect.disabled = !engine || collecting || alreadyCollected;
  if (saved) showResultsAdded(saved.unresolved);
  else if (!collecting) { feedback.textContent = collectionHint; feedback.classList.remove('saved'); }
}
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.collections) {
    collectionRevision++;
    updateCollectionState(changes.collections.newValue || []);
  }
});
try {
  [activeTab] = await ext.tabs.query({ active: true, currentWindow: true });
  engine = adapterForURL(activeTab?.url);
  savePage.disabled = !!engine || !/^https?:\/\//.test(activeTab?.url || '');
  document.getElementById('page-info').textContent = engine ? `${engine.name}${engine.experimental ? ' (experimental)' : ''} web results detected.` : 'Open a DuckDuckGo, Ecosia or Google web search results tab, then click this extension again.';
  if (engine) {
    const revision = collectionRevision;
    const { collections = [] } = await ext.storage.local.get('collections');
    if (revision === collectionRevision) updateCollectionState(collections);
  }
} catch (error) { feedback.textContent = error.message; }
collect.addEventListener('click', async () => {
  if (collect.disabled) return;
  collecting = true; collect.disabled = true;
  feedback.classList.remove('saved'); feedback.textContent = 'Collecting…';
  try {
    const result = await ext.runtime.sendMessage({ type: 'collect', tabId: activeTab.id });
    if (!result?.ok) throw new Error(result?.error || 'Collection failed. Try again.');
    alreadyCollected = true; showResultsAdded(result.unresolved);
  } catch (error) { feedback.textContent = error.message; }
  finally { collecting = false; collect.disabled = !engine || alreadyCollected; }
});
document.getElementById("workspace").addEventListener("click", async () => {
  try {
    const result = await ext.runtime.sendMessage({ type: "open-workspace" });
    if (!result?.ok) throw new Error(result?.error || "Could not open workspace");
    window.close();
  } catch (error) { feedback.textContent = error.message; }
});

document.getElementById('save-page').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (button.disabled) return;
  const pageFeedback = document.getElementById('page-feedback');
  button.disabled = true; pageFeedback.classList.remove('saved'); pageFeedback.textContent = 'Saving this page…';
  try {
    const result = await ext.runtime.sendMessage({ type: 'save-page', tabId: activeTab.id });
    if (!result?.ok) throw new Error(result?.error || 'Could not save this page.');
    pageFeedback.textContent = 'Page saved';
    pageFeedback.classList.add('saved');
  } catch (error) { pageFeedback.textContent = error.message; button.disabled = false; }
});

let popupProjectId;
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.project) return;
  popupProjectId ||= changes.project.oldValue?.id;
  const next = changes.project.newValue;
  if (next && popupProjectId && next.id !== popupProjectId) window.location.reload();
  if (next) popupProjectId = next.id;
});

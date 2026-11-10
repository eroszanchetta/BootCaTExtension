import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { adapterForURL } from "./engines.js";
const collect = document.getElementById("collect");
const feedback = document.getElementById("feedback");
let activeTab;
try {
  [activeTab] = await ext.tabs.query({ active: true, currentWindow: true });
  document.getElementById("save-page").disabled = !/^https?:\/\//.test(activeTab?.url || "");
  const engine = adapterForURL(activeTab?.url);
  document.getElementById("page-info").textContent = engine ? `${engine.name}${engine.experimental ? " (experimental)" : ""} web results detected.` : "Open a Google, DuckDuckGo or Ecosia web search results tab, then click this extension again.";
  collect.disabled = !engine;
} catch (error) { feedback.textContent = error.message; }
collect.addEventListener("click", async () => {
  collect.disabled = true; feedback.textContent = "Collecting…";
  try {
    const result = await ext.runtime.sendMessage({ type: "collect", tabId: activeTab.id });
    if (!result?.ok) throw new Error(result?.error || "Collection failed. Try again.");
    feedback.textContent = `Saved ${result.count} results from ${result.engine}.${result.unresolved ? ` ${result.unresolved} candidate links were skipped because their destinations could not be resolved.` : ""} Open the workspace to review them.`;
  } catch (error) { feedback.textContent = error.message; }
  finally { collect.disabled = false; }
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

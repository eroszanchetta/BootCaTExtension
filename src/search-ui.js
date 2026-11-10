import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { ENGINES, searchURL } from "./engines.js";
import { uniqueResults } from "./collection.js";
import { parseURLs } from "./core.js";

export async function readCollections() {
  const { collections = [] } = await ext.storage.local.get("collections");
  return collections;
}
export function initSearchUI({ isRunning }) {
  const el = id => document.getElementById(id);
  let collections = [];
  const status = el("collection-status");
  for (const engine of ENGINES) {
    const option = document.createElement("option");
    option.value = engine.id; option.textContent = engine.name + (engine.experimental ? " (experimental)" : "");
    el("engine").append(option);
  }
  el("search-form").addEventListener("submit", async event => {
    event.preventDefault();
    const query = el("query").value.trim();
    if (!query) return;
    try { await ext.tabs.create({ url: searchURL(el("engine").value, query) }); }
    catch (error) { status.textContent = error.message; }
  });
  function render() {
    const results = uniqueResults(collections);
    const unresolved = collections.reduce((sum, item) => sum + item.unresolved, 0);
    status.textContent = `${results.length} unique URLs from ${collections.length} saved result pages.${unresolved ? ` ${unresolved} candidate links could not be resolved; consider another engine for those searches.` : ""}`;
    for (const id of ["use-collected", "save-searches", "clear-searches"]) el(id).disabled = !collections.length;
    const body = el("collected-results"); body.replaceChildren();
    for (const result of results.slice(0, 200)) {
      const tr = document.createElement("tr"), title = document.createElement("td"), source = document.createElement("td");
      title.textContent = `${result.title || "Untitled"} — ${result.url}`;
      source.textContent = result.sources.map(s => `${s.engine}: ${s.query} (position ${s.positionOnPage})`).join("; ");
      tr.append(title, source); body.append(tr);
    }
  }
  el("use-collected").addEventListener("click", () => {
    if (isRunning()) { status.textContent = "Wait for the current download to finish before changing the URL list."; return; }
    const current = parseURLs(el("urls").value);
    if (current.errors.length) { status.textContent = "Correct invalid URLs below before adding collected URLs."; return; }
    const merged = [...new Set([...current.urls, ...uniqueResults(collections).map(item => item.url)])];
    if (merged.length > 500) { status.textContent = "More than 500 URLs: export searches and paste a smaller selection into the download list."; return; }
    el("urls").value = merged.join("\n");
    status.textContent = `${merged.length} URLs are now in the download list. Review/edit the list, then click Download URLs.`;
  });
  el("save-searches").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: "0.2.0", collections, results: uniqueResults(collections) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "bootcat-searches.json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  el("clear-searches").addEventListener("click", async () => {
    if (!window.confirm("Clear all saved search collections? Export them first if you want to keep them. The URL download list will stay as it is.")) return;
    try {
      const reply = await ext.runtime.sendMessage({ type: "clear-collections" });
      if (!reply?.ok) throw new Error(reply?.error || "Could not clear searches");
    } catch (error) { status.textContent = error.message; }
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.collections) { collections = changes.collections.newValue || []; render(); }
  });
  readCollections().then(saved => { collections = saved; render(); }, error => { status.textContent = `Could not load saved searches: ${error.message}`; });
}

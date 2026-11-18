import { getExtensionAPI } from './extension-api.js';
import { getExtensionVersion } from './version.js';
import { confirmAction } from './dialogs.js';
const ext = getExtensionAPI();
import { ENGINES } from "./engines.js";
import { uniqueResults } from "./collection.js";
import { parseURLs } from "./core.js";

export async function readCollections() {
  const { collections = [] } = await ext.storage.local.get("collections");
  return collections;
}
export function initSearchUI({ isRunning, seenCollectionIds = [], onChange = () => {}, getProjectId = () => null }) {
  const el = id => document.getElementById(id);
  let collections = [];
  let changed = false, destroyed = false;
  const seenCollections = new Set(seenCollectionIds), pending = new Set(), pendingCollections = new Set();
  const status = el("collection-status");
  for (const engine of ENGINES) {
    const option = document.createElement("option");
    option.value = engine.id; option.textContent = engine.name + (engine.experimental ? " (experimental)" : "");
    el("engine").append(option);
  }
  function render() {
    const results = uniqueResults(collections);
    const unresolved = collections.reduce((sum, item) => sum + item.unresolved, 0);
    status.textContent = `${results.length} unique URLs from ${collections.length} saved result pages.${unresolved ? ` ${unresolved} candidate links could not be resolved; consider another engine for those searches.` : ""}`;
    for (const id of ["save-searches", "clear-searches"]) el(id).disabled = !collections.length;
    const body = el("collected-results"); body.replaceChildren();
    for (const result of results.slice(0, 200)) {
      const tr = document.createElement("tr"), title = document.createElement("td"), source = document.createElement("td");
      title.textContent = `${result.title || "Untitled"} — ${result.url}`;
      source.textContent = result.sources.map(s => `${s.engine}: ${s.query} (position ${s.positionOnPage})`).join("; ");
      tr.append(title, source); body.append(tr);
    }
  }
  function flush() {
    if (destroyed || (!pending.size && !pendingCollections.size)) return;
    if (isRunning()) { status.textContent += ' New URLs will be added after the current batch finishes.'; return; }
    const input = el('urls');
    const current = parseURLs(input.value);
    const existing = new Set(current.urls);
    const additions = [...pending].filter(url => !existing.has(url));
    // Preserve manual edits, including invalid lines which the downloader will flag.
    if (additions.length) input.value = input.value.trimEnd() + (input.value.trim() ? '\n' : '') + additions.join('\n');
    for (const id of pendingCollections) seenCollections.add(id);
    pending.clear(); pendingCollections.clear();
    onChange({ urls: input.value, seenCollections: [...seenCollections] });
  }
  function receive(saved) {
    if (destroyed) return;
    collections = saved;
    if (!saved.length) { pending.clear(); pendingCollections.clear(); }
    for (const collection of collections) {
      if (seenCollections.has(collection.id) || pendingCollections.has(collection.id)) continue;
      pendingCollections.add(collection.id);
      for (const item of collection.results) pending.add(item.url);
    }
    render(); flush();
  }
  el('urls').addEventListener('input', flush);
  el("save-searches").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: getExtensionVersion(), collections, results: uniqueResults(collections) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "bootcat-searches.json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  el("clear-searches").addEventListener("click", async () => {
    if (!await confirmAction({ title: 'Clear saved searches?', message: 'All saved search collections will be cleared. Export them first if you want to keep them. The URL download list will stay as it is.', confirmLabel: 'Clear searches', destructive: true })) return;
    try {
      const reply = await ext.runtime.sendMessage({ type: "clear-collections", projectId: getProjectId() });
      if (!reply?.ok) throw new Error(reply?.error || "Could not clear searches");
    } catch (error) { status.textContent = error.message; }
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.collections) { changed = true; receive(changes.collections.newValue || []); }
  });
  readCollections().then(saved => { if (!changed) receive(saved); }, error => { status.textContent = `Could not load saved searches: ${error.message}`; });
  return { flush, destroy() { destroyed = true; pending.clear(); pendingCollections.clear(); collections = []; } };
}

import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI();
import { ENGINES } from "./engines.js";
import { parseURLs } from "./core.js";

export async function readCollections() {
  const { collections = [] } = await ext.storage.local.get("collections");
  return collections;
}
export function initSearchUI({ isRunning, seenCollectionIds = [], onChange = () => {}, onCollectionsChange = () => {}, getProjectId = () => null }) {
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
    const unresolved = collections.reduce((sum, item) => sum + item.unresolved, 0);
    status.textContent = [unresolved ? `${unresolved} candidate links could not be resolved; consider another engine for those searches.` : '', isRunning() && (pending.size || pendingCollections.size) ? 'New URLs will be added after the current batch finishes.' : ''].filter(Boolean).join(' ');
  }
  function flush() {
    if (destroyed || (!pending.size && !pendingCollections.size)) return;
    if (isRunning()) { render(); return; }
    const input = el('urls');
    const current = parseURLs(input.value);
    const existing = new Set(current.urls);
    const additions = [...pending].filter(url => !existing.has(url));
    // Preserve manual edits, including invalid lines which the downloader will flag.
    if (additions.length) input.value = input.value.trimEnd() + (input.value.trim() ? '\n' : '') + additions.join('\n');
    for (const id of pendingCollections) seenCollections.add(id);
    pending.clear(); pendingCollections.clear(); render();
    onChange({ urls: input.value, seenCollections: [...seenCollections] });
  }
  function receive(saved, notify = false) {
    if (destroyed) return;
    if (notify && JSON.stringify(saved) !== JSON.stringify(collections)) onCollectionsChange();
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
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.collections) { changed = true; receive(changes.collections.newValue || [], true); }
  });
  readCollections().then(saved => { if (!changed) receive(saved); }, error => { status.textContent = `Could not load saved searches: ${error.message}`; });
  return { flush, destroy() { destroyed = true; pending.clear(); pendingCollections.clear(); collections = []; } };
}

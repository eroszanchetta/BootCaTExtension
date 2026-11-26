import { DEFAULT_SETTINGS } from './settings.js';
// Provider-neutral records: future APIs/importers can emit the same shape.
export function uniqueResults(collections) {
  const merged = new Map();
  for (const collection of collections) for (const result of collection.results) {
    if (!merged.has(result.url)) merged.set(result.url, { url: result.url, title: result.title, sources: [] });
    merged.get(result.url).sources.push({ collectionId: collection.id, engine: collection.engine, query: collection.query, pageURL: collection.pageURL, positionOnPage: result.positionOnPage });
  }
  return [...merged.values()];
}
export function addCollection(collections, incoming, settings = DEFAULT_SETTINGS) {
  // Recollecting a page replaces its snapshot, without duplicating it.
  const next = collections.filter(item => item.engine !== incoming.engine || item.pageURL !== incoming.pageURL);
  next.push(incoming);
  if (next.length > settings.collectionPages || next.reduce((sum, item) => sum + item.results.length, 0) > settings.collectionResults) throw new Error(`Collection limit reached (${settings.collectionPages.toLocaleString()} pages or ${settings.collectionResults.toLocaleString()} results). Save your corpus before clearing the project, or increase the collection limits in Settings.`);
  return next;
}

// Compare the whole page identity: q alone would conflate pagination, filters
// and language variants. DDG can also append results without changing its URL.
export function matchingCollection(collections, engine, pageURL, snapshot) {
  const canonical = value => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return null; } };
  return collections.find(item => item.engine === engine && canonical(item.pageURL) === canonical(pageURL) &&
    (engine !== 'duckduckgo' || (snapshot?.resultSetKey && item.resultSetKey === snapshot.resultSetKey))) || null;
}

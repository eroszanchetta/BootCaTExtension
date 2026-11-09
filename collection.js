// Provider-neutral records: future APIs/importers can emit the same shape.
export function uniqueResults(collections) {
  const merged = new Map();
  for (const collection of collections) for (const result of collection.results) {
    if (!merged.has(result.url)) merged.set(result.url, { url: result.url, title: result.title, sources: [] });
    merged.get(result.url).sources.push({ collectionId: collection.id, engine: collection.engine, query: collection.query, pageURL: collection.pageURL, positionOnPage: result.positionOnPage });
  }
  return [...merged.values()];
}
export function addCollection(collections, incoming) {
  // Recollecting a page replaces its snapshot, without duplicating it.
  const next = collections.filter(item => item.engine !== incoming.engine || item.pageURL !== incoming.pageURL);
  next.push(incoming);
  if (next.length > 100 || next.reduce((sum, item) => sum + item.results.length, 0) > 5000) throw new Error("Collection limit reached (100 pages or 5,000 results). Export and clear saved searches first.");
  return next;
}

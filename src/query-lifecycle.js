// Engine and full query (including filters) define a search. Use the same
// normalization as search-tab matching, without changing case or punctuation.
export const normalizeQuery = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
export const queryKey = (engine, query) => JSON.stringify([engine, normalizeQuery(query)]);
export function queryPlan(queries, engine, state) {
  const unique = [...new Map(queries.map(query => [queryKey(engine, query), query])).values()];
  const open = new Set((state.tabs || []).map(tab => queryKey(tab.engine, tab.query)));
  const completed = new Set((state.history || []).filter(item => item.status === 'collected').map(item => queryKey(item.engine, item.query)));
  const previous = new Set((state.history || []).map(item => queryKey(item.engine, item.query)));
  return {
    missing: unique.filter(query => !open.has(queryKey(engine, query)) && !completed.has(queryKey(engine, query))),
    total: unique.length,
    started: unique.some(query => open.has(queryKey(engine, query)) || previous.has(queryKey(engine, query))),
    open: unique.filter(query => open.has(queryKey(engine, query))).length
  };
}

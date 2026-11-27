// Engine, full query and effective Google language filter define a search. Use the same
// normalization as search-tab matching, without changing case or punctuation.
export const normalizeQuery = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
export const queryKey = (engine, query, languageFilter = '') => JSON.stringify([engine, normalizeQuery(query), ...(engine === 'google' && languageFilter ? [languageFilter] : [])]);
export function queryPlan(queries, engine, state, languageFilter = '') {
  const unique = [...new Map(queries.map(query => [queryKey(engine, query, languageFilter), query])).values()];
  const open = new Set((state.tabs || []).map(tab => queryKey(tab.engine, tab.query, tab.languageFilter)));
  const completed = new Set((state.history || []).filter(item => ['collected', 'no-results'].includes(item.status)).map(item => queryKey(item.engine, item.query, item.languageFilter)));
  const previous = new Set((state.history || []).map(item => queryKey(item.engine, item.query, item.languageFilter)));
  return {
    missing: unique.filter(query => !open.has(queryKey(engine, query, languageFilter)) && !completed.has(queryKey(engine, query, languageFilter))),
    total: unique.length,
    started: unique.some(query => open.has(queryKey(engine, query, languageFilter)) || previous.has(queryKey(engine, query, languageFilter))),
    open: unique.filter(query => open.has(queryKey(engine, query, languageFilter))).length
  };
}

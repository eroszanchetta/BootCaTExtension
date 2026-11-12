import { getExtensionAPI } from './extension-api.js';
import { SEARCH_FILE_TYPES, DEFAULT_EXCLUDED_SITES, normalizeSearchFilters } from './search-filters.js';
import { openWorkspaceSection } from './workspace-sections.js';
import { openProjectSearch } from './search-tabs-client.js';
import { ENGINES, searchURL, buildSearchQuery } from './engines.js';
import { parseSeeds, parseQueries, generateTuples, combinationCount } from './tuples.js';

export function initSeedsUI({ draft = {}, onChange = () => {}, getProjectId = () => null } = {}) {
  const el = id => document.getElementById(id), PAGE_SIZE = 100;
  let prepared = [], bases = null, preparedFilters = null, savingDefaults = false, page = 0, generating = false, opening = false, stopped = false, destroyed = false, controller;
  const engineID = () => el('engine').value || ENGINES[0].id;
  const engineName = () => ENGINES.find(engine => engine.id === engineID())?.name || engineID();
  const busy = () => generating || opening;
  for (const format of [{ id: '', label: 'No restriction' }, ...SEARCH_FILE_TYPES]) {
    const option = document.createElement('option'); option.value = format.id; option.textContent = format.label; el('search-filetype').append(option);
  }
  function discardQueries(message, patch = {}) {
    prepared = []; bases = null; preparedFilters = null; page = 0;
    onChange({ ...patch, preparedQueries: [], preparedQueryBases: null, preparedFilters: null });
    el('query-status').textContent = message;
  }
  function rebuildQueries() {
    if (bases && preparedFilters) prepared = bases.map(query => buildSearchQuery(engineID(), query, preparedFilters));
  }
  function controls() {
    for (const id of ['seeds', 'tuple-length', 'tuple-count', 'search-filetype', 'excluded-sites']) el(id).disabled = busy();
    el('tuples').disabled = false;
    el('save-site-defaults').disabled = busy() || savingDefaults;
    el('generate-tuples').disabled = busy() || parseSeeds(el('seeds').value).length < 5;
    el('prepare-queries').disabled = busy() || !el('tuples').value.trim();
    el('open-all-queries').disabled = busy() || !prepared.length;
    el('stop-tuples').hidden = !generating; el('stop-query-tabs').hidden = !opening;
    el('engine').disabled = opening;
    el('tuple-length').disabled = busy() || !parseSeeds(el('seeds').value).length;
  }
  function seedCount({ clamp = false } = {}) {
    const count = parseSeeds(el('seeds').value).length, maximum = Math.min(10, count);
    const length = el('tuple-length'), requested = el('tuple-count');
    length.max = String(maximum);
    if (clamp && count >= 5 && Number(length.value) > maximum) length.value = String(maximum);
    const k = Number(length.value), total = Number.isInteger(k) && k >= 1 && k <= maximum ? combinationCount(count, k) : 0n;
    requested.max = total.toString();
    if (clamp && count >= 5 && total > 0n && /^\d+$/.test(requested.value) && BigInt(requested.value) > total) requested.value = total.toString();
    el('tuple-length-hint').textContent = maximum ? `Choose 1–${maximum} seeds per tuple (up to 10).` : 'Add seeds to choose a tuple length (up to 10).';
    el('tuple-count-hint').textContent = `Maximum: ${total.toLocaleString()} unique tuples with these settings.`;
    el('seeds-counter').textContent = `${count.toLocaleString()} seed${count === 1 ? '' : 's'}`;
    const tuples = parseQueries(el('tuples').value).length;
    el('tuples-counter').textContent = `${tuples.toLocaleString()} tuple${tuples === 1 ? '' : 's'}`;
    el('seed-status').textContent = `${count.toLocaleString()} distinct seed${count === 1 ? '' : 's'}.${count < 5 ? ' At least 5 are required to generate tuples.' : ''}`;
    el('tuple-warning').textContent = Number(requested.value) > 500 ? 'Large tuple lists may take longer to generate and review, and consume substantial browser storage. Generation can be stopped.' : '';
    controls();
  }
  function render() {
    const pages = Math.max(1, Math.ceil(prepared.length / PAGE_SIZE)); page = Math.min(page, pages - 1);
    const body = el('prepared-queries'); body.replaceChildren(); body.start = page * PAGE_SIZE + 1;
    for (const query of prepared.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const item = document.createElement('li'), link = document.createElement('a');
      link.href = searchURL(engineID(), query); link.textContent = query; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const open = async event => {
        if (event.type === 'auxclick' && event.button !== 1) return;
        if (event.type === 'click' && event.button > 0) return;
        event.preventDefault();
        if (destroyed) return;
        try {
          await openProjectSearch({ projectId: getProjectId(), engine: engineID(), query, active: !(event.button === 1 || event.ctrlKey || event.metaKey) });
          if (!destroyed) el('query-status').textContent = 'Search tab opened and tracked for this project.';
        } catch (error) { if (!destroyed) el('query-status').textContent = error.message; }
      };
      link.addEventListener('click', open); link.addEventListener('auxclick', open);
      item.append(link); body.append(item);
    }
    el('query-summary').textContent = prepared.length ? `${prepared.length.toLocaleString()} queries for ${engineName()}. Click a query to open its search in a new tab.` : 'No search queries prepared yet.';
    el('query-pagination').hidden = pages <= 1;
    el('query-page').textContent = `Queries ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, prepared.length)} of ${prepared.length.toLocaleString()}`;
    el('previous-queries').disabled = page === 0; el('next-queries').disabled = page >= pages - 1;
    controls();
  }
  function restore(saved) {
    if (busy() || destroyed) return;
    el('seeds').value = saved.seeds ?? ''; el('tuple-length').value = saved.tupleLength ?? '3';
    el('tuple-count').value = saved.tupleCount ?? '10'; el('tuples').value = saved.tuples ?? '';
    el('search-filetype').value = saved.searchFileType ?? '';
    el('excluded-sites').value = saved.excludedSites ?? DEFAULT_EXCLUDED_SITES.join('\n');
    prepared = Array.isArray(saved.preparedQueries) ? saved.preparedQueries : [];
    bases = Array.isArray(saved.preparedQueryBases) ? saved.preparedQueryBases : null;
    preparedFilters = saved.preparedFilters || null;
    seedCount(); render();
  }
  for (const [id, key] of [['seeds', 'seeds'], ['tuple-length', 'tupleLength'], ['tuple-count', 'tupleCount']]) {
    el(id).addEventListener('input', () => { onChange({ [key]: el(id).value }); seedCount(); });
    el(id).addEventListener('change', () => { seedCount({ clamp: true }); onChange({ tupleLength: el('tuple-length').value, tupleCount: el('tuple-count').value }); });
  }
  el('tuples').addEventListener('input', () => {
    // Manual edits take priority over an in-progress generated replacement.
    controller?.abort();
    discardQueries('Tuples edited. Click Create search queries to update the query list.', { tuples: el('tuples').value });
    el('query-status').textContent = 'Tuples edited. Click Create search queries to update the query list.';
    seedCount(); render();
  });
  el('generate-tuples').addEventListener('click', async () => {
    if (busy() || destroyed) return;
    seedCount({ clamp: true }); onChange({ tupleLength: el('tuple-length').value, tupleCount: el('tuple-count').value });
    generating = true; controller = new AbortController(); controls();
    el('tuple-status').textContent = 'Generating unique tuples…';
    try {
      const result = await generateTuples(el('seeds').value, Number(el('tuple-length').value), Number(el('tuple-count').value), {
        signal: controller.signal,
        onProgress: (done, total) => { el('tuple-status').textContent = `Generated ${done.toLocaleString()} of ${total.toLocaleString()} tuples…`; }
      });
      if (destroyed) return;
      el('tuples').value = result.text; discardQueries('', { tuples: result.text });
      el('tuple-status').textContent = `${result.generated.toLocaleString()} unique tuples generated.${result.reduced ? ` Only ${BigInt(result.total).toLocaleString()} distinct combinations are possible with these settings.` : ''} Edit them below, then create search queries.`;
      el('query-status').textContent = ''; seedCount(); render();
    } catch (error) {
      if (!destroyed) el('tuple-status').textContent = controller.signal.aborted ? 'Generation stopped. Previous tuples have been kept.' : error.message;
    } finally { generating = false; controller = null; if (!destroyed) controls(); }
  });
  el('stop-tuples').addEventListener('click', () => controller?.abort());
  el('prepare-queries').addEventListener('click', () => {
    if (busy() || destroyed) return;
    try {
      const filters = normalizeSearchFilters({ fileType: el('search-filetype').value, excludedSites: el('excluded-sites').value });
      bases = parseQueries(el('tuples').value); preparedFilters = filters; page = 0; rebuildQueries();
      el('excluded-sites').value = filters.excludedSites.join('\n');
      onChange({ preparedQueries: prepared, preparedQueryBases: bases, preparedFilters, excludedSites: el('excluded-sites').value, searchFileType: filters.fileType });
    } catch (error) { el('query-status').textContent = error.message; return; }
    el('query-status').textContent = prepared.length ? 'Queries are ready. No searches have been opened.' : 'Enter at least one tuple or query, one per line.';
    render();
    if (prepared.length) { openWorkspaceSection('search-section'); el('query-list-heading').scrollIntoView?.({ block: 'nearest' }); }
  });
  el('engine').addEventListener('change', () => { rebuildQueries(); onChange({ preparedQueries: prepared }); render(); });
  for (const [id, key, type] of [['search-filetype', 'searchFileType', 'change'], ['excluded-sites', 'excludedSites', 'input']]) {
    el(id).addEventListener(type, () => {
      discardQueries('Search restrictions changed. Click Create search queries to update the query list.', { [key]: el(id).value }); render();
    });
  }
  el('save-site-defaults').addEventListener('click', async () => {
    if (destroyed || savingDefaults || busy()) return;
    savingDefaults = true; controls();
    try {
      const filters = normalizeSearchFilters({ excludedSites: el('excluded-sites').value });
      const reply = await getExtensionAPI().runtime.sendMessage({ type: 'save-user-defaults', projectId: getProjectId(), patch: { excludedSites: filters.excludedSites } });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not save your default exclusions.');
      if (!destroyed) el('site-default-status').textContent = 'Default exclusions saved for new projects in this browser. Existing projects keep their own lists.';
    } catch (error) { if (!destroyed) el('site-default-status').textContent = error.message; }
    finally { savingDefaults = false; if (!destroyed) controls(); }
  });
  el('previous-queries').addEventListener('click', () => { if (page > 0) { page--; render(); } });
  el('next-queries').addEventListener('click', () => { if ((page + 1) * PAGE_SIZE < prepared.length) { page++; render(); } });
  el('stop-query-tabs').addEventListener('click', () => { stopped = true; });
  el('open-all-queries').addEventListener('click', async () => {
    if (busy() || destroyed || !prepared.length) return;
    const queries = prepared.slice(), engine = engineID();
    if (!window.confirm(`Open all ${queries.length.toLocaleString()} queries in new ${engineName()} tabs? Search engines may refuse automated batch queries, block requests or show CAPTCHAs. Many tabs may slow your browser.`)) return;
    opening = true; stopped = false; controls(); let opened = 0;
    try {
      for (const query of queries) {
        if (stopped || destroyed) break;
        await openProjectSearch({ projectId: getProjectId(), engine, query, active: false }); opened++;
        if (!destroyed) el('query-status').textContent = `Opened ${opened.toLocaleString()} of ${queries.length.toLocaleString()} search tabs…`;
      }
      if (!destroyed) el('query-status').textContent = `${stopped ? 'Stopped. ' : ''}${opened.toLocaleString()} of ${queries.length.toLocaleString()} search tabs opened and tracked. Use Collect results and close project search tabs below.`;
    } catch (error) {
      if (!destroyed) el('query-status').textContent = `Opened ${opened.toLocaleString()} of ${queries.length.toLocaleString()} tabs before an error: ${error.message}. Use the individual query links to continue.`;
    } finally { opening = false; if (!destroyed) controls(); }
  });
  restore(draft);
  return { restore, isBusy: () => busy() || savingDefaults, destroy() { destroyed = true; stopped = true; controller?.abort(); } };
}

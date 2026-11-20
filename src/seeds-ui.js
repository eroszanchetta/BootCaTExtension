import { searchLanguageFilter } from './search-language.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { queryKey, queryPlan } from './query-lifecycle.js';
import { getExtensionAPI } from './extension-api.js';
import { confirmAction } from './dialogs.js';
import { SEARCH_FILE_TYPES, DEFAULT_EXCLUDED_SITES, normalizeSearchFilters } from './search-filters.js';
import { openWorkspaceSection } from './workspace-sections.js';
import { openProjectSearch } from './search-tabs-client.js';
import { ENGINES, searchURL, buildSearchQuery } from './engines.js';
import { parseSeeds, parseQueries, generateTuples, combinationCount } from './tuples.js';

export function initSeedsUI({ minimumSeeds = DEFAULT_SETTINGS.minimumSeeds, draft = {}, onChange = () => {}, getProjectId = () => null, onOpeningChange = () => {}, getLanguage = () => 'none' } = {}) {
  const el = id => document.getElementById(id), PAGE_SIZE = 100;
  // Add future advanced controls here: validation names, project draft keys,
  // restoration, busy state, and change handling share the same registry.
  const filterControls = [
    { id: 'search-filetype', key: 'searchFileType', name: 'fileType', event: 'change', initial: '' },
    { id: 'search-site', key: 'searchSite', name: 'site', event: 'input', initial: '' },
    { id: 'excluded-sites', key: 'excludedSites', name: 'excludedSites', event: 'input', initial: DEFAULT_EXCLUDED_SITES.join('\n'), format: value => value.join('\n') }
  ];
  const readFilters = () => normalizeSearchFilters(Object.fromEntries(filterControls.map(({ id, name }) => [name, el(id).value])));
  const markFilterError = error => {
    for (const { id, name } of filterControls) el(id).setAttribute?.('aria-invalid', String(error?.field === name));
  };
  let prepared = [], bases = null, preparedFilters = null, savingDefaults = false, page = 0, generating = false, opening = false, stopped = false, destroyed = false, controller;
  let pendingOpens = 0, confirming = false;
  const notifyOpening = () => { if (!destroyed) onOpeningChange(opening || pendingOpens > 0); };
  let tabStateReady = false;
  let tabState = { tabs: [], history: [] }, queryRows = [], filterTimer, filterPending = false, filtersValid = true;
  const engineID = () => el('engine').value || ENGINES[0].id;
  const languageFilter = () => searchLanguageFilter(engineID(), getLanguage());
  const engineName = () => ENGINES.find(engine => engine.id === engineID())?.name || engineID();
  const busy = () => generating || opening || confirming;
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
    for (const id of ['seeds', 'tuple-length', 'tuple-count', ...filterControls.map(field => field.id)]) el(id).disabled = busy();
    el('tuples').disabled = false;
    el('save-site-defaults').disabled = busy() || savingDefaults;
    const tupleLength = Number(el('tuple-length').value);
    el('generate-tuples').disabled = busy() || !Number.isInteger(tupleLength) || tupleLength < 1 || tupleLength > 10 || parseSeeds(el('seeds').value).length < Math.max(minimumSeeds, tupleLength);
    el('prepare-queries').disabled = busy() || !el('tuples').value.trim();
    const plan = queryPlan(prepared, engineID(), tabState, languageFilter()), button = el('open-all-queries');
    button.disabled = busy() || pendingOpens > 0 || !tabStateReady || filterPending || !filtersValid || !plan.missing.length;
    button.textContent = opening ? 'Opening queries…' : prepared.length && !tabStateReady ? 'Checking query tabs…' : prepared.length && !plan.missing.length ? 'No queries to open' : plan.started ? `Run missing queries (${plan.missing.length.toLocaleString()})` : 'Run all queries';
    el('query-run-hint').textContent = !prepared.length ? '' : !tabStateReady ? 'Checking search tabs…' : !plan.missing.length ? (plan.open ? 'All queries are open or collected.' : 'All search results have been collected.') : plan.started ? '' : 'Queries already open or collected will be skipped.';
    el('stop-tuples').hidden = !generating; el('stop-query-tabs').hidden = !opening;
    el('engine').disabled = opening;
    el('tuple-length').disabled = busy() || !parseSeeds(el('seeds').value).length;
  }
  function seedCount({ clamp = false } = {}) {
    const count = parseSeeds(el('seeds').value).length, maximum = Math.min(10, count);
    const length = el('tuple-length'), requested = el('tuple-count');
    length.max = String(maximum);
    if (clamp && count >= minimumSeeds && Number(length.value) > maximum) length.value = String(maximum);
    const k = Number(length.value), total = Number.isInteger(k) && k >= 1 && k <= maximum ? combinationCount(count, k) : 0n;
    requested.max = total.toString();
    if (clamp && count >= minimumSeeds && total > 0n && /^\d+$/.test(requested.value) && BigInt(requested.value) > total) requested.value = total.toString();
    el('tuple-length-hint').textContent = maximum ? `Choose 1–${maximum} seeds per tuple (up to 10).` : 'Add seeds to choose a tuple length (up to 10).';
    el('tuple-count-hint').textContent = `Maximum: ${total.toLocaleString()} unique tuples with these settings.`;
    el('seeds-counter').textContent = `${count.toLocaleString()} seed${count === 1 ? '' : 's'}`;
    const tuples = parseQueries(el('tuples').value).length;
    el('tuples-counter').textContent = `${tuples.toLocaleString()} tuple${tuples === 1 ? '' : 's'}`;
    el('seed-status').textContent = `${count.toLocaleString()} distinct seed${count === 1 ? '' : 's'}.${count < Math.max(minimumSeeds, k) ? ` At least ${Math.max(minimumSeeds, k)} are required to generate tuples.` : ''}`;
    el('tuple-warning').textContent = Number(requested.value) > 500 ? 'Large tuple lists may take longer to generate and review, and consume substantial browser storage. Generation can be stopped.' : '';
    controls();
  }
  function updateTabState(value, { authoritative = true } = {}) {
    if (authoritative && typeof value.revision === 'number' && typeof tabState.revision === 'number' && value.revision < tabState.revision) return;
    tabState = value;
    if (authoritative) tabStateReady = value.ready !== false;
    for (const row of queryRows) {
      const tabs = (value.tabs || []).filter(tab => queryKey(tab.engine, tab.query, tab.languageFilter) === queryKey(row.engine, row.query, row.languageFilter));
      const previous = (value.history || []).find(item => queryKey(item.engine, item.query, item.languageFilter) === queryKey(row.engine, row.query, row.languageFilter));
      const loading = tabs.filter(tab => tab.status === 'loading').length;
      const attention = tabs.filter(tab => tab.status === 'attention');
      const status = loading ? 'loading' : attention.length ? 'attention' : tabs.length ? (tabs.every(tab => tab.status === 'collected') ? 'collected' : 'loaded') : previous?.status || 'unopened';
      const labels = { unopened: '○ Not opened', loading: '◌ Loading…', loaded: '● Loaded', attention: '⚠ Needs attention', collected: '✓ Collected', closed: '○ Closed without collecting' };
      row.badge.textContent = labels[status] + (tabs.length > 1 ? ` (${tabs.length} tabs; ${loading} loading)` : '');
      row.badge.dataset.status = status;
      row.badge.title = attention[0]?.reason || tabs.find(tab => tab.status === status)?.reason || previous?.reason || (status === 'loaded' ? 'Loading finished; results will be checked when collected.' : '');
      row.tabId = (attention[0] || tabs[0])?.tabId;
      row.inspect.hidden = !tabs.length;
    }
    controls();
  }
  async function refreshQueryState() {
    const projectId = getProjectId();
    const reply = await getExtensionAPI().runtime.sendMessage({ type: 'get-project-search-tabs', projectId });
    if (destroyed || getProjectId() !== projectId) return;
    if (!reply?.ok || !Array.isArray(reply.tabs) || !Array.isArray(reply.history)) throw new Error(reply?.error || 'Could not check query tabs. Reopen the workspace to try again.');
    updateTabState(reply);
  }
  function updateLinks() {
    for (const row of queryRows) {
      const disabled = filterPending || !filtersValid;
      row.link.setAttribute?.('aria-disabled', String(disabled));
      if (disabled) row.link.removeAttribute?.('href');
      else row.link.href = searchURL(row.engine, row.query, row.languageFilter);
    }
  }
  function applyFilters({ persist = true } = {}) {
    clearTimeout(filterTimer); filterPending = false;
    try {
      const filters = readFilters();
      filtersValid = true; markFilterError();
      if (bases) {
        // A draft may have been saved during the typing pause, before its links.
        const needsSave = persist || JSON.stringify(preparedFilters) !== JSON.stringify(filters);
        preparedFilters = filters; rebuildQueries();
        if (needsSave) onChange({ preparedQueries: prepared, preparedQueryBases: bases, preparedFilters });
      }
      el('search-filter-status').textContent = prepared.length && bases ? 'Search queries updated.' : '';
      render();
    } catch (error) {
      filtersValid = false; markFilterError(error);
      el('search-filter-status').textContent = error.message; updateLinks(); controls();
    }
  }
  function render() {
    const pages = Math.max(1, Math.ceil(prepared.length / PAGE_SIZE)); page = Math.min(page, pages - 1);
    const body = el('prepared-queries'), scroll = body.scrollTop; body.replaceChildren(); queryRows = []; body.start = page * PAGE_SIZE + 1;
    for (const query of prepared.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const item = document.createElement('li'), link = document.createElement('a');
      link.href = searchURL(engineID(), query, languageFilter()); link.textContent = query; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const open = async event => {
        if (event.type === 'auxclick' && event.button !== 1) return;
        if (event.type === 'click' && event.button > 0) return;
        event.preventDefault();
        if (destroyed || busy() || filterPending || !filtersValid) return;
        pendingOpens++; notifyOpening(); controls();
        try {
          await openProjectSearch({ projectId: getProjectId(), engine: engineID(), query, languageFilter: languageFilter(), active: !(event.button === 1 || event.ctrlKey || event.metaKey) });
          if (!destroyed) { await refreshQueryState(); el('query-status').textContent = ''; }
        } catch (error) { if (!destroyed) el('query-status').textContent = error.message; }
        finally { pendingOpens--; notifyOpening(); if (!destroyed) controls(); }
      };
      link.addEventListener('click', open); link.addEventListener('auxclick', open);
      const badge = document.createElement('span'), inspect = document.createElement('button');
      badge.className = 'query-tab-status'; inspect.className = 'secondary query-tab-action'; inspect.type = 'button';
      inspect.title = 'Open search tab'; inspect.setAttribute('aria-label', 'Open search tab');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, value);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M14 3h7v7M10 14 21 3M21 14v7H3V3h7'); icon.append(path); inspect.append(icon);
      const row = { query, engine: engineID(), languageFilter: languageFilter(), badge, inspect, link }; queryRows.push(row);
      inspect.addEventListener('click', async () => {
        if (!row.tabId || destroyed) return;
        try {
          const reply = await getExtensionAPI().runtime.sendMessage({ type: 'focus-project-search-tab', projectId: getProjectId(), tabId: row.tabId });
          if (!reply?.ok) throw new Error(reply?.error || 'Could not show this tab.');
        } catch (error) { if (!destroyed) el('query-status').textContent = error.message; }
      });
      item.append(badge, inspect, link); body.append(item);
    }
    body.scrollTop = scroll; updateTabState(tabState, { authoritative: false }); updateLinks();
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
    for (const { id, key, initial } of filterControls) el(id).value = saved[key] ?? initial;
    prepared = Array.isArray(saved.preparedQueries) ? saved.preparedQueries : [];
    bases = Array.isArray(saved.preparedQueryBases) ? saved.preparedQueryBases : null;
    preparedFilters = saved.preparedFilters || null;
    clearTimeout(filterTimer); filterPending = false; filtersValid = true;
    seedCount(); applyFilters({ persist: false });
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
        minimumSeeds, signal: controller.signal,
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
    clearTimeout(filterTimer); filterPending = false;
    try {
      const filters = readFilters();
      bases = parseQueries(el('tuples').value); preparedFilters = filters; page = 0; rebuildQueries();
      const patch = {};
      for (const { id, key, name, format = value => value } of filterControls) {
        el(id).value = format(filters[name]); patch[key] = el(id).value;
      }
      onChange({ preparedQueries: prepared, preparedQueryBases: bases, preparedFilters, ...patch });
      filtersValid = true; markFilterError(); el('search-filter-status').textContent = '';
    } catch (error) { applyFilters(); el('query-status').textContent = error.message; return; }
    el('query-status').textContent = prepared.length ? '' : 'Enter at least one tuple or query, one per line.';
    render();
    if (prepared.length) openWorkspaceSection('search-section', { scroll: true });
  });
  el('engine').addEventListener('change', () => { applyFilters(); onChange({ preparedQueries: prepared }); });
  for (const { id, key, event } of filterControls) {
    el(id).addEventListener(event, () => {
      onChange({ [key]: el(id).value });
      clearTimeout(filterTimer);
      if (event === 'change') applyFilters();
      else {
        filterPending = true; el('search-filter-status').textContent = 'Updating search queries…';
        updateLinks(); controls();
        filterTimer = setTimeout(() => { if (!destroyed) applyFilters(); }, 400);
      }
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
    if (busy() || pendingOpens || destroyed || !tabStateReady || filterPending || !filtersValid || !queryPlan(prepared, engineID(), tabState, languageFilter()).missing.length) return;
    const projectAtConfirmation = getProjectId(), engine = engineID(), filter = languageFilter();
    confirming = true; controls();
    let opened = 0, skipped = 0, queries = [], startedOpening = false;
    try {
      // Fresh state avoids stale confirmations; the serialized background check
      // still guards every individual opening against other workspace windows.
      await refreshQueryState();
      if (destroyed || getProjectId() !== projectAtConfirmation) return;
      const plan = queryPlan(prepared, engine, tabState, filter); queries = plan.missing;
      if (!queries.length) return;
      const label = plan.started ? 'Run missing queries' : 'Run all queries';
      const approved = await confirmAction({ title: `${label}?`, message: `Open ${queries.length.toLocaleString()} ${engineName()} search tab${queries.length === 1 ? '' : 's'}?`, confirmLabel: label });
      if (!approved || destroyed || getProjectId() !== projectAtConfirmation) return;
      opening = startedOpening = true; confirming = false; stopped = false; notifyOpening(); controls();
      for (const query of queries) {
        if (stopped || destroyed || getProjectId() !== projectAtConfirmation) break;
        const result = await openProjectSearch({ projectId: projectAtConfirmation, engine, query, languageFilter: filter, active: false, onlyMissing: true });
        if (result.opened === false) skipped++; else opened++;
        if (!destroyed) {
          if (Array.isArray(result.tabs)) updateTabState(result);
          el('query-status').textContent = `Opening ${(opened + skipped).toLocaleString()} of ${queries.length.toLocaleString()} search tabs…`;
        }
      }
      if (!destroyed) el('query-status').textContent = `${stopped ? `Stopped. Opened ${opened.toLocaleString()} of ${queries.length.toLocaleString()} search tabs.` : `Opened ${opened.toLocaleString()} search tab${opened === 1 ? '' : 's'}.`}${skipped ? ` ${skipped.toLocaleString()} already open or collected queries skipped.` : ''}`;
    } catch (error) {
      if (!destroyed) el('query-status').textContent = `Opened ${opened.toLocaleString()} of ${queries.length.toLocaleString()} tabs before an error: ${error.message}. Missing queries can be retried once their tab state is checked.`;
    } finally {
      if (!destroyed && getProjectId() === projectAtConfirmation) {
        try { await refreshQueryState(); }
        catch (error) { tabStateReady = false; el('query-status').textContent = error.message; }
      }
      opening = confirming = false;
      if (startedOpening) notifyOpening();
      if (!destroyed) controls();
    }
  });
  restore(draft);
  return { restore, updateTabState, refreshLanguage: render, setMinimumSeeds(value) { minimumSeeds = value; seedCount(); }, isBusy: () => busy() || pendingOpens > 0 || savingDefaults || filterPending, destroy() { destroyed = true; clearTimeout(filterTimer); stopped = true; controller?.abort(); } };
}

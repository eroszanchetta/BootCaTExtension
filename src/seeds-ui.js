import { getExtensionAPI } from './extension-api.js';
import { ENGINES, searchURL } from './engines.js';
import { parseSeeds, parseQueries, generateTuples } from './tuples.js';

export function initSeedsUI({ draft = {}, onChange = () => {} } = {}) {
  const ext = getExtensionAPI(), el = id => document.getElementById(id), PAGE_SIZE = 100;
  let prepared = [], page = 0, generating = false, opening = false, stopped = false, destroyed = false, controller;
  const engineID = () => el('engine').value || ENGINES[0].id;
  const engineName = () => ENGINES.find(engine => engine.id === engineID())?.name || engineID();
  const busy = () => generating || opening;
  function controls() {
    for (const id of ['seeds', 'tuple-length', 'tuple-count', 'tuples', 'generate-tuples']) el(id).disabled = busy();
    el('prepare-queries').disabled = busy() || !el('tuples').value.trim();
    el('open-all-queries').disabled = busy() || !prepared.length;
    el('stop-tuples').hidden = !generating; el('stop-query-tabs').hidden = !opening;
    el('engine').disabled = opening;
  }
  function seedCount() {
    const count = parseSeeds(el('seeds').value).length;
    el('seed-status').textContent = `${count.toLocaleString()} distinct seed${count === 1 ? '' : 's'}.${count < 5 ? ' At least 5 are required to generate tuples.' : ''}`;
    el('tuple-warning').textContent = Number(el('tuple-count').value) > 500 ? 'Large tuple lists may take longer to generate and review, and consume substantial browser storage. Generation can be stopped.' : '';
  }
  function render() {
    const pages = Math.max(1, Math.ceil(prepared.length / PAGE_SIZE)); page = Math.min(page, pages - 1);
    const body = el('prepared-queries'); body.replaceChildren(); body.start = page * PAGE_SIZE + 1;
    for (const query of prepared.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const item = document.createElement('li'), link = document.createElement('a');
      link.href = searchURL(engineID(), query); link.textContent = query; link.target = '_blank'; link.rel = 'noopener noreferrer';
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
    prepared = Array.isArray(saved.preparedQueries) ? saved.preparedQueries : [];
    seedCount(); render();
  }
  for (const [id, key] of [['seeds', 'seeds'], ['tuple-length', 'tupleLength'], ['tuple-count', 'tupleCount']]) {
    el(id).addEventListener('input', () => { onChange({ [key]: el(id).value }); seedCount(); });
  }
  el('tuples').addEventListener('input', () => {
    prepared = []; page = 0;
    onChange({ tuples: el('tuples').value, preparedQueries: [] });
    el('query-status').textContent = 'Tuples edited. Click Create search queries to update the query list.';
    render();
  });
  el('generate-tuples').addEventListener('click', async () => {
    if (busy() || destroyed) return;
    generating = true; controller = new AbortController(); controls();
    el('tuple-status').textContent = 'Generating unique tuples…';
    try {
      const result = await generateTuples(el('seeds').value, Number(el('tuple-length').value), Number(el('tuple-count').value), {
        signal: controller.signal,
        onProgress: (done, total) => { el('tuple-status').textContent = `Generated ${done.toLocaleString()} of ${total.toLocaleString()} tuples…`; }
      });
      if (destroyed) return;
      el('tuples').value = result.text; prepared = []; page = 0;
      onChange({ tuples: result.text, preparedQueries: [] });
      el('tuple-status').textContent = `${result.generated.toLocaleString()} unique tuples generated.${result.reduced ? ` Only ${BigInt(result.total).toLocaleString()} distinct combinations are possible with these settings.` : ''} Edit them below, then create search queries.`;
      el('query-status').textContent = ''; render();
    } catch (error) {
      if (!destroyed) el('tuple-status').textContent = controller.signal.aborted ? 'Generation stopped. Previous tuples have been kept.' : error.message;
    } finally { generating = false; controller = null; if (!destroyed) controls(); }
  });
  el('stop-tuples').addEventListener('click', () => controller?.abort());
  el('prepare-queries').addEventListener('click', () => {
    if (busy() || destroyed) return;
    prepared = parseQueries(el('tuples').value); page = 0;
    onChange({ preparedQueries: prepared });
    el('query-status').textContent = prepared.length ? 'Queries are ready. No searches have been opened.' : 'Enter at least one tuple or query, one per line.';
    render();
    if (prepared.length) el('query-list-heading').scrollIntoView?.({ block: 'nearest' });
  });
  el('engine').addEventListener('change', render);
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
        await ext.tabs.create({ url: searchURL(engine, query), active: false }); opened++;
        if (!destroyed) el('query-status').textContent = `Opened ${opened.toLocaleString()} of ${queries.length.toLocaleString()} search tabs…`;
      }
      if (!destroyed) el('query-status').textContent = `${stopped ? 'Stopped. ' : ''}${opened.toLocaleString()} of ${queries.length.toLocaleString()} search tabs opened. Collect results from each results tab using the toolbar icon.`;
    } catch (error) {
      if (!destroyed) el('query-status').textContent = `Opened ${opened.toLocaleString()} of ${queries.length.toLocaleString()} tabs before an error: ${error.message}. Use the individual query links to continue.`;
    } finally { opening = false; if (!destroyed) controls(); }
  });
  restore(draft);
  return { restore, isBusy: busy, destroy() { destroyed = true; stopped = true; controller?.abort(); } };
}

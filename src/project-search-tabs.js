import { challengeMessage } from './search-feedback.js';
import { searchLanguageFilter, languageFilterFromURL } from './search-language.js';
import { normalizeQuery, queryKey, queryPlan } from './query-lifecycle.js';
import { adapterForURL, searchURL, extractResults } from './engines.js';
export const SEARCH_TABS_KEY = 'projectSearchTabs';
export const SLOW_TAB_MS = 30_000;
const empty = () => ({ tabs: [], history: [], batch: null });
function remember(data, record, status, reason = '') {
  const previous = (data.history || []).find(item => item.projectId === record.projectId && queryKey(item.engine, item.query, item.languageFilter) === queryKey(record.engine, record.query, record.languageFilter));
  if (previous?.status === 'collected' && status !== 'collected') return;
  data.history = (data.history || []).filter(item => !(item.projectId === record.projectId && queryKey(item.engine, item.query, item.languageFilter) === queryKey(record.engine, record.query, record.languageFilter)));
  data.history.push({ projectId: record.projectId, engine: record.engine, query: record.query, ...(record.languageFilter ? { languageFilter: record.languageFilter } : {}), status, reason });
}
function rememberClosed(data, record) {
  const collected = record.status === 'collected';
  remember(data, record, collected ? 'collected' : 'closed', collected ? 'Results saved; tab closed.' : 'Tab closed without collecting.');
}
function updateLoading(record, tab) {
  record.unloaded = !!tab.discarded;
  if (tab.discarded) { record.status = 'attention'; record.reason = 'Tab was unloaded by the browser. Open it to reload, then retry.'; return; }
  if (record.challenge) { record.status = 'attention'; return; }
  if (tab.status !== 'complete') {
    if (record.status !== 'loading') record.loadingSince = Date.now();
    record.status = 'loading'; record.reason = '';
  } else if (!record.status || record.status === 'loading') {
    record.status = 'loaded'; record.reason = '';
  }
}
const canonical = value => { const url = new URL(value); url.hash = ''; return url.href; };
const queryText = normalizeQuery;
export function matchesProjectSearch(record, value) {
  try {
    const adapter = adapterForURL(value), url = new URL(value);
    return !url.username && !url.password && adapter?.id === record.engine && queryText(url.searchParams.get(adapter.queryParam) || '') === queryText(record.query) && languageFilterFromURL(record.engine, value) === (record.languageFilter || '');
  } catch { return false; }
}
function isProviderGate(record, value) {
  try {
    const url = new URL(value), host = url.hostname.replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const google = /^(?:(?:consent|accounts)\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
    const provider = record.engine === 'google' ? google : record.engine === 'duckduckgo' ? /^(html\.)?duckduckgo\.com$/.test(host) : record.engine === 'ecosia' && host === 'ecosia.org';
    return !!provider && (/^\/cdn-cgi\/challenge-platform(\/|$)/i.test(url.pathname) || /^\/(sorry|captcha|challenge|consent|anomaly)(\/|\.|$)/i.test(url.pathname) || (record.engine === 'google' && /^(consent|accounts)\./.test(host)));
  } catch { return false; }
}
export function createProjectSearchTabs({ ext, serialize, assertProject, collectPage }) {
  const workerToken = crypto.randomUUID(), navigation = new Map(), probes = new Map();
  let known = new Set(), activeBatch = null;
  async function read() {
    if (!ext.storage.session) throw new Error('This browser does not support safe session tab tracking.');
    const data = (await ext.storage.session.get(SEARCH_TABS_KEY))[SEARCH_TABS_KEY] || empty();
    data.history ||= [];
    known = new Set(data.tabs.map(record => record.tabId)); return data;
  }
  async function write(data) {
    data.revision = (data.revision || 0) + 1;
    await ext.storage.session.set({ [SEARCH_TABS_KEY]: data });
    known = new Set(data.tabs.map(record => record.tabId));
    for (const id of navigation.keys()) if (!known.has(id)) navigation.delete(id);
    const tokens = new Set(data.tabs.map(record => record.token));
    for (const token of probes.keys()) if (!tokens.has(token)) probes.delete(token);
  }
  // Caller already holds the background write queue, including project reset.
  async function resetInQueue() {
    if (activeBatch) activeBatch.stopped = true;
    activeBatch = null; probes.clear();
    await write(empty());
  }
  async function restoreCollected(data, projectId) {
    // Saved search provenance outlives workspace and browser restarts. Partial
    // snapshots are deliberately excluded: those queries still need collection.
    let changed = false;
    const { collections = [] } = await ext.storage.local?.get('collections') || {};
    const history = new Map((data.history || []).map(item => [JSON.stringify([item.projectId, queryKey(item.engine, item.query, item.languageFilter)]), item]));
    for (const collection of collections) {
      if (typeof collection.query !== 'string' || !collection.engine || (collection.unresolved && !collection.acceptedPartial) || !collection.results?.length) continue;
      const item = { projectId, engine: collection.engine, query: collection.query, ...(languageFilterFromURL(collection.engine, collection.pageURL) ? { languageFilter: languageFilterFromURL(collection.engine, collection.pageURL) } : {}), status: 'collected', reason: 'Results saved in this project.' };
      const key = JSON.stringify([projectId, queryKey(item.engine, item.query, item.languageFilter)]);
      // Browser storage may reorder object fields. Compare the actual completion
      // value, rather than JSON object order, to avoid an onChanged refresh loop.
      if (history.get(key)?.status === 'collected') continue;
      history.set(key, item); changed = true;
    }
    if (changed) { data.history = [...history.values()]; await write(data); }
  }
  async function open({ projectId, engine, query, active, onlyMissing = false, languageFilter }) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('Enter a search query first.');
    return serialize(async () => {
      const project = await assertProject(projectId);
      const effectiveFilter = searchLanguageFilter(engine, project?.language);
      if (languageFilter !== undefined && languageFilter !== effectiveFilter) throw new Error('The project language changed. Try opening the query again.');
      const url = searchURL(engine, query, effectiveFilter);
      const data = await read();
      if (onlyMissing) {
        await reconcile(data, projectId); await restoreCollected(data, projectId);
        const state = status(data, projectId);
        if (!queryPlan([query], engine, state, effectiveFilter).missing.length) return { opened: false, ...state };
      }
      const tab = await ext.tabs.create({ url, active: active !== false });
      if (!Number.isInteger(tab?.id)) throw new Error('The browser did not return a search tab ID.');
      const record = { tabId: tab.id, token: crypto.randomUUID(), projectId, engine, query, ...(effectiveFilter ? { languageFilter: effectiveFilter } : {}), createdURL: url, revision: 0 };
      updateLoading(record, tab); data.tabs.push(record);
      try { await write(data); }
      catch (error) { throw new Error(`The search tab opened but could not be tracked. Collect it manually. (${error.message})`); }
      return { tabId: tab.id, opened: true, ...(onlyMissing ? status(data, projectId) : {}) };
    });
  }
  function status(data, projectId) {
    const batch = data.batch?.projectId === projectId ? data.batch : null;
    const tabs = data.tabs.filter(record => record.projectId === projectId && !record.acceptedPartial).map(record => ({
      tabId: record.tabId, engine: record.engine, query: record.query, ...(record.languageFilter ? { languageFilter: record.languageFilter } : {}), status: record.status || 'loading', reason: record.reason || '', ...(record.challenge ? { challenge: true } : {}), unloaded: !!record.unloaded,
      slow: record.status === 'loading' && Date.now() - record.loadingSince >= SLOW_TAB_MS
    }));
    return { revision: data.revision || 0, count: tabs.length, loaded: tabs.filter(tab => tab.status !== 'loading' && !tab.unloaded && !tab.challenge).length, blocked: tabs.filter(tab => tab.challenge).length,
      loading: tabs.filter(tab => tab.status === 'loading').length, tabs,
      history: (data.history || []).filter(item => item.projectId === projectId), batch };
  }
  async function inspectRecord(record, tab, force = false) {
    const url = tab.pendingUrl || tab.url;
    if (isProviderGate(record, url)) {
      record.challenge = 'redirect'; record.status = 'attention';
      record.reason = 'Open this tab to complete the challenge, consent or sign-in, then retry collection.';
      return false;
    }
    let recovered = false;
    if (record.challenge === 'redirect' && tab.status === 'complete' && matchesProjectSearch(record, url)) {
      delete record.challenge; record.status = 'loaded'; record.reason = ''; recovered = true;
    }
    if (!ext.scripting?.executeScript || tab.discarded || !matchesProjectSearch(record, url)) return recovered;
    const signature = `${record.revision}:${tab.status}:${tab.title || ''}`, previous = probes.get(record.token);
    const suspected = /just a moment|attention required|verify.*human|checking.*browser|security verification/i.test(tab.title || '');
    if (tab.status !== 'complete' && !record.challenge && !suspected && Date.now() - record.loadingSince < SLOW_TAB_MS) return recovered;
    if (!force && previous?.signature === signature && (!record.challenge && !suspected || Date.now() < previous.next)) return recovered;
    probes.set(record.token, { signature, next: Date.now() + 2000 });
    const epoch = navigation.get(record.tabId) || 0; let timeout;
    try {
      const reply = await Promise.race([
        ext.scripting.executeScript({ target: { tabId: record.tabId }, injectImmediately: true, func: extractResults, args: [adapterForURL(url)] }),
        new Promise(resolve => { timeout = setTimeout(() => resolve(null), 1200); })
      ]);
      const result = reply?.[0]?.result;
      if (!result || !result.pageURL || canonical(result.pageURL) !== canonical(url) || epoch !== (navigation.get(record.tabId) || 0)) return false;
      if (result.challenge) {
        record.challenge = 'verification'; record.status = 'attention'; record.reason = challengeMessage(record.engine); recovered = false;
      } else if (record.challenge && result.results?.length) {
        delete record.challenge; record.status = tab.status === 'complete' ? 'loaded' : 'loading'; record.loadingSince ||= Date.now(); record.reason = ''; return true;
      }
    } catch { /* Missing permissions or a still-loading document remain inspectable. */ }
    finally { clearTimeout(timeout); }
    return recovered;
  }
  // Reconcile only our own tab IDs, including events missed while the worker slept.
  async function reconcile(data, projectId) {
    const before = JSON.stringify(data), recovered = new Set();
    for (const record of data.tabs.filter(item => item.projectId === projectId)) {
      let tab;
      try { tab = await ext.tabs.get(record.tabId); }
      catch { rememberClosed(data, record); data.tabs = data.tabs.filter(item => item !== record); continue; }
      const url = tab.pendingUrl || tab.url;
      if (url && !matchesProjectSearch(record, url) && !isProviderGate(record, url)) {
        remember(data, record, 'closed', 'Tab moved to another page or query; no longer tracked.');
        data.tabs = data.tabs.filter(item => item !== record); continue;
      }
      updateLoading(record, tab);
      if (await inspectRecord(record, tab)) recovered.add(record.engine);
    }
    // Solving one provider challenge can unlock its other tabs in the same session.
    // Recheck each blocked tab; never infer that a sibling is ready or collect it here.
    for (const record of data.tabs.filter(item => item.projectId === projectId && item.challenge && recovered.has(item.engine))) {
      try { await inspectRecord(record, await ext.tabs.get(record.tabId), true); } catch {}
    }
    if (JSON.stringify(data) !== before) await write(data);
  }
  async function getState(projectId) {
    return serialize(async () => {
      await assertProject(projectId); const data = await read();
      await reconcile(data, projectId); await restoreCollected(data, projectId);
      if (data.batch?.running && (data.batch.workerToken !== workerToken || activeBatch?.id !== data.batch.id)) {
        data.batch.running = false; data.batch.interrupted = true; await write(data);
      }
      return status(data, projectId);
    });
  }
  async function forget(tabId) {
    return serialize(async () => {
      const data = await read(), count = data.tabs.length;
      const record = data.tabs.find(item => item.tabId === tabId);
      if (record) rememberClosed(data, record);
      data.tabs = data.tabs.filter(record => record.tabId !== tabId);
      if (data.tabs.length !== count) await write(data);
    });
  }
  ext.tabs.onRemoved?.addListener(tabId => { forget(tabId).catch(() => {}); });
  ext.tabs.onReplaced?.addListener((addedId, removedId) => { forget(removedId).catch(() => {}); });
  ext.tabs.onUpdated?.addListener((tabId, change, tab) => {
    if (!known.has(tabId)) return;
    if (!change.url && !change.status && change.title === undefined && change.discarded === undefined) return;
    // Invalidate synchronously too: a navigation may arrive while tabs.get is
    // pending immediately before a close. Ignore content of untracked tabs.
    if (change.url || change.status === 'loading') navigation.set(tabId, (navigation.get(tabId) || 0) + 1);
    serialize(async () => {
      const data = await read(), record = data.tabs.find(item => item.tabId === tabId);
      if (!record) return;
      const url = change.url || tab?.pendingUrl || tab?.url;
      if (url && !matchesProjectSearch(record, url) && !isProviderGate(record, url)) {
        remember(data, record, 'closed', 'Tab moved to another page or query; no longer tracked.');
        data.tabs = data.tabs.filter(item => item !== record);
      } else {
        if (change.url || change.status === 'loading') {
          delete record.acceptedPartial;
          record.revision++; record.status = 'loading'; record.loadingSince = Date.now(); record.reason = '';
        }
        updateLoading(record, { ...tab, ...(change.status ? { status: change.status } : {}), ...(change.discarded !== undefined ? { discarded: change.discarded } : {}) });
      }
      await reconcile(data, record.projectId);
      await write(data);
    }).catch(() => {});
  });
  ext.runtime.onStartup?.addListener(() => serialize(resetInQueue).catch(() => {}));
  ext.runtime.onInstalled?.addListener(() => serialize(resetInQueue).catch(() => {}));
  async function snapshot(projectId, original) {
    return serialize(async () => {
      await assertProject(projectId); const data = await read();
      const record = data.tabs.find(item => item.tabId === original.tabId && item.token === original.token && item.projectId === projectId);
      if (!record) return { outcome: 'skipped', reason: 'Tab was closed or is no longer tracked.' };
      let tab;
      try { tab = await ext.tabs.get(record.tabId); }
      catch { data.tabs = data.tabs.filter(item => item !== record); await write(data); return { outcome: 'skipped', reason: 'Tab has been closed.' }; }
      if (!tab.url && !tab.pendingUrl) return { outcome: 'skipped', reason: 'Cannot read this tab. Check website access permissions, then retry; tab left open.' };
      if (!matchesProjectSearch(record, tab.pendingUrl || tab.url)) {
        if (isProviderGate(record, tab.pendingUrl || tab.url)) return { outcome: 'skipped', reason: 'Search-provider challenge, consent or sign-in page. Complete it in the tab, then retry collection.' };
        data.tabs = data.tabs.filter(item => item !== record); await write(data);
        return { outcome: 'skipped', reason: 'Tab moved to another page or query; left open.' };
      }
      if (record.challenge || record.acceptedPartial) return { outcome: 'skipped', reason: record.reason };
      if (tab.discarded || tab.status !== 'complete') return { outcome: 'skipped', reason: 'Tab is loading or unloaded; open it and retry collection.' };
      return { record: { ...record }, url: canonical(tab.url), navigation: navigation.get(record.tabId) || 0 };
    });
  }
  async function closeSaved(projectId, saved, run) {
    return serialize(async () => {
      await assertProject(projectId); const data = await read(), expected = saved.record;
      const record = data.tabs.find(item => item.tabId === expected.tabId && item.token === expected.token && item.projectId === projectId);
      if (!record || record.revision !== expected.revision) return { reason: 'Results saved, but the tab changed; left open.' };
      let tab;
      try { tab = await ext.tabs.get(record.tabId); }
      catch { data.tabs = data.tabs.filter(item => item !== record); await write(data); return { reason: 'Results saved; tab was already closed.' }; }
      if (run.stopped) return { reason: 'Results saved; stopped before closing the tab.' };
      if (record.challenge || tab.status !== 'complete' || tab.discarded || !matchesProjectSearch(record, tab.pendingUrl || tab.url) || canonical(tab.url) !== saved.url || (navigation.get(record.tabId) || 0) !== saved.navigation) {
        return { reason: 'Results saved, but the tab navigated or started loading; left open.' };
      }
      await ext.tabs.remove(record.tabId);
      remember(data, record, 'collected', 'Results saved and tab closed.');
      data.tabs = data.tabs.filter(item => item !== record); await write(data);
      return { closed: true };
    });
  }
  async function updateBatch(run, change) {
    return serialize(async () => {
      const data = await read();
      if (data.batch?.id !== run.id || data.batch.projectId !== run.projectId) return false;
      change(data.batch, data); await write(data); return true;
    });
  }
  async function runBatch(run, records) {
    try {
      for (const record of records) {
        if (run.stopped) break;
        let outcome = 'failed', saved = false, complete = false, reason;
        try {
          const snap = await snapshot(run.projectId, record);
          if (!snap.record) { outcome = snap.outcome; reason = snap.reason; }
          else {
            const result = await collectPage(record.tabId, run.projectId, snap); saved = true; complete = !result?.unresolved;
            if (run.stopped) { outcome = 'saved'; reason = 'Results saved; stopped before closing the tab.'; }
            else {
              if (result?.unresolved) { outcome = 'partial'; reason = result.linkWarning || 'Some links could not be added. Open the search tab to review them.'; }
              else { const closed = await closeSaved(run.projectId, snap, run); outcome = closed.closed ? 'closed' : 'saved'; reason = closed.reason; }
            }
          }
        } catch (error) { reason = `${saved ? 'Results saved, but tab could not be closed: ' : ''}${error.message}`; }
        const exists = await updateBatch(run, (batch, data) => {
          if (saved && complete) remember(data, record, 'collected', 'Results saved in this project.');
          const current = data.tabs.find(item => item.token === record.token);
          if (current && outcome !== 'closed') { current.status = current.status === 'loading' ? 'loading' : 'attention'; current.reason = reason || 'Inspect this tab, then retry collection.'; }
          batch.processed++; if (saved) batch.saved++;
          if (outcome === 'closed') batch.closed++; else if (outcome === 'skipped') batch.skipped++; else batch.leftOpen++;
        });
        if (!exists) break;
      }
    } finally {
      try { await updateBatch(run, batch => { batch.running = false; batch.stopped = run.stopped; }); }
      finally { if (activeBatch === run) activeBatch = null; }
    }
  }
  async function start(projectId, { loadedOnly = false } = {}) {
    const prepared = await serialize(async () => {
      await assertProject(projectId);
      if (activeBatch) throw new Error('Project search-tab collection is already running.');
      const data = await read(); await reconcile(data, projectId);
      const state = status(data, projectId);
      if (state.loading && !loadedOnly) throw new Error('Wait for search tabs to finish loading, or close stuck tabs.');
      if (loadedOnly && state.loading && !state.tabs.some(tab => tab.slow)) throw new Error('Search tabs are still loading. Please wait.');
      const records = data.tabs.filter(record => record.projectId === projectId && !record.acceptedPartial && (!loadedOnly || (record.status !== 'loading' && !record.unloaded)));
      if (!records.length) throw new Error('No loaded project search tabs to collect.');
      const run = { id: crypto.randomUUID(), projectId, stopped: false };
      data.batch = { id: run.id, projectId, workerToken, running: true, total: records.length, processed: 0, saved: 0, closed: 0, skipped: 0, leftOpen: 0 };
      await write(data); activeBatch = run;
      return { run, records, state: status(data, projectId) };
    });
    runBatch(prepared.run, prepared.records).catch(() => {});
    return prepared.state;
  }
  async function stop(projectId) {
    if (activeBatch?.projectId === projectId) activeBatch.stopped = true;
    return serialize(async () => {
      await assertProject(projectId);
      if (activeBatch?.projectId === projectId) activeBatch.stopped = true;
      const data = await read();
      if (data.batch?.projectId === projectId && data.batch.running) { data.batch.stopping = true; await write(data); }
      return status(data, projectId);
    });
  }
  async function focus(projectId, tabId) {
    return serialize(async () => {
      await assertProject(projectId); const data = await read();
      if (!data.tabs.some(item => item.projectId === projectId && item.tabId === tabId)) throw new Error('This tab is no longer tracked.');
      const tab = await ext.tabs.update(tabId, { active: true });
      if (Number.isInteger(tab.windowId) && ext.windows?.update) await ext.windows.update(tab.windowId, { focused: true });
      return { tabId };
    });
  }
  async function collectionMarker(projectId, tabId, url) {
    return serialize(async () => {
      await assertProject(projectId); const data = await read();
      const record = data.tabs.find(item => item.projectId === projectId && item.tabId === tabId);
      if (record && !matchesProjectSearch(record, url)) return null;
      const adapter = adapterForURL(url);
      return { projectId, tabId, url: canonical(url), engine: adapter?.id,
        query: adapter ? new URL(url).searchParams.get(adapter.queryParam) || '' : '',
        languageFilter: languageFilterFromURL(adapter?.id, url),
        record: record ? { ...record } : null, navigation: navigation.get(tabId) || 0 };
    });
  }
  // Caller holds the background write queue and has durably saved the results.
  // Never assign ownership to a manually collected, otherwise untracked tab.
  async function markCollectedInQueue(marker, result) {
    if (!marker?.engine || canonical(result.pageURL) !== marker.url) return;
    await assertProject(marker.projectId);
    const data = await read(), expected = marker.record;
    const record = data.tabs.find(item => item.projectId === marker.projectId && item.tabId === marker.tabId);
    if (expected && (!record || record.token !== expected.token || record.revision !== expected.revision)) return;
    if (!expected && record) return;
    let tab;
    try { tab = await ext.tabs.get(marker.tabId); } catch { return; }
    const url = tab.pendingUrl || tab.url;
    if (!url || tab.status !== 'complete' || tab.discarded || canonical(url) !== marker.url || (navigation.get(marker.tabId) || 0) !== marker.navigation) return;
    const status = result.unresolved ? 'attention' : 'collected';
    const reason = result.unresolved ? 'Partial results saved. Some links could not be resolved; inspect this tab and retry.' : 'Results saved. This tab remains open.';
    if (record) { record.status = status; record.reason = reason; }
    remember(data, { projectId: marker.projectId, engine: marker.engine, query: marker.query, languageFilter: marker.languageFilter }, status, reason);
    await write(data);
  }
  async function acceptCollectedInQueue(projectId, collections) {
    const data = await read();
    for (const collection of collections) {
      for (const record of data.tabs.filter(item => item.projectId === projectId && item.engine === collection.engine && matchesProjectSearch(item, collection.pageURL))) {
        record.acceptedPartial = true; record.status = 'collected'; record.reason = 'Collected URLs kept; remaining links skipped.';
        remember(data, record, 'collected', record.reason);
      }
    }
    await restoreCollected(data, projectId); await write(data);
  }
  return { open, getState, start, stop, focus, collectionMarker, markCollectedInQueue, acceptCollectedInQueue, resetInQueue };
}

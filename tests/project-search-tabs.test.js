import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSearchTabs, matchesProjectSearch, SEARCH_TABS_KEY, SLOW_TAB_MS } from '../src/project-search-tabs.js';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), release: () => resolve() }; };
function fixture(options = {}) {
  let currentProject = 'project', nextId = 1, writes = Promise.resolve();
  const tabs = new Map(), session = {}, collected = [], removed = [], saved = new Set(), gets = new Map();
  const serialize = task => { const next = writes.then(task); writes = next.catch(() => {}); return next; };
  const assertProject = async id => { if (id !== currentProject) throw new Error('The project changed.'); };
  const ext = {
    runtime: { onStartup: event(), onInstalled: event() },
    storage: { session: {
      get: async key => ({ [key]: structuredClone(session[key]) }),
      set: async data => { if (options.write) await options.write(data); Object.assign(session, structuredClone(data)); }
    } },
    tabs: {
      onRemoved: event(), onUpdated: event(), onReplaced: event(),
      update: async (id, patch) => { if (!tabs.has(id)) throw new Error('No tab'); Object.assign(tabs.get(id), patch); return { ...tabs.get(id) }; },
      create: async ({ url, active }) => { const tab = { id: nextId++, url, active, status: 'complete' }; tabs.set(tab.id, tab); return { ...tab }; },
      get: async id => {
        if (!tabs.has(id)) throw new Error('No tab');
        gets.set(id, (gets.get(id) || 0) + 1); const tab = { ...tabs.get(id) };
        if (options.get) await options.get(id, gets.get(id), { tabs, ext }); return tab;
      },
      remove: async id => {
        assert.ok(saved.has(id), 'never close a tab before results are durably saved');
        if (options.remove) await options.remove(id);
        tabs.delete(id); removed.push(id); ext.tabs.onRemoved.emit(id);
      }
    }
  };
  const collectPage = async (id, projectId, snapshot) => {
    collected.push(id);
    const result = options.collect ? await options.collect(id, snapshot, { tabs, ext }) : { unresolved: 0 };
    await assertProject(projectId); saved.add(id); return result;
  };
  const manager = createProjectSearchTabs({ ext, serialize, assertProject, collectPage });
  const open = query => manager.open({ projectId: currentProject, engine: 'google', query, active: false });
  const state = () => manager.getState(currentProject);
  async function finish() {
    for (let i = 0; i < 1000; i++) { const value = await state(); if (!value.batch?.running) return value; await new Promise(resolve => setTimeout(resolve, 2)); }
    throw new Error('Batch did not finish');
  }
  return { manager, open, state, finish, tabs, session, collected, removed, saved, ext, serialize, assertProject, collectPage,
    async reset(id = 'next-project') { await serialize(async () => { currentProject = id; await manager.resetInQueue(); }); }
  };
}
test('project query matching accepts pagination/country redirects but rejects another query, provider, mode or unsafe URL', () => {
  const record = { engine: 'google', query: '"solar power" energy' };
  assert.ok(matchesProjectSearch(record, 'https://www.google.it/search?q=%22solar+power%22+energy&start=10'));
  for (const value of ['https://www.google.com/search?q=other', 'https://duckduckgo.com/?q=%22solar+power%22+energy', 'https://www.google.com/search?q=%22solar+power%22+energy&udm=2', 'https://user:pass@google.com/search?q=x', 'https://google.com.evil.test/search?q=x']) assert.equal(matchesProjectSearch(record, value), false);
});
test('only API-created project tabs are collected; results are saved before closing and unrelated search tabs remain', async () => {
  const app = fixture(); const opened = await app.open('energy');
  app.tabs.set(900, { id: 900, url: 'https://www.google.com/search?q=energy', status: 'complete' });
  await app.manager.start('project'); const state = await app.finish();
  assert.deepEqual(app.collected, [opened.tabId]); assert.deepEqual(app.removed, [opened.tabId]); assert.ok(app.tabs.has(900));
  assert.equal(state.batch.closed, 1); assert.equal(state.count, 0);
  await assert.rejects(app.manager.open({ projectId: 'old-project', engine: 'google', query: 'x' }), /project changed/);
});
test('CAPTCHAs, partial results, failed saves, loading tabs and changed queries stay open', async () => {
  const app = fixture({ collect: async (_, snap) => {
    if (['captcha', 'storage'].includes(snap.record.query)) throw new Error(snap.record.query === 'captcha' ? 'CAPTCHA or unsupported page' : 'Storage quota error');
    return { unresolved: snap.record.query === 'partial' ? 1 : 0 };
  } });
  const ids = {};
  for (const query of ['good', 'captcha', 'partial', 'storage', 'loading', 'moved', 'closed']) ids[query] = (await app.open(query)).tabId;
  app.tabs.get(ids.loading).status = 'loading'; app.tabs.get(ids.moved).url = 'https://www.google.com/search?q=other'; app.tabs.delete(ids.closed);
  await assert.rejects(app.manager.start('project'), /finish loading/);
  await app.state();
  app.session[SEARCH_TABS_KEY].tabs.find(tab => tab.tabId === ids.loading).loadingSince = Date.now() - SLOW_TAB_MS - 100;
  await app.manager.start('project', { loadedOnly: true }); const result = await app.finish();
  assert.deepEqual(app.removed, [ids.good]); assert.equal(result.batch.saved, 2); assert.equal(result.batch.skipped, 0);
  assert.equal(result.batch.leftOpen, 3); assert.equal(result.count, 4);
  for (const query of ['captcha', 'partial', 'storage', 'loading', 'moved']) assert.ok(app.tabs.has(ids[query]));
  assert.ok(result.batch.details.some(detail => /Partial results saved/.test(detail.reason)));
});
test('navigation during collection or while the final URL check is pending prevents closing', async () => {
  const app = fixture({ collect: async (id, _, { tabs, ext }) => {
    tabs.get(id).url = 'https://example.org/unrelated'; ext.tabs.onUpdated.emit(id, { url: tabs.get(id).url }, tabs.get(id)); return { unresolved: 0 };
  } });
  const { tabId } = await app.open('energy'); await app.manager.start('project'); const state = await app.finish();
  assert.equal(state.batch.saved, 1); assert.equal(state.batch.closed, 0); assert.ok(app.tabs.has(tabId));
  const late = fixture({ get: async (id, count, { tabs, ext }) => {
    if (count === 2) { tabs.get(id).url = 'https://example.org/late'; ext.tabs.onUpdated.emit(id, { status: 'loading', url: tabs.get(id).url }, tabs.get(id)); }
  } });
  await late.open('energy'); await late.manager.start('project'); assert.equal((await late.finish()).batch.closed, 0); assert.equal(late.removed.length, 0);
});
test('stop keeps the current saved page open and skips remaining tabs; duplicate starts are rejected', async () => {
  const started = gate(), pending = gate();
  const app = fixture({ collect: async () => { started.release(); await pending.promise; return { unresolved: 0 }; } });
  await app.open('one'); await app.open('two'); await app.manager.start('project'); await started.promise;
  await assert.rejects(app.manager.start('project'), /already running/);
  await app.manager.stop('project'); pending.release(); const result = await app.finish();
  assert.equal(result.batch.stopped, true); assert.equal(result.batch.saved, 1); assert.equal(result.batch.closed, 0); assert.equal(result.count, 2);
});
test('reset during injection prevents old results/closures and permits a new project batch', async () => {
  const started = gate(), pending = gate();
  const app = fixture({ collect: async (_, snap) => { if (snap.record.query === 'old') { started.release(); await pending.promise; } return { unresolved: 0 }; } });
  const old = await app.open('old'); await app.manager.start('project'); await started.promise;
  await app.reset(); const fresh = await app.open('fresh'); await app.manager.start('next-project');
  pending.release(); await app.finish();
  assert.ok(app.tabs.has(old.tabId)); assert.equal(app.saved.has(old.tabId), false); assert.deepEqual(app.removed, [fresh.tabId]);
});

test('Stop received during the final browser check prevents the pending close', async () => {
  const started = gate(), pending = gate();
  const app = fixture({ get: async (_, count) => { if (count === 2) { started.release(); await pending.promise; } } });
  await app.open('energy'); await app.manager.start('project'); await started.promise;
  const stopping = app.manager.stop('project'); pending.release(); await stopping;
  assert.equal((await app.finish()).batch.closed, 0); assert.equal(app.removed.length, 0);
});
test('manually closed tabs lose tracking; worker interruption is recoverable and browser startup discards ownership', async () => {
  const app = fixture(); const closed = await app.open('closed'); app.tabs.delete(closed.tabId); app.ext.tabs.onRemoved.emit(closed.tabId);
  assert.equal((await app.state()).count, 0);
  const tracked = await app.open('still-open');
  app.session[SEARCH_TABS_KEY].batch = { id: 'old-worker', projectId: 'project', workerToken: 'terminated', running: true, total: 1, processed: 0, saved: 0, closed: 0, skipped: 0, leftOpen: 0, details: [] };
  assert.equal((await app.state()).batch.interrupted, true);
  const restarted = createProjectSearchTabs({ ext: app.ext, serialize: app.serialize, assertProject: app.assertProject, collectPage: app.collectPage });
  assert.equal((await restarted.getState('project')).count, 1);
  app.ext.runtime.onStartup.emit();
  assert.equal((await restarted.getState('project')).count, 0); assert.ok(app.tabs.has(tracked.tabId));
});
test('a close failure preserves saved results and leaves the tab available for retry', async () => {
  const app = fixture({ remove: async () => { throw new Error('Browser refused close'); } });
  const { tabId } = await app.open('energy'); await app.manager.start('project'); const result = await app.finish();
  assert.equal(result.batch.saved, 1); assert.equal(result.batch.closed, 0); assert.equal(result.count, 1); assert.ok(app.tabs.has(tabId));
  assert.match(result.batch.details[0].reason, /Results saved.*Browser refused close/);
});

test('withheld website permissions keep the tab tracked and open without reading its contents', async () => {
  const app = fixture(); const { tabId } = await app.open('energy'); delete app.tabs.get(tabId).url;
  await app.manager.start('project'); const result = await app.finish();
  assert.equal(result.count, 1); assert.equal(result.batch.skipped, 1); assert.equal(app.collected.length, 0); assert.equal(app.removed.length, 0);
  assert.match(result.batch.details[0].reason, /permissions/);
});

test('recognized provider challenge redirects stay tracked for manual resolution and can be retried', async () => {
  const app = fixture(); const { tabId } = await app.open('energy');
  app.tabs.get(tabId).url = 'https://www.google.com/sorry/index?continue=search';
  app.ext.tabs.onUpdated.emit(tabId, { url: app.tabs.get(tabId).url }, app.tabs.get(tabId));
  await app.manager.start('project'); const blocked = await app.finish();
  assert.equal(blocked.count, 1); assert.equal(app.collected.length, 0); assert.equal(app.removed.length, 0);
  assert.match(blocked.batch.details[0].reason, /challenge/);
  app.tabs.get(tabId).url = 'https://www.google.com/search?q=energy';
  app.ext.tabs.onUpdated.emit(tabId, { url: app.tabs.get(tabId).url }, app.tabs.get(tabId));
  await app.manager.start('project'); assert.equal((await app.finish()).batch.closed, 1);
});

test('loading blocks collection; manually closing a loading tab releases the remaining loaded tabs', async () => {
  const app = fixture();
  const ready = await app.open('ready'), stuck = await app.open('stuck');
  app.tabs.get(stuck.tabId).status = 'loading';
  app.ext.tabs.onUpdated.emit(stuck.tabId, { status: 'loading' }, app.tabs.get(stuck.tabId));
  const loading = await app.state();
  assert.equal(loading.loading, 1); assert.equal(loading.loaded, 1);
  await assert.rejects(app.manager.start('project'), /finish loading/);
  assert.equal(app.collected.length, 0);
  app.tabs.delete(stuck.tabId); app.ext.tabs.onRemoved.emit(stuck.tabId);
  const closed = await app.state();
  assert.equal(closed.loading, 0); assert.equal(closed.count, 1);
  assert.equal(closed.history.find(item => item.query === 'stuck').status, 'closed');
  await app.manager.start('project'); const finished = await app.finish();
  assert.deepEqual(app.removed, [ready.tabId]);
  assert.equal(finished.history.find(item => item.query === 'ready').status, 'collected');
  await assert.rejects(app.manager.start('project'), /No loaded/);
});

test('slow loading permits explicit collection of loaded tabs, keeps stuck tabs, and completion survives worker restart', async () => {
  const app = fixture(); const ready = await app.open('ready'), stuck = await app.open('stuck');
  app.tabs.get(stuck.tabId).status = 'loading'; await app.state();
  await assert.rejects(app.manager.start('project', { loadedOnly: true }), /still loading/);
  app.session[SEARCH_TABS_KEY].tabs.find(tab => tab.tabId === stuck.tabId).loadingSince = Date.now() - SLOW_TAB_MS - 100;
  assert.equal((await app.state()).tabs.find(tab => tab.tabId === stuck.tabId).slow, true);
  await app.manager.start('project', { loadedOnly: true }); await app.finish();
  assert.deepEqual(app.removed, [ready.tabId]); assert.ok(app.tabs.has(stuck.tabId));
  app.tabs.get(stuck.tabId).status = 'complete';
  app.ext.tabs.onUpdated.emit(stuck.tabId, { status: 'complete' }, app.tabs.get(stuck.tabId));
  assert.equal((await app.state()).tabs[0].status, 'loaded');
  const restarted = createProjectSearchTabs({ ext: app.ext, serialize: app.serialize, assertProject: app.assertProject, collectPage: app.collectPage });
  const state = await restarted.getState('project');
  assert.equal(state.loading, 0); assert.equal(state.loaded, 1);
  assert.equal(state.history[0].status, 'collected');
  await restarted.start('project');
  for (let i = 0; i < 100; i++) { const next = await restarted.getState('project'); if (!next.batch.running) break; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.equal(app.tabs.has(stuck.tabId), false);
});

test('failed collection shows attention, retry after manual resolution clears it, and focus is scoped to owned tabs', async () => {
  let blocked = true;
  const app = fixture({ collect: async () => { if (blocked) throw new Error('CAPTCHA required'); return { unresolved: 0 }; } });
  const { tabId } = await app.open('captcha'); await app.manager.start('project');
  const attention = await app.finish(); assert.equal(attention.tabs[0].status, 'attention');
  assert.match(attention.tabs[0].reason, /CAPTCHA/); assert.equal(attention.loading, 0);
  await app.manager.focus('project', tabId); assert.equal(app.tabs.get(tabId).active, true);
  await assert.rejects(app.manager.focus('other-project', tabId), /project changed/);
  await assert.rejects(app.manager.focus('project', 999), /no longer tracked/);
  blocked = false;
  app.tabs.get(tabId).status = 'loading'; app.ext.tabs.onUpdated.emit(tabId, { status: 'loading' }, app.tabs.get(tabId));
  assert.equal((await app.state()).loading, 1);
  app.tabs.get(tabId).status = 'complete'; app.ext.tabs.onUpdated.emit(tabId, { status: 'complete' }, app.tabs.get(tabId));
  assert.equal((await app.state()).tabs[0].status, 'loaded');
  await app.manager.start('project'); assert.equal((await app.finish()).history[0].status, 'collected');
});

test('unloaded tabs need attention and are not counted as loaded; unrelated tab updates do not enter tracking', async () => {
  const app = fixture(); const { tabId } = await app.open('unloaded');
  app.tabs.get(tabId).discarded = true;
  const state = await app.state(); assert.equal(state.tabs[0].status, 'attention'); assert.equal(state.loaded, 0);
  app.ext.tabs.onUpdated.emit(999, { status: 'loading' }, { id: 999, url: 'https://www.google.com/search?q=unrelated' });
  assert.equal((await app.state()).count, 1);
});

test('manual collection updates tracked tabs, survives manual closure, and records untracked queries without acquiring ownership', async () => {
  const app = fixture(); const { tabId } = await app.open('manual');
  const marker = await app.manager.collectionMarker('project', tabId, app.tabs.get(tabId).url);
  await app.serialize(() => app.manager.markCollectedInQueue(marker, { pageURL: marker.url, unresolved: 0 }));
  assert.equal((await app.state()).tabs[0].status, 'collected'); assert.ok(app.tabs.has(tabId)); assert.equal(app.removed.length, 0);
  app.tabs.delete(tabId); app.ext.tabs.onRemoved.emit(tabId);
  assert.equal((await app.state()).history[0].status, 'collected');
  const url = 'https://www.google.com/search?q=untracked';
  app.tabs.set(900, { id: 900, url, status: 'complete' });
  const untracked = await app.manager.collectionMarker('project', 900, url);
  await app.serialize(() => app.manager.markCollectedInQueue(untracked, { pageURL: url, unresolved: 0 }));
  const state = await app.state(); assert.equal(state.count, 0);
  assert.equal(state.history.find(item => item.query === 'untracked').status, 'collected'); assert.ok(app.tabs.has(900));
});

test('manual partial collection needs attention; navigation during collection prevents a stale collected badge', async () => {
  const app = fixture(); const { tabId } = await app.open('partial'); const url = app.tabs.get(tabId).url;
  const marker = await app.manager.collectionMarker('project', tabId, url);
  await app.serialize(() => app.manager.markCollectedInQueue(marker, { pageURL: url, unresolved: 1 }));
  assert.equal((await app.state()).tabs[0].status, 'attention');
  app.tabs.get(tabId).status = 'loading'; app.ext.tabs.onUpdated.emit(tabId, { status: 'loading' }, app.tabs.get(tabId));
  app.tabs.get(tabId).status = 'complete'; app.ext.tabs.onUpdated.emit(tabId, { status: 'complete' }, app.tabs.get(tabId));
  await app.serialize(() => app.manager.markCollectedInQueue(marker, { pageURL: url, unresolved: 0 }));
  assert.equal((await app.state()).tabs[0].status, 'loaded');
  const newMarker = await app.manager.collectionMarker('project', tabId, url);
  await app.reset();
  await assert.rejects(app.serialize(() => app.manager.markCollectedInQueue(newMarker, { pageURL: url, unresolved: 0 })), /project changed/);
});

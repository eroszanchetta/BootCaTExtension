import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION_CONTROLS_KEY, DEFAULT_COLLECTION_CONTROLS, readCollectionControls, saveCollectionControls } from '../src/collection-preferences.js';
import { resetProjectLocalState } from '../src/project-local-state.js';
import { createCollectionActions } from '../src/collection-actions.js';
import { createFloatingManager } from '../src/floating-manager.js';
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const area = data => ({ get: async key => key === null ? structuredClone(data) : { [key]: structuredClone(data[key]) }, set: async patch => Object.assign(data, structuredClone(patch)), remove: async keys => { for (const key of keys) delete data[key]; } });

test('collection switches default off, position defaults top-right, and preferences survive closure/replacement', async () => {
  const data = {}, storage = area(data);
  assert.deepEqual(await readCollectionControls(storage), DEFAULT_COLLECTION_CONTROLS);
  const snapshot = await readCollectionControls(storage);
  await saveCollectionControls(storage, { closeCollectedTab: true });
  await saveCollectionControls(storage, { closeCapturedTab: true, floatingEnabled: true, floatingPosition: 'bottom-left' });
  assert.equal(snapshot.closeCollectedTab, false, 'existing operation snapshots are immutable');
  await resetProjectLocalState(storage, null); await resetProjectLocalState(storage, { id: 'next' });
  assert.deepEqual(await readCollectionControls(storage), { closeCollectedTab: true, closeCapturedTab: true, floatingEnabled: true, floatingPosition: 'bottom-left' });
  for (const patch of [{ floatingEnabled: 'true' }, { closeCapturedTab: 1 }, { floatingPosition: 'center' }, { unknown: true }]) await assert.rejects(saveCollectionControls(storage, patch));
  assert.equal((await readCollectionControls(storage)).floatingPosition, 'bottom-left');
});
function actionsFixture() {
  let writes = Promise.resolve(), project = 'p', saved = false;
  const tabs = new Map([[1, { id: 1, url: 'https://example.org/article', status: 'complete' }]]), removed = [];
  const serialize = task => { const next = writes.then(task); writes = next.catch(() => {}); return next; };
  const ext = { tabs: { onUpdated: event(), onRemoved: event(), get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; }, remove: async id => { assert.equal(saved, true, 'close only after durable save'); removed.push(id); tabs.delete(id); ext.tabs.onRemoved.emit(id); } } };
  const actions = createCollectionActions({ ext, serialize, assertProject: async id => { if (id !== project) throw new Error('Project changed'); } });
  const run = (task, closeAfterSuccess = true) => actions.run({ projectId: 'p', tabId: 1, action: 'save-page', closeAfterSuccess }, async tab => { const result = await task(tab); saved = true; return result; });
  return { ext, run, tabs, removed, replaceProject() { project = 'new'; } };
}

test('background action closes only after durable success, deduplicates concurrent requests, and keeps defaults open', async () => {
  const app = actionsFixture(), gate = deferred(); let calls = 0;
  const task = async () => { calls++; await gate.promise; return {}; };
  const first = app.run(task), second = app.run(task); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.deepEqual(app.removed, []);
  gate.resolve(); const replies = await Promise.all([first, second]);
  assert.ok(replies.every(reply => reply.closed)); assert.deepEqual(app.removed, [1]);
  const keep = actionsFixture(); await keep.run(async () => ({}), false); assert.deepEqual(keep.removed, []);
});

test('navigation away and back, reloads, project replacement, and partial results leave tabs open', async () => {
  for (const kind of ['navigation', 'reload', 'project', 'partial']) {
    const app = actionsFixture();
    const reply = await app.run(async () => {
      if (kind === 'navigation') { app.ext.tabs.onUpdated.emit(1, { url: 'https://other.test' }); app.ext.tabs.onUpdated.emit(1, { url: 'https://example.org/article' }); }
      if (kind === 'reload') app.ext.tabs.onUpdated.emit(1, { status: 'loading' });
      if (kind === 'project') app.replaceProject();
      return kind === 'partial' ? { unresolved: 1 } : {};
    });
    assert.equal(reply.closed, false, kind); assert.ok(reply.closeWarning); assert.deepEqual(app.removed, []);
  }
});

test('failed saves never close, and failure to close is reported as a successful save with a warning', async () => {
  const failed = actionsFixture(); await assert.rejects(failed.run(async () => { throw new Error('Quota'); }), /Quota/); assert.deepEqual(failed.removed, []);
  const denied = actionsFixture(); denied.ext.tabs.remove = async () => { throw new Error('Browser refused'); };
  const result = await denied.run(async () => ({ count: 2 })); assert.equal(result.count, 2); assert.match(result.closeWarning, /Browser refused/);
});

test('floating registration covers existing/new tabs, hides on project closure and unregisters when disabled', async () => {
  const values = { [COLLECTION_CONTROLS_KEY]: { version: 1, values: { ...DEFAULT_COLLECTION_CONTROLS, floatingEnabled: true } } };
  let project = { id: 'active' }, registered = [];
  const injected = [], notified = [], ext = { storage: { local: area(values), onChanged: event() }, runtime: { onStartup: event(), onInstalled: event() },
    scripting: { getRegisteredContentScripts: async () => registered, registerContentScripts: async records => { registered = records; }, unregisterContentScripts: async () => { registered = []; }, executeScript: async request => { injected.push(request.target.tabId); } },
    tabs: { onUpdated: event(), query: async () => [{ id: 1, url: 'https://example.org' }, { id: 2, url: 'http://example.org' }, { id: 3, url: 'chrome://settings' }], sendMessage: async id => { notified.push(id); } } };
  const manager = createFloatingManager({ ext, getProject: async () => project }); await manager.sync();
  assert.deepEqual(registered[0].matches, ['http://*/*', 'https://*/*']); assert.equal(registered[0].allFrames, false);
  assert.deepEqual([...new Set(injected)], [1, 2]);
  ext.tabs.onUpdated.emit(9, { status: 'complete' }, { url: 'https://new.test' }); await new Promise(resolve => setImmediate(resolve)); assert.ok(injected.includes(9));
  project = null; await manager.sync(); assert.equal(registered.length, 0); assert.ok(notified.includes(1));
  values[COLLECTION_CONTROLS_KEY].values.floatingEnabled = false; await manager.sync(); assert.equal(registered.length, 0);
});

test('a changed dynamic result set is saved but never automatically closed', async () => {
  const ext = {tabs:{get:async()=>({id:1,url:'https://duckduckgo.com/?q=flowers',status:'complete'}),remove:async()=>assert.fail('Changed results must stay open')}};
  const actions = createCollectionActions({ext,serialize:fn=>fn(),assertProject:async()=>{},verifyBeforeClose:async()=>false});
  const reply = await actions.run({projectId:'p',tabId:1,action:'collect',closeAfterSuccess:true},async()=>({count:10}));
  assert.equal(reply.count,10); assert.equal(reply.closed,false); assert.match(reply.closeWarning,/results changed/);
});

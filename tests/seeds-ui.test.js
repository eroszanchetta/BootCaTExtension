import { searchLanguageFilter } from '../src/search-language.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { queryKey, queryPlan } from '../src/query-lifecycle.js';
import { SEARCH_FILE_TYPES, DEFAULT_EXCLUDED_SITES, normalizeSearchFilters } from '../src/search-filters.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { ENGINES, searchURL, buildSearchQuery } from '../src/engines.js';
import { parseSeeds, parseQueries, generateTuples, combinationCount } from '../src/tuples.js';
import * as storage from '../src/project-store.js';

const source = (await readFile(new URL('../src/seeds-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
class Element {
  constructor() { this.value = ''; this.textContent = ''; this.handlers = {}; this.children = []; this.disabled = false; this.dataset = {}; this.attributes = {}; this.scrollTop = 0; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'href') delete this.href; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
}
function fixture(options = {}) {
  const elements = new Map(), draft = { excludedSites: '', ...options.draft }, opened = [], confirmations = [];
  let confirmed = true, tabState = options.tabState || { tabs: [], history: [] };
  const stateReply = () => ({ ok: true, ...structuredClone(tabState) });
  const get = id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
  get('engine').value = 'google';
  const context = vm.createContext({
    DEFAULT_SETTINGS, searchLanguageFilter, setTimeout, clearTimeout, queryKey, queryPlan, openWorkspaceSection() {}, combinationCount, SEARCH_FILE_TYPES, DEFAULT_EXCLUDED_SITES, normalizeSearchFilters,
    document: { getElementById: get, createElement: () => new Element(), createElementNS: () => new Element() },
    confirmAction: async ({ message }) => { confirmations.push(message); return options.confirm ? options.confirm(message) : confirmed; },
    getExtensionAPI: () => ({ runtime: { sendMessage: async message => message.type === 'get-project-search-tabs' ? (options.stateReply ? options.stateReply(stateReply()) : stateReply()) : options.saveDefaults ? options.saveDefaults(message) : { ok: true } }, tabs: { create: async value => { if (options.open) await options.open(value, opened.length); opened.push(value); } } }),
    getProjectId: () => 'project',
    openProjectSearch: async ({ projectId, engine, query, active, onlyMissing, languageFilter }) => {
      assert.equal(projectId, 'project');
      if (onlyMissing && !queryPlan([query], engine, tabState, languageFilter).missing.length) return { opened: false, ...stateReply() };
      const value = { url: searchURL(engine, query, languageFilter), active };
      if (options.open) await options.open(value, opened.length); opened.push(value);
      tabState.tabs.push({ tabId: opened.length, engine, query, ...(languageFilter ? { languageFilter } : {}), status: 'loading' });
      return { tabId: opened.length, opened: true, ...stateReply() };
    },
    ENGINES, searchURL, buildSearchQuery, parseSeeds, parseQueries, AbortController, BigInt,
    generateTuples: (text, length, count, config) => generateTuples(text, length, count, { ...config, random: () => 0n }),
    getLanguage: options.getLanguage || (() => 'none'), onOpeningChange: options.onOpeningChange || (() => {}), draft, onChange: patch => Object.assign(draft, patch)
  });
  vm.runInContext(source + '\nglobalThis.seeds = initSeedsUI({draft, onChange, getProjectId, onOpeningChange, getLanguage});', context);
  const ui = vm.runInContext('seeds', context);
  if (!options.unready) ui.updateTabState(tabState);
  return { setState(value) { tabState = value; ui.updateTabState(value); }, get, draft, opened, confirmations, setConfirmed: value => { confirmed = value; }, ui: vm.runInContext('seeds', context),
    input(id, value) { get(id).value = value; get(id).handlers.input(); }, click: id => get(id).handlers.click() };
}
test('generate, edit and prepare tuples without opening tabs; engine changes update all query links', async () => {
  const app = fixture(); assert.equal(app.get('tuple-length').value, '3');
  app.input('seeds', 'solar power\nenergy\nstorage\ncapacity\ngeneration'); await app.click('generate-tuples');
  assert.equal(app.get('tuples').value.split('\n').length, 10);
  assert.ok(app.get('tuples').value.includes('"solar power"'));
  app.input('tuples', '"custom phrase" energy\nstorage capacity\nstorage capacity'); await app.click('prepare-queries');
  assert.equal(app.get('prepared-queries').children.length, 2); assert.equal(app.opened.length, 0);
  const link = app.get('prepared-queries').children[0].children[2];
  assert.equal(new URL(link.href).searchParams.get('q'), '"custom phrase" energy'); assert.equal(link.target, '_blank');
  app.get('engine').value = 'duckduckgo'; app.get('engine').handlers.change();
  assert.equal(new URL(app.get('prepared-queries').children[0].children[2].href).hostname, 'duckduckgo.com');
  app.input('tuples', 'changed query'); assert.equal(app.get('prepared-queries').children.length, 0);
  assert.equal(app.get('open-all-queries').disabled, true);
});
test('batch opening requires confirmation, warns about engine refusal and opens only the approved queries', async () => {
  const app = fixture({ draft: { tuples: 'first\nsecond', preparedQueries: ['first', 'second'] } });
  app.setConfirmed(false); await app.click('open-all-queries'); assert.equal(app.opened.length, 0);
  app.setConfirmed(true); await app.click('open-all-queries'); assert.equal(app.opened.length, 2);
  assert.ok(app.confirmations.every(message => /refuse automated batch queries/.test(message)));
  assert.deepEqual(app.opened.map(value => [new URL(value.url).searchParams.get('q'), value.active]), [['first', false], ['second', false]]);
});

test('normal, Ctrl/Cmd and middle clicks open registered project searches with the appropriate focus', async () => {
  const app = fixture({ draft: { preparedQueries: ['my query'] } });
  const link = app.get('prepared-queries').children[0].children[2];
  for (const event of [
    { type: 'click', button: 0 }, { type: 'click', button: 0, ctrlKey: true },
    { type: 'click', button: 0, metaKey: true }, { type: 'auxclick', button: 1 }
  ]) {
    let prevented = false; await link.handlers[event.type]({ ...event, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.deepEqual(app.opened.map(value => value.active), [true, false, false, false]);
  await link.handlers.auxclick({ type: 'auxclick', button: 2, preventDefault() { assert.fail('leave the browser context menu available'); } });
  assert.equal(app.opened.length, 4);
});

test('stopping tuple generation keeps the previously edited tuples and prepared queries', async () => {
  const app = fixture({ draft: { seeds: 'a\nb\nc\nd\ne', tuples: 'my edited query', preparedQueries: ['my edited query'] } });
  const generation = app.click('generate-tuples'); app.click('stop-tuples'); await generation;
  assert.equal(app.get('tuples').value, 'my edited query');
  assert.equal(app.get('prepared-queries').children[0].children[2].textContent, 'my edited query');
  assert.match(app.get('tuple-status').textContent, /Generation stopped/); assert.equal(app.ui.isBusy(), false);
});
test('batch opening can stop or report partial failures while individual query links remain', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const app = fixture({ draft: { preparedQueries: ['first', 'second', 'third'] }, open: async () => gate });
  const opening = app.click('open-all-queries'); assert.equal(app.ui.isBusy(), true); await new Promise(resolve => setImmediate(resolve));
  app.click('stop-query-tabs'); release(); await opening;
  assert.equal(app.opened.length, 1); assert.match(app.get('query-status').textContent, /Stopped.*1 of 3/);
  assert.equal(app.get('open-all-queries').textContent, 'Run missing queries (2)');
  await app.click('open-all-queries'); assert.equal(app.opened.length, 3); assert.equal(app.get('open-all-queries').disabled, true);
  const failing = fixture({ draft: { preparedQueries: ['first', 'second', 'third'] }, open: async (_, index) => { if (index === 1) throw new Error('Tab refused'); } });
  await failing.click('open-all-queries'); assert.equal(failing.opened.length, 1);
  assert.match(failing.get('query-status').textContent, /1 of 3.*Tab refused/); assert.equal(failing.get('prepared-queries').children.length, 3);
});
test('query pagination retains all links, and destroyed projects stop pending batch work', async () => {
  const queries = Array.from({ length: 205 }, (_, i) => `query${i}`), app = fixture({ draft: { preparedQueries: queries } });
  assert.equal(app.get('prepared-queries').children.length, 100); app.click('next-queries'); app.click('next-queries');
  assert.equal(app.get('prepared-queries').children.length, 5); assert.equal(app.get('prepared-queries').start, 201);
  assert.equal(app.get('prepared-queries').children[4].children[2].textContent, 'query204');
  let release; const gate = new Promise(resolve => { release = resolve; });
  const pending = fixture({ draft: { preparedQueries: ['one', 'two'] }, open: async () => gate });
  const opening = pending.click('open-all-queries'); await new Promise(resolve => setImmediate(resolve)); pending.ui.destroy(); release(); await opening;
  assert.equal(pending.opened.length, 1);
});
test('seed drafts, edited tuples, parameters and query lists persist and reset with the project', async () => {
  globalThis.indexedDB = new IDBFactory(); await storage.ensureStoredProject('seeds');
  const draft = { seeds: 'a\nb\nc\nd\ne', tupleLength: '2', tupleCount: '17', tuples: 'a b\nc d', preparedQueries: ['a b', 'c d'] };
  await storage.saveDraft('seeds', draft); const loaded = (await storage.loadWorkspace('seeds')).draft;
  const app = fixture({ draft: loaded }); assert.equal(app.get('seeds').value, draft.seeds);
  assert.equal(app.get('tuple-length').value, '2'); assert.equal(app.get('tuple-count').value, '17');
  assert.equal(app.get('tuples').value, draft.tuples); assert.equal(app.get('prepared-queries').children.length, 2);
  await storage.resetStoredProject('new'); const reset = (await storage.loadWorkspace('new')).draft;
  assert.equal(reset.seeds, ''); assert.equal(reset.tuples, ''); assert.equal(reset.preparedQueries.length, 0);
  assert.equal(reset.tupleLength, '3'); assert.equal(reset.tupleCount, '10');
});

test('counters and exact combination limits follow edits, duplicates, tuple length and large seed sets', () => {
  const app = fixture(); assert.equal(app.get('seeds-counter').textContent, '0 seeds');
  app.input('seeds', 'a\nb\nc\nd\ne\na\n');
  assert.equal(app.get('tuple-length').max, '5'); assert.equal(app.get('tuple-count').max, '10');
  assert.match(app.get('tuple-length-hint').textContent, /1–5/); assert.equal(app.get('seeds-counter').textContent, '5 seeds');
  app.input('tuple-length', '2'); assert.equal(app.get('tuple-count').max, '10');
  app.input('seeds', 'a\nb\nc\nd\ne\nf'); assert.equal(app.get('tuple-count').max, '15');
  app.input('tuple-count', '999'); app.get('tuple-count').handlers.change(); assert.equal(app.get('tuple-count').value, '15');
  app.input('tuples', 'a b\na b\n c d\n'); assert.equal(app.get('tuples-counter').textContent, '2 tuples');
  app.input('seeds', Array.from({length: 10000}, (_, i) => `s${i}`).join('\n')); app.input('tuple-length', '10');
  assert.equal(app.get('tuple-length').max, '10'); assert.equal(app.get('tuple-count').max, combinationCount(10000, 10).toString());
  assert.ok(BigInt(app.get('tuple-count').max) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.match(app.get('tuple-count-hint').textContent, /unique tuples/);
});

test('generation needs five distinct seeds while manual tuples work with none and remain editable during generation', async () => {
  const app = fixture();
  assert.equal(app.get('generate-tuples').disabled, true); assert.equal(app.get('tuples').disabled, false);
  app.input('tuples', 'manual query'); await app.click('prepare-queries');
  assert.equal(app.get('prepared-queries').children[0].children[2].textContent, 'manual query');
  app.input('seeds', 'a\nb\nc\nd\na'); assert.equal(app.get('generate-tuples').disabled, true);
  app.input('seeds', 'a\nb\nc\nd\ne'); assert.equal(app.get('generate-tuples').disabled, false);
  const generation = app.click('generate-tuples'); assert.equal(app.get('tuples').disabled, false);
  app.input('tuples', 'edited during generation'); await generation;
  assert.equal(app.get('tuples').value, 'edited during generation');
  app.input('seeds', 'a\nb'); assert.equal(app.get('generate-tuples').disabled, true); assert.equal(app.get('tuples').disabled, false);
});

test('search restrictions compile once, appear in links and batch tabs, persist, and can be replaced without modifying tuples', async () => {
  let savedDefault;
  const app = fixture({ saveDefaults: async message => { savedDefault = message; return { ok: true }; } });
  app.input('tuples', 'solar energy'); app.input('excluded-sites', 'https://www.youtube.com/watch?v=1\nfacebook.com\nfacebook.com');
  app.get('search-filetype').value = 'pdf'; app.get('search-filetype').handlers.change(); await app.click('prepare-queries');
  const query = 'solar energy filetype:pdf -site:youtube.com -site:facebook.com';
  assert.equal(app.get('prepared-queries').children[0].children[2].textContent, query);
  assert.equal(app.get('tuples').value, 'solar energy'); assert.equal(app.draft.preparedQueries[0], query);
  app.get('engine').value = 'ecosia'; app.get('engine').handlers.change();
  assert.equal(new URL(app.get('prepared-queries').children[0].children[2].href).searchParams.get('q'), query);
  await app.click('open-all-queries'); assert.equal(new URL(app.opened[0].url).searchParams.get('q'), query);
  await app.click('save-site-defaults'); assert.deepEqual(JSON.parse(JSON.stringify(savedDefault.patch)), { excludedSites: ['youtube.com', 'facebook.com'] });
  const restored = fixture({ draft: app.draft }); assert.equal(restored.get('prepared-queries').children[0].children[2].textContent, query);
  restored.get('search-filetype').value = 'docx'; restored.get('search-filetype').handlers.change();
  assert.equal(restored.get('prepared-queries').children.length, 1); assert.equal(restored.get('open-all-queries').disabled, false);
  await restored.click('prepare-queries'); assert.equal(restored.get('prepared-queries').children[0].children[2].textContent, query.replace('filetype:pdf', 'filetype:docx'));
  restored.input('excluded-sites', 'example.com -site:other.com'); await restored.click('prepare-queries');
  assert.equal(restored.get('prepared-queries').children.length, 1); assert.equal(restored.get('open-all-queries').disabled, true); assert.match(restored.get('search-filter-status').textContent, /Invalid excluded website/);
});

test('filter edits regenerate in place after typing, preserve page and scroll, and prevent stale or invalid searches', async () => {
  const queries = Array.from({ length: 205 }, (_, i) => `query${i}`);
  const app = fixture({ draft: { tuples: queries.join('\n') } });
  await app.click('prepare-queries'); app.click('next-queries');
  app.get('prepared-queries').scrollTop = 127;
  app.get('search-filetype').value = 'pdf'; app.get('search-filetype').handlers.change();
  assert.equal(app.get('prepared-queries').start, 101);
  assert.equal(app.get('prepared-queries').scrollTop, 127);
  assert.equal(app.get('prepared-queries').children[0].children[2].textContent, 'query100 filetype:pdf');
  app.input('excluded-sites', 'example.org');
  assert.equal(app.get('open-all-queries').disabled, true);
  assert.equal(app.get('prepared-queries').children[0].children[2].href, undefined);
  await app.click('open-all-queries'); assert.equal(app.opened.length, 0);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(app.get('prepared-queries').children[0].children[2].textContent, 'query100 filetype:pdf -site:example.org');
  assert.equal(app.get('prepared-queries').scrollTop, 127); assert.equal(app.get('prepared-queries').start, 101);
  assert.equal(app.draft.preparedQueryBases[100], 'query100'); assert.equal(app.opened.length, 0);
  app.input('excluded-sites', 'example.org -site:other.org');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(app.get('open-all-queries').disabled, true); assert.equal(app.get('excluded-sites').attributes['aria-invalid'], 'true');
  app.input('excluded-sites', ''); await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(app.get('open-all-queries').disabled, false);
  assert.equal(app.get('prepared-queries').children[0].children[2].textContent, 'query100 filetype:pdf');
  app.ui.destroy();
});

test('query badges track active tabs and closed outcomes without rebuilding links or moving scroll', async () => {
  let focused;
  const app = fixture({ draft: { preparedQueries: ['first', 'second'] }, saveDefaults: async message => { focused = message; return { ok: true }; } });
  const row = app.get('prepared-queries').children[0], badge = row.children[0], inspect = row.children[1], link = row.children[2];
  assert.equal(inspect.attributes['aria-label'], 'Open search tab');
  assert.match(badge.textContent, /Not opened/); assert.equal(inspect.hidden, true);
  app.get('prepared-queries').scrollTop = 70;
  app.ui.updateTabState({ tabs: [{ engine: 'google', query: 'first', tabId: 22, status: 'loading' }], history: [] });
  assert.match(badge.textContent, /Loading/); assert.equal(inspect.hidden, false);
  app.ui.updateTabState({ tabs: [{ engine: 'google', query: 'first', tabId: 22, status: 'attention', reason: 'CAPTCHA required' }], history: [] });
  assert.match(badge.textContent, /Needs attention/); assert.match(badge.title, /CAPTCHA/);
  await inspect.handlers.click(); assert.equal(focused.type, 'focus-project-search-tab'); assert.equal(focused.tabId, 22);
  app.ui.updateTabState({ tabs: [{ engine: 'google', query: 'first', tabId: 22, status: 'collected', reason: 'Results saved. This tab remains open.' }], history: [] });
  assert.match(badge.textContent, /Collected/); assert.equal(inspect.hidden, false);
  assert.match(badge.title, /remains open/);
  app.ui.updateTabState({ tabs: [], history: [{ engine: 'google', query: 'first', status: 'closed' }, { engine: 'google', query: 'second', status: 'collected' }] });
  assert.match(badge.textContent, /Closed without collecting/); assert.equal(inspect.hidden, true);
  assert.match(app.get('prepared-queries').children[1].children[0].textContent, /Collected/);
  assert.equal(app.get('prepared-queries').children[0].children[2], link); assert.equal(app.get('prepared-queries').scrollTop, 70);
});

test('batch opening holds collection readiness until opening finishes or stops', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }), opening = [];
  const app = fixture({ draft: { preparedQueries: ['first', 'second'] }, open: async () => waiting, onOpeningChange: value => opening.push(value) });
  const pending = app.click('open-all-queries'); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(opening, [true]);
  app.click('stop-query-tabs'); release(); await pending;
  assert.deepEqual(opening, [true, false]); assert.equal(app.opened.length, 1);
});

test('site edits update queries, validate the correct field, restore saved inputs and never replace tuples or exclusions', async () => {
  const app = fixture({ draft: { tuples: 'energy storage', searchFileType: 'pdf', excludedSites: 'facebook.com' } });
  assert.equal(app.get('search-site').value, '', 'old drafts start unrestricted');
  await app.click('prepare-queries');
  app.input('search-site', 'https://www.UNIBO.it/research');
  assert.equal(app.get('open-all-queries').disabled, true);
  assert.equal(app.get('prepared-queries').children[0].children[2].href, undefined);
  await new Promise(resolve => setTimeout(resolve, 450));
  const query = 'energy storage filetype:pdf site:unibo.it -site:facebook.com';
  assert.equal(app.get('prepared-queries').children[0].children[2].textContent, query);
  assert.equal(app.get('tuples').value, 'energy storage'); assert.equal(app.get('excluded-sites').value, 'facebook.com');
  assert.equal(app.draft.searchSite, 'https://www.UNIBO.it/research'); assert.equal(app.opened.length, 0);
  const restored = fixture({ draft: app.draft });
  assert.equal(restored.get('search-site').value, 'https://www.UNIBO.it/research');
  assert.equal(restored.get('prepared-queries').children[0].children[2].textContent, query);
  restored.get('engine').value = 'ecosia'; restored.get('engine').handlers.change();
  assert.equal(new URL(restored.get('prepared-queries').children[0].children[2].href).searchParams.get('q'), query);
  await restored.click('open-all-queries'); assert.equal(new URL(restored.opened[0].url).searchParams.get('q'), query);
  restored.input('search-site', 'facebook.com'); await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(restored.get('search-site').attributes['aria-invalid'], 'true');
  assert.equal(restored.get('excluded-sites').attributes['aria-invalid'], 'false');
  assert.match(restored.get('search-filter-status').textContent, /search site is excluded/);
  assert.equal(restored.get('open-all-queries').disabled, true);
  restored.input('search-site', 'example.org OR site:other.org');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.match(restored.get('search-filter-status').textContent, /Invalid search website/);
  restored.input('search-site', ''); await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(restored.get('open-all-queries').disabled, false);
  assert.equal(restored.get('prepared-queries').children[0].children[2].textContent, query.replace(' site:unibo.it', ''));
  app.ui.destroy(); restored.ui.destroy();
});


test('batch controls disable immediately, skip open/collected queries, and enable only missing uncollected tabs', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const app = fixture({ draft: { preparedQueries: ['first', 'second', 'third'] }, open: async () => pending });
  assert.equal(app.get('open-all-queries').textContent, 'Run all queries');
  const opening = app.click('open-all-queries');
  assert.equal(app.get('open-all-queries').disabled, true);
  await app.click('open-all-queries');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.get('open-all-queries').textContent, 'Opening queries…');
  release(); await opening; assert.equal(app.opened.length, 3);
  assert.equal(app.get('open-all-queries').textContent, 'No queries to open');
  assert.equal(app.get('open-all-queries').disabled, true);
  await app.click('open-all-queries'); assert.equal(app.opened.length, 3);
  app.setState({ tabs: [{ engine: 'google', query: 'first', tabId: 1, status: 'attention' }], history: [{ engine: 'google', query: 'second', status: 'collected' }, { engine: 'google', query: 'third', status: 'closed' }] });
  assert.equal(app.get('open-all-queries').textContent, 'Run missing queries (1)');
  assert.equal(app.get('open-all-queries').disabled, false);
  await app.click('open-all-queries');
  assert.equal(new URL(app.opened.at(-1).url).searchParams.get('q'), 'third');
  assert.equal(app.opened.length, 4); assert.equal(app.get('open-all-queries').disabled, true);
});

test('restored workspaces wait for authoritative state and ignore an older opening reply after a closure', () => {
  const app = fixture({ unready: true, draft: { preparedQueries: ['first'] } });
  assert.equal(app.get('open-all-queries').disabled, true);
  assert.equal(app.get('open-all-queries').textContent, 'Checking query tabs…');
  app.setState({ revision: 3, tabs: [], history: [{ engine: 'google', query: 'first', status: 'closed' }] });
  assert.equal(app.get('open-all-queries').textContent, 'Run missing queries (1)');
  app.setState({ revision: 2, tabs: [{ engine: 'google', query: 'first', tabId: 1, status: 'loaded' }], history: [] });
  assert.equal(app.get('open-all-queries').disabled, false);
  app.setState({ revision: 4, tabs: [], history: [{ engine: 'google', query: 'first', status: 'collected' }] });
  assert.equal(app.get('open-all-queries').disabled, true);
  assert.match(app.get('query-run-hint').textContent, /All search results have been collected/);
});

test('a tab opened in another window during confirmation is skipped by the background request', async () => {
  let app;
  app = fixture({ draft: { preparedQueries: ['first'] }, confirm: () => {
    app.setState({ tabs: [{ engine: 'google', query: 'first', tabId: 1, status: 'loading' }], history: [] }); return true;
  } });
  await app.click('open-all-queries'); assert.equal(app.opened.length, 0); assert.equal(app.confirmations.length, 1);
  assert.equal(app.get('open-all-queries').disabled, true); assert.match(app.get('query-status').textContent, /1 already open or collected/);
});


test('failed tab-state checks never open a batch and a later authoritative refresh permits retry', async () => {
  let fail = true;
  const app = fixture({ draft: { preparedQueries: ['first'] }, stateReply: async state => fail ? { ok: false, error: 'Tab state unavailable' } : state });
  await app.click('open-all-queries');
  assert.equal(app.opened.length, 0); assert.equal(app.get('open-all-queries').disabled, true);
  assert.match(app.get('query-status').textContent, /Tab state unavailable/);
  fail = false; app.setState({ tabs: [], history: [] });
  await app.click('open-all-queries'); assert.equal(app.opened.length, 1);
});

 test('minimum seeds can change live without affecting manual tuples or the project draft', async () => {
  const app = fixture({ draft: { seeds: 'a\nb', tupleLength: '2', tuples: 'manual query' } });
  assert.equal(app.get('generate-tuples').disabled, true);
  app.ui.setMinimumSeeds(2);
  assert.equal(app.get('generate-tuples').disabled, false);
  await app.click('generate-tuples');
  assert.equal(app.get('tuples').value, 'a b');
  app.ui.setMinimumSeeds(8);
  assert.equal(app.get('generate-tuples').disabled, true);
  assert.match(app.get('seed-status').textContent, /At least 8/);
  assert.equal(app.get('prepare-queries').disabled, false);
  assert.equal(app.draft.seeds, 'a\nb');
  app.ui.setMinimumSeeds(1); app.input('tuple-length', '3');
  assert.equal(app.get('generate-tuples').disabled, true);
 });

test('project language updates Google links and completion badges while leaving visible tuples unchanged', async () => {
  let language = 'ita';
  const app = fixture({ getLanguage: () => language, draft: { tuples: 'energy', preparedQueries: ['energy'] }, tabState: { tabs: [], history: [{ engine: 'google', query: 'energy', languageFilter: 'lang_it', status: 'collected' }] } });
  const url = () => new URL(app.get('prepared-queries').children[0].children[2].href);
  assert.equal(url().searchParams.get('lr'), 'lang_it'); assert.equal(app.get('open-all-queries').disabled, true);
  language = 'fra'; app.ui.refreshLanguage();
  assert.equal(url().searchParams.get('lr'), 'lang_fr'); assert.equal(app.get('open-all-queries').disabled, false);
  await app.click('open-all-queries'); assert.equal(new URL(app.opened[0].url).searchParams.get('lr'), 'lang_fr');
  language = 'none'; app.ui.refreshLanguage(); assert.equal(url().searchParams.has('lr'), false);
  app.get('engine').value = 'duckduckgo'; language = 'ita'; app.get('engine').handlers.change();
  assert.equal(url().searchParams.has('lr'), false); assert.equal(url().searchParams.has('kl'), false);
  assert.equal(app.get('tuples').value, 'energy');
});

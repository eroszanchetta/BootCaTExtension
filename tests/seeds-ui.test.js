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
  let confirmed = true;
  const get = id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
  get('engine').value = 'google';
  const context = vm.createContext({
    setTimeout, clearTimeout, openWorkspaceSection() {}, combinationCount, SEARCH_FILE_TYPES, DEFAULT_EXCLUDED_SITES, normalizeSearchFilters,
    document: { getElementById: get, createElement: () => new Element() },
    window: { confirm(message) { confirmations.push(message); return confirmed; } },
    getExtensionAPI: () => ({ runtime: { sendMessage: async message => options.saveDefaults ? options.saveDefaults(message) : { ok: true } }, tabs: { create: async value => { if (options.open) await options.open(value, opened.length); opened.push(value); } } }),
    getProjectId: () => 'project',
    openProjectSearch: async ({ projectId, engine, query, active }) => {
      assert.equal(projectId, 'project'); const value = { url: searchURL(engine, query), active };
      if (options.open) await options.open(value, opened.length); opened.push(value);
      return { tabId: opened.length };
    },
    ENGINES, searchURL, buildSearchQuery, parseSeeds, parseQueries, AbortController, BigInt,
    generateTuples: (text, length, count, config) => generateTuples(text, length, count, { ...config, random: () => 0n }),
    onOpeningChange: options.onOpeningChange || (() => {}), draft, onChange: patch => Object.assign(draft, patch)
  });
  vm.runInContext(source + '\nglobalThis.seeds = initSeedsUI({draft, onChange, getProjectId, onOpeningChange});', context);
  return { get, draft, opened, confirmations, setConfirmed: value => { confirmed = value; }, ui: vm.runInContext('seeds', context),
    input(id, value) { get(id).value = value; get(id).handlers.input(); }, click: id => get(id).handlers.click() };
}
test('generate, edit and prepare tuples without opening tabs; engine changes update all query links', async () => {
  const app = fixture(); assert.equal(app.get('tuple-length').value, '3');
  app.input('seeds', 'solar power\nenergy\nstorage\ncapacity\ngeneration'); await app.click('generate-tuples');
  assert.equal(app.get('tuples').value.split('\n').length, 10);
  assert.ok(app.get('tuples').value.includes('"solar power"'));
  app.input('tuples', '"custom phrase" energy\nstorage capacity\nstorage capacity'); await app.click('prepare-queries');
  assert.equal(app.get('prepared-queries').children.length, 2); assert.equal(app.opened.length, 0);
  const link = app.get('prepared-queries').children[0].children[0];
  assert.equal(new URL(link.href).searchParams.get('q'), '"custom phrase" energy'); assert.equal(link.target, '_blank');
  app.get('engine').value = 'duckduckgo'; app.get('engine').handlers.change();
  assert.equal(new URL(app.get('prepared-queries').children[0].children[0].href).hostname, 'duckduckgo.com');
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
  const link = app.get('prepared-queries').children[0].children[0];
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
  assert.equal(app.get('prepared-queries').children[0].children[0].textContent, 'my edited query');
  assert.match(app.get('tuple-status').textContent, /Generation stopped/); assert.equal(app.ui.isBusy(), false);
});
test('batch opening can stop or report partial failures while individual query links remain', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const app = fixture({ draft: { preparedQueries: ['first', 'second', 'third'] }, open: async () => gate });
  const opening = app.click('open-all-queries'); assert.equal(app.ui.isBusy(), true);
  app.click('stop-query-tabs'); release(); await opening;
  assert.equal(app.opened.length, 1); assert.match(app.get('query-status').textContent, /Stopped.*1 of 3/);
  const failing = fixture({ draft: { preparedQueries: ['first', 'second', 'third'] }, open: async (_, index) => { if (index === 1) throw new Error('Tab refused'); } });
  await failing.click('open-all-queries'); assert.equal(failing.opened.length, 1);
  assert.match(failing.get('query-status').textContent, /1 of 3.*Tab refused/); assert.equal(failing.get('prepared-queries').children.length, 3);
});
test('query pagination retains all links, and destroyed projects stop pending batch work', async () => {
  const queries = Array.from({ length: 205 }, (_, i) => `query${i}`), app = fixture({ draft: { preparedQueries: queries } });
  assert.equal(app.get('prepared-queries').children.length, 100); app.click('next-queries'); app.click('next-queries');
  assert.equal(app.get('prepared-queries').children.length, 5); assert.equal(app.get('prepared-queries').start, 201);
  assert.equal(app.get('prepared-queries').children[4].children[0].textContent, 'query204');
  let release; const gate = new Promise(resolve => { release = resolve; });
  const pending = fixture({ draft: { preparedQueries: ['one', 'two'] }, open: async () => gate });
  const opening = pending.click('open-all-queries'); pending.ui.destroy(); release(); await opening;
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
  assert.equal(app.get('prepared-queries').children[0].children[0].textContent, 'manual query');
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
  assert.equal(app.get('prepared-queries').children[0].children[0].textContent, query);
  assert.equal(app.get('tuples').value, 'solar energy'); assert.equal(app.draft.preparedQueries[0], query);
  app.get('engine').value = 'ecosia'; app.get('engine').handlers.change();
  assert.equal(new URL(app.get('prepared-queries').children[0].children[0].href).searchParams.get('q'), query);
  await app.click('open-all-queries'); assert.equal(new URL(app.opened[0].url).searchParams.get('q'), query);
  await app.click('save-site-defaults'); assert.deepEqual(JSON.parse(JSON.stringify(savedDefault.patch)), { excludedSites: ['youtube.com', 'facebook.com'] });
  const restored = fixture({ draft: app.draft }); assert.equal(restored.get('prepared-queries').children[0].children[0].textContent, query);
  restored.get('search-filetype').value = 'docx'; restored.get('search-filetype').handlers.change();
  assert.equal(restored.get('prepared-queries').children.length, 1); assert.equal(restored.get('open-all-queries').disabled, false);
  await restored.click('prepare-queries'); assert.equal(restored.get('prepared-queries').children[0].children[0].textContent, query.replace('filetype:pdf', 'filetype:docx'));
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
  assert.equal(app.get('prepared-queries').children[0].children[0].textContent, 'query100 filetype:pdf');
  app.input('excluded-sites', 'example.org');
  assert.equal(app.get('open-all-queries').disabled, true);
  assert.equal(app.get('prepared-queries').children[0].children[0].href, undefined);
  await app.click('open-all-queries'); assert.equal(app.opened.length, 0);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(app.get('prepared-queries').children[0].children[0].textContent, 'query100 filetype:pdf -site:example.org');
  assert.equal(app.get('prepared-queries').scrollTop, 127); assert.equal(app.get('prepared-queries').start, 101);
  assert.equal(app.draft.preparedQueryBases[100], 'query100'); assert.equal(app.opened.length, 0);
  app.input('excluded-sites', 'example.org -site:other.org');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(app.get('open-all-queries').disabled, true); assert.equal(app.get('excluded-sites').attributes['aria-invalid'], 'true');
  app.input('excluded-sites', ''); await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(app.get('open-all-queries').disabled, false);
  assert.equal(app.get('prepared-queries').children[0].children[0].textContent, 'query100 filetype:pdf');
  app.ui.destroy();
});

test('query badges track active tabs and closed outcomes without rebuilding links or moving scroll', async () => {
  let focused;
  const app = fixture({ draft: { preparedQueries: ['first', 'second'] }, saveDefaults: async message => { focused = message; return { ok: true }; } });
  const row = app.get('prepared-queries').children[0], link = row.children[0], badge = row.children[1], inspect = row.children[2];
  assert.match(badge.textContent, /Not opened/); assert.equal(inspect.hidden, true);
  app.get('prepared-queries').scrollTop = 70;
  app.ui.updateTabState({ tabs: [{ engine: 'google', query: 'first', tabId: 22, status: 'loading' }], history: [] });
  assert.match(badge.textContent, /Loading/); assert.equal(inspect.hidden, false);
  app.ui.updateTabState({ tabs: [{ engine: 'google', query: 'first', tabId: 22, status: 'attention', reason: 'CAPTCHA required' }], history: [] });
  assert.match(badge.textContent, /Needs attention/); assert.match(badge.title, /CAPTCHA/);
  await inspect.handlers.click(); assert.equal(focused.type, 'focus-project-search-tab'); assert.equal(focused.tabId, 22);
  app.ui.updateTabState({ tabs: [], history: [{ engine: 'google', query: 'first', status: 'closed' }, { engine: 'google', query: 'second', status: 'collected' }] });
  assert.match(badge.textContent, /Closed without collecting/); assert.equal(inspect.hidden, true);
  assert.match(app.get('prepared-queries').children[1].children[1].textContent, /Collected/);
  assert.equal(app.get('prepared-queries').children[0].children[0], link); assert.equal(app.get('prepared-queries').scrollTop, 70);
});

test('batch opening holds collection readiness until opening finishes or stops', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }), opening = [];
  const app = fixture({ draft: { preparedQueries: ['first', 'second'] }, open: async () => waiting, onOpeningChange: value => opening.push(value) });
  const pending = app.click('open-all-queries'); assert.deepEqual(opening, [true]);
  app.click('stop-query-tabs'); release(); await pending;
  assert.deepEqual(opening, [true, false]); assert.equal(app.opened.length, 1);
});

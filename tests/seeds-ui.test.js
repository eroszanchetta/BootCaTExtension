import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { ENGINES, searchURL } from '../src/engines.js';
import { parseSeeds, parseQueries, generateTuples } from '../src/tuples.js';
import * as storage from '../src/project-store.js';

const source = (await readFile(new URL('../src/seeds-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
class Element {
  constructor() { this.value = ''; this.textContent = ''; this.handlers = {}; this.children = []; this.disabled = false; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
}
function fixture(options = {}) {
  const elements = new Map(), draft = { ...options.draft }, opened = [], confirmations = [];
  let confirmed = true;
  const get = id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
  get('engine').value = 'google';
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => new Element() },
    window: { confirm(message) { confirmations.push(message); return confirmed; } },
    getExtensionAPI: () => ({ tabs: { create: async value => { if (options.open) await options.open(value, opened.length); opened.push(value); } } }),
    ENGINES, searchURL, parseSeeds, parseQueries, AbortController, BigInt,
    generateTuples: (text, length, count, config) => generateTuples(text, length, count, { ...config, random: () => 0n }),
    draft, onChange: patch => Object.assign(draft, patch)
  });
  vm.runInContext(source + '\nglobalThis.seeds = initSeedsUI({draft, onChange});', context);
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

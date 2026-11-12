import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parseURLs } from '../src/core.js';
import { uniqueResults } from '../src/collection.js';
import { projectFilename } from '../src/project-ui.js';

class Element {
  constructor() { this.value = ''; this.textContent = ''; this.handlers = {}; this.children = []; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  addEventListener(type, fn) { this.handlers[type] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
}
const fixture = () => {
  const elements = new Map();
  return id => elements.get(id) || (elements.set(id, new Element()), elements.get(id));
};

test('collected URLs append automatically, defer during downloads and preserve manual edits', async () => {
  const get = fixture();
  let notify, running = false;
  get('urls').value = 'https://manual.test/\ninvalid manual line';
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => new Element() },
    getExtensionAPI: () => ({ storage: { local: { get: async () => ({ collections: [] }) }, onChanged: { addListener(fn) { notify = fn; } } } }),
    ENGINES: [], uniqueResults, parseURLs, isRunning: () => running
  });
  const source = (await readFile(new URL('../src/search-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source + '\nglobalThis.search = initSearchUI({ isRunning });', context);
  await new Promise(resolve => setImmediate(resolve));
  const collection = { id: 'one', results: [{ url: 'https://collected.test/' }, { url: 'https://manual.test/' }], unresolved: 0 };
  notify({ collections: { newValue: [collection] } }, 'local');
  assert.equal(get('urls').value, 'https://manual.test/\ninvalid manual line\nhttps://collected.test/');
  get('urls').value = 'https://manual.test/';
  notify({ collections: { newValue: [collection] } }, 'local');
  assert.equal(get('urls').value, 'https://manual.test/', 'unchanged collections must not restore manually removed URLs');
  running = true;
  notify({ collections: { newValue: [collection, { ...collection, id: 'two', results: [{ url: 'https://later.test/' }] }] } }, 'local');
  assert.equal(get('urls').value, 'https://manual.test/');
  running = false; vm.runInContext('search.flush()', context);
  assert.equal(get('urls').value, 'https://manual.test/\nhttps://later.test/');
});

test('project dialog cancels without clearing, requires a name, and submits named reset with project identity', async () => {
  const get = fixture();
  let notify, confirm = false, resets = 0, renamed = 0;
  const requests = [];
  const project = { id: 'one', name: 'Initial project' };
  const context = vm.createContext({
    document: { getElementById: get }, window: { confirm: () => confirm },
    onReset: () => { resets++; }, onRename: () => { renamed++; },
    getExtensionAPI: () => ({
      storage: { onChanged: { addListener(fn) { notify = fn; } } },
      runtime: { sendMessage: async message => { requests.push(message); return { ok: true, project }; } }
    })
  });
  const source = (await readFile(new URL('../src/project-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source + '\nglobalThis.ui = initProjectUI({ onReset, onRename });', context);
  await vm.runInContext('ui.ready', context);
  assert.equal(get('project-name').value, 'Initial project');
  get('project-name').value = 'Energy corpus'; await get('project-name').handlers.input();
  assert.equal(requests.at(-1).type, 'rename-project'); assert.equal(requests.at(-1).name, 'Energy corpus');
  assert.equal(vm.runInContext('ui.snapshot().name', context), 'Energy corpus');
  await get('new-project').handlers.click();
  assert.equal(get('project-dialog').open, true); assert.equal(get('project-dialog-warning').hidden, false);
  assert.equal(requests.filter(item => item.type === 'new-project').length, 0);
  get('project-dialog-cancel').handlers.click(); assert.equal(get('project-dialog').open, false);
  await get('new-project').handlers.click();
  get('project-dialog-name').value = '   '; await get('project-form').handlers.submit({ preventDefault() {} });
  assert.match(get('project-dialog-error').textContent, /Enter a project name/);
  assert.equal(requests.filter(item => item.type === 'new-project').length, 0);
  get('project-dialog-name').value = '  Fresh corpus  '; await get('project-form').handlers.submit({ preventDefault() {} });
  assert.equal(requests.at(-1).type, 'new-project'); assert.equal(requests.at(-1).name, 'Fresh corpus'); assert.equal(requests.at(-1).projectId, 'one');
  notify({ project: { newValue: { id: 'two', name: 'Untitled project' } } }, 'local');
  assert.equal(resets, 1); assert.ok(renamed >= 2);
});

test('project names produce safe archive filenames while retaining Unicode', () => {
  assert.equal(projectFilename('Corpus: energia/中文?'), 'Corpus- energia-中文-');
  assert.equal(projectFilename('... '), 'bootcat-corpus');
  assert.ok(projectFilename('x'.repeat(200)).length <= 80);
});

test('first-use dialog names the existing project without clearing it; confirmed names do not prompt', async () => {
  const source = (await readFile(new URL('../src/project-ui.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  for (const confirmed of [false, true]) {
    const get = fixture(), requests = [];
    const context = vm.createContext({ document: { getElementById: get }, getExtensionAPI: () => ({
      storage: { onChanged: { addListener() {} } }, runtime: { sendMessage: async request => {
        requests.push(request); return { ok: true, project: { id: 'one', name: request.name || 'Untitled project', nameConfirmed: request.type === 'rename-project' || confirmed } };
      } }
    }) });
    vm.runInContext(source + '\nglobalThis.ui = initProjectUI({onReset() { throw new Error("must not reset"); }, onRename() {}});', context);
    await vm.runInContext('ui.ready', context);
    assert.equal(Boolean(get('project-dialog').open), !confirmed);
    if (!confirmed) {
      get('project-dialog-name').value = 'My first corpus'; await get('project-form').handlers.submit({ preventDefault() {} });
      assert.equal(requests.at(-1).type, 'rename-project'); assert.equal(get('project-dialog').open, false);
    }
  }
});

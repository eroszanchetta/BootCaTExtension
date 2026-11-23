import { collectionFailure, collectionLinkWarning, GOOGLE_LINK_MESSAGE } from '../src/search-feedback.js';
import { IDBFactory } from 'fake-indexeddb';
import { loadWorkspace } from '../src/project-store.js';
import { savePage, readSavedPages } from '../src/page-store.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ENGINES, adapterForURL, searchURL, extractResults } from '../src/engines.js';
import { addCollection, uniqueResults } from '../src/collection.js';

// Synthetic DOM API fixtures test URL handling and isolated-world execution.
// They do NOT validate selectors against current live engine layouts.
function extract(engine, href, links, page = {}) {
  const anchors = links.map(link => ({
    getClientRects: () => link.hidden ? [] : [{}],
    closest: () => link.ad ? {} : null,
    getAttribute: () => link.href,
    querySelector: () => ({ textContent: link.title || 'Title' }),
    textContent: link.title || 'Title'
  }));
  const context = vm.createContext({ URL, location: { href }, document: { title: page.title || '', querySelector: selector => (selector.startsWith('#challenge-form') ? page.challengeForm : page.challengeResource) ? {} : null, querySelectorAll: () => anchors } });
  // No module closure is available, just as with scripting.executeScript.
  return JSON.parse(JSON.stringify(vm.runInContext(`(${extractResults.toString()})(${JSON.stringify(ENGINES.find(e => e.id === engine))})`, context)));
}

test('engine detection rejects lookalikes/non-search pages and supports web variants', () => {
  assert.equal(adapterForURL('https://www.google.it/search?q=energia').id, 'google');
  assert.equal(adapterForURL('https://www.google.co.uk/search?q=energy&udm=14').id, 'google');
  assert.equal(adapterForURL('https://duckduckgo.com/?q=energy&ia=web').id, 'duckduckgo');
  assert.equal(adapterForURL('https://www.ecosia.org/search?q=energy').id, 'ecosia');
  for (const url of ['https://www.google.com.evil.org/search?q=x', 'https://www.google.com/search?q=x&udm=2', 'https://duckduckgo.com/?q=x&ia=images', 'https://www.google.com/', 'chrome://extensions']) assert.equal(adapterForURL(url), null);
  assert.equal(new URL(searchURL('google', 'caffè & tè')).searchParams.get('q'), 'caffè & tè');
});

test('Google extracts direct/explicit redirect URLs, rejects opaque/unsafe links, ads and duplicates', () => {
  const result = extract('google', 'https://www.google.com/search?q=energy&start=10', [
    { href: 'https://example.org/a#one', title: 'First result' },
    { href: 'https://example.org/a#two' },
    { href: '/url?q=https%3A%2F%2Fexample.net%2Fb%3Fx%3D1' },
    { href: '/url?url=https%3A%2F%2Fexample.edu%2Fc' },
    { href: '/url?opaque=abcdef' },
    { href: 'javascript:alert(1)' },
    { href: 'https://user:secret@example.org/private' },
    { href: 'https://example.org/ad', ad: true },
    { href: 'https://example.org/hidden', hidden: true }
  ]);
  assert.deepEqual(result.results.map(r => r.url), ['https://example.org/a', 'https://example.net/b?x=1', 'https://example.edu/c']);
  assert.equal(result.results[0].title, 'First result');
  assert.equal(result.results[1].positionOnPage, 3);
  assert.equal(result.unresolved, 3);
  assert.equal(result.query, 'energy');
});

test('DuckDuckGo and Ecosia adapters produce the same result schema', () => {
  const ddg = extract('duckduckgo', 'https://duckduckgo.com/?q=energy', [{ href: '/l/?uddg=https%3A%2F%2Fexample.org%2Fpaper' }]);
  const eco = extract('ecosia', 'https://www.ecosia.org/search?q=energy', [{ href: 'https://example.org/paper' }]);
  assert.deepEqual(ddg.results, eco.results);
  assert.equal(extract('google', 'https://example.com/', []).error.includes('tab changed'), true);
});

test('collections preserve cross-provider provenance, replace repeated pages, enforce limits', () => {
  const google = { id: 'g', engine: 'google', pageURL: 'https://google.com/search?q=x', query: 'x', results: [{ url: 'https://example.org/', title: 'Example', positionOnPage: 1 }] };
  const ddg = { ...google, id: 'd', engine: 'duckduckgo', pageURL: 'https://duckduckgo.com/?q=x' };
  const all = addCollection(addCollection([], google), ddg);
  assert.equal(uniqueResults(all).length, 1);
  assert.deepEqual(uniqueResults(all)[0].sources.map(s => s.engine), ['google', 'duckduckgo']);
  assert.equal(addCollection(all, { ...google, id: 'new' }).length, 2);
  assert.throws(() => addCollection(Array.from({ length: 100 }, (_, i) => ({ ...google, pageURL: `https://google.com/search?q=${i}` })), ddg), /limit reached/);
});

for (const namespace of ['chrome', 'browser']) test(`${namespace}: background serializes simultaneous collections and reports errors`, async () => {
  const origin = namespace === 'browser' ? 'moz-extension://test/' : 'chrome-extension://test/';
  let listener;
  let collections = [];
  const stored = {};
  const session = {};
  let releaseInjection, injectionStarted;
  const started = new Promise(resolve => { injectionStarted = resolve; });
  const gate = new Promise(resolve => { releaseInjection = resolve; });
  globalThis.indexedDB = new IDBFactory();
  let workspaceExists = true, opened = 0, focused = 0;
  globalThis[namespace] = {
    runtime: { id: 'test', getURL: path => `${origin}${path}`, onMessage: { addListener: fn => { listener = fn; } } },
    tabs: {
      get: async id => id === 10 ? ({ id, windowId: 5 }) : ({ id, url: `https://www.google.com/search?q=${id}` }),
      query: async options => { assert.deepEqual(options, {}); return workspaceExists ? [{ id: 10, windowId: 5, url: origin + 'downloader.html' }, { id: 11, url: 'https://example.org/' }] : []; },
      update: async (id, options) => { assert.equal(id, 10); assert.equal(options.active, true); focused++; },
      create: async options => { assert.equal(options.url, origin + 'downloader.html'); opened++; }
    },
    windows: { update: async (id, options) => { assert.equal(id, 5); assert.equal(options.focused, true); } },
    scripting: { executeScript: async ({ target }) => { if (target.tabId === 4) { injectionStarted(); await gate; } return [{ result: { engine: 'google', query: String(target.tabId), pageURL: `https://www.google.com/search?q=${target.tabId}`, unresolved: 0, results: target.tabId === 3 ? [] : [{ url: `https://example.org/${target.tabId}`, title: 'Example', positionOnPage: 1 }] } }]; } },
    storage: { session: { get: async key => ({ [key]: session[key] }), set: async data => { Object.assign(session, data); } }, local: {
      get: async key => { await new Promise(r => setTimeout(r, 10)); return key === null ? { ...stored, collections } : key === "collections" ? { collections } : { [key]: stored[key] }; },
      set: async data => { await new Promise(r => setTimeout(r, 10)); Object.assign(stored, data); if (data.collections) collections = data.collections; },
      remove: async keys => { for (const key of keys) { delete stored[key]; if (key === 'collections') collections = []; } },
      clear: async () => { for (const key of Object.keys(stored)) delete stored[key]; collections = []; }
    } }
  };
  await import(`../src/background.js?namespace=${namespace}`);
  const request = message => new Promise(resolve => {
    assert.equal(listener(message, { id: 'test', url: origin + 'popup.html' }, resolve), true);
  });
  try {
    const initial = await request({ type: 'new-project', projectId: null, name: 'Initial corpus', language: 'none' });
    const replies = await Promise.all([request({ type: 'collect', tabId: 1 }), request({ type: 'collect', tabId: 2 })]);
    assert.equal(replies.every(r => r.ok), true);
    assert.equal(collections.length, 2);
    assert.ok(replies.every(reply => reply.added === 1 && reply.duplicates === 0));
    const repeated = await request({ type: 'collect', tabId: 1 });
    assert.equal(repeated.added, 0); assert.equal(repeated.duplicates, 1);
    const wrongAction = await request({ type: 'save-page', tabId: 1 });
    assert.equal(wrongAction.ok, false);
    assert.match(wrongAction.error, /Use Add URLs from this tab to corpus/);
    const failed = await request({ type: 'collect', tabId: 3 });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /No search results could be collected/);
    assert.equal(collections.length, 2);
    await request({ type: 'clear-collections', projectId: initial.project.id });
    assert.equal(collections.length, 0);
    assert.equal((await request({ type: 'open-workspace' })).ok, true);
    assert.equal(focused, 1); assert.equal(opened, 0);
    globalThis[namespace].runtime.getContexts = async options => {
      assert.deepEqual(options, { contextTypes: ['TAB'] });
      return [{ documentUrl: origin + 'downloader.html#preview-section', tabId: 10 }];
    };
    assert.equal((await request({ type: 'open-workspace' })).ok, true);
    assert.equal(focused, 2); assert.equal(opened, 0, 'own-page contexts avoid duplicate workspace tabs when tab URLs are hidden');
    delete globalThis[namespace].runtime.getContexts;

    workspaceExists = false;
    assert.equal((await request({ type: 'open-workspace' })).ok, true);
    assert.equal(opened, 1);
    assert.equal(listener({ type: 'collect', tabId: 1 }, { id: 'test', url: 'https://example.org/' }, () => assert.fail('Unexpected reply')), undefined);
    const project = (await request({ type: 'get-project' })).project;
    assert.equal((await request({ type: 'rename-project', projectId: project.id, name: 'Energy corpus' })).ok, true);
    assert.equal(stored.project.name, 'Energy corpus');
    stored.unrelatedOldState = 'must clear';
    await savePage({ url: 'https://pending.test/', id: 'pending', html: '<p>Saved page</p>' });
    const oldCollection = request({ type: 'collect', tabId: 4 });
    await started;
    const reset = await request({ type: 'new-project', projectId: project.id, name: 'New corpus', language: 'none' });
    assert.equal(reset.ok, true); assert.notEqual(reset.project.id, project.id);
    assert.equal(reset.project.name, 'New corpus');
    assert.equal((await readSavedPages()).length, 0);
    assert.equal((await loadWorkspace(reset.project.id)).entries.length, 0); assert.equal(stored.unrelatedOldState, undefined);
    assert.equal(collections.length, 0);
    releaseInjection();
    const stale = await oldCollection;
    assert.equal(stale.ok, false); assert.match(stale.error, /project changed/);
    assert.equal(collections.length, 0, 'old collection must not reappear after reset');
    assert.equal((await request({ type: 'rename-project', projectId: project.id, name: 'Old name' })).ok, false);
    // Simulate a crash after database reset but before storage.local notification.
    stored.project = project; collections = [{ id: 'old-collection', results: [] }];
    const recovered = await request({ type: 'get-project' });
    assert.equal(recovered.project.id, reset.project.id);
    assert.equal(collections.length, 0, 'old search metadata must not survive a recovered reset');


  } finally { delete globalThis[namespace]; delete globalThis.indexedDB; }
});

test('opaque Google destinations use friendly guidance and preserve readable partial results', () => {
  const result = extract('google', 'https://www.google.com/search?q=energy', [{ href: '/url?opaque=secret' }, { href: '/url?another=secret' }]);
  assert.equal(result.unreadableGoogle, 2); assert.equal(result.results.length, 0);
  assert.equal(collectionFailure(result), GOOGLE_LINK_MESSAGE);
  assert.ok(!GOOGLE_LINK_MESSAGE.includes('DuckDuckGo')); assert.ok(!GOOGLE_LINK_MESSAGE.includes('Ecosia'));
  const partial = extract('google', 'https://www.google.com/search?q=energy', [{ href: '/url?opaque=secret' }, { href: 'https://example.org/readable' }]);
  assert.equal(partial.results.length, 1); assert.match(collectionLinkWarning(partial), /Some Google result links/);
});
test('challenge detection requires page evidence and never mistakes a result page with a widget for a challenge', () => {
  const url = 'https://www.ecosia.org/search?q=energy';
  assert.equal(extract('ecosia', url, [], { title: 'Just a moment...', challengeResource: true }).challenge, true);
  assert.equal(extract('ecosia', url, [], { title: 'Localized challenge', challengeForm: true }).challenge, true);
  assert.equal(extract('ecosia', url, [], { title: 'Just a moment...' }).challenge, undefined);
  const results = extract('ecosia', url, [{ href: 'https://example.org/' }], { title: 'Just a moment...', challengeResource: true, challengeForm: true });
  assert.equal(results.challenge, undefined); assert.equal(results.results.length, 1);
});


test('Google Books is readable content; internal Google navigation does not cause an encrypted-link warning', () => {
  const result = extract('google', 'https://www.google.com/search?q=flowers', [
    { href: 'https://books.google.it/books?id=In_Lv8iMt24C' },
    { href: '/url?url=https%3A%2F%2Fbooks.google.com%2Fbooks%3Fid%3Dexample' },
    { href: '/search?q=related' }, { href: 'https://accounts.google.com/' },
    { href: 'https://books.google.it.evil.org/books?id=external' }
  ]);
  assert.equal(result.results.length, 3); assert.equal(result.unresolved, 0);
  assert.equal(result.unreadableGoogle, undefined); assert.equal(collectionLinkWarning(result), '');
  assert.ok(result.results.some(item => item.url === 'https://books.google.it/books?id=In_Lv8iMt24C'));
});

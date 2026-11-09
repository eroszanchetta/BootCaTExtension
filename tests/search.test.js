import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ENGINES, adapterForURL, searchURL, extractResults } from '../engines.js';
import { addCollection, uniqueResults } from '../collection.js';

// Synthetic DOM API fixtures test URL handling and isolated-world execution.
// They do NOT validate selectors against current live engine layouts.
function extract(engine, href, links) {
  const anchors = links.map(link => ({
    getClientRects: () => link.hidden ? [] : [{}],
    closest: () => link.ad ? {} : null,
    getAttribute: () => link.href,
    querySelector: () => ({ textContent: link.title || 'Title' }),
    textContent: link.title || 'Title'
  }));
  const context = vm.createContext({ URL, location: { href }, document: { querySelectorAll: () => anchors } });
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

test('worker serializes simultaneous collections and reports extraction errors', async () => {
  let listener;
  let collections = [];
  globalThis.chrome = {
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => { listener = fn; } } },
    tabs: { get: async id => ({ id, url: `https://www.google.com/search?q=${id}` }) },
    scripting: { executeScript: async ({ target }) => [{ result: { engine: 'google', query: String(target.tabId), pageURL: `https://www.google.com/search?q=${target.tabId}`, unresolved: 0, results: target.tabId === 3 ? [] : [{ url: `https://example.org/${target.tabId}`, title: 'Example', positionOnPage: 1 }] } }] },
    storage: { local: {
      get: async () => { await new Promise(r => setTimeout(r, 10)); return { collections }; },
      set: async data => { await new Promise(r => setTimeout(r, 10)); collections = data.collections; }
    } }
  };
  await import('../background.js');
  const request = message => new Promise(resolve => {
    assert.equal(listener(message, { id: 'test', url: 'chrome-extension://test/popup.html' }, resolve), true);
  });
  try {
    const replies = await Promise.all([request({ type: 'collect', tabId: 1 }), request({ type: 'collect', tabId: 2 })]);
    assert.equal(replies.every(r => r.ok), true);
    assert.equal(collections.length, 2);
    const failed = await request({ type: 'collect', tabId: 3 });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /No usable results/);
    assert.equal(collections.length, 2);
    await request({ type: 'clear-collections' });
    assert.equal(collections.length, 0);
  } finally { delete globalThis.chrome; }
});

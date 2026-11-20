import * as storage from '../src/project-store.js';
import { savePage } from '../src/page-store.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { workspace, extracted, waitFor } from './helpers/workspace.js';
test('Build Corpus skips saved originals, retries download failures, and maintains separate visible/included counters', async () => {
  globalThis.indexedDB = new IDBFactory(); let recover = false;
  try {
    const app = await workspace('build', {
      fetch: async url => { if (url.endsWith('/retry') && !recover) throw new Error('HTTP 503'); return { bytes: new Uint8Array([1]), contentType: 'text/html', finalURL: url, status: 200 }; },
      extractor: async (bytes, type, options) => options.sourceURL.endsWith('/no-text') ? { ...extracted(''), status: 'failed', included: false } : extracted('Corpus text')
    });
    assert.equal(app.get('start').disabled, true);
    assert.equal(app.get('documents-count').textContent, '0 documents'); assert.equal(app.get('included-count').textContent, '0 included');
    await app.input('urls', 'https://example.org/good\nhttps://example.org/no-text'); assert.equal(app.get('start').disabled, false);
    await app.click('start'); assert.equal(app.get('start').disabled, true, 'failed extraction still retains a downloaded original');
    assert.equal(app.get('documents-count').textContent, '1 document'); assert.equal(app.get('included-count').textContent, '1 included');
    await app.input('urls', 'https://example.org/good\nhttps://example.org/good#fragment\nhttps://example.org/no-text');
    assert.equal(app.get('start').disabled, true, 'duplicate/fragment variants do not reactivate downloads');
    await app.input('urls', 'https://example.org/good\nhttps://example.org/no-text\nhttps://example.org/retry');
    assert.equal(app.get('start').disabled, false); await app.click('start'); assert.equal(app.get('start').disabled, false, 'failed downloads remain retryable');
    recover = true; await app.click('start'); assert.equal(app.get('start').disabled, true);
    assert.equal(app.fetched.filter(url => url.endsWith('/good')).length, 1); assert.equal(app.fetched.filter(url => url.endsWith('/no-text')).length, 1);
    assert.equal(app.get('documents-count').textContent, '2 documents'); assert.equal(app.get('included-count').textContent, '2 included');
    const checkbox = app.get('results').children[0].children[0].children[0]; checkbox.checked = false; await checkbox.handlers.change();
    assert.equal(app.get('documents-count').textContent, '2 documents'); assert.equal(app.get('included-count').textContent, '1 included');
    const reopened = await workspace('build'); assert.equal(reopened.get('start').disabled, true);
    assert.equal(reopened.get('documents-count').textContent, '2 documents'); assert.equal(reopened.get('included-count').textContent, '1 included');
    await reopened.input('urls', reopened.get('urls').value + '\nhttps://example.org/new'); assert.equal(reopened.get('start').disabled, false);
    assert.equal(reopened.get('start').textContent, 'Download URLs');
  } finally { delete globalThis.indexedDB; }
});

test('closing is guarded during an active download and allowed after completion or stopping', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    for (const stop of [false, true]) {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const app = await workspace('close-guard', { fetch: async (url, signal) => {
        await gate; signal.throwIfAborted();
        return { bytes: new Uint8Array([1]), contentType: 'text/html', finalURL: url, status: 200 };
      } });
      assert.equal(app.beforeUnload(), false);
      await app.input('urls', `https://example.org/pending-${stop}`);
      const batch = app.click('start');
      await waitFor(() => app.fetched.length === 1);
      assert.equal(app.beforeUnload(), true);
      if (stop) await app.click('stop');
      release(); await batch;
      assert.equal(app.beforeUnload(), false);
    }
  } finally { delete globalThis.indexedDB; }
});

test('new content reveals sections without scrolling; duplicates, edits and initial restoration do not', async () => {
  globalThis.indexedDB = new IDBFactory();
  const opened = [], onOpenSection = (...args) => opened.push(args);
  try {
    const app = await workspace('reveal-content', { onOpenSection, extractor: async () => ({ ...extracted(''), status: 'failed', included: false }) });
    assert.equal(opened.length, 0);
    await app.input('urls', 'https://example.org/one');
    assert.deepEqual(opened, [['urls-section']]); opened.length = 0;
    await app.input('urls', 'https://example.org/one#fragment\nhttps://example.org/one');
    assert.equal(opened.length, 0);
    await app.click('start');
    assert.ok(opened.some(([id, options]) => id === 'review-section' && options === undefined), 'stored failed extraction reveals document recovery');
    opened.length = 0;
    const reopened = await workspace('reveal-content', { onOpenSection });
    assert.equal(opened.length, 0, 'opening existing project does not reveal restored sections');
    await savePage({ id: 'capture', url: 'https://example.org/captured', html: '<p>Captured page</p>' }, 'reveal-content');
    await reopened.notify({ captureRevision: { newValue: 'capture' } });
    assert.ok(opened.some(([id, options]) => id === 'review-section' && options === undefined)); opened.length = 0;
    const checkbox = reopened.get('results').children[0].children[0].children[0];
    checkbox.checked = false; await checkbox.handlers.change();
    assert.equal(opened.length, 0);
    await storage.saveDraft('reveal-content', { urls: 'https://example.org/remote' });
    const url = 'https://example.org/remote', filename = 'pages/remote.html';
    await storage.saveDocument('reveal-content', { url, filename, outcome: 'downloaded' }, { url, filename, textFilename: 'corpus/remote.txt', extraction: extracted('Remote document') }, new Uint8Array([1]));
    await reopened.focus();
    assert.ok(opened.some(([id, options]) => id === 'urls-section' && options === undefined));
    assert.ok(opened.some(([id, options]) => id === 'review-section' && options === undefined)); opened.length = 0;
    await reopened.focus(); assert.equal(opened.length, 0, 'unchanged refresh does not reopen manually collapsed panels');
  } finally { delete globalThis.indexedDB; }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { workspace, extracted } from './helpers/workspace.js';
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

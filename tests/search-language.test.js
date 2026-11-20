import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchLanguageFilter, languageFilterFromURL } from '../src/search-language.js';
import { searchURL } from '../src/engines.js';
import { queryPlan, queryKey } from '../src/query-lifecycle.js';
test('Google URLs apply mapped result languages without altering the query or adding region/interface settings', () => {
  for (const [language, value] of [['ita', 'lang_it'], ['hin', 'lang_hi'], ['pes', 'lang_fa'], ['epo', 'lang_eo'], ['eng', 'lang_en'], ['arb', 'lang_ar'], ['heb', 'lang_iw'], ['ekk', 'lang_et'], ['lvs', 'lang_lv'], ['cmn', 'lang_zh-CN|lang_zh-TW']]) {
    const url = new URL(searchURL('google', 'caffè & tè filetype:pdf', searchLanguageFilter('google', language)));
    assert.equal(url.searchParams.get('lr'), value);
    assert.equal(url.searchParams.get('q'), 'caffè & tè filetype:pdf');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['lr', 'q']);
    assert.equal(languageFilterFromURL('google', url.href), value);
  }
  for (const language of ['none', 'ben', undefined]) assert.equal(new URL(searchURL('google', 'query', searchLanguageFilter('google', language))).searchParams.has('lr'), false);
  for (const engine of ['duckduckgo', 'ecosia']) {
    assert.equal(searchLanguageFilter(engine, 'ita'), '');
    assert.equal(searchURL(engine, 'query', 'lang_it'), searchURL(engine, 'query'));
  }
});
test('effective Google language separates open and collected searches without changing other engines', () => {
  const state = { tabs: [{ engine: 'google', query: 'energy', languageFilter: 'lang_it' }], history: [{ engine: 'google', query: 'energy', languageFilter: 'lang_fr', status: 'collected' }] };
  for (const filter of ['lang_it', 'lang_fr']) assert.deepEqual(queryPlan(['energy'], 'google', state, filter).missing, []);
  for (const filter of ['', 'lang_en']) assert.deepEqual(queryPlan(['energy'], 'google', state, filter).missing, ['energy']);
  assert.equal(queryKey('duckduckgo', 'energy', 'lang_it'), queryKey('duckduckgo', 'energy'));
});

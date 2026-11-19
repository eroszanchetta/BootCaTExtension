import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryPlan, queryKey } from '../src/query-lifecycle.js';

test('query identity includes engine and filters while matching Unicode and whitespace normalization', () => {
  assert.equal(queryKey('google', 'cafe\u0301  energy'), queryKey('google', 'café energy'));
  assert.notEqual(queryKey('google', 'Energy'), queryKey('google', 'energy'));
  assert.notEqual(queryKey('google', 'energy filetype:pdf'), queryKey('google', 'energy filetype:docx'));
  assert.notEqual(queryKey('google', 'energy'), queryKey('duckduckgo', 'energy'));
});
test('planning skips every open-tab status and collected history, but permits closed and partial queries', () => {
  const state = { tabs: [
    { engine: 'google', query: 'loading', status: 'loading' },
    { engine: 'google', query: 'captcha', status: 'attention' },
    { engine: 'google', query: 'unloaded', status: 'attention', unloaded: true }
  ], history: [
    { engine: 'google', query: 'done', status: 'collected' },
    { engine: 'google', query: 'closed', status: 'closed' },
    { engine: 'google', query: 'partial', status: 'attention' }
  ] };
  const result = queryPlan(['loading', 'captcha', 'unloaded', 'done', 'closed', 'partial', 'new', 'new'], 'google', state);
  assert.deepEqual(result.missing, ['closed', 'partial', 'new']); assert.equal(result.total, 7); assert.equal(result.started, true); assert.equal(result.open, 3);
  assert.deepEqual(queryPlan(['done'], 'duckduckgo', state).missing, ['done']);
});

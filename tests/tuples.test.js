import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeeds, formatSeed, combinationCount, combinationAt, randomBelow, generateTuples, parseQueries } from '../src/tuples.js';

const seeds = 'alpha\nbeta\ngamma\ndelta\nepsilon';
test('seeds preserve Unicode/case, normalize whitespace and outer quotes, and deduplicate phrases', () => {
  assert.deepEqual(parseSeeds(' alpha \n\n"solar   power"\nsolar power\ncafe\u0301\ncafé\nAlpha'), ['alpha', 'solar power', 'café', 'Alpha']);
  assert.equal(formatSeed('solar power'), '"solar power"'); assert.equal(formatSeed('中文'), '中文');
  assert.equal(formatSeed('a "quoted" phrase'), '"a \\"quoted\\" phrase"');
  assert.deepEqual(parseQueries(' a b \n\na b\n"c d"'), ['a b', '"c d"']);
});
test('generation requires five distinct seeds and validates tuple length and requested count', async () => {
  for (const value of ['a\nb\nc\nd', 'a\na\nb\nc\nd']) await assert.rejects(generateTuples(value, 3, 10), /at least 5 distinct/);
  for (const length of [0, 11, 1.5]) await assert.rejects(generateTuples(seeds, length, 10), /1 to 10/);
  await assert.rejects(generateTuples(seeds, 6, 10), /needs at least 6/);
  for (const count of [0, -1, 1.5, Infinity]) await assert.rejects(generateTuples(seeds, 3, count), /positive whole/);
});
test('unranking enumerates distinct combinations with no repeated index, including lengths one and ten', () => {
  for (let n = 5; n <= 10; n++) for (let k = 1; k <= n; k++) {
    const count = combinationCount(n, k), found = new Set();
    for (let rank = 0n; rank < count; rank++) {
      const indices = combinationAt(n, k, rank);
      assert.equal(new Set(indices).size, k); assert.ok(indices.every(i => i >= 0 && i < n));
      assert.deepEqual(indices, [...indices].sort((a, b) => a - b)); found.add(indices.join(','));
    }
    assert.equal(BigInt(found.size), count);
  }
});
test('sampling terminates at exhaustion even with repeated random values and phrases are quoted once', async () => {
  const result = await generateTuples(seeds + '\nsolar power', 3, 100, { random: () => 0n });
  assert.equal(result.generated, 20); assert.equal(result.total, '20'); assert.equal(result.reduced, true);
  const lines = result.text.split('\n'); assert.equal(new Set(lines).size, 20);
  assert.equal(lines.filter(line => line.includes('"solar power"')).length, 10);
  const singles = await generateTuples(seeds, 1, 10, { random: () => 0n }); assert.equal(singles.generated, 5);
  const ten = await generateTuples(Array.from({ length: 10 }, (_, i) => `seed${i}`).join('\n'), 10, 10);
  assert.equal(ten.generated, 1); assert.equal(ten.text.split(' ').length, 10);
});
test('large seed sets and combination counts beyond safe integers do not require enumerating combinations', async () => {
  const input = Array.from({ length: 10000 }, (_, i) => `seed${i}`).join('\n');
  const result = await generateTuples(input, 10, 10);
  assert.equal(result.seedCount, 10000); assert.ok(BigInt(result.total) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(new Set(result.text.split('\n')).size, 10);
  for (const line of result.text.split('\n')) assert.equal(new Set(line.split(' ')).size, 10);
  for (const bound of [1n, 2n, 3n, 256n, 257n, 2n ** 100n + 1n]) {
    for (let i = 0; i < 20; i++) { const rank = randomBelow(bound); assert.ok(rank >= 0n && rank < bound); }
  }
});
test('generation yields and aborts without returning partial replacement text', async () => {
  const controller = new AbortController(); let yielded = 0;
  await assert.rejects(generateTuples(Array.from({ length: 100 }, (_, i) => `s${i}`).join('\n'), 3, 1000, {
    signal: controller.signal, yieldControl: async () => { yielded++; controller.abort(); }
  }), { name: 'AbortError' });
  assert.equal(yielded, 1);
});

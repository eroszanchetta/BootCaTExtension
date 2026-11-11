// Language-independent seed handling: preserve case and spelling, collapse
// whitespace, and accept phrases with or without surrounding double quotes.
export function parseSeeds(text) {
  const seeds = new Set();
  for (const line of text.split(/\r?\n/)) {
    let seed = line.trim().normalize('NFC');
    if (seed.length >= 2 && seed.startsWith('"') && seed.endsWith('"')) seed = seed.slice(1, -1).trim();
    seed = seed.replace(/\s+/gu, ' ');
    if (seed) seeds.add(seed);
  }
  return [...seeds];
}
export function formatSeed(seed) {
  const escaped = seed.replace(/"/g, '\\"');
  return /\s/u.test(seed) ? `"${escaped}"` : escaped;
}
export function combinationCount(n, k) {
  if (k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let count = 1n;
  for (let i = 1; i <= k; i++) count = count * BigInt(n - k + i) / BigInt(i);
  return count;
}
export function randomBelow(max) {
  if (max <= 0n) throw new Error('Random bound must be positive');
  if (max === 1n) return 0n;
  const bits = (max - 1n).toString(2).length;
  const bytes = new Uint8Array(Math.ceil(bits / 8)), mask = 255 >>> (bytes.length * 8 - bits);
  for (;;) {
    crypto.getRandomValues(bytes); bytes[0] &= mask;
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (value < max) return value;
  }
}
// Combinatorial unranking avoids building n-choose-k combinations in memory.
export function combinationAt(n, k, rank) {
  const indices = new Array(k); let upper = n - 1;
  for (let size = k; size > 0; size--) {
    let low = size - 1, high = upper;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (combinationCount(middle, size) <= rank) low = middle; else high = middle - 1;
    }
    indices[size - 1] = low; rank -= combinationCount(low, size); upper = low - 1;
  }
  return indices;
}
export async function generateTuples(seedText, length, requested, { signal, random = randomBelow, onProgress = () => {}, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const seeds = parseSeeds(seedText);
  if (seeds.length < 5) throw new Error('Enter at least 5 distinct seeds, one per line. Blank and duplicate lines do not count.');
  if (!Number.isInteger(length) || length < 1 || length > 10) throw new Error('Tuple length must be a whole number from 1 to 10.');
  if (length > seeds.length) throw new Error(`Tuple length ${length} needs at least ${length} distinct seeds. You have ${seeds.length}.`);
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('Enter a positive whole number of tuples.');
  const total = combinationCount(seeds.length, length), count = Number(total < BigInt(requested) ? total : BigInt(requested));
  let operations = 0;
  async function checkpoint() {
    signal?.throwIfAborted();
    if (++operations % 100 === 0) { await yieldControl(); signal?.throwIfAborted(); }
  }
  const selected = new Set(), ranks = [];
  // Floyd's algorithm samples distinct ranks without collision-retry loops,
  // even when the user requests every possible combination.
  for (let j = total - BigInt(count); j < total; j++) {
    await checkpoint();
    const candidate = random(j + 1n), rank = selected.has(candidate) ? j : candidate;
    selected.add(rank); ranks.push(rank);
  }
  for (let i = ranks.length - 1; i > 0; i--) {
    await checkpoint();
    const j = Number(random(BigInt(i + 1))); [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  const tuples = [];
  for (const rank of ranks) {
    await checkpoint();
    tuples.push(combinationAt(seeds.length, length, rank).map(index => formatSeed(seeds[index])).join(' '));
    if (tuples.length % 100 === 0) onProgress(tuples.length, count);
  }
  signal?.throwIfAborted();
  return { text: tuples.join('\n'), generated: count, total: total.toString(), seedCount: seeds.length, reduced: count < requested };
}
export const parseQueries = text => [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];

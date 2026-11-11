import { normaliseText } from './extraction.js';
export const PDF_TEXT_LIMIT = 2_000_000;

// Baseline extraction, retained separately from the optional layout heuristics.
// Preserve item order and every hyphen, including soft hyphens.
export function pdfPageText(items) {
  const parts = []; let previous = null, length = 0;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (previous && item.str && previous.str && !/\s$/.test(previous.str) && !/^\s/.test(item.str)) {
      const height = Math.max(Math.abs(item.height || 0), 1);
      const x = item.transform?.[4], y = item.transform?.[5];
      const px = previous.transform?.[4], py = previous.transform?.[5];
      if (Number.isFinite(y) && Number.isFinite(py) && Math.abs(y - py) > height * 0.5) parts.push('\n');
      else {
        const gap = item.dir === 'rtl' ? px - x - (item.width || 0) : x - px - (previous.width || 0);
        if (gap > Math.max(0.5, height * 0.12)) parts.push(' ');
      }
    }
    parts.push(item.str); length += item.str.length;
    if (length > PDF_TEXT_LIMIT) throw new Error('PDF text exceeds the 2 million character limit');
    previous = item;
    if (item.hasEOL) { parts.push('\n'); previous = null; }
  }
  return normaliseText(parts.join(''));
}
function lineFrom(items) {
  const text = pdfPageText(items);
  const visible = items.filter(item => item.str?.trim());
  const first = visible[0], height = Math.abs(first?.height || 0);
  const dir = first?.dir || 'ltr', font = first?.fontName;
  const valid = height > 0 && ['ltr', 'rtl'].includes(dir) && visible.every(item => {
    const t = item.transform;
    return t?.length >= 6 && t.every(Number.isFinite) && Number.isFinite(item.width) && item.width >= 0 &&
      Math.abs(t[1]) < 0.01 && Math.abs(t[2]) < 0.01 &&
      Math.abs(Math.abs(item.height || 0) - height) < height * 0.15 &&
      Math.abs(t[5] - first.transform[5]) < height * 0.35 &&
      (item.dir || 'ltr') === dir && item.fontName === font;
  });
  if (!valid) return { text, valid: false };
  let left = Infinity, right = -Infinity;
  for (const item of visible) { left = Math.min(left, item.transform[4]); right = Math.max(right, item.transform[4] + item.width); }
  // Large gaps between runs are an ambiguous table/column signal. Keep breaks.
  const complex = visible.some((item, index) => {
    if (item.str.includes('\t')) return true;
    if (!index) return false;
    const previous = visible[index - 1];
    const gap = dir === 'rtl' ? previous.transform[4] - item.transform[4] - item.width : item.transform[4] - previous.transform[4] - previous.width;
    return gap > height;
  });
  const list = /^(?:[•‣⁃◦▪●*\-–—]|\p{Nd}+[.)]|\(\p{Nd}+\))\s/u.test(text);
  return { text, valid: !complex && !list, height, dir, font, y: first.transform[5], start: dir === 'rtl' ? right : left, width: right - left };
}
function pageLines(items) {
  const lines = []; let pending = [], previous = null;
  const flush = () => { lines.push(lineFrom(pending)); pending = []; previous = null; };
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (previous && Number.isFinite(item.transform?.[5]) && Number.isFinite(previous.transform?.[5]) &&
        Math.abs(item.transform[5] - previous.transform[5]) > Math.max(Math.abs(item.height || 0), 1) * 0.5) flush();
    pending.push(item); previous = item;
    if (item.hasEOL) flush();
  }
  if (pending.length) flush();
  return lines;
}
function compatible(a, b) {
  if (!a.valid || !b.valid || a.dir !== b.dir || a.font !== b.font) return false;
  const height = Math.max(a.height, b.height), gap = a.y - b.y;
  return Math.abs(a.height - b.height) < height * 0.15 && Math.abs(a.start - b.start) <= height * 0.5 && gap >= height * 0.8 && gap <= height * 1.65;
}
export function formatPDFPage(items) {
  const rawText = pdfPageText(items);
  if (items.length > 60000) return { text: rawText, rawText, joinedLines: 0 };
  const lines = pageLines(items);
  // Require at least three aligned, similarly styled lines as evidence of a
  // wrapped paragraph. Never infer reading order or cross a page boundary.
  const joins = new Set();
  for (let start = 0; start < lines.length;) {
    let end = start + 1;
    while (end < lines.length && compatible(lines[end - 1], lines[end])) end++;
    if (end - start >= 3) {
      let width = 0;
      for (let i = start; i < end; i++) width = Math.max(width, lines[i].width);
      for (let i = start + 1; i < end; i++) {
        const a = lines[i - 1], b = lines[i];
        // Whitespace evidence avoids assuming every script separates words
        // with spaces. Do not join single-token lines or repair hyphenation.
        if (width > a.height * 5 && width - a.width <= Math.max(a.height * 2, width * 0.06) &&
            /\S+\s+\S/u.test(a.text) && /\S+\s+\S/u.test(b.text) && !/[\p{Dash_Punctuation}\u00ad]$/u.test(a.text)) joins.add(i);
      }
    }
    start = end;
  }
  if (!joins.size) return { text: rawText, rawText, joinedLines: 0 };
  const parts = [];
  lines.forEach((line, index) => { if (index) parts.push(joins.has(index) ? ' ' : '\n'); parts.push(line.text); });
  return { text: normaliseText(parts.join('')), rawText, joinedLines: joins.size };
}

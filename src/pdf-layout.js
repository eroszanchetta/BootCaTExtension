import { DEFAULT_SETTINGS } from './settings.js';
import { normaliseText } from './extraction.js';
export const PDF_TEXT_LIMIT = DEFAULT_SETTINGS.pdfCharacters;

// Baseline extraction, retained separately from the optional layout heuristics.
// Preserve item order and every hyphen, including soft hyphens.
export function pdfPageText(items, limit = PDF_TEXT_LIMIT) {
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
    if (length > limit) throw new Error(`PDF text exceeds the ${limit.toLocaleString()} character limit`);
    previous = item;
    if (item.hasEOL) { parts.push('\n'); previous = null; }
  }
  return normaliseText(parts.join(''));
}
// Apply the corpus rule to every boundary, including boundaries between pages.
// The raw extraction remains available separately; punctuation/hyphens are kept.
export function formatPDFText(value) {
  const rawText = normaliseText(value); let joinedLines = 0;
  const joined = rawText.replace(/\n/g, (newline, offset) => {
    if (rawText[offset - 1] === '.') return newline;
    joinedLines++; return ' ';
  });
  return { text: normaliseText(joined), rawText, joinedLines };
}
export const formatPDFPage = (items, limit = PDF_TEXT_LIMIT) => formatPDFText(pdfPageText(items, limit));

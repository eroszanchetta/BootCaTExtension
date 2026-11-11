import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPDFPage, pdfPageText } from '../src/pdf-layout.js';

const line = (text, index, width = 300, extra = {}) => ({ str: text, width, height: 10, transform: [10, 0, 0, 10, 50, 750 - index * 12], fontName: 'body', dir: 'ltr', hasEOL: true, ...extra });
test('aligned wrapping joins lines and normalizes spaces without changing characters or paragraph ends', () => {
  const items = [line('  A long   paragraph line  ', 0), line('A short ending', 1, 100), line('Another full paragraph line', 2), line('A final ending here', 3, 130)];
  const result = formatPDFPage(items);
  assert.equal(result.rawText, 'A long paragraph line\nA short ending\nAnother full paragraph line\nA final ending here');
  assert.equal(result.text, 'A long paragraph line A short ending\nAnother full paragraph line A final ending here');
  assert.equal(result.joinedLines, 2);
  assert.equal(result.text.replace(/\s/g, ''), result.rawText.replace(/\s/g, ''));
});
test('hyphens and soft hyphens remain intact with their line boundaries', () => {
  for (const hyphen of ['-', '\u00ad', '\u2010', '\u2011']) {
    const items = [line(`Some words with a hyphen${hyphen}`, 0), line('More words on another line', 1), line('And the final words', 2, 100)];
    const result = formatPDFPage(items);
    assert.ok(result.text.includes(`${hyphen}\nMore`)); assert.equal(result.joinedLines, 1);
  }
});
test('font changes, indentation, lists, large paragraph gaps, tables and missing geometry keep line boundaries', () => {
  const base = () => [line('First full line of words', 0), line('Second full line of words', 1), line('Last words in paragraph', 2, 100)];
  const cases = [
    base().map((item, i) => i === 0 ? { ...item, fontName: 'heading' } : item),
    base().map((item, i) => i === 1 ? { ...item, transform: [10, 0, 0, 10, 70, 738] } : item),
    base().map((item, i) => ({ ...item, str: `${i + 1}. ${item.str}` })),
    base().map((item, i) => ({ ...item, str: `• ${item.str}` })),
    base().map((item, i) => ({ ...item, transform: [10, 0, 0, 10, 50, 750 - i * 30] })),
    base().map(item => ({ ...item, transform: undefined })),
    base().map(item => ({ ...item, transform: [0, 10, -10, 0, ...item.transform.slice(4)] })),
    [line('Left cell', 0, 60, { hasEOL: false }), line('Right cell', 0, 80, { transform: [10, 0, 0, 10, 220, 750] }),
      line('Left cell', 1, 60, { hasEOL: false }), line('Right cell', 1, 80, { transform: [10, 0, 0, 10, 220, 738] }),
      line('Left cell', 2, 60, { hasEOL: false }), line('Right cell', 2, 80, { transform: [10, 0, 0, 10, 220, 726] })]
  ];
  for (const items of cases) {
    const result = formatPDFPage(items);
    assert.equal(result.joinedLines, 0, JSON.stringify(items)); assert.equal(result.text, pdfPageText(items));
  }
});
test('no dictionaries or punctuation rules: spaced Unicode scripts and right-aligned RTL text follow geometry', () => {
  for (const strings of [['Αυτή είναι μια γραμμή', 'Αυτή είναι άλλη γραμμή', 'Τέλος της παραγράφου'], ['هذه كلمات في سطر', 'هذه كلمات في سطر', 'نهاية هذه الفقرة']]) {
    const items = strings.map((str, i) => line(str, i));
    assert.equal(formatPDFPage(items).text, strings.join(' '));
    const rtl = items.map((item, i) => ({ ...item, dir: 'rtl', width: i === 2 ? 100 : 300, transform: [10, 0, 0, 10, i === 2 ? 250 : 50, item.transform[5]] }));
    assert.equal(formatPDFPage(rtl).text, strings.join(' '));
  }
  const cjk = ['中文测试文本', '中文测试文本', '中文测试文本'].map((text, i) => line(text, i));
  assert.equal(formatPDFPage(cjk).text, pdfPageText(cjk), 'do not insert spaces into unspaced lines');
});

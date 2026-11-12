import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPDFPage, formatPDFText, pdfPageText } from '../src/pdf-layout.js';

test('PDF cleanup replaces every newline not immediately preceded by an ASCII dot', () => {
  const raw = 'A wrapped\nline without punctuation\nEnd.\nNew sentence!\nQuestion?\nColon:\nA final line';
  const result = formatPDFText(raw);
  assert.equal(result.text, 'A wrapped line without punctuation End.\nNew sentence! Question? Colon: A final line');
  assert.equal(result.rawText, raw); assert.equal(result.joinedLines, 5);
});
test('blank lines and page boundaries follow the same dot rule, with CRLF and trailing whitespace normalized', () => {
  assert.equal(formatPDFText('Page one\n\nPage two').text, 'Page one Page two');
  assert.equal(formatPDFText('End. \r\n\r\nNext').text, 'End.\nNext');
  assert.equal(formatPDFText('First\n\n\nSecond').text, 'First Second');
  assert.equal(formatPDFText('End."\nNext').text, 'End." Next', 'the immediate character is a quote, not a dot');
});
test('hyphens and Unicode spelling are retained without hyphenation repair', () => {
  for (const hyphen of ['-', '\u00ad', '\u2010', '\u2011']) {
    const raw = 'A hyphen' + hyphen + '\nated word';
    assert.equal(formatPDFText(raw).text, 'A hyphen' + hyphen + ' ated word'); assert.equal(formatPDFText(raw).rawText, raw);
  }
  assert.equal(formatPDFText('中文\n测试。\nΕλληνικά\nالعربية').text, '中文 测试。 Ελληνικά العربية');
});
test('cleanup also applies without geometry or font/style information', () => {
  const items = [{ str: 'A heading', hasEOL: true }, { str: 'A body line.', hasEOL: true }, { str: 'Another line', hasEOL: true }];
  const result = formatPDFPage(items);
  assert.equal(result.text, 'A heading A body line.\nAnother line');
  assert.equal(result.rawText, pdfPageText(items));
});

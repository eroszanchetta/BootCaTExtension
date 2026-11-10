import { extractDownloadedDocument } from '../binary-extraction.js';
import { makeZIP } from '../zip.js';
import { DOCX_MIME } from '../docx.js';
import { docxFiles, pdfFixture } from './browser-tests.fixtures.js';
import { extractDocument, contentToText } from '../extraction.js';
const encode = text => new TextEncoder().encode(text);
const results = [];
function check(name, fn) {
  try { fn(); results.push(`PASS: ${name}`); }
  catch (error) { results.push(`FAIL: ${name}: ${error.message}`); }
}
function assert(value, message) { if (!value) throw new Error(message); }
const paragraphs = [
  'Renewable energy systems require careful technical planning, reliable transmission networks, and detailed assessments of demand. Engineers evaluate local resources and compare available technologies before selecting a design. The aim is to provide a stable supply while reducing environmental impacts.',
  'Specialised terminology helps researchers describe generation capacity, energy storage and grid stability precisely. A technical corpus should preserve these sentences, their punctuation and their paragraph boundaries. It should also retain important diacritics in words such as caffè and énergie.',
  'A multilingual collection can include 中文技术资料 as well as European languages. Each document needs enough context for translators to inspect how a term is used. Removing unrelated navigation makes that context easier to interpret without changing the original wording.'
];
const html = `<!doctype html><html lang="en"><head><title>Energy terminology</title></head><body><nav><a href="/">NAVIGATION_SENTINEL</a></nav><main><article><h1>Energy terminology</h1>${paragraphs.map(p => `<p>${p}</p>`).join('')}<ul><li>Solar generation capacity.</li><li>Battery storage capacity.</li></ul></article></main><footer>FOOTER_SENTINEL</footer><script>globalThis.bootcatUnsafeScriptRan = true;</script></body></html>`;
let extracted;
check('real Readability extracts an article and removes navigation', () => {
  extracted = extractDocument(encode(html), 'text/html');
  assert(extracted.status === 'ok', JSON.stringify(extracted.warnings));
  assert(extracted.text.includes(paragraphs[0]), 'Lost main paragraph');
  assert(!extracted.text.includes('NAVIGATION_SENTINEL'), 'Navigation retained');
  assert(!extracted.text.includes('FOOTER_SENTINEL'), 'Footer retained');
  assert(extracted.title === 'Energy terminology', 'Title metadata incorrect');
});
check('Unicode and paragraph boundaries survive real extraction', () => {
  assert(extracted?.text.includes('caffè and énergie'), 'Diacritics lost');
  assert(extracted.text.includes('中文技术资料'), 'Chinese text lost');
  assert(extracted.text.includes(paragraphs[0] + '\n\n' + paragraphs[1]), 'Paragraphs joined or changed');
});
check('downloaded script was never executed', () => { assert(!globalThis.bootcatUnsafeScriptRan, 'Remote script executed'); });
check('table/list cells and hidden content are serialized correctly with a real DOM', () => {
  const doc = new DOMParser().parseFromString('<div><p>A</p><p>B</p><ul><li>One</li><li>Two</li></ul><table><tr><td>Left</td><td>Right</td></tr></table><div hidden>HIDDEN</div></div>', 'text/html');
  const text = contentToText(doc.body);
  assert(text.includes('A\n\nB') && text.includes('One\n\nTwo') && text.includes('Left Right'), text);
  assert(!text.includes('HIDDEN'), 'Hidden content retained');
});
check('non-content page has no successful empty corpus output', () => {
  const result = extractDocument(encode('<html><body></body></html>'), 'text/html');
  assert(result.status === 'failed' && result.included === false && !result.text, 'Empty page treated as corpus text');
});
check('Windows-1252 produces UTF-8-compatible accented output', () => {
  const prefix = encode('<html><head><meta charset="windows-1252"></head><body><article><h1>Encodage</h1><p>');
  const tail = encode(' ' + paragraphs[0].repeat(3) + '</p></article></body></html>');
  const bytes = new Uint8Array(prefix.length + 5 + tail.length); bytes.set(prefix); bytes.set([67,97,102,102,232], prefix.length); bytes.set(tail, prefix.length + 5);
  const result = extractDocument(bytes, 'text/html');
  assert(result.status === 'ok' && result.text.includes('Caffè'), 'Accented text was not decoded/extracted');
});
check('real Defuddle extracts the same article without navigation', () => {
  const result = extractDocument(encode(html), 'text/html', { extractor: 'defuddle', sourceURL: 'https://example.org/energy' });
  assert(result.status === 'ok', JSON.stringify(result.warnings));
  assert(result.extractor === 'defuddle' && result.extractorVersion === '0.19.0', 'Wrong extractor metadata');
  assert(result.text.includes(paragraphs[0]), 'Lost main paragraph');
  assert(result.text.includes('caffè and énergie') && result.text.includes('中文技术资料'), 'Lost Unicode');
  assert(!result.text.includes('NAVIGATION_SENTINEL') && !result.text.includes('FOOTER_SENTINEL'), 'Boilerplate retained');
  assert(result.text.includes(paragraphs[0] + '\n\n' + paragraphs[1]), 'Paragraph boundaries lost');
});
check('real Defuddle does not execute downloaded scripts', () => {
  assert(!globalThis.bootcatUnsafeScriptRan, 'Remote script executed');
});
check('plain text remains independent of the chosen HTML extractor', () => {
  const text = 'Caffè 中文\n\nA second paragraph.';
  const result = extractDocument(encode(text), 'text/plain', { extractor: 'defuddle' });
  assert(result.status === 'ok' && result.extractor === 'plain-text' && result.text === text, 'Plain-text path changed');
});
async function checkAsync(name, fn) {
  try { await fn(); results.push(`PASS: ${name}`); }
  catch (error) { results.push(`FAIL: ${name}: ${error.message}`); }
}
await checkAsync('local PDF worker extracts embedded text without detaching the original', async () => {
  const bytes = pdfFixture({ twoPages: true });
  const before = bytes.length;
  const result = await extractDownloadedDocument(bytes, 'application/pdf');
  assert(result.status === 'ok', result.warnings.join(' '));
  assert(result.pageCount === 2 && result.text.includes('Renewable energy corpus.'), 'PDF text/page metadata missing');
  assert(bytes.length === before, 'Original PDF bytes detached');
});
await checkAsync('real DOMParser reads DOCX paragraphs and tables without rendering document markup', async () => {
  const bytes = new Uint8Array(await makeZIP(docxFiles).arrayBuffer());
  const result = await extractDownloadedDocument(bytes, DOCX_MIME);
  assert(result.status === 'ok', result.warnings.join(' '));
  assert(result.text === 'Caffè 中文 corpus.\n\nSecond paragraph.\n\nLeft cell Right cell', result.text);
});
await checkAsync('textless PDF is excluded and suggests OCR', async () => {
  const result = await extractDownloadedDocument(pdfFixture({ empty: true }), 'application/pdf');
  assert(result.status === 'failed' && !result.included && !result.text, 'Textless PDF included');
  assert(result.warnings.some(warning => warning.includes('OCR')), 'Missing OCR guidance');
});
document.getElementById('output').textContent = results.join('\n') + `\n\n${results.filter(r => r.startsWith('PASS')).length}/${results.length} passed.`;

document.getElementById('output').dataset.complete = 'true';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { decodeResponse, normaliseText, contentToText, extractDocument, EXTRACTION_LIMIT } from '../src/extraction.js';
import { corpusFiles, extractionMetadata } from '../src/corpus.js';
const encode = text => new TextEncoder().encode(text);
const text = value => ({ nodeType: 3, nodeValue: value });
const element = (tag, children = [], attributes = {}) => ({ nodeType: 1, tagName: tag, childNodes: children, hasAttribute: key => key in attributes, getAttribute: key => attributes[key] ?? null });

test('charset decoding handles UTF-8, Windows-1252 meta/HTTP, BOM precedence and invalid declarations', () => {
  assert.equal(decodeResponse(encode('Caffè 中文'), 'text/html').text, 'Caffè 中文');
  const latin = Uint8Array.from([...encode('<meta charset="windows-1252"><p>Caff'), 232, ...encode('</p>')]);
  assert.match(decodeResponse(latin, 'text/html').text, /Caffè/);
  assert.equal(decodeResponse(Uint8Array.from([99, 97, 102, 232]), 'text/plain; charset=iso-8859-1').text, 'cafè');
  assert.equal(decodeResponse(Uint8Array.from([0xef,0xbb,0xbf,...encode('caffè')]), 'text/html; charset=windows-1252').encoding, 'utf-8');
  assert.match(decodeResponse(encode('text'), 'text/html; charset=made-up').warnings[0], /Unsupported/);
  assert.equal(decodeResponse(Uint8Array.from([0xe8]), 'text/plain').encoding, 'windows-1252');
});

test('text conversion preserves block/list/table boundaries and Unicode while skipping hidden/scripts', () => {
  const root = element('DIV', [
    element('H2', [text('Caffè 中文')]),
    element('P', [text('A '), element('EM', [text('technical')]), text(' term.')]),
    element('P', [text('Next sentence.')]),
    element('UL', [element('LI', [text('First item')]), element('LI', [text('Second item')])]),
    element('TABLE', [element('TR', [element('TD', [text('Cell one')]), element('TD', [text('Cell two')])])]),
    element('SCRIPT', [text('malicious()')]), element('DIV', [text('hidden')], { hidden: '' })
  ]);
  const output = contentToText(root);
  assert.match(output, /Caffè 中文\n\nA technical term\.\n\nNext sentence\./);
  assert.match(output, /First item\n\nSecond item/);
  assert.match(output, /Cell one Cell two/);
  assert.doesNotMatch(output, /malicious|hidden/);
  assert.equal(normaliseText('  A\u00a0 B\r\n\r\n\r\nC  '), 'A B\n\nC');
});

test('extraction reports unsupported/oversize/failed documents without body-text fallback', () => {
  assert.equal(extractDocument(encode('pdf'), 'application/pdf').status, 'unsupported');
  assert.equal(extractDocument(new Uint8Array(EXTRACTION_LIMIT + 1), 'text/html').status, 'failed');
  const options = { parseHTML: () => ({ querySelectorAll: () => [] }), ReadabilityClass: class { parse() { return null; } } };
  const failed = extractDocument(encode('<html>navigation</html>'), 'text/html', options);
  assert.equal(failed.status, 'failed'); assert.equal(failed.text, ''); assert.equal(failed.included, false);
  const plain = extractDocument(encode('Caffè\n\nSecond paragraph.'), 'text/plain');
  assert.equal(plain.text, 'Caffè\n\nSecond paragraph.'); assert.equal(plain.included, true);
  assert.match(plain.warnings[0], /Very little/);
});

test('metadata excludes body text; excluded documents disappear only from corpus output', () => {
  const e = extractDocument(encode('Useful corpus text'), 'text/plain');
  const docs = [{ url: 'https://example.org', filename: 'pages/0001-example.txt', textFilename: 'corpus/0001-example.txt', extraction: e }];
  assert.equal(corpusFiles(docs).length, 1);
  assert.equal('text' in extractionMetadata(docs)[0], false);
  e.included = false;
  assert.equal(corpusFiles(docs).length, 0);
  assert.equal(extractionMetadata(docs)[0].textFilename, null);
  assert.equal(extractionMetadata(docs)[0].originalFilename, 'pages/0001-example.txt');
});

test('bundled upstream script loads without modification and matches recorded release hash', async () => {
  const script = await readFile(new URL('../src/vendor/Readability.js', import.meta.url));
  assert.equal(createHash('sha256').update(script).digest('hex'), '34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174');
  const context = vm.createContext({}); vm.runInContext(script.toString(), context);
  assert.equal(typeof context.Readability, 'function');
});

test('Defuddle adapter handles cleaned HTML and source metadata through the common contract', () => {
  let options;
  const doc = { querySelectorAll: () => [], getElementsByTagName: () => [] };
  const content = element('DIV', [element('P', [text('Caffè — useful technical corpus text.')])]);
  const parseHTML = html => html === '<p>cleaned</p>' ? { body: content } : doc;
  class Defuddle {
    constructor(document, settings) { assert.equal(document, doc); options = settings; }
    parse() { return { content: '<p>cleaned</p>', title: 'Technical article', language: 'it', author: 'Author', published: '2026-11-09' }; }
  }
  const result = extractDocument(encode('<p>source</p>'), 'text/html', { extractor: 'defuddle', DefuddleClass: Defuddle, parseHTML, sourceURL: 'https://example.org/article' });
  assert.equal(result.status, 'ok');
  assert.equal(result.extractor, 'defuddle');
  assert.equal(result.text, 'Caffè — useful technical corpus text.');
  assert.equal(result.language, 'it');
  assert.equal(result.byline, 'Author');
  assert.equal(options.url, 'https://example.org/article');
  assert.equal(options.markdown, false);
  assert.throws(() => options.fetch('https://example.org/extra'), /Additional network requests are disabled/);
  assert.equal(result.extractorVersion, '0.19.0');
});

test('missing Defuddle never silently runs Readability and default remains Readability', () => {
  let readabilityCalled = false;
  class Readability { parse() { readabilityCalled = true; return null; } }
  const result = extractDocument(encode('<p>source</p>'), 'text/html', { extractor: 'defuddle', DefuddleClass: undefined, ReadabilityClass: Readability });
  assert.equal(result.status, 'failed');
  assert.equal(result.extractor, 'defuddle');
  assert.equal(readabilityCalled, false);
  assert.match(result.warnings.join(' '), /Bundled Defuddle library did not load/);
  const defaultResult = extractDocument(encode('<p>source</p>'), 'text/html', { ReadabilityClass: Readability, parseHTML: () => ({ querySelectorAll: () => [] }) });
  assert.equal(defaultResult.extractor, 'mozilla-readability');
  assert.equal(readabilityCalled, true);
});


test('real bundled Defuddle exports a constructor and handles an empty document without network access', async () => {
  const script = await readFile(new URL('../src/vendor/Defuddle.js', import.meta.url));
  assert.equal(createHash('sha256').update(script).digest('hex'), '9b61869627a459bddca398d0136f4de7115577f2f9f01eac4b4fb0a88571e1df');
  const context = vm.createContext({ URL });
  context.self = context;
  vm.runInContext(script.toString(), context);
  assert.equal(typeof context.Defuddle, 'function');
  const empty = { documentElement: null, querySelectorAll: () => [] };
  const response = new context.Defuddle(empty, { url: 'https://example.org/' }).parse();
  assert.equal(response.content, '');
  assert.equal(response.domain, 'example.org');
  const extracted = extractDocument(encode('<html></html>'), 'text/html', {
    extractor: 'defuddle', DefuddleClass: context.Defuddle,
    parseHTML: () => ({ ...empty, getElementsByTagName: () => [] }), sourceURL: 'https://example.org/'
  });
  assert.equal(extracted.status, 'failed');
  assert.equal(extracted.included, false);
  assert.equal(extracted.extractorVersion, '0.19.0');
});

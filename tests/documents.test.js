import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { extractDownloadedDocument, documentType, extractionContentType, pdfPageText, PDFJS_VERSION } from '../src/binary-extraction.js';
import { DOCX_MIME } from '../src/docx.js';
import { filenameFor } from '../src/core.js';
import { makeZIP } from '../src/zip.js';
import { corpusFiles, extractionMetadata } from '../src/corpus.js';
import { docxFiles, wordXML, pdfFixture } from './browser-tests.fixtures.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Python's standard XML parser supplies a DOM-shaped adapter in Node.
// Browser fixtures separately exercise the real DOMParser implementation.
function parseXML(xml) {
  const tree = JSON.parse(execFileSync('python3', ['-c', `
import json,sys,xml.etree.ElementTree as ET
def node(e):
 name=e.tag.split('}',1)
 return {'nodeType':1,'namespaceURI':name[0][1:] if len(name)==2 else '', 'localName':name[-1], 'attrs':e.attrib, 'textContent':''.join(e.itertext()), 'childNodes':[node(c) for c in e]}
try: print(json.dumps(node(ET.fromstring(sys.stdin.read()))))
except ET.ParseError: print(json.dumps({'parseError': True}))
`], { input: xml, encoding: 'utf8' }));
  if (tree.parseError) throw new Error('Malformed DOCX XML');
  function hydrate(node) {
    node.getAttribute = name => node.attrs[name] ?? null;
    node.getAttributeNS = (ns, name) => node.attrs[`{${ns}}${name}`] ?? null;
    node.childNodes.forEach(hydrate); return node;
  }
  return { documentElement: hydrate(tree) };
}
async function docx(files = docxFiles, compressed = false) {
  if (!compressed) return new Uint8Array(await makeZIP(files).arrayBuffer());
  return new Uint8Array(execFileSync('python3', ['-c', `
import json,sys,io,zipfile
out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for f in json.load(sys.stdin):z.writestr(f['name'],f['data'])
sys.stdout.buffer.write(out.getvalue())
`], { input: JSON.stringify(files) }));
}
const options = { parseXML, loadPDF: async () => pdfjs };

test('real PDF.js extracts text/page boundaries and preserves the original byte buffer', async () => {
  const bytes = pdfFixture({ twoPages: true }); const original = bytes.slice();
  const result = await extractDownloadedDocument(bytes, 'application/pdf', options);
  assert.equal(result.status, 'ok', result.warnings.join(' '));
  assert.equal(result.extractor, 'pdfjs'); assert.equal(result.extractorVersion, pdfjs.version);
  assert.equal(result.pageCount, 2); assert.equal(result.pages.length, 2);
  assert.ok(result.text.includes('Renewable energy corpus.\nSecond line.\n\nRenewable energy corpus.'));
  assert.deepEqual(bytes, original, 'PDF.js must receive a copy, not detach the original');
});

test('real PDF.js provides geometry for paragraph cleanup and retains baseline text separately', async () => {
  const result = await extractDownloadedDocument(pdfFixture({ wrapped: true }), 'application/pdf', options);
  assert.equal(result.status, 'ok', result.warnings.join(' '));
  assert.equal(result.formatting.joinedLines, 2);
  assert.equal(result.text, 'These are words on a long line of corpus text. Other new words on a long line of corpus text. This is the final line.');
  assert.equal(result.rawText, 'These are words on a long line of corpus text.\nOther new words on a long line of corpus text.\nThis is the final line.');
  assert.equal(result.formatting.hyphenation, 'preserved');
  assert.equal(extractionMetadata([{ url: 'https://example.org/', extraction: result }])[0].rawText, undefined);
});

test('textless and malformed PDFs produce no included corpus text', async () => {
  const empty = await extractDownloadedDocument(pdfFixture({ empty: true }), 'application/pdf', options);
  assert.equal(empty.status, 'failed'); assert.equal(empty.included, false); assert.match(empty.warnings.join(' '), /OCR/);
  const invalid = await extractDownloadedDocument(new TextEncoder().encode('%PDF-1.4\nBroken'), 'application/pdf', options);
  assert.equal(invalid.status, 'failed'); assert.equal(invalid.text, '');
});

test('PDF downloads and local imports above the former 10 MiB cap both extract successfully', async () => {
  const bytes = pdfFixture({ paddingBytes: 15 * 1024 * 1024 });
  const ordinary = await extractDownloadedDocument(bytes, 'application/pdf', options);
  assert.equal(ordinary.status, 'ok', ordinary.warnings.join(' '));
  const local = await extractDownloadedDocument(bytes, 'application/pdf', options);
  assert.equal(local.status, 'ok', local.warnings.join(' ')); assert.match(local.text, /Renewable energy corpus/);
});

test('DOCX STORE and DEFLATE files preserve Unicode, paragraphs and table cells; omit hidden/deleted/field text', async () => {
  for (const compressed of [false, true]) {
    const result = await extractDownloadedDocument(await docx(docxFiles, compressed), DOCX_MIME, options);
    assert.equal(result.status, 'ok', result.warnings.join(' ')); assert.equal(result.extractor, 'bootcat-docx');
    assert.equal(result.text, 'Caffè 中文 corpus.\n\nSecond paragraph.\n\nLeft cell Right cell');
    assert.ok(!result.text.includes('SENTINEL'));
    const document = { url: 'https://example.org/file', filename: 'pages/file.docx', textFilename: 'corpus/file.txt', extraction: result };
    assert.equal(corpusFiles([document]).length, 1);
    assert.equal(extractionMetadata([document])[0].text, undefined);
  }
});

test('binary detection handles generic MIME types without mistaking other ZIP/HTML downloads for DOCX', async () => {
  const word = await docx();
  assert.equal(documentType(word, 'application/octet-stream'), 'docx');
  assert.equal(documentType(pdfFixture(), 'application/octet-stream'), 'pdf');
  assert.equal(filenameFor('https://example.org/file', extractionContentType(word, 'application/octet-stream'), 0), 'pages/0001-example.org.docx');
  assert.equal(documentType(await docx([{ name: 'ppt/presentation.xml', data: '<presentation/>' }]), 'application/zip'), null);
  assert.equal(documentType(new TextEncoder().encode('<html>Login page</html>'), 'text/html'), null);
});

test('DOCX failures keep originals and exclude partial text: bad ZIP, excessive expansion, XML entities and malformed XML', async () => {
  const candidates = [new Uint8Array([1, 2, 3]), await docx([{ name: 'word/document.xml', data: 'x'.repeat(3 * 1024 * 1024 + 1) }]), await docx([{ name: 'word/document.xml', data: '<!DOCTYPE x [<!ENTITY e "bad">]>' + wordXML }]), await docx([{ name: 'word/document.xml', data: '<broken>' }])];
  for (const bytes of candidates) {
    const result = await extractDownloadedDocument(bytes, DOCX_MIME, options);
    assert.equal(result.status, 'failed'); assert.equal(result.included, false); assert.equal(result.text, '');
    assert.ok(result.warnings.includes('Original file retained.'));
  }
});

test('cancelled extraction and protected PDFs report a useful failure without including text', async () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = await extractDownloadedDocument(await docx(), DOCX_MIME, { ...options, signal: controller.signal });
  assert.equal(cancelled.status, 'failed'); assert.match(cancelled.warnings.join(' '), /cancelled/);
  const password = Object.assign(new Error('Password required'), { name: 'PasswordException' });
  const protectedResult = await extractDownloadedDocument(pdfFixture(), 'application/pdf', { loadPDF: async () => ({ version: PDFJS_VERSION, getDocument: () => ({ promise: Promise.reject(password), destroy: async () => {} }) }) });
  assert.equal(protectedResult.included, false); assert.match(protectedResult.warnings.join(' '), /Password-protected PDF/);
});

test('PDF spacing preserves adjacent glyph fragments and Unicode; only visible gaps add spaces', () => {
  const item = (str, x, width, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, x, 10], width, height: 10, hasEOL });
  assert.equal(pdfPageText([item('Hel', 0, 15), item('lo', 15, 10), item('world', 30, 25, true), item('中文', 0, 20)]), 'Hello world\n中文');
});


test('PDF document JavaScript is not executed during text extraction', async () => {
  globalThis.bootcatPDFScriptRan = false;
  try {
    const result = await extractDownloadedDocument(pdfFixture({ javascript: true }), 'application/pdf', options);
    assert.equal(result.status, 'ok', result.warnings.join(' '));
    assert.equal(globalThis.bootcatPDFScriptRan, false);
  } finally { delete globalThis.bootcatPDFScriptRan; }
});

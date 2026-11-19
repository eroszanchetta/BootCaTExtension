import { DEFAULT_SETTINGS } from './settings.js';
import { crc32 } from './zip.js';
// Bounded ZIP/XML reader for DOCX body text. Never renders document HTML.
const W = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XML_LIMIT = 50 * 1024 * 1024;
export const XML_NODE_LIMIT = 500_000;
export const DOCX_TEXT_LIMIT = DEFAULT_SETTINGS.docxCharacters;
export const ZIP_LIMIT = 250 * 1024 * 1024;
const abort = signal => { if (signal?.aborted) throw new DOMException('Extraction cancelled', 'AbortError'); };

export function zipDirectory(bytes) {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error('Password-protected DOCX or legacy Word binary file. Unlock or re-save as an unencrypted DOCX.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Invalid DOCX ZIP directory');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error('Multipart ZIP documents are unsupported');
  if (count === 65535 || size === 0xffffffff || start === 0xffffffff) throw new Error('ZIP64 documents are unsupported');
  if (count > 10000 || start + size > end) throw new Error('DOCX archive exceeds directory limits (10,000 entries)');
  const entries = new Map();
  let offset = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid DOCX ZIP entry');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), uncompressed = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    if (offset + 46 + length + extra + comment > start + size) throw new Error('Truncated DOCX ZIP entry');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + length));
    if (entries.has(name) || /(^|\/)\.\.(\/|$)|\\|^\//.test(name)) throw new Error('Invalid or duplicate DOCX ZIP path');
    if (flags & 1) throw new Error('Encrypted DOCX files are unsupported');
    expanded += uncompressed;
    if (expanded > ZIP_LIMIT) throw new Error('DOCX archive exceeds the 250 MiB expanded size limit');
    entries.set(name, { name, crc: view.getUint32(offset + 16, true), method, compressed, uncompressed, offset: view.getUint32(offset + 42, true), directoryStart: start });
    offset += 46 + length + extra + comment;
  }
  if (offset !== start + size) throw new Error('Invalid DOCX ZIP directory length');
  return entries;
}
export async function readEntry(bytes, entry, signal) {
  if (!entry) throw new Error('DOCX main document part was not found');
  if (entry.uncompressed > XML_LIMIT) throw new Error('DOCX XML exceeds the 50 MiB extraction limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = entry.offset;
  if (offset + 30 > entry.directoryStart || view.getUint32(offset, true) !== 0x04034b50) throw new Error('Invalid DOCX ZIP local header');
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  if (start + entry.compressed > entry.directoryStart) throw new Error('Truncated DOCX ZIP data');
  const compressed = bytes.subarray(start, start + entry.compressed);
  let output;
  abort(signal);
  if (entry.method === 0) output = compressed;
  else if (entry.method === 8) {
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const chunks = []; let size = 0;
      while (true) {
        abort(signal);
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > XML_LIMIT || size > entry.uncompressed) throw new Error('DOCX expanded XML exceeds its size limit');
        chunks.push(value);
      }
      output = new Uint8Array(size); let index = 0;
      for (const chunk of chunks) { output.set(chunk, index); index += chunk.length; }
    } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); }
  } else throw new Error('Unsupported DOCX ZIP compression');
  abort(signal);
  if (output.length !== entry.uncompressed) throw new Error('DOCX ZIP size mismatch');
  if (crc32(output) !== entry.crc) throw new Error('DOCX ZIP checksum mismatch');
  const encoding = output[0] === 0xff && output[1] === 0xfe ? 'utf-16le' : output[0] === 0xfe && output[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(output);
}
function defaultParseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Malformed DOCX XML');
  if (doc.getElementsByTagName('*').length > XML_NODE_LIMIT) throw new Error('DOCX XML exceeds 500,000 elements');
  return doc;
}
const word = (node, name) => node?.nodeType === 1 && W.has(node.namespaceURI) && node.localName === name;
const children = node => [...node.childNodes].filter(child => child.nodeType === 1);
function attribute(node, name) {
  for (const ns of W) { const value = node.getAttributeNS(ns, name); if (value !== null) return value; }
  return '';
}
function text(node, depth = 0) {
  if (depth > 256) throw new Error('DOCX XML nesting exceeds the 256-level limit');
  if (word(node, 'del') || word(node, 'instrText')) return '';
  if (word(node, 'r')) {
    const props = children(node).find(child => word(child, 'rPr'));
    if (props && children(props).some(child => word(child, 'vanish') && !['0', 'false', 'off'].includes(attribute(child, 'val')))) return '';
  }
  if (word(node, 't')) return node.textContent;
  if (word(node, 'tab')) return '\t';
  if (word(node, 'br') || word(node, 'cr')) return '\n';
  if (word(node, 'noBreakHyphen')) return '\u2011';
  return children(node).map(child => text(child, depth + 1)).join('');
}
function blocks(node, depth = 0) {
  if (depth > 256) throw new Error('DOCX XML nesting exceeds the 256-level limit');
  if (word(node, 'del')) return '';
  if (word(node, 'p')) return text(node) + '\n\n';
  if (word(node, 'tr')) return children(node).filter(child => word(child, 'tc')).map(child => blocks(child, depth + 1).trim()).join('\t') + '\n\n';
  return children(node).map(child => blocks(child, depth + 1)).join('');
}
export async function extractDOCX(bytes, { signal, parseXML = defaultParseXML } = {}) {
  const entries = zipDirectory(bytes);
  const parse = value => {
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('DOCX XML declarations with entities are unsupported');
    // Preflight before DOM allocation, then verify the actual element count in
    // the native parser. This also protects injected parsers used by tests.
    let nodes = 0;
    for (const match of value.matchAll(/<[A-Za-z_]/g)) {
      if (++nodes > XML_NODE_LIMIT) throw new Error('DOCX XML exceeds 500,000 elements');
    }
    return parseXML(value);
  };
  let main = 'word/document.xml';
  // Read the root relationship for packages using a non-default document path.
  if (entries.has('_rels/.rels')) {
    const root = parse(await readEntry(bytes, entries.get('_rels/.rels'), signal));
    const relationships = children(root.documentElement);
    const office = relationships.find(node => /\/officeDocument$/.test(node.getAttribute('Type') || ''));
    if (office) {
      if (office.getAttribute('TargetMode') === 'External') throw new Error('External DOCX document parts are unsupported');
      main = (office.getAttribute('Target') || '').replace(/^\//, '');
    }
  }
  const doc = parse(await readEntry(bytes, entries.get(main), signal));
  if (!word(doc.documentElement, 'document')) throw new Error('Not a Word DOCX document');
  const body = children(doc.documentElement).find(node => word(node, 'body'));
  if (!body) throw new Error('DOCX body was not found');
  return { text: blocks(body), warnings: ['DOCX body text only; headers, footers, comments, footnotes and endnotes are omitted. Review tables and text boxes.'] };
}

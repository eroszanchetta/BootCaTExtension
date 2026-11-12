import { FILE_LIMIT } from './core.js';
import { DOCX_MIME, zipDirectory, readEntry } from './docx.js';

export function hasPDFSignature(bytes) {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-');
}
// Recovery controls, picker filters and file validation share this registry.
// Register a new format here when its extractor becomes available.
export const DOCUMENT_FORMATS = [
  { id: 'pdf', label: 'PDF', mime: 'application/pdf', extensions: ['pdf'], matches: hasPDFSignature },
  { id: 'docx', label: 'DOCX', mime: DOCX_MIME, extensions: ['docx'], matches: async bytes => {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
    const entries = zipDirectory(bytes);
    if (entries.has('word/document.xml')) return true;
    // Also allow valid packages whose root relationship points at another path.
    if (!entries.has('_rels/.rels') || !entries.has('[Content_Types].xml')) return false;
    return (await readEntry(bytes, entries.get('[Content_Types].xml'))).toLowerCase().includes(DOCX_MIME + '.main+xml');
  } }
];
export const formatById = id => DOCUMENT_FORMATS.find(format => format.id === id) || null;
export const formatByMIME = type => DOCUMENT_FORMATS.find(format => format.mime === String(type || '').split(';')[0].trim().toLowerCase()) || null;
export const formatAccept = format => [...format.extensions.map(extension => `.${extension}`), format.mime].join(',');
function fromFilename(value) {
  try { value = decodeURIComponent(value); } catch {}
  return DOCUMENT_FORMATS.find(format => format.extensions.some(extension => value.toLowerCase().endsWith(`.${extension}`))) || null;
}
function fromURL(value) {
  try {
    const url = new URL(value), path = fromFilename(url.pathname);
    if (path) return path;
    for (const key of ['filename', 'file', 'download', 'name', 'document', 'path', 'url']) {
      const match = fromFilename(url.searchParams.get(key) || ''); if (match) return match;
    }
  } catch {}
  return null;
}
export function recoveryFormat(record) {
  return formatByMIME(record.contentType) || fromFilename(record.downloadName || '') || fromURL(record.finalURL) || fromURL(record.url);
}
export async function readDocumentFile(file, formatId, limit = FILE_LIMIT) {
  const format = formatById(formatId);
  if (!format) throw new Error('This document format is not supported for import.');
  if (!file || !file.size) throw new Error(`Choose a non-empty ${format.label} file.`);
  if (file.size > limit) throw new Error(`${format.label} exceeds the ${limit / 1024 / 1024} MiB file limit.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let matches;
  try { matches = await format.matches(bytes); }
  catch (error) { throw new Error(`Invalid ${format.label} file: ${error.message}`); }
  if (!matches) throw new Error(`This file does not contain a ${format.label}. Choose the document itself, rather than an HTML sign-in page, CAPTCHA or another file format.`);
  return bytes;
}

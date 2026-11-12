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
// Selected bytes, never URL extensions or response hints, determine recovery format.
export async function readImportedDocument(file, limit = FILE_LIMIT) {
  if (!file || !file.size) throw new Error('Choose a non-empty downloaded file.');
  if (file.size > limit) throw new Error(`File exceeds the ${limit / 1024 / 1024} MiB file limit.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (const format of DOCUMENT_FORMATS) {
    let matches;
    try { matches = await format.matches(bytes); }
    catch (error) { throw new Error(`Could not read the selected file: ${error.message}`); }
    if (matches) return { bytes, format };
  }
  throw new Error('Unsupported file contents. Choose the downloaded document itself, rather than a sign-in page or CAPTCHA. This version supports PDF and DOCX documents.');
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

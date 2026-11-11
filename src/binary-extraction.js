import { extractDOCX, DOCX_MIME, zipDirectory } from './docx.js';
import { extractDocument, normaliseText } from './extraction.js';
import { PDFJS_VERSION } from './pdfjs-version.js';
import { FILE_LIMIT } from './core.js';
import { formatPDFPage, PDF_TEXT_LIMIT } from './pdf-layout.js';
export { pdfPageText } from './pdf-layout.js';
export { PDFJS_VERSION } from './pdfjs-version.js';
export const TEXT_LIMIT = PDF_TEXT_LIMIT;
const GENERIC = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/zip']);
export function documentType(bytes, contentType) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) return 'pdf';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === DOCX_MIME) return 'docx';
  // Content sniffing helps servers that send downloads as application/octet-stream.
  // A ZIP alone is not enough: do not mistake PPTX, ODT or arbitrary archives for Word.
  if (GENERIC.has(mime) && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try { if (zipDirectory(bytes).has('word/document.xml')) return 'docx'; } catch {}
  }
  return null;
}
export const extractionContentType = (bytes, type) => {
  const format = documentType(bytes, type);
  return format === 'pdf' ? 'application/pdf' : format === 'docx' ? DOCX_MIME : type;
};
function abortable(promise, signal) {
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function extractPDF(bytes, { signal, loadPDF = () => import('./vendor/pdfjs/pdf.mjs') }) {
  const pdfjs = await abortable(loadPDF(), signal);
  if (pdfjs.version !== PDFJS_VERSION) throw new Error(`PDF.js version mismatch: expected ${PDFJS_VERSION}, loaded ${pdfjs.version || 'unknown'}. Rebuild and reload the extension.`);
  let port, worker, task;
  try {
    if (typeof Worker === 'function') {
      // Pass a real local worker explicitly: extension URL origins must not trigger
      // PDF.js's cross-origin blob-worker fallback under Manifest V3 CSP.
      port = new Worker(new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url), { type: 'module' });
      worker = new pdfjs.PDFWorker({ port });
    }
    task = pdfjs.getDocument({
      data: bytes.slice(), worker,
      useWasm: false, disableFontFace: true, useSystemFonts: false,
      useWorkerFetch: false, verbosity: 0,
      cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href
    });
    const doc = await abortable(task.promise, signal);
    if (doc.numPages > 300) throw new Error('PDF exceeds the 300-page extraction limit');
    const pages = [], rawPages = [], pageMetadata = []; let characters = 0, joinedLines = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await abortable(doc.getPage(pageNumber), signal);
      try {
        const content = await abortable(page.getTextContent(), signal);
        const formatted = formatPDFPage(content.items), { text, rawText } = formatted;
        characters += Math.max(text.length, rawText.length); joinedLines += formatted.joinedLines;
        if (characters > TEXT_LIMIT) throw new Error('PDF text exceeds the 2 million character limit');
        pages.push(text); rawPages.push(rawText); pageMetadata.push({ page: pageNumber, characters: Array.from(text).length, rawCharacters: Array.from(rawText).length, joinedLines: formatted.joinedLines });
      } finally { page.cleanup(); }
    }
    const metadata = await abortable(doc.getMetadata(), signal);
    const empty = pageMetadata.filter(page => !page.characters).length;
    return {
      text: pages.join('\n\n'), rawText: rawPages.join('\n\n'),
      formatting: { version: '1', rules: ['normalize-whitespace', 'join-wrapped-lines'], joinedLines, hyphenation: 'preserved' },
      title: String(metadata.info?.Title || ''),
      pageCount: doc.numPages, pages: pageMetadata,
      warnings: empty ? [`${empty} page(s) contain no extractable text; scans may require OCR.`] : []
    };
  } finally {
    if (task) {
      const cleanup = task.destroy();
      if (signal.aborted) cleanup.catch(() => {}); else await cleanup;
    }
    worker?.destroy(); port?.terminate();
  }
}
export async function extractDownloadedDocument(bytes, contentType, options = {}) {
  const format = documentType(bytes, contentType);
  if (!format) return extractDocument(bytes, contentType, options);
  const meta = {
    status: 'failed', extractor: format === 'pdf' ? 'pdfjs' : 'bootcat-docx',
    extractorVersion: format === 'pdf' ? PDFJS_VERSION : '1', format,
    encoding: 'unicode', title: '', language: '', characters: 0, included: false, warnings: [], text: ''
  };
  const inputLimit = FILE_LIMIT;
  if (bytes.length > inputLimit) return { ...meta, warnings: [`Document exceeds the ${inputLimit / 1024 / 1024} MiB extraction limit. Original file retained.`] };
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  try {
    signal.throwIfAborted();
    const result = await abortable(format === 'pdf' ? extractPDF(bytes, { ...options, signal }) : extractDOCX(bytes, { ...options, signal }), signal);
    meta.warnings.push(...result.warnings);
    const text = normaliseText(result.text);
    if (!text) throw new Error(format === 'pdf' ? 'No extractable text found. Scanned PDFs may require OCR.' : 'No usable body text was found in this DOCX document.');
    if (text.length > TEXT_LIMIT) throw new Error('Document text exceeds the 2 million character limit');
    return { ...meta, ...result, text, status: 'ok', included: true, characters: Array.from(text).length };
  } catch (error) {
    const message = error.name === 'PasswordException' ? 'Password-protected PDF. Unlock it before importing; password entry is not supported yet.'
      : signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'Document extraction timed out after 30 seconds.' : 'Document extraction cancelled.')
      : `Document extraction failed: ${error.message}`;
    return { ...meta, warnings: [...meta.warnings, message, 'Original file retained.'] };
  }
}

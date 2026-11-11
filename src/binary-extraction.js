import { extractDOCX, DOCX_MIME, zipDirectory } from './docx.js';
import { extractDocument, normaliseText } from './extraction.js';
import { PDFJS_VERSION } from './pdfjs-version.js';
export { PDFJS_VERSION } from './pdfjs-version.js';
export const TEXT_LIMIT = 2_000_000;
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
export function pdfPageText(items) {
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
    if (length > TEXT_LIMIT) throw new Error('PDF text exceeds the 2 million character limit');
    previous = item;
    if (item.hasEOL) { parts.push('\n'); previous = null; }
  }
  return normaliseText(parts.join(''));
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
    const pages = [], pageMetadata = []; let characters = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await abortable(doc.getPage(pageNumber), signal);
      try {
        const content = await abortable(page.getTextContent(), signal);
        const text = pdfPageText(content.items);
        characters += text.length;
        if (characters > TEXT_LIMIT) throw new Error('PDF text exceeds the 2 million character limit');
        pages.push(text); pageMetadata.push({ page: pageNumber, characters: Array.from(text).length });
      } finally { page.cleanup(); }
    }
    const metadata = await abortable(doc.getMetadata(), signal);
    const empty = pageMetadata.filter(page => !page.characters).length;
    return {
      text: pages.join('\n\n'), title: String(metadata.info?.Title || ''),
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
  if (bytes.length > 10 * 1024 * 1024) return { ...meta, warnings: ['Document exceeds the 10 MiB extraction limit. Original file retained.'] };
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

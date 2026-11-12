import { fetchFile, FILE_LIMIT, PDF_IMPORT_LIMIT } from './core.js';
import { captureCurrentPage } from './page-capture.js';
import { hasPDFSignature, readDocumentFile } from './document-formats.js';
export { hasPDFSignature } from './document-formats.js';

export const PDF_REVIEW_NOTICE = 'PDF reading order, columns, headers and line breaks may need review. OCR is not performed.';
// Also hide the generic warning in projects saved by older versions.
export const fileWarnings = extraction => extraction.warnings.filter(warning => warning !== PDF_REVIEW_NOTICE);
function webURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Open an HTTP or HTTPS page without URL credentials first.');
  url.hash = ''; return url.href;
}
export const readPDFFile = (file, limit = PDF_IMPORT_LIMIT) => readDocumentFile(file, 'pdf', limit);
export async function captureTabDocument(tab, scripting) {
  const url = webURL(tab.url);
  let pdfURL = url;
  if (!/\.pdf$/i.test(new URL(url).pathname)) {
    let page;
    try { page = (await scripting.executeScript({ target: { tabId: tab.id }, func: captureCurrentPage }))[0]?.result; }
    catch { /* Built-in PDF viewers reject script injection. Retry as a PDF below. */ }
    if (page?.error) throw new Error(page.error);
    if (page && !page.pdf) return page;
    if (page?.pdf) pdfURL = webURL(page.url);
  }
  try {
    // This is an explicit user action. Ordinary batch downloads still omit cookies.
    // Re-fetching may reuse login/CAPTCHA cookies, but cannot read viewer memory.
    const response = await fetchFile(pdfURL, AbortSignal.timeout(30000), FILE_LIMIT, { credentials: 'include' });
    if (!hasPDFSignature(response.bytes)) throw new Error('The server returned a page instead of a PDF');
    return {
      kind: 'pdf', url: pdfURL, finalURL: response.finalURL || pdfURL,
      blob: new Blob([response.bytes], { type: 'application/pdf' }),
      title: tab.title || '', source: 'browser-session', capturedAt: new Date().toISOString()
    };
  } catch (error) {
    throw new Error(`Could not retrieve a PDF using this browser session. If a PDF is open, download it using the browser viewer, then use Choose downloaded PDF beside its failed URL in BootCaT. (${error.message})`);
  }
}

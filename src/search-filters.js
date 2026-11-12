import { DOCUMENT_FORMATS } from './document-formats.js';
export const SEARCH_FILE_TYPES = DOCUMENT_FORMATS.map(format => ({ id: format.id, label: format.label, extension: format.extensions[0] }));
export const DEFAULT_EXCLUDED_SITES = Object.freeze(['youtube.com', 'facebook.com', 'instagram.com', 'amazon.com']);
export function normalizeExcludedSites(value) {
  const lines = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  const sites = new Set();
  for (const entry of lines) {
    const raw = String(entry).trim(); if (!raw) continue;
    try {
      if (/\s|^[-*!]/.test(raw)) throw new Error();
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
      const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !domain.includes('.') || !domain.split('.').every(part => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part))) throw new Error();
      sites.add(domain);
    } catch { throw new Error(`Invalid excluded website: ${raw}. Enter a domain or an HTTP(S) website URL, one per line.`); }
  }
  return [...sites];
}
export function normalizeSearchFilters({ fileType = '', excludedSites = [] } = {}) {
  if (fileType && !SEARCH_FILE_TYPES.some(format => format.id === fileType)) throw new Error('Choose No restriction or a supported document format.');
  return { fileType, excludedSites: normalizeExcludedSites(excludedSites) };
}
export function compileSearchQuery(query, filters, syntax) {
  const { fileType, excludedSites } = normalizeSearchFilters(filters);
  const extension = SEARCH_FILE_TYPES.find(format => format.id === fileType)?.extension;
  return [query.trim(), ...(extension ? [syntax.fileType + extension] : []), ...excludedSites.map(domain => syntax.excludeSite + domain)].filter(Boolean).join(' ');
}

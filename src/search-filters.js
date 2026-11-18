import { DOCUMENT_FORMATS } from './document-formats.js';
export const SEARCH_FILE_TYPES = DOCUMENT_FORMATS.map(format => ({ id: format.id, label: format.label, extension: format.extensions[0] }));
export const DEFAULT_EXCLUDED_SITES = Object.freeze(['youtube.com', 'facebook.com', 'instagram.com', 'amazon.com']);
function invalidFilter(field, message) { return Object.assign(new Error(message), { field }); }
function normalizeDomain(raw) {
  if (/\s|^[-*!]/.test(raw)) throw new Error();
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !domain.includes('.') || !domain.split('.').every(part => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part))) throw new Error();
  return domain;
}
export function normalizeSearchSite(value = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try { return normalizeDomain(raw); }
  catch { throw invalidFilter('site', `Invalid search website: ${raw}. Enter one domain or an HTTP(S) website URL, or leave it blank.`); }
}
export function normalizeExcludedSites(value) {
  const lines = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  const sites = new Set();
  for (const entry of lines) {
    const raw = String(entry).trim(); if (!raw) continue;
    try { sites.add(normalizeDomain(raw)); }
    catch { throw invalidFilter('excludedSites', `Invalid excluded website: ${raw}. Enter a domain or an HTTP(S) website URL, one per line.`); }
  }
  return [...sites];
}
export function normalizeSearchFilters({ fileType = '', site = '', excludedSites = [] } = {}) {
  if (fileType && !SEARCH_FILE_TYPES.some(format => format.id === fileType)) throw invalidFilter('fileType', 'Choose No restriction or a supported document format.');
  const filters = { fileType, site: normalizeSearchSite(site), excludedSites: normalizeExcludedSites(excludedSites) };
  const conflict = filters.site && filters.excludedSites.find(domain => filters.site === domain || filters.site.endsWith(`.${domain}`));
  if (conflict) throw invalidFilter('site', `The search site is excluded by ${conflict}. Remove that exclusion or choose another site.`);
  return filters;
}
export function compileSearchQuery(query, filters, syntax) {
  const { fileType, site, excludedSites } = normalizeSearchFilters(filters);
  const extension = SEARCH_FILE_TYPES.find(format => format.id === fileType)?.extension;
  return [query.trim(), ...(extension ? [syntax.fileType + extension] : []), ...(site ? [syntax.includeSite + site] : []), ...excludedSites.map(domain => syntax.excludeSite + domain)].filter(Boolean).join(' ');
}

import { DEFAULT_SETTINGS } from './settings.js';
import { defuddleConstructor, DEFUDDLE_VERSION } from './defuddle-loader.js';
// Extraction adapters are independent of URL collection and downloads.
export const EXTRACTOR_ID = 'mozilla-readability';
export const EXTRACTOR_VERSION = '0.6.0';
export const EXTRACTION_LIMIT = DEFAULT_SETTINGS.htmlMiB * 1024 * 1024;

export function decodeResponse(bytes, contentType) {
  const warnings = [];
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const html = ['text/html', 'application/xhtml+xml'].includes(mime);
  // WHATWG-compatible precedence: BOM, HTTP charset, HTML meta, UTF-8.
  let label = '';
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = 'utf-8';
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  const http = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
  if (!label && http) label = http;
  if (!label && html) {
    // Tags are ASCII in ordinary single-byte encodings. Ignore commented-out tags.
    const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096)).replace(/<!--[\s\S]*?-->/g, '');
    for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
      label = tag.match(/charset\s*=\s*["']?([^\s;"'/>]+)/i)?.[1] || '';
      if (label) break;
    }
  }
  if (!label) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); label = 'utf-8'; }
    catch { label = 'windows-1252'; warnings.push('No charset declared; guessed Windows-1252 because the bytes are not valid UTF-8. Check accented characters.'); }
  }
  let decoder;
  try { decoder = new TextDecoder(label); }
  catch { decoder = new TextDecoder('utf-8'); warnings.push(`Unsupported declared charset ${label}; used UTF-8. Check the preview.`); }
  const text = decoder.decode(bytes);
  if (text.includes('\ufffd')) warnings.push('Decoded text contains replacement characters. The source encoding may be incorrect.');
  return { text, encoding: decoder.encoding, warnings };
}

export function normaliseText(text) {
  // Do not lowercase, tokenize, stem, dehyphenate or alter spelling/punctuation.
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n').map(line => line.replace(/[\t ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export function contentToText(root) {
  const blocks = new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','CAPTION','DD','DETAILS','DIV','DL','DT','FIGCAPTION','FIGURE','FOOTER','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','OL','P','PRE','SECTION','TABLE','TR','UL']);
  const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','IFRAME','OBJECT','EMBED','SVG','MATH']);
  const parts = [];
  function walk(node) {
    if (node.nodeType === 3) { parts.push(node.nodeValue || ''); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (skip.has(tag) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) return;
    if (tag === 'BR') { parts.push('\n'); return; }
    if (blocks.has(tag)) parts.push('\n\n');
    if (tag === 'TD' || tag === 'TH') parts.push('\t');
    for (const child of node.childNodes) walk(child);
    if (tag === 'TD' || tag === 'TH') parts.push('\t');
    if (blocks.has(tag)) parts.push('\n\n');
  }
  walk(root);
  return normaliseText(parts.join(''));
}

export function extractDocument(bytes, contentType, {
  parseHTML = text => new DOMParser().parseFromString(text, 'text/html'),
  ReadabilityClass = globalThis.Readability,
  DefuddleClass = defuddleConstructor(),
  extractor = 'readability',
  settings = DEFAULT_SETTINGS,
  sourceURL = ''
} = {}) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const plain = mime === 'text/plain';
  const html = ['text/html', 'application/xhtml+xml'].includes(mime);
  const useDefuddle = extractor === 'defuddle';
  const meta = { status: 'unsupported', extractor: html ? (useDefuddle ? 'defuddle' : EXTRACTOR_ID) : plain ? 'plain-text' : null, extractorVersion: html ? (useDefuddle ? DEFUDDLE_VERSION : EXTRACTOR_VERSION) : plain ? '1' : null, encoding: null, title: '', language: '', characters: 0, included: false, warnings: [] };
  if (!plain && !html) return { text: '', ...meta, warnings: ['No text extraction for this content type yet. Original file retained.'] };
  if (bytes.length > settings.htmlMiB * 1024 * 1024) return { text: '', ...meta, status: 'failed', warnings: [`Response exceeds the ${settings.htmlMiB} MiB extraction limit. Original file retained.`] };
  try {
    if (!['readability', 'defuddle'].includes(extractor)) throw new Error('Unknown text extractor');
    const decoded = decodeResponse(bytes, contentType);
    meta.encoding = decoded.encoding; meta.warnings.push(...decoded.warnings);
    let text;
    if (plain) text = normaliseText(decoded.text);
    else {
      if (typeof (useDefuddle ? DefuddleClass : ReadabilityClass) !== 'function') throw new Error(useDefuddle ? 'Bundled Defuddle library did not load' : 'Bundled Readability library did not load');
      const doc = parseHTML(decoded.text);
      // This detached document is never inserted into the extension page.
      // Resource loading is additionally blocked by the workspace CSP.
      for (const node of doc.querySelectorAll('script:not([type="application/ld+json"]), style, iframe, object, embed, template, noscript, link, base, [hidden], [aria-hidden="true"]')) node.remove();
      // Defuddle receives the source URL explicitly: detached documents have no
      // useful website base URI. Do not use parseAsync or request remote data.
      if (useDefuddle && doc.getElementsByTagName('*').length > settings.htmlElements) throw new Error(`Page exceeds the ${settings.htmlElements.toLocaleString()}-element extraction limit`);
      const article = useDefuddle
        ? new DefuddleClass(doc, { url: sourceURL || undefined, markdown: false, fetch: () => { throw new Error('Additional network requests are disabled during text extraction'); } }).parse()
        : new ReadabilityClass(doc, { maxElemsToParse: settings.htmlElements, charThreshold: 500, serializer: element => element }).parse();
      if (!article?.content) throw new Error(`${useDefuddle ? 'Defuddle' : 'Readability'} did not find main content`);
      // Readability returns a DOM node through our serializer; Defuddle returns
      // cleaned HTML, which stays detached and is never rendered in the UI.
      const content = useDefuddle ? parseHTML(article.content).body : article.content;
      text = contentToText(content);
      meta.title = article.title || ''; meta.language = article.lang || article.language || '';
      meta.byline = article.byline || article.author || ''; meta.publishedTime = article.publishedTime || article.published || null;
    }
    if (!text) throw new Error('No usable text was extracted');
    meta.characters = Array.from(text).length;
    if (meta.characters < 200) meta.warnings.push('Very little text extracted (under 200 characters). Review before including.');
    const challenge = /^(access denied|just a moment|verify (?:that )?you are human|attention required|403 forbidden|sign in|log in)(\b|[.!])/i.test(meta.title.trim());
    if (challenge) meta.warnings.push('The page title resembles a login or access-check screen. Excluded by default; inspect the preview.');
    return { ...meta, text, status: 'ok', included: !challenge };
  } catch (error) {
    return { text: '', ...meta, status: 'failed', warnings: [...meta.warnings, error.message] };
  }
}

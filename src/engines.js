import { SEARCH_ENGINE_NAMES } from './search-engine-options.js';
import { compileSearchQuery } from './search-filters.js';
// Provider-specific DOM knowledge lives here, not in the downloader.
// Selectors are heuristics, not a guaranteed search-engine interface.
export const ENGINES = [
  { id: "google", name: SEARCH_ENGINE_NAMES.google, searchURL: "https://www.google.com/search", queryParam: "q", querySyntax: { fileType: "filetype:", includeSite: "site:", excludeSite: "-site:" }, selectors: ["#search a:has(h3)", "#rso a:has(h3)", "#search h3 a"], titleSelector: "h3", experimental: false },
  { id: "duckduckgo", name: SEARCH_ENGINE_NAMES.duckduckgo, searchURL: "https://duckduckgo.com/", queryParam: "q", querySyntax: { fileType: "filetype:", includeSite: "site:", excludeSite: "-site:" }, selectors: ['a[data-testid="result-title-a"]', "a.result__a"], titleSelector: null, experimental: false },
  { id: "ecosia", name: SEARCH_ENGINE_NAMES.ecosia, searchURL: "https://www.ecosia.org/search", queryParam: "q", querySyntax: { fileType: "filetype:", includeSite: "site:", excludeSite: "-site:" }, selectors: ['a[data-test-id="result-link"]', "a.result-title", "a.result__link"], titleSelector: null, experimental: false }
];
export function adapterForURL(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, "");
    let id;
    if (/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && url.pathname === "/search" && !url.searchParams.has("tbm") && (!url.searchParams.has("udm") || url.searchParams.get("udm") === "14")) id = "google";
    if ((host === "duckduckgo.com" || host === "html.duckduckgo.com") && ["/", "/html/", "/html"].includes(url.pathname) && (!url.searchParams.has("ia") || url.searchParams.get("ia") === "web") && !url.searchParams.has("iax")) id = "duckduckgo";
    if (host === "ecosia.org" && url.pathname === "/search") id = "ecosia";
    if (!id || !url.searchParams.get("q")) return null;
    return ENGINES.find(engine => engine.id === id);
  } catch { return null; }
}
export function searchURL(engineID, query, languageFilter = '') {
  const engine = ENGINES.find(item => item.id === engineID);
  if (!engine) throw new Error("Unknown search engine");
  const url = new URL(engine.searchURL);
  url.searchParams.set(engine.queryParam, query);
  if (engineID === 'google' && languageFilter) url.searchParams.set('lr', languageFilter);
  return url.href;
}
// All query modifiers are provider concerns; collected URLs are never filtered.
export function buildSearchQuery(engineID, query, filters) {
  const engine = ENGINES.find(item => item.id === engineID);
  if (!engine) throw new Error('Unknown search engine');
  return compileSearchQuery(query, filters, engine.querySyntax);
}
// Chrome copies this function into the tab's isolated world. It must be
// self-contained: imports and outer variables are NOT copied with it.
export function extractResults(adapter) {
  const page = new URL(location.href);
  const host = page.hostname.replace(/^www\./, "");
  const expectedHost = adapter.id === "google" ? /^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)
    : adapter.id === "duckduckgo" ? /^(html\.)?duckduckgo\.com$/.test(host) : host === "ecosia.org";
  if (!expectedHost) return { error: "The tab changed. Open web search results and try again." };
  const visibleResults = [...document.querySelectorAll(adapter.selectors.join(','))].filter(anchor => anchor.getClientRects().length && !anchor.closest('[hidden], [aria-hidden="true"], [data-text-ad], [data-ad], [data-testid*="ad-result"], [data-testid="ad"], [data-test-id="mainline-result-ad"], .result--ad, .result--advertisement, #tads, #bottomads'));
  const challengeForm = document.querySelector?.('#challenge-form, #challenge-running, #cf-challenge-running, form[action*="/sorry/"]');
  const challengeResource = document.querySelector?.('script[src*="/cdn-cgi/challenge-platform/"], iframe[src*="challenges.cloudflare.com"]');
  const challengeTitle = /just a moment|attention required|verify.*human|checking.*browser|security verification/i.test(document.title || '');
  let unreadableGoogle = 0;
  function owned(url) {
    const h = url.hostname;
    if (adapter.id === "google") return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h) || /(^|\.)(googleadservices\.com|googlesyndication\.com)$/.test(h);
    const domain = adapter.id === "duckduckgo" ? "duckduckgo.com" : "ecosia.org";
    return h === domain || h.endsWith(`.${domain}`);
  }
  function contentURL(url) {
    return adapter.id === 'google' && /^books\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(url.hostname) && url.pathname === '/books' && !!url.searchParams.get('id');
  }
  function destination(raw) {
    let url;
    try { url = new URL(raw, page); } catch { return null; }
    // Decode explicit destination parameters on known provider redirects only.
    // Opaque tokens are reported, never guessed or followed in background.
    if (owned(url) && !contentURL(url)) {
      let target;
      if (adapter.id === "google" && url.pathname === "/url") target = url.searchParams.get("q") || url.searchParams.get("url");
      if (adapter.id === "duckduckgo" && url.pathname.startsWith("/l/")) target = url.searchParams.get("uddg");
      if (adapter.id === "ecosia" && ["/redirect", "/url"].includes(url.pathname)) target = url.searchParams.get("url");
      if (!target) { if (adapter.id === 'google' && url.pathname === '/url') unreadableGoogle++; return null; }
      try { url = new URL(target); } catch { if (adapter.id === 'google') unreadableGoogle++; return null; }
      if (adapter.id === 'google' && ((owned(url) && !contentURL(url)) || !['http:', 'https:'].includes(url.protocol))) { unreadableGoogle++; return null; }
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || (owned(url) && !contentURL(url))) return null;
    url.hash = "";
    return url.href;
  }
  const seen = new Set(), results = [];
  let unresolved = 0, candidates = 0;
  const candidateDiagnostics = [];
  function diagnose(anchor, outcome, reason) {
    // Keep bounded, inspectable evidence locally; never retain credentials.
    let href = anchor.getAttribute('href') || '';
    try { const url = new URL(href, page); if (url.username || url.password) href = '[credentials removed]'; } catch {}
    if (candidateDiagnostics.length >= 200) return;
    candidateDiagnostics.push({ position: candidates, href: href.slice(0, 2000), outcome, reason });
  }
  // A combined selector preserves DOM order and matches each anchor once.
  for (const anchor of visibleResults) {
    if (!anchor.getClientRects().length || anchor.closest('[hidden], [aria-hidden="true"], [data-text-ad], [data-ad], [data-testid*="ad-result"], [data-testid="ad"], [data-test-id="mainline-result-ad"], .result--ad, .result--advertisement, #tads, #bottomads')) continue;
    // Live DDG Related Searches reuse the legacy result__a class. Exclude
    // only the observed widget, not every provider-owned/unreadable candidate.
    if (adapter.id === 'duckduckgo' && anchor.closest('.related-searches, .related-searches__item')) {
      diagnose(anchor, 'ignored', 'related-search'); continue;
    }
    candidates++;
    const url = destination(anchor.getAttribute("href"));
    if (!url) {
      let internal = false; try { const candidate = new URL(anchor.getAttribute('href'), page); internal = adapter.id === 'google' && owned(candidate) && candidate.pathname !== '/url' && !contentURL(candidate); } catch {}
      if (!internal) unresolved++;
      diagnose(anchor, internal ? 'ignored' : 'unresolved', internal ? 'provider-navigation' : 'unreadable-destination'); continue;
    }
    if (seen.has(url)) { diagnose(anchor, 'duplicate', 'same-destination'); continue; }
    seen.add(url);
    const titleNode = adapter.titleSelector ? anchor.querySelector(adapter.titleSelector) : anchor;
    results.push({ url, title: (titleNode?.textContent || anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500), positionOnPage: candidates });
    if (results.length >= 200) break;
  }
  const diagnostics = candidateDiagnostics.slice(0, 200);
  const resultSetKey = JSON.stringify([results.map(item => item.url), unresolved,
    candidateDiagnostics.filter(item => item.outcome === 'unresolved').map(item => item.href)]);
  if (!results.length && (challengeForm || (challengeTitle && challengeResource))) return { engine: adapter.id, pageURL: page.href, results: [], unresolved: 0, challenge: true };
  return { engine: adapter.id, adapterVersion: 2, resultSetKey, candidateDiagnostics: diagnostics, query: page.searchParams.get(adapter.queryParam) || "", pageURL: page.href, results, unresolved, ...(unreadableGoogle ? { unreadableGoogle } : {}) };
}

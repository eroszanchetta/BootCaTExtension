import { compileSearchQuery } from './search-filters.js';
// Provider-specific DOM knowledge lives here, not in the downloader.
// Selectors are heuristics, not a guaranteed search-engine interface.
export const ENGINES = [
  { id: "google", name: "Google", searchURL: "https://www.google.com/search", queryParam: "q", querySyntax: { fileType: "filetype:", includeSite: "site:", excludeSite: "-site:" }, selectors: ["#search a:has(h3)", "#rso a:has(h3)", "#search h3 a"], titleSelector: "h3", experimental: false },
  { id: "duckduckgo", name: "DuckDuckGo", searchURL: "https://duckduckgo.com/", queryParam: "q", querySyntax: { fileType: "filetype:", includeSite: "site:", excludeSite: "-site:" }, selectors: ['a[data-testid="result-title-a"]', "a.result__a"], titleSelector: null, experimental: false },
  { id: "ecosia", name: "Ecosia", searchURL: "https://www.ecosia.org/search", queryParam: "q", querySyntax: { fileType: "filetype:", includeSite: "site:", excludeSite: "-site:" }, selectors: ['a[data-test-id="result-link"]', "a.result-title", "a.result__link"], titleSelector: null, experimental: false }
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
  function owned(url) {
    const h = url.hostname;
    if (adapter.id === "google") return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h) || /(^|\.)(googleadservices\.com|googlesyndication\.com)$/.test(h);
    const domain = adapter.id === "duckduckgo" ? "duckduckgo.com" : "ecosia.org";
    return h === domain || h.endsWith(`.${domain}`);
  }
  function destination(raw) {
    let url;
    try { url = new URL(raw, page); } catch { return null; }
    // Decode explicit destination parameters on known provider redirects only.
    // Opaque tokens are reported, never guessed or followed in background.
    if (owned(url)) {
      let target;
      if (adapter.id === "google" && url.pathname === "/url") target = url.searchParams.get("q") || url.searchParams.get("url");
      if (adapter.id === "duckduckgo" && url.pathname.startsWith("/l/")) target = url.searchParams.get("uddg");
      if (adapter.id === "ecosia" && ["/redirect", "/url"].includes(url.pathname)) target = url.searchParams.get("url");
      if (!target) return null;
      try { url = new URL(target); } catch { return null; }
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || owned(url)) return null;
    url.hash = "";
    return url.href;
  }
  const seen = new Set(), results = [];
  let unresolved = 0, candidates = 0;
  // A combined selector preserves DOM order and matches each anchor once.
  for (const anchor of document.querySelectorAll(adapter.selectors.join(","))) {
    if (!anchor.getClientRects().length || anchor.closest('[hidden], [aria-hidden="true"], [data-text-ad], [data-ad], [data-testid*="ad-result"], [data-testid="ad"], [data-test-id="mainline-result-ad"], .result--ad, .result--advertisement, #tads, #bottomads')) continue;
    candidates++;
    const url = destination(anchor.getAttribute("href"));
    if (!url) { unresolved++; continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    const titleNode = adapter.titleSelector ? anchor.querySelector(adapter.titleSelector) : anchor;
    results.push({ url, title: (titleNode?.textContent || anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500), positionOnPage: candidates });
    if (results.length >= 200) break;
  }
  return { engine: adapter.id, adapterVersion: 1, query: page.searchParams.get(adapter.queryParam) || "", pageURL: page.href, results, unresolved };
}

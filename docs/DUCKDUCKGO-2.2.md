# DuckDuckGo investigation for 2.2

## Observed evidence

On 26 November 2026, inspected the populated live page at <https://duckduckgo.com/?q=sepalo+stame+petalo&ia=web> in the connected browser. Ten visible `a[data-testid="result-title-a"]` anchors pointed directly to documents. Two additional visible `a.result__a` anchors were inside `.related-searches__item` / `.related-searches` and pointed to `?q=sepalo%20wikipedia&origin=related` and `?q=que%20es%20el%20sepalo&origin=related`. The old combined selector included all twelve; the two related queries could not resolve to documents and made the collection partial. This is a present-day reproduction of a false partial collection, not proof of the historical eight unidentified Fiori candidates.

Clicked More results: the readable document-title count rose from 10 to 25, while the full URL stayed unchanged. This establishes that page URL alone cannot identify a collected DDG result set.

`tests/fixtures/duckduckgo-populated.html` is a manually minimized populated-DOM excerpt preserving observed destinations, selectors and related-search ancestry. It omits page assets, scripts, snippets and tracking attributes, shortens titles and is not an exact full-page snapshot. Additional invalid, appended, ad/hidden and legacy-link cases are explicit synthetic regression fixtures. Automated checks never contact real engines.

## Changes and boundaries

- Ignore only the observed Related Searches widget. Unknown provider-owned result candidates and unreadable redirect tokens still require review; they are not silently treated as navigation.
- Store bounded `candidateDiagnostics` on each collection (up to 200 excluded, duplicate or unresolved candidate entries, with position, href, outcome and reason). Credential-bearing addresses are redacted, hrefs capped at 2,000 characters, and diagnostics stay in project metadata, including portable projects. No telemetry or new permission. They can support diagnosis if a different false partial collection recurs.
- Compare the full page URL except its fragment and an ordered `resultSetKey` for DDG saved state. The key includes readable destination URLs and unresolved candidate evidence, not titles or snippets. Appending documents at the same URL exposes collection again; pagination and filter parameters stay distinct. This does not change the query-level historical badge, which records prior collection work.
- Pre-2.2 DDG collections lack result-set metadata. Their saved URLs stay intact; the current page can be collected again to establish its identity. Partial acceptance continues to apply to a saved snapshot only.
- Floating controls watch DOM/URL changes with a coalesced check, refresh on return to a page, and remount if the host is removed. Closed-shadow isolation, explicit opt-in, project gating, partial-result review and manual actions remain.
- Recheck DDG results before closing after a successful collection; changed or unreadable pages stay open with feedback. Saving, result inspection and closing are separate browser operations, so a change at the exact instant of closure cannot be made atomic.

The exact originally reported intermittent absence was not reproduced in a user's Chrome/Firefox installation. Host removal and same-URL result changes are reproducible lifecycle gaps covered by automated regressions. No blanket claim that every DDG layout or third-party page mutation is handled.

## Verification

Run Node tests, both browser packages and release verification, then Playwright native DOM replay in Chromium/Firefox, the full Chromium extension workflow, and cross-browser portable-project checks in GitHub CI. Local Playwright launch remains blocked in this environment; connected-browser inspection supplied the live evidence.

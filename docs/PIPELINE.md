# Collection and extraction details

These notes describe the shared implementation in `src/`. Build/install instructions are in the repository README.

## What is saved?

Search collections persist locally in this extension's Chrome profile, across workspace reloads and browser restarts. They are not synced to an external service. A collection records:

- Engine and adapter version.
- Query, full results-page URL and collection time.
- Result URL, title and candidate position within that loaded page.
- Number of candidate links whose destinations could not be resolved.

Result positions describe extraction order on the page, not absolute rankings across pagination. They can contain gaps when candidates were duplicated or skipped. Selectors attempt to exclude common ad containers, but result filtering is heuristic: review the URL list.

The same URL found by multiple engines/queries appears once in the unique-URL preview while retaining all source occurrences. Recollecting the exact same engine/page URL replaces its previous snapshot. Different pages and queries are kept separately. There is a limit of 100 saved pages / 5,000 result occurrences, and at most 200 usable results per collection. The preview displays the first 200 unique URLs; exports contain all saved records. Download batches remain limited to 500 unique URLs, so larger collections need manual selection.

**Export searches JSON** saves both the original collections and a merged list with provenance, without downloading the linked pages. **Clear searches** asks for confirmation and clears saved collection metadata only; URLs already added to the download list remain there. Uninstalling the extension removes its stored collections. JSON export is a backup for inspection/reuse; this version does not yet import backups.

The download ZIP contains:

- `pages/`: original successful response bodies, with numbered, safe filenames.
- `corpus/`: selected extracted texts, one UTF-8 `.txt` file per document. There are no source headers or metadata injected into the text.
- `results.json`: download outcomes, final response URLs, content types and errors.
- `extraction.json`: extraction status, extractor/version, input encoding, title, language if reported, character count, warnings and inclusion decisions. Metadata contains no duplicate full text.
- `searches.json`: a snapshot of all saved collections when the batch started, including any results you subsequently excluded from the download list. Match source URLs to `results.json` when analysing provenance.

Downloaded file bodies, extracted texts, inclusion decisions and the editable download list are still in memory, not persistent. **Keep the workspace tab open until the ZIP is saved.** Reloading the extension or page loses that batch. The saved search collections are separate and will survive normal reloads.

## Text extraction and review

The extraction layer is separate from search providers. `src/extraction.js` dispatches HTML/XHTML to the chosen bundled extractor (Readability by default), passes plain text through whitespace normalization, while src/binary-extraction.js routes PDF and DOCX downloads through their own asynchronous adapters. Other MIME types remain unsupported while retaining their original files. Content type comes from the HTTP response; we do not guess that a binary response is HTML.

HTML is decoded using BOM precedence, then the HTTP charset, then an HTML meta charset in the first 4 KiB. When no encoding is declared, valid UTF-8 is used; invalid UTF-8 falls back to Windows-1252 with a warning. Unknown encodings and replacement characters also produce warnings. These are heuristics, not a complete browser encoding-sniffing implementation; inspect accented and non-Latin characters. Output text is always UTF-8.

A detached DOM is passed to the chosen extractor with a 60,000-element limit. Readability uses a 500-character candidate threshold and returns a content DOM. Defuddle receives the original source URL, runs its synchronous `parse()` method, and returns cleaned HTML that is parsed into a second detached DOM. Additional network requests during extraction are explicitly disabled. Both results are converted to text with paragraph/heading/list boundaries and spaces between table cells. We do not concatenate `textContent` from the whole page. Paragraph spacing and horizontal whitespace are normalized; original case, spelling, punctuation and diacritics are preserved. Code indentation and table layout are not preserved. Title/author/source metadata stays out of the body text unless the extractor itself retains a heading in the extracted content.

Neither extractor always finds the right content. Technical lists, glossaries, tables and multi-column pages deserve particular attention. Empty or failed extractions are excluded with a message; there is no automatic whole-page-text fallback. Successful texts below 200 characters are flagged but included for review. A few common login/access-check titles are heuristically flagged and excluded by default. These are warnings and rules, not confidence scores or a comprehensive CAPTCHA detector. A returned nonempty text can still contain boilerplate.

HTML/plain-text responses above **3 MiB** skip extraction to limit memory and UI stalls; their originals remain in the ZIP. The download limits are still 10 MiB per response / 100 MiB per batch. Parsing is synchronous in the workspace tab and may briefly pause the interface; Stop takes effect between synchronous HTML extraction operations; PDF/DOCX extraction also observes cancellation. Additional memory is needed for decoded strings, DOMs, texts and ZIP creation.

Use each row's **Include** checkbox to choose the corpus output. Original files are retained even when excluded or unsupported. Changing inclusion invalidates the cached ZIP, so the next save reflects your decisions. **Preview text** is read only; edit the exported `.txt` files if manual corrections are needed. No combined corpus file is generated: separate documents preserve document boundaries for concordancers.

The extension never inserts downloaded HTML or extracted HTML into its live interface. Preview uses a textarea value. A content security policy permits bundled images for the logo and blocks remote image/frame/object resource loads; page scripts are not executed. Both extractors are bundled locally, with their licences and source hashes in `src/vendor/`. Users do not install dependencies or download library code at runtime.

## Document extraction

PDF/DOCX details, prototype omissions and limits are documented in the README. Binary adapters return the same status/text/inclusion/metadata contract as HTML. PDF.js receives a copy of the bytes, so transferring its input to a worker does not detach the original ZIP payload. Binary parsing errors stay extraction failures rather than being reported as network errors. Generic MIME responses are identified using PDF signatures or a Word document part inside a bounded ZIP directory; file extensions alone never turn a login HTML page into a PDF.

## Encoded links and changing layouts

The Google adapter reads result-heading links in the live DOM. It accepts direct HTTP(S) destinations and Google `/url` wrappers containing explicit `q` or `url` destination parameters. The DuckDuckGo adapter also handles `/l/?uddg=...` wrappers; Ecosia supports direct URLs and explicit `/redirect` or `/url` wrappers.

In the Google layouts tested so far, signing in was needed to obtain usable destination URLs. If a signed-out or other variant exposes opaque links, switch engines or paste URLs manually. This is an observed adapter limitation, not a guarantee about all Google accounts/layouts.

Truly opaque redirect tokens are **not decoded or followed**. Such candidate links are counted as unresolved. A zero-result extraction produces an error, leaves previous collections untouched and suggests another engine or manual URL pasting. Partially successful extraction saves usable URLs and warns about unresolved candidates. No generic scan of every page link is used as a silent fallback: that would risk importing navigation, account links and other irrelevant URLs.

Google All/Web results, including country domains and `udm=14`, are supported by the detector. Image/video/AI-specific views are excluded. DuckDuckGo's regular web page and HTML endpoint are recognised; the Lite page is not implemented. Ecosia's `/search` page is recognised. Engine experiments, regional layouts, ad markup and logged-in variants can still require adapter updates.

**Validation:** automated tests cover engine detection, direct/redirect/opaque URL handling, isolated-function execution, collection merging, concurrent storage writes, charset decoding, text boundary serialization, exclusion/export decisions, the vendored source hash and the downloader/ZIP logic. Parser tests use synthetic DOM API fixtures, not live search pages. Live Chrome testing was unavailable in the build environment; Google, DuckDuckGo and Ecosia selectors still need verification on your own result pages. Avoid interpreting a nonzero count as a guarantee that every organic result was captured.


## Adding or fixing a provider

Search collection and downloading have separate contracts. All providers produce the same schema:

```json
{
  "id": "generated-collection-id",
  "engine": "google",
  "adapterVersion": 1,
  "query": "renewable energy",
  "pageURL": "https://www.google.com/search?q=renewable+energy",
  "collectedAt": "ISO timestamp",
  "unresolved": 0,
  "results": [
    { "url": "https://example.org/", "title": "Example", "positionOnPage": 1 }
  ]
}
```

To fix a layout, edit that provider's selectors and redirect handling in `src/engines.js`, bump its adapter version, add representative tests and manually inspect its output. Currently the injected function returns `adapterVersion: 1`; change this to provider-specific versions when individual providers start diverging.

To add a new page-based provider, add its registry entry plus host/path detection, allowed redirect decoding and exclusion rules in `src/engines.js`. The dropdown uses the registry automatically. The downloader, ZIP writer and collection merger do not need to know about that engine. Adapters are bundled source code: new code is delivered by extension updates, not downloaded dynamically.

A future Brave API or saved-file importer can emit this same collection format and use the collection layer without any DOM scraping. API key configuration, request quotas and import validation would be separate provider-specific work. There is no automatic engine failover in this prototype: the user switches explicitly, sees what was collected and retains control of the source.


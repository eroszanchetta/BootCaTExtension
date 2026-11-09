# BootCaT collection prototype · 0.4.0

A local Chrome extension for collecting search results, downloading original files and extracting corpus text with Mozilla Readability or Defuddle. Plain JavaScript, HTML and CSS; no API key, server, npm install or compilation is required to use it.

## Working from GitHub

The repository root contains `manifest.json`. Clone the repository in VS Code and use that same local folder for Chrome's **Load unpacked** command. You do not need to install npm packages to run the extension.

Before editing, pull the latest changes. After editing, review the diff, commit and push. When assistant changes arrive through a pull request, merge it, pull locally and reload the extension in Chrome. Keep local changes committed before pulling; do not replace the repository folder with an older ZIP. The GitHub repository is the source of truth for subsequent development.

## Version 0.4.0

Includes both Mozilla Readability and Defuddle 0.19.0, top navigation, and the supplied BootCaT logo as SVG/Chrome PNG icons. Both extraction libraries are bundled locally; there is no dependency installation or runtime CDN download.

## Navigation and extractor selection

The sticky menu links to Search, URLs, Review & export and Text preview. Native anchor links support keyboard navigation and reduced-motion preferences. Your supplied BootCaT SVG is retained unchanged in `icons/BootCaT.svg`; PNG versions are provided at 16, 32, 48 and 128 pixels for Chrome.

The extractor setting is next to the URL list. It defaults to Mozilla Readability on each fresh workspace load and is locked while a batch is running. The selected extractor is captured for that batch and written to extraction metadata. Choosing another extractor for a later batch does not rewrite earlier output. To compare extractors, choose Defuddle before starting a new batch. This version does not re-extract an existing batch in place: export it first, then start another batch with the same URLs. The output metadata records the extractor/version for each document. There is no automatic fallback between extractors.

## Update from version 0.1, 0.2 or 0.3

1. Save any downloaded batch before updating: downloaded bodies are still held in memory.
2. Extract this ZIP. Replace the contents of your existing `bootcat-url-downloader` folder with the new files. Keeping the same folder means Chrome can reload the existing extension.
3. Open `chrome://extensions` and click the extension's **Reload** button. If Chrome asks you to review new permissions, do so to enable collection.
4. Close old BootCaT interface tabs and click the toolbar icon again. The toolbar opens a small menu; choose **Open BootCaT workspace**.

For a fresh installation, enable **Developer mode** on `chrome://extensions`, click **Load unpacked**, and select the extracted folder containing `manifest.json`. Optionally pin the extension using Chrome's puzzle-piece menu. No paid developer account is needed.

## First search collection

1. Open the BootCaT workspace from the toolbar menu.
2. Under **Search and collect**, choose Google, enter a query and click **Open search**. You can also start from a results page you opened yourself.
3. Wait until web search results have loaded. Complete any consent screen or CAPTCHA normally if one appears.
4. While that results tab is active, click the BootCaT toolbar icon, then **Collect results from this tab**. Wait for the saved-count message before closing the popup.
5. Choose **Open BootCaT workspace**. The workspace displays the number of unique URLs and saved result pages. Expand **Review saved results** to inspect titles, URLs and their search sources.
6. Click **Add collected URLs below**. Review the editable list and remove unwanted URLs. This appends to existing valid URLs and removes duplicates; it never automatically overwrites your download list.
7. Click **Download URLs**. Each successful HTML/plain-text response is automatically processed.
8. Click **Preview text** beside each document. Review warnings and uncheck **Include** for texts you do not want in the corpus.
9. Click **Save ZIP**. All originals are retained; only selected extracted texts are included in the corpus folder.

Browse subsequent result pages or load more results manually and collect again. Only results already loaded in the page are considered; the extension does not scroll, click Next or submit searches in the background.

If Google fails, return to the workspace, select DuckDuckGo or Ecosia, open the same query and collect there. Previously collected results remain available. Those two adapters are explicitly **experimental**. Manual URL pasting is always available, including URLs found using an engine we do not support.

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

The extraction layer is separate from search providers. `extraction.js` dispatches HTML/XHTML to the chosen bundled extractor (Readability by default), passes plain text through whitespace normalization, and marks other MIME types (including PDF) as unsupported while retaining their original files. Content type comes from the HTTP response; we do not guess that a binary response is HTML.

HTML is decoded using BOM precedence, then the HTTP charset, then an HTML meta charset in the first 4 KiB. When no encoding is declared, valid UTF-8 is used; invalid UTF-8 falls back to Windows-1252 with a warning. Unknown encodings and replacement characters also produce warnings. These are heuristics, not a complete browser encoding-sniffing implementation; inspect accented and non-Latin characters. Output text is always UTF-8.

A detached DOM is passed to the chosen extractor with a 60,000-element limit. Readability uses a 500-character candidate threshold and returns a content DOM. Defuddle receives the original source URL, runs its synchronous `parse()` method, and returns cleaned HTML that is parsed into a second detached DOM. Additional network requests during extraction are explicitly disabled. Both results are converted to text with paragraph/heading/list boundaries and spaces between table cells. We do not concatenate `textContent` from the whole page. Paragraph spacing and horizontal whitespace are normalized; original case, spelling, punctuation and diacritics are preserved. Code indentation and table layout are not preserved. Title/author/source metadata stays out of the body text unless the extractor itself retains a heading in the extracted content.

Neither extractor always finds the right content. Technical lists, glossaries, tables and multi-column pages deserve particular attention. Empty or failed extractions are excluded with a message; there is no automatic whole-page-text fallback. Successful texts below 200 characters are flagged but included for review. A few common login/access-check titles are heuristically flagged and excluded by default. These are warnings and rules, not confidence scores or a comprehensive CAPTCHA detector. A returned nonempty text can still contain boilerplate.

HTML/plain-text responses above **3 MiB** skip extraction to limit memory and UI stalls; their originals remain in the ZIP. The download limits are still 10 MiB per response / 100 MiB per batch. Parsing is synchronous in the workspace tab and may briefly pause the interface; Stop takes effect between extraction operations. Additional memory is needed for decoded strings, DOMs, texts and ZIP creation.

Use each row's **Include** checkbox to choose the corpus output. Original files are retained even when excluded or unsupported. Changing inclusion invalidates the cached ZIP, so the next save reflects your decisions. **Preview text** is read only; edit the exported `.txt` files if manual corrections are needed. No combined corpus file is generated: separate documents preserve document boundaries for concordancers.

The extension never inserts downloaded HTML or extracted HTML into its live interface. Preview uses a textarea value. A content security policy permits bundled images for the logo and blocks remote image/frame/object resource loads; page scripts are not executed. Both extractors are bundled locally, with their licences and source hashes in `vendor/`. Users do not install dependencies or download library code at runtime.

## Encoded links and changing layouts

The Google adapter reads result-heading links in the live DOM. It accepts direct HTTP(S) destinations and Google `/url` wrappers containing explicit `q` or `url` destination parameters. The DuckDuckGo adapter also handles `/l/?uddg=...` wrappers; Ecosia supports direct URLs and explicit `/redirect` or `/url` wrappers.

In the Google layouts tested so far, signing in was needed to obtain usable destination URLs. If a signed-out or other variant exposes opaque links, switch engines or paste URLs manually. This is an observed adapter limitation, not a guarantee about all Google accounts/layouts.

Truly opaque redirect tokens are **not decoded or followed**. Such candidate links are counted as unresolved. A zero-result extraction produces an error, leaves previous collections untouched and suggests another engine or manual URL pasting. Partially successful extraction saves usable URLs and warns about unresolved candidates. No generic scan of every page link is used as a silent fallback: that would risk importing navigation, account links and other irrelevant URLs.

Google All/Web results, including country domains and `udm=14`, are supported by the detector. Image/video/AI-specific views are excluded. DuckDuckGo's regular web page and HTML endpoint are recognised; the Lite page is not implemented. Ecosia's `/search` page is recognised. Engine experiments, regional layouts, ad markup and logged-in variants can still require adapter updates.

**Validation:** automated tests cover engine detection, direct/redirect/opaque URL handling, isolated-function execution, collection merging, concurrent storage writes, charset decoding, text boundary serialization, exclusion/export decisions, the vendored source hash and the downloader/ZIP logic. Parser tests use synthetic DOM API fixtures, not live search pages. Live Chrome testing was unavailable in the build environment; Google, DuckDuckGo and Ecosia selectors still need verification on your own result pages. Avoid interpreting a nonzero count as a guarantee that every organic result was captured.

## Languages, files and extension concepts

Everything that runs in Chrome is JavaScript, HTML or CSS. No new programming language is required. Start with these files:

| File | Role |
| --- | --- |
| `manifest.json` | Extension version, permissions, popup and worker declarations |
| `popup.html`, `popup.js`, `popup.css` | The toolbar menu and collection button |
| `background.js` | Message handler: extracts results, serializes collection writes, opens workspace |
| `engines.js` | Provider registry, search URL builders, engine detection and page extraction |
| `collection.js` | Provider-neutral collection merging, provenance and limits |
| `search-ui.js` | Workspace search form, saved-results preview and JSON export |
| `downloader.html`, `styles.css` | Workspace structure and appearance |
| `app.js`, `core.js` | Download queue, validation, HTTP fetching and ZIP export |
| `extraction.js` | Encoding detection, extractor dispatch and corpus text serialization |
| `defuddle-loader.js` | Local Defuddle constructor/export normalization and version |
| `corpus.js` | Inclusion filtering and extraction metadata for export |
| `vendor/` | Bundled Readability/Defuddle, upstream licences, notice and source hashes |
| `zip.js` | Dependency-free, uncompressed ZIP writer |
| `tests/` | Optional Node tests; one ZIP test also uses Python 3 |

There are three execution contexts:

1. **Popup:** a short-lived web page opened by clicking the toolbar icon. It detects the active engine and sends a `collect` message to the worker.
2. **Background service worker:** handles messages and calls `chrome.scripting.executeScript` to run a self-contained extraction function in the active tab. It then writes the returned collection to `chrome.storage.local`. `return true` in its message listener keeps the asynchronous reply channel open. The worker can stop when idle; collection state is in storage, not worker globals. The in-memory promise chain only serializes outstanding storage writes while they execute.
3. **Workspace:** a persistent extension tab. It listens for storage changes, displays collected results, and runs the longer download queue. Keep it open during downloads.

The injected extraction function runs in Chrome's **isolated world**: it can read the DOM, but does not share JavaScript globals with Google's own scripts. Chrome serializes that function when injecting it, so it must not depend on imported functions or module variables. We pass the adapter configuration as a JSON-serializable argument. The tests check execution without its module closure.

`import`/`export`, `async`/`await`, `try`/`catch` and DOM event handlers are standard JavaScript. Chrome-specific APIs all use the `chrome` namespace. Remote data is displayed through `textContent`, never injected as executable HTML.

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

To fix a layout, edit that provider's selectors and redirect handling in `engines.js`, bump its adapter version, add representative tests and manually inspect its output. Currently the injected function returns `adapterVersion: 1`; change this to provider-specific versions when individual providers start diverging.

To add a new page-based provider, add its registry entry plus host/path detection, allowed redirect decoding and exclusion rules in `engines.js`. The dropdown uses the registry automatically. The downloader, ZIP writer and collection merger do not need to know about that engine. Adapters are bundled source code: new code is delivered by extension updates, not downloaded dynamically.

A future Brave API or saved-file importer can emit this same collection format and use the collection layer without any DOM scraping. API key configuration, request quotas and import validation would be separate provider-specific work. There is no automatic engine failover in this prototype: the user switches explicitly, sees what was collected and retains control of the source.

## Permissions and privacy

- Existing HTTP/HTTPS host permissions allow downloading arbitrary submitted URLs and reading supported result pages. Download requests explicitly omit login credentials and referrers.
- `activeTab` supports accessing the tab when the toolbar menu is invoked.
- `scripting` allows reading supported search-result DOMs on demand.
- `storage` persists collection metadata locally.

The extension does not monitor searches continuously, inject persistent content scripts, access browser history, solve CAPTCHAs or send content to a BootCaT backend. A search you open is a normal browser navigation and uses the browser's normal search-engine session; collection reads that already-open page. The download phase uses separate credential-free HTTP requests.

The archive download uses a Blob link; no `downloads` permission is needed. A production release should evaluate optional per-host permissions instead of the broad host access retained from 0.1.

## Edit and debug

Use any editor, such as VS Code. After changing workspace HTML/CSS/JavaScript, refresh that tab. After changing the manifest or worker, click **Reload** on `chrome://extensions`, then close/reopen the popup and workspace. Save downloaded bodies first.

Right-click the workspace or popup and choose **Inspect** for Console and Network tools. For worker errors, use the **service worker** inspection link on `chrome://extensions`. Being inactive while idle is normal. Chrome installation labels may be **Modalità sviluppatore** / **Carica estensione non pacchettizzata** in Italian.

Optional tests, from the project folder, with Node.js 20+ and Python 3 installed:

```sh
node --test
```

No npm packages are needed. The downloader retains the 10 MiB per-response / 100 MiB per-batch limits, 30-second network request timeout, sequential requests and half-second pauses. It fetches response bodies after HTTP decompression and extracts text from supported types. It does not execute page JavaScript, download linked assets or convert PDFs. A successful HTTP response can still be a login/anti-bot page.

The extraction unit tests exercise decoding/serialization/failure handling and extractor dispatch, verify both bundled source hashes, and smoke-test the real Defuddle export on an empty document. They do not run full article extraction against a native browser DOM. A separate browser check page is included: with the workspace open, change the final `downloader.html` part of its address to `tests/browser-tests.html`. It runs nine offline checks against both real bundled extractors and Chrome's DOM and displays PASS/FAIL. This browser test page was not runnable in the build environment; run it in Chrome before evaluating real pages. It checks article extraction with both libraries, navigation removal, Unicode, paragraph/list/table separation, inert scripts, empty pages, legacy encoding and the common plain-text path. It makes no network requests.

Suggested manual verification: collect the same Google page twice; collect page two; switch engines and collect the same query; inspect duplicate provenance; reload the workspace to check persistence; test an unsupported/image page; try an encoded-link Google variant; export JSON and a download ZIP; confirm Clear leaves the URL list intact.

To add a future extractor, keep the `extractDocument` result contract (`status`, `text`, `included`, `extractor`, `extractorVersion`, `encoding`, metadata and warnings). `corpus.js` and the download/search code can consume that common format. There is no automatic second-extractor fallback in this prototype.

## Official references

- [First Chrome extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Local storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

- [Mozilla Readability](https://github.com/mozilla/readability)

- [Defuddle](https://github.com/kepano/defuddle)

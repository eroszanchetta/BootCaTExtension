# BootCaT extension

A local corpus-building extension with one shared JavaScript/HTML/CSS codebase and separate Chromium and Firefox builds. Search collection, downloads, Readability, Defuddle, ZIP export, your popup wording, blue palette and logo are shared.

## Updating from the original repository layout

Before switching your installed extension, save pending download ZIPs and export saved searches. The generated folder is a different extension path in Chrome, so it can create a new extension identity with separate local storage. Keep the old instance until you have saved the data you need. Firefox and Chromium always have separate extension storage. This version does not automatically migrate/import project data.

After merging the structural change, pull it in VS Code, then build from the repository root:

```sh
npm install
npm run build
```

The repository root no longer contains a loadable manifest. Edit `src/`, rebuild, and load the matching generated folder below. Do not edit `dist/`: the next build replaces it. Run `npm install` after pulling this update to install the pinned PDF.js dependency. Subsequent builds work offline; PDF.js, its worker, character maps, standard fonts and licences are copied into both extension packages. No CDN is used at runtime.

## Seeds, tuples and search queries

The first workspace section after Project accepts one seed per line, with at least five distinct seeds and no fixed maximum seed count. A seed may be one word or a phrase. Blank lines and duplicates are ignored after whitespace/Unicode normalization; case is preserved. Existing outer double quotes are accepted; multi-word seeds are automatically quoted in generated tuples. Embedded double quotes are escaped, and query syntax can be edited before searching.

Choose 1–10 seeds per tuple (default 3) and a requested tuple count (default 10). Generation samples distinct combinations without enumerating every possible combination or retrying random collisions. A seed never repeats within a tuple, and reordering the same seeds does not count as another combination. If the requested count exceeds the possible combinations, all available combinations are returned in random order with an explanation. Uniqueness applies within a generated batch. Large requests show a performance notice and generation can be stopped; stopping keeps the previous tuple text. Generating again replaces the editable tuple text.

After editing the tuples, click **Create search queries**. Each nonblank line becomes a clickable search query; identical query lines are deduplicated. Preparing queries opens no tabs. Changing the selected engine updates the links without regenerating tuples. Editing the tuple text clears the prepared links until queries are created again. Individual links open a new results tab; use the toolbar's collection action as before.

**Open all queries** asks for confirmation that search engines may refuse automated batch queries, block requests or show CAPTCHAs, and that many tabs may affect browser performance. It opens the approved queries in background tabs. **Stop opening tabs** stops the remaining requests without closing tabs already created. A failure reports how many tabs opened; individual links remain available. Longer query lists are displayed 100 at a time, with pagination, while Open all includes the entire prepared list. The manual single-query form remains available under **Open a single custom search**.

Seeds, generation parameters, edited tuple text and prepared queries are part of the persistent project draft and `project.json` export. New project clears them. Old projects receive empty/default fields without a schema migration. There are no new dependencies or permissions; searches are sent to the selected engine only through explicit link clicks or the confirmed batch action.

## Project search tabs

Opening a prepared query, **Open all queries**, or the single custom-search form registers the created tab ID, project, engine and query in browser-session storage. Normal, Ctrl/Cmd and middle clicks are supported. Browser context-menu opens, copied links, duplicated tabs and pre-existing search tabs are not adopted; collect those manually. Switching the selected engine does not change ownership of tabs already opened for the project.

**Collect results and close project search tabs** processes a snapshot of this project's tracked tabs across browser windows. It reads background result pages without activating them. A tab is closed only after its collection has been successfully stored, and after another check of its ownership, navigation revision, URL/query and loaded state. Other queries/pages are left open and lose tracking. Loading, discarded or inaccessible tabs remain open for retry. CAPTCHA/unsupported pages, storage errors, collection-capacity errors and partial results with unresolved links remain open, with outcomes in the details panel. **Stop collecting** stops remaining work and avoids closing the current page when possible; an already-dispatched browser close cannot be undone by the extension. New tabs opened during collection are included on the next run.

Tab ownership survives background-worker suspension within the same browser session, but is cleared on browser restart and extension reload/update to avoid stale tab IDs. Restored search tabs can be collected manually. Interrupted batches never resume automatically; saved collections remain and the user can retry explicitly. Manually closing a tab removes its tracking. New project cancels old collection work and clears ownership without closing browser tabs. Tracking metadata is not included in corpus ZIPs; saved search provenance remains in the usual collections export.

Recognized provider challenge/consent/sign-in redirects keep their ownership for manual resolution, but their DOM is not collected and they are never closed by the batch action. Returning to the original project's search query makes them eligible on a later explicit retry.

The feature uses the existing `storage`, `scripting` and HTTP(S) website permissions, with no `tabs`, history or web-navigation permission added. DOM collection and closing occur only on an explicit user command. Lifecycle listeners update only BootCaT-created ownership records; unrelated tab content is not inspected. Store publication still requires a complete review of permissions, privacy disclosures and Firefox data declarations.

## Requirements

- Node.js 22.15+ (Node 24 recommended) for building, packaging and tests. Node is a developer tool; extension users do not need it.
- Target browsers: Chromium/Chrome 120+ and Firefox desktop 140+ (including Firefox ESR 140). These are declared targets; see validation limits below.
- Python 3 additionally for the automated ZIP/DOCX fixture tests (standard library only).

## Build and load

| Target | Build command | Load this folder |
| --- | --- | --- |
| Chrome / Chromium | `npm run build:chromium` | `dist/chromium/` |
| Firefox | `npm run build:firefox` | `dist/firefox/` |
| Both | `npm run build` | Both folders above |

**Chrome/Chromium:** open `chrome://extensions`, enable Developer mode and choose Load unpacked → `dist/chromium`. After source changes, rebuild, click Reload on the extension and reopen the workspace. Edge/Brave may use this build but are additional testing targets, not separately verified releases.

**Firefox:** open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and select `dist/firefox/manifest.json`. Temporary installs last until Firefox exits. Rebuild and use Reload on the debugging page after changes. Check site-access permissions if search collection or downloading is denied.

For development with Mozilla's optional `web-ext` tool installed:

```sh
npm run lint:firefox
npm run dev:firefox
```

`dev:firefox` launches a temporary installation. Rebuild after editing `src/`; the running tool watches the generated output. Installing `web-ext` is optional (for example `brew install web-ext` on macOS).

## Using BootCaT

1. Click the toolbar logo, then Open BootCaT.
2. Open a query from Search, or browse directly to supported web results.
3. On that search tab, use the toolbar popup's Collect results button.
4. Return to the workspace, review the URLs automatically added to the editable download list. Manual URL pasting is always available.
5. Choose Readability (default) or Defuddle before starting the batch.
6. Download, review text previews and inclusion checkboxes, then Save ZIP.

Google, DuckDuckGo and Ecosia use separate adapters. In the Google layouts tested so far, sign-in was necessary to expose usable destination URLs. Opaque redirects are skipped with a warning. Switching providers retains earlier collections and provenance.

The ZIP retains originals in `pages/`, selected UTF-8 texts in `corpus/`, raw PDF extractions in `raw-pdf/`, and `results.json`, `extraction.json` and `searches.json`. Raw PDF text is separate from corpus text so it does not duplicate the selected corpus. Project drafts, originals, extracted texts, review metadata and inclusion decisions persist locally in this browser. Reopen the workspace to restore them; export a ZIP backup before clearing browser data or uninstalling the extension. PDF and DOCX extraction is included; see document-format notes below.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/` | Shared application modules, HTML and CSS |
| `src/extension-api.js` | Prefer `browser.*`, fall back to the supported Chromium `chrome.*` APIs |
| `src/background.js` | The same message/collection handler for both browser contexts |
| `src/engines.js` | Search provider detection and DOM adapters |
| `src/project-search-tabs.js`, `src/search-tabs-client.js`, `src/project-tabs-ui.js` | Session-only project tab ownership, explicit collection/close, and progress reporting |
| `src/tuples.js`, `src/seeds-ui.js` | Random unique seed combinations, editable tuples and explicit search-query opening |
| `src/extraction.js`, `src/binary-extraction.js`, `src/docx.js`, `src/corpus.js` | HTML/plain-text/PDF/DOCX extraction, inclusion and corpus export |
| `src/icons/`, `src/vendor/` | Shared logo, icons and bundled extractors/licences |
| `manifests/common.json` | Common name/version, permissions, interface and CSP |
| `manifests/chromium.json` | Chromium minimum version and module service worker |
| `manifests/firefox.json` | Firefox module background scripts, stable ID and minimum version |
| `scripts/` | Node build, local PDF.js asset bundling and ZIP packaging; optional browser smoke test |
| `tests/` | Shared unit/build tests and optional real-DOM fixtures |
| `dist/` | Generated output, excluded from Git |

No frontend framework, transpiler or bundler is required. The build merges the common manifest with its browser override and copies `src/` unchanged. The libraries in `src/vendor/` run locally with their upstream licences retained. No executable code is downloaded at runtime.

## Compatibility decisions

Firefox's MV3 background scripts use `background.scripts` with `type: module`; Chromium uses `background.service_worker`. The application module is identical. Longer download/extraction jobs stay in the workspace tab. Durable collection state stays in local storage.

Extension API access goes through one module. This is a namespace adapter, not a polyfill for unsupported APIs. Promise-returning operations are used for the API subset available at the declared browser minimums. The message listener retains its portable callback/`return true` asynchronous reply pattern. Injected search extraction is self-contained and does not reference either browser namespace.

Extension URLs are generated with `runtime.getURL()`. Workspace reuse checks tab URLs directly rather than building a browser-specific URL match pattern. No `chrome-extension://` scheme is assumed in application code. Browser-specific changes should remain in manifest overrides or a small compatibility helper, not duplicate application files.

## Packaging and distribution

```sh
npm run package
```

Produces `dist/packages/bootcat-chromium-0.4.0.zip` and `dist/packages/bootcat-firefox-0.4.0.zip`, each with its manifest at the ZIP root. Individual commands: `npm run package:chromium` and `npm run package:firefox`. Packages exclude development fixtures.

These are unsigned packages for review/upload, not store-published releases. Normal Firefox distribution requires Mozilla signing, whether listed on AMO or self-distributed. The Firefox development manifest includes a stable extension ID; its AMO data-collection/transmission declarations must be assessed and added before a first store submission. In particular, user-initiated searches send queries to the selected engine, even though corpus content is processed locally. No submission, signing or publication is performed by these build commands.

## Testing

```sh
npm test
```

Run `npm install` before testing; the PDF tests use the pinned PDF.js package. They cover URL validation, downloading, encoding, extraction boundaries, corpus selection, library hashes, ZIP compatibility, API namespace selection, background messaging with both API namespaces, and the generated builds. Python 3 is used by the independent ZIP reader test.

Builds are checked for matching shared files, the correct manifests, required assets and safe replacement of generated output. Message tests simulate the Firefox namespace/scheme and the Chromium namespace/scheme; they do not substitute for live Firefox testing.

For real browser-DOM extraction fixtures, build with tests included:

```sh
node scripts/build.mjs all --with-tests
```

After loading a generated extension, open the workspace and replace `downloader.html` at the end of its address with `tests/browser-tests.html`. Twelve offline checks exercise both real extractors, Unicode, structural boundaries and script inertness. Standard builds omit this page.

The automated Chromium smoke test uses the pinned Playwright development dependency. Install its browser when needed:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

The smoke test builds into a temporary folder/profile and routes all web requests to local fixtures. It checks the extraction page, actual script injection into a mock Google page, saved searches, download/extraction/ZIP with both extractors, workspace reuse and persistence. It never contacts real search engines. `CHROMIUM_EXECUTABLE_PATH` can select an existing compatible Chromium binary.

**Validation in the build environment:** all unit/build tests and both ZIP packages passed. Live Chromium testing was attempted but the environment blocked browser startup (`socket() failed: Operation not permitted`). Firefox is not installed here. Live browser smoke tests and minimum-version verification therefore remain to be performed on a machine that can run the browsers. The optional smoke script is included but has not completed here.

## PDF.js security updates

The PDF.js dependency is pinned to **6.5.438**, above the 6.2.108 fix for [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j). After pulling this upgrade, run `npm install`, `npm test`, `npm run build` and `npm audit`, then reload the extension. Rebuilding is required: updating node_modules alone does not replace the installed extension's copied PDF assets.

Package generation and runtime loading share a single expected version in `src/pdfjs-version.js`. The build rejects a mismatched installed dependency, and extraction refuses a stale/mismatched PDF module before parsing bytes. The build packages only the parser and worker modules, not the PDF viewer or scripting sandbox. The extension retains its restrictive CSP; no PDF viewer scripting manager is instantiated. `enableScripting` is a viewer setting, not a `getDocument` option, so it is not passed to the parser as a purported workaround.

GitHub Actions installs dependencies on Node 24, runs the high-severity npm audit check, the full test suite and both browser packages for pull requests and main pushes. The 6.5.438 upgrade passed all these clean-install checks in [validation run 42987320430](https://github.com/eroszanchetta/BootCaTExtension/actions/runs/42987320430). This does not replace live browser worker/CSP verification.

## PDF and DOCX extraction

Downloads containing PDF or DOCX are extracted automatically, independently of the Readability/Defuddle choice (which still controls HTML). Both formats use the existing preview, Include checkbox, trash button and corpus ZIP. Originals are retained even if extraction fails. Correct `.pdf` / `.docx` extensions are assigned to known types, including common downloads served as `application/octet-stream`. A URL ending in `.pdf` that actually returns an HTML page is still treated as HTML.

- **PDF:** PDF.js 6.5.438 extracts embedded text using a bundled local module worker. Page counts and per-page character counts are recorded in extraction metadata. Reading order, columns, tables, repeated headers and line breaks can be imperfect. We do not dehyphenate or silently run OCR. Empty/textless PDFs are excluded with an OCR suggestion. Password-protected PDFs report an actionable failure; password entry is not implemented.
- **DOCX:** a small ZIP/XML text reader extracts main-body paragraphs, hyperlinks and table text, preserving Unicode and explicit line breaks. Hidden runs, deleted text and field instructions are omitted. Headers, footers, comments, footnotes and endnotes are intentionally omitted in this prototype; review text boxes and tables. It does not reproduce Word layout or convert the document to HTML. ZIP/XML inputs are bounded and XML entities are rejected. Legacy `.doc`, PowerPoint, OpenDocument and encrypted documents remain unsupported.

Limits: 50 MiB per downloaded document or manually selected PDF/DOCX; 30 seconds per binary extraction. PDF output is limited to 2 million characters and 300 pages. DOCX output allows 10 million characters, up to 10,000 ZIP entries, 250 MiB declared total expansion, 50 MiB per parsed XML part, 500,000 XML elements and 256 levels of nesting. An oversized download is stopped, its partial data discarded, and its review row explicitly reports the 50 MiB limit. Extraction errors produce no partial corpus text. Stop cancels active binary extraction while retaining downloaded originals. Creating a new project cancels old work.

New PDF extractions normalize whitespace, then replace every newline not immediately preceded by an ASCII dot (`.`) with a space, including page boundaries. A newline after other punctuation is also replaced. Hyphen characters are preserved, without word repair or dehyphenation; a newline following a hyphen becomes a space. This simple corpus-oriented rule can join headings, lists and columns. It does not reorder columns or remove headers/footers.

The preview and `corpus/` use formatted text. The baseline text before line joining is stored as a separate Blob and exported to `raw-pdf/`, including when that PDF is unchecked for corpus inclusion. This baseline already includes the existing item-spacing and whitespace normalization; it is not a PDF byte stream. `extraction.json` records the raw filename, formatting version, applied rules and joined-line counts. Old stored projects remain unchanged; formatting applies when a PDF is newly extracted. Trash/New project remove both text versions with their original files.

The toolbar's **Add page to corpus** action also supports HTTP(S) PDF tabs. For PDFs it re-fetches the URL with browser-session cookies (only for this explicit action); ordinary batch downloads still omit cookies. This can help after manually completing a CAPTCHA or signing in. It does not read the already-loaded bytes from the browser's protected PDF viewer, and some sites will still block the request. A PDF signature is required: an HTML challenge returned by the server is never accepted as a PDF. The saved source is recorded as `browser-session` rather than an HTML snapshot.

Every failed download offers the same guidance: open the URL, complete any CAPTCHA or sign-in, then either use **Add page to corpus** in the popup or download the file manually and click **Import downloaded file** beside the failed URL. BootCaT does not infer recovery format from URL extensions, filenames or response MIME hints. The file chooser has no format filter, so extensionless and misleadingly named downloads can be selected. BootCaT identifies supported documents from their contents, then runs the matching extractor. Unsupported files, HTML sign-in pages and malformed archives report an import error and leave the failed row intact.

A successful download whose text extraction failed retains its original and extraction message, without offering recovery. Size-limit failures also omit import because it cannot bypass the 50 MiB file limit. Local PDF and DOCX documents up to 50 MiB are supported. Progress/errors appear beside the button and in a dedicated status area. The file input remains attached while the native chooser is open, including when the window regains focus. BootCaT cannot verify that a local file belongs to the chosen URL, so check before selecting it. Imported originals and extracted text replace that failed row and persist/export through the existing pipeline. The source is recorded as `local-file`; no local filesystem path is stored. Format detection and validation share the registry in `src/document-formats.js` for future supported formats. The general PDF/OCR notice appears once above the review list, while document-specific warnings remain on their own rows.

## Persistent project storage

All batch sizes use IndexedDB for originals (Blobs), extracted text (separate Blobs), document metadata, URL drafts and run progress. Search collection metadata and project-name notifications remain in extension-local storage for the popup. Only the current download/extraction, selected preview and lightweight document metadata need to be loaded into JavaScript memory. Previously completed pages are skipped when downloading again; new URLs are added to the existing project. Failed or interrupted work can be retried with the existing download/resume button. Use **New project** to clear the corpus rather than starting a download to replace it.

The former 500-URL and 100 MiB batch caps are removed. Above 500 URLs, an inline warning explains that downloading, reviewing, exporting and browser-storage use may suffer. Per-file and extraction limits remain. Browser storage capacity is finite; if a write fails, processing stops with a useful message and previously committed documents remain intact. Stored originals, text, metadata and progress are committed atomically. A full reset also fences off writes from an old project. Queued pages from the old capture database migrate without loss; content held only in a pre-upgrade workspace's RAM cannot be recovered after reloading, so export it before updating.

Closing the workspace stops active network work. Reopening restores completed results and offers Resume downloads; it does not silently start downloads. One cross-window lock prevents competing download/import/export runs. The preview starts blank and reads only its chosen text from storage. Trash removes all stored versions of a page, and New project clears the database and extension-local project state.

ZIP export reads stored files one at a time for CRC calculation and assembles native Blob references, rather than making an array of all document buffers/texts in JavaScript. It supports ZIP64 counts/offsets. Browsers still impose native Blob, memory and storage limits, so very large exports can fail; the stored project remains intact. Export is a corpus backup, not yet an importable project-backup format. IndexedDB data remains local to the browser profile, may be cleared/evicted, and is removed when the extension is uninstalled; it is not cloud-synced or guaranteed permanent.

## Projects and review

The **Project name** field at the top is saved locally and used in the corpus ZIP filename, `project.json`, and export metadata. BootCaT currently has one active project. Its URL list, search controls, completed documents and inclusion choices are saved in browser storage and restored when the workspace is reopened.

**New project** asks for confirmation, then clears all extension-local project data: the name, saved search collections, URL list, pending snapshots, downloaded files, corpus texts, selections, progress and preview. Open workspaces and popups reset to the new project. Active downloads are cancelled; search/capture requests from the old project cannot populate the new one. Previously exported files on your computer are unaffected.

**Collect results from this tab** adds collected URLs to the download list automatically and opens a background workspace if needed. New URLs wait until an active batch finishes, and duplicates are skipped. Existing manual edits are preserved. There is no hard URL-count limit. Lists above 500 URLs display a performance/storage warning, with no extra setting or confirmation required. Search collection metadata retains its separate provider-neutral limits.

**Preview text** stays blank until a Preview text button is clicked. The section heading remains fixed and the selected page is identified below it.

The **Include** checkbox controls corpus inclusion while retaining original files. The trash button on the right instead asks for confirmation and deletes that page's text, original files (including previous captures), and download metadata from the review list and future exports. It also removes the URL from the download list and clears the preview if it displays that page. Saved search provenance remains in the search collections. Delete buttons are disabled while downloads or imports are running.

On detected search results pages, **Add page to corpus** is disabled so results are collected through the search action instead. After collection, that action stays disabled and displays a green **Results added** message, including when reopening the popup on the same results URL. A different results page remains collectable. Clearing searches or starting a new project resets this state.

## Save a page already open in the browser

In **Review and export**, each URL opens in a new tab. Failed downloads display instructions for opening the page, completing any CAPTCHA or sign-in, and saving it through the toolbar; the original error appears at the end in parentheses and remains in download metadata. If a download fails because of a CAPTCHA, open that link and complete the challenge yourself. Click the BootCaT toolbar icon → **Add page to corpus**. The button stays disabled and a green **Page saved** message confirms success. Save errors leave the button enabled for retry.

The snapshot is added to the review list automatically, using the selected Readability or Defuddle extractor without another network request. If the workspace is closed, it opens in a background tab. If downloads are running, the snapshot waits until the batch finishes. A snapshot matching an existing URL (or a successful download's final redirect URL) replaces its review row and corpus text. Earlier raw files and attempt metadata remain in the ZIP; metadata identifies browser captures and their capture times. If navigation changes the URL, the snapshot is added as a separate document.

HTML snapshots contain the rendered top-level HTML, with scripts, frames, editable controls and event handlers removed. They are UTF-8 and are not complete offline copies: external assets, shadow DOM and embedded frames are not bundled. Review the extracted text before including it. The extension does not solve CAPTCHAs or determine whether a challenge is complete. Browser-protected pages cannot be captured; HTTP(S) PDFs use the separate recovery methods described above.

A local IndexedDB inbox retains HTML snapshots and recovered PDF Blobs until the workspace imports them, then removes each imported item automatically. Limits: 2 MiB / 60,000 elements per HTML snapshot; 50 MiB per PDF; 20 items and 100 MiB combined awaiting import. If import fails, remaining items stay available for retry when the workspace regains focus or a new batch finishes. Imported pages, their texts and selections remain saved after closing the workspace. Reopening does not automatically restart downloads: use Resume downloads to continue unfinished work.

The optional Chromium smoke test also checks failed-download recovery, snapshot cleanup and automatic import. Native browser execution remains blocked in this build environment; these checks must be run locally.

## Collaboration

GitHub is the source of truth. Pull before editing, commit and push your changes in VS Code. After merging an assistant pull request, pull locally, run the appropriate build and reload the installed generated extension. The source files are now under `src/`; the generated folders stay out of Git.

See [collection/extraction details](docs/PIPELINE.md) for limits, provenance and provider behaviour, and [vendored libraries](src/vendor/README.md) for versions/licences.

## Official references

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/

# BootCaT extension

A local corpus-building extension with one shared JavaScript/HTML/CSS codebase and separate Chromium and Firefox builds. Search collection, downloads, Readability, Defuddle, ZIP export, your popup wording, blue palette and logo are shared.

## Updating from the original repository layout

Before switching your installed extension, save pending download ZIPs and export saved searches. The generated folder is a different extension path in Chrome, so it can create a new extension identity with separate local storage. Keep the old instance until you have saved the data you need. Firefox and Chromium always have separate extension storage. Use Save Project to download a complete .bootcat file, then Open Project in the other installation. Browser profiles remain independent; projects are not automatically synchronized.

After merging the structural change, pull it in VS Code, then build from the repository root:

```sh
npm install
npm run build
```

The repository root no longer contains a loadable manifest. Edit `src/`, rebuild, and load the matching generated folder below. Do not edit `dist/`: the next build replaces it. Run `npm install` after pulling this update to install the pinned PDF.js dependency. Subsequent builds work offline; PDF.js, its worker, character maps, standard fonts and licences are copied into both extension packages. No CDN is used at runtime.

## Optional language detection

Project creation requires an explicit choice of target language or **No language detection**. Existing projects default to no detection. The Project language selector can be changed later; **Recheck saved texts** applies the choice to existing extracted bodies without downloading pages again. Rechecks can be stopped with Stop; completed checks stay saved. Saved overrides and manual exclusions are preserved.

Franc 6.2.0 and its MIT-licensed model/utilities are bundled locally with pinned source URLs, hashes and licence files in `src/vendor/franc/`. No detector code, model, or corpus text is sent to a remote service. The bundled model supports 178 distinct language codes, with names shown in the selector. The detector is behind a replaceable adapter returning ISO 639-3 codes and common assessments; franc-specific scores remain diagnostic metadata rather than displayed accuracy percentages.

After successful HTML, plain-text, PDF, DOCX or manual-capture extraction, enabled detection checks up to three 2,048-character samples across the document. Samples need at least 120 Unicode letters. A small winning margin (normalized by the candidate score range), an undetermined result or disagreement between samples produces **Language uncertain**. These initial beta heuristics are conservative and are not a guarantee of correctness or a full multilingual segmentation algorithm.

Mismatches and uncertain results retain successful extraction and the original files, but start unchecked in **Documents needing attention**. Preview remains available. **Include anyway** records an explicit override, includes the text and returns the document to the main list. Users can subsequently uncheck it without losing that override. Extraction failures keep their own messages and do not receive a misleading language guess. Detector/version, target, assessment, bounded diagnostic samples, check time and override are retained in `extraction.json`; project settings are in `project.json`.

Language setting changes apply to newly extracted documents immediately. Existing rows keep their previous assessment until an explicit recheck; their messages identify the language they were checked against. Turning detection off and rechecking restores pre-check inclusion choices. Browser or storage failures during a recheck keep already committed results; no original/text Blobs are rewritten.

## Seeds, tuples and search queries

The first workspace section after Project accepts one seed per line, with at least five distinct seeds and no fixed maximum seed count. A seed may be one word or a phrase. Blank lines and duplicates are ignored after whitespace/Unicode normalization; case is preserved. Existing outer double quotes are accepted; multi-word seeds are automatically quoted in generated tuples. Embedded double quotes are escaped, and query syntax can be edited before searching.

Choose seeds per tuple (default 3, up to the smaller of 10 and the distinct seed count) and a requested tuple count (default 10). The selectors and hints update to show the available limits; tuple count uses the exact combination count. Changes committed with values above the available maximum are reduced to that maximum. Counters show distinct seeds, unique nonblank tuple/query lines and valid unique URLs, including while sections are collapsed. Generation samples distinct combinations without enumerating every possible combination or retrying random collisions. A seed never repeats within a tuple, and reordering the same seeds does not count as another combination. If the requested count exceeds the possible combinations, all available combinations are returned in random order with an explanation. Uniqueness applies within a generated batch. Large requests show a performance notice and generation can be stopped; stopping keeps the previous tuple text. Generating again replaces the editable tuple text.

After editing the tuples, click **Create search queries**. Each nonblank line becomes a clickable search query; identical query lines are deduplicated. Preparing queries opens no tabs. Changing the selected engine updates the links without regenerating tuples. Editing the tuple text clears the prepared links until queries are created again. Individual links open a new results tab; use the toolbar's collection action as before.

**Open all queries** asks for confirmation that search engines may refuse automated batch queries, block requests or show CAPTCHAs, and that many tabs may affect browser performance. It opens the approved queries in background tabs. **Stop opening tabs** stops the remaining requests without closing tabs already created. A failure reports how many tabs opened; individual links remain available. Longer query lists are displayed 100 at a time, with pagination, while Open all includes the entire prepared list. Custom queries can be entered directly into the editable tuples area.

Seeds, generation parameters, edited tuple text and prepared queries are part of the persistent project draft and `project.json` export. New project clears them. Old projects receive empty/default fields without a schema migration. There are no new dependencies or permissions; searches are sent to the selected engine only through explicit link clicks or the confirmed batch action.

## Search restrictions and personal defaults

**More search options** groups the advanced search controls in a native, keyboard-accessible disclosure, closed on workspace opening and for each new project. New advanced controls can share the same container and the field registry in `seeds-ui.js`.

**File type** offers No restriction, PDF and DOCX. Its choices come from the supported document-format registry. **Excluded websites** accepts domains or HTTP(S) website URLs, one per line; URLs are reduced to domains, leading `www.` is removed, duplicates are ignored, and invalid entries are reported. Subdomains other than `www` stay specific. **Restrict search to site/domain** accepts one optional domain or HTTP(S) website URL, normalized like exclusions, and adds `site:`. Leaving it blank searches all websites. A restriction covered by an excluded domain is reported as a conflict; neither setting is silently removed. These settings add `filetype:`, `site:` and `-site:` operators through the search-engine adapter. They never remove collected URLs or change downloads. Engine support is best effort, particularly with Ecosia's varying providers.

**Create search queries** displays and stores the final query strings, including restrictions. Editable tuples stay unchanged. Changing file type updates prepared queries immediately; site restrictions and exclusions update after a short typing pause. Invalid domains and conflicting restrictions are shown inline and prevent opening stale queries. These updates preserve the base tuples, query-list page and scroll position, and never open searches or alter tabs already open. Switching engines also rebuilds the final queries. Search-tab tracking and collection provenance use the final query. Saved links from older versions without base-tuple metadata remain unchanged until recreated. Restrictions and query snapshots persist in the project draft and `project.json`.

New projects start by excluding youtube.com, facebook.com, instagram.com and amazon.com. **Save exclusions as my default** saves a personal list for future projects in this browser. An empty saved list is valid. Editing a project's list does not change personal defaults, and saving defaults does not overwrite another project's list. File type resets to No restriction and the site restriction resets to blank for each new project. Site restrictions are project settings, separate from saved exclusion defaults.

Personal defaults live in the separate, versioned `userDefaults` storage record. A field registry in `user-defaults.js` supplies built-ins, validation and partial-update rules, allowing future preferences to share the same mechanism. New project clears project data and legacy project keys while retaining that record, including during interrupted-reset recovery. Preferences are local to the browser profile, not synced to a service. The profile is not part of corpus exports; the project's effective list is exported with its draft.

## Project search tabs

Opening a prepared query or **Open all queries** registers the created tab ID, project, engine and query in browser-session storage. Normal, Ctrl/Cmd and middle clicks are supported. Browser context-menu opens, copied links, duplicated tabs and pre-existing search tabs are not adopted; collect those manually. Switching the selected engine does not change ownership of tabs already opened for the project.

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

For development with Mozilla's `web-ext` tool:

```sh
npm run lint:firefox
npm run dev:firefox
```

`dev:firefox` launches a temporary installation. Rebuild after editing `src/`; the running tool watches the generated output. These commands use the pinned web-ext 10.8.0 through npm exec; a global installation is unnecessary. The first invocation needs internet access to populate npm's tool cache.

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
| `manifests/common.json` | Common name, permissions, interface and CSP |
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

Produces `dist/packages/bootcat-chromium-2.0.0.zip` and `dist/packages/bootcat-firefox-2.0.0.zip`, each with its manifest at the ZIP root. Individual commands: `npm run package:chromium` and `npm run package:firefox`. Packages exclude development fixtures.

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

The former 500-URL and 100 MiB batch caps are removed. Above the URL warning threshold (500 by default, configurable in Settings), an inline warning explains that downloading, reviewing, exporting and browser-storage use may suffer. Per-file and extraction limits remain. Browser storage capacity is finite; if a write fails, processing stops with a useful message and previously committed documents remain intact. Stored originals, text, metadata and progress are committed atomically. A full reset also fences off writes from an old project. Queued pages from the old capture database migrate without loss; content held only in a pre-upgrade workspace's RAM cannot be recovered after reloading, so export it before updating.

Closing the workspace stops active network work. Reopening restores completed results and offers Resume downloads; it does not silently start downloads. One cross-window lock prevents competing download/import/export runs. The preview starts blank and reads only its chosen text from storage. Trash removes all stored versions of a page, and New project clears the database and extension-local project state.

ZIP export reads stored files one at a time for CRC calculation and assembles native Blob references, rather than making an array of all document buffers/texts in JavaScript. It supports ZIP64 counts/offsets. Browsers still impose native Blob, memory and storage limits, so very large exports can fail; the stored project remains intact. Export Corpus produces the corpus output; Save Project produces a complete, reopenable .bootcat snapshot. IndexedDB data remains local to the browser profile, may be cleared/evicted, and is removed when the extension is uninstalled; it is not cloud-synced or guaranteed permanent.

## Projects and review

When no project is active, the startup chooser offers **Open Project**, **New Project** and **Close BootCaT**. Cancelling creation returns to this chooser. The Project section opens after creation/opening and on workspace load; other sections start collapsed. Its name is read-only until **Rename** opens a dialog. Project actions appear as New Project, Open Project, Save Project and Close Project, followed by Export Corpus. The former Save section and navigation item are removed.

BootCaT keeps one active project in browser storage. **Save Project** downloads a complete `.bootcat` ZIP snapshot. **Open Project** validates that file before replacing the active project. The replacement/close prompts offer Save Project first, Continue and Cancel. Files are ordinary downloads: each save may create a new copy, and opening a file does not link subsequent saves to that original file.

**New project** asks for a name and shows a clearing warning in its dialog, then replaces all extension-local project data: the name, saved search collections, URL list, pending snapshots, downloaded files, corpus texts, selections, progress and preview. Open workspaces and popups reset to the new project. Active downloads are cancelled; search/capture requests from the old project cannot populate the new one. Previously exported files on your computer are unaffected.

**Collect results from this tab** adds collected URLs to the download list automatically and opens a background workspace if needed. New URLs wait until an active batch finishes, and duplicates are skipped. Existing manual edits are preserved. There is no hard URL-count limit. Lists above the configured threshold (500 URLs by default) display a performance/storage warning; larger lists are still allowed without confirmation. Search collection metadata retains its separate provider-neutral limits.

Review separates documents with usable text from **Documents needing attention**: download errors, extraction failures, unsupported formats and textless/scanned PDFs. Successful recoveries return to the main list. The attention block disappears when all problems have been recovered or deleted. Unchecking Include keeps usable documents in the main list. **Export Corpus** is in Project; originals and corpus-output behavior remain unchanged.

**Preview text** stays blank until a Preview text button is clicked. The selected document row is highlighted in either list; selecting another preview moves the highlight, and deleting the selected document clears it. The section heading remains fixed and the selected page is identified below it.

The **Include** checkbox controls corpus inclusion while retaining original files. The trash button on the right instead asks for confirmation and deletes that page's text, original files (including previous captures), and download metadata from the review list and future exports. It also removes the URL from the download list and clears the preview if it displays that page. Saved search provenance remains in the search collections. Delete buttons are disabled while downloads or imports are running.

On detected search results pages, only the collection action is shown; corpus capture is hidden. The popup also checks current-project corpus metadata and pending capture keys each time it opens. Already downloaded, captured or locally imported pages show **Page already added to corpus** in place of the capture action, including matching redirect URLs and fragment variants. Unchecking Include retains the saved state; deleting the document or creating a new project allows capture again. Failed downloads do not count as saved. The background repeats this check to prevent duplicate captures from stale popups. After collection, that action and its explanatory text are replaced by a green **Results added** message, including when reopening the popup on the same results URL. A different results page remains collectable. Clearing searches or starting a new project resets this state.

## Save a page already open in the browser

In **Review and export**, each URL opens in a new tab. Failed downloads display instructions for opening the page, completing any CAPTCHA or sign-in, and saving it through the toolbar; the original error appears at the end in parentheses and remains in download metadata. If a download fails because of a CAPTCHA, open that link and complete the challenge yourself. Click the BootCaT toolbar icon → **Add page to corpus**. The action and its explanatory text are replaced by a green **Page already added to corpus** message. Save errors leave the button enabled for retry.

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

## Search tab status

Query rows show Not opened, Loading, Loaded, Needs attention, Collected, or Closed without collecting. The **Open search tab** icon before each query brings its tracked tab into view. Loaded means the browser finished loading; it does not guarantee usable results or absence of a CAPTCHA. All indicators are limited to project tabs opened through BootCaT; no additional permissions are needed.

Collection waits until all tracked tabs finish loading and batch opening finishes. A manually closed tab stops blocking collection and can be reopened through its query link. After 30 seconds of loading, **Collect loaded tabs** allows collecting the finished tabs while leaving loading tabs open. Unloaded tabs need manual attention. Successful popup collection also updates the matching query to Collected without closing its tab. Partial popup collection shows Needs attention. Collection failures, challenges and partial results keep their tabs open for inspection and retry; successful collection saves results before closing. Tab ownership and transient outcomes survive closing/reopening the workspace within the browser session, and clear on a new project or browser/extension restart. Fully saved query completion is restored from the project’s saved search provenance.

## Workspace dialogs and logs

Running all queries, deleting a document and clearing saved searches use a shared styled confirmation dialog with action-specific buttons, Cancel as the initial focus and Escape to cancel. The browser controls its own leave-page warning and file picker. The collapsible **Log** section at the bottom contains project tab collection details, saved-result review and search JSON export; its top navigation link appears before Help. Log starts collapsed on reopening the workspace and creating a project.

## Corpus files and metadata export

All downloaded, captured and imported originals export directly into `pages/`; selected extracted texts export directly into `corpus/`. Raw PDF text remains in `raw-pdf/`. Captures already saved with older nested paths are flattened at export time, with collision-safe names. Stored blobs are not renamed. ZIP JSON metadata and the Excel export use the same mapping; acquisition method remains in metadata.

Every corpus ZIP includes **Report.xlsx** at its root, with one row per included, successfully extracted corpus text, sorted by text filename. Columns contain the text filename, clickable HTTP(S) source URL, numeric character count and detected language name. Uncertain assessments show **Uncertain**; disabled or absent checks show **Not checked**. Accepting a language warning does not change the detected language. The workbook has filters and a frozen header, is generated locally using the existing ZIP writer and adds no dependencies or permissions. Report generation uses saved metadata only, without additional reads of document bodies.

Every corpus ZIP also contains UTF-8 `url_list.txt`, `seeds.txt` and `tuples.txt` at its root. These preserve the current editable project lists, including manual edits; empty lists produce empty files. `Report.xlsx` contains a header-only sheet if no texts are included. There is no separate report download button.

## Release version

`package.json` → `version` is the single release-version setting. This release is `2.0.0`, displayed as **BootCaT · 2.0** in both badges. Browser manifests and ZIP package filenames take the version from `package.json` during build. Badges and exported JSON read it from the installed manifest at runtime. Storage schema and third-party library versions are independent.

For the next release, run `npm version 2.1.1 --no-git-tag-version` (substitute the intended version). This updates `package.json` and the npm-managed lockfile together without creating a Git tag or commit. Then run `npm run build` and reload the installed extension. Use three numeric components without a prerelease suffix. Do not edit generated files in `dist/` or add version fields to browser manifest templates.

## Contextual popup

**Open BootCaT** is always the prominent full-width action. Until project setup is confirmed, the popup asks the user to create a project and hides both collection/capture actions. Named projects show a smaller collection button on supported search pages or a smaller capture button on eligible ordinary pages. Completed actions show only their confirmation; unrelated headings and hints are hidden. Unsupported tabs show a short explanation. Busy actions stay visible and disabled as **Collecting…** or **Saving…**; operation failures restore the action for retry. Project changes hide old actions and reload the popup, and action messages carry the current project ID.

Popup typography and spacing are explicit across browsers. Both the root and body have an explicit preferred width with a shrinking maximum. Firefox measures the body for toolbar-popup sizing, so constraining the root alone is insufficient. Horizontal overflow is prevented. Long messages or smaller panels retain vertical scrolling. `npm run test:popup` checks the real popup document at normal and constrained sizes, including intrinsic body-width probes, in Chromium and Firefox, using extension-API fixtures. These layout checks do not install the Firefox add-on or exercise the browser-owned toolbar panel; visually check the actual toolbar popup when testing a release.

## Licence and publication

Original BootCaT extension code is Copyright © 2026 Eros Zanchetta and licensed under
GPL-3.0-or-later; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Bundled libraries/fonts
retain their own notices. Collected documents retain their respective rights.

The workspace footer links to a local About, privacy and licence page. Searches and
downloads contact the selected engines/source websites; corpus processing stays local.

`npm run package` now also creates a matching `bootcat-source-<version>.zip`. Before
Mozilla submission, follow [the release checklist](docs/MOZILLA-SUBMISSION.md) and
complete [the listing draft](docs/MOZILLA-LISTING.md). Public releases need a publicly
accessible matching source download; sending source privately to AMO reviewers is
not the same as making it available to recipients.

## Chrome Web Store submission

Follow [the Chrome checklist](docs/CHROME-SUBMISSION.md) and
[listing draft](docs/CHROME-LISTING.md) for the first Chrome submission.
`npm run package:chromium` creates the Chromium extension ZIP, corresponding source ZIP,
and a standalone `dist/packages/bootcat-privacy.html` page for public HTTPS hosting.
`npm run export:privacy` creates just that policy page from the privacy section in
`src/about.html`, without installing PDF.js. The policy is not published automatically.
This packaging addition does not change the installed extension or its version.


### Personal settings and limits

Settings is immediately after Help in the icon-and-label workspace menu. It uses a native dialog with Save settings, Cancel and Restore defaults. Restore defaults changes the draft until saved; Cancel and Escape discard it. Main controls cover file size (50 MiB), PDF pages (300), URL warning threshold (500), HTML/plain-text extraction size (3 MiB), download timeout (30 seconds) and PDF/DOCX extraction timeout (30 seconds). Advanced limits start collapsed and cover PDF text (2,000,000 characters), DOCX and edited text (10,000,000 each), manual HTML snapshots (2 MiB), HTML complexity (60,000 elements), collected search pages (100), and collected results (5,000). Values above their built-in defaults display contextual warnings. Numeric fields have finite whole-number ranges; defaults and ranges live in `src/settings.js`.

Preferences persist in browser-local extension storage independently of projects. Background-serialized, revision-checked saves reject stale settings drafts from other windows. Each batch, recovery/import, or edit save reads an immutable settings snapshot; changes affect subsequent operations and never reprocess saved text automatically. The URL threshold is a warning, with no URL-count cap. File size and extraction limits remain separate. DOCX ZIP/XML safeguards and browser storage quotas remain fixed. HTML extraction is synchronous and has no interruptible timeout. Browser-native storage, Blob and memory limits still apply even when a preference is increased. The older limit descriptions above document built-in defaults.


### Query batch lifecycle

Run all queries disables immediately while confirming/opening and stays disabled while every prepared query has an open tracked tab or completed collection. Missing, uncollected queries enable Run missing queries (N); No queries to open explains that tabs are elsewhere or results are already saved. Loading, unloaded and CAPTCHA tabs still count as open. Closing an uncollected tab permits retry. Successful collection remains complete after manual or automatic closure; partial results alone do not complete a query. Changed engines or full query filters are separate searches. Individual query links remain available for deliberate manual searches.

The UI waits for authoritative tab state on workspace opening and refreshes it before each batch. Every batch opening also checks the current state inside the background's serialized queue, preventing two workspace windows from opening duplicate batch tabs. Session revisions prevent late replies from undoing newer closure state. Fully saved search provenance restores collected status when session history is cleared; ownership of open tabs still follows the existing browser-session rules. Project replacement resets search history and collections. Stopping or a browser error leaves only the missing queries eligible for the next attempt.


### Collection controls and floating actions

The popup has independent Close tab after success switches for search collection and individual-page capture, plus Show floating controls and a four-corner position selector. All three switches default off and position defaults to top-right. These browser-local preferences survive popup closure, project replacement/closure and browser restart. The floating strip shows the contextual action, Open BootCaT and Hide icons, with immediate tooltips and keyboard labels. Hide disables floating controls globally until re-enabled from the popup. Preferences and page/project changes update already-open tabs; navigation and new tabs receive the same controls. No active project, an unsupported document/viewer, or an already-saved page suppresses the strip. After a successful action it briefly shows a checkmark; errors and partial collection remain available to inspect/retry.

Popup and floating actions run in the background. Collection closes only after complete results are stored. Capture success means the original HTML/PDF snapshot is durably saved in the inbox or project, even if extraction is pending or later produces an issue. A page waiting in the inbox is already saved for popup/overlay duplicate checks. Navigation, reload, unloading, project changes, failed saves and partial collection prevent automatic closure. Closure failures preserve success and explain that the tab remains open. Repeated simultaneous actions on the same document share one operation. Collection also updates query tracking before optional closure.

Floating scripts are dynamically registered using existing scripting and HTTP/HTTPS host permissions, are top-frame only, and use an isolated closed shadow root. The background accepts a narrow set of content-script messages, derives tab identity from the browser-supplied sender, rejects stale projects and does not allow content scripts to call project/settings APIs. Action handlers ignore synthetic page-script clicks. No remote scripts/styles/fonts are loaded. Snapshot capture removes the control host and excludes it from page-complexity accounting. Protected browser pages, stores and built-in viewers retain the popup fallback. Firefox ESR 140 stylesheet adoption uses a page-realm array of native stylesheet reflectors via cloneInto; no functions or extension state are exported.

## Portable projects (Package 3)

Save Project includes every project store: drafts, seeds/tuples/prepared queries, search collections, completed and failed document records, inclusion decisions, all retained originals, current edited texts, baseline extractions, raw PDF text and pending page captures. Local settings, excluded-site defaults, collection-control preferences, live tab identities and running jobs do not travel. Draft search exclusions do travel as project data. Imported projects get a fresh local identity; completed searches are reconstructed from saved results, and no search tabs/downloads are automatically started. Pending captured pages use the normal local extraction workflow after opening.

The versioned UTF-8/JSON + STORE ZIP/ZIP64 format is specified in [docs/PORTABLE-PROJECTS.md](docs/PORTABLE-PROJECTS.md). No browser-specific serialization is used. Save waits for draft writes and requires idle processing and no unfinished text edit. Archive validation checks paths, checksums, references and required metadata before replacement; the active database is replaced atomically, so failed writes roll back. Native Blob references avoid buffering all original files in JavaScript. Browser storage/Blob capacity still applies; insufficient space is reported without discarding the existing project.

`npm run test:portable` exchanges project files between native Chromium and Firefox in both directions. The full Chromium suite also exercises Save/Open, the file chooser, damaged imports, cancel/replacement, Save Project first and the inactive startup chooser. CI uses the official Playwright v1.62.1 Noble image; update its tag together with the exact Playwright dependency. Browser tests run as the image's `pwuser`, avoiding Firefox's root/home-ownership launch mismatch.

Save Project prepares an independent native download Blob before handing the archive to the browser. This avoids Firefox download failures with database-backed document streams after temporary snapshot cleanup. The native archive copy may require extra browser memory/storage; original files are still streamed without a project-sized JavaScript ArrayBuffer. Portable browser tests now exercise actual completed `.bootcat` downloads in both engines, including a 12 MiB persisted original after project import.

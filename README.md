# BootCaT extension

A local corpus-building extension with one shared JavaScript/HTML/CSS codebase and separate Chromium and Firefox builds. Search collection, downloads, Readability, Defuddle, ZIP export, your popup wording, blue palette and logo are shared.

## Updating from the original repository layout

Before switching your installed extension, save pending download ZIPs and export saved searches. The generated folder is a different extension path in Chrome, so it can create a new extension identity with separate local storage. Keep the old instance until you have saved the data you need. Firefox and Chromium always have separate extension storage. This version does not automatically migrate/import project data.

After merging the structural change, pull it in VS Code, then build from the repository root:

```sh
npm run build
```

The repository root no longer contains a loadable manifest. Edit `src/`, rebuild, and load the matching generated folder below. Do not edit `dist/`: the next build replaces it. No npm dependency installation is needed for normal builds.

## Requirements

- Node.js 20+ for building and packaging. Node is a developer tool; extension users do not need it.
- Target browsers: Chromium/Chrome 120+ and Firefox desktop 140+ (including Firefox ESR 140). These are declared targets; see validation limits below.
- Python 3 additionally for one optional automated ZIP compatibility test.

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
4. Return to the workspace, review saved results and add collected URLs to the editable download list. Manual URL pasting is always available.
5. Choose Readability (default) or Defuddle before starting the batch.
6. Download, review text previews and inclusion checkboxes, then Save ZIP.

Google, DuckDuckGo and Ecosia use separate adapters. In the Google layouts tested so far, sign-in was necessary to expose usable destination URLs. Opaque redirects are skipped with a warning. Switching providers retains earlier collections and provenance.

The ZIP retains originals in `pages/`, selected UTF-8 texts in `corpus/`, and `results.json`, `extraction.json` and `searches.json`. Search collections persist locally; downloaded bodies, extracted texts and the editable URL list remain in memory. Keep the workspace open until the ZIP is saved. PDF conversion is not implemented.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/` | Shared application modules, HTML and CSS |
| `src/extension-api.js` | Prefer `browser.*`, fall back to the supported Chromium `chrome.*` APIs |
| `src/background.js` | The same message/collection handler for both browser contexts |
| `src/engines.js` | Search provider detection and DOM adapters |
| `src/extraction.js`, `src/corpus.js` | Text extraction, inclusion and corpus export |
| `src/icons/`, `src/vendor/` | Shared logo, icons and bundled extractors/licences |
| `manifests/common.json` | Common name/version, permissions, interface and CSP |
| `manifests/chromium.json` | Chromium minimum version and module service worker |
| `manifests/firefox.json` | Firefox module background scripts, stable ID and minimum version |
| `scripts/` | Dependency-free Node build and ZIP packaging; optional browser smoke test |
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

No npm packages are required for these tests. They cover URL validation, downloading, encoding, extraction boundaries, corpus selection, library hashes, ZIP compatibility, API namespace selection, background messaging with both API namespaces, and the generated builds. Python 3 is used by the independent ZIP reader test.

Builds are checked for matching shared files, the correct manifests, required assets and safe replacement of generated output. Message tests simulate the Firefox namespace/scheme and the Chromium namespace/scheme; they do not substitute for live Firefox testing.

For real browser-DOM extraction fixtures, build with tests included:

```sh
node scripts/build.mjs all --with-tests
```

After loading a generated extension, open the workspace and replace `downloader.html` at the end of its address with `tests/browser-tests.html`. Nine offline checks exercise both real extractors, Unicode, structural boundaries and script inertness. Standard builds omit this page.

An optional automated Chromium smoke test uses Playwright. Install the developer-only tooling when needed:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

The smoke test builds into a temporary folder/profile and routes all web requests to local fixtures. It checks the extraction page, actual script injection into a mock Google page, saved searches, download/extraction/ZIP with both extractors, workspace reuse and persistence. It never contacts real search engines. `CHROMIUM_EXECUTABLE_PATH` can select an existing compatible Chromium binary.

**Validation in the build environment:** all unit/build tests and both ZIP packages passed. Live Chromium testing was attempted but the environment blocked browser startup (`socket() failed: Operation not permitted`). Firefox is not installed here. Live browser smoke tests and minimum-version verification therefore remain to be performed on a machine that can run the browsers. The optional smoke script is included but has not completed here.

## Projects and review

The **Project name** field at the top is saved locally and used in the corpus ZIP filename, `project.json`, and export metadata. BootCaT currently has one active project; downloaded content and selections still live in the workspace tab, so export before closing it.

**New project** asks for confirmation, then clears all extension-local project data: the name, saved search collections, URL list, pending snapshots, downloaded files, corpus texts, selections, progress and preview. Open workspaces and popups reset to the new project. Active downloads are cancelled; search/capture requests from the old project cannot populate the new one. Previously exported files on your computer are unaffected.

**Collect results from this tab** adds collected URLs to the download list automatically and opens a background workspace if needed. New URLs wait until an active batch finishes, and duplicates are skipped. Existing manual edits are preserved. The download list retains its 500-URL limit; saved searches can still be exported if a collection would exceed it.

**Preview text** stays blank until a Preview text button is clicked. The section heading remains fixed and the selected page is identified below it.

The **Include** checkbox controls corpus inclusion while retaining original files. The trash button on the right instead asks for confirmation and deletes that page's text, original files (including previous captures), and download metadata from the review list and future exports. It also removes the URL from the download list and clears the preview if it displays that page. Saved search provenance remains in the search collections. Delete buttons are disabled while downloads or imports are running.

## Save a page already open in the browser

In **Review and export**, each URL opens in a new tab. If a download fails because of a CAPTCHA, open that link and complete the challenge yourself. Click the BootCaT toolbar icon → **Save current page**. The button stays disabled and a green **Page saved** message confirms success. Save errors leave the button enabled for retry.

The snapshot is added to the review list automatically, using the selected Readability or Defuddle extractor without another network request. If the workspace is closed, it opens in a background tab. If downloads are running, the snapshot waits until the batch finishes. A snapshot matching an existing URL (or a successful download's final redirect URL) replaces its review row and corpus text. Earlier raw files and attempt metadata remain in the ZIP; metadata identifies browser captures and their capture times. If navigation changes the URL, the snapshot is added as a separate document.

Snapshots contain the rendered top-level HTML, with scripts, frames, editable controls and event handlers removed. They are UTF-8 and are not complete offline copies: external assets, shadow DOM and embedded frames are not bundled. Review the extracted text before including it. The extension does not solve CAPTCHAs or determine whether a challenge is complete. Browser-protected pages and PDFs cannot be captured.

A local IndexedDB inbox retains snapshots until the workspace imports them, then removes each imported snapshot automatically. Limits: 2 MiB / 60,000 elements per snapshot; 20 pages and 20 MiB awaiting import; 100 MiB per workspace batch. If import fails, remaining snapshots stay available for retry when the workspace regains focus or a new batch finishes. Export before closing the workspace or starting another batch: the review list, extracted texts and selection state are held only in that tab.

The optional Chromium smoke test also checks failed-download recovery, snapshot cleanup and automatic import. Native browser execution remains blocked in this build environment; these checks must be run locally.

## Collaboration

GitHub is the source of truth. Pull before editing, commit and push your changes in VS Code. After merging an assistant pull request, pull locally, run the appropriate build and reload the installed generated extension. The source files are now under `src/`; the generated folders stay out of Git.

See [collection/extraction details](docs/PIPELINE.md) for limits, provenance and provider behaviour, and [vendored libraries](src/vendor/README.md) for versions/licences.

## Official references

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/

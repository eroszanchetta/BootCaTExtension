# Mozilla Add-ons submission — BootCaT 2.0.1

Prepared 14 November 2026. This is a submission checklist, not a claim of approval.

## Build the upload files

Use Node.js 24 LTS and npm, with an ordinary internet connection for npm installation:

```sh
npm ci
npm test
npm run package
npm run lint:firefox
```

`npm run package` builds both browser extensions and the corresponding source ZIP:

- `dist/packages/bootcat-firefox-2.0.1.zip`: Firefox extension to upload to AMO.
- `dist/packages/bootcat-source-2.0.1.zip`: source archive to supply to reviewers.
- `dist/packages/bootcat-chromium-2.0.1.zip`: separate Chrome package; do not upload it to AMO.

Version numbers follow package.json. Do not upload the GitHub repository ZIP as the extension.
The source package has an explicit allowlist and excludes node_modules, dist, browser profiles
and Git data. It contains sources, tests, pinned dependency lockfile, licences and this guide.
`npm run package:source` creates just the source archive without requiring installed PDF.js.

## Submission steps

1. For the existing BootCaT listing, open **Manage Status & Versions** and upload a new
   version. Do not create another listing. For a first submission only, choose **On this site**
   at https://addons.mozilla.org/developers/addon/submit/distribution.
2. Upload the Firefox ZIP. Resolve validation errors and inspect warnings before continuing.
3. Select desktop Firefox on Windows, macOS and Linux. Android has not been tested or supported
   by this release; do not select it.
4. Supply the matching source ZIP and the reviewer instructions below when requested.
5. Use the listing draft in MOZILLA-LISTING.md. Publisher: Eros Zanchetta, independently.
6. Select GPLv3 or the custom GPL-3.0-or-later wording if needed so the store licence agrees
   with LICENSE. Keep the third-party notices in the package.
7. Set the support email to **bootcat@dipintra.it** and add screenshots from Firefox.
   Use the privacy policy in src/about.html for the privacy field; if a URL is requested,
   host the same policy publicly. The source repository is now public at
   https://github.com/eroszanchetta/BootCaTExtension. A public source-code link does not
   replace a readable privacy-policy page when a policy URL is requested.
8. Make the matching source archive publicly downloadable alongside the release, or publish
   the repository and release tag. An AMO source upload is for reviewers and does not by itself
   make source available to users. Put that public source link in the listing.
9. Review the final listing, disclosures and permissions before submitting for review.
10. Once 2.0.1 is accepted, disable the old 2.0.0 version if it is still available. That
    package still declares Android support. Disable only the old version, not the entire
    BootCaT listing. Keep the same add-on ID for the new upload.

No extension signing credentials or account passwords belong in this repository.
The publisher must complete the developer agreement and account-specific declarations.
If this first public version is intended for beta testing, consider AMO's experimental flag.

## Listing data disclosures

The Firefox manifest declares required browsingActivity, searchTerms and websiteContent.
BootCaT sends user-requested queries to the selected engine, URLs/request information to
source websites, and may use same-site session cookies when retrying a PDF from a browser tab.
It sends no corpus, document text, project database, analytics or telemetry to its developer.
All extraction and language detection are local. Normal site requests still disclose an IP
address to the receiving site. Do not describe BootCaT as making no network requests.

The minimum desktop Firefox version is 140, which supports the built-in consent prompt.
The manifest intentionally omits browser_specific_settings.gecko_android. Its presence
would declare Android compatibility and lock AMO's Android controls. Android has not been
tested and must not be declared supported merely to silence a validator warning.
The Firefox manifest sets incognito to not_allowed: private-window pages cannot be saved
into the persistent corpus. No optional telemetry is implemented. The local About/privacy page is linked in the workspace
footer. Keep the listing and privacy policy consistent with the actual release behaviour.

## Reviewer notes — copy into the submission

BootCaT is a local corpus-building tool. No BootCaT account or paid API key is required.
Please test with DuckDuckGo or Ecosia; Google can require its own login and/or CAPTCHA.
BootCaT does not bypass CAPTCHAs. Query pages are opened only by user actions.
Only search tabs opened through the current project's links are tracked for batch collection
and closure. The popup also supports explicitly collecting a single current result page.

A minimal test:

1. Install in desktop Firefox 140 or later. Open the toolbar popup and click Open BootCaT.
2. Name a project and select No language detection. Sections start collapsed.
3. Expand Seeds & Tuples, enter five seeds (e.g. renewable energy, solar, wind, storage,
   electricity), generate a few tuples and create search queries. Select DuckDuckGo.
4. Open an individual query or use Open all queries after its warning. Wait for loading
   badges, then collect results and close project search tabs. The URLs section opens.
5. Alternatively paste https://www.iana.org/help/example-domains into URLs. Download URLs.
   Review extracted text with Preview text, then Save corpus. The ZIP includes text files,
   original documents, Report.xlsx, url_list.txt, seeds.txt and tuples.txt.
6. Visit an ordinary HTML page and use Add page to corpus from the popup. Reopen the popup:
   it should report Page already added to corpus.
7. Test PDF/DOCX by downloading a publicly accessible file, or import a locally downloaded
   file for a failed row. Scanned PDFs without a text layer need attention; OCR is absent.
8. Optionally select a project language and recheck texts; mismatches/uncertain detection
   move to Documents needing attention. Deleting a document asks for confirmation.

Broad HTTP/HTTPS host access is needed because users can supply arbitrary document URLs
and collect/capture pages from arbitrary sites. activeTab and scripting read relevant page
DOMs following explicit user actions; storage holds local project data/preferences. There
is no cookies or history API permission and no unrelated browsing-history collection.
No remote executable code is loaded. PDF.js, its worker, character maps and fonts are local;
PDF JavaScript and WebAssembly execution are disabled. Page scripts are not executed during
HTML extraction. Imported files are processed locally without server upload.

## Reproducing the submitted package from source

Unzip the source archive into a clean directory, use Node.js 24 and run:

```sh
npm ci
npm run package:firefox
```

Compare the contents of dist/firefox with the uploaded extension ZIP: there should be no
file-content differences. The build copies shared src files unchanged, injects package.json's
version into the merged Firefox manifest, copies LICENSE/NOTICE, and copies the exact locked
pdfjs-dist assets. No timestamps or absolute paths are injected into extension files.

Third-party provenance:

- Readability: unmodified release 0.6.0, https://github.com/mozilla/readability/tree/0.6.0;
  exact source URL and SHA-256 in src/vendor/README.md.
- Defuddle: unmodified dist/index.js from official npm package defuddle@0.19.0, renamed
  Defuddle.js. Readable upstream source: https://github.com/kepano/defuddle/tree/0.19.0.
  Version and exact bundle hash are in src/vendor/README.md. The official npm package can
  be downloaded with `npm pack defuddle@0.19.0` to compare package/dist/index.js.
- franc 6.2.0 and three MIT-licensed helpers: pinned readable sources and SHA-256 hashes
  are listed in src/vendor/franc/sources.json. Only three runtime import specifiers were
  rewritten to browser-local paths: franc's `trigram-utils` becomes `./trigram-utils.js`;
  trigram-utils' `n-gram` becomes `./n-gram.js`; its `collapse-white-space` becomes
  `./collapse-white-space.js`. Data/algorithms are unchanged. These transformations are
  disclosed for review, not an independent fork. The source ZIP contains the readable
  adapted code and exact upstream release URLs.
- PDF.js: official npm pdfjs-dist@6.5.438, installed through the locked npm dependency.
  Readable source: https://github.com/mozilla/pdf.js; the package identifies its upstream
  source revision. The build uses only its local legacy modules, cmaps, standard_fonts
  and licence files. Font notices remain in the copied upstream folders.

All original code is plain JavaScript, HTML and CSS; it is not minified or transpiled.
Defuddle/PDF.js include generated upstream bundles, hence the source archive and release
references. Dependencies needed for building are obtainable through npm with npm ci.

## Extension identity and support

The submitted Firefox extension ID is `bootcat-extension@bootcat.dipintra.it`.
It is an identifier in email-like syntax, not a support mailbox. Keep this ID for every
update to preserve the existing listing and extension identity. The actual support email
is **bootcat@dipintra.it**, which belongs in AMO's support field and the local About page.

## Automated validator warnings to explain to reviewers

The validator may report KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION because the
desktop minimum is 140 and data consent arrived on Android in 142. This release does not
declare or target Android. Keep the desktop minimum and omit gecko_android; declaring
Android support to suppress that warning is incorrect.

Readability and Defuddle use innerHTML internally while manipulating detached documents.
BootCaT removes active elements before extraction, never inserts extracted HTML into its
UI, and displays only text. Its CSP also blocks remote resources and frame/object loads.
PDF.js includes Function-constructor feature detection, legacy DOM helpers and other code
shared with rendering. BootCaT uses getTextContent only, explicitly sets isEvalSupported
and useWasm to false, uses a local worker, and has no unsafe-eval in its CSP. These upstream
files are kept unmodified for provenance; do not remove scanner findings by editing them.
Review all warnings for the submitted version rather than assuming an automatic pass is
Mozilla approval. The CI job prints the full validator report.

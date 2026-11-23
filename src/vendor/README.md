# Vendored Mozilla Readability

Source: https://raw.githubusercontent.com/mozilla/readability/0.6.0/Readability.js
Retrieved: 2026-11-14.
Official tagged release: 0.6.0.
SHA-256 of bundled Readability.js: 34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174

The source is unmodified. LICENSE-Readability.md and NOTICE-Readability contain its upstream license and notice. This file is a local dependency: no code is fetched at runtime. Load as a classic script before app.js; the library exposes window.Readability.

When updating, replace the source and notices from upstream, review changes, rerun extraction checks and update this hash plus EXTRACTOR_VERSION in extraction.js.

# Vendored Defuddle

Version: 0.19.0
Source: official `defuddle-0.19.0.tgz` package supplied by the user.
Browser core bundle: `package/dist/index.js`, copied unchanged to `Defuddle.js`.
SHA-256: 9b61869627a459bddca398d0136f4de7115577f2f9f01eac4b4fb0a88571e1df
License: `LICENSE-Defuddle` (MIT), copied unchanged from the package.
The UMD bundle exports `globalThis.Defuddle` as a constructor.
No CLI or npm dependencies are required for this browser bundle.
No remote scripts or asynchronous extractors are used.

# PDF.js build dependency

`pdfjs-dist` is pinned to 6.5.438 in package.json. Run `npm install` before building. scripts/build.mjs prepares the legacy pdf.mjs/pdf.worker.mjs with the documented, hash-guarded removal of obsolete core-js fallbacks in scripts/pdfjs-store-build.mjs, then copies cmaps, standard_fonts and the Apache-2.0 LICENSE into dist/<browser>/vendor/pdfjs/. See docs/PDFJS-STORE-BUILD.md (included as vendor/pdfjs/README-BootCaT.md in built extensions) for the exact changes and provenance. Font/CMap notices are included from their upstream folders. These generated assets are not committed under src/. The extension fetches no library code from a CDN. Text extraction uses an explicit local module worker with WebAssembly disabled and a CSP that disallows eval; PDF scripts are never executed. Both browser packages use the same assets.

Source: https://github.com/mozilla/pdf.js and the official pdfjs-dist npm package. Update the package pin and src/pdfjs-version.js together, review browser/Node compatibility and rerun unit/build plus real-browser worker tests.

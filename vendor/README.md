# Vendored Mozilla Readability

Source: https://raw.githubusercontent.com/mozilla/readability/main/Readability.js
Retrieved: 2026-11-09.
Upstream package.json reports 0.6.0. This is a snapshot of main, not a verified 0.6.0 release archive.
SHA-256 of bundled Readability.js: 87fd63ae01549bb9e19dc5778e5c867a2553d6c4e3bdd9c8f35fb6136c5676f1

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

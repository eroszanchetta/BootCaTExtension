# PDF.js package preparation for BootCaT 2.1

BootCaT uses the official `pdfjs-dist` **6.5.438** npm package, pinned in package.json/package-lock.json. Upstream: https://github.com/mozilla/pdf.js. The Apache-2.0 licence, original bundle notices, fonts and CMap notices are retained.

## Why the bundles are modified

Chrome Web Store reported **Red Titanium / Code Readability** for BootCaT **2.0.1**, identifying concatenated script-tag and JavaScript-URL strings in `vendor/pdfjs/pdf.mjs` and `vendor/pdfjs/pdf.worker.mjs`. The unmodified dependency used during 2.1 preparation also contained those constructs.

They belong to the bundled core-js `object-create` compatibility module, whose fallback creates an IE/ActiveX document or script-bearing iframe when native `Object.create` is unavailable. BootCaT supports Chrome 120+ and Firefox 140+, which supply native `Object.create` and `globalThis`. These historic fallbacks are unnecessary for every supported browser.

## Exact modifications

`scripts/pdfjs-store-build.mjs`, called by the normal build, replaces exactly two core-js module bodies in **both** legacy bundles:

1. `internals/object-create.js`: export native `Object.create`; remove its obsolete IE/ActiveX/iframe fallback and associated string construction.
2. `internals/global-this.js`: export native `globalThis`; remove historic environment discovery, including its dynamic `Function` fallback.

The webpack module names and lazy wrappers are retained. Modified modules are explicitly marked with BootCaT comments. The rest of each bundle is preserved. Other compatibility features remain, avoiding a switch to the modern PDF.js build or an increase to minimum browser versions.

There is no runtime patch, code download, encoded replacement, CSP relaxation or modification of node_modules. Both browser packages receive the same readable output. PDF extraction still uses the explicit local module worker with `isEvalSupported: false` and `useWasm: false`.

## Reproducibility and checks

The transformation refuses unknown input. SHA-256 digests of the complete, unmodified upstream files:

| Upstream legacy file | SHA-256 |
| --- | --- |
| pdf.mjs | 2792b7c390ad6d5f4245d326b70deebbc990fa4bcac691412f6df886abb9e867 |
| pdf.worker.mjs | 8336aabf764cb08c818555a2fd2545e4fed10837146de927564875c93b3c4f83 |

Any dependency update requires reviewing these modules and deliberately updating the guard. The build checks both prepared bundles for the rejected constructs, obsolete script/ActiveX helpers, literal dynamic Function calls and eval calls. Tests compare prepared files against the normal browser builds, check fail-closed behavior on altered input, and exercise actual PDF extraction through the prepared main library and worker. Playwright covers the real local extension worker and PDF corpus workflows.

To reproduce from the source distribution with Node.js 24 LTS:

```
npm ci
npm test
npm run package
```

This document is copied to `vendor/pdfjs/README-BootCaT.md` in each built extension. Source, tests and the preparation script are included in the matching source ZIP. See CHROME-SUBMISSION.md for the reviewer explanation and final packaged-file verification. These checks address the identified code; store approval remains a separate review.

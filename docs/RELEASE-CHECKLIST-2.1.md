# BootCaT 2.1 release checklist

Prepared 21 November 2026. Target package version: **2.1.0**, display version **2.1**.
This document records remaining release work, not completed store submission or approval.
Leave items unchecked until their evidence is recorded against the final release commit.

## Final source and version

- [ ] Merge the approved release PR and confirm all intended 2.1 changes are on main.
- [ ] Check both existing store dashboards: 2.1.0 must be available as a new version and higher than the published version. If already used, agree a new version and update package.json, package-lock.json and these instructions together.
- [ ] Record the exact final commit, Node/npm versions and build platform in the release record. Keep Chrome's existing store identity and Firefox's `bootcat-extension@bootcat.dipintra.it` ID.
- [ ] Review the [release notes](RELEASE-NOTES-2.1.md), listing drafts, privacy page and both submission guides. Do not describe store approval before it occurs.

## Clean build and automated validation

From a clean checkout of that commit, with Node.js 24 LTS:

```sh
npm ci
npm audit --audit-level=high
npm test
npm run package
npm run lint:firefox
npm run test:popup
npm run test:browser
npm run test:portable
```

Browser tests require the matching Playwright Chromium and Firefox installations. For a
new local test environment, install them using `npx playwright install chromium firefox`;
Linux may also require Playwright's documented system dependencies. GitHub CI supplies
the matching browsers through its pinned Playwright image. Automated Firefox popup tests
use extension-API fixtures; they do not replace checking the actual installed add-on.

- [ ] All automated checks pass for the final commit, including review of Firefox validator warnings.
- [ ] Both generated manifests use 2.1.0 and the intended desktop minimums (Chrome 120; Firefox 140). Firefox does not declare Android support.
- [ ] Verify the matching source archive builds file-identical extension contents in a clean directory using `npm ci` and `npm run package`; compare extracted extension files, not ZIP timestamps.
- [ ] Inspect the archives for a root manifest, matching licences/vendor notices, and absence of development fixtures or browser profiles.
- [ ] Preserve these exact final artifacts and record SHA-256 checksums before uploading:

| Artifact | Purpose |
| --- | --- |
| `bootcat-chromium-2.1.0.zip` | Chrome Web Store extension update |
| `bootcat-firefox-2.1.0.zip` | Mozilla Add-ons extension update |
| `bootcat-source-2.1.0.zip` | Matching readable source and build instructions |
| `bootcat-privacy.html` | Generated public privacy page; verify its hosted copy |

All artifacts are generated in `dist/packages/`. Do not upload the source ZIP as the
extension. Do not replace an artifact after recording its checksum without rebuilding,
rechecking and recording the replacement's identity.

## Manual final-package checks

Use copies of real test projects in disposable browser profiles. Preserve the production
installation and exported files. For upgrade testing, use the existing store installation
identity; a separately loaded unpacked/temporary extension is a clean-install test, not
proof that a store update preserves existing data. Record browser/OS versions and the
method used to test the update. If an identity-preserving update cannot be tested before
store review, record that gap and test it when a suitable signed/store build is available.

- [ ] Check the actual Chrome and Firefox toolbar popups, welcome order/focus, close-after-success switches on already-added pages, and supported/unsupported tabs.
- [ ] Complete a small corpus workflow using a live supported search engine: seed/manual queries, individual and batch opening, missing-query retry and collection. Confirm the short CAPTCHA warning appears for Run all/Run missing queries.
- [ ] Test optional floating controls, their positions, active-project visibility and save-before-close behavior.
- [ ] Download representative HTML, plain-text, PDF and DOCX sources; check extraction failures and manual recovery without discarding completed documents.
- [ ] Review/edit text, cancel an edit, save an edit, toggle inclusion and export the intended corpus. Check counters and retained originals.
- [ ] Save a project containing downloaded documents in Firefox, reopen it in Chrome, save again and reopen in Firefox. Check text, edits, inclusion and originals at each step.
- [ ] Verify Save Project feedback, disabled state for an unchanged project, Download again and reactivation after edits or new captures. Check the actual downloaded file; feedback confirms initiation only.
- [ ] Check unreadable Google link guidance in the popup and floating control, partial collections, a verification page that remains loading, and independent recovery of blocked sibling tabs. Never assume all tabs recovered merely because one did.
- [ ] Test Settings and a supported Google corpus-language filter; verify normal behavior with No language detection.
- [ ] Check existing-project/settings retention on upgrade from the currently published version, and restore a saved backup. Record any differences rather than claiming untested compatibility.

## Store materials and submission

- [ ] Refresh real screenshots of each browser's workspace, text review and popup.
- [ ] Confirm support email, public source link and a live HTTPS privacy-policy URL accessible without login. The hosted policy must match the generated policy.
- [ ] Review store disclosures against the uploaded manifests and actual requests, including user-requested searches/downloads, Google result-language preferences, and explicit PDF recovery using the website session.
- [ ] Update the existing Chrome and Mozilla listings with the matching package and version notes. Supply Mozilla's matching source archive and reproducible build instructions.
- [ ] Record submission/version IDs and artifact checksums. Inspect validator findings; store review is separate from CI validation.
- [ ] If coordinating launch dates, use Chrome's deferred publishing option and observe its dashboard deadline. Check Mozilla's actual publication controls; approval timing is independent.

## Publication

- [ ] After release approval, create Git tag `v2.1.0` at the tested final commit and a GitHub release with the release notes, exact packages, matching source and checksum record. If a different package version was required, use its corresponding tag instead.
- [ ] Complete store publication deliberately and record the actual publication dates and listing links.
- [ ] Verify each public listing shows the expected version and smoke-test a store-installed update. Review support reports before planning further changes.

Official references: [Chrome updates](https://developer.chrome.com/docs/webstore/update),
[Mozilla source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/),
[Playwright browser setup](https://playwright.dev/docs/browsers).

- [ ] Collect a Google page containing a Google Books result: the book URL is included without an unreadable-link warning.
- [ ] Collect partially readable results using the popup and floating control: new/duplicate counts are correct, Continue keeps the URLs, opens URLs and Build Corpus, and leaves the search tab open. Reopen the popup to verify the accepted state.
- [ ] Verify a failed collection offers a return to the workspace, and a successful collection offers Review URLs in the popup and floating control.
- [ ] Confirm the new Sbafo artwork appears in toolbar icons, workspace, popup and the leftmost floating button; heading counters remain visible when Search and Build Corpus are collapsed.

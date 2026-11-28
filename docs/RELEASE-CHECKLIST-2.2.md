# BootCaT 2.2 release checklist

Prepared 28 November 2026. Package version **2.2.0**, display version **2.2**. Version 2.1 is already published in both stores. This is preparation, not authorization to merge, tag, create a GitHub release, submit or publish in either store.

## Source and scope

- All intended WP1–WP7 changes and follow-ups are merged before this preparation branch. The release-preparation PR supplies the version bump and current release/store materials.
- [ ] Review and merge the release-preparation PR. Record the exact tested final source commit in the external release record.
- [ ] Confirm 2.2.0 is unused and greater than the existing version in each store dashboard; retain the existing listing identities. Do not silently choose another version if it is already used.
- [ ] Keep Chrome item `fpblhmfnjkhnijinpcemmnaplcmklbcb` and Firefox ID `bootcat-extension@bootcat.dipintra.it`. No permissions, minimum browser versions or dependencies change for this release.
- [ ] Review [release notes](RELEASE-NOTES-2.2.md), [known limits](#manual-and-known-limits) and both current submission/listing guides. Do not claim that detector accuracy was evaluated.

## Reproducible final artifacts

Use Node.js 24 LTS. Build from a clean committed snapshot, excluding untracked/private files, profiles and local handoffs. Do not modify the maintainer's uncommitted handoff. Use a temporary source-export directory rather than resetting unrelated work.

```sh
npm ci
npm audit --audit-level=high
npm test
npm run package
node scripts/verify-release-package.mjs
npm run lint:firefox
npm run test:popup
npm run test:browser
npm run test:portable
```

GitHub's pinned Playwright image supplies Chromium/Firefox. Browser-owned toolbar UI and store-installed upgrade behavior still require manual checks. Firefox DOM/API contract fixtures do not establish live Firefox native-detector accuracy.

- [ ] All checks pass against the final commit, including review of Firefox validator warnings.
- [ ] Both ZIP manifests are 2.2.0, Chrome minimum is 120 and Firefox minimum is 140; Firefox Android remains undeclared and private browsing remains disabled.
- [ ] Verify manifest identities, licences, the prepared PDF.js main/worker hashes and unchanged dependency/permission sets.
- [ ] Inspect all final archives for root manifest/source layout, notices and absence of `.DS_Store`, `__MACOSX`, profiles, development fixtures and uncommitted handoffs.
- [ ] Extract the matching source ZIP in a second clean directory, run npm ci/package, and compare every extracted extension filename and file byte with the release packages. ZIP timestamps are not the comparison criterion.
- [ ] Preserve the exact upload files with SHA-256 checksums, source commit, Node/npm versions, build platform, CI URL and reproducibility result in an external release record alongside the artifacts. Rebuilds invalidate that record until rechecked.

| Artifact in dist/packages | Purpose |
| --- | --- |
| bootcat-chromium-2.2.0.zip | Chrome Web Store update |
| bootcat-firefox-2.2.0.zip | Mozilla Add-ons update |
| bootcat-source-2.2.0.zip | Matching readable source and rebuild inputs |
| bootcat-privacy.html | Updated policy for public hosting |
| SHA256SUMS-2.2.0.txt | Checksums of the exact final artifacts |
| release-record-2.2.0.json | Commit/toolchain/validation identity; not part of the source archive |

## Manual and known limits

Use copies of projects in disposable profiles; preserve a `.bootcat` backup. Record browser/OS versions, source build and which checks were performed. A temporary/unpacked install does not prove an identity-preserving store upgrade.

- [ ] Actual Chrome and Firefox popups and welcome controls; top-right Settings × discards drafts, project-save closes, and default choices persist.
- [ ] Small live search/collection workflow, engine colors/defaults, tuple/URL navigation, DuckDuckGo appended results and Google unreadable-link guidance. Mark No results manually and rerun; do not auto-infer empty results.
- [ ] HTML/plain text/PDF/DOCX downloads, progress/completion states, cancellation/interruption, toolbar badge/title and dismissal. Resolve the last issue and confirm green completion.
- [ ] File picker/drop recovery, manual pasted text, Include anyway, hand tooltips, stable row order, reduced-motion highlight and preservation of source/edited text.
- [ ] Length bounds and clearing them, language/length interaction, explicit manual inclusion/exclusion, and all three detector strategies. Existing projects without the new field retain franc; switching strategy does not silently recheck.
- [ ] Recheck native detection in the installed Firefox extension. Inspect browser/version and fallback reasons. This is a functional check, not detector accuracy evaluation; evaluation remains a student/user activity.
- [ ] Export Corpus: first Report.xlsx sheet matches url_list.txt, excluded URLs remain separate, and Language detection includes all retained records and per-sample rows. Check the small surrounding export highlight and actual ZIP download.
- [ ] Portable round trip between the actual Chrome/Firefox installations, with originals, edits, detector choice, inclusion/overrides and stored assessments retained.
- [ ] Identity-preserving upgrade from store-installed 2.1 and backup restoration; record any unavailable signed-update test as pending until a suitable build is available.

Retained limits: no OCR or access-control bypass; PDF layout and short/mixed/names-heavy detection need review. Unknown original DDG candidates/intermittent absence remain unconfirmed. Built-in PDF viewers do not allow floating page controls. See RELEASE-NOTES-2.2.md and the 2.2 investigation documents. Bing/pseudo-XML and the maintenance package are outside this release's implementation.

## Submission and publication — separate authorization

- [ ] Confirm support address `bootcat@dipintra.it`, real screenshots, public matching source download and live HTTPS privacy-policy URL. The regenerated policy now describes locally saved browser/version detector diagnostics; update the hosted policy before submission.
- [ ] Review current dashboard disclosures against actual manifests and data handling. Readable source must match the uploaded package; see [Mozilla instructions](MOZILLA-SUBMISSION.md) and [Chrome instructions](CHROME-SUBMISSION.md).
- [ ] With authorization, upload to the existing items and record submission IDs, checksums and review findings. Do not infer store approval from CI.
- [ ] With separate authorization, tag the tested source commit as v2.2.0, create the GitHub release with exact packages/source/checksums, and publish stores deliberately. Record actual dates and public listing versions.
- [ ] Smoke-test the store-installed updates and review support reports. Then begin the agreed maintenance package before 2.3 feature development.

Primary submission references: [Chrome update process](https://developer.chrome.com/docs/webstore/update), [Mozilla source requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/). Store dashboards may change; verify their current controls when submitting.

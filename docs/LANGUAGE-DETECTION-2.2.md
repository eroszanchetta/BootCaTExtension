# WP7 — Selectable language detection and experiment reports

Authorized 28 November 2026. Accuracy evaluation is intentionally deferred to research/teaching experiments. Functional checks do not establish that one detector is more accurate. Botanical names are retained in the text; no scientific-domain whitelist, removal or special acceptance rule is introduced. No dependencies, browser permissions, minimum browser versions or app version change.

## Project selection and compatibility

Settings → This project offers:

- Native API with franc fallback (`native-franc`), the initial default for new projects.
- Native API only (`native`).
- franc only (`franc`).

The strategy travels with portable projects. Use as defaults for new projects saves it alongside extractor and length defaults. Old project drafts without a strategy mean franc only, preserving prior checks and behavior. Personal defaults do not override opened projects.

Changing strategy affects subsequent downloads, captures, imports and text edits. It does not replace stored language assessments. Recheck saved texts explicitly replaces assessments using the project's selected strategy, preserving the established manual-acceptance policy. Editing text still clears language acceptance for the old text. Language detection can still be disabled by selecting No language detection for the project language.

## Routing and browser coverage

The native adapter uses the extension `i18n.detectLanguage()` API, not the newer web AI LanguageDetector API. There is no external service or model download managed by BootCaT.

Coverage table version 1 maps browser CLD codes to ISO 639-3 and selects native detection only for verified project-language labels. Chrome uses the CLD3 output list; Firefox uses the CLD2 list. This is a source-based coverage snapshot, not an accuracy guarantee or a runtime enumeration API. Unknown browser families and unverified targets use franc in fallback mode. Native-only reports an unavailable review warning instead.

Broad native labels are not silently narrowed to franc's individual-language labels. For example Arabic (`ara`) is not automatically Standard Arabic (`arb`), Chinese (`zho`) is not Mandarin (`cmn`), and Norwegian (`nor`) is not Bokmål (`nob`) or Nynorsk (`nno`). These project-language cases conservatively use franc in fallback mode. Native output codes and text shares remain available for inspection.

Fallback also applies when the API is absent, errors, returns malformed data, or exceeds the five-second call deadline. It never overrides a valid native uncertain result or mismatch. Native-only never invokes franc. Review warnings retain Preview and Include anyway.

Browser identity uses runtime.getBrowserInfo where available; Chromium uses fullVersionList where available and otherwise the UA version, which may be reduced. No full UA or platform identifier is saved. Native model versions are not exposed: detector version is browser-managed, with the browser/version recorded separately. Browser updates can change results. Saved assessments are not automatically recomputed when projects are reopened in another browser.

## Sampling policy 1 remains unchanged

BootCaT supplies the same up-to-three UTF-16 windows of 2,048 code units: beginning, middle and end, with the existing two-window handling for intermediate texts. Each window needs 120 Unicode letters. A window that is unreliable or disagrees with the others makes the document uncertain. Numeric-tail and names-heavy limitations therefore remain.

franc keeps its 0.03 relative-gap rule and original normalized scores. Native uses the API's isReliable flag for each eligible window; native text-share percentages are not confidence probabilities. The browser may apply its own internal sampling/limits (the inspected Chromium source uses a 512-byte model limit), so supplied sample length is not a claim that every byte influenced the model. No detector scores are calibrated against each other.

Stored assessments include strategy, actual detector/version, browser/version, timestamp, sampling policy, coverage-table version when relevant, fallback/unavailable reason, result and per-window diagnostics. The franc adapter adds sample offsets/lengths without changing classification. Original text, edits and baseline text remain unchanged.

## Report.xlsx

The first Corpus metadata worksheet retains its four columns, included-document scope, filename order and URL-list alignment. A second Language detection worksheet contains all retained document records, including excluded texts and failed downloads/extractions. Each stored sample gets a row; records without a check/sample still get a row marked appropriately.

Columns A–AB contain: source URL, exported original filename, inclusion, extraction status, requested language, selected strategy, actual detector/version, browser/version, outcome, detected language, manual acceptance, checked time, fallback reason, assessment reason, policy JSON, coverage version, sample number, UTF-16 start/length, letter count, sample language/uncertainty, native isReliable, native language-share JSON, franc candidate-score JSON and franc relative gap. Numeric gaps retain their precision and are explicitly labelled as not confidence. All strings are literal cells, never formulas. Headers/filter and source column are frozen for navigation.

Missing historical browser/policy metadata is marked Not recorded or left blank rather than fabricated. A missing historical strategy is inferred as franc only, matching the old implementation. The workbook contains the latest saved assessment, not an experiment history; users should save separate project/export snapshots for each experimental condition. Checks made before this feature cannot acquire missing diagnostics retroactively.

The internal corpus export fingerprint layout is now 4 so an old export receipt does not prevent downloading the new report. This does not rename corpus files or change the portable-project format version.

## Functional validation

Unit checks cover routing, native-only failure, timeouts, unknown coverage, macrolanguage mapping, unchanged window boundaries/unanimity, raw native results, legacy choice, explicit recheck, portability and XLSX data/precision/formula safety. Native Chromium/Firefox DOM fixtures cover selection/default persistence and adapter contracts. The full Chromium extension uses the real native API and verifies stored provenance and the downloaded workbook. Cross-browser portable tests carry the strategy. These are functional checks, not a scientific accuracy benchmark or a live Firefox extension accuracy test.

The Settings close control moves to the top right, retaining keyboard dismissal and discard-without-saving behavior. No automatic data collection or telemetry is added.

## Primary sources inspected

- [Chrome extension API](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-detectLanguage)
- [Chromium native binding](https://github.com/chromium/chromium/blob/main/extensions/renderer/api/i18n_hooks_delegate.cc)
- [CLD3 output labels](https://github.com/google/cld3#supported-languages)
- [Firefox extension binding](https://github.com/mozilla/gecko-dev/blob/master/toolkit/components/extensions/parent/ext-i18n.js)
- [Firefox detector manager](https://github.com/mozilla/gecko-dev/blob/master/toolkit/components/translations/LanguageDetector.sys.mjs)
- [CLD2 supported-language list and limitations](https://github.com/CLD2Owners/cld2#supported-languages)

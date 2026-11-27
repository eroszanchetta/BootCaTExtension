# BootCaT 2.2 plan

Agreed scope, 26 November 2026. Version 2.1 is published in both browser stores. Implement and validate each agreed package in a reviewable PR; leave merging, releases and store publication to the maintainer. No version bump in WP1.

Before every work package or follow-up edit, check GitHub main, PR status and maintainer changes, then synchronize the checkout while preserving uncommitted work.

Standing maintainer authorization (26 November 2026): publish implementation branches to this public repository, open unmerged PRs and run/fix checks automatically without asking again. Leave PRs unmerged and do not create releases or upload to stores without separate authorization.

## WP1 — Interface polish (implemented; readiness determined by PR validation)

- Center the Welcome dialog actions, including wrapped rows.
- Separate the Project Name focus ring from the Project Language label.
- Use Sbafo directly on light blue (#dceaf3) backing without a white circle for square toolbar icons; preserve the original mascot vector.
- Make Corpus documents collapsible; leave total and included counts visible in its summary. Start expanded, preserving existing visibility.
- Use named search-engine color cues: Google blue, DuckDuckGo warm orange, Ecosia green. Engine names remain visible; contrast and keyboard focus must remain clear. Reserve teal (#007c83) for Bing in 2.3; do not add Bing support in WP1.
- Check collection completion navigation with collapsed URLs/Build Corpus panels, sticky navigation and narrow windows. Successful complete collections should open both panels and scroll to URLs once. Partial/stopped collections must retain their review workflow.
- Declutter below Add URLs and close search tabs: short essential feedback, partial-result actions always visible when needed, secondary counts/help under Collection details.

Validate with local tests, both builds, release-package verification, Playwright in Chromium and Firefox, and CI. The reported scroll failure is not yet reproduced in the user's environment; distinguish tested failure cases from that report.

## WP2 — Search engine defaults (implemented; readiness determined by PR validation)

Persistent personal engine default; Make default action beside engine selection; preference in Settings. Approved initial default: Ecosia. Keep the compact selector and place Make default beside it. Apply to new projects; preserve existing projects' engine selections.

## WP3 — Download progress and completion (implemented; readiness determined by PR validation)

Persistent progress strip below navigation while processing; visible counts and failures; completion summary, workspace title and toolbar badge without new permissions. Keep completion feedback until its close control is used, a new download run or project replacement/closure; focusing a tab does not clear it. The receipt is browser-local and excluded from portable projects. Processed counts advance after extraction and durable saving; download/extraction failures, cancellation and language warnings remain distinct. Closing the runner or losing its batch lock marks an unfinished run interrupted. System notifications requiring permission are outside this package.

## Recovery-feedback follow-up before WP4 (authorized)

The Import downloaded file button also accepts one dropped local file, with an or drop here hint. Picker and drop share validation, locking and feedback. Links, folders and multiple files are rejected; file drops outside import controls cannot navigate away. Success text is exactly Text recovered successfully.

For user-initiated downloaded-file recovery, report the saved and checked outcome persistently. Successful recovery opens Corpus documents, scrolls to the row below the sticky header and highlights it softly in green for two seconds. Remaining extraction/language issues stay in Documents with issues with amber highlighting and a specific explanation. Failed imports report the error without claiming success. Preserve known inclusion choices; usable text may remain excluded. Keep messages on moved rows and offer Show document. Defer automatic navigation until open dialogs/editors close, preserve keyboard focus, and use a static timed highlight for reduced motion.

## WP4 — DuckDuckGo collection reliability (implemented; readiness determined by PR validation)

Live inspection reproduced ten readable documents plus two Related Searches anchors sharing the legacy result selector. Exclude that observed widget; keep unknown/internal opaque result candidates unresolved with bounded local diagnostics. Record the ordered result-set identity and compare it for DuckDuckGo popup/floating saved state, so same-URL additions permit collection again. Preserve full page/pagination/filter identity (apart from fragments), and retain existing query-level collection history. Recheck DDG results before automatic tab closure; leave changed or unreadable pages open. Restore removed floating hosts, and refresh after dynamic result/URL changes, visibility return and history restoration. No automatic collection or reload.

Old DuckDuckGo collections without result-set metadata retain their URLs and allow one fresh collection. Current tests replay a minimized populated live DOM in Chromium/Firefox and exercise the full Chromium extension. The historical eight unidentified Fiori candidates and the exact reported intermittent floating failure remain unconfirmed; see docs/DUCKDUCKGO-2.2.md.

## WP5 — Extraction diagnosis and manual recovery

Diagnose the supplied IEEE PDF, distinguishing access/wrapper responses from PDF extraction failures. Allow manual text recovery from Details when extraction fails (including the supplied Quizlet case). Preserve originals, source URL and failure provenance; mark manual text, reassess language/length, retain portability and protect edits from retry overwrite. OCR/general PDF rewrite deferred.

## WP6 — Length filters and Settings

Optional project minimum/maximum character filters with personal defaults, distinct from technical processing limits; retain excluded documents and manual overrides; reassess after edits. Confirm counting/application rules before implementation. Move Text extractor into Settings, preserving selection and clarifying applicability to future versus existing extractions.

## WP7 — Language detection

Collect actual failures and comparison examples early. Evaluate sampling/uncertainty policy independently from the detector; benchmark local alternatives for accuracy, language coverage, browser compatibility, speed, package size and licensing. Agree the resulting detector/inclusion policy before implementation; defer substantial model integration if necessary.

## Deferred to 2.3

- Pseudo-XML export: preserve the legacy text/s tag structure, attribute order and one file per document under xml_corpus. Use standard XML escaping, UTF-8, standard original-document media types, and consistent stable IDs/filenames. Sentence segmentation remains undecided.
- Bing support, with a reserved teal accent distinct from Google blue and Ecosia green. This is a design reservation, not an implemented adapter or engine choice.

Suggested delivery order: WP1 through WP7, gathering WP7 examples early. WP1, WP2 and WP3 are authorized for implementation.

## Manual empty-query follow-up and small interface changes (authorized 27 November 2026)

After a collection finds no readable or unresolved candidates, offer Mark as no results in the popup/floating feedback and, for a tracked batch failure, the query row. This is a manual assertion, not automatic detection of provider wording. Recheck that the search page is loaded, unchanged and free of detected results/challenges/unreadable candidates. Save an explicit manual no-results outcome with no invented document/URL; preserve it in portable projects and restore query history after restart. Keep the source tab open and exclude this completed query from batch opening and collection. Show a separate No results badge and explicit Rerun query action; opening that query explicitly clears its manual empty outcome and creates a fresh tracked search tab. Existing saved results for that query must not be overwritten by an empty outcome. A changed result set can be collected normally.

On successful Generate tuples, open Seeds and scroll the Tuples label below the sticky header after layout settles, without changing keyboard focus. Failed/stopped generation keeps previous tuples and does not perform that scroll. Replace the completed-download Dismiss button with a keyboard-accessible × control at the top right; active progress remains visible.

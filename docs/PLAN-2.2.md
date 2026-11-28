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

## WP5 — Extraction diagnosis and manual recovery (implemented; readiness determined by PR validation)

Diagnose the supplied IEEE PDF, distinguishing access/wrapper responses from PDF extraction failures. Allow manual text recovery from Details when extraction fails (including the supplied Quizlet case). Preserve originals, source URL and failure provenance; mark manual text, reassess language/length, retain portability and protect edits from retry overwrite. OCR/general PDF rewrite deferred. See docs/EXTRACTION-2.2.md for the live access-failure evidence, parser changes, manual recovery semantics and remaining limits.

## WP6 — Length filters and Settings

Authorized 28 November 2026: optional minimum/maximum character filters in Settings → This project, with blank bounds initially and inclusive limits. Count Unicode code points in the extracted/edited text, including spaces and line breaks. Filtered documents stay in Documents with issues with a brief short/long reason and Include anyway; preserve originals, text, manual inclusion/exclusion choices and stable order. Recheck saved texts when the range changes and after edits. Keep length and language review independent. Move Text extractor into the same project Settings group; preserve existing selections and apply changes to future extractions only. Use as defaults for new projects saves these three choices as personal defaults; opened projects retain their choices. Technical extraction limits remain separate. Go to export also highlights Export Corpus briefly in green, without animation. See CORPUS-FILTERS-2.2.md for implementation and validation.

## WP7 — Language detection

Authorized 28 November 2026: defer accuracy evaluation to student/user experiments. Add a project Language detector setting with Native API with franc fallback (new-project default), Native API only and franc only; include it in personal defaults and portable projects. Projects without the field retain franc only. Keep policy-1 sampling unchanged. Route by verified browser-specific language coverage; fall back only for unverified coverage or unavailable/failing native calls, never to overturn a native mismatch or uncertain result. Native-only unavailable checks remain reviewable. Record the strategy, actual detector, browser/version, fallback reason, policy and per-sample diagnostics. Changing strategy affects future checks; existing assessments require explicit Recheck saved texts. Extend Report.xlsx with a separate Language detection worksheet including excluded documents. Move the Settings × to the top right. See LANGUAGE-DETECTION-2.2.md for implementation, report schema, sources and limits. No accuracy comparison is claimed in this package.

## Maintenance work package — after 2.2, before starting 2.3

Authorized for planning on 28 November 2026. Complete the 2.2 release first, then carry out this maintenance package before implementing 2.3 features. This package preserves user-visible behavior, portable-project compatibility, stored data and supported browsers; agree any behavior change separately.

- Split the workspace controller into focused modules for document rendering, download orchestration, recovery and export, with clear ownership of shared state.
- Clarify the document-state model: extraction success, language/length review, manual acceptance, inclusion/exclusion and recovery history. Centralize the rules and retain existing user decisions.
- Split browser workflows into independent scenarios with isolated fixtures, reliable setup/cleanup and clearer failure reporting. Reduce unit tests' dependence on rewriting application source or inspecting its internal variables.
- Add consistent formatting and general JavaScript linting. Evaluate incremental type checking for stored records, detector results and cross-module messages; avoid a wholesale rewrite or framework migration.
- Validate each refactoring step against the existing unit, Chromium/Firefox, export, recovery, concurrency and portable-project checks. Preserve original files, manual edits, ordering, preferences and metadata across reopening and project transfer.

Deliver this work in small reviewable PRs. The package is complete when these responsibilities and rules are explicit, the regression checks pass, and no unapproved product behavior or file-format changes have been introduced. Bing and pseudo-XML remain 2.3 work and do not belong in this maintenance package.

## Deferred to 2.3

- Pseudo-XML export: preserve the legacy text/s tag structure, attribute order and one file per document under xml_corpus. Use standard XML escaping, UTF-8, standard original-document media types, and consistent stable IDs/filenames. Sentence segmentation remains undecided.
- Bing support, with a reserved teal accent distinct from Google blue and Ecosia green. This is a design reservation, not an implemented adapter or engine choice.

Delivery order: WP1 through WP7 and completion of the 2.2 release, followed by the maintenance work package, then 2.3 feature development. Gather WP7 examples early. Individual implementation scope continues to require the agreed package decisions.

## Manual empty-query follow-up and small interface changes (authorized 27 November 2026)

After a collection finds no readable or unresolved candidates, offer Mark as no results in the popup/floating feedback and, for a tracked batch failure, the query row. This is a manual assertion, not automatic detection of provider wording. Recheck that the search page is loaded, unchanged and free of detected results/challenges/unreadable candidates. Save an explicit manual no-results outcome with no invented document/URL; preserve it in portable projects and restore query history after restart. Keep the source tab open and exclude this completed query from batch opening and collection. Show a separate No results badge and explicit Rerun query action; opening that query explicitly clears its manual empty outcome and creates a fresh tracked search tab. Existing saved results for that query must not be overwritten by an empty outcome. A changed result set can be collected normally.

On successful Generate tuples, open Seeds and scroll the Tuples label below the sticky header after layout settles, without changing keyboard focus. Failed/stopped generation keeps previous tuples and does not perform that scroll. Replace the completed-download Dismiss button with a keyboard-accessible × control at the top right; active progress remains visible.

The main-window Mark as no results action is placed immediately after the query status badge and before Open search tab (maintainer adjustment, 27 November 2026).

## Resolution-feedback follow-up (authorized 27 November 2026)

- Recognize the observed signed-out Google /goto result redirect alongside /url. Opaque destinations remain unresolved, show sign-in/switch-engine guidance, and never offer Mark as no results. Do not guess or follow opaque destinations.
- Completed-run feedback and its badge/title follow the active project's current unresolved documents. Show All issues resolved when the last issue is cleared; unchecked usable documents are not issues. Preserve the original run counters under Download details. Dismissed feedback stays dismissed; stopped/interrupted runs keep their outcome.
- A small outlined hand indicates any manual intervention: browser capture, file import, pasted/edited text, accepted language warning, explicit language recheck or changed inclusion. Tooltips name applicable actions. Retain known actions through rechecks, edits, portable saves and corpus metadata; infer older stored provenance where possible.
- All explicit operations moving a document from issues to usable text share reveal/green-highlight feedback, including Include anyway, rechecking, text edits, captures and imports. Passive refreshes never repeat navigation. Bulk operations report once and highlight affected rows, scrolling once; open editors defer the reveal. Remaining issues use amber feedback.
- Use a compact status line with brief action-specific text: Download recovered, Text recovered, Language warning accepted, Language check passed, or Language review cleared. Keep technical download errors under Details and shorten the main recovery instructions.

## Completion wording and document order (authorized 27 November 2026)

For a finished run without issues, the green strip mirrors export guidance: Your corpus is ready to export, with Go to export revealing and focusing the export control. If nothing is included, say No documents included and hide the export link. After export, mirror Your corpus download has started. Keep active, stopped, interrupted and issue feedback distinct; retain original download counts under Details.

Keep both document sections in original URL-list order, including immediately after recovery, refresh, reopening and portable transfer. Reserve the full saved URL list when the first document result is stored; append later URLs after existing ones. Preserve the scroll/highlight recovery feedback. For older projects without saved ordering, use the current saved URL list; documents absent from it follow in their previously stored URL order, since their original list positions cannot be reconstructed. Persist that inferred order on the next document save. This does not rename files or change the filename ordering of the corpus report.

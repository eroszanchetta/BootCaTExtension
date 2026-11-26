# BootCaT 2.2 plan

Agreed scope, 26 November 2026. Version 2.1 is published in both browser stores. Implement and validate each agreed package in a reviewable PR; leave merging, releases and store publication to the maintainer. No version bump in WP1.

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

## WP3 — Download progress and completion

Persistent progress strip below navigation while processing; visible counts and failures; completion summary, workspace title and toolbar badge without new permissions. Confirm badge clearing behavior before implementation. System notifications requiring permission are outside this package.

## WP4 — DuckDuckGo collection reliability

Investigate partial results, collection button availability and missing floating controls against populated live DOM and candidate diagnostics. Preserve pagination and dynamic-result distinctions. Implement evidence-backed fixes; do not assume the old unresolved candidates were internal links.

## WP5 — Extraction diagnosis and manual recovery

Diagnose the supplied IEEE PDF, distinguishing access/wrapper responses from PDF extraction failures. Allow manual text recovery from Details when extraction fails (including the supplied Quizlet case). Preserve originals, source URL and failure provenance; mark manual text, reassess language/length, retain portability and protect edits from retry overwrite. OCR/general PDF rewrite deferred.

## WP6 — Length filters and Settings

Optional project minimum/maximum character filters with personal defaults, distinct from technical processing limits; retain excluded documents and manual overrides; reassess after edits. Confirm counting/application rules before implementation. Move Text extractor into Settings, preserving selection and clarifying applicability to future versus existing extractions.

## WP7 — Language detection

Collect actual failures and comparison examples early. Evaluate sampling/uncertainty policy independently from the detector; benchmark local alternatives for accuracy, language coverage, browser compatibility, speed, package size and licensing. Agree the resulting detector/inclusion policy before implementation; defer substantial model integration if necessary.

## Deferred to 2.3

- Pseudo-XML export: preserve the legacy text/s tag structure, attribute order and one file per document under xml_corpus. Use standard XML escaping, UTF-8, standard original-document media types, and consistent stable IDs/filenames. Sentence segmentation remains undecided.
- Bing support, with a reserved teal accent distinct from Google blue and Ecosia green. This is a design reservation, not an implemented adapter or engine choice.

Suggested delivery order: WP1 through WP7, gathering WP7 examples early. WP1 and WP2 are authorized for implementation.

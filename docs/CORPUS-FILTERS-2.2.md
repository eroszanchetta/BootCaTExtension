# WP6 — Corpus filters and Settings

Authorized 28 November 2026. No version, browser permission or dependency changes.

## Project choices

Settings → This project contains optional Minimum characters, Maximum characters and the existing Text extractor choice. Blank bounds mean no limit; initially both are blank. Bounds are inclusive and must be positive whole numbers up to 100,000,000, with minimum no greater than maximum. This validation ceiling is not a promise that extraction can process a text of that size.

The count uses the existing extracted/edited text's Unicode code points, including spaces and line breaks. It does not count bytes, HTML, words or grapheme clusters. Extraction normalization is unchanged; manual text is counted as saved. PDF/DOCX page, memory, size, character and timeout safeguards still apply before filtering. A filter never truncates text or reruns extraction.

Save project settings atomically rechecks the saved document metadata and closes Settings after success. Errors keep the dialog open. The top-left ×, Cancel and Escape close without saving unsaved drafts in either form; already saved choices remain saved. The save requires exclusive project access, so a running batch or another document operation cannot interleave with the range change. Optimistic revisions reject stale dialogs. Originals and text Blobs are retained. Settings updates notify other workspaces and update completion feedback. Explicitly cleared issues use the existing deferred recovery reveal/highlight; passive refresh does not repeat it.

Changing the extractor affects future web-page extractions, including captures. Existing texts, manual edits and extraction provenance stay intact. Opened projects keep the extractor stored in their draft. Old projects inherit no length bounds.

## Review and manual choices

Texts outside the range appear in Documents with issues with a short Too short/Too long reason and their count/bound. They are unchecked and excluded from the corpus. Preview, text editing, originals, deletion and stable URL-list order remain available.

Include anyway explicitly accepts the current length and/or language warnings, sets inclusion, and records the appropriate manual-action hand tooltip. Explicit inclusion remains an override of length filtering through range changes, edits and recovery. A new language warning after editing still requires review, preserving the existing language-edit policy. Explicit unchecked choices remain unchecked after filters change. Automatically excluded documents become eligible again when their range issue clears, provided no language or extraction issue remains. Existing exclusion from an access-check page is not silently removed.

Every saved extraction, text edit and language check composes length eligibility with language eligibility in the storage transaction. The exported extraction metadata and portable projects retain bounds, checks and manual choices. No project-format version bump is required: new metadata is optional, and older projects use blank bounds. Filenames and report filename ordering are unchanged.

## Defaults and processing limits

Use as defaults for new projects saves the three displayed project choices as personal preferences; it does not alter another existing project. The Personal settings form can also edit those defaults. Blank default bounds disable filtering for new projects. Project choices travel with portable projects; personal defaults stay in the browser. Processing limits remain separate from the corpus filters and do not change saved text when edited.

## Export navigation

Both Go to export links reveal and focus Export Corpus and apply a static green highlight to a small padded area around the button for two seconds. The button keeps its normal styling; the Project section is not highlighted. Repeated activation restarts the timeout. No animation is used, including with reduced motion.

## Validation

Unit coverage includes bound validation, inclusive edges, Unicode/line-break counts, independent language eligibility, manual overrides/exclusions, text edits, revision conflicts, original preservation, portable transfer, visible review feedback and new-project defaults. Playwright checks cover native Settings in Chromium/Firefox, the moved extractor, invalid ranges and defaults, cross-window review updates, Include anyway, clearing filters, stable ordering and export-highlight expiry. Await the published PR's complete checks before marking it ready.

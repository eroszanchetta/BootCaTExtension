# BootCaT 2.2

Package version: **2.2.0**. Prepared 28 November 2026. Publication date is not assigned; this document does not claim store submission or approval. Version 2.1 is already published in both browser stores.

## What's new

- **Project length filters.** Set optional minimum and maximum character counts in Settings. Out-of-range texts appear in Documents with issues with a brief reason and Include anyway. Originals and extracted text are kept, and manual inclusion/exclusion choices survive filter changes.
- **Selectable language detection.** Choose Native API with franc fallback, Native API only or franc only in project Settings. New projects start with native plus fallback; existing projects retain franc. Changing the strategy affects future checks; Recheck saved texts updates existing assessments explicitly. The sampling policy is unchanged and accuracy evaluation is left to research and teaching experiments.
- **Language experiment reports.** Report.xlsx retains the Corpus metadata worksheet and adds Language detection, including excluded documents and per-sample results. It records detector strategy, actual detector, browser/version, fallback reasons, outcomes and diagnostics. Repeated document rows represent samples, not a history of rechecks.
- **Manual text recovery.** When extraction fails but readable text is available elsewhere, use Details → Edit to paste text. Failed downloads can also be recovered by selecting or dropping a downloaded file onto Import downloaded file. Original files and recovery provenance remain available.
- **Clear recovery feedback.** Resolved documents receive brief feedback, scroll into view and highlight in green. Remaining issues use amber feedback. An outlined hand identifies manual interventions, with an explanatory tooltip. Both document sections keep original URL-list order through recovery, reopening and portable transfer.
- **Download progress and completion.** A fixed progress strip stays below navigation. Completion feedback, the tab title and toolbar badge reflect remaining issues without a notification permission. Original download counts remain under Download details. Go to export reveals the export control and highlights a small surrounding area.
- **Search collection improvements.** DuckDuckGo collection handles the observed related-search widget and appended results more reliably. Unreadable Google redirects retain sign-in/change-engine guidance. Manually mark a genuinely empty query as No results and rerun it explicitly when needed.
- **Search defaults and interface polish.** Ecosia is the initial engine for new projects; Make default saves a personal choice. Named engine color cues, lighter toolbar artwork, collapsible corpus documents, navigation fixes and cleaner messages improve feedback. Text extractor has moved to Settings. Project settings save and close the dialog; the top-right × discards unsaved changes.

## Updating and saving work

Update the existing store installation to preserve its extension identity and browser profile. Keep a `.bootcat` backup before updating. Save Project retains originals, texts, edits, project settings and manual decisions. Export Corpus creates a corpus ZIP for use outside BootCaT; it is not a reopenable project.

Personal defaults remain in the browser. Opened projects keep their own choices. Existing language assessments are retained until an explicit recheck; native results can differ by browser/version. Save separate project/export snapshots when comparing experimental conditions.

## Continuing limitations and deferred work

- Search providers can change their pages or require sign-in/CAPTCHA completion. BootCaT does not bypass access controls. The supplied IEEE/Quizlet examples may still be inaccessible through automatic downloading; manual recovery is available.
- The original unidentified DuckDuckGo candidates and exact historical intermittent floating-control report have not been conclusively reproduced. Fixes address observed cases, not every future provider layout.
- Native coverage is conservative and browser-specific, with no silent narrowing of broad native labels to franc language varieties. Native-only unavailable checks need review. Short, multilingual, numeric or botanical-name-heavy samples can remain uncertain under the unchanged policy.
- PDF layout may need review. OCR is not included. Browser storage, memory and processing limits still apply. Floating page controls cannot be injected into built-in PDF viewers.
- Desktop Chrome 120+ and Firefox 140+ remain the supported targets. Firefox for Android is not declared supported.
- Bing and pseudo-XML export remain deferred to 2.3. The agreed maintenance package follows the 2.2 release and precedes 2.3 feature work.

## Short store update text

BootCaT 2.2 adds project length filters, selectable native/franc language detection and a Language detection worksheet in Report.xlsx. Recover text by pasting it or importing/dropping a downloaded file, with clearer feedback and manual-action indicators. A fixed download strip, stable document ordering, configurable search-engine defaults and collection/interface improvements make corpus building easier. Text extractor is now in Settings. Processing remains local; no new browser permissions are requested.

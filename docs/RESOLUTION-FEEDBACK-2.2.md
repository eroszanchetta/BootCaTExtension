# Resolution feedback follow-up — 2.2

Agreed and implemented on 27 November 2026. See PLAN-2.2.md for package scope.

## Google result links

A populated signed-out Google page for `gynoecium "floral whorl" corolla` contained eight result-title anchors using `/goto?url=<opaque token>&gsessionid=…`. The collector recognized `/url` but ignored this newer redirect as internal navigation, reporting an empty page.

The collector now recognizes both redirect paths. Explicit HTTP(S) destinations use the existing URL validation. Opaque destinations count as unreadable results and restore the sign-in/change-engine guidance; they do not qualify for Mark as no results. BootCaT does not guess, fetch or decode opaque destinations.

The minimized google-goto.html fixture retains the observed anchor structure with invented opaque tokens and no session identifiers. Unit and browser checks cover classification, guidance and suppression of the empty-query action. This supports the observed layout, not every future Google layout.

## Completion state

Finished-download feedback reconciles against the current project's documents, including extraction failures, unavailable documents and language warnings. Usable unchecked documents are not issues. When the last issue is resolved, the banner and toolbar indicator turn green and say All issues resolved. New unresolved documents can restore amber.

Download details retains the original run counts. Dismissal remains effective; stopped and interrupted runs retain their outcomes. The receipt remains browser-local and is excluded from portable projects.

## Manual intervention history

A small outlined hand appears beside documents changed manually. Its tooltip lists applicable actions: browser capture, file import, supplied/edited text, accepted language warning, explicit language recheck and changed inclusion. An empty reserved slot prevents controls shifting when the hand first appears.

Known actions accumulate through later saves and rechecks. Existing records infer actions from stored provenance where possible. Portable projects and corpus metadata preserve the action history; an older record cannot reveal an action whose provenance was never stored.

## Resolution feedback

Explicit actions moving a document from Documents with issues to Corpus documents share compact feedback, row reveal and a brief green highlight. This includes Include anyway, language rechecks, text recovery, browser capture and file import. Labels describe the outcome: Download recovered, Text recovered, Language warning accepted, Language check passed or Language review cleared.

Bulk operations produce one summary, highlight affected rows and scroll once. Open editors defer the reveal; reduced motion uses a static timed highlight. Passive refreshes do not replay navigation. An import retaining an extraction or language issue stays in the issues list with amber feedback. Existing inclusion choices remain intact.

Download-failure instructions are shorter. The raw HTTP/download error remains available under Details.

## Validation

Unit coverage includes live completion reconciliation, dismissal, preserved counters, manual history persistence, legacy provenance, individual/bulk resolution and passive refresh. Browser checks cover the observed Google redirect shape, hand accessibility, import outcomes, Include anyway and live completion state. Run the full repository checks and both-browser Playwright suites on the published PR head before marking it ready.

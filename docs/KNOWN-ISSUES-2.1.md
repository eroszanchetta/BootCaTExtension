# Known issues in BootCaT 2.1

## DuckDuckGo collection status and floating controls

Some DuckDuckGo result pages remain marked as partially collected after their visible result links have been saved. A recreated test project inspected on 24 November 2026 contained all ten results at candidate positions 1–10, plus eight unresolved candidates occurring later. All saved URLs were present in the workspace. The unresolved candidates' addresses were not retained, so whether they are supplementary/internal links or further usable results remains unconfirmed.

Use **Continue with collected URLs** to keep the saved subset and proceed to corpus building, or review the search tab. This accepts the partial collection; it does not establish that every possible result on the page was collected.

Floating controls have also been reported as intermittently absent on DuckDuckGo pages in Chrome and Firefox. Hiding on an already collected page is expected; the reported absence on an unaccepted partial collection still needs reproduction. This is tracked separately from the confirmed partial-result metadata.

These issues are deferred beyond the 2.1 release. Further investigation should capture the populated live result DOM and candidate-link diagnostics. No candidate-filtering or floating-control fix is claimed in this release.

## 2.2 development follow-up

WP4 reproduced a false partial collection caused by Related Searches sharing the legacy result selector, and confirmed More results can append documents without changing the URL. The 2.2 implementation addresses those cases and floating-control lifecycle gaps. The original eight unidentified candidates and exact intermittent absence remain unconfirmed. See [the investigation](DUCKDUCKGO-2.2.md) for evidence and limits.

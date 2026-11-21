# BootCaT 2.1

Package version: **2.1.0**. Prepared 21 November 2026.
This is release preparation; the store publication date has not been assigned.

## What's new

- **Portable projects.** Save your complete project as a single `.bootcat` file and reopen it later in Chrome or Firefox, including on another computer. Projects retain seeds, queries, search records, downloaded originals, extracted and edited text, inclusion choices and pending page captures. Browser preferences and live search tabs remain separate.
- **Settings.** Adjust download and extraction limits, timeouts, the URL warning threshold and the minimum number of distinct seeds. Defaults retain the existing limits, with contextual advice when increasing them.
- **Safer query batches.** Run all queries skips searches already open or collected. Run missing queries becomes available when an uncollected query no longer has an open tab. Opening tabs requires confirmation and warns about blocked requests and CAPTCHAs.
- **Collection controls.** Choose whether successful URL collection or page capture closes its tab. Optional floating controls provide the same actions on supported pages, with a configurable corner position. These preferences persist across projects.
- **Text review and editing.** Inspect extracted text in a large dialog, edit and save it, or cancel an edit to restore the text from before that edit. Original documents remain available.
- **Clearer corpus building.** Build Corpus groups downloading and document review, with separate document and inclusion counters, a documents-with-issues list, and a link to Export Corpus when text is ready. New URLs and documents reveal the relevant section without pulling you away from your work.
- **Improved project and popup interface.** New, Open, Save and Close Project are grouped with Export Corpus. The welcome dialog starts with New Project. Sbafo branding, the icon menu, a compact popup, accessible preference switches and shorter messages make common actions easier to find.
- **Google language preference.** Google search URLs use the selected corpus language where supported, without adding a country or region preference. Searches under different effective language filters are tracked separately. DuckDuckGo and Ecosia are unchanged.
- **Fixes and polish.** Firefox can save portable projects containing downloaded documents. Inclusion changes keep the document row, counters and export guidance stable. Close-after-success switches remain available when reopening the popup after an action succeeds.

## Updating and saving your work

Update the existing store installation to preserve its extension identity and browser profile.
Before updating, keep a `.bootcat` project backup if your installed version supports it;
otherwise export the corpus and retain any other work supported by that version.

**Save Project** creates a complete project file. **Export Corpus** creates the corpus ZIP
for use outside BootCaT; a corpus ZIP cannot be reopened as a project. Personal settings
and collection-control preferences stay in the receiving browser and do not travel in
project files. Saved files on your computer are independent of browser storage.

## Continuing limitations

Search engines may require login or CAPTCHA completion; BootCaT does not bypass access
checks. PDF reading order and formatting may need review, and OCR is not included.
Language detection can be uncertain, especially for short or multilingual texts.
Browser storage, file sizes and available memory still limit large projects.
This release targets desktop Chrome and Firefox; Firefox for Android is not supported.

## Short store update text

BootCaT 2.1 adds portable `.bootcat` projects, configurable settings and limits, safer query
batches, optional floating collection controls, persistent close-after-success switches,
and a larger text-review dialog with editing. A clearer Build Corpus workflow, compact
popup and updated Sbafo branding simplify corpus creation. Google searches can follow the
corpus language without an added regional preference. Includes Firefox project-saving
fixes and interface improvements. Extraction and language detection remain local.

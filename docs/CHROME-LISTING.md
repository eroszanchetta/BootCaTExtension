# Chrome Web Store listing draft — version 2.1

Name (from manifest): BootCaT — Bootstrap Corpora and Terms

Short description (from manifest): Collect search results, download pages and extract corpus text locally.

Publisher: Eros Zanchetta

Support email: bootcat@dipintra.it

Suggested category: Education, if available in the current dashboard.

## Detailed description

BootCaT helps you build a text corpus from the web, directly in your browser.

Start with seed words or phrases, generate search queries, and collect results from
DuckDuckGo, Ecosia or Google. Restrict searches to PDF or DOCX and exclude unwanted sites.
Then download selected sources and extract useful text locally.

Features:

- Generate unique randomized seed tuples and edit your queries.
- Track project search tabs, avoid duplicate batch openings and collect their results together.
- Save complete portable .bootcat projects and reopen them in Chrome or Firefox.
- Adjust download/extraction limits and other preferences in Settings.
- Add an individual page through the popup or optional floating controls; choose whether successful actions close the tab.
- Extract text from HTML, PDF and DOCX; choose Readability or Defuddle for HTML.
- Review, edit or exclude extracted text in a large dialog, and inspect documents with issues.
- Optionally check document language; Google searches can follow the corpus language without an added regional preference.
- Export original documents, extracted text files, an Excel metadata report, and your
  seeds, tuples and URL list in one corpus ZIP.

Searches send your generated queries to the chosen search engine. Visiting/downloading
sources sends requests to those websites; explicit PDF recovery can use that website's
browser session. Website content and selected URLs are processed for your corpus and saved
locally. Extraction and language detection run on your device. There is no BootCaT account,
backend, advertising or telemetry, and your corpus is not uploaded to the developer.

Search engines can change their pages or require login/CAPTCHA completion. Google may
require a signed-in session to expose usable result links. BootCaT does not bypass these
checks. You can inspect a page yourself and add it to the corpus, or import a manually
downloaded PDF/DOCX when a download fails. Scanned PDFs need OCR in another tool; PDF layout
can affect reading order and text formatting.

Free and open source under GPL-3.0-or-later. Bundled libraries retain their own licences.
Developed and independently published by Eros Zanchetta (University of Bologna).

Source code: https://github.com/eroszanchetta/BootCaTExtension

## Version update text

Use the short store update text in [RELEASE-NOTES-2.1.md](RELEASE-NOTES-2.1.md).
Update the existing listing; the displayed release is 2.1 and package version is 2.1.0.

## Complete before submission

- Add the live public HTTPS privacy-policy URL in the designated privacy field.
- Keep the matching version of the source available in the public repository or as a source ZIP.
- Use the real 128×128 extension icon and screenshots of the Chrome build.
- Complete permissions/data-use fields and Test instructions using CHROME-SUBMISSION.md.
- Do not claim Android support or Chrome Web Store approval before acceptance.

# Mozilla listing draft — version 2.2

Name: BootCaT — Bootstrap Corpora and Terms

Summary: Build text corpora from web pages, PDFs and DOCX files, with local text extraction and export.

## Description

BootCaT helps you create a text corpus from the web:

- Turn seed words and phrases into randomized search queries.
- Search with DuckDuckGo, Ecosia or Google, including file-type restrictions and excluded sites.
- Avoid duplicate query batches, collect URLs from project search tabs, then download the sources you select.
- Save complete portable .bootcat projects and reopen them in Firefox or Chrome.
- Set project length filters and the web-page extractor in Settings; save personal defaults for new projects.
- Use Ecosia, DuckDuckGo or Google, and save your preferred engine for new projects.
- Follow downloads in a fixed progress strip and recover failed text by importing/dropping a file or pasting text manually.
- Choose native language detection, franc, or native with franc fallback; inspect per-sample diagnostics in Report.xlsx.
- Use optional floating controls and persistent close-after-success switches.
- Extract corpus text from HTML, PDF and DOCX locally, using Readability or Defuddle for HTML.
- Review, edit or exclude text, resolve length/language warnings, and identify manual interventions with the hand indicator.
- Mark a query as having no results manually, with a distinct status and an explicit rerun action.
- Optionally check document language; Google searches can follow the corpus language without an added regional preference.
- Export original files, extracted texts, an Excel report and your seeds, tuples and URL list.

Searches and downloads contact the selected search engines and source websites directly.
They receive your queries, requested URLs and normal connection information. Browser tabs
use your browser session; retrying a PDF can use that website's session cookies. Extraction,
language detection and corpus storage run locally. BootCaT has no account, server, advertising
or telemetry, and does not upload your corpus to the developer.

Search engines can change their pages, require a login or show a CAPTCHA. Google in particular
may require a signed-in session for usable result links. BootCaT does not bypass these checks.
You can inspect a page yourself and add it to the corpus, or import a downloaded PDF/DOCX
when a download fails. Scanned PDFs require OCR in another tool. PDF layout can affect text order.

Free and open source under GPL-3.0-or-later; bundled libraries retain their own licences.
Developed and independently published by Eros Zanchetta (University of Bologna).

## Version notes

Use the short store update text in [RELEASE-NOTES-2.2.md](RELEASE-NOTES-2.2.md).
Update the existing listing; the displayed release is 2.2 and package version is 2.2.0.

## Complete before submission

- Set AMO's support email to **bootcat@dipintra.it**.
- Publish a matching source download and add its URL to the description.
- Provide the policy from src/about.html in AMO's privacy field or on a public policy page.
- Add screenshots of the Firefox workspace and popup. No paid service is required.
- Choose desktop Firefox; this release has not been tested on Firefox for Android.

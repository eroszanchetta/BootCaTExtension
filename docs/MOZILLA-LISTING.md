# Mozilla listing draft

Name: BootCaT — Bootstrap Corpora and Terms

Summary: Build text corpora from web pages, PDFs and DOCX files, with local text extraction and export.

## Description

BootCaT helps you create a text corpus from the web:

- Turn seed words and phrases into randomized search queries.
- Search with DuckDuckGo, Ecosia or Google, including file-type restrictions and excluded sites.
- Collect results from project search tabs, then download the pages and documents you select.
- Extract corpus text from HTML, PDF and DOCX locally, using Readability or Defuddle for HTML.
- Optionally check document language and review documents that need attention.
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

## Complete before submission

- Add your monitored support contact or public support site in AMO's support fields.
- Publish a matching source download and add its URL to the description.
- Provide the policy from src/about.html in AMO's privacy field or on a public policy page.
- Add screenshots of the Firefox workspace and popup. No paid service is required.
- Choose desktop Firefox; this release has not been tested on Firefox for Android.

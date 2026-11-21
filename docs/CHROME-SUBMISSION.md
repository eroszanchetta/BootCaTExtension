# Chrome Web Store submission — BootCaT 2.1.0

Updated 21 November 2026 for the 2.1 update. This guide prepares a submission; it does not publish one.
Build and submit the browser-specific package from the tested release commit.

## Update the existing listing

Use the Google account that owns the current BootCaT listing. Keep its extension ID and
publisher identity. Do not create another listing for 2.1. Confirm that 2.1.0 has not already
been uploaded or published; a new upload must have a version greater than the store's
current version. Confirm account access and 2-Step Verification before submission.

Publisher: **Eros Zanchetta**. Public support email: **bootcat@dipintra.it**.
Complete account-specific declarations in the developer dashboard using the publisher's
actual circumstances. This guide does not complete those declarations or submit an update.

## Prepare the package and public policy

After pulling the current repository, use Node.js 24 LTS:

```sh
npm ci
npm test
npm run package
```

Outputs:

- `dist/packages/bootcat-chromium-2.1.0.zip`: upload this to Chrome Web Store.
- `dist/packages/bootcat-source-2.1.0.zip`: keep as the corresponding source release; supply
  it to reviewers if requested and make source available to users as required by the GPL.
- `dist/packages/bootcat-privacy.html`: a standalone public privacy-policy page.

Do not upload the Firefox ZIP or the source ZIP as the extension. Chrome normally receives
one extension ZIP, unlike Mozilla's separate source-upload workflow. package.json and
package-lock.json already specify 2.1.0; do not increment them unless that version has
already been used in the store. Build all release artifacts from the same final commit.

`npm run export:privacy` exports just the public policy without installing PDF.js.
The exporter uses the privacy section in src/about.html, including the support address,
without maintaining another copy of the policy. The output has inline CSS and no scripts,
external images, tracking, or extension-only resource links. Edit src/about.html when the
policy changes, then regenerate both packages and the public copy.

Host bootcat-privacy.html at a public HTTPS URL, for example the BootCaT website's
/privacy.html path. That example is not a deployed URL: publish the file and verify that
it opens without login before entering it in the store. The extension's moz-extension://
or chrome-extension:// About page is not a public privacy-policy URL. A private GitHub
repository also cannot serve as that public policy. The website's own cookies/logging,
if any, need their own accurate disclosures; this exported page contains no tracking code.

The source repository is now public: https://github.com/eroszanchetta/BootCaTExtension.
Use it in the listing and keep the source corresponding to each released version available
through a release/tag, an exact commit link, or the matching source ZIP.

## Upload and complete the listing

1. Open the existing BootCaT item in the developer dashboard and upload the new Chromium ZIP.
   Keep the existing listing and extension ID. Uploading prepares a draft update.
2. Complete **Store listing** using CHROME-LISTING.md. Reuse accurate feature wording from
   the Mozilla listing, but use actual Chrome screenshots.
3. Provide the existing 128×128 PNG icon (src/icons/icon-128.png) and at least one screenshot.
   Google's documented screenshot sizes are 1280×800 or 640×400. Optional promotional images
   are 440×280 and 1400×560. Do not fabricate interface screenshots.
4. Complete **Privacy practices** using the explanations below, and enter the live public
   privacy-policy URL. Complete the required limited-use certifications only after checking
   that they match the release and your practices.
5. Fill **Test instructions** with the reviewer notes below. No BootCaT account, payment or
   API key is required. Prefer DuckDuckGo/Ecosia testing so Google login isn't necessary.
6. Choose distribution/visibility deliberately. Public suits the planned release; an unlisted
   listing is available only by direct link, but still goes through store review.
7. Review the complete listing before **Submit for review**. If you want to inspect the accepted
   listing before launch, choose deferred/manual publishing in the confirmation dialog.

The Chrome Web Store assigns a Chrome extension ID. Do not copy Firefox's email-shaped
add-on ID into Chrome or add a generated manifest key just to force the same identifier.
The Firefox ID stays unchanged in its separate browser manifest.

## Privacy practices — proposed field text

### Single purpose

Help users build local text corpora from web pages and documents they choose, by collecting
search results, downloading sources, extracting text and exporting the corpus.

Seeds, search restrictions, document review, language checks and export support this same
corpus-building purpose. BootCaT does not change the default search engine, homepage or new tab.

### activeTab justification

After the user opens the BootCaT popup and requests collection or page capture, access the
current tab to collect supported search-result links or save that page into the current
corpus. This also supports manual recovery after the user visits an access-check page.

### scripting justification

Execute only the extension's packaged DOM-reading functions in explicitly selected pages
or tracked project search tabs to collect result links or capture page content. When the user enables floating controls for an active project, a packaged isolated content script also displays icon controls on supported existing/new web tabs; it reads page content only after an explicit collection/capture click. It is dynamically unregistered when disabled or the project closes. No scripts
are downloaded from a server, and downloaded page scripts are not executed during extraction.

### storage justification

Retain local project settings, search collection records and user defaults, plus session-only
tracking of search tabs opened for the project. Document bodies/text are held in local
IndexedDB. The user can remove documents, close the current project, or replace it with a new/opened project.
There is no project synchronization or developer-operated storage server.

### Host permission justification — http://*/* and https://*/*

Users supply arbitrary source URLs to build corpora across websites. Host access enables
fetching those selected sources and reading supported result pages in project search tabs,
including tabs in the background when the user explicitly requests batch collection. A
fixed domain allowlist would prevent the core arbitrary-source corpus-building workflow.
BootCaT does not collect unrelated browser history or continuously scrape unrelated tabs.
Ordinary batch downloads omit credentials. Explicit PDF recovery may use the current website's
browser session. HTTP is supported for user-selected public sources, not developer telemetry;
search providers use HTTPS. Google searches may include the project's mapped result-language preference; no regional setting is added. Refer to the privacy policy for the exact network behaviour.

Do not add tabs, downloads, cookies or history permissions just to match another extension's
form. They are not declared by this release. Chrome will generate fields from the uploaded
manifest; justify the permissions actually shown.

### Remote code

Select **No, I am not using remote code** for this release. Readability, Defuddle, franc,
PDF.js and its worker are bundled locally. Downloaded documents are input data, not executable
extension code. HTML is parsed in detached documents; extracted HTML is not rendered in the
workspace. PDF text extraction uses a local worker, with useWasm/isEvalSupported set to false
and a CSP that does not allow unsafe-eval. Dynamic-import and Function-constructor patterns
inside bundled PDF.js are not evidence of remotely hosted code being executed by BootCaT.

### Data-use disclosure

Chrome requires disclosure even for data processed only on the user's device. Do not choose
"no user data" just because there is no BootCaT backend. The primary relevant categories are:

- **Website content**: explicitly collected search results, captured/downloaded pages, and
  document content used for corpus extraction. Imported PDF/DOCX and extracted text stay local.
- **Web history**: source/result URLs and records of project search tabs. This is the user's
  selected corpus workflow, not a general browsing-history collection feature.
- Where the form's **Authentication information** definition includes authentication cookies,
  disclose the narrowly scoped browser-managed website session used for explicit PDF recovery.
  BootCaT does not read or store passwords, provide a BootCaT login, or use a cookies API.
  Explain this scope to reviewers instead of claiming that a permission to read cookies exists.

Use the dashboard's actual definitions when completing these fields. There is no analytics,
advertising, keystroke/mouse tracking, geolocation feature or sale of corpus data. General
website/document text can contain personal information, but BootCaT does not target or
profile users based on financial, health or personal-communication data.

Data stays in the local browser except for user-requested searches/downloads: queries go to
the selected engine; source requests go to the destination/redirect sites; PDF recovery can
send that site's session cookies. Those services receive normal connection information,
including the IP address. Corpus text is not uploaded to the publisher. There is no sale,
unrelated transfer, advertising use or creditworthiness/lending use. The policy, listing,
form and actual extension must stay consistent.

## Reviewer test instructions

Use desktop Chrome 120 or later. No BootCaT account or API key is required.

1. Open the toolbar popup and click Open BootCaT. Choose New Project, name it and select No language detection.
2. Expand Seeds & Tuples. Enter five seeds, generate a few tuples, and prepare searches.
   Use DuckDuckGo or Ecosia; Google may require its own login or CAPTCHA.
3. Open project searches individually or with **Run all queries** after confirming the tab count and CAPTCHA warning. Wait for
   loading badges, then **Add URLs and close search tabs**. Only tabs opened for
   the current project are tracked for this batch action.
4. Alternatively enter https://www.iana.org/help/example-domains into URLs and download it.
   Review extracted text with **Preview text** (Edit, Save, Cancel), then **Export Corpus** in Project. Export contains original
   documents, texts, Report.xlsx and plain-text seeds/tuples/URL lists.
5. Visit a normal HTML page and use Add this page to corpus in the popup. Reopening the popup should
   indicate that the page is already included in the current corpus.
6. PDF/DOCX extraction works on public direct downloads, and failed-download rows support
   importing a locally downloaded file. OCR is absent. CAPTCHA solving is manual; BootCaT
   does not bypass access checks. Optional language checks flag mismatches for inspection.

Broad host permissions serve arbitrary user-chosen sources. No remote executable code,
analytics or developer backend is involved. For dependency/build provenance see
MOZILLA-SUBMISSION.md and the bundled vendor notices. The same shared source is used by both
browser packages, with separate manifests. Public source:
https://github.com/eroszanchetta/BootCaTExtension.

## Release materials and checks

Use [RELEASE-NOTES-2.1.md](RELEASE-NOTES-2.1.md) for What is new and
[RELEASE-CHECKLIST-2.1.md](RELEASE-CHECKLIST-2.1.md) for final-package/upgrade testing.
Refresh actual Chrome screenshots of the Project section, Build Corpus/text review and popup.
Verify the hosted privacy-policy page matches the newly generated public policy.

Reviewer checks should also include Settings; Save Project/Open Project with a .bootcat file;
and optional floating controls enabled from the popup. Their default is off. Files stay local,
except for the explicit search/source requests described in the privacy policy.

## Official references

- Registration: https://developer.chrome.com/docs/webstore/register
- Account/contact setup: https://developer.chrome.com/docs/webstore/set-up-account
- Upload/review: https://developer.chrome.com/docs/webstore/publish
- Privacy form: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Local processing disclosures: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Privacy policy: https://developer.chrome.com/docs/webstore/program-policies/privacy
- Listing images: https://developer.chrome.com/docs/webstore/images

Portable project review: Save Project downloads a .bootcat ZIP containing all project records and source/text files. Open Project reads a user-selected local file, validates it, then atomically replaces the current project after confirmation. No archive content is executed or sent to a server. User preferences remain on the receiving browser.

- Update an existing listing and deferred publication: https://developer.chrome.com/docs/webstore/update

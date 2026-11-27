# Extraction diagnosis and manual recovery in 2.2

## Supplied examples: evidence and limits

Checked on 27 November 2026 without a signed-in browser session:

- [IEEE example](https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=6755239&tag=1): the request returned HTTP 418, Content-Type text/html, 15,410 bytes, title “IEEE Xplore - Unable to Load Page”, no PDF signature in the first 1,024 bytes and no iframe/embed/object PDF source in the response. This response is an HTTP/page-access failure, not evidence of a PDF.js text failure. `fetchFile` rejects the HTTP error before extraction. It does not establish what the user's working viewer received. A real copy of this PDF has not been available to test; its actual text-extraction behavior remains unconfirmed.
- [Quizlet example](https://quizlet.com/study-guides/flower-parts-types-and-reproductive-structures-in-botany-18492ed5-15b8-4f5e-9fdf-17e87bccd729): HTTP 403 with HTML titled “Captcha Challenge…” and a challenge response header. A page displayed in a user's browser may differ from this download response or a saved passive snapshot. The supplied live article's exact extraction failure was not reproduced. No attempt was made to bypass the challenge.

Response bodies and session headers are diagnostic temporary files, not repository fixtures. These findings distinguish failed requests, HTML/wrapper responses and actual PDF parsing; they do not claim either site's access behavior is fixed.

## Evidence-backed parser changes

- A PDF-labelled response with a recognizable HTML opening and no PDF signature is reported as `html-instead-of-pdf`, before loading PDF.js. Original response bytes remain retained by normal download storage. This avoids presenting an access/wrapper response as an unexplained PDF parsing error. No remote iframe/redirect guessing or automatic credentialed request was added. HTML-labelled pages at .pdf URLs retain their existing HTML handling.
- The PDF extractor used to discard all successfully recovered page text if the subsequent optional metadata request failed. Metadata failure now adds a warning and preserves the text. Cancellation/timeout is still honored, parser/page failures still fail normally, and PDF.js version/security checks remain unchanged. A regression fixture exercises this code path; it is not a diagnosis of the unavailable IEEE PDF.
- Failed-request records retain the reported HTTP status alongside their URL, final URL and content type when supplied by the server.

## Manual text recovery

Details for a retained document with failed or unsupported extraction now permits Edit. Paste plain text copied from the page or document, then Save. Empty input and the configured technical edit limit are checked before saving; characters and language are reassessed. No new minimum/maximum corpus filter policy is introduced before WP6. A failure's default exclusion is not treated as a deliberate user choice. Language mismatch/uncertainty remains excluded with the existing review/Include anyway route; an ordinary existing text's known exclusion remains preserved.

Saving marks the text source as manual and, on the first recovery, retains the preceding extraction metadata/diagnostics under `recovery.previousExtraction`, together with the recovery method/time. The original URL, original downloaded bytes, earlier attempt records, baseline extracted text (including an empty baseline), and any raw PDF text remain unchanged. Later edits preserve the first recovery provenance. Corpus and portable-project exports carry these fields and texts. A successful save moves the row into Corpus documents; a language warning keeps it in Documents with issues. Recovery feedback is deferred behind the open editor and uses the existing green/amber row highlight when the editor closes.

Manual edits are protected at the storage transaction boundary: subsequent original/retry/failure writes cannot replace an edited document. Downloads skip manually edited text even if the original extraction had been interrupted. Queued browser captures already skip edited documents. Users can edit again or explicitly delete a document before replacing its original. Optimistic filename/revision checks, document locks, Cancel and dirty-close protection remain.

A failed download with no retained document still uses browser capture or Import downloaded file; this package does not fabricate an original document from pasted text. Once a source document is retained but extraction fails, manual text recovery is available. OCR and a general PDF rewrite remain deferred.

## WP7 example collected during this work

The existing English test paragraph beginning “Renewable energy requires careful planning and reliable electricity networks…” repeated five times returned leading `sco` with an uncertain assessment (“The leading language candidates are too close”) when checked against `eng`. The exact fixture is in tests/text-review.test.js. This is a comparison example for WP7; WP5 does not alter the detector or its uncertainty policy and does not silently accept uncertain manually pasted text.

## Validation

Regression coverage includes failed PDF/HTML and unsupported originals, Unicode, blank/oversized edits, cancellation, original/baseline/raw preservation, recovery metadata, language warnings, retry protection, corpus export, portable round trips and native modal behavior. Chromium/Firefox native DOM checks and the full Chromium extension/portable workflows determine PR readiness.

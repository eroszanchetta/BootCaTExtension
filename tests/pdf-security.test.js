import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFJS_VERSION, extractDownloadedDocument } from '../src/binary-extraction.js';
import { pdfFixture } from './browser-tests.fixtures.js';

test('package and runtime pin the same patched PDF.js release', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['pdfjs-dist'], '6.5.438');
  assert.equal(PDFJS_VERSION, pkg.dependencies['pdfjs-dist']);
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /import \{ PDFJS_VERSION \} from/);
});

test('stale or unversioned PDF modules fail closed before parsing document bytes', async () => {
  for (const version of ['5.6.205', '6.2.107', undefined]) {
    let parsed = false;
    const result = await extractDownloadedDocument(pdfFixture(), 'application/pdf', {
      loadPDF: async () => ({ version, getDocument() { parsed = true; throw new Error('Must never parse with a mismatched library'); } })
    });
    assert.equal(parsed, false);
    assert.equal(result.status, 'failed'); assert.equal(result.included, false);
    assert.equal(result.text, ''); assert.match(result.warnings.join(' '), /version mismatch/);
  }
});

test('PDF loading uses data-only parser options without viewer scripting', async () => {
  let options;
  const result = await extractDownloadedDocument(pdfFixture(), 'application/pdf', {
    loadPDF: async () => ({
      version: PDFJS_VERSION,
      getDocument(value) {
        options = value;
        return { promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'Corpus text', hasEOL: true }] }), cleanup() {} }),
          getMetadata: async () => ({ info: {} })
        }), destroy: async () => {} };
      }
    })
  });
  assert.equal(result.status, 'ok');
  assert.ok(options.data instanceof Uint8Array); assert.equal(options.url, undefined);
  assert.equal(options.useWasm, false); assert.equal(options.disableFontFace, true);
  assert.equal(options.useSystemFonts, false); assert.equal(options.useWorkerFetch, false);
  // enableScripting is a viewer setting, not a getDocument parser option.
  // Do not pretend that passing it here would disable a scripting manager.
  assert.equal(options.enableScripting, undefined);
  const manifest = JSON.parse(await readFile(new URL('../manifests/common.json', import.meta.url), 'utf8'));
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self';/);
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
});


test('HTML falsely labelled PDF is diagnosed before PDF parsing', async () => {
  let loaded=false;
  const bytes=new TextEncoder().encode('<!doctype html><title>Sign in</title><body>Not a PDF</body>');
  const result=await extractDownloadedDocument(bytes,'application/pdf',{loadPDF:async()=>{loaded=true;throw new Error('must not load')}});
  assert.equal(result.status,'failed'); assert.equal(result.failureKind,'html-instead-of-pdf'); assert.equal(loaded,false);
  assert.match(result.warnings.join(' '),/returned HTML/);
});

test('unreadable optional PDF metadata does not discard successfully recovered page text', async () => {
  const result=await extractDownloadedDocument(pdfFixture(),'application/pdf',{loadPDF:async()=>({version:PDFJS_VERSION,getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'Readable PDF text.',hasEOL:true}]}),cleanup(){}}),getMetadata:async()=>{throw new Error('Broken optional metadata')}}),destroy:async()=>{}})})});
  assert.equal(result.status,'ok'); assert.match(result.text,/Readable PDF text/); assert.match(result.warnings.join(' '),/metadata could not be read/);
});

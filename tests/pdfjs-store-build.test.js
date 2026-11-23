import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { PDFJS_UPSTREAM_SHA256, PDFJS_STORE_SHA256, preparePDFJS, assertPDFJSStoreBuild, verifyPackagedPDFJS, sha256 } from '../scripts/pdfjs-store-build.mjs';
import { extractDownloadedDocument } from '../src/binary-extraction.js';
import { pdfFixture } from './browser-tests.fixtures.js';
import { makeZIP } from '../src/zip.js';

const prepared = new Map();
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  test(`${name}: remove only the reviewed obsolete compatibility modules and reject unknown input`, async () => {
    const upstream = await readFile(new URL(`../node_modules/pdfjs-dist/legacy/build/${name}`, import.meta.url), 'utf8');
    assert.equal(sha256(upstream), PDFJS_UPSTREAM_SHA256[name]);
    const output = preparePDFJS(upstream, name); prepared.set(name, output);
    assert.equal(sha256(output), PDFJS_STORE_SHA256[name]);
    assert.match(output, /module\.exports = Object\.create;/);
    assert.match(output, /module\.exports = globalThis;/);
    assert.match(output, /Copyright 2024 Mozilla Foundation/);
    assert.match(output, /pdfjsVersion = 6\.5\.438/);
    assert.doesNotThrow(() => assertPDFJSStoreBuild(output, name));
    assert.throws(() => assertPDFJSStoreBuild(upstream, name), /Unsupported legacy code/);
    assert.throws(() => preparePDFJS(upstream + '\n', name), /Unreviewed PDF.js/);
    assert.equal(await readFile(new URL(`../node_modules/pdfjs-dist/legacy/build/${name}`, import.meta.url), 'utf8'), upstream, 'leave installed upstream files untouched');
  });
}

test('the prepared library and prepared worker extract a PDF without changing its original bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bootcat-pdf-store-'));
  try {
    const extension = await build('chromium', { outputRoot: root });
    for (const [filename, source] of prepared) assert.equal(await readFile(join(extension, 'vendor/pdfjs', filename), 'utf8'), source);
    const pdfjs = await import(pathToFileURL(join(extension, 'vendor/pdfjs/pdf.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(extension, 'vendor/pdfjs/pdf.worker.mjs')).href;
    const bytes = pdfFixture({ twoPages: true }), original = bytes.slice();
    const result = await extractDownloadedDocument(bytes, 'application/pdf', { loadPDF: async () => pdfjs });
    assert.equal(result.status, 'ok', result.warnings.join(' '));
    assert.equal(result.pageCount, 2); assert.match(result.text, /Renewable energy corpus/);
    assert.deepEqual(bytes, original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release ZIP verification rejects the old bundles, altered prepared code and missing notices', async () => {
  const files = [...prepared].map(([name, data]) => ({ name: `vendor/pdfjs/${name}`, data }));
  files.push({ name: 'vendor/pdfjs/README-BootCaT.md', data: 'Provenance' }, { name: 'vendor/pdfjs/LICENSE', data: 'Apache-2.0' });
  const zip = async entries => new Uint8Array(await makeZIP(entries).arrayBuffer());
  assert.equal((await verifyPackagedPDFJS(await zip(files))).length, 2);
  const old = await readFile(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url), 'utf8');
  await assert.rejects(verifyPackagedPDFJS(await zip(files.map(file => file.name.endsWith('/pdf.mjs') ? { ...file, data: old } : file))), /Unsupported legacy code/);
  await assert.rejects(verifyPackagedPDFJS(await zip(files.map(file => file.name.endsWith('/pdf.mjs') ? { ...file, data: file.data + '\n' } : file))), /Unreviewed prepared/);
  await assert.rejects(verifyPackagedPDFJS(await zip(files.filter(file => !file.name.endsWith('/LICENSE')))), /Missing PDF.js provenance/);
});

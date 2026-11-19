import { resetProjectLocalState } from '../src/project-local-state.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SETTING_FIELDS, readSettings, readSettingsState, saveSettings, validateSettings, fileLimit } from '../src/settings.js';
import { extractDocument } from '../src/extraction.js';
import { extractDownloadedDocument, PDFJS_VERSION } from '../src/binary-extraction.js';
import { pdfPageText } from '../src/pdf-layout.js';
import { checkEditedText } from '../src/text-review.js';
import { readImportedDocument } from '../src/document-formats.js';
import { addCollection } from '../src/collection.js';
import { captureCurrentPage } from '../src/page-capture.js';
import { captureTabDocument } from '../src/pdf-recovery.js';
import { workspace, extracted } from './helpers/workspace.js';
import vm from 'node:vm';
const areaFor = data => ({ get: async key => key === null ? structuredClone(data) : ({ [key]: structuredClone(data[key]) }), set: async patch => Object.assign(data, structuredClone(patch)), remove: async keys => { for (const key of keys) delete data[key]; } });
const settings = patch => validateSettings({ ...DEFAULT_SETTINGS, ...patch });

test('personal settings inherit defaults, persist independently and reject stale window saves', async () => {
  const data = { project: { id: 'existing' }, unrelated: 'preserved' }, area = areaFor(data);
  assert.deepEqual(await readSettings(area), DEFAULT_SETTINGS);
  const before = await readSettingsState(area);
  const first = await saveSettings(area, { fileMiB: 75, pdfPages: 600 }, before.revision);
  assert.equal(first.values.fileMiB, 75); assert.equal(first.values.pdfPages, 600); assert.equal(first.values.urlWarning, 500);
  await assert.rejects(saveSettings(area, DEFAULT_SETTINGS, before.revision), /another window/);
  assert.equal((await readSettings(area)).fileMiB, 75);
  await resetProjectLocalState(area, null); assert.equal((await readSettings(area)).pdfPages, 600);
  await resetProjectLocalState(area, { id: 'new' }); assert.equal((await readSettings(area)).fileMiB, 75);
  await saveSettings(area, DEFAULT_SETTINGS, first.revision);
  assert.deepEqual(await readSettings(area), DEFAULT_SETTINGS); assert.equal(data.project.id, 'new');
  data[SETTINGS_KEY] = { version: 99 }; await assert.rejects(readSettings(area), /Unsupported/);
});

test('every limit validates whole numbers and bounded ranges without silently changing invalid settings', async () => {
  for (const field of SETTING_FIELDS) {
    for (const value of [0, -1, 1.5, NaN, Infinity, '50', field.max + 1]) assert.throws(() => settings({ [field.key]: value }), /whole number/);
    assert.equal(settings({ [field.key]: field.max })[field.key], field.max);
  }
  assert.throws(() => validateSettings({ unknown: 1 }), /Unknown setting/);
  assert.equal(fileLimit(settings({ fileMiB: 2 })), 2 * 1024 * 1024);
});

test('HTML/plain extraction, per-page PDF text and edited text use configured limits', async () => {
  const bytes = new TextEncoder().encode('a'.repeat(1024 * 1024 + 1));
  assert.equal(extractDocument(bytes, 'text/plain').status, 'ok');
  assert.match(extractDocument(bytes, 'text/plain', { settings: settings({ htmlMiB: 1 }) }).warnings.join(' '), /1 MiB/);
  assert.throws(() => pdfPageText([{ str: 'abcdef' }], 5), /5 character/);
  assert.equal(pdfPageText([{ str: 'abcdef' }], 6), 'abcdef');
  await assert.rejects(checkEditedText(extracted('old'), 'abcdef', 'none', settings({ editCharacters: 5 })), /5 character/);
  assert.equal((await checkEditedText(extracted('old'), 'abcde', 'none', settings({ editCharacters: 5 }))).text, 'abcde');
});

test('PDF page limit rejects complete documents and configurable text caps reach both page and total checks', async () => {
  const pdf = { version: PDFJS_VERSION, getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'abcd.' }] }), cleanup() {} }), getMetadata: async () => ({ info: {} }) }), destroy: async () => {} }) };
  const bytes = new TextEncoder().encode('%PDF fixture');
  const run = patch => extractDownloadedDocument(bytes, 'application/pdf', { loadPDF: async () => pdf, settings: settings(patch) });
  assert.match((await run({ pdfPages: 1 })).warnings.join(' '), /1-page/);
  assert.match((await run({ pdfCharacters: 4 })).warnings.join(' '), /4 character/);
  assert.match((await run({ pdfCharacters: 8 })).warnings.join(' '), /8 character/);
  assert.equal((await run({ pdfPages: 2, pdfCharacters: 20 })).status, 'ok');
});

test('file imports and captured HTML enforce their configured limits before processing', async () => {
  await assert.rejects(readImportedDocument({ size: 1024 * 1024 + 1, arrayBuffer() { assert.fail('Do not read oversized file'); } }, 1024 * 1024), /1 MiB/);
  const context = { location: { protocol: 'https:', href: 'https://example.org' }, document: { contentType: 'text/html', querySelectorAll: () => Array(3) } };
  const result = vm.runInNewContext(`(${captureCurrentPage.toString()})({ htmlElements: 2 })`, context);
  assert.match(result.error, /too complex/);
});

test('collection settings preserve prior results when a custom page or result limit is exceeded', () => {
  const one = { engine: 'test', pageURL: 'https://one.test', results: [{ url: 'https://a.test' }] }, two = { ...one, pageURL: 'https://two.test' };
  assert.throws(() => addCollection([one], two, settings({ collectionPages: 1 })), /1 pages/);
  assert.throws(() => addCollection([one], two, settings({ collectionResults: 1 })), /1 results/);
  assert.equal(addCollection([one], one, settings({ collectionPages: 1 })).length, 1, 'recollection still replaces a page');
});

test('manual capture passes a snapshot of the configured page limits into the injected function', async () => {
  const configured = settings({ captureMiB: 4, htmlElements: 90000 });
  await captureTabDocument({ id: 1, url: 'https://example.org' }, { executeScript: async request => {
    assert.deepEqual(request.args, [{ captureMiB: 4, htmlElements: 90000 }]);
    return [{ result: { url: 'https://example.org', html: '<p>Saved</p>' } }];
  } }, { settings: configured });
});

test('download batches keep their starting settings while subsequent batches use new settings; URL count stays a warning', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const local = { [SETTINGS_KEY]: { version: 1, revision: 1, values: { fileMiB: 2, urlWarning: 1 } } }, limits = [], extractionLimits = [];
    const app = await workspace('settings-snapshot', { local, fetch: async (url, signal, limit) => {
      limits.push(limit); local[SETTINGS_KEY].values.fileMiB = 3;
      return { bytes: new TextEncoder().encode('body'), contentType: 'text/html', finalURL: url, status: 200 };
    }, extractor: async (bytes, type, options) => { extractionLimits.push(options.settings.fileMiB); return extracted('Text'); } });
    await app.input('urls', 'https://one.test\nhttps://two.test');
    assert.match(app.get('urls-warning').textContent, /2 URLs/);
    await app.click('start'); assert.deepEqual(limits, [2 * 1024 * 1024, 2 * 1024 * 1024]); assert.deepEqual(extractionLimits, [2, 2]);
    await app.input('urls', 'https://three.test'); await app.click('start'); assert.equal(limits.at(-1), 3 * 1024 * 1024);
  } finally { delete globalThis.indexedDB; }
});


test('configured extraction and download timeouts stop stalled work and report the chosen timeout', async () => {
  const keepAlive = setTimeout(() => {}, 5000);
  globalThis.indexedDB = new IDBFactory();
  try {
    const result = await extractDownloadedDocument(new TextEncoder().encode('%PDF'), 'application/pdf', { settings: settings({ extractionSeconds: 1 }), loadPDF: () => new Promise(() => {}) });
    assert.match(result.warnings.join(' '), /timed out after 1 seconds/);
    const app = await workspace('timeout-settings', { settings: { downloadSeconds: 1 }, fetch: (url, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })) });
    await app.input('urls', 'https://stalled.test'); await app.click('start');
    assert.match(app.state().entries[0].record.error, /Timed out after 1 seconds/);
  } finally { clearTimeout(keepAlive); delete globalThis.indexedDB; }
});

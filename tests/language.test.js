import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { checkLanguage, hasLanguageWarning, languageMessage, validateLanguage, supportedLanguages } from '../src/language-detection.js';
import { francDetector } from '../src/language-detectors/franc.js';
import { data } from '../src/vendor/franc/data.js';
import { expressions } from '../src/vendor/franc/expressions.js';
import { workspace, extracted } from './helpers/workspace.js';
import * as storage from '../src/project-store.js';
import { savePage } from '../src/page-store.js';

export const english = 'Renewable energy requires careful planning and reliable electricity networks. Technical terminology describes generation capacity, storage systems and distribution. Translators need clear examples of these expressions in context. These paragraphs provide a realistic corpus extraction fixture without involving a remote website.';
const italian = 'Questo documento è scritto in lingua italiana e contiene informazioni sulla ricerca linguistica e sulla creazione di corpora dal web. Gli studenti raccolgono documenti e analizzano il lessico per comprendere meglio il significato delle parole e delle espressioni nei diversi contesti.';
const french = 'Ce document est rédigé en français et présente des informations sur la recherche linguistique et la création de corpus. Les étudiants peuvent utiliser ces textes pour mieux comprendre le sens des mots et des expressions dans différents contextes.';

test('franc is packaged offline and detects representative prose; short, numeric and mixed samples remain uncertain', async () => {
  for (const [text, code] of [[english, 'eng'], [italian, 'ita'], [french, 'fra']]) {
    const result = francDetector.detect(text); assert.equal(result.detected, code); assert.equal(result.uncertain, false);
  }
  assert.equal(francDetector.detect('Short text.').uncertain, true);
  assert.equal(francDetector.detect('12345 '.repeat(1000)).uncertain, true);
  const mixed = francDetector.detect(english.repeat(15) + italian.repeat(15));
  assert.equal(mixed.uncertain, true); assert.match(mixed.reason, /different languages/);
  const large = francDetector.detect(english.repeat(10000)); assert.ok(large.samples.length <= 3); assert.ok(large.samples.every(sample => sample.letters <= 2048));
  const codes = new Set([...Object.values(data).flatMap(Object.keys), ...Object.keys(expressions).filter(key => !data[key])]);
  assert.deepEqual(new Set(supportedLanguages.map(item => item.code)), codes);
  assert.throws(() => validateLanguage(''), /Select a language/); assert.throws(() => validateLanguage('invalid'), /Select a language/);
  assert.equal(validateLanguage('none'), 'none');
});
test('common adapter results preserve successful extraction and manual choices without treating scores as probabilities', async () => {
  const mismatch = await checkLanguage(extracted(italian), 'eng');
  assert.equal(mismatch.status, 'ok'); assert.equal(mismatch.included, false); assert.equal(mismatch.languageCheck.outcome, 'mismatch'); assert.equal(mismatch.languageCheck.detector.version, '6.2.0');
  assert.equal(hasLanguageWarning(mismatch), true); assert.match(languageMessage(mismatch), /Italian.*English/);
  const same = await checkLanguage(mismatch, 'ita'); assert.equal(same.included, true); assert.equal(hasLanguageWarning(same), false);
  const uncertain = await checkLanguage(extracted('Short'), 'eng'); assert.equal(uncertain.languageCheck.outcome, 'uncertain'); assert.equal(uncertain.included, false);
  const off = await checkLanguage(mismatch, 'none', { detector: { detect() { assert.fail('off must not call detector'); } } }); assert.equal(off.included, true);
  const manual = { ...mismatch, included: true, languageCheck: { ...mismatch.languageCheck, accepted: true, inclusionBeforeCheck: true } };
  assert.equal((await checkLanguage(manual, 'eng')).included, true);
  assert.equal((await checkLanguage({ ...extracted(italian), included: false }, 'ita')).included, false);
  const failure = await checkLanguage(extracted(english), 'eng', { detector: { id: 'other', version: '1', detect() { throw new Error('Unavailable'); } } });
  assert.equal(failure.status, 'ok'); assert.equal(failure.languageCheck.outcome, 'uncertain'); assert.equal(failure.included, false);
});
test('language warnings persist, allow preview and manual override, and recheck without redownloading or replacing blobs', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('language', { language: 'ita', extractor: async () => ({ ...extracted(english), rawText: 'Baseline text' }) });
  await app.input('urls', 'https://example.org/article'); await app.click('start');
  const entry = app.state().entries[0]; assert.equal(entry.doc.extraction.status, 'ok'); assert.equal(entry.doc.extraction.included, false);
  assert.equal(app.get('problem-results').children.length, 1); assert.equal(app.get('results').children.length, 0);
  const row = app.get('problem-results').children[0]; assert.equal(row.children[0].children[0].disabled, true);
  await row.children[2].children.find(node => node.className === 'secondary preview-button').handlers.click(); assert.equal(app.get('preview-text').value, english);
  const original = await storage.readOriginal('language', entry.doc.filename);
  await row.children[2].children.find(node => node.className === 'secondary accept-language').handlers.click();
  assert.equal(app.get('problem-results').children.length, 0); assert.equal(app.get('results').children.length, 1);
  let saved = (await storage.loadWorkspace('language')).entries[0]; assert.equal(saved.doc.extraction.languageCheck.accepted, true); assert.equal(saved.doc.extraction.included, true);
  await app.click('recheck-language'); assert.equal(app.fetched.length, 1); assert.equal(app.get('results').children.length, 1);
  assert.equal(await (await storage.readRawText('language', entry.url)).text(), 'Baseline text');
  assert.deepEqual(await (await storage.readOriginal('language', entry.doc.filename)).arrayBuffer(), await original.arrayBuffer());
  await app.click('export'); const zip = await app.archive().text(); assert.ok(zip.includes('languageCheck')); assert.ok(zip.includes('accepted')); assert.ok(zip.includes(english));
  const reopened = await workspace('language', { language: 'ita' }); assert.equal(reopened.get('results').children.length, 1);
  const checkbox = reopened.get('results').children[0].children[0].children[0]; checkbox.checked = false; await checkbox.handlers.change();
  reopened.get('project-language').value = 'none'; await reopened.get('project-language').handlers.change(); await reopened.click('recheck-language');
  saved = (await storage.loadWorkspace('language')).entries[0]; assert.equal(saved.doc.extraction.included, false); assert.equal(saved.doc.extraction.languageCheck.outcome, 'disabled');
});
test('tab captures use the same language check while extraction failures stay extraction failures', async () => {
  globalThis.indexedDB = new IDBFactory();
  const app = await workspace('capture-language', { language: 'ita' });
  await savePage({ id: 'capture', url: 'https://example.org/captured', html: '<p>Snapshot</p>' }); await app.notify({ captureRevision: { newValue: 'new' } });
  assert.equal(app.state().entries[0].doc.extraction.languageCheck.outcome, 'uncertain'); assert.equal(app.get('problem-results').children.length, 1);
  const failure = { ...extracted(''), status: 'failed', included: false }; assert.deepEqual(await checkLanguage(failure, 'eng'), failure);
});

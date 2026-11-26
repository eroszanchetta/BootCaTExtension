import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryOutcome, preserveRecoveryInclusion } from '../src/recovery-feedback.js';
import { checkLanguage } from '../src/language-detection.js';
const extraction = patch => ({ status: 'ok', included: true, text: 'Recovered text.', characters: 15, warnings: [], ...patch });
const entry = patch => ({ doc: { extraction: extraction(patch) } });
test('recovery keeps success concise and explains language warnings and extraction failure', () => {
  assert.equal(recoveryOutcome(entry({}), 'PDF').message, 'Text recovered successfully');
  const excluded = recoveryOutcome(entry({ included: false }), 'DOCX');
  assert.equal(excluded.tone, 'success'); assert.equal(excluded.message, 'Text recovered successfully');
  const warning = recoveryOutcome(entry({ included: false, languageCheck: { outcome: 'mismatch', detected: 'eng', target: 'ita' } }), 'PDF');
  assert.equal(warning.tone, 'warning'); assert.match(warning.message, /expected Italian/); assert.match(warning.message, /remains in Documents with issues/);
  const failed = recoveryOutcome(entry({ status: 'failed', warnings: ['Extraction timed out.'] }), 'PDF');
  assert.equal(failed.tone, 'warning'); assert.match(failed.message, /timed out/); assert.doesNotMatch(failed.message, /successfully/);
});
test('known inclusion choices survive a new extraction, while failed or language-flagged defaults do not veto recovery', async () => {
  const next = preserveRecoveryInclusion(extraction({}), extraction({ included: false }));
  assert.equal((await checkLanguage(next, 'none')).included, false);
  assert.equal(preserveRecoveryInclusion(extraction({}), extraction({ status: 'failed', included: false })).included, true);
  assert.equal(preserveRecoveryInclusion(extraction({}), extraction({ included: false, languageCheck: { outcome: 'uncertain', accepted: false } })).included, true);
});

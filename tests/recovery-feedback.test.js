import {IDBFactory} from 'fake-indexeddb';
import {workspace,extracted} from './helpers/workspace.js';
import * as storage from '../src/project-store.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryOutcome, preserveRecoveryInclusion } from '../src/recovery-feedback.js';
import { checkLanguage } from '../src/language-detection.js';
const extraction = patch => ({ status: 'ok', included: true, text: 'Recovered text.', characters: 15, warnings: [], ...patch });
const entry = patch => ({ doc: { extraction: extraction(patch) } });
test('recovery keeps success concise and explains language warnings and extraction failure', () => {
  assert.equal(recoveryOutcome(entry({}), 'PDF').message, 'Download recovered');
  const excluded = recoveryOutcome(entry({ included: false }), 'DOCX');
  assert.equal(excluded.tone, 'success'); assert.equal(excluded.message, 'Download recovered');
  const warning = recoveryOutcome(entry({ included: false, languageCheck: { outcome: 'mismatch', detected: 'eng', target: 'ita' } }), 'PDF');
  assert.equal(warning.tone, 'warning'); assert.equal(warning.message, 'File imported · language review needed');
  const failed = recoveryOutcome(entry({ status: 'failed', warnings: ['Extraction timed out.'] }), 'PDF');
  assert.equal(failed.tone, 'warning'); assert.equal(failed.message, 'File imported · text still unavailable'); assert.doesNotMatch(failed.message, /successfully/);
});
test('known inclusion choices survive a new extraction, while failed or language-flagged defaults do not veto recovery', async () => {
  const next = preserveRecoveryInclusion(extraction({}), extraction({ included: false }));
  assert.equal((await checkLanguage(next, 'none')).included, false);
  assert.equal(preserveRecoveryInclusion(extraction({}), extraction({ status: 'failed', included: false })).included, true);
  assert.equal(preserveRecoveryInclusion(extraction({}), extraction({ included: false, languageCheck: { outcome: 'uncertain', accepted: false } })).included, true);
});

test('Include anyway and bulk language review share resolution feedback without changing passive restores',async()=>{
  globalThis.indexedDB=new IDBFactory();
  try {
    const feedback=[], english='Renewable energy requires careful planning and reliable electricity networks. Technical terminology describes generation capacity, storage systems and distribution. Translators need clear examples of these expressions in context. '.repeat(4);
    const app=await workspace('resolution',{language:'ita',extractor:async()=>extracted(english),onRecoveryFeedback:value=>feedback.push(value)});
    await app.input('urls','https://example.org/a\nhttps://example.org/b\nhttps://example.org/c'); await app.click('start');
    assert.equal(app.get('problem-results').children.length,3);
    const accept=app.get('problem-results').children[0].children[2].children.find(node=>node.textContent==='Include anyway');
    await accept.handlers.click(); assert.equal(app.get('document-import-status').textContent,'Language warning accepted'); assert.equal(feedback.length,1);
    assert.equal((await storage.loadWorkspace('resolution')).entries[0].doc.manualInterventions.includes('language-override'),true);
    await app.input('project-language','none'); await app.get('project-language').handlers.change(); await app.click('recheck-language');
    assert.equal(app.get('problem-results').children.length,0); assert.equal(feedback.length,2);
    assert.equal(feedback[1].urls.length,2); assert.equal(app.get('document-import-status').textContent,'Language review cleared (2 documents)');
    const count=feedback.length; await app.focus(); assert.equal(feedback.length,count,'passive metadata refresh does not repeat recovery feedback');
  } finally {delete globalThis.indexedDB;}
});

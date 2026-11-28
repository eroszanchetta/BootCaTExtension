import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLanguage } from '../src/language-detection.js';
import { assessLanguage } from '../src/language-detectors/select.js';
import { nativeSupports, nativeLanguageCode, detectionBrowser } from '../src/language-detectors/native.js';
import { languageSamples } from '../src/language-detectors/sampling.js';
import { francDetector } from '../src/language-detectors/franc.js';
import { extracted } from './helpers/workspace.js';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../src/project-store.js';
import { transaction } from '../src/storage-db.js';
import { makeProjectArchive, openProjectArchive, restoredProjectSnapshot } from '../src/portable-project.js';
const prose = 'This scientific document describes plant development and examines the formation of leaves and flowers. Researchers compare specimens and record their observations in detailed tables. '.repeat(50);
const browserInfo = { name: 'Chrome', version: '120.0.1234.5' };
const native = (result = { isReliable: true, languages: [{ language: 'en', percentage: 100 }] }) => ({ i18n: { detectLanguage: async () => structuredClone(result) } });

test('native detection keeps the exact policy-1 sample positions, minimum letters and unanimous aggregation', async () => {
  const calls = [], api = native(); api.i18n.detectLanguage = async text => { calls.push(text); return {isReliable:true,languages:[{language:'en',percentage:100}]}; };
  const result = await assessLanguage(prose, 'eng', { strategy: 'native-franc', api, browserInfo });
  assert.equal(result.detector.id, 'native'); assert.equal(result.uncertain, false);
  assert.deepEqual(calls, languageSamples(prose).map(s => s.text));
  assert.deepEqual(result.samples.map(s => s.start), francDetector.detect(prose).samples.map(s => s.start));
  assert.equal(result.policy.version, '1'); assert.equal(result.policy.minLetters, 120); assert.equal(result.policy.window, 2048);
  const tail = prose + '1234567890'.repeat(220);
  const uncertain = await assessLanguage(tail, 'eng', {strategy:'native-franc',api,browserInfo});
  assert.equal(uncertain.uncertain,true); assert.equal(uncertain.detector.id,'native'); assert.equal(uncertain.fallbackReason,undefined);
  assert.equal(uncertain.samples.at(-1).letters,0);
});

test('native mismatches and unreliable results are never replaced by a more agreeable franc result', async () => {
  for (const [reliable, outcome] of [[true,'mismatch'],[false,'uncertain']]) {
    const e = await checkLanguage(extracted(prose),'eng',{strategy:'native-franc',browserInfo,api:native({isReliable:reliable,languages:[{language:'fr',percentage:90},{language:'en',percentage:10}]})});
    assert.equal(e.languageCheck.outcome,outcome); assert.equal(e.languageCheck.detector.id,'native'); assert.equal(e.included,false);
    assert.equal(e.languageCheck.fallbackReason,undefined); assert.equal(e.languageCheck.samples[0].native.languages[0].percentage,90);
    assert.deepEqual(e.languageCheck.browser,browserInfo);
  }
});

test('fallback is limited to unverified coverage and API failures; native-only never invokes franc', async () => {
  const unavailable = await assessLanguage(prose,'eng',{strategy:'native-franc',api:{},browserInfo});
  assert.equal(unavailable.detector.id,'franc'); assert.match(unavailable.fallbackReason,/API unavailable/);
  const throwing = {i18n:{detectLanguage:async()=>{throw Error('failure');}}};
  assert.equal((await assessLanguage(prose,'eng',{strategy:'native-franc',api:throwing,browserInfo})).fallbackReason,'Native API error.');
  const noCall = {i18n:{detectLanguage(){assert.fail('unverified language must not invoke native');}}};
  const fallback = await assessLanguage(prose,'qug',{strategy:'native-franc',api:noCall,browserInfo});
  assert.equal(fallback.detector.id,'franc'); assert.match(fallback.fallbackReason,/coverage/);
  for (const options of [{api:{},target:'eng'},{api:throwing,target:'eng'},{api:noCall,target:'qug'}]) {
    const result = await assessLanguage(prose,options.target,{strategy:'native',api:options.api,browserInfo});
    assert.equal(result.detector.id,'native'); assert.equal(result.unavailable,true); assert.equal(result.uncertain,true);
  }
  const franc = await assessLanguage(prose,'eng',{strategy:'franc',api:noCall,browserInfo});
  assert.equal(franc.detector.id,'franc'); assert.equal(franc.fallbackReason,undefined);
  await assert.rejects(assessLanguage(prose,'eng',{strategy:'invalid'}),/supported language detector/);
});

test('native calls have a bounded timeout and retain a timeout-specific fallback reason', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  try {
    const pending = assessLanguage(prose,'eng',{strategy:'native-franc',api:{i18n:{detectLanguage:()=>new Promise(()=>{})}},browserInfo});
    t.mock.timers.tick(5001);
    const result = await pending; assert.equal(result.detector.id,'franc'); assert.match(result.fallbackReason,/timed out/);
  } finally { t.mock.timers.reset(); }
});

test('coverage and code mapping respect browser differences and macrolanguage distinctions', async () => {
  assert.equal(nativeSupports('eng',browserInfo),true); assert.equal(nativeSupports('ita',{name:'Firefox'}),true);
  assert.equal(nativeSupports('lat',browserInfo),true); assert.equal(nativeSupports('lat',{name:'Firefox'}),false);
  assert.equal(nativeSupports('arb',browserInfo),false); assert.equal(nativeSupports('cmn',browserInfo),false);
  assert.equal(nativeSupports('eng',{name:'Unknown'}),false);
  assert.equal(nativeLanguageCode('iw'),'heb'); assert.equal(nativeLanguageCode('fr-CA'),'fra');
  assert.equal(nativeLanguageCode('ar'),'ara'); assert.equal(nativeLanguageCode('zh-CN'),'zho');
  assert.equal(nativeLanguageCode('und'),null);
  assert.deepEqual(await detectionBrowser({runtime:{getBrowserInfo:async()=>({name:'Firefox',version:'140.0'})}}),{name:'Firefox',version:'140.0'});
});

test('legacy projects retain franc, strategy changes preserve assessments until explicit recheck, and metadata travels portably', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const project = {id:'detectors',name:'Detector experiment',language:'eng',nameConfirmed:true};
    await storage.resetStoredProject(project.id,{},project);
    assert.equal((await storage.loadWorkspace(project.id)).draft.languageDetector,'native-franc');
    await transaction(['meta'],'readwrite',tx=>{const store=tx.objectStore('meta'),r=store.get('draft');r.onsuccess=()=>{delete r.result.languageDetector;store.put(r.result);};});
    const { validateCorpusOptions } = await import('../src/corpus-options.js');
    assert.equal(validateCorpusOptions((await storage.loadWorkspace(project.id)).draft).languageDetector,'franc');
    const url='https://example.org/research',filename='pages/research.html';
    const e=await checkLanguage(extracted(prose),'eng',{strategy:'franc',browserInfo});
    await storage.saveDocument(project.id,{url,filename,outcome:'downloaded'},{url,filename,textFilename:'corpus/research.txt',extraction:e},new Blob(['original']));
    const before=(await storage.loadWorkspace(project.id)).entries[0].doc.extraction.languageCheck;
    await storage.saveCorpusOptions(project.id,{languageDetector:'native'},0);
    assert.deepEqual((await storage.loadWorkspace(project.id)).entries[0].doc.extraction.languageCheck,before);
    const checked=await checkLanguage(extracted(prose),'eng',{strategy:'native',api:native(),browserInfo});
    await storage.saveLanguageCheck(project.id,url,filename,checked.languageCheck,checked.included,{manualRecheck:true});
    const file=await makeProjectArchive(await storage.snapshotStoredProject(project));
    const restored=restoredProjectSnapshot(await openProjectArchive(file));
    await storage.replaceStoredProject(project.id,restored,restored.project);
    const saved=await storage.loadWorkspace(restored.project.id);
    assert.equal(saved.draft.languageDetector,'native');
    assert.equal(saved.entries[0].doc.extraction.languageCheck.detector.id,'native');
    assert.deepEqual(saved.entries[0].doc.extraction.languageCheck.browser,browserInfo);
    assert.equal(saved.entries[0].doc.extraction.languageCheck.samples[0].native.languages[0].percentage,100);
  } finally {delete globalThis.indexedDB;}
});

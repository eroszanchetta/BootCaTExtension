import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {manualActions} from '../src/manual-intervention.js';
import * as store from '../src/project-store.js';
import {makeProjectArchive,openProjectArchive} from '../src/portable-project.js';
import {extractionMetadata} from '../src/corpus.js';
test('manual actions survive later language checks, text edits and portable/corpus metadata',async()=>{
  globalThis.indexedDB=new IDBFactory();
  try {
    const project={id:'hand',name:'Manual actions',language:'none',nameConfirmed:true},url='https://example.org/',filename='pages/source.html';
    await store.resetStoredProject(project.id,{},project);
    const extraction={status:'ok',included:true,characters:4,text:'Text',warnings:[]};
    let entry=await store.saveDocument(project.id,{url,filename,outcome:'downloaded'},{url,filename,textFilename:'corpus/source.txt',extraction},new Blob(['Source']));
    assert.deepEqual(manualActions(entry),[]);
    await store.setIncluded(project.id,url,false);
    entry=await store.saveLanguageCheck(project.id,url,filename,{outcome:'mismatch',accepted:true},true);
    entry=await store.saveLanguageCheck(project.id,url,filename,{outcome:'disabled',accepted:false},true,{manualRecheck:true});
    assert.deepEqual(manualActions(entry),['inclusion-change','language-override','language-recheck']);
    entry=await store.saveEditedText(project.id,url,{filename,revision:0},'Manual text',{...extraction,text:undefined,textSource:'manual',characters:11});
    assert.ok(manualActions(entry).includes('text-edit'));
    const restored=await openProjectArchive(await makeProjectArchive(await store.snapshotStoredProject(project)));
    assert.deepEqual(restored.stores.documents[0].doc.manualInterventions,entry.doc.manualInterventions);
    assert.deepEqual(extractionMetadata([entry.doc])[0].manualInterventions,entry.doc.manualInterventions);
  } finally {delete globalThis.indexedDB;}
});
test('legacy capture/import/edit/override metadata is recognized without rewriting it',()=>{
  const entry={record:{outcome:'captured',source:'local-file',previousAttempt:{outcome:'captured',source:'browser-tab'}},doc:{editRevision:1,extraction:{recovery:{method:'manual-text'},languageCheck:{accepted:true}}}};
  assert.deepEqual(manualActions(entry),['file-import','browser-capture','manual-text','language-override']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadFeedback, DOWNLOAD_FEEDBACK_KEY, feedbackAppearance, downloadSummary } from '../src/download-feedback.js';
function fixture({entries} = {}) {
  const local = {}, listeners = [], action = { text: '', title: '' };
  let project = { id: 'p' }, active = true, tail = Promise.resolve(), rejectBadge = false;
  const ext = { runtime: {}, storage: { local: {
    get: async key => ({ [key]: structuredClone(local[key]) }),
    set: async patch => { Object.assign(local, structuredClone(patch)); for (const [key, newValue] of Object.entries(patch)) for (const fn of listeners) fn({ [key]: { newValue } }, 'local'); }
  }, onChanged: { addListener: fn => listeners.push(fn) } }, action: {
    setBadgeText: async ({ text }) => { if (rejectBadge) throw new Error('Unavailable'); action.text = text; },
    setTitle: async ({ title }) => { action.title = title; }
  } };
  const service = createDownloadFeedback({ ext, getProject: async () => project, getEntries: entries ? async () => entries.current : null, batchActive: async () => active,
    serialize: task => { const next = tail.then(task); tail = next.catch(() => {}); return next; } });
  return { service, local, action, active: value => { active = value; }, project: value => { project = value; }, rejectBadge() { rejectBadge = true; },
    send: (type, patch = {}) => service.handle({ type: 'download-feedback-' + type, projectId: 'p', runId: 'run', ...patch }) };
}

test('progress waits for usable text; failures are retained in a persistent completion receipt', async () => {
  const f = fixture(); await f.service.sync();
  await f.send('start', { total: 2 }); assert.equal(f.action.text, '…');
  await f.send('progress', { phase: 'extracting' });
  assert.match(downloadSummary(f.local[DOWNLOAD_FEEDBACK_KEY]), /Extracting text 1 of 2/);
  assert.equal(f.local[DOWNLOAD_FEEDBACK_KEY].processed, 0);
  await assert.rejects(f.send('finish', { state: 'finished' }), /not finished/);
  await f.send('progress', { processed: 1, usable: 1, phase: 'downloading' });
  await f.send('progress', { phase: 'downloading' }); assert.equal(f.local[DOWNLOAD_FEEDBACK_KEY].processed, 1, 'stale progress cannot move backwards');
  await assert.rejects(f.send('progress', { processed: 2, usable: 1, phase: 'downloading' }), /Inconsistent/);
  await f.send('finish', { state: 'finished', processed: 2, usable: 1, failed: 1 });
  assert.equal(f.action.text, '!'); assert.match(f.action.title, /1 failed/);
  assert.match(feedbackAppearance(f.local[DOWNLOAD_FEEDBACK_KEY]).tabTitle, /Finished with issues/);
  await f.service.sync(); assert.equal(f.action.text, '!', 'reading or focusing does not acknowledge completion');
  await f.send('dismiss'); assert.equal(f.action.text, ''); assert.equal(f.local[DOWNLOAD_FEEDBACK_KEY].acknowledged, true);
  assert.match(downloadSummary(f.local[DOWNLOAD_FEEDBACK_KEY]), /1 failed/, 'the detailed receipt survives dismissal');
});

test('run identity fences stale completions; stopped and interrupted runs never report success', async () => {
  const f = fixture(); await f.service.sync();
  await f.send('start', { total: 3 });
  await f.send('finish', { state: 'stopped', processed: 1, cancelled: 1 });
  assert.equal(f.action.text, 'STOP'); assert.match(f.action.title, /1 cancelled/);
  await f.send('start', { total: 1, runId: 'next' });
  await f.send('finish', { state: 'finished', processed: 3, usable: 3 });
  assert.equal(f.local[DOWNLOAD_FEEDBACK_KEY].runId, 'next'); assert.equal(f.action.text, '…');
  f.active(false); await f.service.sync(); assert.equal(f.local[DOWNLOAD_FEEDBACK_KEY].state, 'interrupted');
  assert.match(f.action.title, /Interrupted/); assert.equal(f.action.text, '!');
  f.project({ id: 'replacement' }); await f.service.sync(); assert.equal(f.action.text, '', 'another project cannot inherit the badge');
});

test('clean completion and language warnings have distinct badges; badge API failure is non-fatal', async () => {
  const f = fixture(); await f.service.sync();
  await f.send('start', { total: 1 });
  await f.send('finish', { state: 'finished', processed: 1, usable: 1 }); assert.equal(f.action.text, '✓');
  await f.send('start', { total: 1 });
  await f.send('finish', { state: 'finished', processed: 1, usable: 1, flagged: 1 });
  assert.equal(f.action.text, '!'); assert.match(f.action.title, /1 language warning/);
  f.rejectBadge(); await f.send('start', { total: 1 });
  const reply = await f.send('finish', { state: 'interrupted' });
  assert.equal(reply.feedback.state, 'interrupted');
});

test('finished feedback follows current issues while keeping the original counts and dismissal', async () => {
  const entries={current:[{url:'https://failed.test/',doc:null}]}; const f=fixture({entries}); await f.service.sync();
  await f.send('start',{total:1}); await f.send('finish',{state:'finished',processed:1,failed:1});
  assert.equal(f.action.text,'!'); assert.equal(f.local[DOWNLOAD_FEEDBACK_KEY].remainingIssues,1);
  entries.current=[{doc:{extraction:{status:'ok',included:false}}}];
  await f.service.sync(); let value=f.local[DOWNLOAD_FEEDBACK_KEY];
  assert.equal(value.failed,1); assert.equal(value.remainingIssues,0); assert.equal(f.action.text,'✓');
  assert.match(downloadSummary(value),/All issues resolved/); assert.doesNotMatch(downloadSummary(value),/1 failed/);
  assert.match(downloadSummary({...value,remainingIssues:undefined}),/1 failed/);
  entries.current.push({doc:{extraction:{status:'ok',languageCheck:{outcome:'mismatch',accepted:false}}}});
  await f.service.sync(); assert.equal(f.action.text,'!');
  await f.send('dismiss'); entries.current=[]; await f.service.sync(); assert.equal(f.action.text,''); assert.equal(f.local[DOWNLOAD_FEEDBACK_KEY].acknowledged,true);
  await f.send('start',{total:1}); await f.send('finish',{state:'finished',processed:1,usable:1});
  entries.current=[{doc:null}]; await f.service.sync(); assert.equal(f.action.text,'!');
  entries.current=[]; await f.service.sync(); assert.match(downloadSummary(f.local[DOWNLOAD_FEEDBACK_KEY]),/All issues resolved/);
  await f.send('start',{total:2}); await f.send('finish',{state:'stopped',processed:1,cancelled:1}); await f.service.sync(); assert.equal(f.action.text,'STOP');
});

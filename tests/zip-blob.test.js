import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeStoredZIP } from '../src/zip-blob.js';

for (const forceZIP64 of [false, true]) test(`Blob ZIP ${forceZIP64 ? 'ZIP64' : 'classic'} round-trips binary and Unicode through an independent reader`, async () => {
  const original = new Blob([new Uint8Array([0, 255, 128, 10])]);
  original.arrayBuffer = () => { throw new Error('Do not materialize original file buffers'); };
  async function* files() {
    yield { name: 'pages/file.bin', blob: original };
    yield { name: 'corpus/caffè-中文.txt', blob: new Blob(['Caffè 中文\n']) };
  }
  const zip = await makeStoredZIP(files(), { forceZIP64 });
  const result = JSON.parse(execFileSync('python3', ['-c', `
import sys,io,zipfile,json
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 print(json.dumps({'binary':list(z.read('pages/file.bin')), 'text':z.read('corpus/caffè-中文.txt').decode()}))
`], { input: Buffer.from(await zip.arrayBuffer()), encoding: 'utf8' }));
  assert.deepEqual(result, { binary: [0, 255, 128, 10], text: 'Caffè 中文\n' });
});

test('Blob ZIP rejects duplicates and cancellation without changing source blobs', async () => {
  const blob = new Blob(['source']);
  await assert.rejects(makeStoredZIP([{ name: 'same', blob }, { name: 'same', blob }]), /Duplicate/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(makeStoredZIP([{ name: 'one', blob }], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(await blob.text(), 'source');
});

for (const forceZIP64 of [false, true]) test(`Blob ZIP ${forceZIP64 ? 'ZIP64' : 'classic'} records one local export time in local and central headers`, async () => {
  const timestamp = new Date(2026, 10, 24, 14, 37, 59);
  const zip = await makeStoredZIP([{ name: 'one.txt', data: 'one' }, { name: 'two.txt', data: 'two' }], { forceZIP64, timestamp });
  const dates = JSON.parse(execFileSync('python3', ['-c', `
import sys,io,json,zipfile,struct
raw=sys.stdin.buffer.read()
with zipfile.ZipFile(io.BytesIO(raw)) as z:
 result=[]
 for info in z.infolist():
  time,date=struct.unpack_from('<HH',raw,info.header_offset+10)
  local=[1980+(date>>9),(date>>5)&15,date&31,time>>11,(time>>5)&63,(time&31)*2]
  assert list(info.date_time)==local
  result.append(local)
 print(json.dumps(result))
`], { input: Buffer.from(await zip.arrayBuffer()), encoding: 'utf8' }));
  assert.deepEqual(dates, [[2026, 11, 24, 14, 37, 58], [2026, 11, 24, 14, 37, 58]]);
  assert.equal(timestamp.getSeconds(), 59, 'do not alter the supplied date');
});

test('archive times clamp to ZIP range and reject invalid dates', async () => {
  for (const [timestamp, expected] of [[new Date(1970, 0, 1), [1980, 1, 1, 0, 0, 0]], [new Date(2200, 0, 1), [2107, 12, 31, 23, 59, 58]]]) {
    const zip = await makeStoredZIP([{ name: 'file', data: 'text' }], { timestamp });
    const date = JSON.parse(execFileSync('python3', ['-c', 'import sys,io,zipfile,json; print(json.dumps(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).infolist()[0].date_time))'], { input: Buffer.from(await zip.arrayBuffer()), encoding: 'utf8' }));
    assert.deepEqual(date, expected);
  }
  await assert.rejects(makeStoredZIP([], { timestamp: new Date(NaN) }), /Invalid archive timestamp/);
});

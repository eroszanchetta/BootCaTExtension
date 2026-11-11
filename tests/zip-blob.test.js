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

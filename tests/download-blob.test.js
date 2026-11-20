import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDownloadBlob } from '../src/download-blob.js';
test('download preparation reads a complete independent stream and preserves binary bytes and MIME', async () => {
  const source = new Blob([new Uint8Array([0, 255, 128]), 'è 中文'], { type: 'application/zip' });
  source.arrayBuffer = () => { throw new Error('Do not allocate a full source ArrayBuffer'); };
  const copy = await prepareDownloadBlob(source);
  assert.notEqual(copy, source); assert.equal(copy.type, 'application/zip');
  assert.deepEqual(new Uint8Array(await copy.arrayBuffer()), new Uint8Array([0,255,128,195,168,32,228,184,173,230,150,135]));
});
test('download preparation rejects unreadable or incomplete source streams before creating a download', async () => {
  const failed = new Blob(['data']); failed.stream = () => new ReadableStream({ start(controller) { controller.error(new Error('Stored file could not be read')); } });
  await assert.rejects(prepareDownloadBlob(failed), /Stored file could not be read/);
  const partial = new Blob(['data']); partial.stream = () => new Blob(['d']).stream();
  await assert.rejects(prepareDownloadBlob(partial), /complete project/);
});

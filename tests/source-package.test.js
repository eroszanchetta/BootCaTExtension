import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceFiles, SOURCE_ENTRIES } from '../scripts/package-source.mjs';
import { makeZIP } from '../src/zip.js';

test('source package includes rebuild inputs and excludes generated/private files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bootcat-source-'));
  try {
    for (const name of SOURCE_ENTRIES) {
      if (name.includes('.json') || ['README.md', 'LICENSE', 'NOTICE'].includes(name)) await writeFile(join(root, name), name);
      else {
        await mkdir(join(root, name));
        await writeFile(join(root, name, 'input.js'), name);
      }
    }
    for (const name of ['node_modules', 'dist', '.git', 'browser-profile']) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, 'excluded'), 'private or generated');
    }
    await writeFile(join(root, 'unlisted-secret.txt'), 'not a source input');
    const files = await sourceFiles(root);
    assert.equal(files.length, SOURCE_ENTRIES.length);
    assert.ok(files.some(f => f.name === 'package-lock.json'));
    assert.ok(files.some(f => f.name === 'src/input.js'));
    assert.ok(!files.some(f => /excluded|secret/.test(f.name)));
    const first = await makeZIP(files).arrayBuffer();
    const second = await makeZIP(await sourceFiles(root)).arrayBuffer();
    assert.deepEqual(new Uint8Array(first), new Uint8Array(second));
    await symlink(join(root, 'unlisted-secret.txt'), join(root, 'src', 'linked-secret'));
    await assert.rejects(sourceFiles(root), /symbolic link/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real source archive contains complete licence and reviewer rebuild instructions', async () => {
  const files = await sourceFiles();
  const names = files.map(f => f.name);
  for (const name of ['LICENSE', 'NOTICE', 'package-lock.json', 'scripts/build.mjs',
    'scripts/package-source.mjs', 'manifests/firefox.json', 'docs/MOZILLA-SUBMISSION.md',
    'src/about.html', 'src/vendor/Readability.js']) assert.ok(names.includes(name), name);
  const licence = new TextDecoder().decode(files.find(f => f.name === 'LICENSE').data);
  assert.match(licence, /GNU GENERAL PUBLIC LICENSE/);
  assert.match(licence, /END OF TERMS AND CONDITIONS/);
  assert.deepEqual(files.find(f => f.name === 'LICENSE').data,
    new Uint8Array(await readFile(new URL('../LICENSE', import.meta.url))));
});

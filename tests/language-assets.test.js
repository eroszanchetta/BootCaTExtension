import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('pinned franc sources match hashes, keep all licences and use only relative module imports', async () => {
  const root = new URL('../src/vendor/franc/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('sources.json', root), 'utf8'));
  for (const file of manifest) {
    const bytes = await readFile(new URL(file.name, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name);
    if (file.name.endsWith('.js')) for (const match of bytes.toString().matchAll(/^import .*? from ['"]([^'"]+)['"]/gm)) assert.ok(match[1].startsWith('./'), file.name);
  }
  assert.equal(manifest.filter(file => file.name.startsWith('LICENSE-')).length, 4);
});

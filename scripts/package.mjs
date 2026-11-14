import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build, ROOT, TARGETS } from './build.mjs';
import { packageSource } from './package-source.mjs';
import { makeZIP } from '../src/zip.js';
async function filesIn(root, prefix = '') {
  const files = [];
  for (const item of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) files.push(...await filesIn(root, name));
    else files.push({ name, data: new Uint8Array(await readFile(join(root, name))) });
  }
  return files;
}
const target = process.argv[2] || 'all';
if (process.argv.length > 3 || (target !== 'all' && !TARGETS.includes(target))) throw new Error('Usage: node scripts/package.mjs [all|chromium|firefox]');
const output = join(ROOT, 'dist', 'packages');
await mkdir(output, { recursive: true });
for (const name of target === 'all' ? TARGETS : [target]) {
  const source = await build(name);
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  const path = join(output, `bootcat-${name}-${manifest.version}.zip`);
  await writeFile(path, new Uint8Array(await makeZIP(await filesIn(source)).arrayBuffer()));
  console.log(path);
}
console.log(await packageSource());

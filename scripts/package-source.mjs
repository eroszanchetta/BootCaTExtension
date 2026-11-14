import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './build.mjs';
import { makeZIP } from '../src/zip.js';

// Explicit allowlist: never include profiles, node_modules, build output or Git data.
export const SOURCE_ENTRIES = ['src', 'manifests', 'scripts', 'tests', 'docs',
  'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE'];
export async function sourceFiles(root = ROOT) {
  const files = [];
  async function add(name) {
    const path = join(root, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Source archive cannot contain a symbolic link: ${name}`);
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await add(`${name}/${child}`);
    } else if (info.isFile()) files.push({ name, data: new Uint8Array(await readFile(path)) });
    else throw new Error(`Unsupported source entry: ${name}`);
  }
  for (const name of SOURCE_ENTRIES) await add(name);
  return files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
export async function packageSource() {
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const output = join(ROOT, 'dist', 'packages');
  await mkdir(output, { recursive: true });
  const path = join(output, `bootcat-source-${version}.zip`);
  await writeFile(path, new Uint8Array(await makeZIP(await sourceFiles()).arrayBuffer()));
  return path;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await packageSource());

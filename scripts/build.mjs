import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGETS = ['chromium', 'firefox'];
export async function build(target, { outputRoot = join(ROOT, 'dist'), includeTests = false } = {}) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown target: ${target}`);
  const readJSON = async path => JSON.parse(await readFile(join(ROOT, path), 'utf8'));
  const common = await readJSON('manifests/common.json');
  const override = await readJSON(`manifests/${target}.json`);
  const manifest = { ...common, ...override };
  const destination = join(outputRoot, target);
  await mkdir(outputRoot, { recursive: true });
  // Only replace this known browser's generated folder, never the source tree.
  await rm(destination, { recursive: true, force: true });
  await cp(join(ROOT, 'src'), destination, { recursive: true });
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (includeTests) {
    await mkdir(join(destination, 'tests'), { recursive: true });
    for (const name of await readdir(join(ROOT, 'tests'))) {
      if (name.startsWith('browser-tests.')) await cp(join(ROOT, 'tests', name), join(destination, 'tests', name));
    }
  }
  return destination;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const includeTests = args.includes('--with-tests');
  const target = args.find(arg => !arg.startsWith('--')) || 'all';
  if (args.some(arg => arg.startsWith('--') && arg !== '--with-tests') || args.filter(arg => !arg.startsWith('--')).length > 1) throw new Error('Usage: node scripts/build.mjs [all|chromium|firefox] [--with-tests]');
  for (const name of target === 'all' ? TARGETS : [target]) console.log(await build(name, { includeTests }));
}

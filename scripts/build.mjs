import { PDFJS_VERSION } from '../src/pdfjs-version.js';
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
  // package.json is the sole release-version setting. The lockfile is managed
  // by npm; badges and exports read this version from the installed manifest.
  const { version } = await readJSON('package.json');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version === '0.0.0' || version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('package.json version must contain three numbers from 0 to 65535 (e.g. 2.0.0), without a prerelease suffix, and must not be 0.0.0.');
  }
  const manifest = { ...common, ...override, version };
  let pdfRoot;
  try {
    pdfRoot = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
    const info = JSON.parse(await readFile(join(pdfRoot, 'package.json'), 'utf8'));
    if (info.version !== PDFJS_VERSION) throw new Error(`Unexpected PDF.js version: ${info.version}`);
  } catch (error) { throw new Error(`Run npm install before building (PDF.js ${PDFJS_VERSION} required). ${error.message}`); }
  const destination = join(outputRoot, target);
  await mkdir(outputRoot, { recursive: true });
  // Only replace this known browser's generated folder, never the source tree.
  await rm(destination, { recursive: true, force: true });
  await cp(join(ROOT, 'src'), destination, { recursive: true });
  await cp(join(ROOT, 'LICENSE'), join(destination, 'LICENSE.txt'));
  await cp(join(ROOT, 'NOTICE'), join(destination, 'NOTICE.txt'));
  const pdfDestination = join(destination, 'vendor/pdfjs');
  await mkdir(pdfDestination, { recursive: true });
  for (const name of ['pdf.mjs', 'pdf.worker.mjs']) await cp(join(pdfRoot, 'legacy/build', name), join(pdfDestination, name));
  for (const name of ['cmaps', 'standard_fonts', 'LICENSE']) await cp(join(pdfRoot, name), join(pdfDestination, name), { recursive: true });
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

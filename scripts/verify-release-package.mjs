import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './build.mjs';
import { verifyPackagedPDFJS } from './pdfjs-store-build.mjs';

const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const paths = process.argv.slice(2);
if (!paths.length) paths.push(...['chromium', 'firefox'].map(browser => join(ROOT, 'dist/packages', `bootcat-${browser}-${version}.zip`)));
for (const path of paths) {
  const verified = await verifyPackagedPDFJS(new Uint8Array(await readFile(path)));
  console.log(`Verified ${path}`);
  for (const item of verified) console.log(`  ${item.filename}: ${item.sha256}`);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, ROOT } from '../scripts/build.mjs';

async function list(root, prefix = '') {
  let paths = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    paths.push(...(entry.isDirectory() ? await list(root, path) : [path]));
  }
  return paths.sort();
}
test('both builds contain identical shared files and separate valid manifests', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'bootcat-build-'));
  try {
    const chromium = await build('chromium', { outputRoot });
    const firefox = await build('firefox', { outputRoot });
    const manifests = await Promise.all([chromium, firefox].map(async dir => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))));
    const [c, f] = manifests;
    const pdfFiles = await list(join(chromium, 'vendor/pdfjs'));
    assert.deepEqual(pdfFiles.filter(path => path.endsWith('.mjs')).sort(), ['pdf.mjs', 'pdf.worker.mjs']);
    const pdfModule = await readFile(join(chromium, 'vendor/pdfjs/pdf.mjs'), 'utf8');
    assert.ok(pdfModule.includes('6.5.438'), 'bundled PDF library must be the patched pinned release');
    assert.equal(c.manifest_version, 3); assert.equal(f.manifest_version, 3);
    assert.deepEqual(c.background, { service_worker: 'background.js', type: 'module' });
    assert.deepEqual(f.background, { scripts: ['background.js'], type: 'module' });
    assert.equal(c.browser_specific_settings, undefined);
    assert.equal(f.minimum_chrome_version, undefined);
    assert.equal(f.browser_specific_settings.gecko.strict_min_version, '140.0');
    assert.ok(f.browser_specific_settings.gecko.id);
    const source = await list(join(ROOT, 'src'));
    for (const dir of [chromium, firefox]) {
      const generated = (await list(dir)).filter(path => !path.startsWith('vendor/pdfjs/'));
      assert.deepEqual(generated, [...source, 'manifest.json'].sort());
      for (const file of ['pdf.mjs', 'pdf.worker.mjs', 'LICENSE', 'cmaps/Adobe-Japan1-UCS2.bcmap', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION']) await readFile(join(dir, 'vendor/pdfjs', file));
      assert.match(manifests[0].content_security_policy.extension_pages, /worker-src 'self'/);
      for (const path of source) assert.deepEqual(await readFile(join(dir, path)), await readFile(join(ROOT, 'src', path)), path);
      for (const file of [c.action.default_popup, ...Object.values(c.icons), 'extension-api.js', 'vendor/Readability.js', 'vendor/Defuddle.js']) await readFile(join(dir, file));
    }
    for (const path of await list(join(chromium, 'vendor/pdfjs'))) assert.deepEqual(await readFile(join(chromium, 'vendor/pdfjs', path)), await readFile(join(firefox, 'vendor/pdfjs', path)), path);
    await build('chromium', { outputRoot, includeTests: true });
    await readFile(join(chromium, 'tests/browser-tests.html'));
    await build('chromium', { outputRoot });
    assert.ok(!(await list(chromium)).some(p => p.startsWith('tests/')));
    // Rebuilding one target does not erase the other target's output.
    await readFile(join(firefox, 'manifest.json'));
    await assert.rejects(build('../src', { outputRoot }), /Unknown target/);
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
});

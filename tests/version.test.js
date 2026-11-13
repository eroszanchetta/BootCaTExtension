import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getExtensionVersion, initVersionBadge } from '../src/version.js';

test('package.json is the release setting and npm lockfile bookkeeping stays aligned', async () => {
  const json = async file => JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
  const pkg = await json('package.json'), lock = await json('package-lock.json');
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  for (const file of ['manifests/common.json', 'manifests/chromium.json', 'manifests/firefox.json']) {
    assert.equal((await json(file)).version, undefined, 'browser manifest templates must not have independent release versions');
  }
});

for (const namespace of ['chrome', 'browser']) test(`${namespace}: badges and metadata read the installed manifest, retaining nonzero patch versions`, () => {
  const previous = globalThis.document, badge = { textContent: '' }; let version = '2.0.0';
  globalThis.document = { getElementById: id => id === 'app-version' ? badge : null };
  globalThis[namespace] = { runtime: { getManifest: () => ({ version }) } };
  try {
    assert.equal(initVersionBadge(), '2.0.0'); assert.equal(badge.textContent, 'BootCaT · 2.0');
    version = '2.0.1';
    assert.equal(getExtensionVersion(), '2.0.1'); initVersionBadge(); assert.equal(badge.textContent, 'BootCaT · 2.0.1');
    version = '2.1.0'; initVersionBadge(); assert.equal(badge.textContent, 'BootCaT · 2.1');
  } finally { delete globalThis[namespace]; globalThis.document = previous; }
});

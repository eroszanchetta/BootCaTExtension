import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExtensionAPI } from '../src/extension-api.js';
test('API selector works with Firefox, older Chromium and both namespaces', () => {
  const firefox = { runtime: {} }, chromium = { runtime: {} };
  assert.equal(getExtensionAPI({ browser: firefox }), firefox);
  assert.equal(getExtensionAPI({ chrome: chromium }), chromium);
  assert.equal(getExtensionAPI({ browser: firefox, chrome: chromium }), firefox);
  assert.throws(() => getExtensionAPI({}), /browser extension/);
});

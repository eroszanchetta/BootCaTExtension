// Prefer the standard Promise-based namespace. Chromium versions before 148
// use chrome.*; all APIs BootCaT calls support Promises in our Chromium 120+ target.
// This selects a namespace, not a polyfill for missing APIs.
export function getExtensionAPI(scope = globalThis) {
  const api = scope.browser ?? scope.chrome;
  if (!api?.runtime) throw new Error('BootCaT must run as a browser extension. Build and load the appropriate dist folder.');
  return api;
}

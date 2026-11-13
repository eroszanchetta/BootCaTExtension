import { getExtensionAPI } from './extension-api.js';

export function getExtensionVersion() {
  return getExtensionAPI().runtime.getManifest().version;
}

export function initVersionBadge() {
  const version = getExtensionVersion();
  const badge = document.getElementById('app-version');
  if (badge) badge.textContent = `BootCaT · ${version.replace(/\.0$/, '')}`;
  return version;
}

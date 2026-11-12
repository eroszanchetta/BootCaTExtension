import { DEFAULT_EXCLUDED_SITES, normalizeExcludedSites } from './search-filters.js';
export const USER_DEFAULTS_KEY = 'userDefaults';
// Extend this registry for future cross-project preferences. Project contents
// never belong here. Missing fields inherit built-ins; explicit empty lists do not.
const fields = { excludedSites: { initial: () => [...DEFAULT_EXCLUDED_SITES], normalize: normalizeExcludedSites } };
function decode(record) {
  if (record && record.version !== 1) throw new Error('Unsupported user-defaults version. Update BootCaT before editing preferences.');
  const values = {};
  for (const [key, field] of Object.entries(fields)) values[key] = Object.hasOwn(record?.values || {}, key) ? field.normalize(record.values[key]) : field.initial();
  return values;
}
export async function readUserDefaults(area) {
  const stored = await area.get(USER_DEFAULTS_KEY); return decode(stored[USER_DEFAULTS_KEY]);
}
// The background serializes calls, so partial updates cannot lose other fields.
export async function saveUserDefaults(area, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid user-defaults update.');
  const stored = await area.get(USER_DEFAULTS_KEY), previous = stored[USER_DEFAULTS_KEY];
  const values = decode(previous);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`Unknown user default: ${key}`);
    values[key] = fields[key].normalize(value);
  }
  await area.set({ [USER_DEFAULTS_KEY]: { version: 1, values: { ...previous?.values, ...values } } });
  return values;
}

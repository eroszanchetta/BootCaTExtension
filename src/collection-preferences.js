export const COLLECTION_CONTROLS_KEY = 'collectionControls';
export const FLOATING_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
export const DEFAULT_COLLECTION_CONTROLS = Object.freeze({ closeCollectedTab: false, closeCapturedTab: false, floatingEnabled: false, floatingPosition: 'top-right' });
export function collectionControlsFromRecord(record) {
  if (record && record.version !== 1) throw new Error('Unsupported collection-controls version. Update BootCaT before changing preferences.');
  const values = { ...DEFAULT_COLLECTION_CONTROLS, ...record?.values };
  for (const key of ['closeCollectedTab', 'closeCapturedTab', 'floatingEnabled']) if (typeof values[key] !== 'boolean') throw new Error('Invalid collection-control preference.');
  if (!FLOATING_POSITIONS.includes(values.floatingPosition)) throw new Error('Choose a valid floating-control position.');
  return Object.freeze(values);
}
export async function readCollectionControls(area) { return collectionControlsFromRecord((await area.get(COLLECTION_CONTROLS_KEY))[COLLECTION_CONTROLS_KEY]); }
// Called through the background write queue: patching one switch never loses
// another popup's changes to a different preference.
export async function saveCollectionControls(area, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid collection-control update.');
  for (const key of Object.keys(patch)) if (!Object.hasOwn(DEFAULT_COLLECTION_CONTROLS, key)) throw new Error('Unknown collection-control preference.');
  const stored = (await area.get(COLLECTION_CONTROLS_KEY))[COLLECTION_CONTROLS_KEY];
  const values = collectionControlsFromRecord({ version: 1, values: { ...collectionControlsFromRecord(stored), ...patch } });
  if (Object.keys(patch).some(key => stored?.values?.[key] !== values[key])) await area.set({ [COLLECTION_CONTROLS_KEY]: { version: 1, values } });
  return values;
}

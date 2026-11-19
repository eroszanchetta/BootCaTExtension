import { COLLECTION_CONTROLS_KEY } from './collection-preferences.js';
import { SETTINGS_KEY } from './settings.js';
import { USER_DEFAULTS_KEY } from './user-defaults.js';
// Project resets clear legacy/unknown project keys too, while the versioned user
// preferences record has an independent lifetime and is never deleted.
export async function resetProjectLocalState(area, project) {
  const all = await area.get(null), projectKeys = Object.keys(all).filter(key => key !== USER_DEFAULTS_KEY && key !== SETTINGS_KEY && key !== COLLECTION_CONTROLS_KEY && key !== 'project');
  if (projectKeys.length) await area.remove(projectKeys);
  await area.set({ project, collections: [], captureRevision: crypto.randomUUID() });
}

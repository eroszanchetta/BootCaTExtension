import { getExtensionAPI } from './extension-api.js';
export async function openProjectSearch({ projectId, engine, query, active = true }) {
  const result = await getExtensionAPI().runtime.sendMessage({ type: 'open-project-search', projectId, engine, query, active });
  if (!result?.ok) throw new Error(result?.error || 'Could not open and track this search tab.');
  return result;
}

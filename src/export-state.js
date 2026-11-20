// Only metadata is hashed. Text edits update the document revision atomically
// with its Blob, so bodies need not be loaded just to compare export snapshots.
export async function corpusFingerprint(workspace, project, collections) {
  // Invalidate receipts from ZIP layouts that did not yet include raw-text/.
  const data = JSON.stringify({ layoutVersion: 2, project, draft: workspace.draft, batch: workspace.batch, entries: workspace.entries, collections }, (_, value) => {
    // Storage round trips and object construction order must not count as edits.
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export function corpusSavedMessage(filename) {
  return `Corpus saved as “${filename}”. You’ll find it in your Downloads folder.`;
}

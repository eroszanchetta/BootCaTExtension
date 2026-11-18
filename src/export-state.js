// Only metadata is hashed. Originals and extracted-text Blobs are immutable and
// replaced together with their document metadata, so they need not be loaded.
export async function corpusFingerprint(workspace, project, collections) {
  const data = JSON.stringify({ project, draft: workspace.draft, batch: workspace.batch, entries: workspace.entries, collections });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export function corpusSavedMessage(filename) {
  return `Corpus saved as “${filename}”. You’ll find it in your Downloads folder, or the location selected in your browser. Change the project to save an updated copy.`;
}

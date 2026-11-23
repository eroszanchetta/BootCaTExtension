// Document edits carry revisions; originals/captures carry durable identities.
// Compare archive metadata without reading potentially large Blob bodies.
export async function projectFingerprint(snapshot) {
  const stores = { ...snapshot.stores, meta: snapshot.stores.meta.filter(record => !['active', 'corpusExport'].includes(record.key)) };
  const data = JSON.stringify({ project: snapshot.project, stores }, (_, value) => {
    if (value instanceof Blob) return { size: value.size, type: value.type };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

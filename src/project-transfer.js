// Short-lived, local handoff: Chromium messages cannot carry native Blobs.
// This database is separate from the active project and never exported.
async function use(mode, task) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('bootcat-project-transfer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('transfers', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('transfers', mode); let result;
    tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Project transfer failed.'));
    task(tx.objectStore('transfers'), value => { result = value; });
  }); } finally { db.close(); }
}
export async function stageProject(snapshot) {
  const id = crypto.randomUUID();
  await use('readwrite', store => {
    const cursor = store.openCursor(); cursor.onsuccess = () => { const row = cursor.result; if (row) { if (row.value.created < Date.now() - 3600000) row.delete(); row.continue(); } };
    store.add({ id, created: Date.now(), snapshot });
  }); return id;
}
export const readStagedProject = id => use('readonly', (store, done) => { const r = store.get(id); r.onsuccess = () => { if (r.result?.created >= Date.now() - 3600000) done(r.result.snapshot); }; });
export const removeStagedProject = id => use('readwrite', store => store.delete(id));

// IndexedDB is shared by the extension's background and workspace contexts.
// A single read/write transaction prevents simultaneous captures exceeding limits.
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bootcat-saved-pages', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pages', { keyPath: 'url' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function validateSavedPages(pages) {
  if (pages.length > 20) throw new Error('Saved page limit reached (20). Open BootCaT to add them to the review list before saving more pages.');
  const size = pages.reduce((n, page) => n + new TextEncoder().encode(page.html).length, 0);
  if (size > 20 * 1024 * 1024) throw new Error('Saved pages exceed 20 MiB. Open BootCaT to add them to the review list before saving more pages.');
}
async function transaction(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('pages', mode);
      let result, error;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(error || tx.error || new Error('Could not update saved pages.'));
      operation(tx.objectStore('pages'), value => { result = value; }, reason => { error = reason; tx.abort(); });
    });
  } finally { db.close(); }
}
export const readSavedPages = () => transaction('readonly', (store, done) => {
  const request = store.getAll(); request.onsuccess = () => done(request.result);
});
export const clearSavedPages = () => transaction('readwrite', store => store.clear());
export const removeSavedPage = page => transaction('readwrite', store => {
  const request = store.get(page.url);
  // Do not delete a newer snapshot saved while the old one was importing.
  request.onsuccess = () => { if (request.result?.id === page.id) store.delete(page.url); };
});
export const savePage = page => transaction('readwrite', (store, done, fail) => {
  const request = store.getAll();
  request.onsuccess = () => {
    try {
      validateSavedPages([...request.result.filter(old => old.url !== page.url), page]);
      store.put(page); done(page);
    } catch (error) { fail(error); }
  };
});

import { transaction as dbTransaction } from './storage-db.js';
export function validateSavedPages(pages) {
  if (pages.length > 20) throw new Error('Saved page limit reached (20). Open BootCaT to add them to the review list before saving more pages.');
  const size = pages.reduce((n, page) => n + (page.kind === 'pdf' ? page.blob.size : new TextEncoder().encode(page.html).length), 0);
  if (size > 100 * 1024 * 1024) throw new Error('Saved pages exceed 100 MiB. Open BootCaT to add them to the review list before saving more pages.');
}
function transaction(mode, operation) {
  return dbTransaction(['pages'], mode, (tx, done, fail) => operation(tx.objectStore('pages'), done, fail));
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
export const listSavedPages = () => transaction('readonly', (store, done) => {
  const pages = [], request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) { done(pages); return; }
    pages.push({ url: cursor.value.url, id: cursor.value.id }); cursor.continue();
  };
});
export const readSavedPage = url => transaction('readonly', (store, done) => {
  const request = store.get(url); request.onsuccess = () => done(request.result);
});

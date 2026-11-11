// Version 2 extends the existing capture inbox without discarding queued pages.
export const STORES = ['pages', 'meta', 'documents', 'files', 'texts'];
export async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bootcat-saved-pages', 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) {
        request.result.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : name === 'files' ? 'name' : 'url' });
      }
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Close older BootCaT windows, then reopen the extension to update local storage.')); };
  });
}
export async function transaction(names, mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result, failure;
      const fail = error => { failure = error; try { tx.abort(); } catch {} };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Local storage transaction failed.'));
      try { operation(tx, value => { result = value; }, fail); } catch (error) { fail(error); }
    });
  } finally { db.close(); }
}

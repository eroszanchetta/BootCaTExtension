// A ZIP assembled from IndexedDB Blobs can still depend on database-backed
// file streams. Consume it before handing it to the browser's download process,
// so the download owns independent bytes even after transfer records are deleted.
// Response consumes a stream into native Blob storage; no project-sized JS
// ArrayBuffer or array of all document buffers is allocated.
export async function prepareDownloadBlob(blob) {
  const copy = await new Response(blob.stream(), { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }).blob();
  if (copy.size !== blob.size) throw new Error('The complete project could not be prepared for download. Try saving it again.');
  return copy;
}

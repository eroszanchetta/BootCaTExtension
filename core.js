// Browser-independent functions: also exercised by the Node tests.
export const FILE_LIMIT = 10 * 1024 * 1024;
export const BATCH_LIMIT = 100 * 1024 * 1024;

export function parseURLs(text) {
  const urls = new Set();
  const errors = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const url = new URL(line.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use HTTP or HTTPS");
      if (url.username || url.password) throw new Error("URLs containing passwords are not supported");
      url.hash = "";
      urls.add(url.href);
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error.message}`);
    }
  });
  if (urls.size > 500) errors.push("Maximum 500 unique URLs per batch.");
  return { urls: [...urls], errors };
}

export function filenameFor(url, type, index) {
  const extensions = { "text/html": "html", "application/xhtml+xml": "html", "text/plain": "txt", "application/pdf": "pdf", "application/json": "json", "application/xml": "xml", "text/xml": "xml" };
  const extension = extensions[type.split(";")[0].trim().toLowerCase()] || "bin";
  // Numbered names prevent collisions; never use server-supplied filesystem paths.
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
  return `pages/${String(index + 1).padStart(4, "0")}-${host}.${extension}`;
}

export async function fetchFile(url, signal, limit = FILE_LIMIT) {
  const response = await fetch(url, {
    signal, credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer"
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) throw new Error("Empty response stream");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("File or remaining batch size limit exceeded");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, finalURL: response.url, status: response.status, contentType: response.headers.get("content-type") || "application/octet-stream" };
}

import { DEFAULT_SETTINGS, fileLimit } from './settings.js';
// Browser-independent functions: also exercised by the Node tests.
export const FILE_LIMIT = fileLimit(DEFAULT_SETTINGS);
export const PDF_IMPORT_LIMIT = FILE_LIMIT;
export class DownloadSizeError extends Error {
  constructor(limit) {
    super(`File exceeds the ${limit / 1024 / 1024} MiB download limit. Download stopped; no file was saved.`);
    this.name = 'DownloadSizeError'; this.code = 'DOWNLOAD_TOO_LARGE'; this.limitBytes = limit;
  }
}
export const URL_WARNING_THRESHOLD = DEFAULT_SETTINGS.urlWarning;
export function urlListWarning(count, threshold = URL_WARNING_THRESHOLD) {
  return count > threshold ? `This project has ${count.toLocaleString()} URLs. Large lists may take longer to download, review and export, and use substantial browser storage. You can continue.` : '';
}

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
  return { urls: [...urls], errors };
}

export function filenameFor(url, type, index) {
  const extensions = { "text/html": "html", "application/xhtml+xml": "html", "text/plain": "txt", "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/json": "json", "application/xml": "xml", "text/xml": "xml" };
  const extension = extensions[type.split(";")[0].trim().toLowerCase()] || "bin";
  // Numbered names prevent collisions; never use server-supplied filesystem paths.
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
  return `pages/${String(index + 1).padStart(4, "0")}-${host}.${extension}`;
}

export async function fetchFile(url, signal, limit = FILE_LIMIT, { credentials = 'omit' } = {}) {
  const response = await fetch(url, {
    signal, credentials, redirect: "follow", referrerPolicy: "no-referrer"
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`HTTP ${response.status} ${response.statusText}`), {
      finalURL: response.url, contentType: response.headers.get('content-type') || '', httpStatus: response.status
    });
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
      if (size > limit) throw new DownloadSizeError(limit);
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

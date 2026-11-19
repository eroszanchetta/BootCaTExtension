import { crc32Update } from './zip.js';
const decoder = new TextDecoder('utf-8', { fatal: true });
export const safeArchivePath = name => typeof name === 'string' && name.length > 0 && name.length <= 4096 && !/[\\\u0000-\u001f:]/.test(name) && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..');
const invalid = () => { throw new Error('Invalid or damaged BootCaT ZIP archive.'); };
async function bytes(blob, start, length) {
  if (!Number.isSafeInteger(start) || start < 0 || length < 0 || start + length > blob.size) invalid();
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}
const view = data => new DataView(data.buffer, data.byteOffset, data.byteLength);
const number64 = (v, offset) => { const n = Number(v.getBigUint64(offset, true)); if (!Number.isSafeInteger(n)) invalid(); return n; };
// Version 1 uses uncompressed ZIP entries, including ZIP64. Read Blob slices so
// original documents are never copied into one project-sized ArrayBuffer.
export async function readPortableZIP(blob) {
  if (!(blob instanceof Blob) || blob.size < 22) invalid();
  const tailStart = Math.max(0, blob.size - 65557), tail = await bytes(blob, tailStart, blob.size - tailStart), t = view(tail);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (t.getUint32(i, true) === 0x06054b50 && i + 22 + t.getUint16(i + 20, true) === tail.length) { end = i; break; }
  if (end < 0 || t.getUint16(end + 4, true) || t.getUint16(end + 6, true)) invalid();
  let count = t.getUint16(end + 10, true), size = t.getUint32(end + 12, true), start = t.getUint32(end + 16, true), boundary = tailStart + end;
  if (t.getUint16(end + 8, true) !== count) invalid();
  if (count === 65535 || size === 0xffffffff || start === 0xffffffff) {
    const l = view(await bytes(blob, boundary - 20, 20));
    if (l.getUint32(0, true) !== 0x07064b50 || l.getUint32(4, true) || l.getUint32(16, true) !== 1) invalid();
    const position = number64(l, 8), z = view(await bytes(blob, position, 56));
    if (z.getUint32(0, true) !== 0x06064b50 || number64(z, 4) !== 44 || z.getUint32(16, true) || z.getUint32(20, true) || number64(z, 24) !== number64(z, 32) || position + 56 !== boundary - 20) invalid();
    count = number64(z, 32); size = number64(z, 40); start = number64(z, 48); boundary = position;
  }
  if (start + size !== boundary || count > Math.floor(size / 46)) invalid();
  const entries = new Map(), ranges = []; let offset = start;
  for (let i = 0; i < count; i++) {
    const header = view(await bytes(blob, offset, 46));
    if (header.getUint32(0, true) !== 0x02014b50 || header.getUint16(10, true) !== 0 || header.getUint16(8, true) !== 0x0800 || header.getUint16(34, true)) invalid();
    let length = header.getUint32(24, true), compressed = header.getUint32(20, true), local = header.getUint32(42, true);
    const nameLength = header.getUint16(28, true), extraLength = header.getUint16(30, true), comment = header.getUint16(32, true);
    const rest = await bytes(blob, offset + 46, nameLength + extraLength + comment), name = decoder.decode(rest.subarray(0, nameLength));
    if (!safeArchivePath(name) || entries.has(name) || offset + 46 + rest.length > boundary) invalid();
    if (length === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff) {
      const extra = view(rest); let p = nameLength, found = false;
      while (p + 4 <= nameLength + extraLength) {
        const type = extra.getUint16(p, true), n = extra.getUint16(p + 2, true); p += 4;
        if (p + n > nameLength + extraLength) invalid();
        if (type === 1) { let q = p; const take = () => { if (q + 8 > p + n) invalid(); const value = number64(extra, q); q += 8; return value; };
          if (length === 0xffffffff) length = take(); if (compressed === 0xffffffff) compressed = take(); if (local === 0xffffffff) local = take(); found = true; break;
        } p += n;
      } if (!found) invalid();
    }
    if (length !== compressed) invalid();
    const lh = view(await bytes(blob, local, 30));
    if (lh.getUint32(0, true) !== 0x04034b50 || lh.getUint16(6, true) !== 0x0800 || lh.getUint16(8, true) !== 0 || lh.getUint32(14, true) !== header.getUint32(16, true)) invalid();
    const nl = lh.getUint16(26, true), el = lh.getUint16(28, true), dataStart = local + 30 + nl + el;
    if (decoder.decode(await bytes(blob, local + 30, nl)) !== name || dataStart + length > start) invalid();
    ranges.push([local, dataStart + length]);
    const data = blob.slice(dataStart, dataStart + length), reader = data.stream().getReader(); let crc = 0xffffffff;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; crc = crc32Update(crc, value); } }
    finally { await reader.cancel().catch(() => {}); }
    if (((crc ^ 0xffffffff) >>> 0) !== header.getUint32(16, true)) throw new Error(`Damaged project file: ${name}.`);
    entries.set(name, data); offset += 46 + rest.length;
  }
  if (offset !== boundary) invalid();
  ranges.sort((a, b) => a[0] - b[0]);
  let next = 0; for (const [a, b] of ranges) { if (a !== next) invalid(); next = b; } if (next !== start) invalid();
  return entries;
}

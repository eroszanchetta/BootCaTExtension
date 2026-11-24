import { crc32Update } from './zip.js';
const MAX32 = 0xffffffffn;
const abort = signal => { if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); };
async function checksum(blob, signal) {
  const reader = blob.stream().getReader(); let crc = 0xffffffff;
  try {
    while (true) {
      abort(signal); const { value, done } = await reader.read();
      if (done) break;
      crc = crc32Update(crc, value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return (crc ^ 0xffffffff) >>> 0;
}
// ZIP stores local wall-clock time with two-second precision and years 1980–2107.
// Capture once per archive so streaming entries and both headers agree.
function archiveDateTime(timestamp) {
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) throw new Error('Invalid archive timestamp');
  const date = new Date(Math.max(new Date(1980, 0, 1).getTime(), Math.min(new Date(2107, 11, 31, 23, 59, 58).getTime(), timestamp.getTime())));
  return {
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}
// Keep native Blob references, not complete ArrayBuffers, in the archive parts.
// CRC calculation reads one bounded stream chunk at a time. ZIP64 allows large
// offsets and entry counts; the browser's own Blob/storage limits still apply.
export async function makeStoredZIP(entries, { signal, forceZIP64 = false, timestamp = new Date() } = {}) {
  const stamp = archiveDateTime(timestamp);
  const parts = [], directory = [], names = new Set();
  let offset = 0n, count = 0n;
  for await (const file of entries) {
    abort(signal);
    if (names.has(file.name)) throw new Error('Duplicate archive filename'); names.add(file.name);
    const name = new TextEncoder().encode(file.name);
    if (name.length > 65535) throw new Error('Archive filename too long');
    const blob = file.blob instanceof Blob ? file.blob : new Blob([file.data]);
    const size = BigInt(blob.size), large = size >= MAX32, largeOffset = offset >= MAX32;
    const crc = await checksum(blob, signal);
    const localExtra = large ? 20 : 0;
    const local = new Uint8Array(30 + name.length + localExtra), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, large ? 45 : 20, true);
    l.setUint16(6, 0x0800, true); l.setUint16(10, stamp.time, true); l.setUint16(12, stamp.date, true); l.setUint32(14, crc, true);
    l.setUint32(18, large ? 0xffffffff : blob.size, true); l.setUint32(22, large ? 0xffffffff : blob.size, true);
    l.setUint16(26, name.length, true); l.setUint16(28, localExtra, true); local.set(name, 30);
    if (large) {
      const start = 30 + name.length;
      l.setUint16(start, 1, true); l.setUint16(start + 2, 16, true);
      l.setBigUint64(start + 4, size, true); l.setBigUint64(start + 12, size, true);
    }
    const extraLength = (large ? 16 : 0) + (largeOffset ? 8 : 0);
    const central = new Uint8Array(46 + name.length + (extraLength ? extraLength + 4 : 0)), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, extraLength ? 45 : 20, true); c.setUint16(6, extraLength ? 45 : 20, true);
    c.setUint16(8, 0x0800, true); c.setUint16(12, stamp.time, true); c.setUint16(14, stamp.date, true); c.setUint32(16, crc, true);
    c.setUint32(20, large ? 0xffffffff : blob.size, true); c.setUint32(24, large ? 0xffffffff : blob.size, true);
    c.setUint16(28, name.length, true); c.setUint16(30, extraLength ? extraLength + 4 : 0, true);
    c.setUint32(42, largeOffset ? 0xffffffff : Number(offset), true); central.set(name, 46);
    if (extraLength) {
      let index = 46 + name.length;
      c.setUint16(index, 1, true); c.setUint16(index + 2, extraLength, true); index += 4;
      if (large) { c.setBigUint64(index, size, true); c.setBigUint64(index + 8, size, true); index += 16; }
      if (largeOffset) c.setBigUint64(index, offset, true);
    }
    parts.push(local, blob); directory.push(central); offset += BigInt(local.length) + size; count++;
  }
  abort(signal);
  let directorySize = 0n;
  for (const central of directory) { parts.push(central); directorySize += BigInt(central.length); }
  const zip64 = forceZIP64 || count >= 65535n || offset >= MAX32 || directorySize >= MAX32;
  if (zip64) {
    const end64 = new Uint8Array(56), e = new DataView(end64.buffer);
    e.setUint32(0, 0x06064b50, true); e.setBigUint64(4, 44n, true);
    e.setUint16(12, 45, true); e.setUint16(14, 45, true);
    e.setBigUint64(24, count, true); e.setBigUint64(32, count, true);
    e.setBigUint64(40, directorySize, true); e.setBigUint64(48, offset, true);
    const locator = new Uint8Array(20), l = new DataView(locator.buffer);
    l.setUint32(0, 0x07064b50, true); l.setBigUint64(8, offset + directorySize, true); l.setUint32(16, 1, true);
    parts.push(end64, locator);
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, zip64 ? 65535 : Number(count), true); e.setUint16(10, zip64 ? 65535 : Number(count), true);
  e.setUint32(12, zip64 ? 0xffffffff : Number(directorySize), true); e.setUint32(16, zip64 ? 0xffffffff : Number(offset), true);
  parts.push(end);
  return new Blob(parts, { type: 'application/zip' });
}

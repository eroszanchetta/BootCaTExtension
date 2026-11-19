const flatName = name => name.replace(/^(pages|corpus|raw-pdf|raw-text)\/captured\//, '$1/');
export const originalTextFilename = doc => doc.originalTextFilename || doc.filename.replace(/^pages\//, 'raw-text/').replace(/\.[^.]+$/, '.txt');

// Project storage keys remain stable. Flatten older capture paths only in the
// export projection, and reserve existing flat names before resolving collisions.
export function createExportLayout(entries) {
  // Older saved projects have no baseline path yet; expose it without rewriting
  // their storage keys or copying their text Blobs during a metadata refresh.
  entries = entries.map(entry => entry.doc?.extraction.status === 'ok' ? { ...entry, doc: { ...entry.doc, originalTextFilename: originalTextFilename(entry.doc) } } : entry);
  const names = new Set(), paths = new Map(), used = new Set();
  function add(name) { if (typeof name === 'string') names.add(name); }
  function collect(record) { if (!record) return; add(record.filename); collect(record.previousAttempt); }
  for (const entry of entries) {
    for (const name of entry.fileNames || []) add(name);
    collect(entry.record);
    for (const key of ['filename', 'textFilename', 'rawTextFilename', 'originalTextFilename']) add(entry.doc?.[key]);
  }
  const ordered = [...names].sort();
  for (const name of ordered) if (flatName(name) === name) { paths.set(name, name); used.add(name); }
  for (const name of ordered) {
    if (paths.has(name)) continue;
    const flat = flatName(name); let target = flat, suffix = 2;
    while (used.has(target)) target = flat.replace(/(\.[^./]+)?$/, (_, extension = '') => `-${suffix++}${extension}`);
    paths.set(name, target); used.add(target);
  }
  const nameFor = name => typeof name === 'string' ? paths.get(name) || flatName(name) : name;
  function recordFor(record) {
    if (!record) return record;
    return { ...record, ...(record.filename ? { filename: nameFor(record.filename) } : {}),
      ...(record.previousAttempt ? { previousAttempt: recordFor(record.previousAttempt) } : {}) };
  }
  return { nameFor, entries: entries.map(entry => ({ ...entry, record: recordFor(entry.record),
    fileNames: (entry.fileNames || []).map(nameFor),
    ...(entry.doc ? { doc: { ...entry.doc, filename: nameFor(entry.doc.filename), textFilename: nameFor(entry.doc.textFilename),
      ...(entry.doc.originalTextFilename ? { originalTextFilename: nameFor(entry.doc.originalTextFilename) } : {}),
      ...(entry.doc.rawTextFilename ? { rawTextFilename: nameFor(entry.doc.rawTextFilename) } : {}) } } : {})
  })) };
}

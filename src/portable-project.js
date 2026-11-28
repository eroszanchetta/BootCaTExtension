import { validateCorpusOptions } from './corpus-options.js';
import { makeStoredZIP } from './zip-blob.js';
import { readPortableZIP, safeArchivePath } from './portable-zip.js';
import { validateLanguage } from './language-detection.js';
import { normalizeSearchFilters } from './search-filters.js';
import { STORES } from './storage-db.js';
export const PROJECT_FORMAT = 'BootCaTProject', PROJECT_VERSION = 1;
const fail = message => { throw new Error(`Cannot open project: ${message}`); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Blob);
const string = value => typeof value === 'string';
const integer = value => Number.isSafeInteger(value) && value >= 0;
function web(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } }
function inspect(value, depth = 0) {
  if (depth > 40) fail('metadata is nested too deeply.');
  if (value instanceof Blob || value == null || string(value) || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) inspect(item, depth + 1); return; }
  if (!object(value)) fail('unsupported metadata.');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor', '$blob'].includes(key)) fail('invalid metadata key.');
    if (['url', 'pageURL', 'finalURL'].includes(key) && item && (!string(item) || !web(item))) fail('invalid document URL.');
    if (['filename', 'textFilename', 'rawTextFilename', 'originalTextFilename'].includes(key) && item && !safeArchivePath(item)) fail('invalid document filename.');
    inspect(item, depth + 1);
  }
}
export function validateProjectSnapshot(snapshot) {
  inspect(snapshot);
  if (!object(snapshot) || !object(snapshot.project) || !object(snapshot.stores)) fail('missing project metadata.');
  const p = snapshot.project;
  if (!string(p.name) || !p.name.trim() || p.name.length > 120 || !string(p.id)) fail('invalid project name or identity.');
  validateLanguage(p.language || 'none');
  for (const name of STORES) {
    const records = snapshot.stores[name]; if (!Array.isArray(records)) fail(`missing ${name} records.`);
    const keys = new Set();
    for (const record of records) {
      if (!object(record)) fail(`invalid ${name} record.`);
      const key = record[name === 'meta' ? 'key' : name === 'files' ? 'name' : 'url'];
      if (!string(key) || !key || keys.has(key)) fail(`invalid or duplicate ${name} record.`); keys.add(key);
      if (name === 'files' && (!safeArchivePath(key) || !(record.blob instanceof Blob))) fail('invalid original file.');
      if (['documents', 'texts', 'pages'].includes(name) && !web(key)) fail('invalid document URL.');
    }
  }
  const meta = new Map(snapshot.stores.meta.map(r => [r.key, r]));
  for (const key of ['active', 'draft', 'batch', 'searches']) if (!meta.has(key)) fail(`missing ${key} metadata.`);
  const draft = meta.get('draft'), batch = meta.get('batch');
  validateCorpusOptions(draft);
  if (draft.optionsRevision !== undefined && !integer(draft.optionsRevision)) fail('invalid project settings revision.');
  const order = meta.get('documentOrder');
  if (order && (!Array.isArray(order.urls) || !order.urls.every(url => string(url) && web(url)) || new Set(order.urls).size !== order.urls.length)) fail('invalid document order.');
  for (const key of ['urls', 'query', 'engine', 'extractor', 'seeds', 'tupleLength', 'tupleCount', 'tuples', 'searchFileType', 'searchSite', 'excludedSites']) if (!string(draft[key])) fail(`invalid ${key} draft.`);
  for (const key of ['seenCollections', 'preparedQueries']) if (!Array.isArray(draft[key]) || !draft[key].every(string)) fail(`invalid ${key} list.`);
  if (draft.preparedQueryBases !== null && (!Array.isArray(draft.preparedQueryBases) || !draft.preparedQueryBases.every(string))) fail('invalid query bases.');
  if (draft.preparedFilters !== null && (!object(draft.preparedFilters) || !string(draft.preparedFilters.fileType) || !string(draft.preparedFilters.site) || !Array.isArray(draft.preparedFilters.excludedSites) || !draft.preparedFilters.excludedSites.every(string))) fail('invalid query filters.');
  if (draft.preparedFilters) normalizeSearchFilters(draft.preparedFilters);
  for (const key of ['processed', 'total', 'nextFileIndex', 'storedBytes']) if (!integer(batch[key])) fail('invalid progress metadata.');
  if (!string(batch.state) || !string(batch.lastStatus)) fail('invalid progress state.');
  const collections = meta.get('searches').collections;
  if (!Array.isArray(collections)) fail('invalid search results.');
  for (const c of collections) {
    if (!object(c) || !['id', 'engine', 'query', 'pageURL'].every(key => string(c[key])) || !web(c.pageURL) || !Array.isArray(c.results) || !integer(c.unresolved)) fail('invalid search collection.');
    if (c.status === 'no-results' && (c.manual !== true || c.results.length || c.unresolved)) fail('invalid manual no-results outcome.');
    for (const r of c.results) if (!object(r) || !web(r.url) || !string(r.title) || !integer(r.positionOnPage)) fail('invalid search result.');
  }
  const files = new Map(snapshot.stores.files.map(r => [r.name, r])), texts = new Map(snapshot.stores.texts.map(r => [r.url, r]));
  for (const text of texts.values()) for (const key of ['blob', 'rawBlob', 'originalBlob']) if ((key === 'blob' || text[key] !== undefined) && !(text[key] instanceof Blob)) fail('invalid extracted text.');
  for (const entry of snapshot.stores.documents) {
    if (!object(entry.record) || entry.record.url !== entry.url || !string(entry.record.outcome) || !Array.isArray(entry.fileNames) || !entry.fileNames.every(name => files.has(name)) || !integer(entry.originalBytes)) fail('invalid document record.');
    if (entry.doc !== null) {
      const d = entry.doc, e = d?.extraction;
      if (!object(d) || d.url !== entry.url || !files.has(d.filename) || !safeArchivePath(d.textFilename) || !texts.has(entry.url) || !object(e) || !string(e.status) || !integer(e.characters) || typeof e.included !== 'boolean' || !Array.isArray(e.warnings) || !e.warnings.every(string)) fail('incomplete document or text.');
    }
  }
  for (const page of snapshot.stores.pages) {
    if (!string(page.id) || (page.kind === 'pdf' ? !(page.blob instanceof Blob) : !string(page.html))) fail('invalid pending page capture.');
  }
  return snapshot;
}
export async function makeProjectArchive(snapshot, { appVersion = '', forceZIP64 = false } = {}) {
  validateProjectSnapshot(snapshot);
  const files = []; let next = 0;
  function encode(value, path = '', preferred) {
    const html = typeof value === 'string' && /\/stores\/pages\/\d+\/html$/.test(path);
    if (value instanceof Blob || html) {
      const source = html ? new Blob([value], { type: 'text/html;charset=utf-8' }) : value;
      const extension = path.includes('/texts/') ? '.txt' : html ? '.html' : path.endsWith('/blob') && path.includes('/pages/') ? '.pdf' : '.bin';
      const name = preferred || `data/${String(next++).padStart(6, '0')}${extension}`; files.push({ name, blob: source });
      return { $blob: name, type: source.type, size: source.size, ...(html ? { text: true } : {}) };
    }
    if (Array.isArray(value)) return value.map((item, i) => encode(item, `${path}/${i}`));
    if (object(value)) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, item]) => [key, encode(item, `${path}/${key}`, key === 'blob' && path.startsWith('/stores/files/') && safeArchivePath(value.name) ? `originals/${value.name}` : undefined)]));
    return value;
  }
  const manifest = { format: PROJECT_FORMAT, version: PROJECT_VERSION, appVersion, savedAt: new Date().toISOString(), snapshot: encode(snapshot) };
  const json = JSON.stringify(manifest);
  if (new TextEncoder().encode(json).length > 64 * 1024 * 1024) throw new Error('Project metadata exceeds the 64 MiB portable-format limit.');
  files.unshift({ name: 'project.json', data: json });
  return makeStoredZIP(files, { forceZIP64, timestamp: new Date(manifest.savedAt) });
}
export async function openProjectArchive(blob) {
  const files = await readPortableZIP(blob), manifest = files.get('project.json');
  if (!manifest || manifest.size > 64 * 1024 * 1024) fail('missing or oversized project manifest.');
  let data; try { data = JSON.parse(await manifest.text()); } catch { fail('invalid project manifest.'); }
  if (data?.format !== PROJECT_FORMAT) fail('this is not a BootCaT project file.');
  if (data.version !== PROJECT_VERSION) fail('this project format needs a different version of BootCaT.');
  const used = new Set(['project.json']);
  async function decode(value, depth = 0) {
    if (depth > 40) fail('metadata is nested too deeply.');
    if (Array.isArray(value)) return Promise.all(value.map(item => decode(item, depth + 1)));
    if (object(value)) {
      if (Object.hasOwn(value, '$blob')) {
        const source = files.get(value.$blob);
        if (!source || used.has(value.$blob) || source.size !== value.size || !string(value.type)) fail('missing or invalid document data.');
        used.add(value.$blob); return value.text === true ? source.text() : source.slice(0, source.size, value.type);
      }
      for (const key of Object.keys(value)) if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('invalid metadata key.');
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await decode(item, depth + 1)])));
    }
    return value;
  }
  const snapshot = await decode(data.snapshot); if (used.size !== files.size) fail('unexpected project archive entries.');
  return validateProjectSnapshot(snapshot);
}
export function restoredProjectSnapshot(snapshot) {
  validateProjectSnapshot(snapshot);
  const project = { ...snapshot.project, id: crypto.randomUUID(), language: snapshot.project.language || 'none', nameConfirmed: true };
  const stores = { ...snapshot.stores, meta: snapshot.stores.meta.filter(r => r.key !== 'corpusExport').map(r => r.key === 'active' ? { key: 'active', projectId: project.id, project } : r.key === 'batch' ? { ...r, state: r.state === 'running' ? 'stopped' : r.state, lastStatus: 'Project opened. Saved documents are ready; unfinished downloads can be resumed.' } : r) };
  return { project, stores };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_FILE_TYPES, DEFAULT_EXCLUDED_SITES, normalizeExcludedSites } from '../src/search-filters.js';
import { buildSearchQuery, ENGINES } from '../src/engines.js';
import { DOCUMENT_FORMATS } from '../src/document-formats.js';
import { readUserDefaults, saveUserDefaults } from '../src/user-defaults.js';
import { resetProjectLocalState } from '../src/project-local-state.js';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../src/project-store.js';

test('query filters use extraction formats, canonicalize domains and never accept query syntax as a site', () => {
  assert.deepEqual(SEARCH_FILE_TYPES.map(type => type.id), DOCUMENT_FORMATS.map(type => type.id));
  assert.deepEqual(normalizeExcludedSites('https://www.youtube.com/path?q=1\nFACEBOOK.COM/\nfacebook.com\nexample.org.\n'), ['youtube.com', 'facebook.com', 'example.org']);
  assert.deepEqual(normalizeExcludedSites('https://m.example.org/path'), ['m.example.org']);
  assert.deepEqual(normalizeExcludedSites('https://bücher.de'), ['xn--bcher-kva.de']);
  for (const value of ['facebook.com -site:other.com', '*.example.com', '-site:example.com', 'https://user:password@example.com', 'ftp://example.com', 'javascript:alert(1)', 'just_a_word']) assert.throws(() => normalizeExcludedSites(value), /Invalid excluded website/);
  for (const engine of ENGINES) {
    assert.equal(buildSearchQuery(engine.id, '"solar energy" storage', { fileType: 'pdf', excludedSites: ['facebook.com'] }), '"solar energy" storage filetype:pdf -site:facebook.com');
    assert.equal(buildSearchQuery(engine.id, 'query', { fileType: 'docx' }), 'query filetype:docx');
    assert.equal(buildSearchQuery(engine.id, 'query', {}), 'query');
    assert.throws(() => buildSearchQuery(engine.id, 'query', { fileType: 'ppt' }), /supported document format/);
  }
});
test('user defaults have an independent lifetime, partial updates preserve future fields, and empty preferences remain empty', async () => {
  const values = {}, area = { get: async key => key === null ? structuredClone(values) : { [key]: structuredClone(values[key]) }, set: async patch => { Object.assign(values, structuredClone(patch)); }, remove: async keys => { for (const key of keys) delete values[key]; } };
  assert.deepEqual((await readUserDefaults(area)).excludedSites, [...DEFAULT_EXCLUDED_SITES]);
  await saveUserDefaults(area, { excludedSites: ['https://www.example.org/path'] });
  values.userDefaults.values.futureSetting = 'keep'; values.project = { id: 'old' }; values.oldProjectContent = 'remove';
  await resetProjectLocalState(area, { id: 'new' });
  assert.equal(values.oldProjectContent, undefined); assert.equal(values.userDefaults.values.futureSetting, 'keep');
  assert.deepEqual((await readUserDefaults(area)).excludedSites, ['example.org']);
  await saveUserDefaults(area, { excludedSites: [] }); assert.deepEqual((await readUserDefaults(area)).excludedSites, []);
  assert.equal(values.userDefaults.values.futureSetting, 'keep');
  await assert.rejects(saveUserDefaults(area, { unknown: 'bad' }), /Unknown user default/);
  globalThis.indexedDB = new IDBFactory(); await storage.ensureStoredProject('first', await readUserDefaults(area));
  assert.equal((await storage.loadWorkspace('first')).draft.excludedSites, '');
  await saveUserDefaults(area, { excludedSites: ['facebook.com'] });
  assert.equal((await storage.loadWorkspace('first')).draft.excludedSites, '', 'saving defaults must not overwrite current project');
  await storage.resetStoredProject('next', await readUserDefaults(area)); const draft = (await storage.loadWorkspace('next')).draft;
  assert.equal(draft.excludedSites, 'facebook.com'); assert.equal(draft.searchFileType, ''); assert.deepEqual(draft.preparedQueries, []);
});

test('site restrictions combine with other modifiers across every provider and reject ambiguous or injected sites', () => {
  for (const engine of ENGINES) {
    assert.equal(buildSearchQuery(engine.id, '"renewable energy" storage', {
      fileType: 'pdf', site: 'https://www.UNIBO.it/research?q=ignored', excludedSites: ['social.unibo.it']
    }), '"renewable energy" storage filetype:pdf site:unibo.it -site:social.unibo.it');
    assert.equal(buildSearchQuery(engine.id, 'query', { site: 'https://bücher.de' }), 'query site:xn--bcher-kva.de');
    assert.equal(buildSearchQuery(engine.id, 'query', { site: 'research.example.org.' }), 'query site:research.example.org');
    assert.equal(buildSearchQuery(engine.id, 'query', { site: '  ' }), 'query');
    for (const site of ['example.org OR site:other.org', 'example.org\nother.org', '*.example.org', 'site:example.org', 'ftp://example.org', 'https://user:pass@example.org', 'localhost']) {
      assert.throws(() => buildSearchQuery(engine.id, 'query', { site }), error => error.field === 'site' && /Invalid search website/.test(error.message));
    }
    assert.throws(() => buildSearchQuery(engine.id, 'query', { site: 'research.example.org', excludedSites: ['example.org'] }), /search site is excluded/);
    assert.equal(buildSearchQuery(engine.id, 'query', { site: 'notexample.org', excludedSites: ['example.org'] }), 'query site:notexample.org -site:example.org');
  }
});

test('search-site drafts persist without a schema migration and reset independently of exclusion defaults', async () => {
  globalThis.indexedDB = new IDBFactory();
  await storage.ensureStoredProject('restricted');
  assert.equal((await storage.loadWorkspace('restricted')).draft.searchSite, '');
  await storage.saveDraft('restricted', { searchSite: 'https://www.unibo.it/research', preparedQueryBases: ['energy'], preparedFilters: { fileType: '', site: 'unibo.it', excludedSites: [] }, preparedQueries: ['energy site:unibo.it'] });
  const saved = (await storage.loadWorkspace('restricted')).draft;
  assert.equal(saved.searchSite, 'https://www.unibo.it/research');
  assert.equal(saved.preparedFilters.site, 'unibo.it');
  await storage.resetStoredProject('unrestricted', { excludedSites: ['example.org'] });
  const next = (await storage.loadWorkspace('unrestricted')).draft;
  assert.equal(next.searchSite, ''); assert.equal(next.excludedSites, 'example.org');
  assert.deepEqual(next.preparedQueries, []);
});

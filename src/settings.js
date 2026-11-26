import { SEARCH_ENGINE_NAMES, INITIAL_SEARCH_ENGINE } from './search-engine-options.js';
// Personal preferences, independent of project contents and browser sessions.
export const SETTINGS_KEY = 'bootcatSettings';
const memoryWarning = 'Increasing this limit may use substantially more memory and browser storage, slow processing, or make the tab unresponsive.';
export const SETTING_FIELDS = [
  { key: 'defaultEngine', label: 'Default search engine', initial: INITIAL_SEARCH_ENGINE, options: Object.entries(SEARCH_ENGINE_NAMES).map(([value, label]) => ({ value, label })), help: 'Used for new projects in this browser. Existing and opened projects keep their selected engine.' },
  { key: 'minimumSeeds', label: 'Minimum number of distinct seeds', initial: 5, max: 1000000, help: 'Required for tuple generation only. You can enter your own tuples without seeds.', warning: 'More seeds will be required before tuple generation is enabled.' },
  { key: 'fileMiB', label: 'Maximum downloaded or imported file size', unit: 'MiB', initial: 50, max: 1024, help: 'Applies to downloads, PDF recovery and imported files. Extraction has separate limits.', warning: memoryWarning },
  { key: 'pdfPages', label: 'Maximum PDF pages for extraction', initial: 300, max: 100000, help: 'Larger PDFs are retained without extracting a partial text.', warning: 'Large PDFs may take much longer and use more memory. You may also need to increase the extraction timeout.' },
  { key: 'urlWarning', label: 'Warn above this many project URLs', initial: 500, max: 1000000, help: 'A warning only: larger URL lists are still allowed.', warning: 'Increasing this threshold delays the warning about large projects and browser storage use.' },
  { key: 'htmlMiB', label: 'Maximum HTML or plain-text file size for extraction', unit: 'MiB', initial: 3, max: 128, help: 'The downloaded original is retained if text extraction exceeds this limit.', warning: memoryWarning },
  { key: 'downloadSeconds', label: 'Download timeout per file', unit: 'seconds', initial: 30, max: 3600, help: 'Also applies to PDF recovery using your browser session.', warning: 'Unresponsive servers can hold up the download queue for longer.' },
  { key: 'extractionSeconds', label: 'PDF/DOCX extraction timeout per document', unit: 'seconds', initial: 30, max: 3600, help: 'Longer timeouts do not raise file, page or text limits.', warning: 'A difficult document can occupy the extraction queue for longer. HTML extraction runs on the main thread and has no interruptible timeout.' },
  { key: 'pdfCharacters', label: 'Maximum extracted PDF text length', unit: 'characters', initial: 2000000, max: 100000000, advanced: true, warning: memoryWarning },
  { key: 'docxCharacters', label: 'Maximum extracted DOCX text length', unit: 'characters', initial: 10000000, max: 100000000, advanced: true, warning: memoryWarning },
  { key: 'editCharacters', label: 'Maximum text length when saving edits', unit: 'characters', initial: 10000000, max: 100000000, advanced: true, warning: memoryWarning },
  { key: 'captureMiB', label: 'Maximum manually captured HTML page size', unit: 'MiB', initial: 2, max: 128, advanced: true, help: 'The snapshot must also fit the HTML extraction limit.', warning: memoryWarning },
  { key: 'htmlElements', label: 'Maximum HTML page complexity', unit: 'elements', initial: 60000, max: 1000000, advanced: true, help: 'Applies to page capture and both HTML extractors.', warning: 'Complex pages may freeze the tab while the browser copies or parses them.' },
  { key: 'collectionPages', label: 'Maximum collected search-result pages', initial: 100, max: 10000, advanced: true, warning: memoryWarning },
  { key: 'collectionResults', label: 'Maximum collected search results', initial: 5000, max: 1000000, advanced: true, help: 'Counts results across saved search pages, including repeated URLs.', warning: memoryWarning }
];
export const DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(SETTING_FIELDS.map(field => [field.key, field.initial])));
export function validateSettings(values = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid settings.');
  for (const key of Object.keys(values)) if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new Error(`Unknown setting: ${key}`);
  const result = { ...DEFAULT_SETTINGS, ...values };
  for (const field of SETTING_FIELDS) {
    const value = result[field.key];
    if (field.options) {
      if (!field.options.some(option => option.value === value)) throw new Error(`${field.label}: choose a supported search engine.`);
      continue;
    }
    if (!Number.isSafeInteger(value) || value < 1 || value > field.max) throw new Error(`${field.label}: enter a whole number from 1 to ${field.max.toLocaleString()}.`);
  }
  return Object.freeze(result);
}
export async function readSettingsState(area) {
  const stored = (await area.get(SETTINGS_KEY))[SETTINGS_KEY];
  if (stored && stored.version !== 1) throw new Error('Unsupported settings version. Update BootCaT before changing settings.');
  return { values: validateSettings(stored?.values), revision: stored?.revision || 0 };
}
export async function readSettings(area) { return (await readSettingsState(area)).values; }
// The background serializes writes. Revisions protect drafts in other windows.
export async function saveSettings(area, values, revision) {
  const previous = await readSettingsState(area);
  if (revision !== previous.revision) throw new Error('Settings changed in another window. Close and reopen Settings before saving.');
  const record = { version: 1, revision: previous.revision + 1, values: validateSettings(values) };
  await area.set({ [SETTINGS_KEY]: record });
  return { values: record.values, revision: record.revision };
}
export const fileLimit = settings => settings.fileMiB * 1024 * 1024;

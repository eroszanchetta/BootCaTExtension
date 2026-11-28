import { validateLanguageDetector } from './language-strategies.js';
import { hasLanguageWarning } from './language-detection.js';

export function validateCorpusOptions(value = {}) {
  const options = { extractor: value.extractor ?? 'readability', languageDetector: validateLanguageDetector(value.languageDetector ?? 'franc'), minimumCharacters: value.minimumCharacters ?? null, maximumCharacters: value.maximumCharacters ?? null };
  if (!['readability', 'defuddle'].includes(options.extractor)) throw new Error('Choose a supported text extractor.');
  for (const key of ['minimumCharacters', 'maximumCharacters']) {
    const n = options[key];
    if (n !== null && (!Number.isSafeInteger(n) || n < 1 || n > 100000000)) throw new Error('Character limits must be blank or whole numbers from 1 to 100,000,000.');
  }
  if (options.minimumCharacters !== null && options.maximumCharacters !== null && options.minimumCharacters > options.maximumCharacters) throw new Error('Minimum characters cannot exceed maximum characters.');
  return options;
}
export const corpusDefaults = settings => validateCorpusOptions({ extractor: settings.defaultExtractor, languageDetector: settings.defaultLanguageDetector, minimumCharacters: settings.defaultMinimumCharacters, maximumCharacters: settings.defaultMaximumCharacters });
export const hasLengthWarning = e => ['short', 'long'].includes(e?.lengthCheck?.outcome) && !e.lengthCheck.accepted;
export const hasDocumentWarning = e => hasLanguageWarning(e) || hasLengthWarning(e);
export function lengthMessage(e) {
  const check = e?.lengthCheck;
  if (!check || check.outcome === 'pass') return '';
  return `${check.outcome === 'short' ? 'Too short' : 'Too long'}: ${e.characters.toLocaleString()} characters (${check.outcome === 'short' ? 'minimum ' + check.minimumCharacters.toLocaleString() : 'maximum ' + check.maximumCharacters.toLocaleString()}).${check.accepted ? ' Included manually.' : ''}`;
}
export function applyLengthFilter(e, options) {
  if (e.status !== 'ok') return e;
  const { minimumCharacters = null, maximumCharacters = null } = options;
  const baseline = e.inclusionOverride ?? e.lengthCheck?.inclusionBeforeCheck ?? e.languageCheck?.inclusionBeforeCheck ?? e.included;
  const outcome = minimumCharacters !== null && e.characters < minimumCharacters ? 'short' : maximumCharacters !== null && e.characters > maximumCharacters ? 'long' : 'pass';
  const accepted = e.inclusionOverride === true || !!e.lengthCheck?.accepted;
  const lengthCheck = { minimumCharacters, maximumCharacters, outcome, accepted, inclusionBeforeCheck: baseline };
  return { ...e, lengthCheck, ...(e.languageCheck ? { languageCheck: { ...e.languageCheck, inclusionBeforeCheck: baseline } } : {}), included: !!baseline && !hasLanguageWarning(e) && (outcome === 'pass' || accepted) };
}

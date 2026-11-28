import { assessLanguage } from './language-detectors/select.js';
import { validateLanguageDetector } from './language-strategies.js';
import { languageNames } from './language-names.js';
export const NO_LANGUAGE = 'none';
export const languageName = code => languageNames[code] || ({ ara: 'Arabic (macrolanguage)', zho: 'Chinese (macrolanguage)', fas: 'Persian (macrolanguage)', aze: 'Azerbaijani (macrolanguage)', msa: 'Malay (macrolanguage)', nep: 'Nepali (macrolanguage)', nor: 'Norwegian (macrolanguage)', swa: 'Swahili (macrolanguage)', uzb: 'Uzbek (macrolanguage)', sqi: 'Albanian (macrolanguage)', pus: 'Pashto (macrolanguage)', mlg: 'Malagasy (macrolanguage)', lat: 'Latin', fil: 'Filipino', kur: 'Kurdish (macrolanguage)' })[code] || code || 'Unknown';
export const supportedLanguages = Object.entries(languageNames).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
export function validateLanguage(value) {
  if (value !== NO_LANGUAGE && !Object.hasOwn(languageNames, value)) throw new Error('Select a language or No language detection.');
  return value;
}
// Adapters return ISO 639-3 language codes and a detector-neutral assessment.
// Franc scores stay diagnostic data; they are never treated as probabilities.
export async function checkLanguage(extraction, target = NO_LANGUAGE, { detector, strategy = 'franc', api, browserInfo, checkedAt = new Date().toISOString() } = {}) {
  if (extraction.status !== 'ok') return extraction;
  validateLanguage(target); validateLanguageDetector(strategy);
  const previous = extraction.languageCheck;
  const inclusionBeforeCheck = previous?.inclusionBeforeCheck ?? extraction.included;
  const accepted = !!previous?.accepted;
  const result = { target, strategy, checkedAt, inclusionBeforeCheck, accepted, ...(previous?.acceptedAt ? { acceptedAt: previous.acceptedAt } : {}) };
  if (target === NO_LANGUAGE) return { ...extraction, included: inclusionBeforeCheck, languageCheck: { ...result, outcome: 'disabled', detector: null } };
  try {
    const assessment = detector
      ? { ...await detector.detect(extraction.text || ''), detector: { id: detector.id, version: detector.version } }
      : await assessLanguage(extraction.text || '', target, { strategy, api, browserInfo });
    Object.assign(result, assessment, { outcome: assessment.uncertain ? 'uncertain' : assessment.detected === target ? 'match' : 'mismatch' });
  } catch {
    Object.assign(result, { outcome: 'uncertain', detected: null, detector: detector ? { id: detector.id, version: detector.version } : { id: strategy === 'native' ? 'native' : 'franc', version: strategy === 'native' ? 'browser-managed' : '6.2.0' }, reason: 'Language detection could not be completed. Review the text manually.' });
  }
  return { ...extraction, languageCheck: result, included: accepted ? extraction.included : result.outcome === 'match' ? inclusionBeforeCheck : false };
}
export const hasLanguageWarning = extraction => ['mismatch', 'uncertain'].includes(extraction?.languageCheck?.outcome) && !extraction.languageCheck.accepted;
export function languageMessage(extraction) {
  const check = extraction?.languageCheck;
  if (!check || check.outcome === 'disabled') return '';
  const message = check.unavailable ? `Language check unavailable. ${check.reason}` : check.outcome === 'mismatch' ? `Detected ${languageName(check.detected)}; expected ${languageName(check.target)}.`
    : check.outcome === 'match' ? `Detected ${languageName(check.detected)}; matches project language.`
    : `Language uncertain. ${check.reason || 'The text may be short, ambiguous or multilingual.'} Checked against ${languageName(check.target)}.`;
  return message + (check.accepted ? ' Language warning accepted manually.' : '');
}

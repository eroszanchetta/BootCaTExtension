export const INITIAL_LANGUAGE_DETECTOR = 'native-franc';
export const LANGUAGE_DETECTORS = Object.freeze({
  'native-franc': 'Native API with franc fallback',
  native: 'Native API only',
  franc: 'franc only'
});
export function validateLanguageDetector(value) {
  if (!Object.hasOwn(LANGUAGE_DETECTORS, value)) throw new Error('Choose a supported language detector.');
  return value;
}

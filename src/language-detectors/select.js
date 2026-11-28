import { validateLanguageDetector } from '../language-strategies.js';
import { detectionBrowser, nativeSupports, detectNative, NATIVE_COVERAGE_VERSION } from './native.js';

export async function assessLanguage(text, target, { strategy = 'franc', api = globalThis.browser ?? globalThis.chrome, browserInfo } = {}) {
  validateLanguageDetector(strategy);
  const browser = browserInfo || await detectionBrowser(api);
  let fallbackReason = '';
  const nativeDetector = { id: 'native', version: 'browser-managed' };
  if (strategy !== 'franc') {
    if (!api?.i18n?.detectLanguage) fallbackReason = 'Native API unavailable.';
    else if (!nativeSupports(target, browser)) fallbackReason = 'Native coverage is not verified for this project language.';
    else {
      try {
        return { ...await detectNative(text, api), detector: nativeDetector, browser, strategy, coverageVersion: NATIVE_COVERAGE_VERSION };
      } catch (error) { fallbackReason = error.message === 'Native language detection timed out.' ? error.message : 'Native API error.'; }
    }
    if (strategy === 'native') return { detected: null, uncertain: true, unavailable: true, reason: fallbackReason, samples: [], detector: nativeDetector, browser, strategy, coverageVersion: NATIVE_COVERAGE_VERSION, policy: { version: '1' } };
  }
  const { francDetector } = await import('./franc.js');
  return { ...await francDetector.detect(text), detector: { id: francDetector.id, version: francDetector.version }, browser, strategy, ...(fallbackReason ? { fallbackReason, coverageVersion: NATIVE_COVERAGE_VERSION } : {}) };
}

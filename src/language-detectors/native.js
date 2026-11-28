import { languageSamples, MIN_LETTERS, WINDOW } from './sampling.js';

// Coverage snapshot (28 November 2026): Chromium i18n_hooks_delegate.cc +
// google/cld3 README; Firefox ext-i18n.js/LanguageDetector.sys.mjs + CLD2 README.
// See docs/LANGUAGE-DETECTION-2.2.md for source URLs and scope.
export const NATIVE_COVERAGE_VERSION = '1';
// Explicit CLD code → ISO 639-3 mappings. Macrolanguages are NOT silently
// narrowed to franc's individual-language labels (e.g. ar → arb, zh → cmn).
const codes = Object.fromEntries(`af:afr am:amh ar:ara az:aze be:bel bg:bul bn:ben bs:bos ca:cat ceb:ceb chr:chr co:cos cs:ces cy:cym da:dan de:deu dv:div el:ell en:eng eo:epo es:spa et:est eu:eus fa:fas fi:fin fil:fil fr:fra fy:fry ga:gle gd:gla gl:glg gu:guj ha:hau haw:haw he:heb hi:hin hmn:hmn hr:hrv ht:hat hu:hun hy:hye id:ind ig:ibo is:isl it:ita iu:iku ja:jpn jv:jav ka:kat kk:kaz km:khm kn:kan ko:kor ku:kur ky:kir la:lat lb:ltz lg:lug lif:lif lo:lao lt:lit lv:lav mg:mlg mi:mri mk:mkd ml:mal mn:mon mr:mar ms:msa mt:mlt my:mya ne:nep nl:nld no:nor ny:nya or:ori pa:pan pl:pol ps:pus pt:por ro:ron ru:rus rw:kin sd:snd si:sin sk:slk sl:slv sm:smo sn:sna so:som sq:sqi sr:srp st:sot su:sun sv:swe sw:swa syr:syr ta:tam te:tel tg:tgk th:tha tl:tgl tr:tur uk:ukr ur:urd uz:uzb vi:vie xh:xho yi:yid yo:yor zh:zho zu:zul`.split(' ').map(pair => pair.split(':')));
const chromeCodes = new Set('af am ar bg bn bs ca ceb co cs cy da de el en eo es et eu fa fi fil fr fy ga gd gl gu ha haw hi hmn hr ht hu hy id ig is it he ja jv ka kk km kn ko ku ky la lb lo lt lv mg mi mk ml mn mr ms mt my ne nl no ny pa pl ps pt ro ru sd si sk sl sm sn so sq sr st su sv sw ta te tg th tr uk ur uz vi xh yi yo zh zu'.split(' '));
const firefoxCodes = new Set('af sq ar hy az eu be bn bg ca ceb chr hr cs zh da dv nl en et fi fr gl lg ka de el gu ht he hi hu is id iu ga it jv ja kn km rw ko lo lv lif lt mk ms ml mt mr ne no or fa pl pt pa ro ru gd sr si sk sl es sw sv syr tl ta te th tr uk ur vi cy yi'.split(' '));
export function nativeLanguageCode(value) {
  const base = String(value).toLowerCase().split('-')[0];
  return codes[({ iw: 'he', in: 'id', ji: 'yi' })[base] || base] || null;
}
export function nativeSupports(target, browser) {
  const list = browser.name === 'Firefox' ? firefoxCodes : browser.name === 'Chrome' ? chromeCodes : null;
  return !!list && [...list].some(code => codes[code] === target);
}
export async function detectionBrowser(api = globalThis.browser ?? globalThis.chrome) {
  try {
    if (api?.runtime?.getBrowserInfo) {
      const info = await api.runtime.getBrowserInfo();
      return { name: info.name, version: info.version };
    }
  } catch { /* UA is also available in extension pages. */ }
  try {
    const data = await globalThis.navigator?.userAgentData?.getHighEntropyValues(['fullVersionList']);
    const brand = data?.fullVersionList?.find(item => item.brand === 'Google Chrome') || data?.fullVersionList?.find(item => item.brand === 'Chromium');
    if (brand) return { name: 'Chrome', version: brand.version };
  } catch { /* Fall back to the available UA version (which may be reduced). */ }
  const ua = globalThis.navigator?.userAgent || '';
  const firefox = ua.match(/Firefox\/([\d.]+)/), chrome = ua.match(/(?:HeadlessChrome|Chrome|Chromium)\/([\d.]+)/);
  return firefox ? { name: 'Firefox', version: firefox[1] } : chrome ? { name: 'Chrome', version: chrome[1] } : { name: 'Unknown', version: 'Unknown' };
}
async function nativeCall(api, text) {
  let timer;
  try {
    return await Promise.race([
      api.i18n.detectLanguage(text),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native language detection timed out.')), 5000); })
    ]);
  } finally { clearTimeout(timer); }
}
export async function detectNative(text, api) {
  const samples = await Promise.all(languageSamples(text).map(async ({ start, text: sample }) => {
    const letters = (sample.match(/\p{L}/gu) || []).length;
    const base = { start, characters: sample.length, letters };
    if (letters < MIN_LETTERS) return { ...base, detected: null, uncertain: true };
    const raw = await nativeCall(api, sample);
    if (typeof raw?.isReliable !== 'boolean' || !Array.isArray(raw.languages) || raw.languages.length > 3 || raw.languages.some(lang => typeof lang.language !== 'string' || lang.language.length > 35 || !Number.isFinite(lang.percentage) || lang.percentage < 0 || lang.percentage > 100)) throw new Error('Invalid native language detection result.');
    const languages = raw.languages.map(lang => ({ language: lang.language, percentage: lang.percentage }));
    const best = [...languages].sort((a, b) => b.percentage - a.percentage)[0];
    const detected = best ? nativeLanguageCode(best.language) : null;
    return { ...base, detected, uncertain: !raw.isReliable || !detected, native: { isReliable: raw.isReliable, languages } };
  }));
  const languages = new Set(samples.map(sample => sample.detected).filter(Boolean));
  const uncertain = samples.some(sample => sample.uncertain) || languages.size !== 1;
  return { detected: languages.size === 1 ? [...languages][0] : null, uncertain, samples,
    reason: uncertain ? languages.size > 1 ? 'Samples suggest different languages.' : samples.some(sample => sample.letters < MIN_LETTERS) ? 'Not enough text for a reliable assessment.' : 'The native detector could not identify the language reliably.' : '',
    policy: { version: '1', minLetters: MIN_LETTERS, window: WINDOW, aggregation: 'unanimous', reliability: 'native-isReliable', nativeInputLimit: 'browser-managed' } };
}

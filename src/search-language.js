// Google result-language restrictions, not interface language or country settings.
// Values verified against https://www.google.com/advanced_search?hl=en
const googleLanguages = Object.freeze({
  afr: 'af', hye: 'hy', bel: 'be', epo: 'eo', tgl: 'tl', hin: 'hi', pes: 'fa', swh: 'sw', tha: 'th', ukr: 'uk', vie: 'vi',
  arb: 'ar', bul: 'bg', cat: 'ca', ces: 'cs', dan: 'da', deu: 'de', ell: 'el', eng: 'en', spa: 'es', ekk: 'et', fin: 'fi', fra: 'fr', hrv: 'hr', hun: 'hu', ind: 'id', isl: 'is', ita: 'it', heb: 'iw', jpn: 'ja', kor: 'ko', lit: 'lt', lvs: 'lv', nld: 'nl', nob: 'no', nno: 'no', pol: 'pl', por: 'pt', ron: 'ro', rus: 'ru', slk: 'sk', slv: 'sl', srp: 'sr', swe: 'sv', tur: 'tr'
});
export function searchLanguageFilter(engine, language) {
  if (engine !== 'google') return '';
  // Mandarin does not identify a script. Include both without a regional preference.
  if (language === 'cmn') return 'lang_zh-CN|lang_zh-TW';
  return Object.hasOwn(googleLanguages, language) ? `lang_${googleLanguages[language]}` : '';
}
export function languageFilterFromURL(engine, value) {
  if (engine !== 'google') return '';
  try { return new URL(value).searchParams.get('lr') || ''; } catch { return ''; }
}

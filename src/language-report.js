import { LANGUAGE_DETECTORS } from './language-strategies.js';
import { languageName } from './language-detection.js';

// One row per retained sample; an unchecked/failed document still has a row.
// Native percentages are text shares, and franc gaps/scores are not confidence.
export const LANGUAGE_REPORT_COLUMNS = [
  ['Source URL', 65], ['Original file', 38], ['Included', 12], ['Extraction status', 20],
  ['Requested language', 24], ['Selected strategy', 35], ['Actual detector', 20], ['Detector version', 22],
  ['Browser', 18], ['Browser version', 20], ['Outcome', 18], ['Detected language', 24],
  ['Accepted manually', 18], ['Checked at (UTC)', 28], ['Fallback reason', 45], ['Assessment reason', 50],
  ['Sampling policy', 60], ['Coverage table version', 22], ['Sample number', 18], ['Sample start (UTF-16)', 24],
  ['Sample length (UTF-16)', 24], ['Sample letter count', 22], ['Sample detected language', 28], ['Sample uncertain', 18],
  ['Native isReliable', 20], ['Native language shares (%)', 60], ['franc candidates (scores, not confidence)', 60], ['franc relative gap (not confidence)', 35]
];
export function languageReportRows(entries) {
  const rows = [];
  for (const entry of entries) {
    const e = entry.doc?.extraction, check = e?.languageCheck;
    const base = [entry.url, entry.record.filename || '', e?.included ? 'Yes' : 'No', e?.status || 'Not extracted',
      check?.target === 'none' ? 'No language detection' : check?.target ? languageName(check.target) : '',
      check ? LANGUAGE_DETECTORS[check.strategy || 'franc'] || check.strategy : 'Not recorded',
      check?.unavailable ? 'Unavailable' : check?.detector?.id || '', check?.detector?.version || '', check?.browser?.name || 'Not recorded', check?.browser?.version || 'Not recorded',
      check?.outcome || 'Not checked', check?.detected ? languageName(check.detected) : '', check?.accepted ? 'Yes' : 'No', check?.checkedAt || '',
      check?.fallbackReason || '', check?.reason || '', check?.policy ? JSON.stringify(check.policy) : '', check?.coverageVersion || ''];
    const samples = check?.samples?.length ? check.samples : [null];
    samples.forEach((sample, index) => rows.push([...base, sample ? index + 1 : '', sample?.start ?? '', sample?.characters ?? '', sample?.letters ?? '',
      sample?.detected ? languageName(sample.detected) : '', sample ? sample.uncertain ? 'Yes' : 'No' : '',
      sample?.native ? sample.native.isReliable ? 'Yes' : 'No' : '', sample?.native ? JSON.stringify(sample.native.languages) : '',
      sample?.candidates ? JSON.stringify(sample.candidates) : '', sample?.relativeGap ?? '']));
  }
  return rows;
}

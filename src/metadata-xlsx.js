import { parseURLs } from './core.js';
import { makeStoredZIP } from './zip-blob.js';
import { createExportLayout } from './export-layout.js';
import { languageName } from './language-detection.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const fileOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function textXML(value) {
  const text = String(value);
  if (text.length > 32767) throw new Error('A metadata value exceeds Excel’s 32,767-character cell limit.');
  // SpreadsheetML escapes control characters and literal _xHHHH_ sequences.
  return escapeXML(text.replace(/_x[0-9a-f]{4}_/gi, value => '_x005F_' + value.slice(1))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udfff]/gu,
      value => `_x${value.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`)).replace(/\r/g, '&#13;');
}
function detectedLanguage(check) {
  if (!check || check.outcome === 'disabled') return 'Not checked';
  if (check.outcome === 'uncertain' || check.uncertain || !check.detected) return 'Uncertain';
  return languageName(check.detected);
}
export function corpusMetadataRows(entries) {
  return createExportLayout(entries).entries.filter(entry => entry.doc?.extraction.status === 'ok' && entry.doc.extraction.included)
    .map(({ doc, url }) => ({ filename: doc.textFilename.replace(/^corpus\//, ''), url,
      characters: Number.isSafeInteger(doc.extraction.characters) && doc.extraction.characters >= 0 ? doc.extraction.characters : null,
      language: detectedLanguage(doc.extraction.languageCheck) }))
    .sort((a, b) => fileOrder.compare(a.filename, b.filename));
}

export function corpusURLList(entries) {
  const rows = corpusMetadataRows(entries);
  return rows.map(row => row.url).join('\n') + (rows.length ? '\n' : '');
}

export function excludedURLList(entries, inputURLs = '') {
  const included = new Set(parseURLs(corpusURLList(entries)).urls);
  const candidates = parseURLs([inputURLs, ...entries.map(entry => entry.url)].join('\n')).urls;
  const excluded = candidates.filter(url => !included.has(url));
  return excluded.join('\n') + (excluded.length ? '\n' : '');
}

// Deliberately supports one fixed, four-column table, rather than implementing
// a general spreadsheet library. All strings are literal cells, never formulas.
export async function makeMetadataWorkbook(entries, { signal, timestamp = new Date() } = {}) {
  const rows = corpusMetadataRows(entries);
  if (rows.length > 1048575) throw new Error('Excel supports at most 1,048,575 document rows per worksheet. Export a smaller selection.');
  const sheet = [], links = [], relationships = [];
  const stringCell = (ref, text, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${textXML(text)}</t></is></c>`;
  sheet.push('<row r="1" ht="24" customHeight="1">' + ['Text file name', 'Source URL', 'Characters', 'Detected language'].map((label, i) => stringCell('ABCD'[i] + '1', label, 1)).join('') + '</row>');
  for (let index = 0; index < rows.length; index++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const row = rows[index], number = index + 2; let hyperlink = false, target = '';
    try {
      const url = new URL(row.url);
      hyperlink = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && row.url.length <= 2048;
      if (hyperlink) target = url.href;
    } catch { /* Preserve unrecognised sources as literal text. */ }
    sheet.push(`<row r="${number}">` + stringCell(`A${number}`, row.filename) + stringCell(`B${number}`, row.url, hyperlink ? 2 : 0)
      + (row.characters === null ? `<c r="C${number}" s="3"/>` : `<c r="C${number}" s="3"><v>${row.characters}</v></c>`)
      + stringCell(`D${number}`, row.language) + '</row>');
    if (hyperlink) {
      const id = `rId${relationships.length + 1}`;
      links.push(`<hyperlink ref="B${number}" r:id="${id}"/>`);
      relationships.push(`<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${escapeXML(target)}" TargetMode="External"/>`);
    }
  }
  const styles = `${XML}<styleSheet xmlns="${NS}"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF007AA6"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF007AA6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = [
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Corpus metadata" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: `${XML}<worksheet xmlns="${NS}" xmlns:r="${REL}"><dimension ref="A1:D${rows.length + 1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols><col min="1" max="1" width="38" customWidth="1"/><col min="2" max="2" width="78" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="4" width="26" customWidth="1"/></cols><sheetData>${sheet.join('')}</sheetData><autoFilter ref="A1:D${rows.length + 1}"/>${links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : ''}</worksheet>` }
  ];
  if (relationships.length) files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: `${XML}<Relationships xmlns="${PACKAGE}">${relationships.join('')}</Relationships>` });
  const zip = await makeStoredZIP(files, { signal, timestamp });
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

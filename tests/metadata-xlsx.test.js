import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeMetadataWorkbook, corpusMetadataRows, corpusURLList, excludedURLList } from '../src/metadata-xlsx.js';
import { createExportLayout } from '../src/export-layout.js';

const entry = (name, check, extra = {}) => ({ url: 'https://example.org/caffè?q=1&other=2',
  record: { filename: `pages/${name}.html`, source: 'browser-tab' }, fileNames: [`pages/${name}.html`],
  doc: { filename: `pages/${name}.html`, textFilename: `corpus/${name}.txt`,
    extraction: { status: 'ok', included: true, characters: 1234, languageCheck: check, ...extra } } });

test('metadata contains only included texts, using detected rather than project or manually accepted language', () => {
  const rows = corpusMetadataRows([
    entry('captured/caffè-中文-😀', { outcome: 'match', detected: 'ita' }),
    entry('accepted', { outcome: 'mismatch', detected: 'eng', target: 'ita', accepted: true }),
    entry('uncertain', { outcome: 'uncertain', detected: 'eng', accepted: true }),
    entry('disabled', { outcome: 'disabled', detected: 'ita' }), entry('legacy'),
    entry('unchecked', undefined, { included: false }), entry('failed', undefined, { status: 'failed' })
  ]);
  assert.deepEqual(rows.map(row => row.filename), ['accepted.txt', 'caffè-中文-😀.txt', 'disabled.txt', 'legacy.txt', 'uncertain.txt']);
  assert.deepEqual(rows.map(row => row.language), ['English', 'Italian', 'Not checked', 'Not checked', 'Uncertain']);
  assert.equal(rows[0].characters, 1234);
});

test('the generated XLSX has valid XML, literal strings, numeric counts, hyperlinks, header styling, filters and frozen headers', async () => {
  const rows = [entry('captured/=SUM(1,2)-中文-😀'), entry('literal_x000A_')];
  const workbook = await makeMetadataWorkbook(rows);
  assert.equal(workbook.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const result = JSON.parse(execFileSync('python3', ['-c', `
import io,zipfile,sys,json,xml.etree.ElementTree as E
n={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 for name in z.namelist(): E.fromstring(z.read(name))
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 assert sheet.find('m:autoFilter',n).attrib['ref']=='A1:D3'
 assert sheet.find('m:sheetViews/m:sheetView/m:pane',n).attrib['state']=='frozen'
 assert not sheet.findall('.//m:f',n)
 cells=sheet.findall('m:sheetData/m:row/m:c',n)
 values={c.attrib['r']:c.find('m:is/m:t',n).text if c.attrib.get('t')=='inlineStr' else int(c.find('m:v',n).text) for c in cells}
 assert sheet.find('m:sheetData/m:row/m:c',n).attrib['s']=='1'
 rels=E.fromstring(z.read('xl/worksheets/_rels/sheet1.xml.rels'))
 assert all(r.attrib['TargetMode']=='External' and r.attrib['Target'].startswith('https:') for r in rels)
 assert len(sheet.findall('m:hyperlinks/m:hyperlink',n))==2
 print(json.dumps(values,ensure_ascii=True))
`], { input: Buffer.from(await workbook.arrayBuffer()), encoding: 'utf8' }));
  assert.equal(result.A1, 'Text file name'); assert.equal(result.C1, 'Characters');
  assert.equal(result.A2, '=SUM(1,2)-中文-😀.txt'); assert.equal(result.C2, 1234); assert.equal(result.D2, 'Not checked');
  assert.equal(result.B2, rows[0].url); assert.equal(result.A3, 'literal_x005F_x000A_.txt');
});

test('XLSX keeps unsafe hyperlink schemes inert, handles empty selections and honours cancellation and cell limits', async () => {
  const unsafe = entry('file'); unsafe.url = 'javascript:alert(1)';
  const workbook = await makeMetadataWorkbook([unsafe]);
  assert.equal((await workbook.text()).includes('TargetMode="External"'), false);
  const empty = await makeMetadataWorkbook([]); assert.ok((await empty.text()).includes('ref="A1:D1"'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(makeMetadataWorkbook([entry('file')], { signal: controller.signal }), { name: 'AbortError' });
  const oversized = entry('file'); oversized.url = 'https://example.org/' + 'x'.repeat(32768);
  await assert.rejects(makeMetadataWorkbook([oversized]), /cell limit/);
});

test('legacy capture paths flatten consistently without mutating storage names, including retained originals and collision handling', () => {
  const old = entry('captured/a'); old.record.previousAttempt = { filename: 'pages/captured/previous.html' };
  old.fileNames.unshift('pages/captured/previous.html'); old.doc.rawTextFilename = 'raw-pdf/captured/a.txt';
  const current = entry('a'), reserved = entry('a-2');
  const entries = [old, current, reserved], before = structuredClone(entries);
  const layout = createExportLayout(entries);
  assert.deepEqual(entries, before);
  assert.equal(layout.entries[0].doc.filename, 'pages/a-3.html');
  assert.equal(layout.entries[0].doc.textFilename, 'corpus/a-3.txt');
  assert.equal(layout.entries[0].doc.rawTextFilename, 'raw-pdf/a.txt');
  assert.equal(layout.entries[0].record.previousAttempt.filename, 'pages/previous.html');
  const names = layout.entries.flatMap(value => value.fileNames);
  assert.equal(new Set(names).size, names.length); assert.ok(names.every(name => !name.includes('/captured/')));
  assert.ok(corpusMetadataRows(entries).some(row => row.filename === layout.entries[0].doc.textFilename.slice('corpus/'.length)));
});

test('report rows default to filename order even when URL order differs, including numeric filename prefixes', () => {
  const values = [entry('10000-z'), entry('0010-m'), entry('0002-a')];
  values[0].url = 'https://a.test/'; values[1].url = 'https://m.test/'; values[2].url = 'https://z.test/';
  assert.deepEqual(corpusMetadataRows(values).map(row => row.filename), ['0002-a.txt', '0010-m.txt', '10000-z.txt']);
});

test('included and excluded URL lists partition project inputs and manual pages, matching report order', () => {
  const entries = [entry('0010-included-manual'), entry('0002-included'), entry('0003-unchecked', undefined, { included: false }), entry('0004-failed-extraction', undefined, { status: 'failed' }), { url: 'https://failed-download.test/', doc: null }];
  entries.slice(0, 4).forEach((entry, i) => { entry.url = `https://example.org/${i + 1}`; });
  const input = [entries[1].url, entries[2].url, entries[3].url, 'https://failed-download.test/', 'https://pending.test/', entries[2].url, 'not a URL'].join('\n');
  const included = corpusURLList(entries).trimEnd().split('\n');
  assert.deepEqual(included, corpusMetadataRows(entries).map(row => row.url));
  assert.deepEqual(included, [entries[1].url, entries[0].url]);
  assert.deepEqual(excludedURLList(entries, input).trimEnd().split('\n'), [entries[2].url, entries[3].url, 'https://failed-download.test/', 'https://pending.test/']);
  entries[0].doc.extraction.included = false;
  assert.ok(excludedURLList(entries, input).includes(entries[0].url), 'excluded manual pages need not appear in the input textarea');
  assert.equal(corpusURLList([]), ''); assert.equal(excludedURLList([], ''), '');
});

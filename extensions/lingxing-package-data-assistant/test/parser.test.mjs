import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, parseReportText, parseReportBytes, parseReportWorkbook, reportFromRows } from '../src/parser.mjs';
import { convertValue, normalizePackage } from '../src/units.mjs';
import { parseERPJSON, exactId } from '../src/json.mjs';
import { XLSX, HEADERS, reportRows } from './fixtures.mjs';
test('TXT BOM and merchant SKU strings are preserved without case or leading-zero changes', () => {
  const r = parseReportText('\uFEFF' + [HEADERS, ['000-abC', 'B0TEST0001', 'X0TEST0001', 'UK', 'x', '15', '10', '3', 'cm', '90.125', 'g']].map(r => r.join('\t')).join('\r\n'));
  assert.equal(r.rows[0].msku, '000-abC'); assert.deepEqual(r.rows[0].values, ['15.00', '10.00', '3.00', '90.1250']);
});
test('quoted CSV preserves commas, escaped quotes, multiline names and original physical line numbers', () => {
  const r = parseDelimited('a,b\r\n"one, two","a ""quote""\nnext"\r\nx,y', ',');
  assert.deepEqual(r[1], { cells: ['one, two', 'a "quote"\nnext'], line: 2 }); assert.equal(r[2].line, 4);
  assert.throws(() => parseDelimited('a,b\nx,"unclosed', ','), /引号未闭合/);
});
test('legacy Western CSV and a damaged BOM marker preserve every identity, value and accented title', () => {
  const rows = [HEADERS, ['000-abC', 'B0TEST0001', 'X0TEST0001', 'CA', 'Masajeador inalámbrico, eléctrico "6D"', '15', '10', '3', 'centimeters', '90.125', 'grams']];
  const csv = '?' + rows.map(row => row.map(v => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const report = parseReportBytes(Buffer.from(csv, 'latin1'), { filename: 'FeePreview.csv' });
  assert.equal(report.encoding, 'windows-1252'); assert.equal(report.headerPrefixRemoved, true);
  assert.equal(report.rows[0].title, rows[1][4]); assert.equal(report.rows[0].msku, '000-abC');
  assert.equal(report.rows[0].asin, rows[1][1]); assert.equal(report.rows[0].fnsku, rows[1][2]);
  assert.deepEqual(report.rows[0].raw, ['15', '10', '3', '90.125']);
  assert.deepEqual(report.rows[0].values, ['15.00', '10.00', '3.00', '90.1250']);
  assert.deepEqual(report.rows[0].errors, []); assert.equal(report.rows[0].line, 2);
});
test('Unicode BOMs remain authoritative and UTF-8 identities never pass through a legacy decoder', () => {
  const text = [HEADERS, ['商品-é-001', 'B0TEST0001', 'X0TEST0001', 'UK', '中文商品', '15', '10', '3', 'cm', '90', 'g']].map(r => r.join('\t')).join('\n');
  const variants = [
    ['utf-8', Buffer.from(text)],
    ['utf-8', Buffer.from('\uFEFF' + text)],
    ['utf-16le', Buffer.from('\uFEFF' + text, 'utf16le')],
    ['utf-16be', Buffer.from('\uFEFF' + text, 'utf16le').swap16()]
  ];
  for (const [encoding, bytes] of variants) {
    const report = parseReportBytes(bytes); assert.equal(report.encoding, encoding);
    assert.equal(report.rows[0].msku, '商品-é-001'); assert.equal(report.rows[0].title, '中文商品');
  }
  assert.throws(() => parseReportBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text), Buffer.from([0xe1])])), /编码损坏/);
  assert.throws(() => parseReportBytes(Buffer.from(text, 'utf16le')), /编码无法识别/);
  assert.throws(() => parseReportBytes(Buffer.from([0xff, 0xfe, 0x61])), /编码损坏/);
});
test('header marker compatibility never strips question marks from SKU data or repairs other malformed headers', () => {
  const text = [HEADERS, ['?SKU-001', 'B0TEST0001', '', 'UK', 'title', '15', '10', '3', 'cm', '90', 'g']].map(r => r.map(v => '"' + v + '"').join(',')).join('\n');
  assert.equal(parseReportText('?' + text).rows[0].msku, '?SKU-001');
  assert.equal(parseReportText(text).headerPrefixRemoved, false);
  for (const prefix of ['??', 'x']) assert.throws(() => parseReportText(prefix + text), /引号位置/);
});
test('legacy fallback refuses ambiguous non-ASCII matching keys and invalid control bytes', () => {
  const text = [HEADERS, ['SKU-é', 'B0TEST0001', '', 'UK', 'title', '15', '10', '3', 'cm', '90', 'g']].map(r => r.join('\t')).join('\n');
  assert.throws(() => parseReportBytes(Buffer.from(text, 'latin1')), /特殊字符/);
  assert.throws(() => parseReportBytes(Buffer.from(text.replace('SKU-é', 'SKU-001').replace('title', 'title\x81'), 'latin1')), /编码无法识别/);
});
test('duplicate headers and missing unit columns fail at the file level', () => {
  assert.throws(() => parseReportText('sku,sku\nx,x'), /重复表头/);
  assert.throws(() => parseReportText('sku,asin\nx,B0TEST0001'), /缺少报表字段/);
});
test('invalid weight, missing values and unknown units remain visible error rows and cannot become zeros', () => {
  for (const weight of ['', '--', '0', '-5', '1e3', '=2+2']) { const row = reportRows([['AMZ-001', 'B0TEST0001', '', 'UK', '', '15', '10', '3', 'cm', weight, 'g']]).rows[0]; assert.ok(row.errors.length, weight); assert.equal(row.values, null); }
  assert.ok(reportRows([['AMZ-001', 'B0TEST0001', '', 'UK', '', '15', '10', '3', 'furlong', '10', 'g']]).rows[0].errors.length);
});
test('both documented fee-preview weight header spellings are supported, conflicting columns are blocked', () => {
  const r = reportFromRows([{ cells: HEADERS.map(h => h === 'item-package-weight' ? 'item-weight' : h), line: 1 }, { cells: ['AMZ-001', 'B0TEST0001', '', 'UK', '', '15', '10', '3', 'cm', '90', 'g'], line: 2 }]); assert.equal(r.weightField, 'item-weight'); assert.equal(r.rows[0].errors.length, 0);
  const both = reportFromRows([{ cells: [...HEADERS, 'item-weight'], line: 1 }, { cells: ['AMZ-001', 'B0TEST0001', '', 'UK', '', '15', '10', '3', 'cm', '90', 'g', '95'], line: 2 }]); assert.match(both.rows[0].errors[0], /重量字段/);
});
test('identity scientific notation, whitespace and ASIN/FNSKU errors are blocked', () => {
  for (const sku of ['', ' X ', '1.234E+12']) assert.ok(reportRows([[sku, 'B0TEST0001', '', 'UK', '', '15', '10', '3', 'cm', '90', 'g']]).rows[0].errors.length);
  assert.ok(reportRows([['x', 'bad', 'bad', 'UK', '', '15', '10', '3', 'cm', '90', 'g']]).rows[0].errors.length >= 2);
});
test('decimal conversions use exact rational arithmetic with explicit target precision', () => {
  assert.equal(convertValue('1', 'lb', 'weight', 4), '453.5924');
  assert.equal(convertValue('1', 'oz', 'weight', 4), '28.3495');
  assert.equal(convertValue('0.5', 'kg', 'weight', 4), '500.0000');
  assert.equal(convertValue('0.00005', 'g', 'weight', 4), '0.0001');
  assert.equal(convertValue('1.235', 'cm', 'length', 2), '1.24');
  assert.deepEqual(normalizePackage(['4', '3', '1', '0.5'], 'inches', 'lb'), ['10.16', '7.62', '2.54', '226.7962']);
  assert.throws(() => normalizePackage(['1', '2', '3', '1'], 'cm', 'g'), /顺序/);
});
test('fee-preview full metric unit names support US and UK spelling while preserving source units', () => {
  for (const unit of ['centimeter', 'centimeters', 'centimetre', 'centimetres']) assert.equal(convertValue('1.235', unit, 'length', 2), '1.24');
  for (const unit of ['millimeter', 'millimeters', 'millimetre', 'millimetres']) assert.equal(convertValue('100', unit, 'length', 2), '10.00');
  for (const unit of ['meter', 'meters', 'metre', 'metres']) assert.equal(convertValue('0.15', unit, 'length', 2), '15.00');
  const row = reportRows([['AMZ-001', 'B0TEST0001', '', 'CA', '', '8.99', '5.99', '1.5', 'centimeters', '18.14', 'grams']]).rows[0];
  assert.deepEqual(row.values, ['8.99', '5.99', '1.50', '18.1400']);
  assert.equal(row.dimensionUnit, 'centimeters'); assert.equal(row.weightUnit, 'grams');
});
test('oversized batches and corrupt encoding fail clearly', () => {
  assert.throws(() => parseReportText('sku\n\uFFFD'), /编码/);
  const row = ['AMZ-001', 'B0TEST0001', '', 'UK', '', '15', '10', '3', 'cm', '90', 'g'];
  assert.throws(() => reportRows(Array.from({ length: 501 }, () => row)), /最多 500/);
});
test('XLSX numeric identity and formulas are never trusted as raw report identity/data', () => {
  const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([HEADERS, [123456789012345, 'B0TEST0001', '', 'UK', '', 15, 10, 3, 'cm', 90, 'g']]); XLSX.utils.book_append_sheet(book, sheet, 'data');
  const parsed = parseReportWorkbook(XLSX, XLSX.write(book, { type: 'array', bookType: 'xlsx' })); assert.ok(parsed.rows[0].errors.some(e => /保存为数字/.test(e)));
  sheet.J2 = { t: 'n', v: 90, f: '40+50' }; assert.throws(() => parseReportWorkbook(XLSX, XLSX.write(book, { type: 'array', bookType: 'xlsx' })), /公式/);
});
test('64-bit JSON identifiers survive while quoted content and decimals are unchanged', () => {
  const value = parseERPJSON('{"id":210752555712841217,"number":1.25,"text":"210752555712841217 \\\"same\\\""}');
  assert.equal(value.id, '210752555712841217'); assert.equal(value.number, 1.25); assert.equal(value.text, '210752555712841217 "same"');
  assert.throws(() => exactId(210752555712841217), /丢失精度/);
});

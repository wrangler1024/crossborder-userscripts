'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');
const { JSDOM } = require('jsdom');
const ExcelJS = require('exceljs');
const Core = require('../src/core.js');
const ImportTools = require('../src/import.js');

test('parses quoted CSV fields and normalizes template carrier aliases', () => {
  const rows = ImportTools.parseDelimitedText([
    '\uFEFF订单号,物流单号,物流商渠道',
    'GSH1TEST00001A,JMXTEST000000001,"J&T Express"',
    'GSH1TEST00002B,49400000000002,IMILE',
  ].join('\r\n'));
  const parsed = ImportTools.rowsToInput(rows, Core, { sourceLabel: 'CSV' });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.input, [
    'GSH1TEST00001A\tJMXTEST000000001\tJ&T',
    'GSH1TEST00002B\t49400000000002\tiMile',
  ].join('\n'));
});

test('requires all three template headers and fields', () => {
  const missingHeader = ImportTools.rowsToInput([
    ['订单号', '物流单号'],
    ['GSH1TEST00001A', 'JMXTEST000000001'],
  ], Core);
  assert.equal(missingHeader.ok, false);
  assert.equal(missingHeader.errors[0].code, 'headers_missing');

  const missingCarrier = ImportTools.rowsToInput([
    ['订单号', '物流单号', '物流商渠道'],
    ['GSH1TEST00001A', 'JMXTEST000000001', ''],
  ], Core);
  assert.equal(missingCarrier.ok, false);
  assert.equal(missingCarrier.errors[0].line, 2);
  assert.match(missingCarrier.errors[0].message, /缺少物流商渠道/);
});

test('blocks numeric, scientific-notation and formula tracking values before import', () => {
  const headers = ['订单号', '物流单号', '物流商渠道'];
  const numeric = ImportTools.rowsToInput([
    headers,
    ['GSU1TEST00003C', 9360000000000000000003, 'USPS'],
  ], Core);
  assert.equal(numeric.ok, false);
  assert.equal(numeric.errors[0].code, 'tracking_number_not_text');

  const scientific = ImportTools.rowsToInput([
    headers,
    ['GSU1TEST00003C', '9.3600000000E+21', 'USPS'],
  ], Core);
  assert.equal(scientific.ok, false);
  assert.equal(scientific.errors[0].code, 'tracking_scientific_notation');

  const formula = ImportTools.rowsToInput([
    headers,
    ['GSU1TEST00003C', { formula: '=A1', result: 'TRACK123' }, 'USPS'],
  ], Core);
  assert.equal(formula.ok, false);
  assert.equal(formula.errors[0].code, 'formula_not_allowed');
});

test('accepts 300 rows and rejects 301 rows with the unified batch limit', () => {
  const headers = [['订单号', '物流单号', '物流商渠道']];
  const dataRows = Array.from({ length: 301 }, (_, index) => [
    `ORDER_${String(index).padStart(4, '0')}`,
    `TRACK_${String(index).padStart(4, '0')}`,
    'UPS',
  ]);
  const accepted = ImportTools.rowsToInput([...headers, ...dataRows.slice(0, 300)], Core, {
    maxEntries: Core.MAX_ENTRIES,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.entries.length, 300);

  const rejected = ImportTools.rowsToInput([...headers, ...dataRows], Core, {
    maxEntries: Core.MAX_ENTRIES,
  });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((error) => error.code === 'entry_limit_exceeded'));
  assert.match(rejected.errors.find((error) => error.code === 'entry_limit_exceeded').message, /300/);
});

test('ships an xlsx template with text-formatted tracking cells and carrier validation', async () => {
  const templatePath = path.resolve(__dirname, '..', 'templates', 'Xynigo店小秘物流助手导入模板.xlsx');
  const buffer = fs.readFileSync(templatePath);
  const dom = new JSDOM('<!doctype html>');
  const rows = await ImportTools.parseXlsxRows(buffer, JSZip, dom.window.DOMParser);
  const zip = await JSZip.loadAsync(buffer);
  const worksheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const stylesXml = await zip.file('xl/styles.xml').async('string');
  const parser = new dom.window.DOMParser();
  const worksheetDocument = parser.parseFromString(worksheetXml, 'application/xml');
  const stylesDocument = parser.parseFromString(stylesXml, 'application/xml');
  const localElements = (node, name) => Array.from(node.getElementsByTagName('*'))
    .filter((element) => element.localName === name);
  const bodyCell = localElements(worksheetDocument, 'c')
    .find((cell) => cell.getAttribute('r') === 'B2');
  const bodyStyleIndex = Number(bodyCell.getAttribute('s'));
  const cellXfs = localElements(stylesDocument, 'cellXfs')[0];
  const bodyStyle = Array.from(cellXfs.children)[bodyStyleIndex];
  const borderId = Number(bodyStyle.getAttribute('borderId'));
  const borders = localElements(stylesDocument, 'borders')[0];
  const bodyBorder = Array.from(borders.children)[borderId];

  assert.deepEqual(rows[0], ['订单号', '物流单号', '物流商渠道']);
  assert.equal(rows.length, 301);
  assert.match(worksheetXml, /sqref="C2:C301"/);
  assert.match(worksheetXml, /UPS,USPS,FedEx,DHL,J&amp;T Express,iMile,GOFO,SpeedX/);
  assert.match(stylesXml, /formatCode="@"/);
  ['left', 'right', 'top', 'bottom'].forEach((sideName) => {
    const side = Array.from(bodyBorder.children).find((element) => element.localName === sideName);
    assert.equal(side.getAttribute('style'), 'thin');
    assert.equal(side.firstElementChild.getAttribute('rgb'), 'FFC7D3D9');
  });
  dom.window.close();
});

test('parses a conventional Excel-generated workbook with shared strings', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('发货导入');
  sheet.addRow(['订单号', '物流单号', '物流商渠道']);
  sheet.addRow(['GSU1TEST00003C', '9360000000000000000003', 'USPS']);
  const buffer = await workbook.xlsx.writeBuffer();
  const dom = new JSDOM('<!doctype html>');
  const rows = await ImportTools.parseXlsxRows(buffer, JSZip, dom.window.DOMParser);
  const parsed = ImportTools.rowsToInput(rows, Core);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.input, 'GSU1TEST00003C\t9360000000000000000003\tUSPS');
  dom.window.close();
});

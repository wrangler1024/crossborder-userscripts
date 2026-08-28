'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../src/core.js');

test('splits the first token as Nombre and keeps remaining tokens as Apellido', () => {
  assert.deepEqual(core.splitFullName('  Lucia   Torres Mendoza  '), {
    ok: true,
    firstName: 'Lucia',
    lastName: 'Torres Mendoza',
  });
});

test('moves the second name token into Nombre when the first token is too short', () => {
  assert.deepEqual(core.splitFullName('Ana Carolina Torres'), {
    ok: true,
    firstName: 'Ana Carolina',
    lastName: 'Torres',
  });
});

test('rejects short two-token names instead of inventing or duplicating a surname', () => {
  const result = core.splitFullName('Ana Torres');
  assert.equal(result.ok, false);
  assert.equal(result.firstName, 'Ana');
  assert.equal(result.lastName, 'Torres');
  assert.match(result.error, /少于 4 位/);
});

test('rejects a one-token full name instead of inventing a surname', () => {
  const result = core.splitFullName('Madonna');
  assert.equal(result.ok, false);
  assert.equal(result.firstName, 'Madonna');
  assert.equal(result.lastName, '');
  assert.match(result.error, /缺少真实姓氏/);
});

test('rejects a full name over the SHEIN combined 34 character limit', () => {
  const result = core.splitFullName('Nombre ' + 'Apellido'.repeat(5));
  assert.equal(result.ok, false);
  assert.match(result.error, /34/);
});

test('normalizes Mexico phone and accents for SHEIN dropdown comparison', () => {
  assert.equal(core.normalizeMexicoPhone('+52 477 123 4567'), '4771234567');
  assert.equal(core.optionMatches('Michoacán', 'michoacan'), true);
});

test('matches only an exact five-digit postal suggestion', () => {
  assert.equal(core.postalSuggestionMatches('03023 Narvarte Oriente', '03023'), true);
  assert.equal(core.postalSuggestionMatches('03024 Otra colonia', '03023'), false);
  assert.equal(core.postalSuggestionMatches('Código 3023', '03023'), false);
});

test('validates the recipient contract and maps the checkout values', () => {
  const result = core.validateRecipient({
    recipientName: 'Lucia Torres Mendoza',
    recipientPhone: '+52 477 123 4567',
    postalCode: '36000',
    stateProvince: 'Guanajuato',
    city: 'Guanajuato',
    addressLine1: 'Calle Prueba 100',
    addressLine2: 'Piso 2',
  });
  assert.equal(result.ok, true);
  assert.equal(result.values.firstName, 'Lucia');
  assert.equal(result.values.lastName, 'Torres Mendoza');
  assert.equal(result.values.phone, '4771234567');
});

test('rejects invalid postal code, phone and oversized address', () => {
  const result = core.validateRecipient({
    recipientName: 'Nombre Apellido',
    recipientPhone: '123',
    postalCode: '12',
    stateProvince: 'Jalisco',
    city: 'Guadalajara',
    addressLine1: 'x'.repeat(46),
    addressLine2: '',
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join('|'), /手机号/);
  assert.match(result.issues.join('|'), /邮编/);
  assert.match(result.issues.join('|'), /45/);
});

test('negotiates HubStudio automation by API capability instead of app version', () => {
  assert.deepEqual(core.hubAutomationSupport({ apiVersion: 1 }), {
    supported: false,
    reasonCode: 'executor_upgrade_required',
    message: '当前 Xynigo 主执行器版本暂不支持 HubStudio 自动化，请更新主执行器',
  });
  assert.equal(core.hubAutomationSupport({
    apiVersion: 2,
    features: { hubStudioAutomation: true },
  }).supported, true);
  assert.equal(core.hubAutomationSupport({
    apiVersion: 99,
    features: { hubStudioAutomation: false },
  }).supported, false);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../src/core.js');
const sample = {
  recipientName: 'Lucia Torres Mendoza', recipientPhone: '+52 477 123 4567',
  stateProvince: 'Guanajuato', city: 'Guanajuato',
  addressLine1: 'Calle Prueba 100', addressLine2: 'Piso 2',
  curp: 'TESTCURP0000000001', curpStatus: 'provided',
};

test('MX repairs exactly four digits before validation and keeps the source unchanged', () => {
  for (const [raw, expected] of [['1234', '01234'], [1234, '01234'], [' 1234 ', '01234'], ['0001', '00001']]) {
    const source = Object.freeze({ ...sample, postalCode: raw });
    const result = core.validateRecipient(source, 'MX');
    assert.equal(result.ok, true, String(raw));
    assert.equal(result.values.postalCode, expected);
    assert.equal(result.postalCodePadded, true);
    assert.equal(result.postalCodeAdjusted, false);
    assert.equal(source.postalCode, raw);
    assert.equal(result.curp.ok, true);
  }
});

test('MX leaves five digits unchanged and rejects other malformed postcodes', () => {
  for (const raw of ['01234', '36000', 36000]) {
    const result = core.validateRecipient({ ...sample, postalCode: raw }, 'MX');
    assert.equal(result.ok, true);
    assert.equal(result.values.postalCode, String(raw));
    assert.equal(result.postalCodePadded, false);
  }
  for (const raw of ['', null, 0, '1', '123', '123456', '12a4', '12 34', '12-34', '1234.0', '１２３４']) {
    const result = core.validateRecipient({ ...sample, postalCode: raw }, 'MX');
    assert.equal(result.ok, false, String(raw));
    assert.equal(result.postalCodePadded, false);
    assert.match(result.issues.join('|'), /邮编/);
  }
});

test('MX padding does not change US validation or the accepted five-digit ZIP behavior', () => {
  const us = { ...sample, recipientName: 'Amy Smith', recipientPhone: '+1 202 555 0100', stateProvince: 'MA', city: 'Boston' };
  for (const [raw, ok, expected] of [['1234', false, '1234'], ['01234', true, '01234'], ['01234-5678', true, '01234']]) {
    const result = core.validateRecipient({ ...us, postalCode: raw }, 'US');
    assert.equal(result.ok, ok);
    assert.equal(result.values.postalCode, expected);
    assert.equal(result.postalCodePadded, false);
    assert.equal(Object.hasOwn(result.values, 'curp'), false);
  }
});

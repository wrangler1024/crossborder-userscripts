'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../src/core.js');
const us = {
  recipientName: 'Amy Smith', recipientPhone: '+1 (202) 555-0100', postalCode: '02108',
  stateProvince: 'MA', city: 'Boston', addressLine1: '100 Example Street', addressLine2: 'Unit 2',
};

test('accepts only the observed US host and original MX hosts', () => {
  for (const [url, site] of [
    ['https://us.shein.com/checkout?cartSource=cart_login_checkout', 'US'],
    ['https://www.shein.com.mx/checkout', 'MX'], ['https://m.shein.com.mx/checkout', 'MX'],
    ['https://us.shein.com:443/checkout', 'US'],
    ['http://us.shein.com/checkout', ''], ['https://us.shein.com.evil.test/checkout', ''],
    ['https://us.shein.com@evil.test/checkout', ''], ['https://evil@us.shein.com/checkout', ''],
    ['https://us.shein.com:8766/checkout', ''], ['https://www.shein.com/checkout', ''],
    ['https://m.shein.com/checkout', ''], ['not a url', ''],
  ]) assert.equal(core.siteFromUrl(url), site, url);
});

test('validates US short names without MX name merging or arbitrary MX length limits', () => {
  const result = core.validateRecipient(us, 'US');
  assert.equal(result.ok, true);
  assert.equal(result.values.firstName, 'Amy');
  assert.equal(result.values.lastName, 'Smith');
  assert.equal(result.values.phone, '2025550100');
  assert.equal(result.values.postalCode, '02108');
  assert.equal(core.validateRecipient(us, 'MX').ok, false);
  assert.equal(core.splitFullName('Mary Ann Van Buren', 'US').lastName, 'Ann Van Buren');
  assert.equal(core.splitFullName('Prince', 'US').ok, false);
});

test('US phone normalization removes only US dialing prefixes', () => {
  for (const raw of ['2025550100', '1-202-555-0100', '+1 (202) 555-0100', '0012025550100']) {
    assert.equal(core.normalizeUsPhone(raw), '2025550100');
  }
  for (const raw of ['+52 202 555 0100', '+44 202 555 0100', '2025550100 ext 123', '123']) {
    assert.equal(core.validateRecipient({ ...us, recipientPhone: raw }, 'US').ok, false);
  }
});

test('US Postcode always uses the first five digits without changing source data', () => {
  for (const raw of ['02108', '02108-1234', '021081234']) {
    const recipient = { ...us, postalCode: raw };
    const result = core.validateRecipient(recipient, 'US');
    assert.equal(result.ok, true);
    assert.equal(result.values.postalCode, '02108');
    assert.equal(result.postalCodeAdjusted, raw.length > 5);
    assert.equal(recipient.postalCode, raw);
  }
  for (const raw of ['2108', '02108-123', '02108-12345', '02108 abc', '']) {
    assert.equal(core.validateRecipient({ ...us, postalCode: raw }, 'US').ok, false);
  }
});

test('matches whole US state names and abbreviations without substring guessing', () => {
  for (const [a, b] of [['California', 'CA'], ['New York', 'ny'], ['N.Y.', 'New York'], ['District of Columbia', 'DC'], ['California (CA)', 'CA'], ['CA - California', 'California']]) {
    assert.equal(core.stateMatches(a, b, 'US'), true, a);
  }
  assert.equal(core.stateMatches('Virginia', 'WV', 'US'), false);
  assert.equal(core.stateMatches('North Carolina', 'SC', 'US'), false);
  assert.equal(core.stateMatches('Michoacán', 'Michoacan', 'MX'), true);
  assert.equal(core.validateRecipient({ ...us, stateProvince: 'Unknown state' }, 'US').ok, false);
  assert.equal(core.validateRecipient({ ...us, stateProvince: 'Massachusetts' }, 'US').values.state, 'MA');
});

test('US address limit is 30 per line while MX remains 45', () => {
  const address = '100 Example Street Building North';
  const result = core.validateRecipient({ ...us, addressLine1: address, addressLine2: 'Unit 2' }, 'US');
  assert.equal(result.ok, true);
  assert.equal(result.addressAdjusted, true);
  assert.ok(result.values.address1.length <= 30 && result.values.address2.length <= 30);
  assert.equal(result.values.address1 + ' ' + result.values.address2, address + ' Unit 2');
  assert.equal(core.splitAddressLines(address, 'Unit 2').adjusted, false);
  assert.equal(core.validateRecipient({ ...us, addressLine1: 'x'.repeat(61), addressLine2: '' }, 'US').ok, false);
  assert.equal(core.splitAddressLines('x'.repeat(60), '', 30).ok, true);
  assert.equal(core.splitAddressLines('x'.repeat(60), '', 30).address1.length, 30);
});

test('empty optional address2 is retained as an explicit empty target', () => {
  const result = core.validateRecipient({ ...us, addressLine2: '' }, 'US');
  assert.equal(result.ok, true);
  assert.equal(result.values.address2, '');
});

test('rejects conflicting or unknown countries without inventing a personal-table country', () => {
  for (const country of ['MX', 'México', '墨西哥', 'Canada']) assert.ok(core.taskSiteIssue(country, 'US'));
  for (const country of ['US', 'USA', 'United States', '美国', '']) assert.equal(core.taskSiteIssue(country, 'US'), '');
  assert.ok(core.taskSiteIssue('US', 'MX'));
  assert.equal(core.validateRecipient(us, 'CA').ok, false);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../src/otp-core.js');

test('accepts only the configured 68sms HTTPS receiver endpoint', () => {
  assert.equal(core.validateReceiverUrl('https://api.68sms.com/api/sms/get?key=test-key').ok, true);
  assert.equal(core.validateReceiverUrl('http://api.68sms.com/api/sms/get?key=test-key').ok, false);
  assert.equal(core.validateReceiverUrl('https://example.com/api/sms/get?key=test-key').ok, false);
  assert.equal(core.validateReceiverUrl('https://api.68sms.com/api/sms/get').ok, false);
  assert.equal(core.validateReceiverUrl('https://api.68sms.com/other?key=test-key').ok, false);
});

test('extracts an OTP from common JSON response shapes', () => {
  const direct = core.parseReceiverResponse('{"status":200,"data":{"verify_code":"381642"}}', 'application/json');
  assert.deepEqual({ found: direct.found, code: direct.code, digits: direct.digits }, { found: true, code: '381642', digits: 6 });

  const realShape = core.parseReceiverResponse(
    '{"code":200,"msg":"OK","data":"[SHEIN]Login verification code: 842731, login account: DEMO***00, valid for 10 minutes."}',
    'application/json',
  );
  assert.deepEqual(
    { found: realShape.found, code: realShape.code, digits: realShape.digits },
    { found: true, code: '842731', digits: 6 },
  );

  const message = core.parseReceiverResponse(
    '{"code":0,"data":{"message":"[SHEIN] Your verification code is 927104. Do not share it."}}',
    'application/json',
  );
  assert.equal(message.code, '927104');
});

test('extracts OTP from text and HTML responses', () => {
  assert.equal(core.parseReceiverResponse('SHEIN OTP: 440281', 'text/plain').code, '440281');
  assert.equal(
    core.parseReceiverResponse('<html><body>【SHEIN】您的验证码为 <b>760315</b>，5分钟内有效。</body></html>', 'text/html').code,
    '760315',
  );
  assert.equal(core.parseReceiverResponse('553821', 'text/plain').code, '553821');
});

test('does not mistake status codes, years, or phone numbers for OTPs', () => {
  const result = core.parseReceiverResponse(
    '{"code":200,"message":"phone +1 6315550570, time 2026-08-24 19:43:42, waiting for SMS"}',
    'application/json',
  );
  assert.equal(result.found, false);
  assert.equal(result.code, null);
});

test('normalizes full-width OTP digits', () => {
  const result = core.parseReceiverResponse('您的验证码是９８７６５４', 'text/plain');
  assert.equal(result.code, '987654');
});

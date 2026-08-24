'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const pageState = require('../src/page-state.js');

test('detects the first-login auto-dispatched OTP state from the observed SHEIN dialog', () => {
  const result = pageState.detectDispatchState({
    text: '手机号码验证 请输入已发送至您手机的OTP码以验证身份 55s 已发送验证码，请查看',
    getCodeButtonVisible: false,
  });
  assert.equal(result.autoSent, true);
  assert.equal(result.hasSentMarker, true);
  assert.equal(result.hasCountdown, true);
  assert.equal(result.countdownSeconds, 55);
});

test('does not auto-start on the original dialog before manual get-code click', () => {
  const result = pageState.detectDispatchState({
    text: '手机号码验证 请输入短信验证码 获取验证码 如未收到验证，可尝试使用邮箱、WhatsApp',
    getCodeButtonVisible: true,
  });
  assert.equal(result.autoSent, false);
  assert.equal(result.hasSentMarker, false);
  assert.equal(result.hasCountdown, false);
});

test('uses a running countdown as fallback evidence when the get-code button is gone', () => {
  assert.equal(pageState.detectDispatchState({ text: '59 s', getCodeButtonVisible: false }).autoSent, true);
  assert.equal(pageState.detectDispatchState({ text: '59 s', getCodeButtonVisible: true }).autoSent, false);
});

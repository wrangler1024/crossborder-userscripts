'use strict';

(function exposePageState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SheinOtpPageState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPageState() {
  const SENT_MARKER = /(?:验证码已发送|驗證碼已發送|已发送验证码|已發送驗證碼|verification\s*code\s*(?:has\s*been\s*)?sent|code\s*(?:has\s*been\s*)?sent)/i;
  const COUNTDOWN_MARKER = /(?:^|\s)(\d{1,3})\s*(?:s|秒)(?=\s|$)/i;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function detectDispatchState({ text, getCodeButtonVisible = false } = {}) {
    const normalized = normalizeText(text);
    const hasSentMarker = SENT_MARKER.test(normalized);
    const countdownMatch = normalized.match(COUNTDOWN_MARKER);
    const hasCountdown = Boolean(countdownMatch);
    const countdownSeconds = countdownMatch ? Number(countdownMatch[1]) : null;
    return {
      autoSent: hasSentMarker || (hasCountdown && !getCodeButtonVisible),
      hasSentMarker,
      hasCountdown,
      countdownSeconds,
    };
  }

  return { detectDispatchState, normalizeText };
});

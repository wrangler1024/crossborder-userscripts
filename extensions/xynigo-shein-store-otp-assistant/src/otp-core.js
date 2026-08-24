'use strict';

(function exposeOtpCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SheinOtpCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOtpCore() {
  const RECEIVER_HOST = 'api.68sms.com';
  const RECEIVER_PATH = '/api/sms/get';
  const OTP_KEY_PATTERN = /^(?:otp|otpcode|verifycode|verificationcode|smscode|captcha|securitycode)$/i;
  const MESSAGE_KEY_PATTERN = /(?:content|message|msg|sms|text|body|data|result)/i;
  const OTP_KEYWORDS = /(?:验证码|驗證碼|校验码|校驗碼|动态码|動態碼|\botp\b|verification\s*code|verify\s*code|security\s*code|passcode)/i;
  const PHONE_KEYWORDS = /(?:手机号|手機號|电话|電話|mobile|phone|tel)/i;
  const TIME_KEYWORDS = /(?:订单|訂單|时间|時間|日期|order|date|time|timestamp)/i;

  function normalizeDigits(value) {
    return String(value == null ? '' : value).replace(/[\uff10-\uff19]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
    );
  }

  function stripMarkup(value) {
    return normalizeDigits(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stableFingerprint(value) {
    const input = String(value == null ? '' : value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function validateReceiverUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return { ok: false, error: '请先填写接码链接' };

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return { ok: false, error: '接码链接格式不正确' };
    }

    if (parsed.protocol !== 'https:') {
      return { ok: false, error: '接码链接必须使用 HTTPS' };
    }
    if (parsed.hostname.toLowerCase() !== RECEIVER_HOST) {
      return { ok: false, error: '开发版仅支持 api.68sms.com 接码链接' };
    }
    if (parsed.pathname !== RECEIVER_PATH) {
      return { ok: false, error: '接码链接路径应为 /api/sms/get' };
    }
    if (!parsed.searchParams.get('key')) {
      return { ok: false, error: '接码链接缺少 key 参数' };
    }
    return { ok: true, url: parsed.toString() };
  }

  function addTextCandidates(text, candidates, source, baseScore) {
    const clean = stripMarkup(text);
    if (!clean) return;

    const exact = clean.match(/^\D*(\d{4,8})\D*$/);
    if (exact && clean.replace(/\D/g, '').length === exact[1].length) {
      candidates.push({ code: exact[1], score: baseScore + 100, source });
      return;
    }

    const matches = clean.matchAll(/(^|\D)(\d{4,8})(?!\d)/g);
    for (const match of matches) {
      const code = match[2];
      const start = Math.max(0, (match.index || 0) - 70);
      const end = Math.min(clean.length, (match.index || 0) + match[0].length + 70);
      const context = clean.slice(start, end);
      let score = baseScore;

      if (code.length === 6) score += 26;
      else if (code.length === 4 || code.length === 5 || code.length === 8) score += 12;
      else score += 5;

      if (OTP_KEYWORDS.test(context)) score += 90;
      if (/\bSHEIN\b/i.test(context)) score += 35;
      if (PHONE_KEYWORDS.test(context)) score -= 90;
      if (TIME_KEYWORDS.test(context)) score -= 55;
      if (/^20(?:2\d|3\d)$/.test(code)) score -= 80;

      candidates.push({ code, score, source });
    }
  }

  function collectJsonCandidates(value, path, candidates, depth) {
    if (depth > 8 || value == null) return;

    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((item, index) =>
        collectJsonCandidates(item, `${path}[${index}]`, candidates, depth + 1),
      );
      return;
    }

    if (typeof value === 'object') {
      Object.entries(value).slice(0, 150).forEach(([key, item]) => {
        const compactKey = key.replace(/[_\-\s]/g, '');
        const nextPath = path ? `${path}.${key}` : key;
        if (OTP_KEY_PATTERN.test(compactKey) && ['string', 'number'].includes(typeof item)) {
          const exact = normalizeDigits(item).trim().match(/^\d{4,8}$/);
          if (exact) candidates.push({ code: exact[0], score: 180, source: nextPath });
        }
        if (MESSAGE_KEY_PATTERN.test(key) && ['string', 'number'].includes(typeof item)) {
          addTextCandidates(item, candidates, nextPath, 35);
        }
        collectJsonCandidates(item, nextPath, candidates, depth + 1);
      });
      return;
    }

    if (typeof value === 'string') addTextCandidates(value, candidates, path, 10);
  }

  function parseReceiverResponse(rawText, contentType) {
    const text = String(rawText == null ? '' : rawText).slice(0, 500000);
    const candidates = [];
    let format = 'text';
    let parsedJson = null;

    if (/json/i.test(String(contentType || '')) || /^[\s\uFEFF]*[\[{]/.test(text)) {
      try {
        parsedJson = JSON.parse(text);
        format = 'json';
      } catch {
        format = 'text';
      }
    }

    if (parsedJson !== null) collectJsonCandidates(parsedJson, '', candidates, 0);
    addTextCandidates(text, candidates, 'response', format === 'json' ? 0 : 10);

    const deduped = new Map();
    candidates.forEach((candidate) => {
      const previous = deduped.get(candidate.code);
      if (!previous || candidate.score > previous.score) deduped.set(candidate.code, candidate);
    });

    const ranked = [...deduped.values()].sort((left, right) => right.score - left.score);
    const best = ranked.find((candidate) => candidate.score >= 45) || null;
    return {
      found: Boolean(best),
      code: best ? best.code : null,
      digits: best ? best.code.length : 0,
      format,
      fingerprint: stableFingerprint(`${best ? best.code : ''}|${stripMarkup(text).slice(0, 4000)}`),
    };
  }

  return {
    parseReceiverResponse,
    stableFingerprint,
    stripMarkup,
    validateReceiverUrl,
  };
});

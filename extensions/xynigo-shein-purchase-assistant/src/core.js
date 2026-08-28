'use strict';

(function exposeCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XynigoPurchaseCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCore() {
  const REQUIRED_FIELDS = Object.freeze([
    'recipientName',
    'recipientPhone',
    'postalCode',
    'stateProvince',
    'city',
    'addressLine1',
  ]);

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeOption(value) {
    return normalizeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-MX');
  }

  function splitFullName(value) {
    const parts = normalizeText(value).split(' ').filter(Boolean);
    if (parts.length < 2) {
      return {
        ok: false,
        firstName: parts[0] || '',
        lastName: '',
        error: '收货人姓名缺少真实姓氏',
      };
    }

    let firstNameParts = 1;
    if (Array.from(parts[0]).length < 4) {
      if (parts.length < 3) {
        return {
          ok: false,
          firstName: parts[0],
          lastName: parts.slice(1).join(' '),
          error: '收货人名少于 4 位，且没有可合并的第二个名字',
        };
      }
      firstNameParts = 2;
    }

    const firstName = parts.slice(0, firstNameParts).join(' ');
    const lastName = parts.slice(firstNameParts).join(' ');
    if (Array.from(firstName + ' ' + lastName).length > 34) {
      return {
        ok: false,
        firstName,
        lastName,
        error: '收货人姓名总长度超过 SHEIN 34 字符限制',
      };
    }
    return {
      ok: true,
      firstName,
      lastName,
    };
  }

  function normalizeMexicoPhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits;
  }

  function validateRecipient(input) {
    const recipient = {};
    for (const field of REQUIRED_FIELDS.concat('addressLine2')) {
      recipient[field] = normalizeText(input && input[field]);
    }

    const missing = REQUIRED_FIELDS.filter((field) => !recipient[field]);
    const name = splitFullName(recipient.recipientName);
    const phone = normalizeMexicoPhone(recipient.recipientPhone);
    const issues = [];

    if (missing.length) issues.push('缺少字段：' + missing.join('、'));
    if (!name.ok) issues.push(name.error);
    if (!/^\d{10}$/.test(phone)) issues.push('墨西哥手机号应为 10 位本地号码');
    if (!/^\d{5}$/.test(recipient.postalCode)) issues.push('邮编应为 5 位数字');
    if (recipient.addressLine1.length > 45) issues.push('地址1超过 SHEIN 45 字符限制');
    if (recipient.addressLine2.length > 45) issues.push('地址2超过 SHEIN 45 字符限制');

    return {
      ok: issues.length === 0,
      issues,
      values: {
        firstName: name.firstName,
        lastName: name.lastName,
        phone,
        postalCode: recipient.postalCode,
        state: recipient.stateProvince,
        city: recipient.city,
        address1: recipient.addressLine1,
        address2: recipient.addressLine2,
      },
    };
  }

  function safeTaskKey(value) {
    const key = normalizeText(value);
    if (!key || key.length > 300) return '';
    return key;
  }

  function optionMatches(actual, expected) {
    return normalizeOption(actual) === normalizeOption(expected);
  }

  function postalSuggestionMatches(actual, postalCode) {
    const expected = String(postalCode || '').replace(/\D/g, '');
    if (!/^\d{5}$/.test(expected)) return false;
    const candidates = String(actual || '').match(/\d{5}/g) || [];
    return candidates.includes(expected);
  }

  function hubAutomationSupport(health) {
    const apiVersion = Number(health && health.apiVersion) || 0;
    const features = health && typeof health.features === 'object'
      ? health.features
      : {};
    const supported = apiVersion >= 2 && features.hubStudioAutomation === true;
    return {
      supported,
      reasonCode: supported ? 'ok' : 'executor_upgrade_required',
      message: supported
        ? ''
        : '当前 Xynigo 主执行器版本暂不支持 HubStudio 自动化，请更新主执行器',
    };
  }

  return {
    REQUIRED_FIELDS,
    normalizeText,
    normalizeOption,
    splitFullName,
    normalizeMexicoPhone,
    validateRecipient,
    safeTaskKey,
    optionMatches,
    postalSuggestionMatches,
    hubAutomationSupport,
  };
});

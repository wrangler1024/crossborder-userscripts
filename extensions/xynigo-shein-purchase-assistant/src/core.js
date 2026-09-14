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
  const SITE_PROFILES = Object.freeze({
    MX: Object.freeze({ code: 'MX', label: '墨西哥站', addressLineLimit: 45 }),
    US: Object.freeze({ code: 'US', label: '美国站', addressLineLimit: 30 }),
  });
  // USPS Publication 28, Appendix B: https://pe.usps.com/text/pub28/28apb.htm
  // A postal abbreviation does not imply that SHEIN offers that destination.
  const US_STATES = Object.freeze({
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    AS: 'American Samoa', FM: 'Federated States of Micronesia', GU: 'Guam',
    MH: 'Marshall Islands', MP: 'Northern Mariana Islands', PW: 'Palau',
    PR: 'Puerto Rico', VI: 'Virgin Islands', AA: 'Armed Forces Americas',
    AE: 'Armed Forces Europe', AP: 'Armed Forces Pacific',
  });

  function siteFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      if (['www.shein.com.mx', 'm.shein.com.mx'].includes(url.hostname)) return 'MX';
      return url.hostname === 'us.shein.com' ? 'US' : '';
    } catch { return ''; }
  }

  function normalizeSite(value) {
    const site = normalizeOption(value);
    if (['us', 'usa', 'united states', 'united states of america', '美国'].includes(site)) return 'US';
    if (['mx', 'mex', 'mexico', '墨西哥'].includes(site)) return 'MX';
    return site ? 'UNKNOWN' : '';
  }

  function taskSiteIssue(taskSite, pageSite) {
    const site = normalizeSite(taskSite);
    if (!site) return '';
    return site === pageSite ? '' : '任务收货国家与当前 ' + pageSite + ' 站点不一致，请核对数据源和订单';
  }

  function normalizeUsState(value) {
    const text = normalizeOption(value).replace(/\./g, '');
    const match = Object.entries(US_STATES).find(([code, name]) => (
      text === code.toLowerCase() || text === name.toLowerCase()
      || text === name.toLowerCase() + ' (' + code.toLowerCase() + ')'
      || text === code.toLowerCase() + ' - ' + name.toLowerCase()
    ));
    return match ? match[0] : '';
  }

  function stateMatches(actual, expected, site) {
    if (site !== 'US') return optionMatches(actual, expected);
    const code = normalizeUsState(expected);
    return Boolean(code) && normalizeUsState(actual) === code;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeOption(value) {
    return normalizeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-MX');
  }

  function splitFullName(value, site = 'MX') {
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
    if (site === 'MX' && Array.from(parts[0]).length < 4) {
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
    if (site === 'MX' && Array.from(firstName + ' ' + lastName).length > 34) {
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

  function normalizeUsPhone(value) {
    const text = normalizeText(value);
    if (!/^\+?[\d\s().-]+$/.test(text)) return '';
    let digits = text.replace(/\D/g, '');
    if (digits.length === 13 && digits.startsWith('001')) digits = digits.slice(3);
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits;
  }

  function normalizeUsPostal(value) {
    const text = normalizeText(value);
    return /^\d{9}$/.test(text) ? text.slice(0, 5) + '-' + text.slice(5) : text;
  }

  function splitAddressLines(addressLine1, addressLine2, lineLimit = 45) {
    if (![30, 45].includes(lineLimit)) throw new Error('不支持的地址行长度');
    const totalLimit = lineLimit * 2;
    const originalAddress1 = normalizeText(addressLine1);
    const originalAddress2 = normalizeText(addressLine2);
    if (
      Array.from(originalAddress1).length <= lineLimit
      && Array.from(originalAddress2).length <= lineLimit
    ) {
      return {
        ok: true,
        address1: originalAddress1,
        address2: originalAddress2,
        adjusted: false,
        hardSplit: false,
      };
    }

    const joined = [originalAddress1, originalAddress2].filter(Boolean).join(' ');
    const characters = Array.from(joined);
    const sourceTotalLength = Array.from(originalAddress1).length
      + Array.from(originalAddress2).length;
    if (sourceTotalLength > totalLimit) {
      return {
        ok: false,
        address1: originalAddress1,
        address2: originalAddress2,
        adjusted: false,
        hardSplit: false,
        error: '地址1和地址2合计超过 SHEIN 两行 ' + totalLimit + ' 字符限制',
      };
    }

    const maximumBreak = Math.min(lineLimit, characters.length);
    const minimumSpaceBreak = Math.max(1, characters.length - lineLimit - 1);
    let breakAt = -1;
    for (let index = maximumBreak; index >= minimumSpaceBreak; index -= 1) {
      if (characters[index] === ' ') {
        breakAt = index;
        break;
      }
    }

    const hardSplit = breakAt < 0;
    const address1 = characters.slice(0, hardSplit ? maximumBreak : breakAt).join('').trim();
    const address2 = characters.slice(hardSplit ? maximumBreak : breakAt + 1).join('').trim();
    if (
      Array.from(address1).length > lineLimit
      || Array.from(address2).length > lineLimit
    ) {
      return {
        ok: false,
        address1: originalAddress1,
        address2: originalAddress2,
        adjusted: false,
        hardSplit: false,
        error: '地址无法在 SHEIN 两行 ' + lineLimit + ' 字符限制内无损拆分',
      };
    }
    return {
      ok: true,
      address1,
      address2,
      adjusted: address1 !== originalAddress1 || address2 !== originalAddress2,
      hardSplit,
    };
  }

  function validateCurp(input) {
    const status = input?.curpStatus;
    if (status === 'conflict') return { ok: false, status: 'conflict', value: '', error: '同一任务存在不同 CURP，请先核对数据源' };
    if (!input || !Object.prototype.hasOwnProperty.call(input, 'curp')) return { ok: false, status: 'unsupported', value: '', error: '执行器尚未支持 CURP，请更新客户端后刷新表格字段' };
    if (status === 'missing_column') return { ok: false, status: 'missing_column', value: '', error: '数据源未读取到 CURP 列，请添加该列并在客户端刷新表格字段' };
    const value = String(input.curp || '').trim().toUpperCase();
    if (!value) return { ok: false, status: 'empty', value: '', error: '当前订单 CURP 为空，请在数据源补充或人工填写' };
    if (!/^[A-Z0-9]{18}$/.test(value)) return { ok: false, status: 'invalid', value: '', error: 'CURP 应为 18 位英文字母和数字，请核对原始值' };
    return { ok: true, status: 'provided', value, error: '' };
  }

  function validateRecipient(input, site = 'MX') {
    const profile = SITE_PROFILES[site];
    if (!profile) return { ok: false, issues: ['不支持的 SHEIN 站点'], values: {} };
    const recipient = {};
    for (const field of REQUIRED_FIELDS.concat('addressLine2')) {
      recipient[field] = normalizeText(input && input[field]);
    }

    const missing = REQUIRED_FIELDS.filter((field) => !recipient[field]);
    const name = splitFullName(recipient.recipientName, site);
    const phone = site === 'US' ? normalizeUsPhone(recipient.recipientPhone) : normalizeMexicoPhone(recipient.recipientPhone);
    // MX spreadsheets may drop one leading zero when a postcode is stored as a number.
    // Repair only four digits, without changing the source record or US ZIP rules.
    const postalCodePadded = site === 'MX' && /^\d{4}$/.test(recipient.postalCode);
    const postalCode = site === 'US' ? normalizeUsPostal(recipient.postalCode)
      : postalCodePadded ? '0' + recipient.postalCode : recipient.postalCode;
    const state = site === 'US' ? normalizeUsState(recipient.stateProvince) : recipient.stateProvince;
    const address = splitAddressLines(recipient.addressLine1, recipient.addressLine2, profile.addressLineLimit);
    const issues = [];

    if (missing.length) issues.push('缺少字段：' + missing.join('、'));
    if (!name.ok) issues.push(name.error);
    if (!/^\d{10}$/.test(phone)) issues.push(site === 'US' ? '美国电话应为 10 位本地号码，可带 +1 区号' : '墨西哥手机号应为 10 位本地号码');
    if (!(site === 'US' ? /^\d{5}(?:-\d{4})?$/ : /^\d{5}$/).test(postalCode)) {
      issues.push(site === 'US' ? '美国邮编应为 5 位或 ZIP+4 格式，不能省略前导零' : '邮编应为 5 位数字');
    }
    if (site === 'US' && !state) issues.push('美国州名称或两位缩写无法识别');
    if (!address.ok) issues.push(address.error);

    return {
      ok: issues.length === 0,
      issues,
      ...(site === 'MX' ? { curp: validateCurp(input) } : {}),
      postalCodeAdjusted: site === 'US' && postalCode.length > 5,
      postalCodePadded,
      addressAdjusted: address.adjusted,
      addressHardSplit: address.hardSplit,
      addressLineLimit: profile.addressLineLimit,
      values: {
        firstName: name.firstName,
        lastName: name.lastName,
        phone,
        postalCode: site === 'US' ? postalCode.slice(0, 5) : postalCode,
        state,
        city: recipient.city,
        address1: address.address1,
        address2: address.address2,
        ...(site === 'MX' ? { curp: validateCurp(input).value } : {}),
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

  function desktopDataSourceSupport(health) {
    const apiVersion = Number(health && health.apiVersion) || 0;
    const features = health && typeof health.features === 'object'
      ? health.features
      : {};
    const supported = apiVersion >= 4
      && features.desktopManagedDataSources === true;
    return {
      supported,
      reasonCode: supported ? 'ok' : 'executor_update_required',
      message: supported
        ? ''
        : '请先将 Xynigo 桌面客户端升级到支持桌面数据源的版本',
    };
  }

  function safeContainerCode(value) {
    const text = String(value || '').trim();
    return /^[A-Za-z0-9._:-]{1,128}$/.test(text) ? text : '';
  }

  return {
    SITE_PROFILES,
    siteFromUrl,
    normalizeSite,
    taskSiteIssue,
    normalizeUsState,
    stateMatches,
    normalizeUsPhone,
    normalizeUsPostal,
    REQUIRED_FIELDS,
    normalizeText,
    normalizeOption,
    splitFullName,
    normalizeMexicoPhone,
    splitAddressLines,
    validateRecipient,
    validateCurp,
    safeTaskKey,
    optionMatches,
    postalSuggestionMatches,
    hubAutomationSupport,
    desktopDataSourceSupport,
    safeContainerCode,
  };
});

(function initXynigoDxmLogisticsCore(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XynigoDxmLogisticsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCore() {
  'use strict';

  const MAX_ENTRIES = 300;
  const ORDER_NO_RE = /^[A-Z0-9][A-Z0-9._-]{5,79}$/;
  const TRACKING_NO_RE = /^[A-Z0-9][A-Z0-9._-]{4,199}$/;
  const INTERNAL_PACKAGE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
  const PLATFORM_PROVIDER_NAME_RE = /^[^,\r\n\u0000-\u001F]{1,100}$/;
  const BUSY_MESSAGE = '正在执行移入运单号申请操作，请执行完操作后再重试';
  const CARRIERS = Object.freeze([
    { code: 'UPS', label: 'UPS', providerName: 'UPS' },
    { code: 'USPS', label: 'USPS', providerName: 'USPS' },
    { code: 'FEDEX', label: 'FedEx', providerName: 'FedEx' },
    { code: 'DHL', label: 'DHL', providerName: 'DHL' },
    { code: 'JT', label: 'J&T Express', providerName: 'J&T' },
    { code: 'IMILE', label: 'iMile', providerName: 'iMile' },
    { code: 'GOFO', label: 'GOFO', providerName: 'GOFO' },
    { code: 'SPEEDX', label: 'SpeedX', providerName: 'SpeedX' },
  ]);
  const CARRIER_ALIASES = new Map([
    ['UPS', 'UPS'],
    ['USPS', 'USPS'],
    ['FEDEX', 'FedEx'],
    ['FED EX', 'FedEx'],
    ['DHL', 'DHL'],
    ['JT', 'J&T'],
    ['J&T', 'J&T'],
    ['J&T EXPRESS', 'J&T'],
    ['JNT', 'J&T'],
    ['IMILE', 'iMile'],
    ['I MILE', 'iMile'],
    ['GOFO', 'GOFO'],
    ['SPEEDX', 'SpeedX'],
    ['SPEED X', 'SpeedX'],
  ]);
  const CARRIER_MATCH_ALIASES = Object.freeze({
    UPS: Object.freeze(['UPS', 'UNITEDPARCELSERVICE']),
    USPS: Object.freeze(['USPS', 'UNITEDSTATESPOSTALSERVICE']),
    FedEx: Object.freeze(['FEDEX', 'FEDERALEXPRESS']),
    DHL: Object.freeze(['DHL', 'DHLEXPRESS']),
    'J&T': Object.freeze(['JT', 'JNT', 'JTEXPRESS']),
    iMile: Object.freeze(['IMILE']),
    GOFO: Object.freeze(['GOFO']),
    SpeedX: Object.freeze(['SPEEDX']),
  });

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeOrderNo(value) {
    return normalizeText(value).toUpperCase();
  }

  function normalizeTrackingNo(value) {
    return normalizeText(value).replace(/\s+/g, '').toUpperCase();
  }

  function resolveCarrier(value, fallback = 'UPS') {
    const normalized = normalizeText(value || fallback).toUpperCase();
    return CARRIER_ALIASES.get(normalized) || '';
  }

  function normalizeCarrierToken(value) {
    return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function carrierNameMatches(requestedCarrier, currentProviderName) {
    const requestedProviderName = resolveCarrier(requestedCarrier, '');
    const currentProviderText = normalizeText(currentProviderName);
    if (requestedProviderName === 'iMile') return currentProviderText === 'iMile';
    const currentToken = normalizeCarrierToken(currentProviderName);
    if (!requestedProviderName || !currentToken) return false;
    const aliases = CARRIER_MATCH_ALIASES[requestedProviderName] || [normalizeCarrierToken(requestedProviderName)];
    return aliases.some((alias) => (
      currentToken === alias
      || (alias.length >= 3 && (currentToken.includes(alias) || alias.includes(currentToken)))
    ));
  }

  function unwrapShippingOptionsPayload(payload) {
    const candidates = [payload?.data, payload?.result, payload];
    return candidates.find((item) => item && typeof item === 'object' && Array.isArray(item.orderList)) || null;
  }

  function platformProviderOptions(payload, internalPackageId) {
    const data = unwrapShippingOptionsPayload(payload);
    const packageId = String(internalPackageId || '').trim();
    if (!data || !INTERNAL_PACKAGE_ID_RE.test(packageId)) {
      return { ok: false, reason: '店小秘未返回有效的平台承运商数据', options: [] };
    }
    const order = data.orderList.find((item) => {
      const id = String(item?.idStr || item?.id || item?.packageId || '').trim();
      return id === packageId;
    });
    if (!order) {
      return { ok: false, reason: '店小秘平台承运商响应中缺少当前订单', options: [] };
    }
    const platform = normalizeText(order.platform);
    if (!platform || !/^[A-Za-z0-9_-]{1,50}$/.test(platform)) {
      return { ok: false, reason: '店小秘订单缺少有效平台标识', options: [] };
    }
    const rawOptions = Array.isArray(order.platformCarrierList)
      ? order.platformCarrierList
      : data[`${platform}Providers`];
    if (!Array.isArray(rawOptions)) {
      return { ok: false, reason: `店小秘未返回 ${platform} 平台的可用承运商`, platform, options: [] };
    }
    const optionKeys = new Set();
    const options = rawOptions.map((item) => {
      const providerName = normalizeText(item?.providerName || item?.nameZh || '');
      const code = normalizeText(
        platform === 'our'
          ? (item?.code || item?.providerName)
          : (item?.fProductCode || item?.code || item?.providerName),
      );
      const searchValues = [
        providerName,
        code,
        item?.providerCn,
        item?.nameZh,
        item?.label,
      ].map(normalizeCarrierToken).filter(Boolean);
      return { providerName, code, searchValues };
    }).filter((item) => {
      if (!PLATFORM_PROVIDER_NAME_RE.test(item.providerName) || !item.code) return false;
      const key = item.providerName;
      if (optionKeys.has(key)) return false;
      optionKeys.add(key);
      return true;
    });
    return { ok: true, platform, order, options };
  }

  function carrierMatchScore(option, aliases, requestedProviderName) {
    if (requestedProviderName === 'iMile') {
      return option.providerName === 'iMile' ? 6 : 0;
    }
    if (option.providerName === requestedProviderName) return 6;
    if (option.providerName.toLocaleLowerCase() === requestedProviderName.toLocaleLowerCase()) return 5;
    let score = 0;
    option.searchValues.forEach((candidate, index) => {
      aliases.forEach((alias) => {
        if (candidate === alias) score = Math.max(score, index <= 1 ? 4 : 3);
        else if (alias.length >= 3 && (candidate.includes(alias) || alias.includes(candidate))) {
          score = Math.max(score, index === 0 ? 2 : 1);
        }
      });
    });
    return score;
  }

  function resolvePlatformProvider(payload, internalPackageId, requestedCarrier) {
    const requestedProviderName = resolveCarrier(requestedCarrier, '');
    if (!requestedProviderName) {
      return { ok: false, reason: '输入的物流商不受支持', availableProviderNames: [] };
    }
    const parsed = platformProviderOptions(payload, internalPackageId);
    if (!parsed.ok) return { ...parsed, requestedProviderName, availableProviderNames: [] };
    const aliases = CARRIER_MATCH_ALIASES[requestedProviderName] || [normalizeCarrierToken(requestedProviderName)];
    const scored = parsed.options
      .map((option) => ({ ...option, score: carrierMatchScore(option, aliases, requestedProviderName) }))
      .filter((option) => option.score > 0);
    const bestScore = Math.max(0, ...scored.map((option) => option.score));
    const bestMatches = scored.filter((option) => option.score === bestScore);
    const availableProviderNames = [...new Set(parsed.options.map((item) => item.providerName))];
    if (bestMatches.length === 0) {
      return {
        ok: false,
        reason: `店小秘没有与“${requestedProviderName}”匹配的平台承运商`,
        platform: parsed.platform,
        requestedProviderName,
        availableProviderNames,
      };
    }
    if (bestMatches.length > 1) {
      return {
        ok: false,
        reason: `“${requestedProviderName}”匹配到多个平台承运商，无法安全自动选择`,
        platform: parsed.platform,
        requestedProviderName,
        availableProviderNames: bestMatches.map((item) => item.providerName),
      };
    }
    const [match] = bestMatches;
    return {
      ok: true,
      platform: parsed.platform,
      requestedProviderName,
      platformProviderName: match.providerName,
      platformProviderCode: match.code,
      availableProviderNames,
    };
  }

  function splitInputLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return [];
    if (trimmed.includes('\t')) return trimmed.split(/\t+/).map((part) => part.trim()).filter(Boolean);
    if (/[，,；;]/.test(trimmed)) {
      return trimmed.split(/[，,；;]+/).map((part) => part.trim()).filter(Boolean);
    }
    return trimmed.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  }

  function parseInput(input, options = {}) {
    const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : MAX_ENTRIES;
    const fallbackCarrier = resolveCarrier(options.defaultCarrier || 'UPS');
    const errors = [];
    const warnings = [];
    const entries = [];
    const lines = String(input || '').replace(/^\uFEFF/, '').split(/\r?\n/);

    if (!fallbackCarrier) {
      errors.push({ line: 0, code: 'default_carrier_invalid', message: '请选择有效的默认物流商' });
    }

    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const lineNumber = index + 1;
      const columns = splitInputLine(line);
      if (columns.length < 2 || columns.length > 3) {
        errors.push({
          line: lineNumber,
          code: 'column_count_invalid',
          message: `第 ${lineNumber} 行必须是“订单号 + 物流单号”，可选第三列物流商`,
        });
        return;
      }
      const orderNo = normalizeOrderNo(columns[0]);
      const trackingNo = normalizeTrackingNo(columns[1]);
      const providerName = resolveCarrier(columns[2], fallbackCarrier);
      if (!ORDER_NO_RE.test(orderNo)) {
        errors.push({ line: lineNumber, code: 'order_no_invalid', message: `第 ${lineNumber} 行订单号格式无效` });
        return;
      }
      if (!TRACKING_NO_RE.test(trackingNo)) {
        errors.push({ line: lineNumber, code: 'tracking_no_invalid', message: `第 ${lineNumber} 行物流单号格式无效` });
        return;
      }
      if (!providerName) {
        errors.push({ line: lineNumber, code: 'carrier_invalid', message: `第 ${lineNumber} 行物流商不受支持` });
        return;
      }
      entries.push({ lineNumber, orderNo, trackingNo, providerName });
    });

    if (entries.length === 0 && errors.length === 0) {
      errors.push({ line: 0, code: 'input_empty', message: '请至少输入一行订单号和物流单号' });
    }
    if (entries.length > maxEntries) {
      errors.push({
        line: 0,
        code: 'entry_limit_exceeded',
        message: `当前每批最多处理 ${maxEntries} 个订单；请拆分文件后分批操作`,
      });
    }

    const exactKeys = new Set();
    const orderNumbers = new Map();
    const trackingNumbers = new Map();
    const deduplicated = [];
    entries.forEach((entry) => {
      const exactKey = `${entry.orderNo}|${entry.trackingNo}|${entry.providerName}`;
      if (exactKeys.has(exactKey)) {
        warnings.push({
          line: entry.lineNumber,
          code: 'exact_duplicate_removed',
          message: `第 ${entry.lineNumber} 行与前文完全重复，已忽略`,
        });
        return;
      }
      exactKeys.add(exactKey);
      if (orderNumbers.has(entry.orderNo)) {
        errors.push({
          line: entry.lineNumber,
          code: 'order_duplicate_conflict',
          message: `订单 ${entry.orderNo} 对应多条物流信息；第一期不支持拆包`,
        });
      } else {
        orderNumbers.set(entry.orderNo, entry.lineNumber);
      }
      if (trackingNumbers.has(entry.trackingNo)) {
        errors.push({
          line: entry.lineNumber,
          code: 'tracking_duplicate_conflict',
          message: `物流单号 ${entry.trackingNo} 被分配给多个订单`,
        });
      } else {
        trackingNumbers.set(entry.trackingNo, entry.lineNumber);
      }
      deduplicated.push(entry);
    });

    return {
      ok: errors.length === 0,
      entries: deduplicated,
      errors,
      warnings,
      inputCount: entries.length,
    };
  }

  function parseOrderDetail(payload, internalPackageId) {
    const dxmOrder = payload && typeof payload === 'object' ? payload.data?.dxmOrder : null;
    const orderNo = normalizeOrderNo(
      dxmOrder?.orderId || dxmOrder?.orderNo || dxmOrder?.platformOrderId || '',
    );
    const packageId = String(internalPackageId || '').trim();
    if (!dxmOrder || !ORDER_NO_RE.test(orderNo) || !INTERNAL_PACKAGE_ID_RE.test(packageId)) {
      return { ok: false, reason: '店小秘订单详情响应缺少有效订单号或内部包裹 ID' };
    }
    return {
      ok: true,
      orderNo,
      internalPackageId: packageId,
      orderStatus: normalizeText(dxmOrder.orderStatusName || dxmOrder.statusName || ''),
      currentTrackingNo: normalizeTrackingNo(dxmOrder.trackingNumber || dxmOrder.trackNum || ''),
      currentProviderName: normalizeText(dxmOrder.agentProviderName || dxmOrder.providerName || ''),
      failureMessage: normalizeText(dxmOrder.errorMsg || dxmOrder.commitErrorMsg || ''),
    };
  }

  function matchEntries(entries, orderRecords) {
    const recordsByOrder = new Map();
    (Array.isArray(orderRecords) ? orderRecords : []).forEach((record) => {
      const orderNo = normalizeOrderNo(record?.orderNo);
      const internalPackageId = String(record?.internalPackageId || '').trim();
      if (!ORDER_NO_RE.test(orderNo) || !INTERNAL_PACKAGE_ID_RE.test(internalPackageId)) return;
      const bucket = recordsByOrder.get(orderNo) || [];
      if (!bucket.some((item) => item.internalPackageId === internalPackageId)) bucket.push(record);
      recordsByOrder.set(orderNo, bucket);
    });

    const matches = [];
    const missing = [];
    const ambiguous = [];
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const records = recordsByOrder.get(normalizeOrderNo(entry.orderNo)) || [];
      if (records.length === 0) {
        missing.push(entry);
      } else if (records.length > 1) {
        ambiguous.push({ entry, records });
      } else {
        matches.push({ ...entry, ...records[0], orderNo: normalizeOrderNo(entry.orderNo) });
      }
    });
    return { ok: missing.length === 0 && ambiguous.length === 0, matches, missing, ambiguous };
  }

  function buildShipmentBody(input) {
    const internalPackageId = String(input?.internalPackageId || '').trim();
    const trackingNo = normalizeTrackingNo(input?.trackingNo);
    const platformProviderName = normalizeText(input?.platformProviderName);
    if (!INTERNAL_PACKAGE_ID_RE.test(internalPackageId)) throw new Error('店小秘内部包裹 ID 无效');
    if (!TRACKING_NO_RE.test(trackingNo)) throw new Error('物流单号无效');
    if (!PLATFORM_PROVIDER_NAME_RE.test(platformProviderName)) {
      throw new Error('尚未通过店小秘平台承运商预检，禁止提交');
    }

    const form = new URLSearchParams();
    form.append('packageIds', internalPackageId);
    form.append('tracingNumbers', trackingNo);
    form.append('providerNames', platformProviderName);
    form.append('isShipStr', '1');
    form.append('trackUrls', '');
    form.append('serviceTypes', '');
    form.append('fProductCodes', '');
    form.append('fProductCodeNames', '');
    return form.toString();
  }

  function interpretShipmentResponse(payload) {
    if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'code')) {
      return { state: 'unknown', ok: false, retryable: false, message: '店小秘返回了无法识别的响应' };
    }
    const rawCode = String(payload.code == null ? '' : payload.code).trim();
    const code = /^-?\d+$/.test(rawCode) ? Number(rawCode) : Number.NaN;
    const message = normalizeText(payload.msg || payload.message || '');
    if (!Number.isFinite(code)) {
      return { state: 'unknown', ok: false, retryable: false, message: '店小秘返回了无效错误码' };
    }
    if (code === 0) {
      return {
        state: 'submitted',
        ok: true,
        retryable: false,
        message: message || '店小秘已受理，等待平台确认',
      };
    }
    if (code === -1 && message.includes(BUSY_MESSAGE)) {
      return { state: 'busy', ok: false, retryable: true, message };
    }
    return {
      state: 'failed',
      ok: false,
      retryable: false,
      message: message || `店小秘返回错误码 ${code}`,
    };
  }

  function csvCell(value) {
    let text = String(value == null ? '' : value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function resultsToCsv(results) {
    const headers = ['操作', '订单号', '物流单号', '输入物流商', '店小秘平台承运商', '店小秘内部包裹ID', '结果', '说明'];
    const rows = (Array.isArray(results) ? results : []).map((item) => [
      item.operation === 'retry' ? '失败单重提' : '首次发货',
      item.orderNo,
      item.trackingNo,
      item.requestedProviderName || item.providerName,
      item.platformProviderName,
      item.internalPackageId,
      item.state === 'submitted' ? '已提交，待平台确认' : (item.state === 'unknown' ? '结果未知' : '失败'),
      item.message,
    ]);
    return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  return Object.freeze({
    MAX_ENTRIES,
    ORDER_NO_RE,
    TRACKING_NO_RE,
    BUSY_MESSAGE,
    CARRIERS,
    normalizeText,
    normalizeOrderNo,
    normalizeTrackingNo,
    resolveCarrier,
    normalizeCarrierToken,
    carrierNameMatches,
    unwrapShippingOptionsPayload,
    platformProviderOptions,
    resolvePlatformProvider,
    splitInputLine,
    parseInput,
    parseOrderDetail,
    matchEntries,
    buildShipmentBody,
    interpretShipmentResponse,
    resultsToCsv,
  });
});

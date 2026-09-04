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
  const PURCHASE_SUB_ORDER_RE = /^(.+)-([1-9]\d*)$/;
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

  function parsePurchaseSubOrderNo(value) {
    const purchaseSubOrderNo = normalizeOrderNo(value);
    const match = purchaseSubOrderNo.match(PURCHASE_SUB_ORDER_RE);
    if (!match) {
      return {
        ok: false,
        reason: '采购子单号必须使用“原订单号-序号”，例如 GSH1SAMPLE0001A-1',
      };
    }
    const orderNo = normalizeOrderNo(match[1]);
    const sequence = Number(match[2]);
    if (!ORDER_NO_RE.test(orderNo) || !Number.isSafeInteger(sequence) || sequence <= 0) {
      return {
        ok: false,
        reason: '采购子单号中的原订单号或序号无效',
      };
    }
    return { ok: true, purchaseSubOrderNo, orderNo, sequence };
  }

  function parseSplitInput(input, options = {}) {
    const parsed = parseInput(input, options);
    const errors = [...parsed.errors];
    const entries = [];
    parsed.entries.forEach((entry) => {
      const child = parsePurchaseSubOrderNo(entry.orderNo);
      if (!child.ok) {
        errors.push({
          line: entry.lineNumber,
          code: 'purchase_sub_order_invalid',
          message: `第 ${entry.lineNumber} 行：${child.reason}`,
        });
        return;
      }
      entries.push({
        ...entry,
        purchaseSubOrderNo: child.purchaseSubOrderNo,
        orderNo: child.orderNo,
        purchaseSequence: child.sequence,
      });
    });
    return {
      ...parsed,
      ok: errors.length === 0,
      entries,
      errors,
    };
  }

  function uniqueSearchEntries(entries) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries : []).reduce((result, entry) => {
      const orderNo = normalizeOrderNo(entry?.orderNo);
      if (!ORDER_NO_RE.test(orderNo) || seen.has(orderNo)) return result;
      seen.add(orderNo);
      result.push({ orderNo });
      return result;
    }, []);
  }

  function normalizePackageImageUrl(value, baseUrl = '') {
    const text = String(value == null ? '' : value).trim();
    if (!text || text.length > 2048) return '';
    if (/^\/\//.test(text)) return `https:${text}`;
    if (!/^https?:\/\//i.test(text)) return '';
    try {
      const url = new URL(text, baseUrl || undefined);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_error) {
      return '';
    }
  }

  function firstObjectValue(object, keys) {
    for (const key of keys) {
      const value = object?.[key];
      if (value == null || !['string', 'number'].includes(typeof value)) continue;
      if (normalizeText(value)) return value;
    }
    return '';
  }

  function extractPackageItems(payload) {
    const skuKeys = ['sellerSku', 'sellerSKU', 'sku', 'skuCode', 'productSku', 'itemSku', 'siteSku'];
    const titleKeys = ['productName', 'goodsName', 'itemTitle', 'productTitle', 'title', 'name'];
    const variantKeys = ['variant', 'variation', 'spec', 'specification', 'skuValue', 'variantName', 'productSkuAttr'];
    const imageKeys = ['productImageUrl', 'imageUrl', 'imgUrl', 'picUrl', 'productImg', 'mainImage', 'image'];
    const quantityKeys = ['quantity', 'qty', 'num', 'productCount', 'orderQuantity', 'saleQuantity'];
    const items = [];
    const seenObjects = new Set();
    const seenItems = new Set();

    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 6 || seenObjects.has(value)) return;
      seenObjects.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }

      const sku = normalizeText(firstObjectValue(value, skuKeys));
      const title = normalizeText(firstObjectValue(value, titleKeys));
      const variant = normalizeText(firstObjectValue(value, variantKeys));
      const imageUrl = normalizePackageImageUrl(firstObjectValue(value, imageKeys));
      const rawQuantity = firstObjectValue(value, quantityKeys);
      const quantity = Number(rawQuantity);
      if (sku || imageUrl || (title && (variant || Number.isFinite(quantity)))) {
        const item = {
          sku,
          title,
          variant,
          imageUrl,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
        };
        const key = [item.sku, item.title, item.variant, item.imageUrl, item.quantity || ''].join('|');
        if (!seenItems.has(key)) {
          seenItems.add(key);
          items.push(item);
        }
      }
      Object.values(value).forEach((child) => visit(child, depth + 1));
    };
    visit(payload);
    return items.slice(0, 24);
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
      platform: normalizeText(dxmOrder.platform || dxmOrder.platformName || ''),
      packageItems: extractPackageItems(payload),
    };
  }

  function parseSplitOrderDetail(payload, internalPackageId, expectedOrderNo = '') {
    const dxmOrder = payload && typeof payload === 'object'
      ? (payload.dxmOrder || payload.data?.dxmOrder)
      : null;
    const packageId = String(internalPackageId || '').trim();
    const orderNo = normalizeOrderNo(
      dxmOrder?.orderId || dxmOrder?.orderNo || dxmOrder?.platformOrderId || expectedOrderNo,
    );
    const platform = normalizeText(dxmOrder?.platform || dxmOrder?.platformName || '').toLocaleLowerCase();
    if (!dxmOrder || !INTERNAL_PACKAGE_ID_RE.test(packageId) || !ORDER_NO_RE.test(orderNo)) {
      return { ok: false, reason: '店小秘拆单详情缺少有效订单号或内部包裹 ID' };
    }
    if (expectedOrderNo && orderNo !== normalizeOrderNo(expectedOrderNo)) {
      return { ok: false, reason: `店小秘拆单详情返回了其他订单 ${orderNo}` };
    }
    if (platform !== 'shein') {
      return { ok: false, reason: `当前仅支持 SHEIN 订单拆单，店小秘返回平台“${platform || '未知'}”` };
    }
    const rawProducts = Array.isArray(dxmOrder.productList) ? dxmOrder.productList : [];
    if (rawProducts.length === 0) {
      return { ok: false, reason: '店小秘拆单详情没有返回商品明细' };
    }
    const seenSplitKeys = new Set();
    const products = [];
    for (const [index, product] of rawProducts.entries()) {
      const splitKey = normalizeText(product?.splitKey);
      const productCount = Number(product?.productCount);
      if (!splitKey || splitKey.length > 256 || /[\u0000-\u001F]/.test(splitKey)) {
        return { ok: false, reason: `店小秘拆单详情第 ${index + 1} 个商品缺少有效拆单标识` };
      }
      if (seenSplitKeys.has(splitKey)) {
        return { ok: false, reason: `店小秘拆单详情包含重复拆单标识 ${splitKey}` };
      }
      if (!Number.isSafeInteger(productCount) || productCount <= 0) {
        return { ok: false, reason: `店小秘拆单详情第 ${index + 1} 个商品数量无效` };
      }
      seenSplitKeys.add(splitKey);
      products.push({
        splitKey,
        productCount,
        sku: normalizeText(firstObjectValue(product, [
          'productDisplaySku', 'displaySku', 'sellerSku', 'sellerSKU', 'sku', 'skuCode',
        ])),
        title: normalizeText(firstObjectValue(product, [
          'productName', 'goodsName', 'itemTitle', 'productTitle', 'title', 'name',
        ])),
        variant: normalizeText(firstObjectValue(product, [
          'specification', 'variant', 'variation', 'spec', 'productSkuAttr', 'attr',
        ])),
        imageUrl: normalizePackageImageUrl(firstObjectValue(product, [
          'productImageUrl', 'imageUrl', 'imgUrl', 'picUrl', 'productImg', 'mainImage', 'image',
        ])),
      });
    }
    return {
      ok: true,
      orderNo,
      internalPackageId: packageId,
      platform,
      products,
      totalQuantity: products.reduce((sum, product) => sum + product.productCount, 0),
    };
  }

  function buildBatchSplitPlan(splitDetail, childAllocations) {
    if (!splitDetail?.ok || !INTERNAL_PACKAGE_ID_RE.test(String(splitDetail.internalPackageId || '').trim())) {
      return { ok: false, errors: ['缺少有效的店小秘拆单详情'] };
    }
    const products = Array.isArray(splitDetail.products) ? splitDetail.products : [];
    if (products.length === 0) return { ok: false, errors: ['拆单计划没有可分配商品'] };
    const productByKey = new Map(products.map((product) => [product.splitKey, product]));
    const allocations = Array.isArray(childAllocations) ? childAllocations : [];
    const errors = [];
    const seenChildren = new Set();
    const allocatedByKey = new Map(products.map((product) => [product.splitKey, 0]));
    const childVectors = [];

    allocations.forEach((allocation, index) => {
      const purchaseSubOrderNo = normalizeOrderNo(allocation?.purchaseSubOrderNo);
      const splitKey = normalizeText(allocation?.splitKey);
      const quantity = Number(allocation?.quantity);
      if (!purchaseSubOrderNo) {
        errors.push(`第 ${index + 1} 个采购子单标识为空`);
        return;
      }
      if (seenChildren.has(purchaseSubOrderNo)) {
        errors.push(`采购子单 ${purchaseSubOrderNo} 被重复分配`);
        return;
      }
      if (!productByKey.has(splitKey)) {
        errors.push(`采购子单 ${purchaseSubOrderNo} 尚未选择有效商品`);
        return;
      }
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        errors.push(`采购子单 ${purchaseSubOrderNo} 的发货数量必须是正整数`);
        return;
      }
      seenChildren.add(purchaseSubOrderNo);
      allocatedByKey.set(splitKey, allocatedByKey.get(splitKey) + quantity);
      childVectors.push({
        purchaseSubOrderNo,
        splitKey,
        quantity,
        items: products.map((product) => ({
          sku: product.splitKey,
          num: String(product.splitKey === splitKey ? quantity : 0),
        })),
      });
    });

    products.forEach((product) => {
      const allocated = allocatedByKey.get(product.splitKey) || 0;
      if (allocated > product.productCount) {
        const label = product.sku || product.title || product.splitKey;
        errors.push(`商品 ${label} 仅有 ${product.productCount} 件，本批分配了 ${allocated} 件`);
      }
    });
    if (allocations.length === 0) errors.push('请至少为一个采购子单分配商品');
    if (errors.length) return { ok: false, errors };

    const residualItems = products.map((product) => ({
      sku: product.splitKey,
      num: String(product.productCount - (allocatedByKey.get(product.splitKey) || 0)),
    }));
    const residualTotal = residualItems.reduce((sum, item) => sum + Number(item.num), 0);
    const orderedVectors = residualTotal > 0
      ? [{ kind: 'residual', purchaseSubOrderNo: '', items: residualItems }, ...childVectors]
      : childVectors;
    if (orderedVectors.length < 2) {
      return { ok: false, errors: ['当前分配不会产生两个包裹，无需执行店小秘拆单'] };
    }
    const packageVectors = orderedVectors.map((vector) => vector.items);
    return {
      ok: true,
      orderNo: splitDetail.orderNo,
      packageId: splitDetail.internalPackageId,
      residualTotal,
      orderedVectors,
      packageVectors,
      splitOrderList: JSON.stringify(packageVectors),
    };
  }

  function prepareSplitCandidates(entries, orderRecords) {
    const recordsByOrder = new Map();
    (Array.isArray(orderRecords) ? orderRecords : []).forEach((record) => {
      const orderNo = normalizeOrderNo(record?.orderNo);
      const internalPackageId = String(record?.internalPackageId || '').trim();
      if (!ORDER_NO_RE.test(orderNo) || !INTERNAL_PACKAGE_ID_RE.test(internalPackageId)) return;
      const bucket = recordsByOrder.get(orderNo) || [];
      if (!bucket.some((item) => item.internalPackageId === internalPackageId)) bucket.push(record);
      recordsByOrder.set(orderNo, bucket);
    });

    const entriesByOrder = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const orderNo = normalizeOrderNo(entry?.orderNo);
      const bucket = entriesByOrder.get(orderNo) || [];
      bucket.push(entry);
      entriesByOrder.set(orderNo, bucket);
    });
    const errors = [];
    entriesByOrder.forEach((orderEntries, orderNo) => {
      const records = recordsByOrder.get(orderNo) || [];
      if (records.length === 0) {
        errors.push(`原订单 ${orderNo} 未找到可映射的店小秘包裹`);
      } else if (orderEntries.length > records.length) {
        errors.push(`原订单 ${orderNo} 本批有 ${orderEntries.length} 个采购子单，但店小秘只找到 ${records.length} 个包裹`);
      }
    });
    return {
      ok: errors.length === 0,
      entries: Array.isArray(entries) ? entries : [],
      records: Array.isArray(orderRecords) ? orderRecords : [],
      recordsByOrder,
      errors,
    };
  }

  function packageFirstShipmentBlockReason(record) {
    if (normalizeTrackingNo(record?.currentTrackingNo)) return '店小秘包裹已有物流单号，禁止再次首次发货';
    const status = normalizeText(record?.orderStatus);
    if (/(?:已发货|发货成功|发货失败|已完成|已取消|已退款)/.test(status)) {
      return `店小秘包裹状态为“${status}”，不允许首次发货`;
    }
    return '';
  }

  function assignSplitPackages(entries, orderRecords, assignments) {
    const recordsById = new Map();
    (Array.isArray(orderRecords) ? orderRecords : []).forEach((record) => {
      const id = String(record?.internalPackageId || '').trim();
      if (INTERNAL_PACKAGE_ID_RE.test(id)) recordsById.set(id, record);
    });
    const assignmentMap = assignments instanceof Map
      ? assignments
      : new Map(Object.entries(assignments || {}));
    const usedPackageIds = new Set();
    const matches = [];
    const errors = [];
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const purchaseSubOrderNo = normalizeOrderNo(entry?.purchaseSubOrderNo);
      const assignedId = String(assignmentMap.get(purchaseSubOrderNo) || '').trim();
      if (!assignedId) {
        errors.push(`采购子单 ${purchaseSubOrderNo} 尚未选择店小秘包裹`);
        return;
      }
      const record = recordsById.get(assignedId);
      if (!record) {
        errors.push(`采购子单 ${purchaseSubOrderNo} 选择的店小秘包裹不存在`);
        return;
      }
      if (usedPackageIds.has(assignedId)) {
        errors.push(`店小秘包裹 ${assignedId} 被分配给多个采购子单`);
        return;
      }
      if (normalizeOrderNo(record.orderNo) !== normalizeOrderNo(entry.orderNo)) {
        errors.push(`采购子单 ${purchaseSubOrderNo} 不能映射到其他原订单的店小秘包裹`);
        return;
      }
      const blockReason = packageFirstShipmentBlockReason(record);
      if (blockReason) {
        errors.push(`采购子单 ${purchaseSubOrderNo}：${blockReason}`);
        return;
      }
      usedPackageIds.add(assignedId);
      matches.push({
        ...entry,
        ...record,
        orderNo: normalizeOrderNo(entry.orderNo),
        purchaseSubOrderNo,
        internalPackageId: assignedId,
      });
    });
    return { ok: errors.length === 0, matches, errors };
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
    const headers = ['操作', '采购子单号', '原订单号', '物流单号', '输入物流商', '店小秘平台承运商', '店小秘内部包裹ID', '结果', '说明'];
    const rows = (Array.isArray(results) ? results : []).map((item) => [
      item.operation === 'retry' ? '失败单重提' : (item.operation === 'split' ? '拆单分批发货' : '首次发货'),
      item.purchaseSubOrderNo || '',
      item.orderNo,
      item.trackingNo,
      item.requestedProviderName || item.providerName,
      item.platformProviderName,
      item.internalPackageId,
      item.state === 'submitted'
        ? '已提交，待平台确认'
        : (item.state === 'unknown'
          ? '结果未知'
          : (item.state === 'paused' ? '未提交（已暂停）' : (item.state === 'skipped' ? '已排除' : '失败'))),
      item.message,
    ]);
    return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  return Object.freeze({
    MAX_ENTRIES,
    ORDER_NO_RE,
    TRACKING_NO_RE,
    PURCHASE_SUB_ORDER_RE,
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
    parsePurchaseSubOrderNo,
    parseSplitInput,
    uniqueSearchEntries,
    normalizePackageImageUrl,
    extractPackageItems,
    parseOrderDetail,
    parseSplitOrderDetail,
    buildBatchSplitPlan,
    matchEntries,
    prepareSplitCandidates,
    packageFirstShipmentBlockReason,
    assignSplitPackages,
    buildShipmentBody,
    interpretShipmentResponse,
    resultsToCsv,
  });
});

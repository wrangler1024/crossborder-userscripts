(function exposeLingxingVineCore(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LingxingVineCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLingxingVineCore() {
  'use strict';

  const GATEWAY_ORIGIN = 'https://gw.lingxingerp.com';
  const ORDER_LIST_PATH = '/amz-order/api/order/OrderList';
  const SET_ASSESS_PATH = '/amz-order/api/order/setAssess';
  const VINE_PROMOTION_PREFIX = 'vine.enrollment.';
  const DEFAULT_RANGE_DAYS = 30;
  const MAX_RANGE_DAYS = 90;
  const PAGE_SIZE = 200;
  const MAX_PAGES = 50;
  const WRITE_CHUNK_SIZE = 20;

  const pad = (value) => String(value).padStart(2, '0');

  function clean(value) {
    return String(value ?? '').trim();
  }

  function formatLocalDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dateRange(days = DEFAULT_RANGE_DAYS, now = new Date()) {
    const normalizedDays = Math.min(MAX_RANGE_DAYS, Math.max(1, Number(days) || DEFAULT_RANGE_DAYS));
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (normalizedDays - 1));
    return {
      days: normalizedDays,
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(now),
    };
  }

  function promotionIdsOf(item) {
    if (Array.isArray(item?.promotionIds)) return item.promotionIds.map(clean).filter(Boolean);
    if (typeof item?.promotionIds === 'string') {
      return item.promotionIds.split(/[,|\s]+/).map(clean).filter(Boolean);
    }
    return [];
  }

  function vineItemsOf(order) {
    if (!Array.isArray(order?.slist)) return [];
    return order.slist.filter((item) => promotionIdsOf(item)
      .some((promotionId) => promotionId.startsWith(VINE_PROMOTION_PREFIX)));
  }

  function isVineOrder(order) {
    return vineItemsOf(order).length > 0;
  }

  function assessedValue(value) {
    return Number(value) === 1 ? 1 : 0;
  }

  function orderKey(order) {
    return [
      clean(order?.sid),
      clean(order?.amazonOrderId),
      clean(order?.purchaseDateLocal),
    ].join('|');
  }

  function normalizeOrder(order) {
    const vineItems = vineItemsOf(order);
    if (!vineItems.length) return null;

    const skuValues = [...new Set(vineItems.map((item) => clean(item.sellerSku || item.sku)).filter(Boolean))];
    const asinValues = [...new Set(vineItems.map((item) => clean(item.asin)).filter(Boolean))];
    const promotionIds = [...new Set(vineItems.flatMap(promotionIdsOf))];

    return {
      key: orderKey(order),
      sid: Number(order.sid),
      amazonOrderId: clean(order.amazonOrderId),
      purchaseDateLocal: clean(order.purchaseDateLocal),
      purchaseDate: clean(order.purchaseDate),
      market: clean(order.marketplace),
      store: clean(order.sellerName),
      status: clean(order.orderStatus),
      amount: clean(order.orderTotalAmount),
      sku: skuValues.join(' / '),
      asin: asinValues.join(' / '),
      productName: clean(vineItems[0]?.title || vineItems[0]?.productName),
      promotionIds,
      isAssessed: assessedValue(order.isAssessed),
      isPromotion: assessedValue(order.isPromotion),
      fulfillmentChannel: clean(order.fulfillmentChannel),
      lastUpdateDate: clean(order.lastUpdateDate),
    };
  }

  function classifyOrders(rows) {
    const seen = new Set();
    const vineOrders = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isVineOrder(row)) continue;
      const normalized = normalizeOrder(row);
      if (!normalized || !normalized.amazonOrderId || seen.has(normalized.key)) continue;
      seen.add(normalized.key);
      vineOrders.push(normalized);
    }

    const pendingOrders = vineOrders.filter((order) => order.isAssessed !== 1);
    return {
      vineOrders,
      pendingOrders,
      assessedOrders: vineOrders.filter((order) => order.isAssessed === 1),
      summary: {
        vineCount: vineOrders.length,
        assessedCount: vineOrders.length - pendingOrders.length,
        pendingCount: pendingOrders.length,
      },
    };
  }

  function buildOrderListPayload({ startDate, endDate, pageNo = 1, pageSize = PAGE_SIZE }) {
    return {
      startDate: clean(startDate),
      endDate: clean(endDate),
      sortField: 'purchaseDateLocal',
      sortType: 'desc',
      searchField: 'amazonOrderId',
      searchValue: '',
      exactSearch: 0,
      fulfillmentChannel: '',
      pageNo: Number(pageNo),
      pageSize: Number(pageSize),
      isMcfOrder: '0',
      req_time_sequence: String(pageNo),
    };
  }

  function extractOrderPage(response) {
    const data = response?.data;
    if (!response || response.code !== 1 || response.success === false) {
      throw new Error(clean(response?.msg || response?.message || '领星订单查询失败'));
    }
    if (!data || !Array.isArray(data.data)) {
      throw new Error('领星订单列表返回格式变化，已停止');
    }
    return {
      rows: data.data,
      total: Number(data.total) || 0,
      totalPages: Number(data.totalPages) || 0,
      pageNo: Number(data.pageNo) || 1,
      pageSize: Number(data.pageSize) || PAGE_SIZE,
      isLast: Boolean(data.isLast),
    };
  }

  function buildAssessPayload(orders) {
    if (!Array.isArray(orders) || !orders.length) throw new Error('本批没有可提交订单');
    if (orders.length > WRITE_CHUNK_SIZE) throw new Error(`单批最多 ${WRITE_CHUNK_SIZE} 笔，请拆分提交`);
    return orders.map((order) => {
      const sid = Number(order?.sid);
      const amazonOrderId = clean(order?.amazonOrderId);
      const purchaseDateLocal = clean(order?.purchaseDateLocal);
      if (!Number.isFinite(sid) || sid <= 0 || !amazonOrderId || !purchaseDateLocal) {
        throw new Error('订单缺少 sid、订单号或本地下单时间，已停止');
      }
      return { sid, amazonOrderId, purchaseDateLocal };
    });
  }

  function chunkOrders(orders, size = WRITE_CHUNK_SIZE) {
    const chunks = [];
    for (let index = 0; index < orders.length; index += size) {
      chunks.push(orders.slice(index, index + size));
    }
    return chunks;
  }

  function fingerprintOrders(orders) {
    return orders
      .map((order) => `${orderKey(order)}|${clean(order.sku)}|${clean(order.asin)}`)
      .sort()
      .join('\n');
  }

  function preflightSelection(snapshot, latestPending) {
    const expectedKeys = new Set((snapshot || []).map(orderKey));
    const latestKeys = new Set((latestPending || []).map(orderKey));
    const missing = [...expectedKeys].filter((key) => !latestKeys.has(key));
    const added = [...latestKeys].filter((key) => !expectedKeys.has(key));
    return {
      ok: expectedKeys.size > 0 && missing.length === 0,
      missing,
      added,
      expectedCount: expectedKeys.size,
      latestCount: latestKeys.size,
    };
  }

  function evaluateReadback(batch, latestVineOrders) {
    const byKey = new Map((latestVineOrders || []).map((order) => [orderKey(order), order]));
    return (batch || []).map((order) => {
      const latest = byKey.get(orderKey(order));
      if (!latest) {
        return { ...order, readback: 'missing', message: '回读未找到该订单' };
      }
      if (latest.isAssessed === 1) {
        return { ...order, readback: 'passed', message: 'isAssessed = 1' };
      }
      return { ...order, readback: 'pending', message: '仍为待标注，请人工核实' };
    });
  }

  function promotionTypeDefault() {
    return { promotionId: 0, typeName: '默认' };
  }

  function csvCell(value) {
    return `"${clean(value).replaceAll('"', '""')}"`;
  }

  function toCsv(rows) {
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function previewCsv(orders, generatedAt = new Date()) {
    return toCsv([
      ['生成时间', '市场', '店铺', '订单号', '订单状态', '金额', 'SKU', 'ASIN', '识别结果', '拟用推广类型'],
      ...(orders || []).map((order) => [
        generatedAt.toLocaleString('zh-CN', { hour12: false }),
        order.market,
        order.store,
        order.amazonOrderId,
        order.status,
        order.amount,
        order.sku,
        order.asin,
        'Vine 待标',
        '默认',
      ]),
    ]);
  }

  function executionCsv(execution) {
    const submitLabels = {
      accepted: '领星已受理',
      unknown: '结果待核实',
      'not-submitted': '未提交',
      pending: '待提交',
    };
    const readbackLabels = {
      passed: '核验通过',
      pending: '仍待标',
      missing: '回读未找到',
      unverified: '未回读',
    };
    return toCsv([
      ['批次号', '执行时间', '市场', '店铺', '订单号', '下单时间', '金额', '提交结果', '回读结果', '推广类型'],
      ...(execution?.items || []).map((item) => [
        execution.batchId,
        execution.startedAt,
        item.market,
        item.store,
        item.amazonOrderId,
        item.purchaseDateLocal,
        item.amount,
        submitLabels[item.submitResult] || '结果待核实',
        readbackLabels[item.readback] || '未回读',
        '默认',
      ]),
    ]);
  }

  function isOrderListUrl(value) {
    try {
      const url = new URL(value, 'https://erp.lingxing.com');
      return url.origin === 'https://erp.lingxing.com' && /^\/erp\/orderList\/?$/.test(url.pathname);
    } catch (_error) {
      return false;
    }
  }

  function uniqueMarkets(orders) {
    return [...new Set((orders || []).map((order) => clean(order.market)).filter(Boolean))].sort();
  }

  return {
    GATEWAY_ORIGIN,
    ORDER_LIST_PATH,
    SET_ASSESS_PATH,
    VINE_PROMOTION_PREFIX,
    DEFAULT_RANGE_DAYS,
    MAX_RANGE_DAYS,
    PAGE_SIZE,
    MAX_PAGES,
    WRITE_CHUNK_SIZE,
    dateRange,
    promotionIdsOf,
    vineItemsOf,
    isVineOrder,
    orderKey,
    normalizeOrder,
    classifyOrders,
    buildOrderListPayload,
    extractOrderPage,
    buildAssessPayload,
    chunkOrders,
    fingerprintOrders,
    preflightSelection,
    evaluateReadback,
    promotionTypeDefault,
    toCsv,
    previewCsv,
    executionCsv,
    isOrderListUrl,
    uniqueMarkets,
  };
});

(function initXynigoPurchaseCore(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.XynigoPurchaseCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCore() {
  'use strict';

  const SHEIN_HOST_RE = /(^|\.)shein\.com(?:\.[a-z]{2})?$/i;
  const PACKAGE_ID_RE = /\bXMWU[A-Z0-9_-]+\b/i;
  const PLATFORM_ORDER_RE = /\bG(?:SH|SU)[A-Z0-9_-]+\b/i;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parsePreciseLink(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return { ok: false, reason: '请填写采购链接' };
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_error) {
      return { ok: false, reason: '采购链接格式不正确' };
    }

    if (!SHEIN_HOST_RE.test(parsed.hostname)) {
      return { ok: false, reason: '必须填写 SHEIN 站点链接' };
    }

    const goodsId = parsed.searchParams.get('goods_id') || '';
    const skuCode = parsed.searchParams.get('skucode') || '';
    const mainAttr = parsed.searchParams.get('main_attr') || '';
    const mallCode = parsed.searchParams.get('mallCode') || '';
    const metadata = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const metadataVersion = metadata.get('xv') || '';
    const hasMetadata = metadataVersion === '1';
    const mainSpec = hasMetadata ? normalizeText(metadata.get('p')) : '';
    const subSpec = hasMetadata ? normalizeText(metadata.get('s')) : '';
    const guidePrice = hasMetadata ? normalizeText(metadata.get('gp')) : '';
    const purchaseCurrency = hasMetadata ? normalizeText(metadata.get('c')).toUpperCase() : '';

    if (!goodsId || !skuCode) {
      return { ok: false, reason: '精准链接缺少 goods_id 或 skucode' };
    }

    if (!hasMetadata) parsed.hash = '';
    const warnings = [];
    if (!mainAttr) warnings.push('链接未包含 main_attr，请确认型号');
    if (hasMetadata && !mainSpec) warnings.push('一行采购链接未包含主规格 p');
    return {
      ok: true,
      url: parsed.toString(),
      hostname: parsed.hostname.toLowerCase(),
      goodsId,
      skuCode,
      mainAttr,
      mallCode,
      hasMetadata,
      metadataVersion,
      mainSpec,
      subSpec,
      guidePrice,
      purchaseCurrency,
      warning: warnings.join('；'),
    };
  }

  function extractOrderIdentity(text) {
    const normalized = normalizeText(text);
    const packageId = normalized.match(PACKAGE_ID_RE)?.[0]?.toUpperCase() || '';
    const platformOrderNo = normalized.match(PLATFORM_ORDER_RE)?.[0]?.toUpperCase() || '';
    return { packageId, platformOrderNo };
  }

  function parseMoney(text) {
    const normalized = normalizeText(text);
    const match = normalized.match(/\b(USD|MXN|CNY|RMB)\s*([\d,]+(?:\.\d+)?)/i);
    if (!match) {
      return { currency: '', amount: null };
    }
    return {
      currency: match[1].toUpperCase() === 'RMB' ? 'CNY' : match[1].toUpperCase(),
      amount: Number(match[2].replace(/,/g, '')),
    };
  }

  function inferVariantSpecs(variant) {
    const normalized = normalizeText(variant);
    if (!normalized) return { mainSpec: '', subSpec: '' };
    if (normalized.includes(' / ')) {
      const parts = normalized.split(' / ');
      return { mainSpec: parts.shift() || '', subSpec: parts.join(' / ') };
    }
    const hyphenIndex = normalized.indexOf('-');
    if (hyphenIndex > 0 && hyphenIndex < normalized.length - 1) {
      return {
        mainSpec: normalizeText(normalized.slice(0, hyphenIndex)),
        subSpec: normalizeText(normalized.slice(hyphenIndex + 1)),
      };
    }
    return { mainSpec: normalized, subSpec: '' };
  }

  function extractSourceGoodsId(sellerSku) {
    return normalizeText(sellerSku).match(/(?:^|\D)(\d{8,9})(?!\d)/)?.[1] || '';
  }

  function extractProductSku(rowText, cellTexts) {
    const cells = Array.isArray(cellTexts) ? cellTexts.map(normalizeText).filter(Boolean) : [];
    const normalizedRow = normalizeText(rowText);
    const sources = [...cells, normalizedRow].filter(Boolean);
    const candidates = [];
    const seen = new Set();

    function isOrderIdentity(value) {
      const normalized = normalizeText(value).toUpperCase();
      return PACKAGE_ID_RE.test(normalized) || PLATFORM_ORDER_RE.test(normalized);
    }

    function addCandidate(sellerSku, salesQty, score, sourceIndex) {
      const normalizedSku = normalizeText(sellerSku).replace(/^[,;:|、，；：]+|[,;:|、，；：]+$/g, '');
      if (!normalizedSku || isOrderIdentity(normalizedSku)) return;
      const key = `${normalizedSku.toUpperCase()}|${salesQty}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        sellerSku: normalizedSku,
        salesQty: Number(salesQty) || 1,
        score: score + (extractSourceGoodsId(normalizedSku) ? 100 : 0) + (sourceIndex < cells.length ? 5 : 0),
      });
    }

    sources.forEach((source, sourceIndex) => {
      const quantityMatches = source.matchAll(/([A-Za-z0-9][A-Za-z0-9_*.-]{3,})\s*[x×]\s*(\d+)/gi);
      for (const match of quantityMatches) addCandidate(match[1], match[2], 20, sourceIndex);

      const sourceQuantity = Number(source.match(/[x×]\s*(\d+)/i)?.[1]) || 1;
      const goodsSkuMatches = source.matchAll(/[A-Za-z0-9_*.-]*\d{8,9}[A-Za-z0-9_*.-]*/g);
      for (const match of goodsSkuMatches) {
        if (extractSourceGoodsId(match[0])) addCandidate(match[0], sourceQuantity, 10, sourceIndex);
      }
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || { sellerSku: '', salesQty: 1, score: 0 };
  }

  function resolveSheinMarket(order) {
    const marketText = normalizeText([
      order?.country,
      order?.market,
      order?.site,
      order?.storeName,
    ].filter(Boolean).join(' '));
    if (/(墨西哥|m[eé]xico|\bmx\b)/i.test(marketText)) return 'MX';
    if (/(美国|美区|united states|\busa?\b)/i.test(marketText)) return 'US';
    const currency = normalizeText(order?.salesCurrency).toUpperCase();
    if (currency === 'USD') return 'US';
    if (currency === 'MXN') return 'MX';
    return 'MX';
  }

  function buildSourceProductUrl(goodsId, order) {
    const normalizedGoodsId = normalizeText(goodsId);
    if (!/^\d{8,9}$/.test(normalizedGoodsId)) return '';
    const hostname = resolveSheinMarket(order) === 'US' ? 'us.shein.com' : 'www.shein.com.mx';
    return `https://${hostname}/x-p-${normalizedGoodsId}.html`;
  }

  function calculateEstimatedProfit(order, guideTotalsByCurrency) {
    const salesCurrency = normalizeText(order?.salesCurrency).toUpperCase();
    const salesAmount = Number(order?.salesAmount);
    if (!salesCurrency || !Number.isFinite(salesAmount) || salesAmount <= 0) {
      return { ok: false, reason: '包裹总金额或销售币种未识别' };
    }
    const totals = Object.entries(guideTotalsByCurrency || {})
      .map(([currency, amount]) => [normalizeText(currency).toUpperCase(), Number(amount)])
      .filter(([, amount]) => Number.isFinite(amount) && amount > 0);
    if (!totals.length) return { ok: false, reason: '指导采购总额待填写' };
    if (totals.length !== 1 || totals[0][0] !== salesCurrency) {
      return { ok: false, reason: '采购与销售币种不一致，待汇率换算' };
    }
    const guideTotal = totals[0][1];
    const minimumApplied = resolveSheinMarket(order) === 'MX'
      && salesCurrency === 'MXN'
      && guideTotal < 100;
    const estimatedCost = minimumApplied ? 100 : guideTotal;
    const estimatedTopUpAmount = minimumApplied ? 100 - guideTotal : 0;
    const estimatedProfit = salesAmount - estimatedCost;
    const profitMargin = (estimatedProfit / salesAmount) * 100;
    const roi = (estimatedProfit / estimatedCost) * 100;
    return {
      ok: true,
      currency: salesCurrency,
      salesAmount: Number(salesAmount.toFixed(2)),
      guideTotal: Number(guideTotal.toFixed(2)),
      estimatedTopUpAmount: Number(estimatedTopUpAmount.toFixed(2)),
      estimatedCost: Number(estimatedCost.toFixed(2)),
      estimatedProfit: Number(estimatedProfit.toFixed(2)),
      profitMargin: Number(profitMargin.toFixed(2)),
      roi: Number(roi.toFixed(2)),
      minimumApplied,
      costBasis: minimumApplied ? 'mexico-free-shipping-top-up-estimate' : 'guide-purchase-total',
    };
  }

  function createOrderKey(input) {
    const store = normalizeText(input?.storeName || 'unknown-store').toLowerCase();
    const platformOrderNo = normalizeText(input?.platformOrderNo || 'unknown-order').toUpperCase();
    const packageId = normalizeText(input?.packageId || 'unknown-package').toUpperCase();
    return [store, platformOrderNo, packageId].join('|');
  }

  function buildRemark(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => parsePreciseLink(item?.purchaseLink))
      .filter((result) => result.ok)
      .map((result) => result.url)
      .join('\n');
  }

  function validatePurchaseItem(item) {
    const parsedLink = parsePreciseLink(item?.purchaseLink);
    const purchaseQty = Number(item?.purchaseQty);
    const salesQty = Number(item?.salesQty);

    if (!parsedLink.ok) {
      return { ok: false, reason: parsedLink.reason, parsedLink };
    }
    if (!Number.isInteger(purchaseQty) || purchaseQty <= 0) {
      return { ok: false, reason: '采购数量必须是正整数', parsedLink };
    }
    if (Number.isInteger(salesQty) && salesQty > 0 && purchaseQty !== salesQty) {
      return { ok: false, reason: `采购数量需与销售数量 ${salesQty} 一致`, parsedLink };
    }
    if (Object.prototype.hasOwnProperty.call(item || {}, 'guidePrice')) {
      const guidePrice = Number(item.guidePrice);
      if (!Number.isFinite(guidePrice) || guidePrice <= 0) {
        return { ok: false, reason: '指导价必须大于 0', parsedLink };
      }
    }
    return { ok: true, reason: '', parsedLink };
  }

  function createPurchaseRecord(order, items, nowIso) {
    const safeItems = items.map((item, index) => {
      const validation = validatePurchaseItem(item);
      if (!validation.ok) {
        throw new Error(`第 ${index + 1} 条采购明细：${validation.reason}`);
      }
      return {
        lineNo: index + 1,
        sellerSku: normalizeText(item.sellerSku || `手工明细${index + 1}`),
        variant: normalizeText(item.variant),
        mainSpec: normalizeText(item.mainSpec),
        subSpec: normalizeText(item.subSpec),
        guidePrice: Number.isFinite(Number(item.guidePrice)) ? Number(item.guidePrice) : null,
        purchaseCurrency: normalizeText(item.purchaseCurrency).toUpperCase(),
        salesQty: Number(item.salesQty) || Number(item.purchaseQty),
        purchaseQty: Number(item.purchaseQty),
        source: normalizeText(item.source),
        purchaseLink: validation.parsedLink.url,
        goodsId: validation.parsedLink.goodsId,
        skuCode: validation.parsedLink.skuCode,
        mainAttr: validation.parsedLink.mainAttr,
        mallCode: validation.parsedLink.mallCode,
      };
    });

    const guideTotalsByCurrency = safeItems.reduce((totals, item) => {
      if (!item.purchaseCurrency || !Number.isFinite(item.guidePrice)) return totals;
      totals[item.purchaseCurrency] = Number(((totals[item.purchaseCurrency] || 0)
        + (item.guidePrice * item.purchaseQty)).toFixed(2));
      return totals;
    }, {});
    const estimatedMetrics = calculateEstimatedProfit(order, guideTotalsByCurrency);
    const orderKey = createOrderKey(order);
    return {
      schemaVersion: 1,
      mode: 'local-dev-mock',
      orderKey,
      packageId: normalizeText(order.packageId).toUpperCase(),
      platformOrderNo: normalizeText(order.platformOrderNo).toUpperCase(),
      storeName: normalizeText(order.storeName),
      salesCurrency: normalizeText(order.salesCurrency).toUpperCase(),
      salesAmount: Number.isFinite(Number(order.salesAmount)) ? Number(order.salesAmount) : null,
      items: safeItems,
      guideTotalsByCurrency,
      estimatedMetrics,
      remarkText: buildRemark(safeItems),
      remarkStatus: 'clipboard',
      purchaseStatus: 'recorded-local',
      createdAt: nowIso || new Date().toISOString(),
      updatedAt: nowIso || new Date().toISOString(),
    };
  }

  return {
    SHEIN_HOST_RE,
    normalizeText,
    parsePreciseLink,
    extractOrderIdentity,
    parseMoney,
    inferVariantSpecs,
    extractSourceGoodsId,
    extractProductSku,
    resolveSheinMarket,
    buildSourceProductUrl,
    calculateEstimatedProfit,
    createOrderKey,
    buildRemark,
    validatePurchaseItem,
    createPurchaseRecord,
  };
});

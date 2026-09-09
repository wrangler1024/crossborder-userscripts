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
  const PRODUCT_IMAGE_HOST_RE = /(^|\.)ltwebstatic\.com$/i;
  const PACKAGE_ID_RE = /\bXMWU[A-Z0-9_-]+\b/i;
  const PLATFORM_ORDER_RE = /\bG(?:SH|SU)[A-Z0-9_-]+\b/i;
  const XYP2_OPEN_MARKER = '[XYP2]';
  const XYP2_CLOSE_MARKER = '[/XYP2]';
  const XYP2_EXPORT_SAFE_LIMIT = 900;
  const SYSTEM_ORDER_KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const FNV_OFFSET_64 = 0xCBF29CE484222325n;
  const FNV_PRIME_64 = 0x100000001B3n;
  const FNV_SECOND_SEED = FNV_OFFSET_64 ^ 0x9E3779B97F4A7C15n;
  const MASK_64 = (1n << 64n) - 1n;
  const XYP2_SITE_HOSTS = Object.freeze({
    mx: 'www.shein.com.mx',
    us: 'us.shein.com',
  });

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseStoreAssignment(value) {
    const storeName = normalizeText(value);
    const matched = storeName.match(/^(.+)\s*-\s*([^-（）()]+?)\s*[（(][^（）()]*[）)]\s*[$¥￥]?\s*$/u);
    if (!matched) {
      return { storeName, storeBaseName: storeName, operatorName: '', matched: false };
    }
    return {
      storeName,
      storeBaseName: normalizeText(matched[1]),
      operatorName: normalizeText(matched[2]),
      matched: true,
    };
  }

  function normalizeProductImageUrl(value, baseUrl) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, baseUrl || undefined);
      if (parsed.protocol !== 'https:' || !PRODUCT_IMAGE_HOST_RE.test(parsed.hostname)) return '';
      return parsed.toString();
    } catch (_error) {
      return '';
    }
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
    const originalPrice = hasMetadata ? normalizeText(metadata.get('op')) : '';
    const couponRateText = hasMetadata ? normalizeText(metadata.get('cr')) : '';
    const couponRate = couponRateText !== '' && Number.isFinite(Number(couponRateText))
      ? Number(couponRateText)
      : null;
    const couponType = couponRate === null
      ? ''
      : (couponRate > 0 ? `${Math.round(couponRate * 100)}% 优惠券` : '无优惠券');
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
      originalPrice,
      couponRate,
      couponType,
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
    const sku = normalizeText(sellerSku);
    if (PACKAGE_ID_RE.test(sku) || PLATFORM_ORDER_RE.test(sku)) return '';
    return sku.match(/(?:^|\D)(\d{7,9})(?!\d)/)?.[1] || '';
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
        score: score + (extractSourceGoodsId(normalizedSku) ? 100 : 0)
          + (/^YDB--\d{7,9}(?:-|$)/i.test(normalizedSku) ? 30 : 0)
          + (sourceIndex < cells.length ? 5 : 0),
      });
    }

    sources.forEach((source, sourceIndex) => {
      // An ASCII x inside a platform SKU is not a quantity separator.
      const quantityMatches = source.matchAll(/([A-Za-z0-9][A-Za-z0-9_*.-]{3,})(?:\s+x\s*|\s*×\s*)(\d+)(?![\dA-Za-z])/gi);
      for (const match of quantityMatches) addCandidate(match[1], match[2], 20, sourceIndex);

      const quantityMatch = source.match(/(?:^|\s)x\s*(\d+)(?![\dA-Za-z])|×\s*(\d+)(?![\dA-Za-z])/i);
      const sourceQuantity = Number(quantityMatch?.[1] || quantityMatch?.[2]) || 1;
      const goodsSkuMatches = source.matchAll(/[A-Za-z0-9_*.-]*\d{7,9}[A-Za-z0-9_*.-]*/g);
      for (const match of goodsSkuMatches) {
        if (extractSourceGoodsId(match[0])) addCandidate(match[0], sourceQuantity, 10, sourceIndex);
      }
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || { sellerSku: '', salesQty: 1, score: 0 };
  }

  function extractProductRows(rows) {
    const productsByKey = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const rowText = normalizeText(row?.rowText);
      const cellTexts = Array.isArray(row?.cellTexts)
        ? row.cellTexts.map(normalizeText)
        : [];
      const match = extractProductSku(rowText, cellTexts);
      if (!match.sellerSku) return;

      const matchingProductCells = cellTexts.map((cellText, index) => ({
        cellText,
        index,
        match: extractProductSku(cellText, [cellText]),
      })).filter((candidate) => (
        candidate.match.sellerSku
        && candidate.match.sellerSku.toUpperCase() === match.sellerSku.toUpperCase()
      ));
      matchingProductCells.sort((a, b) => b.match.score - a.match.score || a.index - b.index);
      const productCell = matchingProductCells[0];
      const productCellText = productCell?.cellText || rowText;
      if (row?.cancelled === true
        || row?.cancelledCellIndexes?.includes(productCell?.index)
        || /[x×]\s*\d+\s*已取消(?:\s|$)/i.test(productCellText)) return;
      const fullWidthColon = Math.max(productCellText.lastIndexOf('：'), productCellText.lastIndexOf(':'));
      const variant = fullWidthColon >= 0
        ? normalizeText(productCellText.slice(fullWidthColon + 1))
        : '';
      const salesMatch = productCellText.match(/([A-Za-z0-9][A-Za-z0-9_*.-]{3,})(?:\s+x\s*|\s*×\s*)(\d+)(?![\dA-Za-z])/i);
      const salesSku = salesMatch ? salesMatch[1] : '';
      const key = `${(salesSku || match.sellerSku).toUpperCase()}|${variant.toUpperCase()}`;
      const quantity = Number(match.salesQty) || 1;
      const existing = productsByKey.get(key);

      if (existing) {
        existing.salesQty += quantity;
        existing.purchaseQty += quantity;
        if (!existing.productImageUrl) {
          existing.productImageUrl = normalizeProductImageUrl(row?.productImageUrl);
        }
        return;
      }

      const specs = inferVariantSpecs(variant);
      productsByKey.set(key, {
        sellerSku: match.sellerSku,
        salesSku,
        variant,
        productImageUrl: normalizeProductImageUrl(row?.productImageUrl),
        mainSpec: specs.mainSpec,
        subSpec: specs.subSpec,
        guidePrice: '',
        salesQty: quantity,
        purchaseQty: quantity,
        purchaseLink: '',
        source: 'page-parser',
      });
    });

    return Array.from(productsByKey.values());
  }

  function salesVariantKey(value) {
    return normalizeText(value).normalize('NFKC').replace(/[‐‑–—]/g, '-')
      .split('-').map((part) => normalizeText(part)).join('-').toUpperCase();
  }

  function createSalesSourceKey(sku, variant) {
    if (!normalizeText(sku)) return '';
    return createSystemOrderKey({ storeName: normalizeText(sku).normalize('NFKC'),
      platformOrderNo: salesVariantKey(variant), packageId: 'sales-line-v1' }).replace(/^OK1-/, 'SL1-');
  }

  function createSalesScopeKey(order) {
    return createSystemOrderKey({ storeName: 'sales-scope-v1', platformOrderNo: order?.platformOrderNo, packageId: order?.packageId });
  }

  function attachSalesSources(products, order) {
    const orderKey = createSalesScopeKey(order);
    return products.map((product) => ({ ...product, sourceRef: {
      v: 1, mode: product.salesSku ? 'linked' : 'unconfirmed', orderKey,
      key: createSalesSourceKey(product.salesSku, product.variant),
      sku: product.salesSku || '', variant: product.variant || '', quantity: product.salesQty,
    }, sourceAmountOwner: !!product.salesSku }));
  }

  function normalizeSourceOwners(items) {
    const groups = new Map();
    items.forEach((item) => {
      if (item.sourceRef?.mode !== 'linked') { item.sourceAmountOwner = false; return; }
      const key = `${item.sourceRef.orderKey}|${item.sourceRef.key}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    groups.forEach((group) => {
      const owner = group.find((item) => item.sourceAmountOwner) || group[0];
      group.forEach((item) => { item.sourceAmountOwner = item === owner; });
    });
    return items;
  }

  function setSalesSource(items, item, product, order, mode = 'linked') {
    const keepOwner = product && item.sourceRef?.key === product.sourceRef.key
      && item.sourceRef?.orderKey === product.sourceRef.orderKey && item.sourceAmountOwner;
    item.sourceRef = product ? { ...product.sourceRef } : {
      v: 1, mode, orderKey: createSalesScopeKey(order), key: '', sku: '', variant: '', quantity: 0,
    };
    item.sourceAmountOwner = !!keepOwner;
    item.productImageUrl = product?.productImageUrl || '';
    if (product) {
      item.variant = product.variant;
      item.salesQty = product.salesQty;
    } else if (mode === 'extra') {
      item.variant = '额外采购';
      item.salesQty = 1;
    }
    normalizeSourceOwners(items);
  }

  function reconcilePurchaseItems(liveProducts, savedItems, { submitted = false } = {}) {
    const live = Array.isArray(liveProducts) ? liveProducts : [];
    const saved = Array.isArray(savedItems) ? savedItems : [];
    if (live.some((item) => item.sourceRef)) {
      if (!saved.length) return { items: normalizeSourceOwners(live.map((item) => ({ ...item, sourceRef: { ...item.sourceRef } }))), changed: false };
      const used = new Set();
      let changed = false;
      const result = saved.map((previous) => {
        const copy = { ...previous, sourceRef: previous.sourceRef ? { ...previous.sourceRef } : null };
        if (copy.sourceRef?.mode === 'extra' && copy.sourceRef.orderKey === live[0].sourceRef.orderKey) return copy;
        let candidates = copy.sourceRef ? live.filter((p) => p.sourceRef.key
          && p.sourceRef.key === copy.sourceRef.key && p.sourceRef.orderKey === copy.sourceRef.orderKey) : [];
        if (!copy.sourceRef && previous.source !== 'manual-added') {
          candidates = live.filter((p) => normalizeText(p.sellerSku).toUpperCase() === normalizeText(previous.sellerSku).toUpperCase()
            && salesVariantKey(p.variant) === salesVariantKey(previous.variant));
          if (!candidates.length) candidates = live.filter((p) => extractSourceGoodsId(p.sellerSku)
            && extractSourceGoodsId(p.sellerSku) === extractSourceGoodsId(previous.sellerSku)
            && salesVariantKey(p.variant) === salesVariantKey(previous.variant));
        }
        const product = candidates.length === 1 ? candidates[0] : null;
        if (product) {
          used.add(product.sourceRef.key);
          const needsReview = copy.sourceRef?.mode === 'unconfirmed'
            || (copy.sourceRef && copy.sourceRef.quantity !== product.sourceRef.quantity);
          if (!copy.sourceRef && !submitted && Number(previous.salesQty) > 0
              && Number(previous.purchaseQty) === Number(previous.salesQty)) copy.purchaseQty = product.salesQty;
          copy.sourceRef = { ...product.sourceRef, mode: needsReview ? 'unconfirmed' : 'linked' };
          copy.productImageUrl = product.productImageUrl || '';
          copy.salesQty = product.salesQty;
          copy.variant = product.variant;
          if (previous.source !== 'manual-added') copy.sellerSku = product.sellerSku;
          changed ||= !previous.sourceRef || needsReview;
        } else {
          copy.sourceRef = { ...(copy.sourceRef || live[0].sourceRef), mode: 'unconfirmed',
            key: copy.sourceRef?.key || '', sku: copy.sourceRef?.sku || '', variant: copy.sourceRef?.variant || '',
            quantity: copy.sourceRef?.quantity || 0 };
          changed = true;
        }
        return copy;
      });
      // An unresolved old detail may belong to an uncovered source. Preserve
      // it for explicit selection instead of manufacturing duplicate purchases.
      if (!result.some((item) => item.sourceRef.mode === 'unconfirmed')) {
        result.push(...live.filter((p) => !used.has(p.sourceRef.key)).map((p) => ({ ...p, sourceRef: { ...p.sourceRef } })));
      }
      return { items: normalizeSourceOwners(result), changed };
    }
    const copy = (items) => items.map((item) => ({ ...item }));
    if (!saved.length) return { items: copy(live), changed: false };
    // A failed page parse cannot establish a new sales baseline.
    if (live.some((item) => item.source === 'manual-fallback')) {
      return { items: copy(saved), changed: false };
    }
    const isManual = (item) => item.source === 'manual-added' || /^\s*手工明细/.test(item.sellerSku || '');
    const key = (item) => `${normalizeText(item.sellerSku).toUpperCase()}|${normalizeText(item.variant).toUpperCase()}`;
    const sourceKey = (item) => {
      const id = extractSourceGoodsId(item.sellerSku);
      return id ? `${id}|${normalizeText(item.variant).toUpperCase()}` : '';
    };
    const used = new Set();
    let changed = false;
    const items = live.map((product) => {
      let candidates = saved.filter((item) => !isManual(item) && key(item) === key(product));
      if (!candidates.length && sourceKey(product)) {
        const source = sourceKey(product);
        if (live.filter((item) => sourceKey(item) === source).length === 1) {
          candidates = saved.filter((item) => !isManual(item) && sourceKey(item) === source);
        }
      }
      const previous = candidates.length === 1 && !used.has(candidates[0]) ? candidates[0] : null;
      if (!previous) {
        changed = true;
        return { ...product };
      }
      used.add(previous);
      const purchaseQty = !submitted && Number(previous.salesQty) > 0
        && Number(previous.purchaseQty) === Number(previous.salesQty)
        ? product.salesQty : previous.purchaseQty;
      changed ||= key(previous) !== key(product) || Number(previous.salesQty) !== product.salesQty
        || Number(previous.purchaseQty) !== Number(purchaseQty);
      return {
        ...previous,
        sellerSku: product.sellerSku,
        variant: product.variant,
        salesQty: product.salesQty,
        purchaseQty,
        source: product.source,
        productImageUrl: normalizeProductImageUrl(previous.productImageUrl) || product.productImageUrl || '',
      };
    });
    // Manual additions are deliberately independent of the sales product list.
    items.push(...copy(saved.filter(isManual)));
    changed ||= saved.some((item) => !isManual(item) && !used.has(item));
    return { items, changed };
  }

  function resolveOrderSite(order) {
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
    return '';
  }

  function resolveSheinMarket(order) {
    return resolveOrderSite(order) || 'MX';
  }

  function buildSourceProductUrl(goodsId, order) {
    const normalizedGoodsId = normalizeText(goodsId);
    if (!/^\d{7,9}$/.test(normalizedGoodsId)) return '';
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

  function fnv1a64(bytes, seed) {
    let value = seed;
    bytes.forEach((byte) => {
      value ^= BigInt(byte);
      value = (value * FNV_PRIME_64) & MASK_64;
    });
    return value;
  }

  function uint64Bytes(value) {
    const output = new Uint8Array(8);
    let remaining = value;
    for (let index = 7; index >= 0; index -= 1) {
      output[index] = Number(remaining & 0xFFn);
      remaining >>= 8n;
    }
    return output;
  }

  function crockfordBase32(bytes) {
    let output = '';
    let buffer = 0n;
    let bits = 0;
    bytes.forEach((byte) => {
      buffer = (buffer << 8n) | BigInt(byte);
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        output += SYSTEM_ORDER_KEY_ALPHABET[Number((buffer >> BigInt(bits)) & 31n)];
      }
    });
    if (bits) {
      output += SYSTEM_ORDER_KEY_ALPHABET[Number((buffer << BigInt(5 - bits)) & 31n)];
    }
    return output;
  }

  function createSystemOrderKey(input) {
    const identity = [
      normalizeText(input?.storeName).toLowerCase(),
      normalizeText(input?.platformOrderNo).toUpperCase(),
      normalizeText(input?.packageId).toUpperCase(),
    ].join('\x1f');
    const raw = new TextEncoder().encode(identity);
    const reverse = Uint8Array.from(raw).reverse();
    const forwardHash = uint64Bytes(fnv1a64(raw, FNV_OFFSET_64));
    const reverseHash = uint64Bytes(fnv1a64(reverse, FNV_SECOND_SEED));
    const payloadBytes = new Uint8Array(12);
    payloadBytes.set(forwardHash, 0);
    payloadBytes.set(reverseHash.slice(0, 4), 8);
    const payload = crockfordBase32(payloadBytes);
    return `OK1-${payload.match(/.{1,5}/g).join('-')}`;
  }

  function normalizeRecipientInfo(input) {
    return {
      recipientName: normalizeText(input?.recipientName),
      recipientPhone: normalizeText(input?.recipientPhone),
      addressLine1: normalizeText(input?.addressLine1),
      addressLine2: normalizeText(input?.addressLine2),
      city: normalizeText(input?.city),
      stateProvince: normalizeText(input?.stateProvince),
      postalCode: normalizeText(input?.postalCode),
    };
  }

  function withoutRecipientInfo(record) {
    const sanitized = { ...(record || {}) };
    Object.keys(normalizeRecipientInfo()).forEach((field) => delete sanitized[field]);
    return sanitized;
  }

  function buildRemark(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => parsePreciseLink(item?.purchaseLink))
      .filter((result) => result.ok)
      .map((result) => result.url)
      .join('\n');
  }

  function xyp2SiteCode(hostname) {
    const normalized = normalizeText(hostname).toLowerCase();
    if (normalized === 'us.shein.com' || normalized.endsWith('.us.shein.com')) return 'us';
    if (normalized === 'shein.com.mx' || normalized.endsWith('.shein.com.mx')) return 'mx';
    return '';
  }

  function xyp2Money(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
  }

  function xyp2Rate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(4)) : null;
  }

  function validateSourceReferences(items, order) {
    if (!items.some((item) => item.sourceRef)) return '';
    const scope = order?.sourceScope || createSalesScopeKey(order);
    const owners = new Map();
    for (const [index, item] of items.entries()) {
      const ref = item.sourceRef;
      const prefix = `第 ${index + 1} 条采购明细：`;
      if (!ref || ref.v !== 1 || !['linked', 'extra'].includes(ref.mode)) return prefix + '请选择来源销售明细或明确标记额外采购';
      if (ref.orderKey !== scope) return prefix + '来源销售明细不属于当前订单包裹，请重新关联';
      if (ref.mode === 'extra') {
        if (ref.key || item.sourceAmountOwner) return prefix + '额外采购不能占用销售金额';
        continue;
      }
      if (!/^SL1-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/.test(ref.key)
        || (ref.sku && createSalesSourceKey(ref.sku, ref.variant) !== ref.key)
        || !Number.isInteger(ref.quantity) || ref.quantity < 1) return prefix + '来源销售明细标识无效，请重新关联';
      owners.set(ref.key, (owners.get(ref.key) || 0) + (item.sourceAmountOwner ? 1 : 0));
    }
    if ([...owners.values()].some((count) => count !== 1)) return '每个已关联销售来源必须有且仅有一条采购明细计入商品金额';
    return '';
  }

  function createXyp2Remark(record, maxLength) {
    const safeLimit = Number.isInteger(maxLength) && maxLength > 0
      ? maxLength
      : XYP2_EXPORT_SAFE_LIMIT;
    const sourceItems = Array.isArray(record?.items) ? record.items : [];
    if (!sourceItems.length) {
      return {
        ok: false,
        reason: 'XYP2 至少需要 1 条采购明细',
        text: '',
        length: 0,
        maxLength: safeLimit,
        remaining: safeLimit,
        itemCount: 0,
      };
    }

    const parsedItems = [];
    const associationError = validateSourceReferences(sourceItems, record);
    if (associationError) return { ok: false, reason: associationError, text: '', length: 0,
      maxLength: safeLimit, remaining: safeLimit, itemCount: sourceItems.length };
    const siteCodes = new Set();
    const currencies = new Set();
    const mallCodes = new Set();
    for (let index = 0; index < sourceItems.length; index += 1) {
      const item = sourceItems[index];
      const parsedLink = parsePreciseLink(item?.purchaseLink);
      if (!parsedLink.ok) {
        return {
          ok: false,
          reason: `第 ${index + 1} 条采购明细无法生成 XYP2：${parsedLink.reason}`,
          text: '',
          length: 0,
          maxLength: safeLimit,
          remaining: safeLimit,
          itemCount: sourceItems.length,
        };
      }
      const siteCode = xyp2SiteCode(parsedLink.hostname);
      if (!siteCode) {
        return {
          ok: false,
          reason: `第 ${index + 1} 条采购明细的 SHEIN 站点暂不支持 XYP2`,
          text: '',
          length: 0,
          maxLength: safeLimit,
          remaining: safeLimit,
          itemCount: sourceItems.length,
        };
      }
      const currency = normalizeText(item?.purchaseCurrency || parsedLink.purchaseCurrency).toUpperCase()
        || (siteCode === 'us' ? 'USD' : 'MXN');
      const mallCode = normalizeText(parsedLink.mallCode) || '1';
      siteCodes.add(siteCode);
      currencies.add(currency);
      mallCodes.add(mallCode);
      parsedItems.push([
        normalizeText(item?.sellerSku || `手工明细-${index + 1}`),
        parsedLink.goodsId,
        parsedLink.skuCode,
        parsedLink.mainAttr,
        normalizeText(item?.mainSpec || parsedLink.mainSpec),
        normalizeText(item?.subSpec || parsedLink.subSpec),
        xyp2Money(parsedLink.originalPrice !== '' ? parsedLink.originalPrice : item?.originalPrice),
        xyp2Rate(parsedLink.couponRate),
        xyp2Money(item?.guidePrice !== '' && item?.guidePrice != null ? item.guidePrice : parsedLink.guidePrice),
        Number(item?.purchaseQty),
      ]);
      if (item.sourceRef) parsedItems[parsedItems.length - 1].push([
        item.sourceRef.mode === 'extra' ? '' : item.sourceRef.key,
        item.sourceAmountOwner ? 1 : 0, item.sourceRef.mode === 'extra' ? 0 : item.sourceRef.quantity,
      ]);
    }

    if (siteCodes.size !== 1 || currencies.size !== 1 || mallCodes.size !== 1) {
      return {
        ok: false,
        reason: 'XYP2 暂不支持同一采购单混用多站点、多币种或多 mallCode',
        text: '',
        length: 0,
        maxLength: safeLimit,
        remaining: safeLimit,
        itemCount: sourceItems.length,
      };
    }
    const invalidIndex = parsedItems.findIndex((item) => (
      !item[0]
      || !item[1]
      || !item[2]
      || !Number.isFinite(item[8])
      || item[8] <= 0
      || !Number.isInteger(item[9])
      || item[9] <= 0
    ));
    if (invalidIndex >= 0) {
      return {
        ok: false,
        reason: `第 ${invalidIndex + 1} 条采购明细缺少 XYP2 必需的 SKU、精准型号、指导价或数量`,
        text: '',
        length: 0,
        maxLength: safeLimit,
        remaining: safeLimit,
        itemCount: sourceItems.length,
      };
    }

    const siteCode = [...siteCodes][0];
    const currency = [...currencies][0];
    const mallCode = [...mallCodes][0];
    const payload = { d: siteCode, c: currency, i: parsedItems };
    if (sourceItems.some((item) => item.sourceRef)) payload.a = [1, record.sourceScope || createSalesScopeKey(record)];
    if (mallCode !== '1') payload.m = mallCode;
    const roundingAmount = xyp2Money(record?.estimatedMetrics?.estimatedTopUpAmount);
    if (roundingAmount && roundingAmount > 0) payload.r = roundingAmount;
    const text = `${XYP2_OPEN_MARKER}${JSON.stringify(payload)}${XYP2_CLOSE_MARKER}`;
    const length = text.length;
    const ok = length <= safeLimit;
    return {
      ok,
      reason: ok
        ? ''
        : `XYP2 共 ${length} 字，超过店小秘导出安全上限 ${safeLimit} 字，请拆分采购明细`,
      text,
      length,
      maxLength: safeLimit,
      remaining: safeLimit - length,
      itemCount: parsedItems.length,
      payload,
    };
  }

  function parseXyp2Remark(value) {
    const source = String(value || '');
    const start = source.indexOf(XYP2_OPEN_MARKER);
    const end = start >= 0 ? source.indexOf(XYP2_CLOSE_MARKER, start + XYP2_OPEN_MARKER.length) : -1;
    if (start < 0 || end < 0) return { ok: false, reason: '未找到完整的 XYP2 标记' };

    let payload;
    try {
      payload = JSON.parse(source.slice(start + XYP2_OPEN_MARKER.length, end));
    } catch (_error) {
      return { ok: false, reason: 'XYP2 JSON 已截断或格式错误' };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, reason: 'XYP2 根节点格式错误' };
    }
    const siteCode = normalizeText(payload.d).toLowerCase();
    const hostname = XYP2_SITE_HOSTS[siteCode];
    const currency = normalizeText(payload.c).toUpperCase();
    const mallCode = normalizeText(payload.m) || '1';
    if (!hostname || !/^[A-Z]{3}$/.test(currency) || !Array.isArray(payload.i) || !payload.i.length) {
      return { ok: false, reason: 'XYP2 站点、币种或明细数组无效' };
    }

    const items = [];
    const associationWarnings = [];
    const hasAssociation = Object.prototype.hasOwnProperty.call(payload, 'a') || payload.i.some((item) => Array.isArray(item) && item.length > 10);
    for (let index = 0; index < payload.i.length; index += 1) {
      const compactItem = payload.i[index];
      if (!Array.isArray(compactItem) || compactItem.length < 10) {
        return { ok: false, reason: `XYP2 第 ${index + 1} 条明细数组不完整` };
      }
      const [sellerSku, goodsId, skuCode, mainAttr, mainSpec, subSpec,
        originalPrice, couponRate, guidePrice, purchaseQty] = compactItem;
      const envelopeValid = Array.isArray(payload.a) && payload.a.length === 2 && payload.a[0] === 1
        && /^OK1-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/.test(payload.a[1]);
      const ref = compactItem[10];
      const refValid = envelopeValid && Array.isArray(ref) && ref.length === 3
        && [0, 1].includes(ref[1]) && Number.isInteger(ref[2])
        && (ref[0] === '' && ref[1] === 0 && ref[2] === 0
          || /^SL1-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/.test(ref[0]) && ref[2] > 0);
      if (hasAssociation && !refValid) associationWarnings.push(`第 ${index + 1} 条销售关联无效，采购数据仍按备注解析`);
      if (!normalizeText(sellerSku)
        || !/^\d+$/.test(normalizeText(goodsId))
        || !normalizeText(skuCode)
        || !Number.isFinite(Number(guidePrice))
        || Number(guidePrice) <= 0
        || !Number.isInteger(Number(purchaseQty))
        || Number(purchaseQty) <= 0) {
        return { ok: false, reason: `XYP2 第 ${index + 1} 条明细字段无效` };
      }
      const purchaseUrl = new URL(`https://${hostname}/x-p-${normalizeText(goodsId)}.html`);
      purchaseUrl.searchParams.set('mallCode', mallCode);
      purchaseUrl.searchParams.set('goods_id', normalizeText(goodsId));
      purchaseUrl.searchParams.set('skucode', normalizeText(skuCode));
      if (normalizeText(mainAttr)) purchaseUrl.searchParams.set('main_attr', normalizeText(mainAttr));
      const metadata = new URLSearchParams();
      metadata.set('xv', '1');
      metadata.set('p', normalizeText(mainSpec));
      metadata.set('s', normalizeText(subSpec));
      if (originalPrice != null && Number.isFinite(Number(originalPrice))) metadata.set('op', String(Number(originalPrice)));
      if (couponRate != null && Number.isFinite(Number(couponRate))) metadata.set('cr', String(Number(couponRate)));
      metadata.set('gp', String(Number(guidePrice)));
      metadata.set('c', currency);
      purchaseUrl.hash = metadata.toString();
      items.push({
        sellerSku: normalizeText(sellerSku),
        goodsId: normalizeText(goodsId),
        skuCode: normalizeText(skuCode),
        mainAttr: normalizeText(mainAttr),
        mainSpec: normalizeText(mainSpec),
        subSpec: normalizeText(subSpec),
        originalPrice: originalPrice == null ? null : Number(originalPrice),
        couponRate: couponRate == null ? null : Number(couponRate),
        guidePrice: Number(guidePrice),
        purchaseQty: Number(purchaseQty),
        purchaseCurrency: currency,
        purchaseLink: purchaseUrl.toString(),
        ...(refValid ? {
          sourceRef: { v: 1, orderKey: payload.a[1], mode: compactItem[10][0] ? 'linked' : 'extra',
            key: compactItem[10][0], quantity: compactItem[10][2], sku: '', variant: '' },
          sourceAmountOwner: compactItem[10][1] === 1,
        } : hasAssociation ? { sourceRef: { v: 1, mode: 'unconfirmed', key: '', orderKey: envelopeValid ? payload.a[1] : '', sku: '', variant: '', quantity: 0 }, sourceAmountOwner: false } : {}),
      });
    }
    return {
      ok: true,
      format: 'XYP2',
      ...(Array.isArray(payload.a) ? { sourceScope: payload.a[1] } : {}),
      ...(hasAssociation ? { associationWarnings } : {}),
      site: siteCode.toUpperCase(),
      currency,
      mallCode,
      roundingAmount: Number.isFinite(Number(payload.r)) ? Number(payload.r) : 0,
      items,
      text: source.slice(start, end + XYP2_CLOSE_MARKER.length),
    };
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
    if (item.sourceRef?.mode === 'unconfirmed') {
      return { ok: false, reason: '请选择来源销售明细或明确标记额外采购', parsedLink };
    }
    if (!item.sourceRef && Number.isInteger(salesQty) && salesQty > 0 && purchaseQty !== salesQty) {
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
    const associationError = validateSourceReferences(items, order);
    if (associationError) throw new Error(associationError);
    const safeItems = items.map((item, index) => {
      const validation = validatePurchaseItem(item);
      if (!validation.ok) {
        throw new Error(`第 ${index + 1} 条采购明细：${validation.reason}`);
      }
      return {
        lineNo: index + 1,
        sellerSku: normalizeText(item.sellerSku || `手工明细${index + 1}`),
        ...(item.sourceRef ? { sourceRef: { ...item.sourceRef }, sourceAmountOwner: !!item.sourceAmountOwner } : {}),
        variant: normalizeText(item.variant),
        productImageUrl: normalizeProductImageUrl(item.productImageUrl),
        mainSpec: normalizeText(item.mainSpec),
        subSpec: normalizeText(item.subSpec),
        originalPrice: validation.parsedLink.originalPrice !== ''
          && Number.isFinite(Number(validation.parsedLink.originalPrice))
          ? Number(validation.parsedLink.originalPrice)
          : null,
        couponType: validation.parsedLink.couponType,
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
    const systemOrderKey = createSystemOrderKey(order);
    const storeAssignment = parseStoreAssignment(order.storeName);
    return {
      schemaVersion: 2,
      mode: 'xynigo-extension',
      orderKey,
      systemOrderKey,
      packageId: normalizeText(order.packageId).toUpperCase(),
      platformOrderNo: normalizeText(order.platformOrderNo).toUpperCase(),
      storeName: storeAssignment.storeName,
      storeBaseName: storeAssignment.storeBaseName,
      operatorName: storeAssignment.operatorName,
      site: resolveOrderSite(order),
      salesCurrency: normalizeText(order.salesCurrency).toUpperCase(),
      salesAmount: Number.isFinite(Number(order.salesAmount)) ? Number(order.salesAmount) : null,
      dianxiaomiOrderTime: normalizeText(order.dianxiaomiOrderTime),
      ...normalizeRecipientInfo(order),
      items: safeItems,
      guideTotalsByCurrency,
      estimatedMetrics,
      remarkText: buildRemark(safeItems),
      remarkStatus: 'clipboard',
      purchaseStatus: 'recorded-local',
      submissionStatus: 'submitted',
      createdAt: nowIso || new Date().toISOString(),
      updatedAt: nowIso || new Date().toISOString(),
    };
  }

  function createPurchaseDraft(order, items, nowIso) {
    const safeItems = (Array.isArray(items) ? items : []).map((item, index) => {
      const parsedLink = parsePreciseLink(item?.purchaseLink);
      const rawGuidePrice = String(item?.guidePrice ?? '').trim();
      const guidePrice = rawGuidePrice !== '' && Number.isFinite(Number(rawGuidePrice))
        ? Number(rawGuidePrice)
        : '';
      const rawPurchaseQty = String(item?.purchaseQty ?? '').trim();
      const purchaseQty = rawPurchaseQty !== '' && Number.isFinite(Number(rawPurchaseQty))
        ? Number(rawPurchaseQty)
        : '';
      const rawOriginalPrice = parsedLink.ok ? parsedLink.originalPrice : String(item?.originalPrice ?? '').trim();
      const originalPrice = rawOriginalPrice !== '' && Number.isFinite(Number(rawOriginalPrice))
        ? Number(rawOriginalPrice)
        : '';
      return {
        lineNo: index + 1,
        sellerSku: normalizeText(item?.sellerSku || `手工明细-${index + 1}`),
        ...(item.sourceRef ? { sourceRef: { ...item.sourceRef }, sourceAmountOwner: !!item.sourceAmountOwner } : {}),
        variant: normalizeText(item?.variant),
        productImageUrl: normalizeProductImageUrl(item?.productImageUrl),
        mainSpec: normalizeText(item?.mainSpec),
        subSpec: normalizeText(item?.subSpec),
        originalPrice,
        couponType: parsedLink.ok ? parsedLink.couponType : normalizeText(item?.couponType),
        guidePrice,
        purchaseCurrency: normalizeText(item?.purchaseCurrency).toUpperCase(),
        salesQty: Number(item?.salesQty) || 1,
        purchaseQty,
        source: normalizeText(item?.source),
        purchaseLink: normalizeText(item?.purchaseLink),
        goodsId: parsedLink.ok ? parsedLink.goodsId : '',
        skuCode: parsedLink.ok ? parsedLink.skuCode : '',
        mainAttr: parsedLink.ok ? parsedLink.mainAttr : '',
        mallCode: parsedLink.ok ? parsedLink.mallCode : '',
      };
    });
    const orderKey = createOrderKey(order);
    const systemOrderKey = createSystemOrderKey(order);
    const storeAssignment = parseStoreAssignment(order.storeName);
    return {
      schemaVersion: 2,
      mode: 'xynigo-extension',
      orderKey,
      systemOrderKey,
      packageId: normalizeText(order.packageId).toUpperCase(),
      platformOrderNo: normalizeText(order.platformOrderNo).toUpperCase(),
      storeName: storeAssignment.storeName,
      storeBaseName: storeAssignment.storeBaseName,
      operatorName: storeAssignment.operatorName,
      site: resolveOrderSite(order),
      salesCurrency: normalizeText(order.salesCurrency).toUpperCase(),
      salesAmount: Number.isFinite(Number(order.salesAmount)) ? Number(order.salesAmount) : null,
      dianxiaomiOrderTime: normalizeText(order.dianxiaomiOrderTime),
      ...normalizeRecipientInfo(order),
      items: safeItems,
      guideTotalsByCurrency: {},
      estimatedMetrics: null,
      remarkText: '',
      remarkStatus: 'not-generated',
      purchaseStatus: 'draft-local',
      submissionStatus: 'draft',
      createdAt: nowIso || new Date().toISOString(),
      updatedAt: nowIso || new Date().toISOString(),
    };
  }

  function createValidatedPurchaseDraft(order, items, nowIso) {
    const validated = createPurchaseRecord(order, items, nowIso);
    return {
      ...validated,
      remarkText: '',
      remarkStatus: 'not-generated',
      purchaseStatus: 'draft-local',
      submissionStatus: 'draft',
    };
  }

  return {
    SHEIN_HOST_RE,
    PRODUCT_IMAGE_HOST_RE,
    XYP2_OPEN_MARKER,
    XYP2_CLOSE_MARKER,
    XYP2_EXPORT_SAFE_LIMIT,
    normalizeText,
    parseStoreAssignment,
    normalizeProductImageUrl,
    parsePreciseLink,
    extractOrderIdentity,
    parseMoney,
    inferVariantSpecs,
    extractSourceGoodsId,
    extractProductSku,
    extractProductRows,
    createSalesSourceKey,
    attachSalesSources,
    createSalesScopeKey,
    setSalesSource,
    normalizeSourceOwners,
    validateSourceReferences,
    reconcilePurchaseItems,
    resolveOrderSite,
    resolveSheinMarket,
    buildSourceProductUrl,
    calculateEstimatedProfit,
    createOrderKey,
    createSystemOrderKey,
    normalizeRecipientInfo,
    withoutRecipientInfo,
    buildRemark,
    createXyp2Remark,
    parseXyp2Remark,
    validatePurchaseItem,
    createPurchaseDraft,
    createValidatedPurchaseDraft,
    createPurchaseRecord,
  };
});

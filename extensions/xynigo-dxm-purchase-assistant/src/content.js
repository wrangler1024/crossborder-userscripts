(function runXynigoDianxiaomiAssistant() {
  'use strict';

  const Core = globalThis.XynigoPurchaseCore;
  if (!Core || !globalThis.chrome?.storage?.local) {
    return;
  }

  const SETTINGS_KEY = 'xynigoDxmPurchaseSettings';
  const RECORD_PREFIX = 'xynigoDxmPurchaseRecord:';
  const EMBEDDED_TAB_GAP = 6;
  const DEFAULT_SETTINGS = {
    gateEnabled: false,
    autoOpenRemark: true,
  };

  let settings = { ...DEFAULT_SETTINGS };
  let scanTimer = null;
  let currentDrawer = null;
  let currentContext = null;
  let currentEmbedded = null;
  const recordsByKey = new Map();
  const recordsByPackage = new Map();

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve(result || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  function normalizeActionText(element) {
    return Core.normalizeText(element?.innerText || element?.textContent || '');
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function closestClickable(target) {
    return target instanceof Element
      ? target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]')
      : null;
  }

  function findClickable(scope, text) {
    return Array.from(scope.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
      .find((element) => isVisible(element) && normalizeActionText(element) === text) || null;
  }

  function showToast(message, tone = 'info') {
    let toast = document.getElementById('xynigo-dxm-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'xynigo-dxm-toast';
      document.documentElement.appendChild(toast);
    }
    toast.dataset.tone = tone;
    toast.textContent = message;
    toast.classList.add('xynigo-dxm-toast-show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('xynigo-dxm-toast-show'), 3200);
  }

  function loadRecords(values) {
    recordsByKey.clear();
    recordsByPackage.clear();
    Object.entries(values).forEach(([key, record]) => {
      if (!key.startsWith(RECORD_PREFIX) || !record || typeof record !== 'object') return;
      recordsByKey.set(record.orderKey, record);
      if (record.packageId) recordsByPackage.set(String(record.packageId).toUpperCase(), record);
    });
  }

  async function loadState() {
    const values = await storageGet(null);
    settings = { ...DEFAULT_SETTINGS, ...(values[SETTINGS_KEY] || {}) };
    loadRecords(values);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPage, 140);
  }

  function findDetailModal() {
    const selector = [
      '[role="dialog"]',
      '.modal',
      '.modal-dialog',
      '.layui-layer',
      '.el-dialog',
      '.ant-modal',
      '.ivu-modal',
      '.ui-dialog',
      '[class*="modal"]',
      '[class*="dialog"]',
    ].join(',');

    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((element) => {
        if (!isVisible(element) || element.closest('#xynigo-dxm-drawer-root')) return false;
        const text = Core.normalizeText(element.innerText || '');
        return text.includes('包裹') && text.includes('详情') && Boolean(findClickable(element, '审核'));
      })
      .sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height)
        - (b.getBoundingClientRect().width * b.getBoundingClientRect().height));

    if (candidates.length) return candidates[0];

    const auditButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter((element) => isVisible(element) && normalizeActionText(element) === '审核');

    for (const auditButton of auditButtons) {
      let ancestor = auditButton.parentElement;
      for (let depth = 0; ancestor && ancestor !== document.body && depth < 10; depth += 1) {
        const text = Core.normalizeText(ancestor.innerText || '');
        if (text.includes('包裹') && text.includes('详情') && text.includes('备注')) {
          return ancestor;
        }
        ancestor = ancestor.parentElement;
      }
    }
    return null;
  }

  function extractStoreName(text) {
    const normalized = Core.normalizeText(text);
    return normalized.match(/卖家[：:]\s*(.+?)(?=买家[：:]|买家姓名[：:]|包裹总额[：:]|$)/)?.[1]?.trim() || '';
  }

  function extractOrderMoney(text) {
    const normalized = Core.normalizeText(text);
    const labeled = normalized.match(/包裹总额[：:]?\s*(USD|MXN|CNY|RMB)\s*([\d,]+(?:\.\d+)?)/i);
    if (labeled) {
      return {
        currency: labeled[1].toUpperCase() === 'RMB' ? 'CNY' : labeled[1].toUpperCase(),
        amount: Number(labeled[2].replace(/,/g, '')),
      };
    }
    return Core.parseMoney(normalized);
  }

  function extractOrderCountry(text) {
    const normalized = Core.normalizeText(text);
    const labeled = normalized.match(/(?:订单国家|销售国家|目的国|市场|站点|国家)[：:]?\s*(墨西哥|M[eé]xico|美国|美区|United States|USA|US)/i);
    if (!labeled) return '';
    return /(美国|美区|United States|USA|US)/i.test(labeled[1]) ? 'US' : 'MX';
  }

  function extractProducts(modal) {
    const products = [];
    const seen = new Set();
    const rows = Array.from(modal.querySelectorAll('tr'));

    rows.forEach((row) => {
      const text = Core.normalizeText(row.innerText || row.textContent || '');
      const cellTexts = Array.from(row.querySelectorAll('td')).map((cell) => (
        Core.normalizeText(cell.innerText || cell.textContent || '')
      ));
      const match = Core.extractProductSku(text, cellTexts);
      if (!match.sellerSku) return;

      const sellerSku = match.sellerSku;
      const salesQty = match.salesQty;
      let variant = '';
      const fullWidthColon = text.lastIndexOf('：');
      if (fullWidthColon >= 0) {
        variant = Core.normalizeText(text.slice(fullWidthColon + 1));
      }
      const key = `${sellerSku}|${variant}`;
      if (seen.has(key)) return;
      seen.add(key);
      const specs = Core.inferVariantSpecs(variant);
      products.push({
        sellerSku,
        variant,
        mainSpec: specs.mainSpec,
        subSpec: specs.subSpec,
        guidePrice: '',
        salesQty: salesQty || 1,
        purchaseQty: salesQty || 1,
        purchaseLink: '',
        source: 'page-parser',
      });
    });

    if (!products.length) {
      products.push({
        sellerSku: '未识别商品',
        variant: '请手工确认商品与规格',
        mainSpec: '',
        subSpec: '',
        guidePrice: '',
        salesQty: 1,
        purchaseQty: 1,
        purchaseLink: '',
        source: 'manual-fallback',
      });
    }
    return products;
  }

  function parseContext(modal) {
    const text = Core.normalizeText(modal.innerText || modal.textContent || '');
    const identity = Core.extractOrderIdentity(text);
    const money = extractOrderMoney(text);
    const storeName = extractStoreName(text);
    const order = {
      packageId: identity.packageId,
      platformOrderNo: identity.platformOrderNo,
      storeName,
      salesCurrency: money.currency,
      salesAmount: money.amount,
      country: extractOrderCountry(text),
    };
    return {
      modal,
      order,
      orderKey: Core.createOrderKey(order),
      products: extractProducts(modal),
      nativeAudit: findClickable(modal, '审核'),
      nativeRemark: findClickable(modal, '备注'),
    };
  }

  function getRecordForContext(context) {
    return recordsByKey.get(context.orderKey)
      || (context.order.packageId ? recordsByPackage.get(context.order.packageId.toUpperCase()) : null)
      || null;
  }

  function applyAuditVisual(button, unlocked) {
    if (!button || button.closest('#xynigo-dxm-drawer-root')) return;
    button.classList.toggle('xynigo-dxm-audit-locked', settings.gateEnabled && !unlocked);
    if (settings.gateEnabled && !unlocked) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }

  function updateDetailControls(context) {
    const record = getRecordForContext(context);
    const unlocked = Boolean(record);
    const purchaseTab = context.modal.querySelector('.xynigo-dxm-purchase-tab');
    if (purchaseTab) {
      purchaseTab.dataset.state = unlocked ? 'recorded' : 'empty';
      purchaseTab.setAttribute('title', unlocked ? '采购单已录入，点击查看或修改' : '采购单未录入，点击录入');
    }
    applyAuditVisual(context.nativeAudit, unlocked);
  }

  function injectDetailControls(context) {
    if (!context.nativeAudit) return;
    context.modal.querySelectorAll('.xynigo-dxm-purchase-entry, .xynigo-dxm-purchase-badge')
      .forEach((element) => element.remove());
    updateDetailControls(context);
  }

  function findTextElement(scope, label) {
    const candidates = Array.from(scope.querySelectorAll('button, a, li, div, span'))
      .filter((element) => {
        if (!isVisible(element) || element.closest('#xynigo-dxm-drawer-root')) return false;
        const text = Core.normalizeText(element.innerText || element.textContent || '');
        return text === label || (text.startsWith(label) && text.length <= label.length + 2);
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      });
    return candidates[0] || null;
  }

  function findDetailTabGroup(modal) {
    const labels = ['收货地址', '报关信息', '物流信息', '备注信息'];

    const nativeGroups = Array.from(modal.querySelectorAll('.order-detail-content__nav'))
      .filter(isVisible);
    for (const group of nativeGroups) {
      const items = Array.from(group.querySelectorAll('.order-detail-content__nav-item'));
      const elements = labels.map((label) => items.find((element) => {
        const text = Core.normalizeText(element.innerText || element.textContent || '');
        return text === label || text.startsWith(label);
      }) || null);
      if (elements.every(Boolean)) {
        return { group, elements, labels, source: 'dianxiaomi-native-class' };
      }
    }

    const elements = labels.map((label) => findTextElement(modal, label));
    if (elements.some((element) => !element)) return null;

    let ancestor = elements[0].parentElement;
    while (ancestor && ancestor !== modal) {
      if (elements.every((element) => ancestor.contains(element))) {
        const rect = ancestor.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        if (rect.width > 120 && rect.width < modalRect.width * 0.45 && rect.height > 100) {
          return { group: ancestor, elements, labels, source: 'layout-fallback' };
        }
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  function directChildWithin(element, parent) {
    let current = element;
    while (current?.parentElement && current.parentElement !== parent) current = current.parentElement;
    return current?.parentElement === parent ? current : element;
  }

  function findDetailContentRegion(modal, tabGroup) {
    const modalRect = modal.getBoundingClientRect();
    const titleCandidates = Array.from(modal.querySelectorAll('div, span, h1, h2, h3, h4'))
      .filter((element) => {
        if (!isVisible(element) || tabGroup.contains(element) || element.closest('#xynigo-dxm-drawer-root')) return false;
        return Core.normalizeText(element.innerText || element.textContent || '') === '物流信息';
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      });

    for (const title of titleCandidates) {
      let ancestor = title.parentElement;
      while (ancestor && ancestor !== modal) {
        const rect = ancestor.getBoundingClientRect();
        if (!ancestor.contains(tabGroup)
          && rect.width >= modalRect.width * 0.55
          && rect.height >= 150
          && rect.height <= modalRect.height * 0.72) {
          return ancestor;
        }
        ancestor = ancestor.parentElement;
      }
    }

    const layout = tabGroup.parentElement;
    if (!layout) return null;
    return Array.from(layout.children)
      .filter((element) => element !== tabGroup && isVisible(element))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= modalRect.width * 0.55 && rect.height >= 150;
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      })[0] || null;
  }

  function restoreEmbeddedTabs(embedded) {
    if (!embedded) return;
    if (embedded.syncFrame) cancelAnimationFrame(embedded.syncFrame);
    embedded.resizeObserver?.disconnect();
    embedded.tab?.classList.remove('xynigo-dxm-purchase-tab-active');
    embedded.nativeItems?.forEach((item) => item.classList.remove('xynigo-dxm-native-tab-muted'));
    embedded.region?.classList.remove('xynigo-dxm-embedded-anchor');
    embedded.region?.style.removeProperty('--xynigo-dxm-embedded-min-height');
    embedded.region?.style.removeProperty('--xynigo-dxm-embedded-height');
    embedded.container?.classList.remove('xynigo-dxm-expanded-detail-container');
    if (embedded.headerTitleNode?.isConnected) {
      embedded.headerTitleNode.nodeValue = embedded.originalHeaderTitle;
    }
    embedded.header?.classList.remove('xynigo-dxm-purchase-header-fallback');
    embedded.header?.classList.remove('xynigo-dxm-purchase-header-active');
    embedded.header?.removeAttribute('data-xynigo-purchase-title');
    embedded.headerActions?.forEach((action) => action.classList.remove('xynigo-dxm-native-header-action-hidden'));
    embedded.headerCancel?.remove();
  }

  function updateEmbeddedHeader(container, nativeItems) {
    const header = container?.querySelector('.order-detail-content__header');
    if (!header) return {
      header: null,
      headerTitleNode: null,
      originalHeaderTitle: '',
      headerActions: [],
    };
    header.classList.add('xynigo-dxm-purchase-header-active');
    const headerActions = Array.from(header.querySelectorAll('button, a, [role="button"]'));
    Array.from(header.querySelectorAll('*')).forEach((element) => {
      if (/^(编辑|添加|设置)$/.test(Core.normalizeText(element.textContent || ''))) headerActions.push(element);
    });
    [...new Set(headerActions)].forEach((action) => action.classList.add('xynigo-dxm-native-header-action-hidden'));
    header.querySelector('.xynigo-dxm-purchase-header-cancel')?.remove();
    const headerCancel = createElement('button', 'xynigo-dxm-purchase-header-cancel', '取消');
    headerCancel.type = 'button';
    headerCancel.setAttribute('aria-label', '退出采购明细');
    headerCancel.addEventListener('click', closeDrawer);
    header.appendChild(headerCancel);
    const nativeLabels = new Set(nativeItems.map((item) => Core.normalizeText(item.textContent || '')));
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (nativeLabels.has(Core.normalizeText(node.nodeValue || ''))) {
        const originalHeaderTitle = node.nodeValue;
        node.nodeValue = '采购明细';
        return { header, headerTitleNode: node, originalHeaderTitle, headerActions: [...new Set(headerActions)], headerCancel };
      }
      node = walker.nextNode();
    }
    header.dataset.xynigoPurchaseTitle = '采购明细';
    header.classList.add('xynigo-dxm-purchase-header-fallback');
    return { header, headerTitleNode: null, originalHeaderTitle: '', headerActions: [...new Set(headerActions)], headerCancel };
  }

  function injectEmbeddedTab(context) {
    if (context.modal.querySelector('.xynigo-dxm-purchase-tab')) return;
    const tabInfo = findDetailTabGroup(context.modal);
    if (!tabInfo) return;
    const nativeItems = tabInfo.elements.map((element) => directChildWithin(element, tabInfo.group));
    const template = nativeItems[nativeItems.length - 1];
    if (!template) return;

    const tab = template.cloneNode(true);
    tab.removeAttribute('id');
    tab.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    tab.textContent = '采购明细';
    tab.classList.add('xynigo-dxm-purchase-tab');
    tab.dataset.state = 'empty';
    tab.setAttribute('role', 'button');
    tab.setAttribute('tabindex', '0');
    tabInfo.group.appendChild(tab);

    const activate = (event) => {
      event?.preventDefault();
      event?.stopPropagation();
      openEmbeddedEditor(parseContext(context.modal), tabInfo.group, nativeItems, tab);
    };
    tab.addEventListener('click', activate);
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    nativeItems.forEach((item) => item.addEventListener('click', () => {
      if (currentEmbedded?.modal === context.modal) closeDrawer();
    }, true));
    updateDetailControls(context);
    requestAnimationFrame(() => {
      if (!document.contains(tab) || !isVisible(context.modal)) return;
      if (currentEmbedded && currentEmbedded.modal !== context.modal) return;
      activate();
    });
  }

  function findDetailActionBar(context) {
    let ancestor = context.nativeAudit?.parentElement || null;
    const modalRect = context.modal.getBoundingClientRect();
    for (let depth = 0; ancestor && ancestor !== context.modal && depth < 6; depth += 1) {
      const text = Core.normalizeText(ancestor.innerText || ancestor.textContent || '');
      const rect = ancestor.getBoundingClientRect();
      if (text.includes('审核')
        && text.includes('备注')
        && text.includes('关闭')
        && rect.width >= modalRect.width * 0.45
        && rect.height <= 140) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    return context.nativeAudit?.parentElement || null;
  }

  function injectInlineEditor(context) {
    if (context.modal.querySelector('.xynigo-dxm-inline-host')) return;
    const actionBar = findDetailActionBar(context);
    if (!actionBar?.parentElement) return;

    closeDrawer();
    openDrawer(context);
    if (!currentDrawer) return;

    const host = createElement('section', 'xynigo-dxm-inline-host');
    host.setAttribute('aria-label', '运营采购助手录单卡片');
    currentDrawer.classList.add('xynigo-dxm-inline-root');
    host.appendChild(currentDrawer);
    actionBar.parentElement.insertBefore(host, actionBar);
  }

  function resolvePackageIdFromAction(action) {
    const modal = action.closest('[role="dialog"], .modal, .modal-dialog, .layui-layer, .el-dialog, .ant-modal, .ivu-modal, .ui-dialog');
    if (modal) {
      const id = Core.extractOrderIdentity(modal.innerText || '').packageId;
      if (id) return id;
    }

    const row = action.closest('tr');
    const texts = [];
    if (row) {
      texts.push(row.innerText || '');
      if (row.previousElementSibling) texts.push(row.previousElementSibling.innerText || '');
      if (row.previousElementSibling?.previousElementSibling) {
        texts.push(row.previousElementSibling.previousElementSibling.innerText || '');
      }
    }
    return Core.extractOrderIdentity(texts.join(' ')).packageId;
  }

  function updateAllAuditVisuals() {
    const auditActions = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter((element) => normalizeActionText(element) === '审核' && !element.closest('#xynigo-dxm-drawer-root'));
    auditActions.forEach((action) => {
      const packageId = resolvePackageIdFromAction(action);
      const unlocked = Boolean(packageId && recordsByPackage.has(packageId.toUpperCase()));
      applyAuditVisual(action, unlocked);
    });
  }

  function scanPage() {
    const modal = findDetailModal();
    if (modal) {
      currentContext = parseContext(modal);
      injectDetailControls(currentContext);
      injectEmbeddedTab(currentContext);
    } else {
      currentContext = null;
      closeDrawer();
    }
    updateAllAuditVisuals();
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_error) {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.documentElement.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    } else {
      element.textContent = value;
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function waitFor(check, timeoutMs = 2600) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const value = check();
        if (value || Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(value || null);
        }
      }, 100);
    });
  }

  async function prefillNativeRemark(context, remarkText) {
    const nativeRemark = context.nativeRemark && document.contains(context.nativeRemark)
      ? context.nativeRemark
      : findClickable(context.modal, '备注');
    if (!nativeRemark) return false;

    const before = new Set(Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).filter(isVisible));
    nativeRemark.click();
    const editor = await waitFor(() => Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'))
      .find((element) => !before.has(element) && isVisible(element) && !element.closest('#xynigo-dxm-drawer-root')));
    if (!editor) return false;
    setNativeValue(editor, remarkText);
    editor.focus();
    return true;
  }

  function closeDrawer() {
    if (currentDrawer) {
      const embeddedHost = currentDrawer.closest('.xynigo-dxm-embedded-host');
      const inlineHost = currentDrawer.closest('.xynigo-dxm-inline-host');
      currentDrawer.remove();
      if (embeddedHost) embeddedHost.remove();
      if (inlineHost) inlineHost.remove();
      currentDrawer = null;
    }
    if (currentEmbedded) {
      restoreEmbeddedTabs(currentEmbedded);
      currentEmbedded = null;
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function syncEmbeddedLayout() {
    const embedded = currentEmbedded;
    if (!embedded) return;
    if (embedded.syncFrame) cancelAnimationFrame(embedded.syncFrame);
    embedded.syncFrame = requestAnimationFrame(() => {
      if (currentEmbedded !== embedded || !document.contains(embedded.host)) return;
      const drawer = embedded.host.querySelector('.xynigo-dxm-drawer');
      const style = getComputedStyle(embedded.region);
      const verticalChrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((total, property) => total + (Number.parseFloat(style[property]) || 0), 0);
      const contentHeight = Math.max(
        embedded.host.scrollHeight,
        drawer?.scrollHeight || 0,
      );
      const requiredHeight = Math.ceil(contentHeight + verticalChrome);
      embedded.region.style.setProperty('--xynigo-dxm-embedded-height', `${requiredHeight}px`);
    });
  }

  function openDrawer(context) {
    closeDrawer();
    const existing = getRecordForContext(context);
    const baseItems = existing?.items?.length
      ? existing.items.map((item) => ({ ...item }))
      : context.products.map((item) => ({ ...item }));
    const defaultPurchaseCurrency = Core.resolveSheinMarket(context.order) === 'US' ? 'USD' : 'MXN';
    const items = baseItems.map((item) => {
      const parsedLink = item.purchaseLink ? Core.parsePreciseLink(item.purchaseLink) : null;
      return {
        ...item,
        mainSpec: parsedLink?.ok && parsedLink.hasMetadata
          ? parsedLink.mainSpec
          : (existing ? item.mainSpec || '' : ''),
        subSpec: parsedLink?.ok && parsedLink.hasMetadata
          ? parsedLink.subSpec
          : (existing ? item.subSpec || '' : ''),
        guidePrice: parsedLink?.ok && parsedLink.hasMetadata && parsedLink.guidePrice
          ? parsedLink.guidePrice
          : (item.guidePrice ?? ''),
        purchaseCurrency: ['USD', 'MXN'].includes(parsedLink?.purchaseCurrency)
          ? parsedLink.purchaseCurrency
          : (['USD', 'MXN'].includes(item.purchaseCurrency) ? item.purchaseCurrency : defaultPurchaseCurrency),
      };
    });
    let manualLineCount = 0;
    items.forEach((item) => {
      if (item.source === 'manual-added' || /^\s*手工明细/.test(item.sellerSku || '')) {
        manualLineCount += 1;
        item.sellerSku = `手工明细-${manualLineCount}`;
        item.source = 'manual-added';
      }
    });
    let nextManualLineNumber = manualLineCount + 1;

    const root = createElement('div', 'xynigo-dxm-drawer-root');
    root.id = 'xynigo-dxm-drawer-root';
    const backdrop = createElement('div', 'xynigo-dxm-backdrop');
    const drawer = createElement('section', 'xynigo-dxm-drawer');
    drawer.setAttribute('aria-label', '运营采购助手');
    drawer.setAttribute('role', 'dialog');
    root.append(backdrop, drawer);

    const header = createElement('header', 'xynigo-dxm-drawer-header');
    const headerText = createElement('div');
    headerText.append(
      createElement('strong', '', '运营采购助手'),
      createElement('span', '', `${existing ? '已录入·可修改' : '待录入'} · ${context.order.packageId || context.order.platformOrderNo || '当前订单'}`),
    );
    const close = createElement('button', 'xynigo-dxm-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeDrawer);
    header.append(headerText, close);
    drawer.appendChild(header);

    const mode = createElement('div', 'xynigo-dxm-dev-mode');
    mode.innerHTML = '<strong>本地开发模式</strong><span>本版本不写飞书，不保存客户姓名、邮箱、电话或地址</span>';
    drawer.appendChild(mode);

    const orderMeta = createElement('div', 'xynigo-dxm-order-meta');
    const metaValues = [
      ['平台订单号', context.order.platformOrderNo || '未识别'],
      ['店铺账号', context.order.storeName || '未识别'],
      ['订单销售额', context.order.salesCurrency && context.order.salesAmount !== null
        ? `${context.order.salesCurrency} ${context.order.salesAmount.toFixed(2)}`
        : '未识别'],
    ];
    metaValues.forEach(([label, value]) => {
      const cell = createElement('div');
      cell.append(createElement('span', '', label), createElement('strong', '', value));
      orderMeta.appendChild(cell);
    });
    drawer.appendChild(orderMeta);

    const progress = createElement('div', 'xynigo-dxm-line-progress', `采购明细 · ${items.length} 件商品`);
    drawer.appendChild(progress);
    const columnHead = createElement('div', 'xynigo-dxm-line-column-head');
    ['采购链接', '主规格', '次规格', '指导价', '采购数量'].forEach((label) => {
      columnHead.appendChild(createElement('span', '', label));
    });
    drawer.appendChild(columnHead);
    const lineList = createElement('div', 'xynigo-dxm-line-list');
    drawer.appendChild(lineList);
    function createHelp(text) {
      const help = createElement('span', 'xynigo-dxm-metric-help', '?');
      help.tabIndex = 0;
      help.setAttribute('role', 'img');
      help.setAttribute('aria-label', text);
      help.title = text;
      help.dataset.tooltip = text;
      help.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      return help;
    }

    function setHelpText(help, text) {
      help.title = text;
      help.dataset.tooltip = text;
      help.setAttribute('aria-label', text);
    }

    const purchaseSummary = createElement('span', 'xynigo-dxm-purchase-summary xynigo-dxm-metric');
    const purchaseHelp = createHelp('采购总额 = 商品指导总额 + 预计凑单金额。最终成本以采购表实际下单金额为准。');
    const purchaseValue = createElement('strong', 'xynigo-dxm-metric-value', '—');
    purchaseSummary.append(
      createElement('span', 'xynigo-dxm-metric-label', '采购总额'),
      purchaseHelp,
      createElement('span', 'xynigo-dxm-metric-separator', '：'),
      purchaseValue,
    );

    const profitSummary = createElement('span', 'xynigo-dxm-profit-summary xynigo-dxm-metric');
    const profitHelp = createHelp('利润 = 包裹总金额 - 预估采购成本。墨西哥站不足 MXN 100 时，预估成本按凑单后的 MXN 100 计算。');
    const profitValue = createElement('strong', 'xynigo-dxm-metric-value', '—');
    profitSummary.append(
      createElement('span', 'xynigo-dxm-metric-label', '利润'),
      profitHelp,
      createElement('span', 'xynigo-dxm-metric-separator', '：'),
      profitValue,
    );

    const profitMarginSummary = createElement('span', 'xynigo-dxm-profit-margin-summary xynigo-dxm-metric');
    const profitMarginHelp = createHelp('利润率 = 预估利润 ÷ 包裹总金额 × 100%，用于衡量销售额中预计保留的利润比例。');
    const profitMarginValue = createElement('strong', 'xynigo-dxm-metric-value', '—');
    profitMarginSummary.append(
      createElement('span', 'xynigo-dxm-metric-label', '利润率'),
      profitMarginHelp,
      createElement('span', 'xynigo-dxm-metric-separator', '：'),
      profitMarginValue,
    );

    const roiSummary = createElement('span', 'xynigo-dxm-roi-summary xynigo-dxm-metric');
    const roiHelp = createHelp('ROI = 预估利润 ÷ 预估采购成本 × 100%，用于衡量采购成本回报。');
    const roiValue = createElement('strong', 'xynigo-dxm-metric-value', '—');
    roiSummary.append(
      createElement('span', 'xynigo-dxm-metric-label', 'ROI'),
      roiHelp,
      createElement('span', 'xynigo-dxm-metric-separator', '：'),
      roiValue,
    );

    function updatePurchaseSummary() {
      const totals = items.reduce((result, item) => {
        const price = Number(item.guidePrice);
        const quantity = Number(item.purchaseQty);
        const currency = ['USD', 'MXN'].includes(item.purchaseCurrency)
          ? item.purchaseCurrency
          : defaultPurchaseCurrency;
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) return result;
        result[currency] = (result[currency] || 0) + (price * quantity);
        return result;
      }, {});
      const metrics = Core.calculateEstimatedProfit(context.order, totals);
      purchaseSummary.dataset.state = metrics.ok ? 'ready' : 'pending';
      purchaseValue.textContent = '—';
      if (metrics.ok) {
        purchaseValue.textContent = `${metrics.currency} ${metrics.estimatedCost.toFixed(2)}`;
        const purchaseExplanation = [
          '采购总额 = 商品指导总额 + 预计凑单金额',
          `商品指导总额：${metrics.currency} ${metrics.guideTotal.toFixed(2)}`,
          `预计凑单：${metrics.currency} ${metrics.estimatedTopUpAmount.toFixed(2)}${metrics.minimumApplied ? '（不入采购明细）' : ''}`,
          `凑单后采购总额：${metrics.currency} ${metrics.estimatedCost.toFixed(2)}`,
          '最终成本：以采购表实际下单金额为准',
        ].join('\n');
        setHelpText(purchaseHelp, purchaseExplanation);
        profitSummary.dataset.state = metrics.estimatedProfit >= 0 ? 'positive' : 'negative';
        profitMarginSummary.dataset.state = profitSummary.dataset.state;
        roiSummary.dataset.state = profitSummary.dataset.state;
        profitValue.textContent = `${metrics.currency} ${metrics.estimatedProfit.toFixed(2)}`;
        profitMarginValue.textContent = `${metrics.profitMargin.toFixed(2)}%`;
        roiValue.textContent = `${metrics.roi.toFixed(2)}%`;
        const profitExplanation = [
          '利润 = 包裹总金额 - 预估采购成本',
          `包裹总金额：${metrics.currency} ${metrics.salesAmount.toFixed(2)}`,
          `预估采购成本：${metrics.currency} ${metrics.estimatedCost.toFixed(2)}${metrics.minimumApplied ? `（含预计凑单 ${metrics.currency} ${metrics.estimatedTopUpAmount.toFixed(2)}）` : ''}`,
          `计算：${metrics.currency} ${metrics.salesAmount.toFixed(2)} - ${metrics.currency} ${metrics.estimatedCost.toFixed(2)} = ${metrics.currency} ${metrics.estimatedProfit.toFixed(2)}`,
          '最终利润：以采购表实际下单金额重新计算',
        ].join('\n');
        setHelpText(profitHelp, profitExplanation);
        const profitMarginExplanation = [
          '利润率 = 预估利润 ÷ 包裹总金额 × 100%',
          `预估利润：${metrics.currency} ${metrics.estimatedProfit.toFixed(2)}`,
          `包裹总金额：${metrics.currency} ${metrics.salesAmount.toFixed(2)}`,
          `计算：${metrics.estimatedProfit.toFixed(2)} ÷ ${metrics.salesAmount.toFixed(2)} × 100% = ${metrics.profitMargin.toFixed(2)}%`,
          '含义：每 100 元销售额中的预估利润比例',
        ].join('\n');
        setHelpText(profitMarginHelp, profitMarginExplanation);
        const roiExplanation = [
          'ROI = 预估利润 ÷ 预估采购成本 × 100%',
          `预估利润：${metrics.currency} ${metrics.estimatedProfit.toFixed(2)}`,
          `预估采购成本：${metrics.currency} ${metrics.estimatedCost.toFixed(2)}`,
          `计算：${metrics.estimatedProfit.toFixed(2)} ÷ ${metrics.estimatedCost.toFixed(2)} × 100% = ${metrics.roi.toFixed(2)}%`,
          '含义：每 100 元采购成本带来的预估利润',
        ].join('\n');
        setHelpText(roiHelp, roiExplanation);
      } else {
        profitSummary.dataset.state = 'pending';
        profitMarginSummary.dataset.state = 'pending';
        roiSummary.dataset.state = 'pending';
        profitValue.textContent = '—';
        profitMarginValue.textContent = '—';
        roiValue.textContent = '—';
        const pendingProfitExplanation = `利润 = 包裹总金额 - 预估采购成本。当前暂不可计算：${metrics.reason}。`;
        setHelpText(profitHelp, pendingProfitExplanation);
        setHelpText(profitMarginHelp, `利润率 = 预估利润 ÷ 包裹总金额 × 100%。当前暂不可计算：${metrics.reason}。`);
        setHelpText(roiHelp, `ROI = 预估利润 ÷ 预估采购成本 × 100%。当前暂不可计算：${metrics.reason}。`);
        const pendingPurchaseExplanation = `采购总额 = 商品指导总额 + 预计凑单金额。当前暂不可计算：${metrics.reason}。最终成本以采购表实际下单金额为准。`;
        setHelpText(purchaseHelp, pendingPurchaseExplanation);
      }
      const metricValues = [purchaseValue, profitValue, profitMarginValue, roiValue];
      const useCompactNumbers = metricValues.some((value) => value.textContent.length > 10);
      metricValues.forEach((value) => {
        value.dataset.compact = useCompactNumbers ? 'true' : 'false';
      });
    }

    function renderLines() {
      lineList.replaceChildren();
      items.forEach((item, index) => {
        const line = createElement('article', 'xynigo-dxm-line');
        line.dataset.index = String(index);
        const product = createElement('div', 'xynigo-dxm-line-product');
        const number = createElement('b', '', String(index + 1));
        const productText = createElement('div', 'xynigo-dxm-line-product-text');
        const isManualLine = item.source === 'manual-added' || /^\s*手工明细/.test(item.sellerSku || '');
        const sellerSku = item.sellerSku || (isManualLine ? `手工明细-${index + 1}` : `商品明细-${index + 1}`);
        const sellerSkuText = createElement('strong');
        if (isManualLine) sellerSkuText.classList.add('xynigo-dxm-manual-line-title');
        const sourceGoodsId = Core.extractSourceGoodsId(sellerSku);
        if (sourceGoodsId) {
          const goodsIdStart = sellerSku.indexOf(sourceGoodsId);
          const sourceMarket = Core.resolveSheinMarket(context.order);
          const sourceLink = createElement('a', 'xynigo-dxm-source-product-link', sourceGoodsId);
          sourceLink.href = Core.buildSourceProductUrl(sourceGoodsId, context.order);
          sourceLink.target = '_blank';
          sourceLink.rel = 'noopener noreferrer';
          sourceLink.title = `打开 SHEIN ${sourceMarket === 'US' ? '美国站' : '墨西哥站'}原采集商品页（规格需手动选择）`;
          sourceLink.setAttribute('aria-label', `打开 SHEIN ${sourceMarket === 'US' ? '美国站' : '墨西哥站'}商品 ${sourceGoodsId}`);
          sourceLink.dataset.market = sourceMarket;
          sourceLink.addEventListener('click', (event) => event.stopPropagation());
          sellerSkuText.append(
            document.createTextNode(sellerSku.slice(0, goodsIdStart)),
            sourceLink,
            document.createTextNode(sellerSku.slice(goodsIdStart + sourceGoodsId.length)),
          );
        } else {
          sellerSkuText.textContent = sellerSku;
        }
        productText.append(sellerSkuText);
        product.append(number, productText);
        const lineActions = createElement('div', 'xynigo-dxm-line-actions');
        const clearLine = createElement('button', 'xynigo-dxm-clear-line', '清空');
        clearLine.type = 'button';
        clearLine.setAttribute('aria-label', `清空 ${sellerSku} 的采购信息`);
        if (isManualLine) {
          const removeLine = createElement('button', 'xynigo-dxm-remove-line', '− 删除');
          removeLine.type = 'button';
          removeLine.setAttribute('aria-label', `删除手工明细 ${index + 1}`);
          removeLine.addEventListener('click', () => {
            items.splice(index, 1);
            renderLines();
          });
          lineActions.appendChild(removeLine);
        }
        lineActions.appendChild(clearLine);
        product.appendChild(lineActions);

        const linkLabel = createElement('label', 'xynigo-dxm-field xynigo-dxm-link-field');
        linkLabel.appendChild(createElement('span', '', '采购链接'));
        const linkInput = createElement('input');
        linkInput.type = 'url';
        linkInput.placeholder = '粘贴包含 goods_id 与 skucode 的采购链接';
        linkInput.value = item.purchaseLink || '';
        linkInput.dataset.field = 'purchaseLink';
        const message = createElement('small', 'xynigo-dxm-line-message');
        linkLabel.append(linkInput, message);

        const mainSpecLabel = createElement('label', 'xynigo-dxm-field');
        mainSpecLabel.appendChild(createElement('span', '', '主规格'));
        const mainSpecInput = createElement('input');
        mainSpecInput.type = 'text';
        mainSpecInput.placeholder = '如 Multicolor';
        mainSpecInput.value = item.mainSpec || '';
        mainSpecInput.dataset.field = 'mainSpec';
        mainSpecLabel.appendChild(mainSpecInput);

        const subSpecLabel = createElement('label', 'xynigo-dxm-field');
        subSpecLabel.appendChild(createElement('span', '', '次规格'));
        const subSpecInput = createElement('input');
        subSpecInput.type = 'text';
        subSpecInput.placeholder = '如 XS';
        subSpecInput.value = item.subSpec || '';
        subSpecInput.dataset.field = 'subSpec';
        subSpecLabel.appendChild(subSpecInput);

        const guidePriceLabel = createElement('label', 'xynigo-dxm-field');
        guidePriceLabel.appendChild(createElement('span', '', '指导价'));
        const guidePriceInput = createElement('input');
        guidePriceInput.type = 'number';
        guidePriceInput.min = '0.01';
        guidePriceInput.step = '0.01';
        guidePriceInput.placeholder = '0.00';
        guidePriceInput.value = item.guidePrice ?? '';
        guidePriceInput.dataset.field = 'guidePrice';
        const currencyInput = createElement('input', 'xynigo-dxm-currency-value');
        currencyInput.type = 'hidden';
        currencyInput.dataset.field = 'purchaseCurrency';
        currencyInput.value = item.purchaseCurrency || defaultPurchaseCurrency;
        const currencyBadge = createElement('span', 'xynigo-dxm-currency-badge', currencyInput.value);
        currencyBadge.title = '币种由订单站点及采购链接自动确定，不支持手动修改';
        const guidePriceControls = createElement('div', 'xynigo-dxm-guide-price-controls');
        guidePriceControls.append(guidePriceInput, currencyBadge, currencyInput);
        guidePriceLabel.appendChild(guidePriceControls);

        const quantityLabel = createElement('label', 'xynigo-dxm-field xynigo-dxm-qty');
        quantityLabel.appendChild(createElement('span', '', '采购数量'));
        const quantityInput = createElement('input');
        quantityInput.type = 'number';
        quantityInput.min = '1';
        quantityInput.step = '1';
        quantityInput.value = String(item.purchaseQty || item.salesQty || 1);
        quantityInput.dataset.field = 'purchaseQty';
        quantityLabel.appendChild(quantityInput);

        const fields = createElement('div', 'xynigo-dxm-line-fields');
        fields.append(linkLabel, mainSpecLabel, subSpecLabel, guidePriceLabel, quantityLabel);
        line.append(product, fields);
        lineList.appendChild(line);

        const validate = (syncLinkMetadata = false) => {
          const parsedLink = Core.parsePreciseLink(linkInput.value.trim());
          if (syncLinkMetadata && parsedLink.ok && parsedLink.hasMetadata) {
            mainSpecInput.value = parsedLink.mainSpec;
            subSpecInput.value = parsedLink.subSpec;
            if (parsedLink.guidePrice) guidePriceInput.value = parsedLink.guidePrice;
          }
          if (syncLinkMetadata && parsedLink.ok) {
            const inferredCurrency = ['USD', 'MXN'].includes(parsedLink.purchaseCurrency)
              ? parsedLink.purchaseCurrency
              : (parsedLink.hostname === 'us.shein.com' ? 'USD'
                : (parsedLink.hostname.endsWith('.com.mx') ? 'MXN' : defaultPurchaseCurrency));
            currencyInput.value = inferredCurrency;
            currencyBadge.textContent = inferredCurrency;
          }
          item.purchaseLink = linkInput.value.trim();
          item.mainSpec = mainSpecInput.value.trim();
          item.subSpec = subSpecInput.value.trim();
          item.guidePrice = guidePriceInput.value;
          item.purchaseCurrency = currencyInput.value;
          item.purchaseQty = Number(quantityInput.value);
          updatePurchaseSummary();
          const result = Core.validatePurchaseItem(item);
          linkInput.classList.toggle('xynigo-dxm-field-error', !result.parsedLink.ok);
          guidePriceInput.classList.toggle('xynigo-dxm-field-error', !result.ok && result.reason.includes('指导价'));
          quantityInput.classList.toggle('xynigo-dxm-field-error', !result.ok && result.reason.includes('数量'));
          message.dataset.tone = result.ok ? (result.parsedLink.warning ? 'warning' : 'ok') : 'error';
          const parsedSpecs = result.parsedLink.hasMetadata
            ? `已解析 ${result.parsedLink.mainSpec}${result.parsedLink.subSpec ? ` / ${result.parsedLink.subSpec}` : ''}`
            : `已解析 goods_id ${result.parsedLink.goodsId}`;
          message.textContent = result.ok
            ? (result.parsedLink.warning || parsedSpecs)
            : result.reason;
          return result.ok;
        };
        const clearPurchaseFields = ({ focus = false } = {}) => {
          linkInput.value = '';
          mainSpecInput.value = '';
          subSpecInput.value = '';
          guidePriceInput.value = '';
          item.purchaseLink = '';
          item.mainSpec = '';
          item.subSpec = '';
          item.guidePrice = '';
          item.purchaseCurrency = currencyInput.value;
          item.purchaseQty = Number(quantityInput.value);
          linkInput.classList.remove('xynigo-dxm-field-error');
          guidePriceInput.classList.remove('xynigo-dxm-field-error');
          quantityInput.classList.remove('xynigo-dxm-field-error');
          message.textContent = '';
          message.removeAttribute('data-tone');
          updatePurchaseSummary();
          if (focus) linkInput.focus();
        };
        clearLine.addEventListener('click', () => clearPurchaseFields({ focus: true }));
        linkInput.addEventListener('input', () => {
          if (!linkInput.value.trim()) {
            clearPurchaseFields();
            return;
          }
          validate(true);
        });
        mainSpecInput.addEventListener('input', () => validate(false));
        subSpecInput.addEventListener('input', () => validate(false));
        guidePriceInput.addEventListener('input', () => validate(false));
        quantityInput.addEventListener('input', () => validate(false));
        if (item.purchaseLink || item.guidePrice) validate(true);
      });
      progress.textContent = `采购明细 · ${items.length} 件商品`;
      updatePurchaseSummary();
      syncEmbeddedLayout();
    }

    renderLines();

    const addLine = createElement('button', 'xynigo-dxm-add-line', '＋ 新增手工明细');
    addLine.type = 'button';
    addLine.addEventListener('click', () => {
      items.push({
        sellerSku: `手工明细-${nextManualLineNumber}`,
        variant: '请确认对应的店小秘商品',
        mainSpec: '',
        subSpec: '',
        guidePrice: '',
        purchaseCurrency: defaultPurchaseCurrency,
        salesQty: 1,
        purchaseQty: 1,
        purchaseLink: '',
        source: 'manual-added',
      });
      nextManualLineNumber += 1;
      renderLines();
    });
    drawer.appendChild(addLine);

    const footer = createElement('footer', 'xynigo-dxm-drawer-footer');
    const status = createElement('span', 'xynigo-dxm-submit-status', existing ? `已录入 · ${existing.items?.length || 0}件` : '未录入');
    status.dataset.state = existing ? 'recorded' : 'empty';
    status.title = existing ? '状态来源：浏览器本地采购记录' : '未查询到当前订单的本地采购记录';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const footerInfo = createElement('div', 'xynigo-dxm-footer-info');
    footerInfo.append(purchaseSummary, profitSummary, profitMarginSummary, roiSummary);
    const submit = createElement('button', 'xynigo-dxm-primary xynigo-dxm-footer-submit', existing ? '更新采购单' : '提交采购单');
    submit.type = 'button';

    submit.addEventListener('click', async () => {
      const lineElements = Array.from(lineList.querySelectorAll('.xynigo-dxm-line'));
      let allValid = true;
      lineElements.forEach((line, index) => {
        items[index].purchaseLink = line.querySelector('[data-field="purchaseLink"]').value.trim();
        items[index].mainSpec = line.querySelector('[data-field="mainSpec"]').value.trim();
        items[index].subSpec = line.querySelector('[data-field="subSpec"]').value.trim();
        items[index].guidePrice = line.querySelector('[data-field="guidePrice"]').value;
        items[index].purchaseCurrency = line.querySelector('[data-field="purchaseCurrency"]').value;
        items[index].purchaseQty = Number(line.querySelector('[data-field="purchaseQty"]').value);
        const result = Core.validatePurchaseItem(items[index]);
        const message = line.querySelector('.xynigo-dxm-line-message');
        message.dataset.tone = result.ok ? (result.parsedLink.warning ? 'warning' : 'ok') : 'error';
        message.textContent = result.ok ? (result.parsedLink.warning || `已解析 goods_id ${result.parsedLink.goodsId}`) : result.reason;
        line.querySelector('[data-field="purchaseLink"]').classList.toggle('xynigo-dxm-field-error', !result.parsedLink.ok);
        line.querySelector('[data-field="guidePrice"]').classList.toggle('xynigo-dxm-field-error', !result.ok && result.reason.includes('指导价'));
        line.querySelector('[data-field="purchaseQty"]').classList.toggle('xynigo-dxm-field-error', !result.ok && result.reason.includes('数量'));
        allValid = allValid && result.ok;
      });

      if (!allValid) {
        status.dataset.state = 'error';
        status.textContent = '明细未完成';
        status.title = '表单校验未通过，请根据明细行提示修正';
        showToast('请先修正采购明细', 'error');
        return;
      }

      submit.disabled = true;
      status.dataset.state = 'syncing';
      status.textContent = '正在录入…';
      status.title = '正在保存采购单';
      try {
        const record = Core.createPurchaseRecord(context.order, items);
        const storageKey = `${RECORD_PREFIX}${record.orderKey}`;
        await storageSet({ [storageKey]: record });
        recordsByKey.set(record.orderKey, record);
        if (record.packageId) recordsByPackage.set(record.packageId, record);
        await copyText(record.remarkText);
        closeDrawer();
        scheduleScan();

        let remarkPrefilled = false;
        if (settings.autoOpenRemark) {
          remarkPrefilled = await prefillNativeRemark(context, record.remarkText);
          record.remarkStatus = remarkPrefilled ? 'prefilled-unsaved' : 'clipboard';
          record.updatedAt = new Date().toISOString();
          await storageSet({ [storageKey]: record });
        }
        showToast(
          remarkPrefilled
            ? '采购单已录入；备注已填入，请检查保存后再审核'
            : '采购单已录入；采购链接备注已复制，审核已解锁',
          'success',
        );
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = '录入失败';
        status.title = error?.message || '录入失败，请重试';
        showToast(status.textContent, 'error');
        submit.disabled = false;
      }
    });

    footer.append(footerInfo, status, submit);
    drawer.appendChild(footer);
    backdrop.addEventListener('click', closeDrawer);
    document.documentElement.appendChild(root);
    currentDrawer = root;
    setTimeout(() => root.classList.add('xynigo-dxm-drawer-open'), 0);
  }

  function openEmbeddedEditor(context, tabGroup, nativeItems, tab) {
    const region = findDetailContentRegion(context.modal, tabGroup);
    if (!region) {
      showToast('未识别订单详情内容区，已切换为右侧面板', 'warning');
      openDrawer(context);
      return;
    }

    closeDrawer();
    openDrawer(context);
    if (!currentDrawer) return;

    const host = createElement('div', 'xynigo-dxm-embedded-host');
    const tabRect = tabGroup.getBoundingClientRect();
    const regionRect = region.getBoundingClientRect();
    const baselineHeight = Math.ceil(regionRect.height);
    const regionStyle = getComputedStyle(region);
    const regionPaddingLeft = Number.parseFloat(regionStyle.paddingLeft) || 0;
    const contentLeft = regionRect.left
      + (Number.parseFloat(regionStyle.borderLeftWidth) || 0)
      + regionPaddingLeft;
    const leftOffset = Math.max(
      -regionPaddingLeft,
      Math.ceil(tabRect.right + EMBEDDED_TAB_GAP - contentLeft),
    );
    host.style.setProperty('--xynigo-dxm-embedded-left', `${leftOffset}px`);
    region.classList.add('xynigo-dxm-embedded-anchor');
    const container = region.closest('.order-detail-content') || region.parentElement;
    container?.classList.add('xynigo-dxm-expanded-detail-container');
    const headerState = updateEmbeddedHeader(container, nativeItems);
    tab.classList.add('xynigo-dxm-purchase-tab-active');
    nativeItems.forEach((item) => item.classList.add('xynigo-dxm-native-tab-muted'));
    currentDrawer.classList.add('xynigo-dxm-embedded-root');
    host.appendChild(currentDrawer);
    region.appendChild(host);
    currentEmbedded = {
      modal: context.modal,
      host,
      region,
      container,
      tab,
      nativeItems,
      baselineHeight,
      resizeObserver: null,
      syncFrame: 0,
      ...headerState,
    };
    if (typeof ResizeObserver === 'function') {
      currentEmbedded.resizeObserver = new ResizeObserver(syncEmbeddedLayout);
      currentEmbedded.resizeObserver.observe(host.querySelector('.xynigo-dxm-drawer'));
    }
    syncEmbeddedLayout();
  }

  function blockAction(event, message) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showToast(message, 'warning');
  }

  document.addEventListener('click', (event) => {
    if (!settings.gateEnabled) return;
    const action = closestClickable(event.target);
    if (!action || action.closest('#xynigo-dxm-drawer-root')) return;
    const label = normalizeActionText(action);

    if (label === '批量审核') {
      blockAction(event, '开发版门禁已启用：请进入订单详情逐单提交采购单后审核');
      return;
    }
    if (label !== '审核') return;

    const packageId = resolvePackageIdFromAction(action);
    const contextRecord = currentContext && currentContext.nativeAudit === action
      ? getRecordForContext(currentContext)
      : null;
    const unlocked = Boolean(contextRecord || (packageId && recordsByPackage.has(packageId.toUpperCase())));
    if (!unlocked) {
      blockAction(event, '该订单尚未提交采购单，审核不可用');
      if (currentContext?.modal?.contains(action)) openDrawer(parseContext(currentContext.modal));
    }
  }, true);

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== 'local') return;
    loadState().then(scheduleScan).catch(() => {});
  });

  function start() {
    loadState().catch(() => {}).finally(() => {
      scheduleScan();
      const observer = new MutationObserver(scheduleScan);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('popstate', scheduleScan);
      window.addEventListener('hashchange', scheduleScan);
    });
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
})();

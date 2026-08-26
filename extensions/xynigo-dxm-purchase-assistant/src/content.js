(function runXynigoDianxiaomiAssistant() {
  'use strict';

  const Core = globalThis.XynigoPurchaseCore;
  if (!Core || !globalThis.chrome?.storage?.local) {
    return;
  }

  const RECORD_PREFIX = 'xynigoDxmPurchaseRecord:';
  const GET_ORDER_MESSAGE = 'xynigo-dxm:get-order';
  const SAVE_DRAFT_MESSAGE = 'xynigo-dxm:save-draft';
  const SUBMIT_MESSAGE = 'xynigo-dxm:submit';
  const EMBEDDED_TAB_GAP = 6;
  const IMPORTANT_ERROR_TOAST_MS = 8000;
  const DIALOG_ROOT_SELECTOR = [
    '[role="dialog"]',
    '.modal',
    '.modal-dialog',
    '.layui-layer',
    '.el-dialog',
    '.ant-modal',
    '.ivu-modal',
    '.ui-dialog',
  ].join(',');
  const DETAIL_MODAL_SELECTOR = DIALOG_ROOT_SELECTOR;
  let scanTimer = null;
  let immediateDetailScanScheduled = false;
  let pendingDetailModal = null;
  let started = false;
  let currentDrawer = null;
  let currentContext = null;
  let currentEmbedded = null;
  let detailCloseInProgress = false;
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

  function findClickable(scope, text) {
    return Array.from(scope.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
      .find((element) => isVisible(element) && normalizeActionText(element) === text) || null;
  }

  function showToast(message, tone = 'info', options = {}) {
    const persistent = Boolean(options?.persistent);
    const busy = Boolean(options?.busy);
    const durationMs = Number.isFinite(options?.durationMs) ? options.durationMs : 3200;
    let toast = document.getElementById('xynigo-dxm-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'xynigo-dxm-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.documentElement.appendChild(toast);
    }
    toast.dataset.tone = tone;
    toast.dataset.busy = busy ? 'true' : 'false';
    toast.setAttribute('aria-busy', busy ? 'true' : 'false');
    toast.textContent = message;
    toast.classList.add('xynigo-dxm-toast-show');
    clearTimeout(showToast.timer);
    if (!persistent) {
      showToast.timer = setTimeout(() => toast.classList.remove('xynigo-dxm-toast-show'), durationMs);
    }
    return toast;
  }

  function showRemarkProgress(message) {
    return showToast(message, 'info', { persistent: true, busy: true });
  }

  async function copyTextToClipboard(value) {
    const text = String(value || '');
    if (!text) throw new Error('没有可复制的 XYP2 备注');
    if (typeof globalThis.GM_setClipboard === 'function') {
      globalThis.GM_setClipboard(text, 'text');
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('XYP2 备注复制失败，请重试');
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

  function mergeXyp2IntoRemark(existingValue, xyp2Text) {
    const existing = String(existingValue || '');
    return existing.trim() ? `${existing.trimEnd()}\n${xyp2Text}` : xyp2Text;
  }

  function findStructuredRemarkBlock(value) {
    return String(value || '').match(
      /\[(XYP2|XYP1|XYNIGO_PURCHASE_V1)\][\s\S]*?\[\/\1\]/,
    )?.[0] || '';
  }

  function findVisibleNativeRemarkEditor() {
    return Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'))
      .filter((element) => !element.closest('#xynigo-dxm-drawer-root'))
      .filter(isVisible)
      .find((element) => {
        const dialog = element.closest('[role="dialog"], .ant-modal, .el-dialog');
        return dialog && Core.normalizeText(dialog.textContent || '').includes('备注');
      }) || null;
  }

  function findNativeRemarkTab(context) {
    const tabInfo = findDetailTabGroup(context.modal);
    const nativeIndex = tabInfo?.labels?.indexOf('备注信息') ?? -1;
    if (nativeIndex >= 0 && tabInfo.elements[nativeIndex]) return tabInfo.elements[nativeIndex];
    return Array.from(context.modal.querySelectorAll(
      '.order-detail-content__nav-item, [role="tab"]',
    )).find((element) => !element.closest('#xynigo-dxm-drawer-root')
      && Core.normalizeText(element.textContent || '').startsWith('备注信息')) || null;
  }

  async function selectNativeRemarkTab(context) {
    const remarkTab = findNativeRemarkTab(context);
    if (!remarkTab || !isVisible(remarkTab)) return false;
    remarkTab.click();
    return Boolean(await waitFor(() => {
      const active = remarkTab.classList.contains('isActive')
        || remarkTab.classList.contains('mock-active')
        || remarkTab.classList.contains('active')
        || remarkTab.classList.contains('is-active')
        || remarkTab.classList.contains('ant-tabs-tab-active')
        || remarkTab.getAttribute('aria-selected') === 'true';
      const headerText = Core.normalizeText(
        context.modal.querySelector('.order-detail-content__header')?.textContent || '',
      );
      return active || headerText.includes('备注信息') ? true : null;
    }, 1200));
  }

  async function prefillNativeRemark(context, xyp2Remark, onProgress = () => {}) {
    const nativeRemark = context.nativeRemark && document.contains(context.nativeRemark)
      ? context.nativeRemark
      : findClickable(context.modal, '备注');
    if (!nativeRemark) return { ok: false, reason: '未找到店小秘备注入口' };

    // 云端提交成功后，让订单详情最终停留在原生“备注信息”选项卡，
    // 便于运营保存后直接核对客服备注记录。找不到选项卡时不阻断备注填充。
    onProgress('正在切换到备注信息并检查编辑状态，请勿重复操作…');
    await selectNativeRemarkTab(context);

    let editor = findVisibleNativeRemarkEditor();
    if (!editor) {
      const visibleBefore = new Set(Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'))
        .filter((element) => !element.closest('#xynigo-dxm-drawer-root'))
        .filter(isVisible));
      onProgress('正在打开客服备注编辑框，请勿重复点击…');
      nativeRemark.click();
      editor = await waitFor(() => findVisibleNativeRemarkEditor()
        || Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'))
          .find((element) => !visibleBefore.has(element)
            && !element.closest('#xynigo-dxm-drawer-root')
            && isVisible(element)));
    }
    if (!editor) return { ok: false, reason: '店小秘备注窗口已打开，但未识别到编辑框' };

    // 部分店小秘版本在点击底部“备注”后会把详情页签切回原位置；
    // 编辑器出现后再选择一次，保证关闭备注弹窗后底层停留在“备注信息”。
    onProgress('客服备注已打开，正在填入 XYP2…');
    await selectNativeRemarkTab(context);

    const currentValue = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
      ? editor.value
      : editor.textContent;
    const existingBlock = findStructuredRemarkBlock(currentValue);
    if (existingBlock) {
      editor.focus();
      if (existingBlock === xyp2Remark.text) {
        return { ok: true, length: String(currentValue || '').length, unchanged: true };
      }
      return {
        ok: false,
        reason: '当前已有一条待保存的结构化客服备注，未再新增或覆盖',
      };
    }
    const nextValue = mergeXyp2IntoRemark(currentValue, xyp2Remark.text);
    if (nextValue.length > xyp2Remark.maxLength) {
      editor.focus();
      return {
        ok: false,
        reason: `原客服备注与 XYP2 合计 ${nextValue.length} 字，超过 ${xyp2Remark.maxLength} 字安全上限，未自动覆盖`,
      };
    }
    setNativeValue(editor, nextValue);
    editor.focus();
    return { ok: true, length: nextValue.length };
  }

  function findSavedXyp2RemarkRows(context) {
    return Array.from(context.modal.querySelectorAll('table tbody tr'))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        if (cells.length !== 5 || Core.normalizeText(cells[2]?.textContent || '') !== '客服备注') return null;
        const value = String(cells[0]?.textContent || '').trim();
        const block = findStructuredRemarkBlock(value);
        if (!block.startsWith('[XYP2]')) return null;
        const edit = Array.from(cells[4]?.querySelectorAll('a, button') || [])
          .find((element) => Core.normalizeText(element.textContent || '') === '编辑');
        return edit ? { row, cells, value, block, edit } : null;
      })
      .filter(Boolean);
  }

  function closeNativeRemarkEditor(dialog) {
    const cancel = Array.from(dialog?.querySelectorAll('button') || [])
      .find((button) => isVisible(button) && Core.normalizeText(button.textContent || '') === '取消');
    if (cancel) cancel.click();
  }

  async function updateExistingNativeXyp2Remark(context, xyp2Remark, onProgress = () => {}) {
    onProgress('采购明细已提交，正在检查原客服备注，请勿重复操作（预计 3–8 秒）…');
    await selectNativeRemarkTab(context);
    let candidates = findSavedXyp2RemarkRows(context);
    if (!candidates.length && findNativeRemarkTab(context)) {
      candidates = await waitFor(() => {
        const rows = findSavedXyp2RemarkRows(context);
        return rows.length ? rows : null;
      }) || [];
    }
    if (candidates.length !== 1) {
      return {
        ok: false,
        code: candidates.length ? 'remark_ambiguous' : 'remark_not_found',
        reason: candidates.length
          ? `检测到 ${candidates.length} 条 XYP2 客服备注，未自动修改`
          : '未找到唯一的 XYP2 客服备注，未自动修改',
      };
    }

    const candidate = candidates[0];
    if (candidate.block === xyp2Remark.text) {
      return { ok: true, unchanged: true, length: candidate.value.length };
    }
    onProgress('已找到原客服备注，正在打开并更新内容…');
    candidate.edit.click();
    const editor = await waitFor(() => Array.from(document.querySelectorAll('.remark-modal textarea[placeholder="请输入内容"], textarea[placeholder="请输入内容"]'))
      .find((element) => !element.closest('#xynigo-dxm-drawer-root') && isVisible(element)));
    if (!editor) return { ok: false, reason: '已打开备注编辑，但未识别到编辑框' };

    const dialog = editor.closest('.remark-modal, [role="dialog"], .ant-modal, .el-dialog');
    const currentValue = String(editor.value || '');
    const editorBlock = findStructuredRemarkBlock(currentValue);
    if (editorBlock !== candidate.block) {
      closeNativeRemarkEditor(dialog);
      return { ok: false, reason: '备注内容已发生变化，未自动覆盖' };
    }
    const nextValue = currentValue.replace(editorBlock, xyp2Remark.text);
    if (nextValue.length > xyp2Remark.maxLength) {
      closeNativeRemarkEditor(dialog);
      return {
        ok: false,
        reason: `更新后客服备注 ${nextValue.length} 字，超过 ${xyp2Remark.maxLength} 字安全上限`,
      };
    }
    const submit = Array.from(dialog?.querySelectorAll('button') || [])
      .find((button) => isVisible(button)
        && !button.disabled
        && Core.normalizeText(button.textContent || '') === '提交');
    if (!submit) {
      closeNativeRemarkEditor(dialog);
      return { ok: false, reason: '未找到备注编辑提交按钮' };
    }

    setNativeValue(editor, nextValue);
    submit.click();
    onProgress('客服备注更新已提交，正在等待店小秘页面确认…');
    const verified = await waitFor(() => findSavedXyp2RemarkRows(context)
      .some((row) => row.block === xyp2Remark.text), 5000);
    if (!verified) {
      return {
        ok: false,
        submitted: true,
        reason: '店小秘已接收备注编辑，但页面未回读到更新结果，请人工核对',
      };
    }
    return { ok: true, unchanged: false, length: nextValue.length };
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
    loadRecords(values);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      function normalizeRuntimeError(error) {
        const rawMessage = String(error?.message || error || '').trim();
        if (/extension context invalidated|receiving end does not exist|could not establish connection/i.test(rawMessage)) {
          const normalized = new Error('插件刚刚已更新，请刷新当前店小秘页面后重新打开采购明细');
          normalized.code = 'extension_context_invalidated';
          return normalized;
        }
        return new Error(rawMessage || '无法连接扩展后台');
      }
      if (typeof chrome.runtime?.sendMessage !== 'function') {
        reject(new Error('扩展上下文已失效；请在扩展管理页重新加载插件，然后强制刷新店小秘页面'));
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(normalizeRuntimeError(error));
            return;
          }
          if (!response?.ok) {
            const remoteError = new Error(response?.error?.message || '采购草稿写入失败');
            remoteError.code = response?.error?.code || 'xynigo_request_failed';
            if (chrome.runtime?.__xynigoDxmRuntime === 'userscript'
              && ['authentication_required', 'session_invalid'].includes(remoteError.code)) {
              remoteError.message = `${remoteError.message}；点击 Tampermonkey 图标 → 使用飞书登录 Xynigo`;
            }
            reject(remoteError);
            return;
          }
          resolve(response.data || {});
        });
      } catch (error) {
        reject(normalizeRuntimeError(error));
      }
    });
  }

  async function reconcileRemoteOrder(context) {
    const orderKey = Core.createOrderKey(context.order);
    if (!orderKey) return null;
    let remote;
    try {
      remote = await sendRuntimeMessage({ type: GET_ORDER_MESSAGE, orderKey });
    } catch (error) {
      if (error?.code === 'purchase_order_not_found') return null;
      throw error;
    }
    if (remote.orderKey !== orderKey
      || !['draft', 'submitted'].includes(remote.submissionStatus)
      || !Number.isInteger(remote.draftRevision)
      || !remote.draft || typeof remote.draft !== 'object') {
      throw new Error('Xynigo 返回了无效的采购单状态');
    }
    const localRecord = Core.withoutRecipientInfo({
      ...remote.draft,
      remotePurchaseOrderId: remote.purchaseOrderId,
      remoteSubmissionStatus: remote.submissionStatus,
      remoteSyncStatus: remote.syncStatus,
      remoteDraftRevision: remote.draftRevision,
      remoteContentHash: remote.contentHash,
      remoteSavedAt: remote.savedAt,
      remoteSubmittedAt: remote.submittedAt,
      remoteSubmittedBy: remote.submittedBy,
      remoteUnchanged: Boolean(remote.unchanged),
      remoteRevised: Boolean(remote.revised),
    });
    await storageSet({ [`${RECORD_PREFIX}${localRecord.orderKey}`]: localRecord });
    recordsByKey.set(localRecord.orderKey, localRecord);
    if (localRecord.packageId) recordsByPackage.set(localRecord.packageId.toUpperCase(), localRecord);
    updateDetailControls(context);
    return localRecord;
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanPage();
    }, 140);
  }

  function scheduleImmediateDetailScan(modal) {
    pendingDetailModal = modal;
    if (immediateDetailScanScheduled) return;
    immediateDetailScanScheduled = true;
    queueMicrotask(() => {
      immediateDetailScanScheduled = false;
      const nextModal = pendingDetailModal;
      pendingDetailModal = null;
      if (nextModal) scanDetailModal(nextModal);
    });
  }

  function isPotentialDetailModal(element) {
    if (!(element instanceof Element) || element.closest('#xynigo-dxm-drawer-root')) return false;
    const text = Core.normalizeText(element.textContent || '');
    return text.includes('包裹') && text.includes('详情') && text.includes('审核');
  }

  function addDetailModalCandidates(candidates, element, scanDescendants = false) {
    if (!(element instanceof Element) || element.closest('#xynigo-dxm-drawer-root')) return false;
    const closestModal = element.closest(DETAIL_MODAL_SELECTOR);
    if (closestModal) candidates.add(closestModal);
    if (element.matches(DETAIL_MODAL_SELECTOR)) candidates.add(element);
    if (scanDescendants) {
      element.querySelectorAll(DETAIL_MODAL_SELECTOR).forEach((candidate) => candidates.add(candidate));
    }
    return true;
  }

  function chooseVisibleDetailModal(candidates) {
    return Array.from(candidates)
      .filter(isPotentialDetailModal)
      .filter(isVisible)
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      })[0] || null;
  }

  function mutationMayAffectModalVisibility(mutation, modal) {
    if (mutation.type !== 'attributes') return false;
    const target = mutation.target;
    return target === modal || (target instanceof Element && target.contains(modal));
  }

  function handlePageMutations(mutations) {
    const activeModal = currentContext?.modal;
    if (activeModal) {
      if (!activeModal.isConnected) {
        currentContext = null;
        discardDetachedDrawer();
      } else if (mutations.some((mutation) => mutationMayAffectModalVisibility(mutation, activeModal))
        && !isVisible(activeModal)) {
        currentContext = null;
        closeDrawer();
      }
    }

    const candidates = new Set();
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') {
        addDetailModalCandidates(candidates, mutation.target);
        return;
      }
      if (!mutation.addedNodes.length) return;
      addDetailModalCandidates(candidates, mutation.target);
      mutation.addedNodes.forEach((node) => addDetailModalCandidates(candidates, node, true));
    });
    const modal = chooseVisibleDetailModal(candidates);
    if (modal) scheduleImmediateDetailScan(modal);
  }

  function findDetailModal() {
    return chooseVisibleDetailModal(document.querySelectorAll(DETAIL_MODAL_SELECTOR));
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

  function extractDianxiaomiOrderTime(platformOrderNo) {
    const normalizedOrderNo = Core.normalizeText(platformOrderNo).toUpperCase();
    if (!normalizedOrderNo) return '';
    const row = Array.from(document.querySelectorAll('tr')).find((candidate) => (
      candidate.querySelector('.order-time-list')
      && Core.normalizeText(candidate.innerText || candidate.textContent || '').toUpperCase().includes(normalizedOrderNo)
    ));
    if (!row) return '';
    const timeText = Array.from(row.querySelectorAll('.order-time-list-item'))
      .map((item) => Core.normalizeText(item.innerText || item.textContent || ''))
      .find((value) => /^下单[：:]/.test(value)) || '';
    const match = timeText.match(/下单[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?/);
    return match ? `${match[1]} ${match[2]}:${match[3] || '00'}` : '';
  }

  function normalizeRecipientLabel(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\s：:]/g, '');
  }

  function extractRecipientInfo(modal) {
    const values = new Map();
    Array.from(modal.querySelectorAll('label.form-origin-item-label')).forEach((label) => {
      const key = normalizeRecipientLabel(label.textContent);
      if (!key) return;
      values.set(key, Core.normalizeText(label.nextElementSibling?.textContent || ''));
    });
    return {
      recipientName: values.get('收件人') || '',
      recipientPhone: values.get('电话') || values.get('手机') || '',
      addressLine1: values.get('地址1') || '',
      addressLine2: values.get('地址2') || '',
      city: values.get('城市') || '',
      stateProvince: values.get('州/省') || '',
      postalCode: values.get('邮编') || '',
      country: values.get('国家/地区') || '',
    };
  }

  function missingRecipientFields(info) {
    const required = [
      ['recipientName', '收件人'],
      ['recipientPhone', '电话/手机'],
      ['addressLine1', '地址1'],
      ['city', '城市'],
      ['stateProvince', '州/省'],
      ['postalCode', '邮编'],
    ];
    return required.filter(([field]) => !info[field]).map(([, label]) => label);
  }

  function waitForRecipientInfo(modal, timeoutMs = 2000) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const info = extractRecipientInfo(modal);
        if (!missingRecipientFields(info).length || Date.now() - startedAt >= timeoutMs) {
          resolve(info);
          return;
        }
        setTimeout(check, 40);
      };
      check();
    });
  }

  function findActiveNativeItem(nativeItems) {
    return nativeItems.find((item) => (
      item.getAttribute('aria-selected') === 'true'
      || /(^|\s)(?:isActive|active|selected|mock-active)(?:\s|$)/i.test(item.className || '')
    )) || null;
  }

  async function hydrateRecipientInfo(context, nativeItems) {
    let info = extractRecipientInfo(context.modal);
    let missing = missingRecipientFields(info);
    const addressTab = nativeItems[0] || null;
    const originalTab = findActiveNativeItem(nativeItems);

    if (missing.length && addressTab && originalTab !== addressTab) {
      addressTab.click();
      try {
        info = await waitForRecipientInfo(context.modal);
        missing = missingRecipientFields(info);
      } finally {
        if (originalTab?.isConnected && originalTab !== addressTab) {
          originalTab.click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
      }
    }
    if (missing.length) {
      throw new Error(`店小秘收货地址未读取完整：${missing.join('、')}`);
    }
    Object.assign(context.order, info);
    return info;
  }

  function extractProducts(modal) {
    const rows = Array.from(modal.querySelectorAll('tr'));
    const products = Core.extractProductRows(rows.map((row) => ({
      rowText: row.innerText || row.textContent || '',
      cellTexts: Array.from(row.querySelectorAll('td')).map((cell) => (
        cell.innerText || cell.textContent || ''
      )),
      productImageUrl: extractProductImageUrl(row),
    })));

    if (!products.length) {
      products.push({
        sellerSku: '未识别商品',
        variant: '请手工确认商品与规格',
        productImageUrl: '',
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

  function extractProductImageUrl(row) {
    const image = row?.querySelector?.('img');
    if (!image) return '';
    const candidates = [
      image.currentSrc,
      image.getAttribute('src'),
      image.getAttribute('data-src'),
      image.getAttribute('data-original'),
      image.getAttribute('data-lazy-src'),
    ];
    for (const candidate of candidates) {
      const normalized = Core.normalizeProductImageUrl(candidate, location.href);
      if (normalized) return normalized;
    }
    return '';
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
      dianxiaomiOrderTime: extractDianxiaomiOrderTime(identity.platformOrderNo),
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

  function isDraftRecord(record) {
    return Boolean(record);
  }

  function isRemoteSyncedRecord(record) {
    return Boolean(record && ['draft', 'submitted'].includes(record.remoteSubmissionStatus));
  }

  function isSubmittedRecord(record) {
    return Boolean(record && record.remoteSubmissionStatus === 'submitted');
  }

  function updateDetailControls(context) {
    const record = getRecordForContext(context);
    const state = isRemoteSyncedRecord(record) ? 'synced' : (isDraftRecord(record) ? 'draft' : 'empty');
    const purchaseTab = context.modal.querySelector('.xynigo-dxm-purchase-tab');
    if (purchaseTab) {
      purchaseTab.dataset.state = state;
      purchaseTab.setAttribute('title', state === 'synced'
        ? (isSubmittedRecord(record)
          ? '采购单已正式提交，点击查看'
          : '采购草稿已保存到 Xynigo，点击查看或修改')
        : (state === 'draft' ? '采购单仅有本地待重试草稿，点击继续编辑' : '采购单未录入，点击录入'));
    }
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
    const existingTab = context.modal.querySelector('.xynigo-dxm-purchase-tab');
    if (existingTab) {
      updateDetailControls(context);
      if (!currentEmbedded && existingTab.dataset.recipientLoading !== 'true') existingTab.click();
      return;
    }
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
    tab.dataset.recipientLoading = 'true';
    tabInfo.group.appendChild(tab);

    const hydrationPromise = hydrateRecipientInfo(context, nativeItems)
      .finally(() => { delete tab.dataset.recipientLoading; });
    const activate = async (event) => {
      event?.preventDefault();
      event?.stopPropagation();
      if (currentEmbedded?.modal === context.modal) return;
      try {
        await hydrationPromise;
        const refreshed = parseContext(context.modal);
        Object.assign(refreshed.order, Core.normalizeRecipientInfo(context.order));
        refreshed.order.country = context.order.country || refreshed.order.country;
        try {
          await reconcileRemoteOrder(refreshed);
        } catch (remoteError) {
          if (remoteError?.code === 'extension_context_invalidated') throw remoteError;
          showToast(`云端状态回查失败，将显示本地记录：${remoteError?.message || '请稍后重试'}`, 'warning');
        }
        openEmbeddedEditor(refreshed, tabInfo.group, nativeItems, tab);
      } catch (error) {
        showToast(error?.message || '店小秘收件人信息读取失败', 'error');
      }
    };
    tab.addEventListener('click', activate);
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    nativeItems.forEach((item) => item.addEventListener('click', () => {
      if (currentEmbedded?.modal === context.modal) closeDrawer();
    }, true));
    updateDetailControls(context);
    if (document.contains(tab)
      && isVisible(context.modal)
      && (!currentEmbedded || currentEmbedded.modal === context.modal)) {
      activate();
    }
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

    const host = createElement('section', 'xynigo-dxm-inline-host');
    host.setAttribute('aria-label', '运营采购助手录单卡片');
    actionBar.parentElement.insertBefore(host, actionBar);
    const drawerRoot = openDrawer(context, host);
    if (!drawerRoot) {
      host.remove();
      return;
    }
    drawerRoot.classList.add('xynigo-dxm-inline-root');
  }

  function scanDetailModal(modal) {
    if (!modal?.isConnected || !isPotentialDetailModal(modal) || !isVisible(modal)) return;
    if (currentContext?.modal === modal && modal.querySelector('.xynigo-dxm-purchase-tab')) {
      updateDetailControls(currentContext);
      return;
    }
    if (currentEmbedded && currentEmbedded.modal !== modal) closeDrawer();
    currentContext = parseContext(modal);
    injectDetailControls(currentContext);
    injectEmbeddedTab(currentContext);
  }

  function scanPage() {
    const modal = findDetailModal();
    if (modal) scanDetailModal(modal);
    else if (currentContext || currentEmbedded) {
      currentContext = null;
      closeDrawer();
    }
  }

  function closeDrawer() {
    if (currentDrawer) {
      const embeddedHost = currentDrawer.closest('.xynigo-dxm-embedded-host');
      const inlineHost = currentDrawer.closest('.xynigo-dxm-inline-host');
      if (embeddedHost) embeddedHost.remove();
      else if (inlineHost) inlineHost.remove();
      else currentDrawer.remove();
      currentDrawer = null;
    }
    if (currentEmbedded) {
      restoreEmbeddedTabs(currentEmbedded);
      currentEmbedded = null;
    }
  }

  function discardDetachedDrawer() {
    if (currentEmbedded) {
      if (currentEmbedded.syncFrame) cancelAnimationFrame(currentEmbedded.syncFrame);
      currentEmbedded.resizeObserver?.disconnect();
    }
    if (currentDrawer?.isConnected) {
      const mountedHost = currentDrawer.closest('.xynigo-dxm-embedded-host, .xynigo-dxm-inline-host');
      if (mountedHost) mountedHost.remove();
      else currentDrawer.remove();
    }
    currentDrawer = null;
    currentEmbedded = null;
  }

  function findNativeDetailClose(modal) {
    const closeSelectors = [
      '.ant-modal-close',
      '.el-dialog__headerbtn',
      '.ivu-modal-close',
      '.layui-layer-close',
      'button[aria-label="Close"]',
      'button[aria-label="关闭"]',
    ];
    for (const selector of closeSelectors) {
      const action = Array.from(modal.querySelectorAll(selector))
        .find((element) => isVisible(element) && !element.closest('#xynigo-dxm-drawer-root'));
      if (action) return action;
    }
    return Array.from(modal.querySelectorAll('button, a, [role="button"]'))
      .find((element) => isVisible(element)
        && !element.closest('#xynigo-dxm-drawer-root')
        && normalizeActionText(element) === '关闭') || null;
  }

  function hasSeparateVisibleDialog(modal) {
    return Array.from(document.querySelectorAll(DIALOG_ROOT_SELECTOR))
      .some((candidate) => candidate !== modal
        && !modal.contains(candidate)
        && !candidate.contains(modal)
        && isVisible(candidate));
  }

  function handleDetailEscape(event) {
    const isEscape = event.key === 'Escape' || event.key === 'Esc' || event.keyCode === 27;
    if (!isEscape
      || event.defaultPrevented
      || event.repeat
      || event.isComposing
      || detailCloseInProgress) return;
    const modal = currentContext?.modal;
    if (!modal?.isConnected || !isVisible(modal) || hasSeparateVisibleDialog(modal)) return;
    const nativeClose = findNativeDetailClose(modal);
    if (!nativeClose) return;

    detailCloseInProgress = true;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    nativeClose.click();
    setTimeout(() => {
      detailCloseInProgress = false;
    }, 600);
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

  function openDrawer(context, mountTarget = document.documentElement) {
    closeDrawer();
    const existing = getRecordForContext(context);
    const revisingSubmitted = isSubmittedRecord(existing);
    let activeRecord = existing;
    const liveProductsByKey = new Map(context.products.map((item) => (
      [`${item.sellerSku || ''}|${item.variant || ''}`, item]
    )));
    const baseItems = existing?.items?.length
      ? existing.items.map((item, index) => {
        const live = liveProductsByKey.get(`${item.sellerSku || ''}|${item.variant || ''}`)
          || context.products[index];
        return {
          ...item,
          productImageUrl: Core.normalizeProductImageUrl(item.productImageUrl)
            || live?.productImageUrl
            || '',
        };
      })
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
    const headerState = isRemoteSyncedRecord(existing)
      ? (revisingSubmitted ? '已正式提交·采购未认领前可修改' : 'Xynigo 云端草稿·可修改')
      : (isDraftRecord(existing) ? '本地草稿待重试' : '待录入');
    headerText.append(
      createElement('strong', '', '运营采购助手'),
      createElement('span', '', `${headerState} · ${context.order.packageId || context.order.platformOrderNo || '当前订单'}`),
    );
    const close = createElement('button', 'xynigo-dxm-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeDrawer);
    header.append(headerText, close);
    drawer.appendChild(header);

    const mode = createElement('div', 'xynigo-dxm-dev-mode');
    mode.innerHTML = '<strong>Xynigo 统一身份</strong><span>云端提交成功后仅填入一条 XYP2 客服备注；不自动保存，不控制店小秘审核</span>';
    drawer.appendChild(mode);

    const orderMeta = createElement('div', 'xynigo-dxm-order-meta');
    const storeAssignment = Core.parseStoreAssignment(context.order.storeName);
    const metaValues = [
      ['平台订单号', context.order.platformOrderNo || '未识别'],
      ['店铺 / 运营', `${storeAssignment.storeBaseName || '未识别'} / ${storeAssignment.operatorName || '待识别'}`],
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
        profitValue.textContent = `${metrics.currency} ${metrics.estimatedProfit.toFixed(2)}`;
        profitMarginValue.textContent = `${metrics.profitMargin.toFixed(2)}%`;
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
      } else {
        profitSummary.dataset.state = 'pending';
        profitMarginSummary.dataset.state = 'pending';
        profitValue.textContent = '—';
        profitMarginValue.textContent = '—';
        const pendingProfitExplanation = `利润 = 包裹总金额 - 预估采购成本。当前暂不可计算：${metrics.reason}。`;
        setHelpText(profitHelp, pendingProfitExplanation);
        setHelpText(profitMarginHelp, `利润率 = 预估利润 ÷ 包裹总金额 × 100%。当前暂不可计算：${metrics.reason}。`);
        const pendingPurchaseExplanation = `采购总额 = 商品指导总额 + 预计凑单金额。当前暂不可计算：${metrics.reason}。最终成本以采购表实际下单金额为准。`;
        setHelpText(purchaseHelp, pendingPurchaseExplanation);
      }
      const metricValues = [purchaseValue, profitValue, profitMarginValue];
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
        productImageUrl: '',
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
    const initialStatusText = isRemoteSyncedRecord(existing)
      ? `${revisingSubmitted ? '已正式提交·可修订' : '云端草稿已保存'} · ${existing.items?.length || 0}件`
      : (isDraftRecord(existing) ? `本地草稿待重试 · ${existing.items?.length || 0}件` : '未录入');
    const status = createElement('span', 'xynigo-dxm-submit-status', initialStatusText);
    status.dataset.state = isRemoteSyncedRecord(existing) ? 'synced' : (isDraftRecord(existing) ? 'draft' : 'empty');
    status.title = existing
      ? (isRemoteSyncedRecord(existing) ? '状态来源：Xynigo 采购服务' : '状态来源：浏览器本地待重试草稿')
      : '未查询到当前订单的本地采购记录';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const footerInfo = createElement('div', 'xynigo-dxm-footer-info');
    footerInfo.append(purchaseSummary, profitSummary, profitMarginSummary);
    const save = createElement('button', 'xynigo-dxm-secondary xynigo-dxm-footer-save', '保存采购单');
    save.type = 'button';
    const submit = createElement('button', 'xynigo-dxm-primary xynigo-dxm-footer-submit', '提交采购单');
    submit.type = 'button';
    const copySubmittedRemark = createElement(
      'button',
      'xynigo-dxm-secondary xynigo-dxm-footer-copy-remark',
      '复制已提交XYP2',
    );
    copySubmittedRemark.type = 'button';
    copySubmittedRemark.hidden = !revisingSubmitted;
    copySubmittedRemark.title = '用于云端已提交但客服备注未写入的恢复场景；不会自动新增或保存备注';
    if (revisingSubmitted) {
      save.hidden = true;
      submit.textContent = '提交修改';
      submit.title = '采购尚未被认领时可修改原采购单；不会新增第二条客服备注';
      status.title = '修改后直接提交；采购已认领或进入执行时云端会拒绝修改';
    }

    function syncItemsFromForm(showValidation) {
      const lineElements = Array.from(lineList.querySelectorAll('.xynigo-dxm-line'));
      let allValid = true;
      lineElements.forEach((line, index) => {
        items[index].purchaseLink = line.querySelector('[data-field="purchaseLink"]').value.trim();
        items[index].mainSpec = line.querySelector('[data-field="mainSpec"]').value.trim();
        items[index].subSpec = line.querySelector('[data-field="subSpec"]').value.trim();
        items[index].guidePrice = line.querySelector('[data-field="guidePrice"]').value;
        items[index].purchaseCurrency = line.querySelector('[data-field="purchaseCurrency"]').value;
        const purchaseQtyValue = line.querySelector('[data-field="purchaseQty"]').value;
        items[index].purchaseQty = purchaseQtyValue === '' ? '' : Number(purchaseQtyValue);
        if (!showValidation) return;
        const result = Core.validatePurchaseItem(items[index]);
        const message = line.querySelector('.xynigo-dxm-line-message');
        message.dataset.tone = result.ok ? (result.parsedLink.warning ? 'warning' : 'ok') : 'error';
        message.textContent = result.ok ? (result.parsedLink.warning || `已解析 goods_id ${result.parsedLink.goodsId}`) : result.reason;
        line.querySelector('[data-field="purchaseLink"]').classList.toggle('xynigo-dxm-field-error', !result.parsedLink.ok);
        line.querySelector('[data-field="guidePrice"]').classList.toggle('xynigo-dxm-field-error', !result.ok && result.reason.includes('指导价'));
        line.querySelector('[data-field="purchaseQty"]').classList.toggle('xynigo-dxm-field-error', !result.ok && result.reason.includes('数量'));
        allValid = allValid && result.ok;
      });
      return allValid;
    }

    copySubmittedRemark.addEventListener('click', async () => {
      const submittedRecord = activeRecord && isSubmittedRecord(activeRecord) ? activeRecord : existing;
      try {
        const xyp2Remark = Core.createXyp2Remark(submittedRecord);
        if (!xyp2Remark.ok) throw new Error(xyp2Remark.reason);
        await copyTextToClipboard(xyp2Remark.text);
        showToast('已复制云端提交版本的 XYP2；请先检查客服备注，确认不存在后再手工粘贴并保存一次', 'warning');
      } catch (error) {
        showToast(error?.message || '已提交 XYP2 复制失败', 'error');
      }
    });

    function prepareDraft(record) {
      const nowIso = new Date().toISOString();
      record.createdAt = activeRecord?.createdAt || record.createdAt || nowIso;
      record.updatedAt = nowIso;
      return record;
    }

    async function persistRecord(record) {
      const localRecord = Core.withoutRecipientInfo(record);
      const storageKey = `${RECORD_PREFIX}${localRecord.orderKey}`;
      await storageSet({ [storageKey]: localRecord });
      recordsByKey.set(localRecord.orderKey, localRecord);
      if (localRecord.packageId) recordsByPackage.set(localRecord.packageId.toUpperCase(), localRecord);
      activeRecord = localRecord;
      updateDetailControls(context);
      return localRecord;
    }

    async function syncPurchaseOrder(draft, messageType, expectedSubmissionStatus) {
      const remote = await sendRuntimeMessage({ type: messageType, draft });
      if (remote.orderKey !== draft.orderKey
        || remote.submissionStatus !== expectedSubmissionStatus
        || !Number.isInteger(remote.draftRevision)) {
        throw new Error('Xynigo 未返回完整的采购单结果');
      }
      const stored = {
        ...(remote.draft || draft),
        remotePurchaseOrderId: remote.purchaseOrderId,
        remoteSubmissionStatus: remote.submissionStatus,
        remoteSyncStatus: remote.syncStatus,
        remoteDraftRevision: remote.draftRevision,
        remoteContentHash: remote.contentHash,
        remoteSavedAt: remote.savedAt,
        remoteSubmittedAt: remote.submittedAt,
        remoteSubmittedBy: remote.submittedBy,
        remoteUnchanged: Boolean(remote.unchanged),
        remoteRevised: Boolean(remote.revised),
      };
      const localRecord = await persistRecord(stored);
      return { remote, stored: localRecord };
    }

    async function cacheFailedDraft(draft, error, operation) {
      try {
        await persistRecord({
          ...draft,
          remoteSyncStatus: operation === 'submit' ? 'submit-failed' : 'draft-save-failed',
          remoteError: error?.message || '写入失败',
        });
      } catch (_storageError) {
        // The visible form remains open, so the operator can still retry without losing inputs.
      }
    }

    save.addEventListener('click', async () => {
      syncItemsFromForm(false);
      save.disabled = true;
      submit.disabled = true;
      save.classList.add('xynigo-dxm-busy');
      submit.classList.add('xynigo-dxm-busy');
      status.dataset.state = 'syncing';
      status.textContent = '正在保存云端草稿…';
      status.title = '正在通过 Xynigo 统一身份保存采购草稿';
      let draft;
      try {
        draft = prepareDraft(Core.createPurchaseDraft(context.order, items));
        const { remote } = await syncPurchaseOrder(draft, SAVE_DRAFT_MESSAGE, 'draft');
        status.dataset.state = 'synced';
        status.textContent = `云端草稿已保存 · ${draft.items.length}件`;
        status.title = `Xynigo 草稿版本 ${remote.draftRevision}；同步状态 ${remote.syncStatus || '待处理'}`;
        showToast('采购草稿已保存到 Xynigo', 'success');
      } catch (error) {
        if (draft) await cacheFailedDraft(draft, error, 'draft');
        status.dataset.state = 'error';
        status.textContent = '保存失败';
        status.title = error?.message || '草稿保存失败，请重试';
        showToast(status.title, 'error');
      } finally {
        save.disabled = false;
        submit.disabled = false;
        save.classList.remove('xynigo-dxm-busy');
        submit.classList.remove('xynigo-dxm-busy');
      }
    });

    submit.addEventListener('click', async () => {
      const allValid = syncItemsFromForm(true);

      if (!allValid) {
        status.dataset.state = 'error';
        status.textContent = '明细未完成';
        status.title = '表单校验未通过，请根据明细行提示修正';
        showToast('请先修正采购明细', 'error');
        return;
      }

      let draft;
      let xyp2Remark;
      try {
        draft = prepareDraft(Core.createValidatedPurchaseDraft(context.order, items));
        xyp2Remark = Core.createXyp2Remark(draft);
        if (!xyp2Remark.ok) throw new Error(xyp2Remark.reason);
        await copyTextToClipboard(xyp2Remark.text);
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = 'XYP2 生成失败';
        status.title = error?.message || 'XYP2 备注生成失败';
        showToast(status.title, 'error');
        return;
      }

      save.disabled = true;
      submit.disabled = true;
      save.classList.add('xynigo-dxm-busy');
      submit.classList.add('xynigo-dxm-busy');
      status.dataset.state = 'syncing';
      status.textContent = `${revisingSubmitted ? '正在提交修改' : '正在正式提交'}… · XYP2 ${xyp2Remark.length}/${xyp2Remark.maxLength}`;
      status.title = revisingSubmitted
        ? '已复制更新后的 XYP2，正在校验采购单是否仍可修改'
        : '已复制 XYP2 客服备注，正在通过 Xynigo 统一身份提交采购单';
      try {
        const { remote } = await syncPurchaseOrder(draft, SUBMIT_MESSAGE, 'submitted');
        status.dataset.state = 'synced';
        status.textContent = remote.revised ? '采购明细已更新 · XYP2已复制' : '已正式提交 · XYP2已复制';
        status.title = `Xynigo 采购单版本 ${remote.draftRevision}；XYP2 ${xyp2Remark.length}/${xyp2Remark.maxLength} 字`;
        closeDrawer();
        scheduleScan();
        if (revisingSubmitted) {
          showRemarkProgress('采购明细已提交，正在检查原客服备注，请勿重复操作（预计 3–8 秒）…');
          let remarkUpdate = await updateExistingNativeXyp2Remark(context, xyp2Remark, showRemarkProgress)
            .catch((remarkError) => ({
              ok: false,
              reason: remarkError?.message || '自动修改原客服备注失败',
            }));
          let recreatedRemark = false;
          if (!remarkUpdate.ok && remarkUpdate.code === 'remark_not_found') {
            showRemarkProgress('原客服备注不存在，正在重新打开备注并填写 XYP2，请勿重复操作（预计 2–5 秒）…');
            remarkUpdate = await prefillNativeRemark(context, xyp2Remark, showRemarkProgress)
              .catch((remarkError) => ({
                ok: false,
                reason: remarkError?.message || '原客服备注已删除，但重新填写失败',
              }));
            recreatedRemark = remarkUpdate.ok;
          }
          showToast(
            remarkUpdate.ok
              ? (recreatedRemark
                ? '采购明细已提交；原客服备注不存在，已重新填写一条，请核对后保存'
                : (remote.revised
                  ? '采购明细和原客服备注已自动更新'
                  : '采购单内容未变化，原客服备注已同步'))
              : `采购明细${remote.revised ? '已更新' : '未变化'}；客服备注自动修改失败：${remarkUpdate.reason}。XYP2 已复制，可再次点击提交修改重试`,
            remarkUpdate.ok ? 'success' : 'warning',
          );
          return;
        }
        if (remote.unchanged) {
          showToast('该采购单之前已正式提交，本次未再新增客服备注', 'warning');
          return;
        }
        showRemarkProgress('采购单已提交，正在打开客服备注并填写 XYP2，请勿重复操作（预计 2–5 秒）…');
        const remarkResult = await prefillNativeRemark(context, xyp2Remark, showRemarkProgress)
          .catch((remarkError) => ({ ok: false, reason: remarkError?.message || '自动填入客服备注失败' }));
        showToast(
          remarkResult.ok
            ? `采购单已提交；XYP2 ${remarkResult.length}/${xyp2Remark.maxLength} 字已填入，请核对后点击店小秘保存`
            : `采购单已提交；${remarkResult.reason}。XYP2已复制，请手工粘贴`,
          remarkResult.ok ? 'success' : 'warning',
        );
      } catch (error) {
        const extensionInvalidated = error?.code === 'extension_context_invalidated';
        if (draft && !extensionInvalidated) await cacheFailedDraft(draft, error, 'submit');
        status.dataset.state = 'error';
        status.textContent = extensionInvalidated
          ? '插件已更新 · 请刷新店小秘页面'
          : (revisingSubmitted ? '修改失败 · 原采购单未变化' : '提交失败 · 未写入客服备注');
        status.title = `${error?.message || '云端提交失败'}；XYP2 ${xyp2Remark.length}/${xyp2Remark.maxLength} 字已复制，未写入店小秘`;
        save.disabled = extensionInvalidated;
        submit.disabled = extensionInvalidated;
        save.classList.remove('xynigo-dxm-busy');
        submit.classList.remove('xynigo-dxm-busy');
        showToast(
          extensionInvalidated
            ? '插件刚刚已更新，本次未送达云端、未写入客服备注；请刷新当前店小秘页面后重试'
            : `${revisingSubmitted ? '采购明细修改失败，原采购单未变化' : '云端提交失败，未写入客服备注'}；${error?.message || '请重试'}`,
          'error',
          revisingSubmitted && !extensionInvalidated
            ? { durationMs: IMPORTANT_ERROR_TOAST_MS }
            : undefined,
        );
      }
    });

    footer.append(footerInfo, status, copySubmittedRemark, save, submit);
    drawer.appendChild(footer);
    backdrop.addEventListener('click', closeDrawer);
    mountTarget.appendChild(root);
    currentDrawer = root;
    setTimeout(() => root.classList.add('xynigo-dxm-drawer-open'), 0);
    return root;
  }

  function openEmbeddedEditor(context, tabGroup, nativeItems, tab) {
    const region = findDetailContentRegion(context.modal, tabGroup);
    if (!region) {
      if (!context.modal.isConnected || !isVisible(context.modal)) return;
      openDrawer(context);
      return;
    }

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
    region.appendChild(host);
    const drawerRoot = openDrawer(context, host);
    if (!drawerRoot) {
      host.remove();
      return;
    }
    region.classList.add('xynigo-dxm-embedded-anchor');
    const container = region.closest('.order-detail-content') || region.parentElement;
    container?.classList.add('xynigo-dxm-expanded-detail-container');
    const headerState = updateEmbeddedHeader(container, nativeItems);
    tab.classList.add('xynigo-dxm-purchase-tab-active');
    nativeItems.forEach((item) => item.classList.add('xynigo-dxm-native-tab-muted'));
    drawerRoot.classList.add('xynigo-dxm-embedded-root');
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

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== 'local') return;
    loadState().then(() => {
      if (currentContext?.modal?.isConnected) updateDetailControls(currentContext);
    }).catch(() => {});
  });

  function start() {
    if (started || !document.documentElement) return;
    started = true;
    const observer = new MutationObserver(handlePageMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('hashchange', scheduleScan);
    window.addEventListener('keydown', handleDetailEscape, true);
    scheduleScan();
    loadState().then(() => {
      scheduleScan();
    }).catch(() => {});
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
})();

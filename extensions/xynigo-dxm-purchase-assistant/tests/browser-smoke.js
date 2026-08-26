'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const fixturePath = path.join(__dirname, 'fixtures', 'order-detail.html');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });

  try {
    await context.addInitScript(() => {
      const values = {};
      globalThis.__xynigoStoredValues = values;
      const listeners = [];
      globalThis.__xynigoDraftRequests = [];
      globalThis.__xynigoClipboardWrites = [];
      globalThis.__xynigoRejectSubmit = false;
      globalThis.__xynigoSubmittedDraft = null;
      globalThis.__xynigoSubmittedRevision = 0;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          async writeText(value) {
            globalThis.__xynigoClipboardWrites.push(String(value));
          },
        },
      });
      globalThis.chrome = {
        runtime: {
          lastError: null,
          sendMessage(message, callback) {
            if (message?.type === 'xynigo-dxm:get-order') {
              const draft = globalThis.__xynigoSubmittedDraft;
              if (!draft) {
                callback({
                  ok: false,
                  error: { code: 'purchase_order_not_found', message: '采购单不存在' },
                });
                return;
              }
              callback({
                ok: true,
                data: {
                  purchaseOrderId: 'synthetic-purchase-order-id',
                  orderKey: draft.orderKey,
                  submissionStatus: 'submitted',
                  syncStatus: 'pending',
                  draftRevision: globalThis.__xynigoSubmittedRevision,
                  contentHash: 'synthetic-content-hash',
                  savedAt: '2026-08-24 12:00:00',
                  submittedAt: '2026-08-24 12:01:00',
                  submittedBy: { id: 'synthetic-user-id', name: '合成测试用户' },
                  unchanged: true,
                  revised: false,
                  draft: JSON.parse(JSON.stringify(draft)),
                },
              });
              return;
            }
            if (!['xynigo-dxm:save-draft', 'xynigo-dxm:submit'].includes(message?.type)) {
              callback({ ok: false, error: { message: '未知测试消息' } });
              return;
            }
            const draft = JSON.parse(JSON.stringify(message.draft));
            globalThis.__xynigoDraftRequests.push({ type: message.type, draft });
            const submitted = message.type === 'xynigo-dxm:submit';
            if (submitted && globalThis.__xynigoRejectSubmit) {
              callback({ ok: false, error: { message: '飞书登录已失效，请重新登录' } });
              return;
            }
            const previousSubmitted = globalThis.__xynigoSubmittedDraft;
            const unchanged = submitted && previousSubmitted
              ? JSON.stringify(previousSubmitted) === JSON.stringify(draft)
              : false;
            const revised = Boolean(submitted && previousSubmitted && !unchanged);
            if (submitted && !unchanged) {
              globalThis.__xynigoSubmittedDraft = draft;
              globalThis.__xynigoSubmittedRevision += 1;
            }
            callback({
              ok: true,
              data: {
                purchaseOrderId: 'synthetic-purchase-order-id',
                orderKey: draft.orderKey,
                submissionStatus: submitted ? 'submitted' : 'draft',
                syncStatus: 'pending',
                draftRevision: submitted ? globalThis.__xynigoSubmittedRevision : 1,
                contentHash: 'synthetic-content-hash',
                savedAt: '2026-08-24 12:00:00',
                submittedAt: submitted ? '2026-08-24 12:01:00' : null,
                submittedBy: submitted ? { id: 'synthetic-user-id', name: '合成测试用户' } : null,
                unchanged,
                revised,
                draft,
              },
            });
          },
        },
        storage: {
          local: {
            get(_keys, callback) { callback({ ...values }); },
            set(next, callback) {
              Object.assign(values, next);
              callback();
              listeners.forEach((listener) => listener({}, 'local'));
            },
          },
          onChanged: { addListener(listener) { listeners.push(listener); } },
        },
      };
    });
    const page = await context.newPage();
    await page.goto(`file://${fixturePath}`);
    await page.addStyleTag({ path: path.join(root, 'src', 'content.css') });
    await page.addScriptTag({ path: path.join(root, 'src', 'core.js') });
    const nativeLayout = await page.evaluate(() => ({
      contentHeight: document.querySelector('.mock-content').getBoundingClientRect().height,
      productTop: document.querySelector('.mock-detail-body + table').getBoundingClientRect().top,
    }));
    await page.addScriptTag({ path: path.join(root, 'src', 'content.js') });
    await page.waitForSelector('.mock-tabs > .xynigo-dxm-purchase-tab', { timeout: 8000 });
    await page.waitForSelector('.mock-content > .xynigo-dxm-embedded-host', { timeout: 8000 });
    await page.waitForSelector('.order-detail-content__header > .xynigo-dxm-purchase-header-cancel', { timeout: 8000 });
    await page.waitForFunction((layout) => (
      document.querySelector('.mock-content').getBoundingClientRect().height > layout.contentHeight
      && document.querySelector('.mock-detail-body + table').getBoundingClientRect().top > layout.productTop
    ), nativeLayout);
    const placement = await page.evaluate((nativeLayout) => {
      const tabs = Array.from(document.querySelectorAll('.mock-tabs > div'));
      const host = document.querySelector('.xynigo-dxm-embedded-host');
      const content = document.querySelector('.mock-content');
      const expectedFormLeft = tabs[0].parentElement.getBoundingClientRect().right + 6;
      const quantityFields = Array.from(document.querySelectorAll('.xynigo-dxm-qty'));
      return {
        nativeLabels: tabs.slice(0, 4).map((tab) => tab.textContent.trim()),
        purchaseLabel: tabs[4]?.textContent.trim(),
        tabCount: tabs.length,
        insideNativeContent: Boolean(host?.parentElement?.classList.contains('mock-content')),
        formStartsAfterNav: Boolean(host && tabs[0] && host.getBoundingClientRect().left >= tabs[0].parentElement.getBoundingClientRect().right - 1),
        formGapFromTabs: host ? host.getBoundingClientRect().left - tabs[0].parentElement.getBoundingClientRect().right : -1,
        formAlignedToTabs: Boolean(host && Math.abs(host.getBoundingClientRect().left - expectedFormLeft) <= 1),
        formRightWithinNativeRegion: Boolean(host && host.getBoundingClientRect().right <= document.querySelector('.mock-content').getBoundingClientRect().right + 1),
        quantityFieldsWithinForm: quantityFields.every((field) => field.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1),
        headerTitleUpdated: document.querySelector('.order-detail-content__header').textContent.includes('采购明细'),
        nativeHeaderActionHidden: getComputedStyle(document.querySelector('.order-detail-content__header button')).display === 'none',
        headerCancelVisible: getComputedStyle(document.querySelector('.xynigo-dxm-purchase-header-cancel')).display !== 'none',
        headerCancelRightAligned: document.querySelector('.order-detail-content__header').getBoundingClientRect().right
          - document.querySelector('.xynigo-dxm-purchase-header-cancel').getBoundingClientRect().right <= 14,
        noNativeFooterPurchaseControls: !document.querySelector('.xynigo-dxm-purchase-entry, .xynigo-dxm-purchase-badge'),
        noFormFooterCancel: !document.querySelector('.xynigo-dxm-footer-cancel'),
        originalTableStillPresent: Boolean(document.querySelector('.mock-detail-body + table')),
        nativeRegionExpanded: document.querySelector('.mock-content').getBoundingClientRect().height > nativeLayout.contentHeight,
        productAreaMovedWithCard: document.querySelector('.mock-detail-body + table').getBoundingClientRect().top > nativeLayout.productTop,
        noInternalVerticalScroll: getComputedStyle(document.querySelector('.xynigo-dxm-line-list')).overflowY === 'visible',
        embeddedHeaderRemoved: getComputedStyle(document.querySelector('.xynigo-dxm-drawer-header')).display === 'none'
          && getComputedStyle(document.querySelector('.xynigo-dxm-line-progress')).display === 'none',
        productFontAligned: Number.parseFloat(getComputedStyle(document.querySelector('.xynigo-dxm-line-product strong')).fontSize) >= 14,
        injectedRegionBackground: getComputedStyle(host).backgroundColor,
        drawerBackground: getComputedStyle(document.querySelector('.xynigo-dxm-drawer')).backgroundColor,
        saveText: document.querySelector('.xynigo-dxm-footer-save').textContent.trim(),
        submitText: document.querySelector('.xynigo-dxm-footer-submit').textContent.trim(),
        submitBackground: getComputedStyle(document.querySelector('.xynigo-dxm-footer-submit')).backgroundColor,
        purchaseTabBackground: getComputedStyle(tabs[4]).backgroundColor,
        purchaseTabBackgroundImage: getComputedStyle(tabs[4]).backgroundImage,
        purchaseTabTextColor: getComputedStyle(tabs[4]).color,
        purchaseHeaderBackground: getComputedStyle(document.querySelector('.order-detail-content__header')).backgroundColor,
        purchaseHeaderTextColor: getComputedStyle(document.querySelector('.order-detail-content__header')).color,
        purchaseHeaderBorderColor: getComputedStyle(document.querySelector('.order-detail-content__header')).borderTopColor,
        footerBottomGap: Math.max(0, content.getBoundingClientRect().bottom
          - document.querySelector('.xynigo-dxm-drawer-footer').getBoundingClientRect().bottom
          - (Number.parseFloat(getComputedStyle(content).borderBottomWidth) || 0)),
      };
    }, nativeLayout);
    if (JSON.stringify(placement.nativeLabels) !== JSON.stringify(['收货地址', '报关信息', '物流信息', '备注信息'])) {
      throw new Error('原生详情节点顺序被修改');
    }
    if (placement.tabCount !== 5 || placement.purchaseLabel !== '采购明细') throw new Error('未追加采购明细页签');
    if (!placement.insideNativeContent || !placement.formStartsAfterNav || !placement.formAlignedToTabs
      || placement.formGapFromTabs < 5 || placement.formGapFromTabs > 7
      || !placement.formRightWithinNativeRegion || !placement.quantityFieldsWithinForm || !placement.headerTitleUpdated
      || !placement.nativeHeaderActionHidden || !placement.headerCancelVisible || !placement.headerCancelRightAligned
      || !placement.noNativeFooterPurchaseControls || !placement.noFormFooterCancel
      || !placement.originalTableStillPresent || !placement.nativeRegionExpanded || !placement.productAreaMovedWithCard
      || !placement.noInternalVerticalScroll || !placement.embeddedHeaderRemoved || !placement.productFontAligned
      || placement.injectedRegionBackground !== 'rgb(237, 248, 248)'
      || placement.drawerBackground !== 'rgb(237, 248, 248)'
      || placement.saveText !== '保存采购单'
      || placement.submitText !== '提交采购单'
      || placement.submitBackground !== 'rgb(255, 105, 74)'
      || !placement.purchaseTabBackgroundImage.includes('rgb(22, 152, 160)')
      || !placement.purchaseTabBackgroundImage.includes('rgb(78, 139, 169)')
      || placement.purchaseTabTextColor !== 'rgb(255, 255, 255)'
      || placement.purchaseHeaderBackground !== 'rgb(228, 245, 245)'
      || placement.purchaseHeaderTextColor !== 'rgb(11, 49, 94)'
      || placement.purchaseHeaderBorderColor !== 'rgb(191, 227, 227)'
      || placement.footerBottomGap > 2) {
      throw new Error(`采购表单未限定在右侧内容区: ${JSON.stringify(placement)}`);
    }
    const fieldNameBrandStyles = await page.evaluate(() => {
      const colors = (selector) => Array.from(document.querySelectorAll(selector)).map((element) => getComputedStyle(element).color);
      const firstInput = document.querySelector('.xynigo-dxm-field input:not([type="hidden"])');
      const status = document.querySelector('.xynigo-dxm-submit-status');
      return {
        columnHeaders: colors('.xynigo-dxm-line-column-head > span'),
        responsiveLabels: colors('.xynigo-dxm-field > span'),
        drawerTitle: getComputedStyle(document.querySelector('.xynigo-dxm-drawer-header strong')).color,
        drawerSubtitle: getComputedStyle(document.querySelector('.xynigo-dxm-drawer-header span')).color,
        metaLabels: colors('.xynigo-dxm-order-meta span'),
        metaValues: colors('.xynigo-dxm-order-meta strong'),
        progress: getComputedStyle(document.querySelector('.xynigo-dxm-line-progress')).color,
        inputText: getComputedStyle(firstInput).color,
        inputPlaceholder: getComputedStyle(firstInput, '::placeholder').color,
        currency: getComputedStyle(document.querySelector('.xynigo-dxm-currency-badge')).color,
        addLine: getComputedStyle(document.querySelector('.xynigo-dxm-add-line')).color,
        clearLine: getComputedStyle(document.querySelector('.xynigo-dxm-clear-line')).color,
        cancel: getComputedStyle(document.querySelector('.xynigo-dxm-purchase-header-cancel')).color,
        emptyStatus: getComputedStyle(status).color,
        emptyStatusDot: getComputedStyle(status, '::before').backgroundColor,
      };
    });
    if (!fieldNameBrandStyles.columnHeaders.every((color) => color === 'rgb(11, 49, 94)')
      || !fieldNameBrandStyles.responsiveLabels.every((color) => color === 'rgb(11, 49, 94)')
      || fieldNameBrandStyles.drawerTitle !== 'rgb(11, 49, 94)'
      || fieldNameBrandStyles.drawerSubtitle !== 'rgb(53, 111, 145)'
      || !fieldNameBrandStyles.metaLabels.every((color) => color === 'rgb(53, 111, 145)')
      || !fieldNameBrandStyles.metaValues.every((color) => color === 'rgb(11, 49, 94)')
      || fieldNameBrandStyles.progress !== 'rgb(11, 49, 94)'
      || fieldNameBrandStyles.inputText !== 'rgb(11, 49, 94)'
      || fieldNameBrandStyles.inputPlaceholder !== 'rgb(135, 147, 160)'
      || !['currency', 'clearLine', 'cancel'].every((key) => fieldNameBrandStyles[key] === 'rgb(53, 111, 145)')
      || fieldNameBrandStyles.addLine !== 'rgb(22, 152, 160)'
      || fieldNameBrandStyles.emptyStatus !== 'rgb(138, 100, 0)'
      || fieldNameBrandStyles.emptyStatusDot !== 'rgb(242, 183, 71)') {
      throw new Error(`注入字段名称、辅助文字或状态颜色未完整对齐品牌色系: ${JSON.stringify(fieldNameBrandStyles)}`);
    }
    const lines = page.locator('.xynigo-dxm-line');
    if (await lines.count() !== 2) throw new Error('未识别两条订单商品');
    const sequenceSize = await lines.first().locator('.xynigo-dxm-line-product > b').evaluate((badge) => ({
      width: badge.getBoundingClientRect().width,
      height: badge.getBoundingClientRect().height,
    }));
    if (sequenceSize.width !== 26 || sequenceSize.height !== 26) {
      throw new Error(`采购明细序号未缩小为 26×26px: ${JSON.stringify(sequenceSize)}`);
    }
    const sequenceBrandStyle = await lines.first().locator('.xynigo-dxm-line-product > b').evaluate((badge) => ({
      color: getComputedStyle(badge).color,
      backgroundImage: getComputedStyle(badge).backgroundImage,
    }));
    if (sequenceBrandStyle.color !== 'rgb(255, 255, 255)'
      || !sequenceBrandStyle.backgroundImage.includes('rgb(22, 152, 160)')
      || !sequenceBrandStyle.backgroundImage.includes('rgb(78, 139, 169)')) {
      throw new Error(`采购明细序号未使用品牌动作渐变: ${JSON.stringify(sequenceBrandStyle)}`);
    }
    const initialMetricValues = await page.locator('.xynigo-dxm-footer-info .xynigo-dxm-metric-value').allTextContents();
    if (JSON.stringify(initialMetricValues) !== JSON.stringify(['—', '—', '—'])) {
      throw new Error(`汇总数据不可计算时应统一显示横线: ${JSON.stringify(initialMetricValues)}`);
    }
    if (await page.locator('.xynigo-dxm-line-product span').count() !== 0) {
      throw new Error('未移除商品 SKU 下方的页面规格、仓库和销售数量文本');
    }
    const sourceLink = page.locator('.xynigo-dxm-source-product-link').first();
    if (await sourceLink.textContent() !== '60874943'
      || await sourceLink.getAttribute('href') !== 'https://www.shein.com.mx/x-p-60874943.html'
      || await sourceLink.getAttribute('target') !== '_blank'
      || !(await lines.first().locator('.xynigo-dxm-line-product strong').textContent()).includes('MX-60874943-8896')) {
      throw new Error('未正确生成原 SHEIN 货源商品页快捷链接');
    }
    const skuBrandStyle = await lines.first().locator('.xynigo-dxm-line-product strong').evaluate((sku) => ({
      skuColor: getComputedStyle(sku).color,
      linkColor: getComputedStyle(sku.querySelector('.xynigo-dxm-source-product-link')).color,
    }));
    if (skuBrandStyle.skuColor !== 'rgb(53, 111, 145)' || skuBrandStyle.linkColor !== 'rgb(22, 152, 160)') {
      throw new Error(`SKU 其余字符与 goods_id 未使用深科技蓝和小犀动作青: ${JSON.stringify(skuBrandStyle)}`);
    }
    const nineDigitSourceLink = page.locator('.xynigo-dxm-source-product-link').nth(1);
    if (await nineDigitSourceLink.textContent() !== '469433114'
      || await nineDigitSourceLink.getAttribute('href') !== 'https://www.shein.com.mx/x-p-469433114.html'
      || (await lines.nth(1).locator('.xynigo-dxm-line-product strong').textContent()).includes('GSHDEMOITEM')) {
      throw new Error('未在脱敏销售订单号 GSHDEMOITEM 之后正确识别 9 位 goods_id 469433114');
    }
    if (await page.locator('.xynigo-dxm-remove-line').count() !== 0) throw new Error('原订单商品不应允许删除');
    if (await page.locator('.xynigo-dxm-clear-line').count() !== 2) throw new Error('每条原订单商品明细都应提供清空按钮');

    const twoLineProductTop = await page.locator('.mock-detail-body + table').evaluate((element) => element.getBoundingClientRect().top);
    await page.click('.xynigo-dxm-add-line');
    if (await lines.count() !== 3 || await page.locator('.xynigo-dxm-remove-line').count() !== 1) {
      throw new Error('手工明细未提供新增与删除操作');
    }
    if (!(await lines.nth(2).locator('.xynigo-dxm-line-product strong').textContent()).includes('手工明细-1')
      || await page.locator('.xynigo-dxm-clear-line').count() !== 3) {
      throw new Error('第一条手工明细未按“手工明细-1”命名或缺少清空按钮');
    }
    const manualTitleStyle = await lines.nth(2).evaluate((line) => {
      const title = line.querySelector('.xynigo-dxm-manual-line-title');
      const input = line.querySelector('.xynigo-dxm-field input');
      return {
        titleFontSize: getComputedStyle(title).fontSize,
        inputFontSize: getComputedStyle(input).fontSize,
        titleFontWeight: Number.parseInt(getComputedStyle(title).fontWeight, 10),
      };
    });
    if (manualTitleStyle.titleFontSize !== manualTitleStyle.inputFontSize
      || manualTitleStyle.titleFontWeight < 600 || manualTitleStyle.titleFontWeight > 700) {
      throw new Error(`手工明细标题未保持输入框字号或未恢复适度加粗: ${JSON.stringify(manualTitleStyle)}`);
    }
    const manualActionOrder = await lines.nth(2).locator('.xynigo-dxm-line-actions').evaluate((actions) => (
      Array.from(actions.children).map((button) => button.textContent.trim())
    ));
    if (JSON.stringify(manualActionOrder) !== JSON.stringify(['− 删除', '清空'])) {
      throw new Error(`手工明细的删除和清空按钮未完成位置交换: ${JSON.stringify(manualActionOrder)}`);
    }
    const manualActionColors = await lines.nth(2).locator('.xynigo-dxm-line-actions').evaluate((actions) => (
      Array.from(actions.children).map((button) => getComputedStyle(button).color)
    ));
    if (JSON.stringify(manualActionColors) !== JSON.stringify(['rgb(201, 74, 53)', 'rgb(53, 111, 145)'])) {
      throw new Error(`删除与清空操作未分别使用珊瑚语义色和科技蓝: ${JSON.stringify(manualActionColors)}`);
    }
    const manualActionFontSizes = await lines.nth(2).locator('.xynigo-dxm-line-actions').evaluate((actions) => (
      Array.from(actions.children).map((button) => getComputedStyle(button).fontSize)
    ));
    if (new Set(manualActionFontSizes).size !== 1) {
      throw new Error(`手工明细的删除和清空按钮字号不一致: ${JSON.stringify(manualActionFontSizes)}`);
    }
    await page.waitForFunction((previousTop) => (
      document.querySelector('.mock-detail-body + table').getBoundingClientRect().top > previousTop
    ), twoLineProductTop);
    const threeLineProductTop = await page.locator('.mock-detail-body + table').evaluate((element) => element.getBoundingClientRect().top);
    if (threeLineProductTop <= twoLineProductTop) throw new Error('新增手工明细后详情卡未向下扩展');
    await page.click('.xynigo-dxm-remove-line');
    await page.waitForFunction((previousTop) => (
      document.querySelector('.mock-detail-body + table').getBoundingClientRect().top < previousTop
    ), threeLineProductTop);
    const restoredProductTop = await page.locator('.mock-detail-body + table').evaluate((element) => element.getBoundingClientRect().top);
    if (await lines.count() !== 2 || restoredProductTop >= threeLineProductTop) {
      throw new Error('删除手工明细后详情卡未正常回缩');
    }

    const columnLabels = await page.locator('.xynigo-dxm-line-column-head').innerText();
    for (const label of ['采购链接', '主规格', '次规格', '指导价', '采购数量']) {
      if (!columnLabels.includes(label)) throw new Error(`缺少采购表单列：${label}`);
    }
    if (columnLabels.includes('币种')) throw new Error('取消币种选择器后表头不应继续显示币种');

    const urls = [
      'https://www.shein.com.mx/x-p-389696689.html?mallCode=1&goods_id=389696689&skucode=SKU_A&main_attr=27_447#xv=1&p=Multicolor&s=XS&op=410.20&cr=0.65&gp=143.57&c=MXN',
      'https://www.shein.com.mx/x-p-101655130.html?mallCode=1&goods_id=101655130&skucode=SKU_B&main_attr=27_182#xv=1&p=Maroon&s=S&op=176.40&cr=0.5&gp=88.20&c=MXN',
    ];
    for (let index = 0; index < urls.length; index += 1) {
      await lines.nth(index).locator('[data-field="purchaseLink"]').fill(urls[index]);
    }
    const parsedFields = await lines.evaluateAll((elements) => elements.map((line) => ({
      mainSpec: line.querySelector('[data-field="mainSpec"]').value,
      subSpec: line.querySelector('[data-field="subSpec"]').value,
      guidePrice: line.querySelector('[data-field="guidePrice"]').value,
      purchaseCurrency: line.querySelector('[data-field="purchaseCurrency"]').value,
    })));
    if (JSON.stringify(parsedFields) !== JSON.stringify([
      { mainSpec: 'Multicolor', subSpec: 'XS', guidePrice: '143.57', purchaseCurrency: 'MXN' },
      { mainSpec: 'Maroon', subSpec: 'S', guidePrice: '88.20', purchaseCurrency: 'MXN' },
    ])) throw new Error(`未从一行采购链接解析规格与指导价: ${JSON.stringify(parsedFields)}`);
    const parsedMessageColors = await page.locator('.xynigo-dxm-line-message[data-tone="ok"]').evaluateAll((messages) => (
      messages.map((message) => getComputedStyle(message).color)
    ));
    if (parsedMessageColors.length !== 2 || !parsedMessageColors.every((color) => color === 'rgb(33, 128, 92)')) {
      throw new Error(`采购链接解析成功提示未使用可读的品牌成功绿: ${JSON.stringify(parsedMessageColors)}`);
    }
    if (await page.locator('select[data-field="purchaseCurrency"]').count() !== 0
      || await page.locator('input[type="hidden"][data-field="purchaseCurrency"]').count() !== 2
      || JSON.stringify(await page.locator('.xynigo-dxm-currency-badge').allTextContents()) !== JSON.stringify(['MXN', 'MXN'])) {
      throw new Error('币种未改为由链接自动确定的只读标签');
    }
    await lines.first().locator('.xynigo-dxm-clear-line').click();
    const clearedFields = await lines.first().evaluate((line) => ({
      purchaseLink: line.querySelector('[data-field="purchaseLink"]').value,
      mainSpec: line.querySelector('[data-field="mainSpec"]').value,
      subSpec: line.querySelector('[data-field="subSpec"]').value,
      guidePrice: line.querySelector('[data-field="guidePrice"]').value,
      purchaseQty: line.querySelector('[data-field="purchaseQty"]').value,
      purchaseCurrency: line.querySelector('[data-field="purchaseCurrency"]').value,
    }));
    if (JSON.stringify(clearedFields) !== JSON.stringify({
      purchaseLink: '', mainSpec: '', subSpec: '', guidePrice: '', purchaseQty: '2', purchaseCurrency: 'MXN',
    })) throw new Error(`清空按钮未同步清除链接、规格和指导价或错误清除了数量/币种: ${JSON.stringify(clearedFields)}`);
    await lines.first().locator('[data-field="purchaseLink"]').fill(urls[0]);
    await lines.first().locator('[data-field="purchaseLink"]').fill('');
    const cascadeClearedFields = await lines.first().evaluate((line) => [
      line.querySelector('[data-field="mainSpec"]').value,
      line.querySelector('[data-field="subSpec"]').value,
      line.querySelector('[data-field="guidePrice"]').value,
    ]);
    if (JSON.stringify(cascadeClearedFields) !== JSON.stringify(['', '', ''])) {
      throw new Error(`手工清空采购链接时未联动清空规格和指导价: ${JSON.stringify(cascadeClearedFields)}`);
    }
    await lines.first().locator('[data-field="purchaseLink"]').fill(urls[0]);
    if (!(await page.locator('.xynigo-dxm-purchase-summary .xynigo-dxm-metric-value').textContent()).includes('MXN 375.34')) {
      throw new Error('未按指导价乘采购数量汇总单币种采购总额');
    }
    const profitSummary = await page.locator('.xynigo-dxm-profit-summary .xynigo-dxm-metric-value').textContent();
    const profitMarginSummary = await page.locator('.xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-value').textContent();
    if (!profitSummary.includes('MXN 254.66')
      || !profitMarginSummary.includes('40.42%')
      || await page.locator('.xynigo-dxm-roi-summary').count() !== 0) {
      throw new Error(`预估利润指标错误或前端仍展示 ROI: ${profitSummary} / ${profitMarginSummary}`);
    }
    const calculatedMetricBrandStyles = await page.locator('.xynigo-dxm-footer-info').evaluate((footerInfo) => ({
      label: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-metric-label')).color,
      help: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-metric-help')).color,
      helpBorder: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-metric-help')).borderTopColor,
      purchaseValue: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-purchase-summary .xynigo-dxm-metric-value')).color,
      profitValue: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-profit-summary .xynigo-dxm-metric-value')).color,
      marginValue: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-value')).color,
    }));
    if (calculatedMetricBrandStyles.label !== 'rgb(11, 49, 94)'
      || calculatedMetricBrandStyles.help !== 'rgb(53, 111, 145)'
      || calculatedMetricBrandStyles.helpBorder !== 'rgb(78, 139, 169)'
      || !['purchaseValue', 'profitValue', 'marginValue']
        .every((key) => calculatedMetricBrandStyles[key] === 'rgb(52, 183, 131)')) {
      throw new Error(`汇总指标计算值未统一使用品牌成功绿: ${JSON.stringify(calculatedMetricBrandStyles)}`);
    }
    const calculatedTooltips = await page.locator('.xynigo-dxm-profit-summary .xynigo-dxm-metric-help, .xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-help')
      .evaluateAll((helps) => helps.map((help) => help.dataset.tooltip));
    if (!calculatedTooltips[0].includes('计算：MXN 630.00 - MXN 375.34 = MXN 254.66')
      || !calculatedTooltips[1].includes('计算：254.66 ÷ 630.00 × 100% = 40.42%')) {
      throw new Error(`利润或利润率问号未展示完整计算过程: ${JSON.stringify(calculatedTooltips)}`);
    }
    const usdMetadataUrl = urls[0].replace('&c=MXN', '&c=USD');
    await lines.first().locator('[data-field="purchaseLink"]').fill(usdMetadataUrl);
    if (await lines.first().locator('.xynigo-dxm-currency-badge').textContent() !== 'USD') {
      throw new Error('标准采购链接中的币种未自动更新只读标签');
    }
    const mixedCurrencySummary = await page.locator('.xynigo-dxm-purchase-summary .xynigo-dxm-metric-value').textContent();
    if (mixedCurrencySummary !== '—') {
      throw new Error(`多币种无法得到凑单后采购总额时应显示横线: ${mixedCurrencySummary}`);
    }
    const mixedProfit = await page.locator('.xynigo-dxm-profit-summary .xynigo-dxm-metric-value').textContent();
    if (mixedProfit !== '—') throw new Error(`跨币种时预估利润应显示横线: ${mixedProfit}`);
    const pendingTooltips = await page.locator('.xynigo-dxm-profit-summary .xynigo-dxm-metric-help, .xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-help')
      .evaluateAll((helps) => helps.map((help) => help.dataset.tooltip));
    if (!pendingTooltips.every((tooltip) => tooltip.includes('采购与销售币种不一致'))) {
      throw new Error(`数据不可计算时问号未统一展示原因: ${JSON.stringify(pendingTooltips)}`);
    }
    await lines.first().locator('[data-field="purchaseLink"]').fill(urls[0]);
    await lines.first().locator('[data-field="guidePrice"]').fill('30');
    await lines.nth(1).locator('[data-field="guidePrice"]').fill('20');
    const mexicoTopUpSummary = await page.locator('.xynigo-dxm-purchase-summary .xynigo-dxm-metric-value').textContent();
    const mexicoCostTooltip = await page.locator('.xynigo-dxm-purchase-summary .xynigo-dxm-metric-help').getAttribute('data-tooltip');
    if (!mexicoTopUpSummary.includes('MXN 100.00')
      || !mexicoCostTooltip.includes('商品指导总额：MXN 80.00')
      || !mexicoCostTooltip.includes('预计凑单：MXN 20.00（不入采购明细）')
      || !mexicoCostTooltip.includes('凑单后采购总额：MXN 100.00')) {
      throw new Error(`墨西哥包邮凑单口径显示错误: ${mexicoTopUpSummary} / ${mexicoCostTooltip}`);
    }
    const mexicoTopUpProfit = await page.locator('.xynigo-dxm-profit-summary .xynigo-dxm-metric-value').textContent();
    const mexicoTopUpProfitMargin = await page.locator('.xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-value').textContent();
    if (!mexicoTopUpProfit.includes('MXN 530.00') || !mexicoTopUpProfitMargin.includes('84.13%')) {
      throw new Error(`墨西哥凑单预估利润错误: ${mexicoTopUpProfit} / ${mexicoTopUpProfitMargin}`);
    }
    await lines.first().locator('[data-field="guidePrice"]').fill('1234.56');
    await lines.nth(1).locator('[data-field="guidePrice"]').fill('987.65');
    const largeMetricFit = await page.locator('.xynigo-dxm-footer-info').evaluate((footerInfo) => ({
      clientWidth: footerInfo.clientWidth,
      scrollWidth: footerInfo.scrollWidth,
      childrenWithinWidth: Array.from(footerInfo.children).every((child) => (
        child.getBoundingClientRect().right <= footerInfo.getBoundingClientRect().right + 1
      )),
      compactNumbers: Array.from(footerInfo.querySelectorAll('.xynigo-dxm-metric-value'))
        .every((value) => value.dataset.compact === 'true'),
    }));
    if (largeMetricFit.scrollWidth > largeMetricFit.clientWidth + 1
      || !largeMetricFit.childrenWithinWidth || !largeMetricFit.compactNumbers) {
      throw new Error(`较大金额下三项指标发生溢出: ${JSON.stringify(largeMetricFit)}`);
    }
    if (await page.locator('.xynigo-dxm-cost-breakdown, .xynigo-dxm-metric-row').count() !== 0
      || await page.locator('.xynigo-dxm-purchase-summary').evaluate((element) => element.tagName === 'DETAILS')) {
      throw new Error('采购成本不应再使用倒三角或向下折叠面板');
    }
    await lines.first().locator('[data-field="guidePrice"]').fill('143.57');
    await lines.nth(1).locator('[data-field="guidePrice"]').fill('88.20');
    const footerAlignment = await page.locator('.xynigo-dxm-footer-info').evaluate((footerInfo) => {
      const children = Array.from(footerInfo.children);
      const tops = children.map((child) => child.getBoundingClientRect().top);
      return {
        display: getComputedStyle(footerInfo).display,
        sameRow: Math.max(...tops) - Math.min(...tops) <= 2,
      };
    });
    if (footerAlignment.display !== 'grid' || !footerAlignment.sameRow) {
      throw new Error(`底部采购总额、利润与利润率未按固定三列展示: ${JSON.stringify(footerAlignment)}`);
    }
    const footerFit = await page.locator('.xynigo-dxm-footer-info').evaluate((footerInfo) => ({
      clientWidth: footerInfo.clientWidth,
      scrollWidth: footerInfo.scrollWidth,
      childrenWithinWidth: Array.from(footerInfo.children).every((child) => (
        child.getBoundingClientRect().right <= footerInfo.getBoundingClientRect().right + 1
      )),
    }));
    if (footerFit.scrollWidth > footerFit.clientWidth + 1 || !footerFit.childrenWithinWidth) {
      throw new Error(`底部指标在原生右侧内容区内未完整展示: ${JSON.stringify(footerFit)}`);
    }
    const footerOrder = await page.locator('.xynigo-dxm-drawer-footer').evaluate((footer) => {
      const info = footer.querySelector('.xynigo-dxm-footer-info').getBoundingClientRect();
      const status = footer.querySelector('.xynigo-dxm-submit-status').getBoundingClientRect();
      const saveButton = footer.querySelector('.xynigo-dxm-footer-save').getBoundingClientRect();
      const submitButton = footer.querySelector('.xynigo-dxm-footer-submit').getBoundingClientRect();
      const sameRow = Math.abs(info.top - status.top) <= 2;
      return {
        sameRow,
        metricsBeforeActions: sameRow ? info.right <= status.left + 1 : info.bottom <= status.top + 2,
        statusLeftOfSave: status.right <= saveButton.left + 1,
        saveLeftOfSubmit: saveButton.right <= submitButton.left + 1,
      };
    });
    if (!footerOrder.metricsBeforeActions || !footerOrder.statusLeftOfSave || !footerOrder.saveLeftOfSubmit) {
      throw new Error(`汇总指标、采购单状态、保存和提交按钮顺序错误: ${JSON.stringify(footerOrder)}`);
    }
    const metricLabels = await page.locator('.xynigo-dxm-footer-info .xynigo-dxm-metric-label').allTextContents();
    if (JSON.stringify(metricLabels) !== JSON.stringify(['采购总额', '利润', '利润率'])
      || await page.locator('.xynigo-dxm-metric-help').count() !== 3) {
      throw new Error(`底部指标名称或悬浮说明入口错误: ${JSON.stringify(metricLabels)}`);
    }
    const metricChildOrder = await page.locator('.xynigo-dxm-footer-info .xynigo-dxm-metric').evaluateAll((metrics) => (
      metrics.map((metric) => Array.from(metric.children).map((child) => child.className))
    ));
    if (!metricChildOrder.every((classes) => (
      classes[0].includes('xynigo-dxm-metric-label')
      && classes[1].includes('xynigo-dxm-metric-help')
      && classes[2].includes('xynigo-dxm-metric-separator')
      && classes[3].includes('xynigo-dxm-metric-value')
    ))) throw new Error(`问号未统一放在字段名后、冒号前: ${JSON.stringify(metricChildOrder)}`);
    const metricLayout = await page.locator('.xynigo-dxm-footer-info').evaluate((footerInfo) => {
      const value = footerInfo.querySelector('.xynigo-dxm-metric-value');
      const status = document.querySelector('.xynigo-dxm-submit-status');
      return {
        fixedColumnCount: getComputedStyle(footerInfo).gridTemplateColumns.split(' ').length,
        labelFontSize: Number.parseFloat(getComputedStyle(footerInfo.querySelector('.xynigo-dxm-metric-label')).fontSize),
        valueFontSize: Number.parseFloat(getComputedStyle(value).fontSize),
        columnHeaderFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.xynigo-dxm-line-column-head')).fontSize),
        inlineValue: Math.abs(value.getBoundingClientRect().top - footerInfo.querySelector('.xynigo-dxm-metric-label').getBoundingClientRect().top) <= 2,
        footerHeight: footerInfo.closest('.xynigo-dxm-drawer-footer').getBoundingClientRect().height,
        submitHeight: document.querySelector('.xynigo-dxm-footer-submit').getBoundingClientRect().height,
        responsiveTwoRows: footerInfo.getBoundingClientRect().bottom
          <= document.querySelector('.xynigo-dxm-submit-status').getBoundingClientRect().top + 2,
        statusVisible: status.getBoundingClientRect().width > 1 && status.getBoundingClientRect().height > 1,
        statusText: status.textContent.trim(),
        statusHasNoButtonChrome: getComputedStyle(status).backgroundColor === 'rgba(0, 0, 0, 0)'
          && Number.parseFloat(getComputedStyle(status).borderTopWidth) === 0,
        statusDotWidth: Number.parseFloat(getComputedStyle(status, '::before').width),
      };
    });
    if (metricLayout.fixedColumnCount !== 3
      || metricLayout.labelFontSize !== metricLayout.columnHeaderFontSize - 1
      || metricLayout.valueFontSize !== metricLayout.columnHeaderFontSize
      || !metricLayout.inlineValue
      || (!metricLayout.responsiveTwoRows && metricLayout.footerHeight > metricLayout.submitHeight + 12)
      || !metricLayout.statusVisible || metricLayout.statusText !== '未录入'
      || !metricLayout.statusHasNoButtonChrome || metricLayout.statusDotWidth < 6) {
      throw new Error(`底部汇总未按按钮高度、横向数值及小两号字体展示: ${JSON.stringify(metricLayout)}`);
    }
    const nativeAudit = page.locator('.mock-actions button', { hasText: '审核' });
    const auditBefore = await nativeAudit.evaluate((button) => ({
      className: button.className,
      ariaDisabled: button.getAttribute('aria-disabled'),
      disabled: button.disabled,
    }));
    await page.click('.xynigo-dxm-footer-save');
    await page.waitForFunction(() => document.querySelector('.xynigo-dxm-submit-status')?.dataset.state === 'synced');
    const draftState = await page.evaluate(() => ({
      statusText: document.querySelector('.xynigo-dxm-submit-status')?.textContent.trim(),
      tabState: document.querySelector('.xynigo-dxm-purchase-tab')?.dataset.state,
      formStillOpen: Boolean(document.querySelector('.xynigo-dxm-embedded-host')),
      remarkValue: document.querySelector('.mock-note textarea')?.value || '',
      auditClassName: document.querySelector('.mock-actions button')?.className,
      auditAriaDisabled: document.querySelector('.mock-actions button')?.getAttribute('aria-disabled'),
      auditDisabled: document.querySelector('.mock-actions button')?.disabled,
      saveButtonText: document.querySelector('.xynigo-dxm-footer-save')?.textContent.trim(),
      submitButtonText: document.querySelector('.xynigo-dxm-footer-submit')?.textContent.trim(),
      remoteRequests: globalThis.__xynigoDraftRequests.map(({ type, draft }) => ({
        type,
        orderKey: draft.orderKey,
        mode: draft.mode,
        site: draft.site,
        submissionStatus: draft.submissionStatus,
        purchaseStatus: draft.purchaseStatus,
        dianxiaomiOrderTime: draft.dianxiaomiOrderTime,
        originalPrice: draft.items?.[0]?.originalPrice,
        couponType: draft.items?.[0]?.couponType,
        productImageUrl: draft.items?.[0]?.productImageUrl,
        recipientName: draft.recipientName,
        recipientPhone: draft.recipientPhone,
        addressLine1: draft.addressLine1,
        addressLine2: draft.addressLine2,
        city: draft.city,
        stateProvince: draft.stateProvince,
        postalCode: draft.postalCode,
      })),
      localRecords: Object.values(globalThis.__xynigoStoredValues),
      clipboardWrites: globalThis.__xynigoClipboardWrites.length,
    }));
    if (!draftState.statusText.startsWith('云端草稿已保存')
      || draftState.tabState !== 'synced'
      || !draftState.formStillOpen
      || draftState.remarkValue !== ''
      || draftState.auditClassName !== auditBefore.className
      || draftState.auditAriaDisabled !== auditBefore.ariaDisabled
      || draftState.auditDisabled !== auditBefore.disabled
      || draftState.remoteRequests.length !== 1
      || draftState.remoteRequests[0].type !== 'xynigo-dxm:save-draft'
      || draftState.remoteRequests[0].mode !== 'xynigo-extension'
      || draftState.remoteRequests[0].site !== 'MX'
      || draftState.remoteRequests[0].submissionStatus !== 'draft'
      || draftState.remoteRequests[0].purchaseStatus !== 'draft-local'
      || draftState.remoteRequests[0].dianxiaomiOrderTime !== '2026-08-24 10:51:00'
      || draftState.remoteRequests[0].originalPrice !== 410.20
      || draftState.remoteRequests[0].couponType !== '65% 优惠券'
      || draftState.remoteRequests[0].productImageUrl !== 'https://img.ltwebstatic.com/images3_pi/demo-product-01.jpg'
      || draftState.remoteRequests[0].recipientName !== '脱敏收件人'
      || draftState.remoteRequests[0].recipientPhone !== '+1 555 0100'
      || draftState.remoteRequests[0].addressLine1 !== '100 Example Street'
      || draftState.remoteRequests[0].addressLine2 !== 'Unit 2'
      || draftState.remoteRequests[0].city !== 'Example City'
      || draftState.remoteRequests[0].stateProvince !== 'Example State'
      || draftState.remoteRequests[0].postalCode !== '00001-0001'
      || draftState.clipboardWrites !== 0
      || draftState.localRecords.some((record) => [
        'recipientName',
        'recipientPhone',
        'addressLine1',
        'addressLine2',
        'city',
        'stateProvince',
        'postalCode',
      ].some((field) => Object.prototype.hasOwnProperty.call(record, field)))
      || draftState.saveButtonText !== '保存采购单'
      || draftState.submitButtonText !== '提交采购单') {
      throw new Error(`保存采购单未写入 Xynigo 云端草稿或改变原生审核: ${JSON.stringify(draftState)}`);
    }
    await page.click('.xynigo-dxm-purchase-header-cancel');
    await page.waitForFunction(() => !document.querySelector('.xynigo-dxm-embedded-host'));
    await page.click('.xynigo-dxm-purchase-tab');
    await page.waitForSelector('.xynigo-dxm-embedded-host');
    const reopenedDraftState = await page.evaluate(() => ({
      statusState: document.querySelector('.xynigo-dxm-submit-status')?.dataset.state,
      firstPurchaseLink: document.querySelector('[data-field="purchaseLink"]')?.value,
    }));
    if (reopenedDraftState.statusState !== 'synced' || reopenedDraftState.firstPurchaseLink !== urls[0]) {
      throw new Error(`重新打开采购明细后未恢复草稿: ${JSON.stringify(reopenedDraftState)}`);
    }
    await page.evaluate(() => {
      document.querySelector('.mock-note textarea').value = '人工客服备注';
      globalThis.__xynigoRejectSubmit = true;
    });
    await page.click('.xynigo-dxm-footer-submit');
    await page.waitForFunction(() => document.querySelector('.xynigo-dxm-submit-status')?.textContent.includes('提交失败'));
    const failedSubmitState = await page.evaluate(() => ({
      remarkValue: document.querySelector('.mock-note textarea')?.value || '',
      formStillOpen: Boolean(document.querySelector('.xynigo-dxm-embedded-host')),
      clipboardWrites: [...globalThis.__xynigoClipboardWrites],
    }));
    if (failedSubmitState.remarkValue !== '人工客服备注'
      || !failedSubmitState.formStillOpen
      || failedSubmitState.clipboardWrites.length !== 1) {
      throw new Error(`云端提交失败时不应写入店小秘客服备注: ${JSON.stringify(failedSubmitState)}`);
    }
    await page.evaluate(() => { globalThis.__xynigoRejectSubmit = false; });
    await page.click('.xynigo-dxm-footer-submit');
    await page.waitForFunction(() => document.querySelector('.xynigo-dxm-purchase-tab')?.dataset.state === 'synced');
    await page.waitForFunction(() => document.querySelector('.mock-note textarea')?.value.includes('[XYP2]'));
    const submitSideEffects = await page.evaluate(() => ({
      auditClassName: document.querySelector('.mock-actions button')?.className,
      auditAriaDisabled: document.querySelector('.mock-actions button')?.getAttribute('aria-disabled'),
      auditDisabled: document.querySelector('.mock-actions button')?.disabled,
      remarkValue: document.querySelector('.mock-note textarea')?.value || '',
      nativeRemarkSaveClicks: globalThis.__nativeRemarkSaveClicks,
      clipboardWrites: [...globalThis.__xynigoClipboardWrites],
      parsedXyp2: globalThis.XynigoPurchaseCore.parseXyp2Remark(globalThis.__xynigoClipboardWrites.at(-1) || ''),
      remoteRequests: globalThis.__xynigoDraftRequests.map(({ type, draft }) => ({
        type,
        submissionStatus: draft.submissionStatus,
        purchaseStatus: draft.purchaseStatus,
        guideTotalsByCurrency: draft.guideTotalsByCurrency,
        estimatedRoi: draft.estimatedMetrics?.roi,
      })),
    }));
    if (submitSideEffects.auditClassName !== auditBefore.className
      || submitSideEffects.auditAriaDisabled !== auditBefore.ariaDisabled
      || submitSideEffects.auditDisabled !== auditBefore.disabled
      || submitSideEffects.remarkValue !== `人工客服备注\n${submitSideEffects.clipboardWrites[1]}`
      || submitSideEffects.nativeRemarkSaveClicks !== 0
      || submitSideEffects.clipboardWrites.length !== 2
      || !submitSideEffects.clipboardWrites[1].startsWith('[XYP2]')
      || submitSideEffects.clipboardWrites[1].length > 900
      || !submitSideEffects.parsedXyp2.ok
      || submitSideEffects.parsedXyp2.items.length !== 2
      || submitSideEffects.parsedXyp2.items[0].sellerSku !== 'MX-60874943-8896'
      || !submitSideEffects.parsedXyp2.items[0].purchaseLink.includes('goods_id=389696689')
      || submitSideEffects.parsedXyp2.items[0].originalPrice !== 410.2
      || submitSideEffects.remoteRequests.length !== 3
      || submitSideEffects.remoteRequests[2].type !== 'xynigo-dxm:submit'
      || submitSideEffects.remoteRequests[2].submissionStatus !== 'draft'
      || submitSideEffects.remoteRequests[2].purchaseStatus !== 'draft-local'
      || !Number.isFinite(submitSideEffects.remoteRequests[2].estimatedRoi)
      || !Object.keys(submitSideEffects.remoteRequests[2].guideTotalsByCurrency).length) {
      throw new Error(`提交采购单未调用 Xynigo 正式提交，或改变了原有流程: ${JSON.stringify(submitSideEffects)}`);
    }
    const restoredNativeTabState = await page.evaluate(() => ({
      header: document.querySelector('.order-detail-content__header')?.textContent || '',
      activeTab: document.querySelector('.order-detail-content__nav-item.isActive, .order-detail-content__nav-item.mock-active')?.textContent?.trim() || '',
    }));
    if (!restoredNativeTabState.header.includes('备注信息')
      || restoredNativeTabState.header.includes('采购明细')
      || restoredNativeTabState.activeTab !== '备注信息') {
      throw new Error(`提交后未停留在原生备注信息选项卡: ${JSON.stringify(restoredNativeTabState)}`);
    }
    if (await page.locator('.order-detail-content__header button').evaluate((button) => getComputedStyle(button).display === 'none')) {
      throw new Error('退出采购明细后未恢复原生标题操作');
    }
    const remark = await page.locator('.mock-note textarea').inputValue();
    if (!remark.startsWith('人工客服备注\n[XYP2]') || await page.evaluate(() => globalThis.__nativeRemarkSaveClicks) !== 0) {
      throw new Error('提交采购单应填入 XYP2，但不应代替运营点击店小秘备注保存');
    }
    await page.evaluate(() => {
      const savedContent = document.querySelector('.mock-saved-remark-content');
      savedContent.textContent = document.querySelector('.mock-note textarea').value;
      document.querySelector('.mock-saved-remarks').hidden = false;
      document.querySelector('.mock-note').hidden = true;
    });
    await page.click('.xynigo-dxm-purchase-tab');
    await page.waitForSelector('.xynigo-dxm-embedded-host');
    const submittedFormState = await page.evaluate(() => ({
      saveHidden: document.querySelector('.xynigo-dxm-footer-save')?.hidden,
      submitDisabled: document.querySelector('.xynigo-dxm-footer-submit')?.disabled,
      submitText: document.querySelector('.xynigo-dxm-footer-submit')?.textContent.trim(),
      submitTitle: document.querySelector('.xynigo-dxm-footer-submit')?.title || '',
      submitCursor: getComputedStyle(document.querySelector('.xynigo-dxm-footer-submit')).cursor,
      copyRemarkVisible: !document.querySelector('.xynigo-dxm-footer-copy-remark')?.hidden,
    }));
    if (!submittedFormState.saveHidden
      || submittedFormState.submitDisabled
      || submittedFormState.submitText !== '提交修改'
      || !submittedFormState.submitTitle.includes('未被认领时可修改')
      || submittedFormState.submitCursor === 'wait'
      || !submittedFormState.copyRemarkVisible) {
      throw new Error(`已提交未执行订单应允许修改且不得显示等待光标: ${JSON.stringify(submittedFormState)}`);
    }
    await page.click('.xynigo-dxm-footer-copy-remark');
    const recoveryCopyState = await page.evaluate(() => ({
      clipboardWrites: [...globalThis.__xynigoClipboardWrites],
      remarkValue: document.querySelector('.mock-note textarea')?.value || '',
    }));
    if (recoveryCopyState.clipboardWrites.length !== 3
      || recoveryCopyState.clipboardWrites.at(-1) !== recoveryCopyState.clipboardWrites[1]
      || recoveryCopyState.remarkValue !== remark) {
      throw new Error(`远端已提交后的恢复入口应只复制既有 XYP2: ${JSON.stringify(recoveryCopyState)}`);
    }
    await page.evaluate(() => {
      const guidePrice = document.querySelector('[data-field="guidePrice"]');
      guidePrice.value = '145.56';
      guidePrice.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('.xynigo-dxm-footer-submit');
    await page.waitForFunction(() => !document.querySelector('.xynigo-dxm-embedded-host'));
    await page.waitForFunction(() => globalThis.__nativeRemarkEditSubmitClicks === 1, null, { timeout: 6000 });
    const revisedSubmitState = await page.evaluate(() => ({
      remoteRequests: globalThis.__xynigoDraftRequests,
      clipboardWrites: [...globalThis.__xynigoClipboardWrites],
      remarkValue: document.querySelector('.mock-note textarea')?.value || '',
      nativeRemarkSaveClicks: globalThis.__nativeRemarkSaveClicks,
      nativeRemarkEditSubmitClicks: globalThis.__nativeRemarkEditSubmitClicks,
      savedRemarkValue: document.querySelector('.mock-saved-remark-content')?.textContent || '',
      savedRemarkRows: document.querySelectorAll('.mock-saved-remarks tbody tr').length,
      visibleRemarkEditors: Array.from(document.querySelectorAll('.remark-modal textarea')).filter((element) => element.offsetParent !== null).length,
      toastText: document.querySelector('#xynigo-dxm-toast')?.textContent || '',
      localRecords: Object.values(globalThis.__xynigoStoredValues),
    }));
    const revisedRequest = revisedSubmitState.remoteRequests.at(-1);
    const revisedRecord = revisedSubmitState.localRecords.find((record) => record.remoteRevised);
    if (revisedSubmitState.remoteRequests.length !== 4
      || revisedRequest?.type !== 'xynigo-dxm:submit'
      || revisedRequest?.draft?.items?.[0]?.guidePrice !== 145.56
      || revisedSubmitState.clipboardWrites.length !== 4
      || revisedSubmitState.remarkValue !== remark
      || revisedSubmitState.nativeRemarkSaveClicks !== 0
      || revisedSubmitState.nativeRemarkEditSubmitClicks !== 1
      || revisedSubmitState.savedRemarkValue !== `人工客服备注\n${revisedSubmitState.clipboardWrites.at(-1)}`
      || revisedSubmitState.savedRemarkRows !== 1
      || !revisedRecord
      || revisedRecord.remoteDraftRevision !== 2) {
      throw new Error(`采购单修改应自动编辑唯一原客服备注且不得新增第二条: ${JSON.stringify(revisedSubmitState)}`);
    }

    await page.click('.xynigo-dxm-purchase-tab');
    await page.waitForSelector('.xynigo-dxm-embedded-host');
    await page.evaluate(() => {
      const originalRow = document.querySelector('.mock-saved-remarks tbody tr');
      originalRow.parentElement.appendChild(originalRow.cloneNode(true));
    });
    await page.click('.xynigo-dxm-footer-submit');
    await page.waitForFunction(() => !document.querySelector('.xynigo-dxm-embedded-host'));
    await page.waitForFunction(() => document.querySelector('#xynigo-dxm-toast')?.textContent.includes('检测到 2 条 XYP2'), null, { timeout: 6000 });
    const ambiguousRemarkState = await page.evaluate(() => ({
      editSubmitClicks: globalThis.__nativeRemarkEditSubmitClicks,
      savedValues: Array.from(document.querySelectorAll('.mock-saved-remark-content')).map((cell) => cell.textContent),
      clipboardWrites: [...globalThis.__xynigoClipboardWrites],
    }));
    if (ambiguousRemarkState.editSubmitClicks !== 1
      || ambiguousRemarkState.savedValues.length !== 2
      || ambiguousRemarkState.savedValues[0] !== ambiguousRemarkState.savedValues[1]
      || ambiguousRemarkState.clipboardWrites.length !== 5) {
      throw new Error(`多条 XYP2 客服备注时必须停止自动修改: ${JSON.stringify(ambiguousRemarkState)}`);
    }

    await page.evaluate(() => {
      document.querySelectorAll('.mock-saved-remarks tbody tr').forEach((row) => row.remove());
      document.querySelector('.mock-saved-remarks').hidden = true;
      document.querySelector('.mock-note').hidden = true;
      document.querySelector('.mock-note textarea').value = '';
      const remarkTab = Array.from(document.querySelectorAll('.order-detail-content__nav-item'))
        .find((tab) => tab.textContent.trim().startsWith('备注信息'));
      remarkTab.innerHTML = '备注信息 <span>（0）</span>';
    });
    await page.click('.xynigo-dxm-purchase-tab');
    await page.waitForSelector('.xynigo-dxm-embedded-host');
    await page.evaluate(() => {
      const guidePrice = document.querySelector('[data-field="guidePrice"]');
      guidePrice.value = '146.78';
      guidePrice.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('.xynigo-dxm-footer-submit');
    await page.waitForFunction(() => !document.querySelector('.xynigo-dxm-embedded-host'));
    await page.waitForFunction(() => document.querySelector('#xynigo-dxm-toast')?.dataset.busy === 'true');
    const deletedRemarkProgressState = await page.evaluate(() => ({
      text: document.querySelector('#xynigo-dxm-toast')?.textContent || '',
      busy: document.querySelector('#xynigo-dxm-toast')?.dataset.busy || '',
      ariaBusy: document.querySelector('#xynigo-dxm-toast')?.getAttribute('aria-busy') || '',
      visible: document.querySelector('#xynigo-dxm-toast')?.classList.contains('xynigo-dxm-toast-show'),
    }));
    if (!deletedRemarkProgressState.text.includes('正在检查原客服备注')
      || !deletedRemarkProgressState.text.includes('预计 3–8 秒')
      || deletedRemarkProgressState.busy !== 'true'
      || deletedRemarkProgressState.ariaBusy !== 'true'
      || !deletedRemarkProgressState.visible) {
      throw new Error(`等待原客服备注期间必须显示持续进度提示: ${JSON.stringify(deletedRemarkProgressState)}`);
    }
    await page.waitForFunction(() => document.querySelector('.mock-note textarea')?.value.includes('[XYP2]'), null, { timeout: 6000 });
    const deletedRemarkRecoveryState = await page.evaluate(() => ({
      remarkValue: document.querySelector('.mock-note textarea')?.value || '',
      clipboardValue: globalThis.__xynigoClipboardWrites.at(-1) || '',
      savedRemarkRows: document.querySelectorAll('.mock-saved-remarks tbody tr').length,
      nativeRemarkSaveClicks: globalThis.__nativeRemarkSaveClicks,
      nativeRemarkEditSubmitClicks: globalThis.__nativeRemarkEditSubmitClicks,
      activeTab: document.querySelector('.order-detail-content__nav-item.isActive, .order-detail-content__nav-item.mock-active')?.textContent?.trim() || '',
      header: document.querySelector('.order-detail-content__header')?.textContent || '',
      toastText: document.querySelector('#xynigo-dxm-toast')?.textContent || '',
      toastBusy: document.querySelector('#xynigo-dxm-toast')?.dataset.busy || '',
      toastAriaBusy: document.querySelector('#xynigo-dxm-toast')?.getAttribute('aria-busy') || '',
      revisedGuidePrice: globalThis.__xynigoDraftRequests.at(-1)?.draft?.items?.[0]?.guidePrice,
    }));
    if (deletedRemarkRecoveryState.remarkValue !== deletedRemarkRecoveryState.clipboardValue
      || !deletedRemarkRecoveryState.remarkValue.startsWith('[XYP2]')
      || deletedRemarkRecoveryState.savedRemarkRows !== 0
      || deletedRemarkRecoveryState.nativeRemarkSaveClicks !== 0
      || deletedRemarkRecoveryState.nativeRemarkEditSubmitClicks !== 1
      || !deletedRemarkRecoveryState.activeTab.startsWith('备注信息')
      || !deletedRemarkRecoveryState.header.includes('备注信息')
      || !deletedRemarkRecoveryState.toastText.includes('原客服备注不存在')
      || deletedRemarkRecoveryState.toastBusy !== 'false'
      || deletedRemarkRecoveryState.toastAriaBusy !== 'false'
      || deletedRemarkRecoveryState.revisedGuidePrice !== 146.78) {
      throw new Error(`原客服备注删除后应重新填写一条并停留在备注信息页签: ${JSON.stringify(deletedRemarkRecoveryState)}`);
    }

    const firstPaintPage = await context.newPage();
    await firstPaintPage.goto(`file://${fixturePath}`);
    await firstPaintPage.addStyleTag({ path: path.join(root, 'src', 'content.css') });
    await firstPaintPage.addScriptTag({ path: path.join(root, 'src', 'core.js') });
    await firstPaintPage.evaluate(() => {
      globalThis.__xynigoPendingDetailModal = document.querySelector('.mock-modal');
      globalThis.__xynigoPendingDetailModal.remove();
    });
    await firstPaintPage.addScriptTag({ path: path.join(root, 'src', 'content.js') });
    await firstPaintPage.evaluate(() => {
      document.body.prepend(globalThis.__xynigoPendingDetailModal);
    });
    await firstPaintPage.waitForSelector('.xynigo-dxm-embedded-host', { timeout: 3000 });
    const firstPaintState = await firstPaintPage.evaluate(() => {
      const purchaseTab = document.querySelector('.xynigo-dxm-purchase-tab');
      const header = document.querySelector('.order-detail-content__header');
      return {
        purchaseTabPresent: Boolean(purchaseTab),
        purchaseTabActive: Boolean(purchaseTab?.classList.contains('xynigo-dxm-purchase-tab-active')),
        embeddedFormPresent: Boolean(document.querySelector('.xynigo-dxm-embedded-host')),
        nativeContentSuppressed: getComputedStyle(document.querySelector('.mock-content > p')).display === 'none',
        headerTitle: header?.textContent.trim() || '',
      };
    });
    if (!firstPaintState.purchaseTabPresent
      || !firstPaintState.purchaseTabActive
      || !firstPaintState.embeddedFormPresent
      || !firstPaintState.nativeContentSuppressed
      || !firstPaintState.headerTitle.includes('采购明细')) {
      throw new Error(`订单详情首帧未直接进入采购明细: ${JSON.stringify(firstPaintState)}`);
    }
    const closingTransitionState = await firstPaintPage.evaluate(async () => {
      const modal = document.querySelector('.mock-modal');
      modal.querySelector('.mock-content').remove();
      modal.querySelector('.xynigo-dxm-purchase-tab').remove();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const fallbackDrawerAppeared = Boolean(document.querySelector('#xynigo-dxm-drawer-root'));
      const warningAppeared = (document.querySelector('#xynigo-dxm-toast')?.textContent || '')
        .includes('未识别订单详情内容区');
      modal.style.display = 'none';
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        fallbackDrawerAppeared,
        warningAppeared,
        drawerRemainingAfterClose: Boolean(document.querySelector('#xynigo-dxm-drawer-root')),
      };
    });
    await firstPaintPage.close();
    if (closingTransitionState.fallbackDrawerAppeared
      || closingTransitionState.warningAppeared
      || closingTransitionState.drawerRemainingAfterClose) {
      throw new Error(`关闭订单详情时错误触发右侧面板兜底: ${JSON.stringify(closingTransitionState)}`);
    }

    const escapeClosePage = await context.newPage();
    await escapeClosePage.goto(`file://${fixturePath}`);
    await escapeClosePage.addStyleTag({ path: path.join(root, 'src', 'content.css') });
    await escapeClosePage.addScriptTag({ path: path.join(root, 'src', 'core.js') });
    await escapeClosePage.evaluate(() => {
      const nestedModalBody = document.querySelector('.mock-content');
      nestedModalBody.classList.add('ant-modal-body');
      const misleadingText = document.createElement('span');
      misleadingText.hidden = true;
      misleadingText.textContent = '包裹 详情 审核';
      nestedModalBody.appendChild(misleadingText);
    });
    await escapeClosePage.addScriptTag({ path: path.join(root, 'src', 'content.js') });
    await escapeClosePage.waitForSelector('.xynigo-dxm-purchase-tab-active', { timeout: 8000 });
    await escapeClosePage.evaluate(() => {
      globalThis.__xynigoNativeCloseCount = 0;
      const modalMask = document.createElement('div');
      modalMask.className = 'ant-modal-mask';
      modalMask.style.cssText = 'position:fixed;inset:0;display:block';
      document.body.prepend(modalMask);
      document.querySelector('.mock-actions button:last-child').addEventListener('click', () => {
        globalThis.__xynigoNativeCloseCount += 1;
        document.querySelector('.mock-modal').hidden = true;
      });
      document.querySelector('.mock-note').hidden = false;
    });
    await escapeClosePage.keyboard.press('Escape');
    const nestedDialogState = await escapeClosePage.evaluate(() => ({
      modalVisible: !document.querySelector('.mock-modal').hidden,
      nativeCloseCount: globalThis.__xynigoNativeCloseCount,
    }));
    await escapeClosePage.evaluate(() => {
      document.querySelector('.mock-note').hidden = true;
    });
    await escapeClosePage.keyboard.press('Escape');
    await escapeClosePage.waitForFunction(() => document.querySelector('.mock-modal').hidden);
    const escapeCloseState = await escapeClosePage.evaluate(() => ({
      nativeCloseCount: globalThis.__xynigoNativeCloseCount,
      drawerRemaining: Boolean(document.querySelector('#xynigo-dxm-drawer-root')),
      modalMaskVisible: getComputedStyle(document.querySelector('.ant-modal-mask')).display !== 'none',
    }));
    await escapeClosePage.close();
    if (!nestedDialogState.modalVisible
      || nestedDialogState.nativeCloseCount !== 0
      || escapeCloseState.nativeCloseCount !== 1
      || escapeCloseState.drawerRemaining
      || !escapeCloseState.modalMaskVisible) {
      throw new Error(`ESC 关闭订单详情未按预期调用原生关闭按钮: ${JSON.stringify({
        nestedDialogState,
        escapeCloseState,
      })}`);
    }

    const observerEfficiencyPage = await context.newPage();
    await observerEfficiencyPage.goto(`file://${fixturePath}`);
    await observerEfficiencyPage.addStyleTag({ path: path.join(root, 'src', 'content.css') });
    await observerEfficiencyPage.addScriptTag({ path: path.join(root, 'src', 'core.js') });
    await observerEfficiencyPage.evaluate(() => {
      const nativeGetComputedStyle = globalThis.getComputedStyle;
      const nativeGetBoundingClientRect = Element.prototype.getBoundingClientRect;
      const nativeClassRemove = DOMTokenList.prototype.remove;
      globalThis.__xynigoTrackLayoutChecks = false;
      globalThis.__xynigoTrackDetachedCleanup = false;
      globalThis.__xynigoComputedStyleChecks = 0;
      globalThis.__xynigoRectChecks = 0;
      globalThis.__xynigoDetachedClassRemovals = 0;
      globalThis.getComputedStyle = function trackComputedStyle(...args) {
        if (globalThis.__xynigoTrackLayoutChecks) globalThis.__xynigoComputedStyleChecks += 1;
        return nativeGetComputedStyle.apply(this, args);
      };
      Element.prototype.getBoundingClientRect = function trackBoundingRect(...args) {
        if (globalThis.__xynigoTrackLayoutChecks) globalThis.__xynigoRectChecks += 1;
        return nativeGetBoundingClientRect.apply(this, args);
      };
      DOMTokenList.prototype.remove = function trackDetachedClassRemoval(...tokens) {
        if (globalThis.__xynigoTrackDetachedCleanup
          && tokens.some((token) => String(token).startsWith('xynigo-dxm'))) {
          globalThis.__xynigoDetachedClassRemovals += 1;
        }
        return nativeClassRemove.apply(this, tokens);
      };
    });
    await observerEfficiencyPage.addScriptTag({ path: path.join(root, 'src', 'content.js') });
    await observerEfficiencyPage.waitForSelector('.xynigo-dxm-purchase-tab-active', { timeout: 8000 });
    await observerEfficiencyPage.waitForTimeout(100);
    const observerEfficiency = await observerEfficiencyPage.evaluate(async () => {
      globalThis.__xynigoComputedStyleChecks = 0;
      globalThis.__xynigoRectChecks = 0;
      globalThis.__xynigoTrackLayoutChecks = true;
      const unrelatedChange = document.createElement('div');
      unrelatedChange.textContent = '普通订单列表变化';
      document.body.appendChild(unrelatedChange);
      await new Promise((resolve) => setTimeout(resolve, 30));
      globalThis.__xynigoTrackLayoutChecks = false;
      const unrelatedMutation = {
        computedStyleChecks: globalThis.__xynigoComputedStyleChecks,
        rectChecks: globalThis.__xynigoRectChecks,
      };

      globalThis.__xynigoDetachedClassRemovals = 0;
      globalThis.__xynigoTrackDetachedCleanup = true;
      document.querySelector('.mock-modal').remove();
      await new Promise((resolve) => setTimeout(resolve, 30));
      globalThis.__xynigoTrackDetachedCleanup = false;
      return {
        unrelatedMutation,
        detachedClassRemovals: globalThis.__xynigoDetachedClassRemovals,
        drawerRemaining: Boolean(document.querySelector('#xynigo-dxm-drawer-root')),
      };
    });
    await observerEfficiencyPage.close();
    if (observerEfficiency.unrelatedMutation.computedStyleChecks !== 0
      || observerEfficiency.unrelatedMutation.rectChecks !== 0
      || observerEfficiency.detachedClassRemovals !== 0
      || observerEfficiency.drawerRemaining) {
      throw new Error(`关闭性能回归失败: ${JSON.stringify(observerEfficiency)}`);
    }

    const normalMutationPage = await context.newPage();
    await normalMutationPage.setContent('<main><ul id="orderList"></ul></main>');
    await normalMutationPage.addScriptTag({ path: path.join(root, 'src', 'core.js') });
    await normalMutationPage.evaluate(() => {
      globalThis.__xynigoFullPageScanCount = 0;
      const nativeQuerySelectorAll = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function countDetailModalScans(selector) {
        if (typeof selector === 'string' && selector.startsWith('[role="dialog"],.modal')) {
          globalThis.__xynigoFullPageScanCount += 1;
        }
        return nativeQuerySelectorAll.call(this, selector);
      };
    });
    await normalMutationPage.addScriptTag({ path: path.join(root, 'src', 'content.js') });
    await normalMutationPage.waitForTimeout(180);
    await normalMutationPage.evaluate(() => {
      globalThis.__xynigoFullPageScanCount = 0;
    });
    const scanCountWhileRendering = await normalMutationPage.evaluate(async () => {
      const list = document.getElementById('orderList');
      for (let index = 0; index < 12; index += 1) {
        const row = document.createElement('li');
        row.textContent = `待审核订单 ${index + 1}`;
        list.appendChild(row);
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      return globalThis.__xynigoFullPageScanCount;
    });
    await normalMutationPage.waitForTimeout(180);
    const scanCountAfterIdle = await normalMutationPage.evaluate(() => globalThis.__xynigoFullPageScanCount);
    const incompleteShellState = await normalMutationPage.evaluate(async () => {
      const shell = document.createElement('section');
      shell.setAttribute('role', 'dialog');
      shell.textContent = '包裹「 」详情 - 来源于「」';
      shell.style.cssText = 'display:block;width:900px;height:400px';
      document.body.appendChild(shell);
      await new Promise((resolve) => setTimeout(resolve, 180));
      return {
        visible: getComputedStyle(shell).display !== 'none',
        purchaseTabPresent: Boolean(shell.querySelector('.xynigo-dxm-purchase-tab')),
        fullPageScanCount: globalThis.__xynigoFullPageScanCount,
      };
    });
    await normalMutationPage.close();
    if (scanCountWhileRendering !== 0
      || scanCountAfterIdle !== 0
      || !incompleteShellState.visible
      || incompleteShellState.purchaseTabPresent
      || incompleteShellState.fullPageScanCount !== 0) {
      throw new Error(`普通订单变化或未完成弹窗仍触发全页面扫描: ${JSON.stringify({
        scanCountWhileRendering,
        scanCountAfterIdle,
        incompleteShellState,
      })}`);
    }

    process.stdout.write(JSON.stringify({
      injected: true,
      purchaseTabSelectedByDefault: true,
      purchaseTabReadyBeforeFirstPaint: true,
      nativeCloseTransitionIgnored: true,
      escapeClosesDetailThroughNativeAction: true,
      escapePreservesNestedDialogPriority: true,
      escapeIgnoresNativeModalMask: true,
      escapeUsesModalRootInsteadOfModalBody: true,
      unrelatedMutationsSkipLayoutChecks: true,
      detachedModalSkipsNativeDomRestore: true,
      normalListMutationsIgnored: true,
      incompleteNativeShellPreserved: true,
      draftSaveKeepsEditorOpen: true,
      draftSaveDoesNotWriteNativeRemark: true,
      draftRestoresAfterReopen: true,
      submitWritesTestBaseWithoutTouchingAudit: true,
      submittedOrderRevisionWithoutSecondRemark: true,
      revisionAutoEditsOnlyUniqueSavedRemark: true,
      ambiguousSavedRemarksFailClosed: true,
      deletedRemarkIsRecreatedAndRemarkTabSelected: true,
      placement,
      purchaseLines: 2,
      manualLineAddRemove: true,
      tabState: await page.locator('.xynigo-dxm-purchase-tab').getAttribute('data-state'),
      remarkPrefilledWithoutSave: remark.includes('[XYP2]'),
    }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

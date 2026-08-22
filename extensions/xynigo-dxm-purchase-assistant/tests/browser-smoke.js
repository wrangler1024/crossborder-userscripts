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
      const listeners = [];
      globalThis.chrome = {
        runtime: { lastError: null },
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
    if (JSON.stringify(initialMetricValues) !== JSON.stringify(['—', '—', '—', '—'])) {
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
      || (await lines.nth(1).locator('.xynigo-dxm-line-product strong').textContent()).includes('GSH1RA58')) {
      throw new Error('未在销售订单号 GSH1RA58 之后正确识别 9 位 goods_id 469433114');
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
      'https://www.shein.com.mx/x-p-389696689.html?mallCode=1&goods_id=389696689&skucode=SKU_A&main_attr=27_447#xv=1&p=Multicolor&s=XS&gp=143.57&c=MXN',
      'https://www.shein.com.mx/x-p-101655130.html?mallCode=1&goods_id=101655130&skucode=SKU_B&main_attr=27_182#xv=1&p=Maroon&s=S&gp=88.20&c=MXN',
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
    const roiSummary = await page.locator('.xynigo-dxm-roi-summary .xynigo-dxm-metric-value').textContent();
    if (!profitSummary.includes('MXN 254.66') || !profitMarginSummary.includes('40.42%') || !roiSummary.includes('67.85%')) {
      throw new Error(`预估利润指标错误: ${profitSummary} / ${profitMarginSummary} / ${roiSummary}`);
    }
    const calculatedMetricBrandStyles = await page.locator('.xynigo-dxm-footer-info').evaluate((footerInfo) => ({
      label: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-metric-label')).color,
      help: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-metric-help')).color,
      helpBorder: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-metric-help')).borderTopColor,
      purchaseValue: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-purchase-summary .xynigo-dxm-metric-value')).color,
      profitValue: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-profit-summary .xynigo-dxm-metric-value')).color,
      marginValue: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-value')).color,
      roiValue: getComputedStyle(footerInfo.querySelector('.xynigo-dxm-roi-summary .xynigo-dxm-metric-value')).color,
    }));
    if (calculatedMetricBrandStyles.label !== 'rgb(11, 49, 94)'
      || calculatedMetricBrandStyles.help !== 'rgb(53, 111, 145)'
      || calculatedMetricBrandStyles.helpBorder !== 'rgb(78, 139, 169)'
      || !['purchaseValue', 'profitValue', 'marginValue', 'roiValue']
        .every((key) => calculatedMetricBrandStyles[key] === 'rgb(52, 183, 131)')) {
      throw new Error(`汇总指标计算值未统一使用品牌成功绿: ${JSON.stringify(calculatedMetricBrandStyles)}`);
    }
    const calculatedTooltips = await page.locator('.xynigo-dxm-profit-summary .xynigo-dxm-metric-help, .xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-help, .xynigo-dxm-roi-summary .xynigo-dxm-metric-help')
      .evaluateAll((helps) => helps.map((help) => help.dataset.tooltip));
    if (!calculatedTooltips[0].includes('计算：MXN 630.00 - MXN 375.34 = MXN 254.66')
      || !calculatedTooltips[1].includes('计算：254.66 ÷ 630.00 × 100% = 40.42%')
      || !calculatedTooltips[2].includes('计算：254.66 ÷ 375.34 × 100% = 67.85%')) {
      throw new Error(`利润、利润率或 ROI 问号未展示完整计算过程: ${JSON.stringify(calculatedTooltips)}`);
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
    const pendingTooltips = await page.locator('.xynigo-dxm-profit-summary .xynigo-dxm-metric-help, .xynigo-dxm-profit-margin-summary .xynigo-dxm-metric-help, .xynigo-dxm-roi-summary .xynigo-dxm-metric-help')
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
    const mexicoTopUpRoi = await page.locator('.xynigo-dxm-roi-summary .xynigo-dxm-metric-value').textContent();
    if (!mexicoTopUpProfit.includes('MXN 530.00') || !mexicoTopUpProfitMargin.includes('84.13%') || !mexicoTopUpRoi.includes('530.00%')) {
      throw new Error(`墨西哥凑单预估利润错误: ${mexicoTopUpProfit} / ${mexicoTopUpProfitMargin} / ${mexicoTopUpRoi}`);
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
      throw new Error(`较大金额下四项指标发生溢出: ${JSON.stringify(largeMetricFit)}`);
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
      throw new Error(`底部采购总额、利润、利润率与 ROI 未按固定四列展示: ${JSON.stringify(footerAlignment)}`);
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
      const submitButton = footer.querySelector('.xynigo-dxm-footer-submit').getBoundingClientRect();
      return {
        metricsLeftOfStatus: info.right <= status.left + 1,
        statusLeftOfSubmit: status.right <= submitButton.left + 1,
      };
    });
    if (!footerOrder.metricsLeftOfStatus || !footerOrder.statusLeftOfSubmit) {
      throw new Error(`汇总指标、采购单状态和录采购单按钮顺序错误: ${JSON.stringify(footerOrder)}`);
    }
    const metricLabels = await page.locator('.xynigo-dxm-footer-info .xynigo-dxm-metric-label').allTextContents();
    if (JSON.stringify(metricLabels) !== JSON.stringify(['采购总额', '利润', '利润率', 'ROI'])
      || await page.locator('.xynigo-dxm-metric-help').count() !== 4) {
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
        statusVisible: status.getBoundingClientRect().width > 1 && status.getBoundingClientRect().height > 1,
        statusText: status.textContent.trim(),
        statusHasNoButtonChrome: getComputedStyle(status).backgroundColor === 'rgba(0, 0, 0, 0)'
          && Number.parseFloat(getComputedStyle(status).borderTopWidth) === 0,
        statusDotWidth: Number.parseFloat(getComputedStyle(status, '::before').width),
      };
    });
    if (metricLayout.fixedColumnCount !== 4
      || metricLayout.labelFontSize !== metricLayout.columnHeaderFontSize - 1
      || metricLayout.valueFontSize !== metricLayout.columnHeaderFontSize
      || !metricLayout.inlineValue || metricLayout.footerHeight > metricLayout.submitHeight + 12
      || !metricLayout.statusVisible || metricLayout.statusText !== '未录入'
      || !metricLayout.statusHasNoButtonChrome || metricLayout.statusDotWidth < 6) {
      throw new Error(`底部汇总未按按钮高度、横向数值及小两号字体展示: ${JSON.stringify(metricLayout)}`);
    }
    await page.click('.xynigo-dxm-primary');
    await page.waitForFunction(() => document.querySelector('.xynigo-dxm-purchase-tab')?.dataset.state === 'recorded');
    const restoredHeader = await page.locator('.order-detail-content__header').innerText();
    if (!restoredHeader.includes('物流信息') || restoredHeader.includes('采购明细')) {
      throw new Error('退出采购明细后未恢复原生标题');
    }
    if (await page.locator('.order-detail-content__header button').evaluate((button) => getComputedStyle(button).display === 'none')) {
      throw new Error('退出采购明细后未恢复原生标题操作');
    }
    const remark = await page.locator('.mock-note textarea').inputValue();
    if (remark.split('\n').length !== 2) throw new Error('备注未按一件商品一行链接填入');

    process.stdout.write(JSON.stringify({
      injected: true,
      purchaseTabSelectedByDefault: true,
      placement,
      purchaseLines: 2,
      manualLineAddRemove: true,
      tabState: await page.locator('.xynigo-dxm-purchase-tab').getAttribute('data-state'),
      remarkLines: remark.split('\n').length,
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

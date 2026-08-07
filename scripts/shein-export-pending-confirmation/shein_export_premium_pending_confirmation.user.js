// ==UserScript==
// @name         导出议价待确认订单 - SHEIN
// @namespace    http://tampermonkey.net/
// @version      1.0.2
// @description  导出议价待确认订单
// @author       大大怪将军
// @match        https://sellerhub.shein.com/*
// @match        https://sso.geiwohuo.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-export-pending-confirmation/shein_export_premium_pending_confirmation.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-export-pending-confirmation/shein_export_premium_pending_confirmation.user.js
// ==/UserScript==


(function() {
    'use strict';
    const sf_button_num = 1;
    const sf_button_id = `sf-export-pending-confirmation-btn-${sf_button_num}`

    if (window.location.href.includes('/#/dpas/discuss-price/list?type=1&id=1')) {
        setTimeout(() => {addButton()}, 500);
    }

    function addButton() {
        if (!document.getElementById(sf_button_id)) {
            const dropdownContainer = document.createElement('div');
            dropdownContainer.id = `${sf_button_id}-container`;
            dropdownContainer.style.position = 'fixed';
            dropdownContainer.style.top = `${20 + sf_button_num * 40}px`;
            dropdownContainer.style.right = '20px';
            dropdownContainer.style.zIndex = '9999';
            dropdownContainer.style.display = 'flex';
            dropdownContainer.style.flexDirection = 'column';
            document.body.appendChild(dropdownContainer);

            const mainButton = document.createElement('button');
            mainButton.id = sf_button_id;
            mainButton.textContent = '导出议价待确认订单';
            mainButton.style.width = '100%';
            mainButton.style.padding = '10px 10px';
            mainButton.style.backgroundColor = '#febd69';
            mainButton.style.border = 'none';
            mainButton.style.borderRadius = '4px';
            mainButton.style.cursor = 'pointer';
            mainButton.style.fontWeight = 'bold';
            mainButton.onclick = mainFunction;
            dropdownContainer.appendChild(mainButton);
        }
    }

    async function mainFunction() {
        const button_log = document.getElementById(sf_button_id);
        // const titles = '议价单号\tSPU\tSKC\tSKU\t供方货号\t主规格\t次规格\t商家最新一次报价\t商家报价币种\t建议报价\t建议报价币种\t议价原因\t剩余议价次数\t重新报价金额\t重新报价币种\n'.trim().split('\t');
        // let totalCount = document.evaluate('//*[contains(@class,"so-checkinput-group")]/label[2]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.textContent.trim();
        // totalCount = parseInt(totalCount.match(/\d+/)[1]);
        const pageSize = 200;
        const allPendingConfirmationList = await getAllPendingConfirmationList(button_log, pageSize);
        // 替换标题
        const dataAfterCleaning = []
        allPendingConfirmationList.forEach(item => {
            dataAfterCleaning.push({
                '议价单号': item.bargain_sn,
                'SPU': item.spu_name,
                'SKC': item.skc_name,
                'SKU': item.sku_cost_prices[0].sku_code,
                '供方货号': item.supplier_code,
                '主规格': item.sale_attribute_value,
                '次规格': item.sku_cost_prices[0].sale_attribute_values ? item.sku_cost_prices[0].sale_attribute_values[0] : null,
                '商家最新一次报价': item.sku_cost_prices[0].cost_price_histories[0].cost_price,
                '商家报价币种': item.sku_cost_prices[0].cost_price_histories[0].currency,
                '建议报价': item.sku_cost_prices[0].suggest_cost_price,
                '建议报价币种': item.sku_cost_prices[0].suggest_cost_currency,
                '议价原因': item.appeal_reason,
                '剩余议价次数': item.appeal_count,
                '重新报价金额': null,
                '重新报价币种': null,
            });
        });
        downloadXlsx(dataAfterCleaning, `批量导出新品议价代办_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`, '新品议价代办(待确认)');
    }

    function downloadXlsx(data, filename = 'data.xlsx', sheetName = '新品议价代办(待确认)') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, filename);
    }

    // 获取全部页数据
    async function getAllPendingConfirmationList(button_log, pageSize) {
        const allPendingConfirmationList = []
        let totalPage = 1;
        let currentPage = 1;

        while (currentPage <= totalPage) {
            button_log.textContent = totalPage === 1 ? `正在读取第${currentPage}页数据` : `正在读取第${currentPage}/${totalPage}页数据`;
            await fetch(
                `/dpas-api-prefix/dpas/discuss/bargain_page?page_num=${currentPage}&page_size=${pageSize}`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({bargain_status: 1})
                }
            )
                .then(async response => {
                    const data = await response.json();
                    allPendingConfirmationList.push(...data.info.data);
                    totalPage = Math.ceil(data.info.meta.count / pageSize);
                })
                .catch(err => console.error(err));
            currentPage++;
        }
        return allPendingConfirmationList;
    }
})();

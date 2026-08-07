// ==UserScript==
// @name         发缺货 - 店小秘
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  批量发搜索列表内的缺货
// @author       大大怪将军
// @match        https://www.dianxiaomi.com/web/order/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-send-out-of-stock/dxm_send_out_of_stock.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-send-out-of-stock/dxm_send_out_of_stock.user.js
// ==/UserScript==


(function() {
    'use strict';

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (url.includes('/api/package/searchPackage.json')) {
            console.log('检测到目标请求,开始注入内容');
            setTimeout(() => {addButton()}, 500);
        }
        return originalXhrOpen.apply(this, [method, url, ...args]);
    };
    function addButton() {
        if (document.getElementById('batch-send-out-of-stock-btn')) {
            console.log('按钮已存在,无需添加');
            return;
        }
        insertHtmlToXPath(
            '//*[@class="search-section"]/following-sibling::*[@data-measure-status="0"][2]//*[@class="btn-left"]/div',
            -1,
            `
            <button data-v-11a55e37="" id="batch-send-out-of-stock-btn" class="css-1oz1bg8 ant-btn ant-btn-primary buttons-item" type="button"><!----><span>批量发缺货</span><i data-v-11a55e37="" class="icon_down"></i></button>
            `,
            batchSendOutOfStock
        );
    }

    async function batchSendOutOfStock() {
        try {
            // 点击第一个订单的详情按钮
            const btn_element = document.querySelector('.vxe-table--body-wrapper tr[class="vxe-body--row"] td.col--last a:last-child');
            if (!btn_element) {
                alert('未找到订单详情按钮');
                return;
            }

            await btn_element.click();
            await new Promise(resolve => setTimeout(resolve, 1000)); // 等待页面加载

            let count = 0;

            // 循环处理所有订单
            while (true) {
                try {
                    const skuElements = document.querySelectorAll('.myj-table .order-sku > a');

                    for (const element of skuElements) {
                        try {
                            await element.click();
                            await new Promise(resolve => setTimeout(resolve, 300));
                            const outOfStockOption = document.evaluate('//*[text()="SHEIN  虚拟发货  缺货"]/ancestor::td/following-sibling::*[1]//*[text()="选择"]',document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;
                            if (outOfStockOption) {
                                await outOfStockOption.click();
                                await new Promise(resolve => setTimeout(resolve, 300));
                            }
                            const confirmButton = document.evaluate('//*[@type="button"]//*[text()="确定"]',document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;
                            if (confirmButton) {
                                await confirmButton.click();
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                count++;
                            }
                        } catch (error) {
                            console.error('处理SKU失败:', error);
                        }
                    }

                    // 检查是否有下一个订单
                    const nextButton = document.evaluate('//*[@class="updown-order"]/button[not(@disabled)]/*[text()="下一个"]',document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;

                    if (nextButton) {
                        await nextButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待新页面加载
                    } else {
                        const closeButton = document.evaluate('//*[text()="关闭"]',document,null, XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;
                        await closeButton.click();
                        break;
                    }

                } catch (error) {
                    console.error('处理订单时出错:', error);
                    break;
                }
            }

            alert(`批量发缺货完成，共处理${count}个发货`);

        } catch (error) {
            console.error('批量发缺货失败:', error);
            alert('批量发缺货失败: ' + error.message);
        }
    }

    /**
     * 插入HTML并绑定事件
     * @param {string} xpath - 父元素XPath
     * @param {number} position - 插入位置
     * @param {string} html - 插入的HTML字符串
     * @param {Function} onClick - 点击事件回调（可选）
     * @returns {HTMLElement|null} 插入的元素
     */
    function insertHtmlToXPath(xpath, position, html, onClick = null) {
        try {
            // 1. 获取父元素
            const parent = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
            if (!parent) {
                console.error('未找到父元素:', xpath);
                return null;
            }

            // 2. 解析HTML
            const temp = document.createElement('div');
            temp.innerHTML = html.trim();
            const newElement = temp.firstElementChild;
            if (!newElement) {
                console.error('HTML解析失败:', html);
                return null;
            }

            // 3. 绑定点击事件（关键：用JS绑定，避开沙箱问题）
            if (typeof onClick === 'function') {
                newElement.addEventListener('click', onClick);
            }

            // 4. 插入元素
            const children = Array.from(parent.children);
            const insertPos = position === -1 ? children.length : position;
            const validPos = Math.max(0, Math.min(insertPos, children.length));
            validPos === children.length
                ? parent.appendChild(newElement)
                : parent.insertBefore(newElement, children[validPos]);

            return newElement;
        } catch (error) {
            console.error('插入失败:', error);
            return null;
        }
    }
})();

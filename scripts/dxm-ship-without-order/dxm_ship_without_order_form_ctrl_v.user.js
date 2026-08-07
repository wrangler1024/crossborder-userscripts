// ==UserScript==
// @name         粘贴板>跟踪号 - 店小秘
// @namespace    http://tampermonkey.net/
// @version      1.0.6
// @description  把粘贴板中的跟踪号粘贴到跟踪号输入框
// @author       大大怪将军
// @match        https://www.dianxiaomi.com/web/order/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-ship-without-order/dxm_ship_without_order_form_ctrl_v.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-ship-without-order/dxm_ship_without_order_form_ctrl_v.user.js
// ==/UserScript==


(function() {
    'use strict';
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (url.includes('api/order/withOutPrintShippingList.json')) {
            console.log(`监听到XMLHttpRequest请求: [${method}]`);
            setTimeout(() => {
                insertHtmlToXPath(
                    '//*[@class="footer"]/*[@class="button"]',
                    0,
                    '<button data-v-567ec115="" class="css-1oz1bg8 ant-btn ant-btn-default mr-16" type="button"><!----><span>粘贴板>跟踪号</span></button>',
                    pasteAllTrackNumbers
                )
            }, 1000);
        }
        return originalXhrOpen.apply(this, [method, url, ...args]);
    }

    async function pasteAllTrackNumbers() {
        const text = await navigator.clipboard.readText();
        const allTrackList = [...new Set(text.split('\n').map(trackNumber => trackNumber.trim()).filter(trackNumber => trackNumber !== ''))];
        const allTrackInputElements = await waitForElements('.vxe-table--body tr[class="vxe-body--row"]', 3000);

        if (allTrackInputElements.length > 0 && allTrackList.length > 0) {
            const max_for = Math.min(allTrackList.length, allTrackInputElements.length);

            for (let index = 0; index < max_for; index++) {
                let temp_index = index;
                // if (temp_index <= max_for - 3){temp_index+=2}
                allTrackInputElements[temp_index].scrollIntoView({behavior: 'smooth', block: 'center', inline: 'center' });
                await waitForElementVisible(allTrackInputElements[temp_index], 3000);
                const input_element = await waitForElementWithin(allTrackInputElements[index], 'input[placeholder="请输入"]', 5000);

                if (input_element) {
                    input_element.value = allTrackList[index];
                    input_element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                    input_element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    input_element.dispatchEvent(new Event('blur', { bubbles: true }));
                    await sleep(70);
                }
            }
        } else if (allTrackInputElements.length === 0) {
            alert('未识别到包裹数，请检查页面是否正确加载')
        } else if (allTrackList.length === 0) {
            alert('粘贴板中未识别到跟踪号，请检查是否正确复制')
        } else {
            alert(`未知错误:\n检测到${allTrackInputElements.length}条数据\n粘贴板内容${allTrackList.length}`)
        }

        if (allTrackInputElements.length !== allTrackList.length) {
            GM_notification({
                text: `数量不匹配！\n粘贴板数量: ${allTrackList.length}\n包裹的数量: ${allTrackInputElements.length}`,
                title: '店小秘工具 - 警告',
                timeout: 3000
            });
        }
    }

    // 辅助函数：等待元素出现
    function waitForElements(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            function check() {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    resolve(elements);
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error(`等待元素超时: ${selector}`));
                } else {
                    setTimeout(check, 500);
                }
            }

            check();
        });
    }

    // 辅助函数：等待元素可见
    function waitForElementVisible(element, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            function check() {
                const rect = element.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0;

                if (isVisible) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('等待元素可见超时'));
                } else {
                    setTimeout(check, 100);
                }
            }

            check();
        });
    }

    // 辅助函数：等待指定时间
    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 辅助函数：等待子元素出现
    function waitForElementWithin(parent, selector, timeout = 3000) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            function check() {
                const element = parent.querySelector(selector);
                if (element) {
                    resolve(element);
                } else if (Date.now() - startTime > timeout) {
                    resolve(null);
                } else {
                    setTimeout(check, 200);
                }
            }

            check();
        });
    }

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

// ==UserScript==
// @name         ASIN->链接 - 店小秘
// @namespace    http://tampermonkey.net/
// @version      1.0.5
// @description  把ASIN转换为链接
// @author       大大怪将军
// @match        https://www.dianxiaomi.com/web/order/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/asin-to-link/asin_to_link.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/asin-to-link/asin_to_link.user.js
// ==/UserScript==


(function() {
    'use strict';
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (url.includes('api/package/detail.json')) {
            console.log(`监听到XMLHttpRequest请求: [${method}]`);

            const originalOnReadyStateChange = this.onreadystatechange;
            this.onreadystatechange = function () {if (this.readyState === 4 && this.status === 200) {
                if (originalOnReadyStateChange && typeof originalOnReadyStateChange === 'function') {originalOnReadyStateChange.apply(this, arguments)}
                setTimeout(() => {extractAsin(this.responseText)}, 100);
            }};
        }

        return originalXhrOpen.apply(this, [method, url, ...args]);
    }

    function extractAsin(responseText) {
        const country = JSON.parse(responseText).data.parentOrder.countryCN;
        let host = {
            '美国': 'www.amazon.com',
            '法国': 'www.amazon.fr',
            '中国': 'www.amazon.cn',
            '德国': 'www.amazon.de',
            '意大利': 'www.amazon.it',
            '西班牙': 'www.amazon.es',
            '日本': 'www.amazon.co.jp',
            '韩国': 'www.amazon.co.kr',
            '土耳其': 'www.amazon.com.tr',
            '波兰': 'www.amazon.pl',
            '荷兰': 'www.amazon.nl',
            '墨西哥': 'www.amazon.com.mx',
            '瑞典': 'www.amazon.se',
        }[country];
        // 处理a标签
        document.querySelectorAll("table.myj-table .order-sku__meta a[target='_blank']").forEach((element) => {
            const asinMatch = element.textContent.trim().match(/(B0[A-Z0-9]{8})/);
            if (asinMatch) {
                const asin = asinMatch[1];
                element.style.fontWeight = 'bold';
                element.href=host ? `https://${host}/dp/${asin}?th=1` : `未知国家[${country}]请联系脚本作者进行添加`;
                console.log(`a标签ASIN: ${asin}, 链接: ${element.href}`);
            }
        });
        // 处理span标签
        document.querySelectorAll('table.myj-table .order-sku__meta span[class="pointer"]').forEach((element) => {
            const asinMatch = element.textContent.trim().match(/(B0[A-Z0-9]{8})/);
            if (asinMatch) {
                const asin = asinMatch[1];
                const a = document.createElement('a');
                a.textContent = element.textContent;
                a.style = element.style;
                a.target = '_blank';
                a.style.fontWeight = 'bold';
                a.href=host ? `https://${host}/dp/${asin}?th=1` : `未知国家[${country}]请联系脚本作者进行添加`;
                element.replaceWith(a);
                console.log(`span标签ASIN: ${asin}, 链接: ${a.href}`);
            }
        });
    }
})();

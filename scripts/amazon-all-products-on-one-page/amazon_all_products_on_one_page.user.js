// ==UserScript==
// @name         加载全部商品 -> 亚马逊 - 搜索页
// @namespace    http://tampermonkey.net/
// @version      1.0.6
// @description  amazon 搜索页 点击按钮加载所有分页商品到当前页, 附加商品列表自动移除碍事的广告
// @author       大大怪将军
// @match        https://www.amazon.com/s?*
// @match        https://www.amazon.com.mx/s?*
// @match        https://www.amazon.co.jp/s?*
// @match        https://www.amazon.co.uk/s?*
// @match        https://www.amazon.fr/s?*
// @match        https://www.amazon.de/s?*
// @match        https://www.amazon.ca/s?*
// @match        https://amazon.*/s?*
// @grant        unsafeWindow
// @grant        GM_log
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/amazon-all-products-on-one-page/amazon_all_products_on_one_page.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/amazon-all-products-on-one-page/amazon_all_products_on_one_page.user.js
// ==/UserScript==

(function() {
    'use strict';
    createLoadButton();

    // 创建加载按钮
    function createLoadButton() {
        const button = document.createElement('button');
        button.id = 'sf-load-all-btn';
        button.textContent = '加载全部商品';
        button.style.position = 'fixed';
        button.style.top = '20px';
        button.style.right = '20px';
        button.style.zIndex = '9999';
        button.style.padding = '10px 20px';
        button.style.backgroundColor = '#febd69';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.onclick = loadAllPages;
        document.body.appendChild(button);
    }

    // 加载所有分页商品
    async function loadAllPages() {
        const user_button = document.querySelector('#sf-load-all-btn');
        user_button.textContent = '加载中...'
        const totalPages = parseInt(document.querySelector('.s-unordered-list-accessibility > *:nth-last-child(2)').textContent.trim());
        let infoPage = parseInt(document.querySelector('.s-unordered-list-accessibility span[aria-current="page"]').textContent.trim());
        const container = document.querySelector('div.s-main-slot');
        document.querySelectorAll('div.s-main-slot > div[data-asin=""]').forEach((element) => {element.remove();})
        for (let i = 0; i < totalPages; i++) {
            if (i + 1 === infoPage) continue;
            user_button.textContent = `加载第 ${i + 1} 页...`
            const items = await requestPage(i + 1);
            items.forEach(item => {
                container.appendChild(item);
            });
        }
        GM_log(`加载完成 共 ${totalPages} 页`)
        user_button.textContent = `加载完成 共 ${totalPages} 页`
        user_button.onclick = () => {
            alert(`已加载完成 共 ${totalPages} 页, 请勿重复加载`)
        }
    }

    async function requestPage(pageNum) {
        const nextPageUrl = new URL(window.location.href);
        nextPageUrl.searchParams.set('page', pageNum);
        const response = await fetch(nextPageUrl.href);
        const responseText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(responseText, 'text/html');
        return doc.querySelectorAll('div.s-result-item[role="listitem"]');
    }

})();

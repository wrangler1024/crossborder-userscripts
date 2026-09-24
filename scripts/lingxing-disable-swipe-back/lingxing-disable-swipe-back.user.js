// ==UserScript==
// @name         领星 ERP 禁用双指滑动后退
// @name:en      Lingxing ERP - Disable Swipe Back Navigation
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      1.1.2
// @description  防止领星 ERP 宽表格横向滚动到边界时误触发浏览器后退，同时保留触摸板双指横向滚动。
// @description:en  Prevents the trackpad "swipe to go back" gesture from being triggered when horizontally scrolling wide data tables in Lingxing ERP.
// @author       wrangler1024
// @match        https://erp.lingxing.com/*
// @match        https://*.lingxing.com/*
// @run-at       document-start
// @grant        none
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lingxing.com
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-disable-swipe-back/lingxing-disable-swipe-back.user.js
// @updateURL    https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-disable-swipe-back/lingxing-disable-swipe-back.user.js
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// ==/UserScript==

(function () {
    'use strict';

    // 领星采购单、产品表现等列表使用 vxe-table 的 body-wrapper 横向滚动。
    // 在真正的滚动容器和根元素切断边界过冲即可；不要把样式施加到单元格等
    // 内层元素，也不要 preventDefault 水平 wheel，否则双指横向滚动会失效。
    const css = `
        html, body {
            overscroll-behavior-x: none !important;
        }
        .vxe-table--body-wrapper.body--wrapper {
            overscroll-behavior-x: contain !important;
        }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
})();

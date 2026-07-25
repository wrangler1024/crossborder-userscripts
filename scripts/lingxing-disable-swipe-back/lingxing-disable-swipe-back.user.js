// ==UserScript==
// @name         领星 ERP 禁用双指滑动后退
// @name:en      Lingxing ERP - Disable Swipe Back Navigation
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      1.0.0
// @description  在领星 ERP 中，查看数据字段较多的表格（如「产品表现」）时，水平拖动容易误触发浏览器后退。本脚本通过切断滚动链来阻止这种误触，仅作用于滚动容器内部。
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

    // 1. CSS：切断"滚动到边界 → 橡皮筋 → 浏览器导航"的链条
    //    overscroll-behavior-x: contain 表示该方向滚动到达边界后，
    //    过冲（橡皮筋动画）不会向上层/浏览器传染，从而阻止后退手势。
    const css = `
        html, body, * {
            overscroll-behavior-x: contain !important;
        }
        html {
            overscroll-behavior-x: none !important;
        }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    // 2. 兜底：拦截触控板水平惯性滚动（仅当 deltaX 显著大于 deltaY 时介入）
    //    作用是减少"普通水平滚动"被内核判定为可触发过冲的滚动，
    //    但对真正的后退手势（底层 gesture，不以 wheel 事件冒泡）无效，
    //    这部分仍由上面的 CSS 负责。
    document.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, { capture: true, passive: false });
})();

// ==UserScript==
// @name         提取品牌词 - 店小秘 - 产品shein
// @namespace    http://tampermonkey.net/
// @version      1.6.1
// @description  点击按钮提取标题中的品牌词并复制
// @author       大大怪将军
// @match        https://www.dianxiaomi.com/web/sheinProduct/draft*
// @match        https://www.dianxiaomi.com/web/sheinProduct/online*
// @match        https://www.dianxiaomi.com/web/sheinProduct/offline*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/extract-brand-words/extract_brand_words.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/extract-brand-words/extract_brand_words.user.js
// ==/UserScript==


console.log('本地脚本被加载');

GM_addStyle(`
/* 悬浮提示文字 */
.extract-brand-btn::after {
    content: "提取品牌";
    /* 初始隐藏 */
    opacity: 0;
    visibility: hidden;
    /* 样式与定位 */
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 10px;
    background-color: #333;
    color: #fff;
    font-size: 12px;
    border-radius: 3px;
    white-space: nowrap;
    /* 过渡动画 */
    transition: opacity 0.2s, visibility 0.2s;
}

/* 鼠标悬浮时显示提示 */
.extract-brand-btn:hover::after {
    opacity: 1;
    visibility: visible;
}

/* 复制文本框（保持隐藏逻辑，优化语义） */
.copy-textarea {
    position: absolute !important;
    clip: rect(0 0 0 0) !important; /* 更彻底的隐藏 */
    width: 1px !important;
    height: 1px !important;
    overflow: hidden !important;
}

/* 弹窗提示优化 */
.toast-notification {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    background: #1e293b; /* 深灰底色更高级 */
    color: #f8fafc; /* 浅色文字 */
    border-radius: 6px;
    z-index: 99999;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15); /* 柔和阴影 */
    font-size: 14px;
    font-weight: 500;
    opacity: 0; /* 初始透明 */
    transform: translate(-50%, -10px); /* 初始位置上移 */
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* 缓动动画 */
}

/* 弹窗显示状态（通过JS添加此类触发动画） */
.toast-notification.show {
    opacity: 1;
    transform: translate(-50%, 0);
}
`);

(function () {
    'use strict';
    // 页面加载完成后添加按钮（避免过早注入）
    window.addEventListener('load', () => {
        setTimeout(addExtractButton, 2000); // 延迟2秒添加按钮，确保页面结构稳定
    });

    function addExtractButton() {
        insertHtmlToXPath(
            '//*[@class="right-nav-container"]',
            2,
            '<div title="提取品牌"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M288 64C252.7 64 224 92.7 224 128L224 384C224 419.3 252.7 448 288 448L480 448C515.3 448 544 419.3 544 384L544 183.4C544 166 536.9 149.3 524.3 137.2L466.6 81.8C454.7 70.4 438.8 64 422.3 64L288 64zM160 192C124.7 192 96 220.7 96 256L96 512C96 547.3 124.7 576 160 576L352 576C387.3 576 416 547.3 416 512L416 496L352 496L352 512L160 512L160 256L176 256L176 192L160 192z"/></svg></div>',
            runExtract
        );
    }

    // 核心提取逻辑
    function runExtract() {
        // 查找元素
        const elements = document.querySelectorAll('.white-space');
        if (elements.length === 0) {
            alert('请确认页面已加载完成');
            return;
        }

        // 提取第一个单词
        const firstWords = [];
        elements.forEach(el => {
            const text = el.textContent.trim();
            const firstWord = text.split(/\s+/)[0];
            if (
                firstWord &&
                /^(?=.*[A-Z])[A-Za-z0-9\W]+$/.test(firstWord) &&   // 包含大写字母、数字、符号
                !/PCS$/.test(firstWord) &&   // 关键：排除以PCS结尾的单词
                !/\d+PC$/.test(firstWord)
            ) {
                firstWords.push(firstWord);
            }
        });

        // 去重
        const uniqueWords = [...new Set(firstWords)];
        const result = uniqueWords.join('\n');

        // 复制到剪贴板
        let textarea = document.querySelector('.copy-textarea');
        if (!textarea) {
            textarea = document.createElement('textarea');
            textarea.className = 'copy-textarea';
            document.body.appendChild(textarea);
        }
        textarea.value = result;
        textarea.select();
        document.execCommand('copy');
        showToast(`提取到 ${uniqueWords.length} 个品牌词 并复制到剪贴板`);
    }

    // 创建顶部通知条
    function showToast(message) {
        // 先移除已存在的弹窗（避免重复）
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) existingToast.remove();

        // 创建新弹窗
        const toast = document.createElement("div");
        toast.className = "toast-notification"; // 使用优化后的类名
        toast.textContent = message;
        document.body.appendChild(toast);

        // 触发显示动画（延迟10ms确保DOM已插入）
        setTimeout(() => toast.classList.add('show'), 10);

        // 3秒后自动消失
        setTimeout(() => {
            toast.classList.remove('show'); // 触发隐藏动画
            setTimeout(() => toast.remove(), 300); // 等待动画结束后移除
        }, 3000);
    }

    /**
     * 插入HTML并绑定事件
     * @param {string} xpath - 父元素XPath
     * @param {number} position - 插入位置
     * @param {string} html - 插入的HTML字符串
     * @param {Function} onClick - 点击事件回调（可选）
     * @returns {HTMLElement|null} 插入的元素
     */
    function insertHtmlToXPath(xpath, position, html, onClick) {
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

// ==UserScript==
// @name         亚马逊物流验证
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  亚马逊物流验证工具
// @author       大大怪将军
// @match        https://track.amazon.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/amazon-track/amazon_track.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/amazon-track/amazon_track.user.js
// ==/UserScript==


(function () {
    'use strict';
    if (!document.getElementById('sf-verify-tracking-btn')) {
        addButton()
    }


    function addButton() {
        const button = document.createElement('button');
        button.id = 'sf-verify-tracking-btn';
        button.textContent = '验证物流';
        button.style.position = 'fixed';
        button.style.top = '10px';
        button.style.right = '10px';
        button.style.zIndex = '9999';
        document.body.appendChild(button);
        // 点击弹出模态框输入框和确定按钮
        button.addEventListener('click', () => {
            const modal = document.createElement('div');
            modal.id = 'sf-verify-tracking-modal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            modal.style.zIndex = '9998';
            document.body.appendChild(modal);
            const input = document.createElement('textarea');
            // 批量输入的物流单号, 需要每个物流单号占一行,输入框支持多行输入,大一些,宽一些
            input.style.width = '20%';
            input.style.height = '60%';
            input.style.resize = 'none'; // 禁止用户调整大小
            input.style.fontFamily = 'monospace'; // 使用等宽字体，便于对齐
            input.style.fontSize = '14px';
            input.style.lineHeight = '1.5';
            input.style.whiteSpace = 'pre'; // 保持换行格式
            input.placeholder = '请输入物流单号，每行一个：\n示例：\n1Z999AA1234567890\n1Z999BB9876543210\n1Z999CC1234567890';
            input.style.position = 'fixed';
            input.style.top = '50px';
            input.style.right = '2.8%';
            input.style.zIndex = '9999';
            modal.appendChild(input);
            const confirmButton = document.createElement('button');
            confirmButton.textContent = '确定';
            confirmButton.style.position = 'fixed';
            confirmButton.style.top = '80px';
            confirmButton.style.right = '1%';
            confirmButton.style.zIndex = '9999';
            modal.appendChild(confirmButton);
            // 点击确定按钮验证物流单号
            confirmButton.addEventListener('click', async () => {
                const trackingNumbers = input.value.trim().split('\n').filter(num => num.trim() !== '');
                const results = [];
                document.querySelector('#sf-verify-tracking-modal').remove();
                if (trackingNumbers.length > 0) {
                    console.log(`准备验证 ${trackingNumbers.length} 个物流单号:`);
                    const button_element = document.querySelector('#sf-verify-tracking-btn')

                    // 使用异步循环处理每个物流单号
                    for (let index = 0; index < trackingNumbers.length; index++) {
                        const num = trackingNumbers[index];
                        button_element.textContent = `验证物流 ${index + 1} / ${trackingNumbers.length}`;
                        const result = await verifyTrackingNumber(num.trim());
                        results.push({trackingNumber: num.trim(), result: result});

                        // 添加小延迟避免请求过快
                        if (index < trackingNumbers.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }

                    button_element.textContent = `验证物流`;
                    downloadExcel(results, '物流号验证结果');
                } else {
                    alert('请输入物流单号');
                }
            });

            const closeButton = document.createElement('button');
            closeButton.textContent = '关闭';
            closeButton.style.position = 'fixed';
            closeButton.style.top = '50px';
            closeButton.style.right = '1%';
            closeButton.style.zIndex = '9999';
            modal.appendChild(closeButton);
            // 点击关闭按钮关闭模态框
            closeButton.addEventListener('click', () => {
                modal.remove();
            });
        });
    }

    async function verifyTrackingNumber(trackingNumber) {
        try {
            const response = await fetch(`https://track.amazon.com/api/tracker/${trackingNumber}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                return `验证失败 (HTTP ${response.status})`;
            }

            const data = await response.json();

            // 根据API响应判断验证结果
            if (data && !data.eventHistory) {
                return '验证通过';
            } else {
                return '验证失败';
            }
        } catch (error) {
            console.error(`验证物流单号 ${trackingNumber} 时出错:`, error);
            return '验证失败 (网络错误)';
        }
    }

    function downloadExcel(items, fileName) {
        if (items.length === 0) {
            alert(`没有可导出的数据`);
            return;
        }
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(items);
        XLSX.utils.book_append_sheet(workbook, worksheet, ''); // 默认工作表Sheet1
        XLSX.utils.sheet_add_aoa(worksheet, [['物流单号', '验证结果']], {origin: 'A1'});
        const fileNameWithTimestamp = `${fileName}_${new Date().getTime()}.xlsx`; // 文件名带时间戳
        XLSX.writeFile(workbook, fileNameWithTimestamp); // SheetJS内置的下载函数
    }
})();

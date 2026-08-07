// ==UserScript==
// @name         批量采集到妙手采集箱 - 妙手
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  批量采集到妙手采集箱
// @author       大大怪将军
// @match        https://*.amazon.*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/ms-batch-plugin-collection/ms_batch_plugin_collection.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/ms-batch-plugin-collection/ms_batch_plugin_collection.user.js
// ==/UserScript==


(function() {
    'use strict';
    const sf_button_num = 1;
    const sf_button_id = `sf-batch-collection-btn-${sf_button_num}`
    setTimeout(() => {addButton()}, 1000);

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
            mainButton.textContent = '批量采集到妙手采集箱';
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

    // async function mainFunction() {
    //     const inputUrlOrg = prompt("请输入需要采集的链接（换行或制表符分隔）：", '');
    //     if (!inputUrlOrg) {return;}
    //
    //     const inputAllUrl = inputUrlOrg.split(/[\n\t]+/).map(item => item.trim()).filter(item => item !== '');
    //     const collectBtnSelector = '.earth-wxt-collect-panel button.earth-wxt-button--primary';
    //     for (const url of inputAllUrl) {
    //         window.open(url, '_blank', 'noopener,noreferrer');
    //         document.addEventListener('DOMContentLoaded', async function() {
    //             console.log("新页面 DOM 加载完成，准备点击采集按钮！");
    //             // 等待10秒，确保按钮加载完成
    //             await new Promise(resolve => setTimeout(resolve, 10000));
    //
    //             let collectBtn = await document.querySelector(collectBtnSelector);
    //             if (!collectBtn) {
    //                 for (let i = 0; i < 3; i++) {
    //                     await new Promise(resolve => setTimeout(resolve, 500));
    //                     collectBtn = await document.querySelector(collectBtnSelector);
    //                     if (collectBtn) break;
    //                 }
    //             }
    //
    //             if (collectBtn) {
    //                 collectBtn.click();
    //                 console.log("采集按钮已点击！");
    //             } else {
    //                 console.log(`未找到采集按钮（选择器：${collectBtnSelector}）`);
    //             }
    //         });
    //     }
    // }

    async function mainFunction() {
        const button_log = document.getElementById(sf_button_id);

        const inputUrlOrg = prompt("请输入需要采集的链接\n\n换行或制表符分隔：\n", 'https://www.amazon.com/dp/B0FXVQSQD1\n' +
            'https://www.amazon.com/dp/B0FKBL4YWB');
        if (!inputUrlOrg) {return;}
        const inputAllUrl = inputUrlOrg.split(/[\n\t]+/).map(item => item.trim()).filter(item => item !== '');
        for (const url of inputAllUrl) {
            const amazonInfo = await getAmazonInfo(button_log, url);
            console.log(amazonInfo);
            if (amazonInfo.error) {
                continue;
            }
            await sendToMsCollectionBox(button_log, amazonInfo.asinList, amazonInfo.asin, amazonInfo.landingAsin);
        }
    }

    async function getAmazonInfo(button_log, url) {
        const landingAsin = url.match(/\/(B0[0-9A-Z]{8})[?\/]/)[1];
        const amazonInfo = {
            url: url,
            landingAsin: landingAsin,
            asin: null,
            asinList: null,
            error: null,
        };
        const response = await fetch(url);
        const responseText = await response.text();
        const asinListMatch = responseText.match(/\{"sortedVariations":.*?}]}}/);
        if (!asinListMatch) {
            amazonInfo.error = '未找到ASIN列表';
            return amazonInfo;
        }

        const orgJson = JSON.parse(asinListMatch.toString());
        const all_data = orgJson.sortedDimValuesForAllDims
        amazonInfo.asin = JSON.stringify(all_data).match(/ref=twister_(B0[0-9A-Z]{8})/)[1];
        const allAsinData = []
        Object.entries(all_data).forEach(([value]) => {
            value.forEach(item => {
                allAsinData.push(item.defaultAsin);
            });
        });
        amazonInfo.asinList = allAsinData.join(',');
        return amazonInfo;
    }


    // 发送到妙手采集箱
    async function sendToMsCollectionBox(button_log, asinList, asin, landingAsin) {
        const url = "https://www.amazon.com/gp/product/ajax/twisterDimensionSlotsDefault"
        const params = {
            "isDimensionSlotsAjax": "1",
            "asinList": asinList,
            "vs": "1",
            "experienceId": "twisterDimensionSlotsDefault",
            "asin": asin,
            "showFancyPrice": "false",
            "twisterFlavor": "twisterPlusDesktopConfigurator",
            "deviceType": "web",
            "landingAsin": landingAsin,
            // "productTypeDefinition": "VIDEO_GAME_CONSOLE",
            // "productGroupId": "video_games_display_on_website",
            "productTypeDefinition": "WIG",
            "productGroupId": "beauty_display_on_website",
            "parentAsin": "",
            "isPrime": "0",
            "deviceOs": "unrecognized"
        }

        // 使用XHR替代fetch
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const fullUrl = `${url}?${new URLSearchParams(params)}`;

            xhr.open('GET', fullUrl, true);
            // xhr.withCredentials = true; // 相当于credentials: 'include'
            // xhr.setRequestHeader('Content-Type', 'application/json');

            xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                    console.log('[XHR] 请求成功:', xhr.status);
                    resolve(xhr.responseText);
                } else {
                    console.error('[XHR] 请求失败:', xhr.status, xhr.statusText);
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                }
            };

            xhr.onerror = function() {
                console.error('[XHR] 网络错误');
                reject(new Error('网络错误'));
            };

            xhr.ontimeout = function() {
                console.error('[XHR] 请求超时');
                reject(new Error('请求超时'));
            };

            xhr.timeout = 30000; // 30秒超时
            xhr.send();
        }).catch(err => {
            console.error('[XHR] 采集请求错误:', err);
        });
    }
})();

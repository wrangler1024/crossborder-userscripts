// ==UserScript==
// @name         批量议价 - SHEIN
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  批量议价商品
// @author       大大怪将军
// @match        https://sellerhub.shein.com/*
// @match        https://sso.geiwohuo.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-agree-to-negotiate-price/shein_agree_to_negotiate_price.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-agree-to-negotiate-price/shein_agree_to_negotiate_price.user.js
// ==/UserScript==


(function() {
    'use strict';
    const sf_button_num = 1;
    const sf_button_id = `sf-agree-to-negotiate-price-btn-${sf_button_num}`

    const targetPaths = ['/#/dpas/discuss-price/list'];
    if (targetPaths.some(path => window.location.href.includes(path))) {
        setTimeout(addButton, 500);
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
            mainButton.id = sf_button_id; // 带下拉箭头提示
            mainButton.textContent = '批量议价 ▼'; // 带下拉箭头提示
            mainButton.style.width = '100%'; // 宽度与主按钮一致
            mainButton.style.padding = '10px 10px';
            mainButton.style.backgroundColor = '#febd69';
            mainButton.style.border = 'none';
            mainButton.style.borderRadius = '4px';
            mainButton.style.cursor = 'pointer';
            mainButton.style.fontWeight = 'bold';
            dropdownContainer.appendChild(mainButton);

            const dropdownMenu = document.createElement('div');
            dropdownMenu.style.display = 'none'; // 初始隐藏
            dropdownMenu.style.marginTop = '5px';
            dropdownMenu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'; // 阴影增强层次感
            dropdownMenu.style.borderRadius = '4px';
            dropdownMenu.style.overflow = 'hidden'; // 子按钮圆角不溢出
            dropdownContainer.appendChild(dropdownMenu);

            const soldOutButton = document.createElement('button');
            soldOutButton.textContent = '同意平台建议价';
            soldOutButton.style.width = '100%'; // 宽度与主按钮一致
            soldOutButton.style.padding = '10px 10px';
            soldOutButton.style.backgroundColor = '#fff';
            soldOutButton.style.border = 'none';
            soldOutButton.style.borderBottom = '1px solid #f0f0f0'; // 分隔线
            soldOutButton.style.textAlign = 'left';
            soldOutButton.style.cursor = 'pointer';
            soldOutButton.onclick = agreeToNegotiatePriceFunction;
            dropdownMenu.appendChild(soldOutButton);

            const checkedButton = document.createElement('button');
            checkedButton.textContent = '拒绝,放弃上新 - 待确认';
            checkedButton.style.width = '100%';
            checkedButton.style.padding = '10px 10px';
            checkedButton.style.backgroundColor = '#fff';
            checkedButton.style.border = 'none';
            checkedButton.style.textAlign = 'left';
            checkedButton.style.cursor = 'pointer';
            soldOutButton.style.borderBottom = '1px solid #f0f0f0'; // 分隔线
            checkedButton.onclick = rejectAndGiveUpFunction;
            dropdownMenu.appendChild(checkedButton);

            mainButton.addEventListener('mouseover', function() {dropdownMenu.style.display = 'block';});
            dropdownContainer.addEventListener('mouseout', function(event) {
                if (!dropdownContainer.contains(event.relatedTarget)) {
                    dropdownMenu.style.display = 'none';
                }
            });
        }
    }

    async function agreeToNegotiatePriceFunction() {
        const logButton = document.getElementById(sf_button_id);
        const searchSKCOrg = prompt("请输入SKC（不输入则处理所有SKC）：", '');
        const searchSKC = searchSKCOrg.split(/[\n\t ]+/).map(item => item.trim()).filter(item => item !== '');
        console.log(searchSKC.toString());
        const allData = await getAllData(logButton, searchSKC);
        const batchSize = 200;
        for (let i = 0; i < allData.length; i += batchSize) {
            logButton.textContent = `正在处理第${i + 1}到${i + batchSize}条`;
            const batch = allData.slice(i, i + batchSize);
            await request_agree(batch);
        }
        logButton.textContent = `完成:本次处理${allData.length}条数据`;
    }

    async function rejectAndGiveUpFunction() {
        alert('该功能尚未开发,请联系管理员')
    }

    async function getAllData(button_log, searchSKC=[]) {
        const allSKC = []
        const pageSize = 200
        let totalPage = 1
        let currentPage = 1

        const post_body = {
            "bargain_status": 1,
        }
        if (searchSKC.length > 0) {
            post_body["skc_name_list"] = searchSKC
        }
        while (currentPage <= totalPage) {
            button_log.textContent = totalPage === 1 ? `正在读取第${currentPage}页数据` : `正在读取第${currentPage}/${totalPage}页数据`;
            await fetch(`/dpas-api-prefix/dpas/discuss/bargain_page?page_num=${currentPage}&page_size=${pageSize}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(post_body)
            })
                .then(async response => {
                    const data = await response.json();
                    allSKC.push(...data.info.data.map(item => item));
                    totalPage = Math.ceil(data.info.meta.count / pageSize);
                })
                .catch(err => console.error(err));
            currentPage++;
        }
        return allSKC;
    }

    async function request_agree(batchData) {
        await fetch('/dpas-api-prefix/dpas/discuss/batch_handle_cost_discuss', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "confirm_infos": batchData.map(item => ({
                    "discuss_sn": item.bargain_sn,
                    "document_sn": item.document_sn,
                    "discuss_audit_type": 1,
                }))
            })
        })
            .then(async response => {
                const data = await response.json();
                if (data.msg === 'OK') {
                    console.log(`处理${batchData.length}条数据成功`);
                } else {
                    console.error(`处理${batchData.length}条数据失败: ${data.info.meta.message}`);
                }
            })
            .catch(err => console.error(err))
    }
})();

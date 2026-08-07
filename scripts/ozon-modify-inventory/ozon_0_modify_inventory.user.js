// ==UserScript==
// @name         批量修改 - OZON
// @namespace    http://tampermonkey.net/
// @version      1.0.2
// @description  1) 批量修改OZON商品库存 2) 批量修改OZON商品价格..暂未开发
// 2026-01-09 1.0.2 修复: 不能修改库存为0
// @author       大大怪将军
// @match        https://seller.ozon.ru/app/products*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/ozon-modify-inventory/ozon_0_modify_inventory.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/ozon-modify-inventory/ozon_0_modify_inventory.user.js
// ==/UserScript==


(function() {
    'use strict';
    const sf_button_num = 0;
    const sf_button_id = `sf-modify-inventory-btn-${sf_button_num}`

    setTimeout(addButton, 500); // 简化：函数名可直接作为参数，无需箭头函数包裹

    function addButton() {
        if (!document.getElementById(sf_button_id)) {
            const dropdownContainer = document.createElement('div');
            dropdownContainer.id = `${sf_button_id}-container`;
            dropdownContainer.style.position = 'fixed';
            dropdownContainer.style.top = `${10 + sf_button_num * 40}px`;
            dropdownContainer.style.right = '10px';
            dropdownContainer.style.zIndex = '9999';
            dropdownContainer.style.display = 'flex';
            dropdownContainer.style.flexDirection = 'column';
            document.body.appendChild(dropdownContainer);

            const mainButton = document.createElement('button');
            mainButton.id = sf_button_id; // 带下拉箭头提示
            mainButton.textContent = '批量修改 ▼'; // 带下拉箭头提示
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
            soldOutButton.textContent = '我的库存';
            soldOutButton.style.width = '100%'; // 宽度与主按钮一致
            soldOutButton.style.padding = '10px 10px';
            soldOutButton.style.backgroundColor = '#fff';
            soldOutButton.style.border = 'none';
            soldOutButton.style.borderBottom = '1px solid #f0f0f0'; // 分隔线
            soldOutButton.style.textAlign = 'left';
            soldOutButton.style.cursor = 'pointer';
            soldOutButton.onclick = myInventoryButtonFunction;
            dropdownMenu.appendChild(soldOutButton);

            const checkedButton = document.createElement('button');
            checkedButton.textContent = '价格';
            checkedButton.style.width = '100%';
            checkedButton.style.padding = '10px 10px';
            checkedButton.style.backgroundColor = '#fff';
            checkedButton.style.border = 'none';
            checkedButton.style.textAlign = 'left';
            checkedButton.style.cursor = 'pointer';
            soldOutButton.style.borderBottom = '1px solid #f0f0f0'; // 分隔线
            checkedButton.onclick = priceButtonFunction;
            dropdownMenu.appendChild(checkedButton);

            mainButton.addEventListener('mouseover', function() {dropdownMenu.style.display = 'block';});
            dropdownContainer.addEventListener('mouseout', function(event) {
                if (!dropdownContainer.contains(event.relatedTarget)) {
                    dropdownMenu.style.display = 'none';
                }
            });
        }
    }

    async function myInventoryButtonFunction() {
        const button_log = document.getElementById(sf_button_id);

        const inputCountInt = parseInt(prompt("修改为: ", '999'));
        if (isNaN(inputCountInt)) {alert('请输入正整数或0');return;}
        let offerIds = [...document.querySelectorAll('tbody > tr > td span[title][data-widget]')].map(span => span.getAttribute('title'));
        const baseInfo = await getBaseAccountInfo();
        await fetch(
            `/api/site/item-stock-service/rfbs/item/stock/batch-set`,
            {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "company_id":baseInfo.company_id,
                    "stocks":offerIds.map(offerId => ({
                        "offer_id":offerId,
                        "stock":inputCountInt,
                        "warehouse_id":baseInfo.warehouse_id,
                    }))
                })
            }
        )
            .then(response => response.json())
            .then(data => {console.log(data);})
            .catch(error => console.log(error));
        button_log.textContent = `${offerIds.length}个商品库存修改${inputCountInt}`;
    }

    async function priceButtonFunction() {
        const button_log = document.getElementById(sf_button_id);
        alert('价格修改功能暂未实现');
        button_log.textContent = `已修改${offerIds.length}个商品价格`;
    }

    // 获取基础数据
    async function getBaseAccountInfo() {
        const response = await fetch(`/api/site/logistic-service/v2/warehouse/list/short`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'company_id': parseInt(getCookieValue('sc_company_id')),
                "status_not_in": ["disabled"],
            })
        })
        const data = await response.json();
        return data.result[0];
    }

    function getCookieValue(cookieName) {
        const cookieArr = document.cookie.split('; ');
        for (let cookie of cookieArr) {
            const [key, value] = cookie.split('=');
            if (key === cookieName) {
                return decodeURIComponent(value);
            }
        }
        return null;
    }
})();

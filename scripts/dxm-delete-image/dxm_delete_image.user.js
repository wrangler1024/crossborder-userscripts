// ==UserScript==
// @name         删除图片 - 店小秘
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  删除店小秘商品图片
// @author       大大怪将军
// @match        https://www.dianxiaomi.com/album/index.htm
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-delete-image/dxm_delete_image.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-delete-image/dxm_delete_image.user.js
// ==/UserScript==


(function() {
    'use strict';
    const sf_button_num = 1;
    const sf_button_id = `sf-delete-image-btn-${sf_button_num}`

    setTimeout(addButton, 500);

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
            mainButton.textContent = '删除图片 ▼'; // 带下拉箭头提示
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
            soldOutButton.textContent = '删除第N页之后的图片';
            soldOutButton.style.width = '100%'; // 宽度与主按钮一致
            soldOutButton.style.padding = '10px 10px';
            soldOutButton.style.backgroundColor = '#fff';
            soldOutButton.style.border = 'none';
            soldOutButton.style.borderBottom = '1px solid #f0f0f0'; // 分隔线
            soldOutButton.style.textAlign = 'left';
            soldOutButton.style.cursor = 'pointer';
            soldOutButton.onclick = deleteImageFunction;
            dropdownMenu.appendChild(soldOutButton);

            mainButton.addEventListener('mouseover', function() {dropdownMenu.style.display = 'block';});
            dropdownContainer.addEventListener('mouseout', function(event) {
                if (!dropdownContainer.contains(event.relatedTarget)) {
                    dropdownMenu.style.display = 'none';
                }
            });
        }
    }

    async function deleteImageFunction() {
        const logButton = document.getElementById(sf_button_id);
        const inputPageNumber = prompt("从第N页开始删除(需要大于等于6)：", '6').trim();
        if (!inputPageNumber || isNaN(inputPageNumber) || parseInt(inputPageNumber) < 6) {
            alert("请输入一个有效的页数（大于等于6的整数）");
            return;
        }
        const pageNumber = parseInt(inputPageNumber);

        let dataCount = 0;
        logButton.textContent = `处理中...`;
        while (true) {
            const pageRequest = await fetch(
                `https://www.dianxiaomi.com/album/list.htm?pageNo=${pageNumber + 1}&pageSize=300&name=&fullCid=&startTime=&endTime=&fileType=0`
                , {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            const pageText = await pageRequest.text();
            const pageHtml = new DOMParser().parseFromString(pageText, 'text/html');
            const pageIds = [...pageHtml.querySelectorAll('.cur-default > input')].map(input => input.getAttribute('value'));
            console.log(pageIds.length);
            console.log(pageIds);
            if (pageIds.length >= 300) {
                await fetch(
                    'https://www.dianxiaomi.com/album/delPic.json'
                    , {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'Accept': 'application/json, text/javascript, */*; q=0.01',
                            'X-Requested-With': 'XMLHttpRequest',
                            'Referer': 'https://www.dianxiaomi.com/album/index.htm'
                        },
                        body: `ids=${pageIds.join(',')}`
                    }
                );
                dataCount += pageIds.length;
                logButton.textContent = `处理中:已删除 ${dataCount} 个图片`;
            } else {
                break;
            }
        }
        logButton.textContent = `完成:本次删除 ${dataCount} 个图片`;
    }
})();

// ==UserScript==
// @name         批量上下架 - SHEIN
// @namespace    http://tampermonkey.net/
// @version      1.0.4
// @description  批量上下架商品
// @author       大大怪将军
// @match        https://sellerhub.shein.com/*
// @match        https://sso.geiwohuo.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-batch-shelf/shein_removed_shelves.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-batch-shelf/shein_removed_shelves.user.js
// ==/UserScript==


(function() {
    'use strict';
    const sf_button_num = 1;
    const sf_button_id = `sf-removed-shelves-btn-${sf_button_num}`

    const targetPaths = ['/#/spmp/commdities/list'];
    if (targetPaths.some(path => window.location.href.includes(path))) {
        setTimeout(addButton, 500); // 简化：函数名可直接作为参数，无需箭头函数包裹
    }

    const siteMapping = {
        "法国站": {"site_abbr": "shein-fr", "store_type": 1},
        "西班牙站": {"site_abbr": "shein-es", "store_type": 1},
        "德国站": {"site_abbr": "shein-de", "store_type": 1},
        "意大利站": {"site_abbr": "shein-it", "store_type": 1},
        "荷兰站": {"site_abbr": "shein-nl", "store_type": 1},
        "瑞典站": {"site_abbr": "shein-se", "store_type": 1},
        "波兰站": {"site_abbr": "shein-pl", "store_type": 1},
        "葡萄牙站": {"site_abbr": "shein-pt", "store_type": 1},
        "美国站": {"site_abbr": "shein-us", "store_type": 1},
        "墨西哥站": {"site_abbr": "shein-mx", "store_type": 1},
    };

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
            mainButton.textContent = '批量上下架 ▼'; // 带下拉箭头提示
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
            soldOutButton.textContent = '批量下架 - 已售罄';
            soldOutButton.style.width = '100%'; // 宽度与主按钮一致
            soldOutButton.style.padding = '10px 10px';
            soldOutButton.style.backgroundColor = '#fff';
            soldOutButton.style.border = 'none';
            soldOutButton.style.borderBottom = '1px solid #f0f0f0'; // 分隔线
            soldOutButton.style.textAlign = 'left';
            soldOutButton.style.cursor = 'pointer';
            soldOutButton.onclick = soldOutButtonFunction;
            dropdownMenu.appendChild(soldOutButton);

            const checkedButton = document.createElement('button');
            checkedButton.textContent = '批量下架 - 指定SKC';
            checkedButton.style.width = '100%';
            checkedButton.style.padding = '10px 10px';
            checkedButton.style.backgroundColor = '#fff';
            checkedButton.style.border = 'none';
            checkedButton.style.textAlign = 'left';
            checkedButton.style.cursor = 'pointer';
            soldOutButton.style.borderBottom = '1px solid #f0f0f0'; // 分隔线
            checkedButton.onclick = checkedButtonFunction;
            dropdownMenu.appendChild(checkedButton);

            const BulkListingButton = document.createElement('button');
            BulkListingButton.textContent = '批量上架 - 指定SKC';
            BulkListingButton.style.width = '100%';
            BulkListingButton.style.padding = '10px 10px';
            BulkListingButton.style.backgroundColor = '#fff';
            BulkListingButton.style.border = 'none';
            BulkListingButton.style.textAlign = 'left';
            BulkListingButton.style.cursor = 'pointer';
            BulkListingButton.onclick = BulkListingButtonFunction;
            dropdownMenu.appendChild(BulkListingButton);

            mainButton.addEventListener('mouseover', function() {dropdownMenu.style.display = 'block';});
            dropdownContainer.addEventListener('mouseout', function(event) {
                if (!dropdownContainer.contains(event.relatedTarget)) {
                    dropdownMenu.style.display = 'none';
                }
            });
        }
    }

    async function BulkListingButtonFunction() {
        const button_log = document.getElementById(sf_button_id);

        const inputSKCOrg = prompt("请输入上架的SKC（换行或制表符分隔）：", '');
        if (!inputSKCOrg) {return;}
        const inputSKC = inputSKCOrg.split(/[\n\t]+/).map(item => item.trim()).filter(item => item !== '');

        const inputSitesOrg = prompt("请输入上架的站（逗号分隔）：", Object.keys(siteMapping).join(','));
        if (!inputSitesOrg) {return;}
        const inputSites = inputSitesOrg.split(',')
            .map(item => item.trim())
            .filter(siteName => siteMapping[siteName])
            .map(siteName => siteMapping[siteName]);

        const skcNameList = inputSKC
        for (let i = 0; i < skcNameList.length; i += 50) {
            button_log.textContent = `正在上架第${i + 1}到${i + 50}个SKC`;
            const batch = skcNameList.slice(i, i + 50);
            await remove(batch, inputSites, 1);
        }
        button_log.textContent = `已上架${skcNameList.length}个SKC`;
    }

    async function checkedButtonFunction() {
        const button_log = document.getElementById(sf_button_id);

        const inputSKCOrg = prompt("请输入下架的SKC（换行或制表符分隔）：", '');
        if (!inputSKCOrg) {return;}
        const inputSKC = inputSKCOrg.split(/[\n\t]+/).map(item => item.trim()).filter(item => item !== '');

        const inputSitesOrg = prompt("请输入下架的站（逗号分隔）：", Object.keys(siteMapping).join(','));
        if (!inputSitesOrg) {return;}
        const inputSites = inputSitesOrg.split(',')
            .map(item => item.trim())
            .filter(siteName => siteMapping[siteName])
            .map(siteName => siteMapping[siteName]);

        const skcNameList = inputSKC
        for (let i = 0; i < skcNameList.length; i += 50) {
            button_log.textContent = `正在下架第${i + 1}到${i + 50}个SKC`;
            const batch = skcNameList.slice(i, i + 50);
            await remove(batch, inputSites, 2);
        }
        button_log.textContent = `已下架${skcNameList.length}个SKC`;
    }

    async function soldOutButtonFunction() {
        const button_log = document.getElementById(sf_button_id);

        const inputSitesOrg = prompt("[已售罄] - 请输入下架的站（逗号分隔）：", Object.keys(siteMapping).join(','));
        if (!inputSitesOrg) {return;}
        const inputSites = inputSitesOrg.split(',')
            .map(item => item.trim())
            .filter(siteName => siteMapping[siteName])
            .map(siteName => siteMapping[siteName]);

        const skcNameList = await getAllSKC(button_log)
        for (let i = 0; i < skcNameList.length; i += 50) {
            button_log.textContent = `正在下架第${i + 1}到${i + 50}个SKC`;
            const batch = skcNameList.slice(i, i + 50);
            await remove(batch, inputSites, 2);
        }
        button_log.textContent = `已下架${skcNameList.length}个SKC`;
    }

    // 获取全部页数据
    async function getAllSKC(button_log) {
        const allSKC = []
        const pageSize = 100
        let totalPage = 1
        let currentPage = 1

        while (currentPage <= totalPage) {
            button_log.textContent = totalPage === 1 ? `正在读取第${currentPage}页数据` : `正在读取第${currentPage}/${totalPage}页数据`;
            await fetch(`/spmp-api-prefix/spmp/product/list?page_num=${currentPage}&page_size=${pageSize}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "language": "de",
                    "only_recommend_resell": false,
                    "only_spmb_copy_product": false,
                    "search_abandon_product": false,
                    "search_illegal": false,
                    "search_less_inventory": false,
                    "shelf_type": "SOLD_OUT",
                    "sort_type": 1
                })
            })
                .then(async response => {
                    const data = await response.json();
                    allSKC.push(...data.info.data.flatMap(item => item.skc_info_list.map(skc => skc.skc_name)));
                    totalPage = Math.ceil(data.info.meta.count / pageSize);
                })
                .catch(err => console.error(err));
            currentPage++;
        }
        return allSKC;
    }


    // 修改上下架状态
    async function remove(skcNameList, sites, shelf_state) {

        await fetch('/spmp-api-prefix/spmp/product/batch_operate_Shelf_status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "shelf_state":shelf_state,  // 2:下架, 1:上架
                "sites":sites,
                "skc_names":skcNameList
            })
        })
            .then(async response => {
                const data = await response.json();
                if (data.msg === 'OK') {
                    console.log(`下架${skcNameList.length}个SKC成功`);
                } else {
                    console.error(`下架${skcNameList.length}个SKC失败: ${data.info.meta.message}`);
                }
            })
            .catch(err => console.error(err))
    }
})();

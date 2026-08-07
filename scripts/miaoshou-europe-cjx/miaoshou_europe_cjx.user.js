// ==UserScript==
// @name         上架指定站点 - SHEIN采集箱 - 产品 - 妙手
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  上架指定站点 - SHEIN采集箱 - 产品 - 妙手
// @author       大大怪将军
// @match        https://erp.91miaoshou.com/shein/collect_box/items
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/miaoshou-europe-cjx/miaoshou_europe_cjx.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/miaoshou-europe-cjx/miaoshou_europe_cjx.user.js
// ==/UserScript==


(function() {
    'use strict';
    const sf_button_id = 'sf-load-all-btn'

    if (window.location.href.includes('/#/spmp/commdities/list')) {
        console.log(`子脚本开始执行*默认操作添加一个按钮********************************************************************`);
        setTimeout(() => {addButton();}, 2000);
    }

    function addButton() {
        if (!document.getElementById(sf_button_id)) {
            const button = document.createElement('button');
            button.id = sf_button_id;
            button.textContent = '提取已上架数据';
            button.style.position = 'fixed';
            button.style.top = '20px';
            button.style.right = '20px';
            button.style.zIndex = '9999';
            button.style.padding = '10px 20px';
            button.style.backgroundColor = '#febd69';
            button.style.border = 'none';
            button.style.borderRadius = '4px';
            button.style.cursor = 'pointer';
            button.onclick = clickButton;
            document.body.appendChild(button);
        }
    }

    async function clickButton() {
        const sf_button_element = document.getElementById(sf_button_id);
        const pageSize = parseInt(document.querySelector('.so-pagination-pagesize span[title]').textContent.match(/\d+/)[0]);
        const totalPages = parseInt(document.querySelector('.so-pagination-links a:nth-last-child(2)').textContent.match(/\d+/)[0]);
        console.log(`pageSize: ${pageSize}, totalPages: ${totalPages}`);

        sf_button_element.textContent = '正在分批请求所有页面...';

        // 分批处理，每批10个请求
        const batchSize = 10;
        const allItems = [];

        for (let batchStart = 1; batchStart <= totalPages; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize - 1, totalPages);
            sf_button_element.textContent = `正在获取${batchStart}-${batchEnd}页...`;

            const batchPromises = [];
            for (let pageNum = batchStart; pageNum <= batchEnd; pageNum++) {batchPromises.push(postData(pageNum, pageSize));}
            const batchData = await Promise.all(batchPromises);
            batchData.forEach((pageData, index) => {
                if (pageData && pageData.info && pageData.info.data) {
                    allItems.push(...pageData.info.data);
                    console.log(`第${batchStart + index}页数据获取成功，共${pageData.info.data.length}条`);
                } else {
                    console.log(`第${batchStart + index}页数据获取失败{${JSON.stringify(pageData)}}`);
                }
            });

            if (batchEnd < totalPages) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        sf_button_element.textContent = '正在生成Excel...';
        downloadExcel(allItems);
        sf_button_element.textContent = '已提取全部数据';
        sf_button_element.onclick = () => alert(`已提取全部数据, 共${allItems.length}条, 请在 下载Excel 中查看`);
    }

    function downloadExcel(items) {
        if (items.length === 0) {
            alert('没有可导出的数据');
            return;
        }
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(items);
        XLSX.utils.book_append_sheet(workbook, worksheet, '数据列表'); // '数据列表'是工作表名称
        const fileName = `商品列表_已上架_${new Date().getTime()}.xlsx`; // 文件名带时间戳
        XLSX.writeFile(workbook, fileName); // SheetJS内置的下载函数
    }

    async function postData(pageNum, pageSize) {
        const response = await fetch(`https://sellerhub.shein.com/spmp-api-prefix/spmp/product/list?page_num=${pageNum}&page_size=${pageSize}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                "language": "en",
                "only_recommend_resell": false,
                "only_spmb_copy_product": false,
                "search_abandon_product": false,
                "search_illegal": false,
                "search_less_inventory": false,
                "shelf_type": "ON_SHELF",
                "sort_type": 1
            }),
        })
        return await response.json();
    }
})();

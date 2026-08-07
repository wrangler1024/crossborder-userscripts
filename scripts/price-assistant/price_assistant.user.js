// ==UserScript==
// @name         审核助手 - 店小秘
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  审核助手 - 店小秘
// @author       大大怪将军
// @match        https://www.dianxiaomi.com/web/order/paid?go=m100*
// @match        https://www.dianxiaomi.com/web/order/all?go=m1-1*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @downloadURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/price-assistant/price_assistant.user.js
// @updateURL https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/price-assistant/price_assistant.user.js
// ==/UserScript==

(function() {
    'use strict';
    const originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(data) {
        if (this._url && (this._url.includes('api/package/list.json') || this._url.includes('api/package/searchPackage.json')) && data && data.toString().includes('&state=paid&')) {
            const originalOnReadyStateChange = this.onreadystatechange;
            this.onreadystatechange = function () {
                if (this.readyState === 4 && this.status === 200) {
                    if (originalOnReadyStateChange && typeof originalOnReadyStateChange === 'function') {
                        originalOnReadyStateChange.apply(this, arguments);
                    }
                    console.log('检测到目标请求,开始注入内容');
                    setTimeout(() => {extractAsin()}, 500);
                }
            };
        }
        return originalXhrSend.apply(this, arguments);
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._url = url;
        return originalXhrOpen.apply(this, [method, url, ...args]);
    };

    function extractAsin() {
        let hostMapping = {
            '美国': 'www.amazon.com',
            '法国': 'www.amazon.fr',
            '中国': 'www.amazon.cn',
            '德国': 'www.amazon.de',
            '意大利': 'www.amazon.it',
            '西班牙': 'www.amazon.es',
            '日本': 'www.amazon.co.jp',
            '韩国': 'www.amazon.co.kr',
            '土耳其': 'www.amazon.com.tr',
            '波兰': 'www.amazon.pl',
            '荷兰': 'www.amazon.nl',
            '墨西哥': 'www.amazon.com.mx',
            '瑞典': 'www.amazon.se',
        };
        // 处理span标签
        document.querySelectorAll('.vxe-table--body-wrapper tr[class="vxe-body--row"]').forEach((element) => {
            const asinElements = element.querySelectorAll('.order-sku__meta a.order-sku__name')
            if (asinElements.length > 1) {
                return;
            }
            const asinElement = asinElements[0];
            const asinMatch = asinElement.textContent.trim().match(/(B0[A-Z0-9]{8})/)
            if (!asinMatch) {
                console.log(`未找到ASIN: ${element.textContent.trim()}`);
                return
            }
            const col_country = element.querySelector('.col_13');
            const country = col_country.textContent.trim().match(/「(.*?) 」/)[1];
            const host = hostMapping[country];
            const asin = asinMatch[1];

            asinElement.style.fontWeight = 'bold';
            asinElement.style.color = 'rgba(185,150,250,0.91)';
            asinElement.href=host ? `https://${host}/dp/${asin}?th=1&psc=1` : `未知国家[${country}]请联系脚本作者进行添加`;
            asinElement.onclick = (event) => {
                if (!event.ctrlKey) {
                    event.preventDefault();
                    const order_price = element.querySelector('.order-price__total').textContent.trim()
                    const orderData = {
                        'order_asin': asin,
                        'order_country': country,
                        'order_host': host,
                        'order_link': asinElement.href,
                        'order_price_org': order_price,
                        'order_price': parseFloat(order_price.match(/[\d.]+/)[0]),
                        'package_id': element.getAttribute('rowid')
                    }
                    floatingOpen(asinElement.href, orderData);
                }
            };
            // console.log(`span标签ASIN: ${asin}, 链接: ${asinElement.href}`);
        });
    }

    // 在悬浮窗口打开链接
    function floatingOpen(url, orderData) {
        console.log('检测到点击ASIN:', orderData);
        const existingModal = document.getElementById('price-assistant-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // 创建模态框
        const modal = document.createElement('div');
        modal.id = 'price-assistant-modal';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.right = '0';
        modal.style.height = '100vh';
        modal.style.transform = 'none';
        modal.style.backgroundColor = 'white';
        modal.style.border = '2px solid #ccc';
        modal.style.borderRadius = '8px 0 0 8px';
        modal.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        modal.style.minWidth = '1200px'; // 调整模态框的最小宽度，可根据需要修改这个值
        modal.style.minHeight = '100vh'; // 调整模态框的最小高度，可根据需要修改这个值
        modal.style.zIndex = '9999';
        modal.style.overflow = 'hidden';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';

        // 标题栏（用于拖动）
        const titleBar = document.createElement('div');
        titleBar.textContent = '核价助手 - 正在加载商品详情...';
        titleBar.style.padding = '10px';
        titleBar.style.backgroundColor = '#f0f0f0';
        titleBar.style.cursor = 'move';
        titleBar.style.borderBottom = '1px solid #ccc';
        titleBar.style.fontWeight = 'bold';
        titleBar.style.flexShrink = '0';

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '5px';
        closeBtn.style.right = '10px';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.fontSize = '24px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.color = '#666';
        closeBtn.style.flexShrink = '0';
        closeBtn.onclick = () => modal.remove();

        // 内容区域
        const contentDiv = document.createElement('div');
        contentDiv.style.width = '100%';
        contentDiv.style.flex = '1';
        contentDiv.style.overflow = 'auto';
        contentDiv.style.display = 'flex';
        contentDiv.style.flexDirection = 'column';

        // 审核列表
        const reviewTable = document.createElement('table');
        reviewTable.style.width = '100%';
        reviewTable.style.borderCollapse = 'collapse';
        reviewTable.style.flexShrink = '0';  // 防止表格被压缩
        // 表体
        const reviewTbody = document.createElement('tbody');
        let tbodyInnerHTML = `
            <style>
                /* 默认样式：指定大小 */
                .sf_img {
                  width: 30px; /* 初始宽度 */
                  height: 30px; /* 高度自适应 */
                  transition: all 0.3s ease; /* 平滑过渡动画 */
                }

                /* 点击后（复选框选中）：显示原始大小 */
                .resizable-img:checked {
                  width: auto; /* 恢复原始宽度 */
                  height: auto; /* 恢复原始高度 */
                  max-width: 90vw; /* 限制最大宽度，避免溢出 */
                  max-height: 90vh; /* 限制最大高度 */
                  position: relative;
                  z-index: 100;
                }
            </style>
        `
        let tdNumber = 1
        const rowNumber = 1;
        const colNumber = 10;
        for (let _ = 0; _ < rowNumber; _++) {
            tbodyInnerHTML += '<tr>'
            for (let _ = 0; _ < colNumber; _++) {
                tbodyInnerHTML += `<td id="sf_td_${tdNumber}"></td>`
                tdNumber ++
            }
            tbodyInnerHTML += '</tr>'
        }
        reviewTbody.innerHTML = tbodyInnerHTML
        reviewTable.appendChild(reviewTbody);

        // 加载提示
        const loadingText = document.createElement('div');
        loadingText.textContent = '正在通过后台请求亚马逊页面内容...';
        loadingText.style.textAlign = 'center';
        loadingText.style.padding = '20px';
        loadingText.style.color = '#666';
        contentDiv.appendChild(loadingText);

        // 组装模态框
        modal.appendChild(titleBar);
        modal.appendChild(closeBtn);
        modal.appendChild(reviewTable);
        modal.appendChild(contentDiv);
        document.body.appendChild(modal);

        // 拖动功能
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        titleBar.onmousedown = (e) => {
            isDragging = true;
            dragOffset.x = e.clientX - modal.offsetLeft;
            dragOffset.y = e.clientY - modal.offsetTop;
            modal.style.cursor = 'move';
        };

        document.onmousemove = (e) => {
            if (isDragging) {
                modal.style.left = (e.clientX - dragOffset.x) + 'px';
                modal.style.top = (e.clientY - dragOffset.y) + 'px';
            }
        };

        document.onmouseup = () => {
            isDragging = false;
            modal.style.cursor = 'default';
        };

        // ESC键关闭
        document.onkeydown = (e) => {
            if (e.key === 'Escape') modal.remove();
        };
        document.getElementById('sf_td_3').textContent = `订单金额: ${orderData.order_price_org}`;

        const reviewSuccessBtn = document.createElement('button');
        reviewSuccessBtn.textContent = '备注+审核';
        reviewSuccessBtn.style.backgroundColor = '#4CAF50';
        reviewSuccessBtn.data = orderData;
        reviewSuccessBtn.onclick = handleReviewSuccess;
        reviewSuccessBtn.style.color = 'white';
        reviewSuccessBtn.style.borderRadius = '5px';
        reviewSuccessBtn.style.cursor = 'pointer';
        reviewSuccessBtn.style.fontSize = '15px';
        reviewSuccessBtn.disabled = true;
        document.getElementById('sf_td_10').appendChild(reviewSuccessBtn);

        fetchAmazonContent(url, contentDiv, titleBar, orderData, reviewSuccessBtn);
    }

    function handleReviewSuccess(event) {
        let orderData = event.target.data

        // 提交备注
        const remarkEncodedParams = new URLSearchParams();
        remarkEncodedParams.set('packageId', orderData.package_id);
        remarkEncodedParams.set('commentType', 'sys_service');
        remarkEncodedParams.set('content', `${orderData.order_link}\n${orderData.order_asin}\n${orderData.page_price}`);
        remarkEncodedParams.set('color', '009926');
        remarkEncodedParams.set('history', '');
        fetch('https://www.dianxiaomi.com/api/dxmPackageComment/add.json', {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: remarkEncodedParams,
        }).then(response => response.json()).then(data => {
            if (data.code === 0) {
                const auditEncodedParams = new URLSearchParams();
                auditEncodedParams.set('packageId', orderData.package_id);
                fetch('/api/package/audit.json', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: auditEncodedParams.toString(),
                    redirect: "follow"
                }).then(() => {
                    alert('商品已审核通过');
                }).catch((error) => {
                    console.error('审核失败:', error);
                    alert('审核失败');
                })
            } else {
                console.error('备注提交失败:', data.msg);
                alert(`备注提交失败 ${data.msg}`);
            }
        }).catch(error => {
            console.error(error);
            alert('备注提交失败, 请检查网络连接');
        })
    }

    // 通过后台请求亚马逊页面内容
    function fetchAmazonContent(url, container, titleBar, orderData, reviewSuccessBtn) {
        // 使用GM_xmlhttpRequest请求亚马逊页面（油猴脚本专用跨域请求）
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    titleBar.textContent = '核价助手 - 商品详情';
                    container.innerHTML = '';
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, 'text/html');

                    const iframe = document.createElement('iframe');
                    iframe.id = 'amazon_detail_iframe';
                    iframe.style.width = '100%';
                    iframe.style.flex = '1';
                    iframe.style.border = 'none';
                    iframe.style.minHeight = '400px';
                    iframe.style.display = 'block';
                    iframe.onload = function() {
                        iframe.contentDocument.open();
                        iframe.contentDocument.write(doc.documentElement.innerHTML);
                        iframe.contentDocument.close();
                    }
                    container.appendChild(iframe);

                    // 添加价格和预计到货日期到页面
                    const sf_td_1_element = document.getElementById('sf_td_1');
                    const sf_td_2_element = document.getElementById('sf_td_2');
                    const sf_td_4_element = document.getElementById('sf_td_4');
                    const sf_td_5_element = document.getElementById('sf_td_5');
                    const sf_td_6_element = document.getElementById('sf_td_6');
                    const sf_td_7_element = document.getElementById('sf_td_7');

                    // 预计到货日期
                    const expectedDeliveryDateElement = doc.querySelector(`#desktop_qualifiedBuyBox[data-csa-c-asin="${orderData.order_asin}"] #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE > span`);
                    if (expectedDeliveryDateElement) {
                        const arriving_date = stringToDate(expectedDeliveryDateElement.getAttribute('data-csa-c-delivery-time').trim());
                        sf_td_5_element.textContent = `预计到货日期: ${arriving_date.toLocaleDateString()}`;
                        // 中国时区,如果预计到货日期在9个工作日内,显示绿色,否则显示红色
                        if (arriving_date <= getWorkdayLater(9)) {
                            sf_td_5_element.style.color = 'green';
                        } else {
                            sf_td_5_element.style.color = 'red';
                        }
                    } else {
                        sf_td_5_element.textContent = `预计到货日期:无法识别`;
                    }

                    let page_price_element = doc.querySelector(`#apex_offerDisplay_desktop[data-csa-c-asin="${orderData.order_asin}"] .a-offscreen`);
                    if (page_price_element) {
                        const page_price = parseFloat(page_price_element.textContent.trim().match(/[\d.]+/)[0]);
                        orderData.page_price = page_price;

                        const coupons_percentage_element = document.createElement('input');
                        const couponLabelTextElement = doc.querySelector('.couponLabelText');
                        if (couponLabelTextElement) {
                            coupons_percentage_element.value = parseInt(couponLabelTextElement.textContent.match(/([\d.]+)%/)[0]);
                        }
                        coupons_percentage_element.id = 'coupons_percentage_element';
                        coupons_percentage_element.type = 'number';
                        coupons_percentage_element.placeholder = '优惠券百分比';
                        coupons_percentage_element.addEventListener('keydown', (e) => {if (e.key === 'Enter') {update_price(page_price);}})
                        sf_td_6_element.appendChild(coupons_percentage_element);

                        const coupons_amount_element = document.createElement('input');
                        coupons_amount_element.id = 'coupons_amount_element';
                        coupons_amount_element.placeholder = '优惠券金额';
                        coupons_amount_element.addEventListener('keydown', (e) => { if (e.key === 'Enter') {update_price(page_price);}})
                        sf_td_7_element.appendChild(coupons_amount_element);
                        update_price(page_price);
                    } else {
                        sf_td_1_element.style.color = 'red';
                        sf_td_1_element.textContent = `无法识别采购价,点击跳转至商品详情页`;
                        sf_td_1_element.style.cursor = 'pointer';
                        sf_td_1_element.onclick = function() {
                            window.open(orderData.order_link, '_blank');
                        }
                    }

                    // 页面价格
                    function update_price(page_price) {
                        let procurement_costs = page_price;
                        const coupons_amount = document.getElementById('coupons_amount_element').value;
                        if (coupons_amount){
                            procurement_costs = procurement_costs - parseFloat(coupons_amount);
                        }
                        const coupons_percentage = document.getElementById('coupons_percentage_element').value;
                        if (coupons_percentage){
                            procurement_costs = procurement_costs - procurement_costs * (parseFloat(coupons_percentage) / 100);
                        }
                        procurement_costs = (procurement_costs * 1.064 + 1).toFixed(2)

                        const profit_amount = (orderData.order_price - procurement_costs).toFixed(2);
                        const profit_percentage = ((orderData.order_price - procurement_costs) / procurement_costs * 100).toFixed(2);

                        orderData.procurement_costs = procurement_costs;

                        sf_td_1_element.textContent = `页面价: ${page_price}`;
                        sf_td_2_element.textContent = `采购成本: ${procurement_costs}`;
                        sf_td_4_element.textContent = `利润:${profit_amount}\n利润率:${profit_percentage}%`;

                        if (orderData.order_price > procurement_costs) {
                            sf_td_4_element.style.color = 'green';
                            reviewSuccessBtn.disabled = false;
                        } else {
                            sf_td_4_element.style.color = 'red';
                            reviewSuccessBtn.disabled = true;
                        }
                    }
                } else {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            },
            onerror: function(error) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 50px; color: #d32f2f;">
                        <h3>加载失败</h3>
                        <p>无法获取亚马逊页面内容</p>
                        <p style="font-size: 12px; color: #666;">错误信息: ${error.error || '网络请求失败'}</p>
                        <button onclick="window.open('${url}', '_blank')" style="margin-top: 20px; padding: 10px 20px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            在新标签页打开
                        </button>
                    </div>
                `;
                titleBar.textContent = '核价助手 - 加载失败';
            },
            ontimeout: function() {
                container.innerHTML = `
                    <div style="text-align: center; padding: 50px; color: #d32f2f;">
                        <h3>请求超时</h3>
                        <p>亚马逊页面请求超时，请检查网络连接</p>
                        <button onclick="window.open('${url}', '_blank')" style="margin-top: 20px; padding: 10px 20px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            在新标签页打开
                        </button>
                    </div>
                `;
                titleBar.textContent = '核价助手 - 请求超时';
            }
        });

    }

    function stringToDate(dateString) {
        // const dateStr = "Friday, November 14";
        const year = new Date().getFullYear();
        const fullDateString = `${dateString}, ${year}`;
        return new Date(fullDateString);
    }

    function getWorkdayLater(n) {
        const date = new Date(); // 当前日期
        let daysAdded = 0;
        while (daysAdded < n) {
            date.setDate(date.getDate() + 1); // 加1天
            const day = date.getDay(); // 获取星期（0=周日，6=周六）
            // 如果不是周六（6）和周日（0），则计入工作日
            if (day !== 0 && day !== 6) {
                daysAdded++;
            }
        }
        return date;
    }

})();

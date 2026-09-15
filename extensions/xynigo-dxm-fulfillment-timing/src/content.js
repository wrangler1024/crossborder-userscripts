'use strict';

// 店小秘履约时效助手 · 内容脚本
// 页面:物流追踪-已签收。数据来自页面接口 pageList.json 直读(含精确下单/发货/
// 上网时间与完整轨迹 originaInfo),揽收节点按承运商白名单解析,全部计算在本地完成。
// UI:右下悬浮球 + 可拖动面板,定版以 原型/履约时效统计面板_原型_20260915.html 为准。

(function () {
    'use strict';

    if (!/\/web\/otherFeatures\/tracking/.test(location.pathname)) return;
    const Core = window.XftCore;
    if (!Core) return;

    // ===== 状态 =====
    const state = {
        orders: [],
        collected: false,
        collecting: false,
        paused: false,
        cancelRequested: false,
        capturedBody: null,
        unit: 'h',
        tab: 'store',
        thresholds: [120, 168, 240],
    };
    const PAGE_THROTTLE_MS = 400;
    const FETCH_TIMEOUT_MS = 30000;
    const STORE_KEYS = { thresholds: 'xft.thresholds', unit: 'xft.unit' };
    const VERSION = (chrome.runtime && chrome.runtime.getManifest)
        ? chrome.runtime.getManifest().version : 'dev';

    // ===== 主世界桥接 =====
    let fetchSeq = 0;
    const pendingFetches = new Map();

    document.addEventListener('xft:fetch-response', ev => {
        let d;
        try { d = JSON.parse(ev.detail); } catch (e) { return; }
        const resolver = pendingFetches.get(d.reqId);
        if (resolver) {
            pendingFetches.delete(d.reqId);
            resolver({ status: d.status, text: d.text || '' });
        }
    });

    document.addEventListener('xft:pagelist-captured', ev => {
        try {
            const d = JSON.parse(ev.detail);
            if (d.body && d.status === 200) state.capturedBody = d.body;
        } catch (e) { /* 忽略 */ }
    });

    function bridgeFetch(url, body) {
        return new Promise(resolve => {
            const reqId = 'req' + (++fetchSeq);
            pendingFetches.set(reqId, resolve);
            document.dispatchEvent(new CustomEvent('xft:fetch-request', {
                detail: JSON.stringify({ reqId, url, body: body || '' }),
            }));
            setTimeout(() => {
                if (pendingFetches.has(reqId)) {
                    pendingFetches.delete(reqId);
                    resolve({ status: 0, text: '请求超时' });
                }
            }, FETCH_TIMEOUT_MS);
        });
    }

    // ===== 偏好持久化 =====
    function loadPrefs() {
        try {
            chrome.storage.local.get([STORE_KEYS.thresholds, STORE_KEYS.unit], res => {
                if (!res) return;
                const th = res[STORE_KEYS.thresholds];
                if (Array.isArray(th) && th.length === 3 && th.every(Number.isFinite)) {
                    state.thresholds = th.slice();
                    syncThresholdInputs();
                    renderAll();
                }
                if (res[STORE_KEYS.unit] === 'd') {
                    state.unit = 'd';
                    syncUnitButtons();
                    renderAll();
                }
            });
        } catch (e) { /* storage 不可用时使用默认值 */ }
    }

    function savePrefs() {
        try {
            chrome.storage.local.set({
                [STORE_KEYS.thresholds]: state.thresholds,
                [STORE_KEYS.unit]: state.unit,
            });
        } catch (e) { /* 忽略 */ }
    }

    // ===== 工具 =====
    const $ = id => document.getElementById(id);
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function fmt1(v) {
        return Number.isFinite(v) ? v.toFixed(1) : '–';
    }

    function qTip(tip) {
        // 返回 HTML 字符串,供 innerHTML 模板拼接
        return `<span class="xft-q" tabindex="0" aria-label="查看定义">?<span class="xft-tip" role="tooltip">${tip}</span></span>`;
    }

    // ===== 采集 =====
    function extractTotal(j, baseBody) {
        try {
            const st = new URLSearchParams(baseBody).get('stateType') || 'delivered';
            const cm = j && j.data && j.data.countMap;
            if (cm && typeof cm === 'object') {
                if (Number.isFinite(cm[st])) return cm[st];
                if (Number.isFinite(cm.total)) return cm.total;
            }
            const page = j && j.data && j.data.page;
            if (page && Number.isFinite(page.totalCount)) return page.totalCount;
            if (page && Number.isFinite(page.total)) return page.total;
        } catch (e) { /* 忽略 */ }
        return null;
    }

    async function startCollection() {
        if (state.collecting) return;
        state.collecting = true;
        state.paused = false;
        state.cancelRequested = false;
        state.orders = [];
        state.collected = false;
        setCollectControls();

        // 实测服务端支持 pageSize=2000;默认 1000 单/页,14931 单约 15 个请求
        const baseParams = new URLSearchParams(state.capturedBody || Core.DEFAULT_PAGE_BODY);
        baseParams.set('pageSize', '1000');
        const baseBody = baseParams.toString();
        const seenIds = new Set();
        const shopMap = new Map();
        let pageNo = 1;
        let total = null;

        try {
            // 店铺账号映射:先尽力加载一次 index.json
            updateProgress('加载店铺账号映射…');
            const idx = await bridgeFetch('/api/tracking/index.json', '');
            if (idx.status === 200) {
                Core.extractShopMap(idx.text).forEach((name, id) => shopMap.set(id, name));
            }

            while (true) {
                if (state.cancelRequested) break;
                while (state.paused && !state.cancelRequested) {
                    updateProgress('已暂停,点击继续…');
                    await sleep(200);
                }
                if (state.cancelRequested) break;
                const body = Core.replacePageNo(baseBody, pageNo);
                updateProgress(`采集第 ${pageNo} 批${total ? ` / 约 ${total} 单` : ''},已取得 ${state.orders.length} 单…`);
                const resp = await bridgeFetch('/api/tracking/pageList.json', body);
                if (resp.status !== 200) {
                    updateProgress(`第 ${pageNo} 批请求失败(HTTP ${resp.status}),采集已停止`);
                    break;
                }
                let j;
                try { j = JSON.parse(resp.text); } catch (e) {
                    updateProgress(`第 ${pageNo} 批返回解析失败,采集已停止`);
                    break;
                }
                const page = j && j.data && j.data.page;
                const rows = page && Array.isArray(page.list) ? page.list : [];
                if (!rows.length) break;
                Core.extractShopMap(JSON.stringify(j.data && j.data.authList || []))
                    .forEach((name, id) => shopMap.set(id, name));
                let added = 0;
                rows.forEach(row => {
                    const order = Core.buildOrderFromRow(row, shopMap);
                    if (!order || !order.orderNo) return;
                    const key = order.rowId || (order.orderNo + '|' + order.packageNo);
                    if (seenIds.has(key)) return;
                    seenIds.add(key);
                    state.orders.push(order);
                    added++;
                });
                if (!total) total = extractTotal(j, baseBody);
                if (rows.length < 1000 || added === 0) break; // 服务端截断或不再新增
                pageNo++;
                await sleep(PAGE_THROTTLE_MS);
            }
        } catch (e) {
            updateProgress('采集出现异常:' + String((e && e.message) || e));
        }

        state.collecting = false;
        state.collected = state.orders.length > 0;
        if (state.cancelRequested) {
            updateProgress(`采集已取消,已取得 ${state.orders.length} 单`);
        } else if (state.collected) {
            updateProgress(`采集完成,共 ${state.orders.length} 单`);
        } else {
            updateProgress('未采集到已签收订单');
        }
        rebuildFilterOptions();
        setCollectControls();
        applyFilters();
    }

    function updateProgress(text) {
        state.progressText = text;
        const el = $('xft-progress');
        if (el) el.textContent = text;
    }

    function setCollectControls() {
        const start = $('xft-start');
        const pause = $('xft-pause');
        const stop = $('xft-stop');
        if (!start) return;
        start.disabled = state.collecting;
        pause.style.display = state.collecting ? '' : 'none';
        stop.style.display = state.collecting ? '' : 'none';
        pause.textContent = state.paused ? '继续' : '暂停';
    }

    // ===== 筛选 =====
    function readFilters() {
        return {
            store: $('xft-f-store').value,
            orderKeywords: $('xft-f-order').value,
            carrier: $('xft-f-carrier').value,
            country: $('xft-f-country').value,
            orderFrom: $('xft-f-order-from').value,
            orderTo: $('xft-f-order-to').value,
            shipFrom: $('xft-f-ship-from').value,
            shipTo: $('xft-f-ship-to').value,
        };
    }

    function rebuildFilterOptions() {
        const uniq = key => [...new Set(state.orders.map(o => o[key]))].sort();
        fillSelect('xft-f-carrier', uniq('carrier'));
        fillSelect('xft-f-country', uniq('country'));
    }

    function fillSelect(id, list) {
        const sel = $(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '';
        const all = document.createElement('option');
        all.value = '';
        all.textContent = '全部';
        sel.appendChild(all);
        list.forEach(v => {
            const op = document.createElement('option');
            op.value = v;
            op.textContent = v;
            sel.appendChild(op);
        });
        if (list.includes(current)) sel.value = current;
    }

    function applyFilters() {
        const result = Core.applyFilters(state.orders, readFilters());
        state.view = result.orders;
        const bits = [`筛选 <b>${state.view.length}</b> / ${state.orders.length} 单`];
        if (result.matchedStoreCount != null) {
            bits.push(`命中 ${result.matchedStoreCount} 个店铺账号`);
        }
        const countEl = $('xft-f-count');
        if (countEl) countEl.innerHTML = bits.join(' · ');
        renderAll();
    }

    // ===== 渲染 =====
    function renderAll() {
        // 阈值唯一来源是 state.thresholds(小时),渲染层不再读输入框,
        // 避免任何时点输入框状态导致的分段口径漂移
        const agg = Core.aggregate(state.view, { thresholds: state.thresholds, unit: state.unit });
        renderKpi(state.view, agg);
        renderSegBar(state.view, agg);
        renderSegTable(state.view, agg);
        renderDimTable(state.view);
        renderDetail(state.view);
        renderProgressLine(state.view);
        console.debug('[履约时效助手] thresholds(小时)=', state.thresholds.slice(),
            '分段=', agg.segCounts.slice(), '订单=', state.orders.length, '筛选后=', state.view.length);
    }

    function renderProgressLine(view) {
        const el = $('xft-collect-line');
        if (el) {
            el.innerHTML = state.collecting || state.orders.length
                ? `${escapeHtml(state.progressText || '')}`
                : '尚未采集,点击「开始统计」从当前面板筛选范围拉取已签收订单';
        }
        const scopeEl = $('xft-scope-count');
        if (scopeEl) {
            const withSign = state.orders.filter(o => Number.isFinite(o.fulfillH)).length;
            scopeEl.innerHTML = `当前范围 <b>${state.orders.length}</b> 单 · 时效样本 <b>${withSign}</b> 单`;
        }
        const viewEl = $('xft-view-count');
        if (viewEl) viewEl.innerHTML = `当前统计 <b>${view.length}</b> 单`;
    }

    function renderKpi(view, agg) {
        const unitName = state.unit === 'h' ? '小时' : '天';
        const f = agg.stages.fulfill;
        $('xft-kpi-n').textContent = String(agg.count);
        setKpiValue('xft-kpi-avg', f.avg, unitName);
        setKpiValue('xft-kpi-med', f.med, unitName);
        setKpiValue('xft-kpi-p90', f.p90, unitName);
        $('xft-kpi-ok-label').textContent = `≤${state.thresholds[1] / 24}天占比`;
        setKpiPct('xft-kpi-ok', agg.count ? agg.okCount / agg.count * 100 : null);
    }

    function setKpiValue(id, value, unitName) {
        const el = $(id);
        if (!el) return;
        if (!Number.isFinite(value)) { el.textContent = '–'; return; }
        el.innerHTML = value.toFixed(1) + '<small>' + unitName + '</small>';
    }

    function setKpiPct(id, pct) {
        const el = $(id);
        if (!el) return;
        if (!Number.isFinite(pct)) { el.textContent = '–'; return; }
        el.innerHTML = Math.round(pct) + '<small>%</small>';
    }

    function renderSegBar(view, agg) {
        const counts = agg.segCounts;
        const n = counts.reduce((a, b) => a + b, 0);
        const bar = $('xft-segbar');
        const legend = $('xft-seglegend');
        if (!bar || !legend) return;
        bar.innerHTML = '';
        legend.innerHTML = '';
        const names = Core.SEGMENT_NAMES;
        const [t1, t2, t3] = state.thresholds.map(h => h / 24);
        const rangeLabels = [`≤${t1}天`, `${t1 + 1}~${t2}天`, `${t2 + 1}~${t3}天`, `>${t3}天`];
        const classes = ['xft-b-fast', 'xft-b-normal', 'xft-b-slow', 'xft-b-over'];
        const dots = ['xft-c-fast', 'xft-c-normal', 'xft-c-slow', 'xft-c-over'];
        counts.forEach((c, i) => {
            if (!c || !n) return;
            const div = document.createElement('div');
            div.className = classes[i];
            div.style.width = (c / n * 100) + '%';
            div.textContent = Math.round(c / n * 100) + '%';
            bar.appendChild(div);
            const item = document.createElement('span');
            item.innerHTML = `<span class="xft-dot ${dots[i]}"></span>${names[i]} ${rangeLabels[i]}:${c} 单`;
            legend.appendChild(item);
        });
    }

    function renderSegTable(view, agg) {
        const t = $('xft-seg-table');
        if (!t) return;
        const unitName = state.unit === 'h' ? '小时' : '天';
        const stages = agg.stages;
        const defs = [
            { key: 'backup', name: '备货时效', color: '#4a7dbe',
              tip: '发货时间 − 下单时间。衡量从买家下单到仓库发出商品的备货处理速度。' },
            { key: 'handoff', name: '揽收时效', color: '#e6a23c',
              tip: '物流揽收时间 − 发货时间,是透视<b>无轨迹头程</b>(中国仓→目的国)的唯一窗口。<br><br>' +
                   '揽收时刻由插件从轨迹按承运商节点提取:FedEx=Picked up、J&T=Pick-up、iMile=Received。<br><br>' +
                   '<b>负值</b> = 物流商实际接手早于发货登记时间(发货为业务登记时点),保留数值并红色标出。' },
            { key: 'lastLeg', name: '尾程时效', color: '#8e6fd6',
              tip: '签收时间 − 揽收时间,目的国末端派送段。<br><br><b>备货 + 揽收 + 尾程 恒等于履约时效</b>。' },
            { key: 'transit', name: '运输时效', color: '#2e9e5b',
              tip: '签收时间 − 上网时间。上网=目的国轨迹起点(预上网);SHEIN 全托管头程无轨迹,本指标度量<b>目的国段</b>运输。与尾程时效的差异 = 揽收 − 上网。' },
            { key: 'fulfill', name: '履约时效', color: '#1f3a5f',
              tip: '签收时间 − 下单时间,全程履约时效。主口径精确到小时;自然日口径=签收日期 − 下单日期,可用上方开关切换。' },
        ];
        defs.forEach(def => {
            const st = stages[def.key];
            def.avg = st.avg;
            def.covered = st.covered;
            def.negCount = st.negCount;
        });
        const totalAvg = stages.fulfill.avg;
        const negCount = stages.handoff.negCount;
        const negNote = negCount
            ? ` <span class="xft-red">(含 ${negCount} 单负值)</span>`
            : '';

        // 构成堆叠条:平均 履约 = 备货 + 揽收 + 尾程(恒等分解,负值段按 0 宽参与)
        const bar = $('xft-compbar');
        const legend = $('xft-complegend');
        bar.innerHTML = '';
        legend.innerHTML = '';
        const parts = defs.slice(0, 3);
        const partsSum = parts.reduce((s, p) => s + Math.max(0, p.avg || 0), 0) || 1;
        parts.forEach(p => {
            const pct = Math.max(0, p.avg || 0) / partsSum * 100;
            const div = document.createElement('div');
            div.style.background = p.color;
            div.style.width = pct + '%';
            if (pct > 9) div.textContent = Math.round(pct) + '%';
            bar.appendChild(div);
            const item = document.createElement('span');
            item.innerHTML = `<span class="xft-dot" style="background:${p.color}"></span>` +
                `${p.name} <b>${fmt1(p.avg)} ${unitName}</b> · ${Math.round(pct)}%`;
            legend.appendChild(item);
        });
        const cap = document.createElement('span');
        cap.innerHTML = `平均履约时效 <b>${fmt1(totalAvg)} ${unitName}</b> = 备货 + 揽收 + 尾程`;
        legend.insertBefore(cap, legend.firstChild);

        // 明细表
        let html = `<tr><th>指标</th><th>构成图示</th><th class="xft-num">平均(${unitName})</th>` +
            `<th class="xft-num">中位(${unitName})</th><th class="xft-num">P90(${unitName})</th>` +
            `<th class="xft-num">最长</th></tr>`;
        defs.forEach(def => {
            const st = stages[def.key];
            const width = Math.max(0, st.avg || 0) / Math.max(1e-9, Math.max(0, stages.fulfill.avg || 0)) * 100;
            html += `<tr><td>${def.name}${qTip(def.tip)}${def.key === 'handoff' ? negNote : ''}</td>` +
                `<td><div class="xft-mini-bar"><i style="width:${width.toFixed(1)}%;background:${def.color}"></i></div></td>` +
                `<td class="xft-num">${fmt1(st.avg)}</td><td class="xft-num">${fmt1(st.med)}</td>` +
                `<td class="xft-num">${fmt1(st.p90)}</td><td class="xft-num">${fmt1(st.max)}</td></tr>`;
        });
        t.innerHTML = html;
    }

    function renderDimTable(view) {
        const t = $('xft-dim-table');
        if (!t) return;
        const unitName = state.unit === 'h' ? '小时' : '天';
        const keyFns = {
            store: o => o.store,
            carrier: o => o.carrier,
            country: o => o.country,
            day: o => (o.orderTime || '').slice(0, 10),
        };
        let groups = Core.groupOrders(view, keyFns[state.tab], state.thresholds, state.unit);
        if (state.tab === 'day') groups.sort((a, b) => (a.key < b.key ? 1 : -1));
        const maxN = groups.length ? Math.max(...groups.map(g => g.n)) : 1;
        const headLabel = state.tab === 'day' ? '下单日期' : '维度';
        let html = `<tr><th>${headLabel}</th><th class="xft-num">单数</th>` +
            `<th class="xft-num">平均履约时效(${unitName})</th><th class="xft-num">中位(${unitName})</th>` +
            `<th class="xft-num">P90(${unitName})</th><th class="xft-num">达标占比</th><th>单量占比</th></tr>`;
        if (!groups.length) {
            html += `<tr><td colspan="7" class="xft-empty">当前筛选范围没有订单</td></tr>`;
        }
        groups.forEach(g => {
            html += `<tr><td>${escapeHtml(g.key)}</td><td class="xft-num">${g.n}</td>` +
                `<td class="xft-num">${fmt1(g.avg)}</td><td class="xft-num">${fmt1(g.med)}</td>` +
                `<td class="xft-num">${fmt1(g.p90)}</td><td class="xft-num">${Math.round(g.okRate * 100)}%</td>` +
                `<td><div class="xft-mini-bar"><i style="width:${(g.n / maxN * 100).toFixed(1)}%"></i></div></td></tr>`;
        });
        t.innerHTML = html;
    }

    function renderDetail(view) {
        const t = $('xft-detail-table');
        if (!t) return;
        const unitName = state.unit === 'h' ? '小时' : '天';
        const rows = view.slice().sort((a, b) => (a.signTime < b.signTime ? 1 : -1)).slice(0, 10);
        let html = `<tr><th>订单号</th><th>店铺</th><th>物流</th><th>下单时间</th><th>签收时间</th>` +
            `<th class="xft-num">履约时效(${unitName})</th><th class="xft-num">自然日</th><th>分段</th></tr>`;
        if (!rows.length) html += `<tr><td colspan="8" class="xft-empty">当前筛选范围没有订单</td></tr>`;
        rows.forEach(o => {
            const seg = Core.segOf(o.fulfillH, state.thresholds);
            const classes = ['xft-b-fast', 'xft-b-normal', 'xft-b-slow', 'xft-b-over'];
            const names = Core.SEGMENT_NAMES;
            html += `<tr><td>${escapeHtml(o.orderNo)}</td><td>${escapeHtml(o.store)}</td>` +
                `<td>${escapeHtml(o.carrier)}</td><td>${escapeHtml(o.orderTime)}</td>` +
                `<td>${escapeHtml(o.signTime)}</td>` +
                `<td class="xft-num">${state.unit === 'h' ? fmt1(o.fulfillH) : (o.fulfillD == null ? '–' : o.fulfillD)}</td>` +
                `<td class="xft-num">${o.fulfillD == null ? '–' : o.fulfillD}</td>` +
                `<td>${seg >= 0 ? `<span class="xft-badge ${classes[seg]}">${names[seg]}</span>` : '–'}</td></tr>`;
        });
        t.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ===== CSV 导出 =====
    function downloadCsv(name, csvText) {
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    function exportDetail() {
        if (!state.view.length) return;
        const stamp = new Date();
        const name = `履约时效明细_${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}` +
            `${String(stamp.getDate()).padStart(2, '0')}.csv`;
        downloadCsv(name, Core.buildDetailCsv(state.view, state.thresholds));
    }

    function exportSummary() {
        if (!state.view.length) return;
        const keyFns = {
            store: o => o.store,
            carrier: o => o.carrier,
            country: o => o.country,
            day: o => (o.orderTime || '').slice(0, 10),
        };
        const groups = Core.groupOrders(state.view, keyFns[state.tab], state.thresholds, state.unit);
        const stamp = new Date();
        const name = `履约时效汇总_${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}` +
            `${String(stamp.getDate()).padStart(2, '0')}.csv`;
        downloadCsv(name, Core.buildSummaryCsv(groups, state.unit));
    }

    // ===== 面板 DOM =====
    function buildDom() {
        if ($('xft-ball')) return;

        const ball = document.createElement('div');
        ball.id = 'xft-ball';
        ball.textContent = '时';
        ball.title = '履约时效统计';

        const panel = document.createElement('div');
        panel.id = 'xft-panel';
        panel.innerHTML = `
            <div class="xft-header" id="xft-header">
                <span class="xft-logo">时</span>
                <h1>履约时效统计</h1>
                <span class="xft-ver">v${VERSION}</span>
                <span class="xft-close" id="xft-close" title="收起">×</span>
            </div>
            <div class="xft-body">
                <div class="xft-sourcebar">
                    <span class="xft-strong">数据来源:页面接口直读${qTip('插件复用店小秘自身接口(pageList.json)分页拉取当前筛选范围的已签收订单:精确下单/发货/上网时间 + 完整轨迹(揽收节点)一次拿全,<b>无需手动导出文件</b>,点「开始统计」即可。')}</span>
                    <span class="xft-sep">|</span>
                    <span id="xft-scope-count">已签收 <b>0</b> 单</span>
                    <span class="xft-sep">|</span>
                    <span>口径:<b>北京时间</b></span>
                    <span class="xft-sep">|</span>
                    <span>揽收时刻:<b>轨迹精确提取</b>${qTip('从接口内嵌的完整轨迹(originaInfo)按承运商节点(FedEx=Picked up / J&T=Pick-up / iMile=Received)提取精确揽收时刻,无需额外请求。')}</span>
                    <button class="xft-btn xft-primary" id="xft-start">开始统计</button>
                    <button class="xft-btn" id="xft-pause" style="display:none">暂停</button>
                    <button class="xft-btn" id="xft-stop" style="display:none">停止</button>
                </div>
                <div class="xft-progress" id="xft-progress">尚未采集</div>

                <div class="xft-filterbar">
                    <label class="xft-grow">店铺账号${qTip('文本模糊匹配,一个关键词可同时命中多个店铺账号,<br>如「蓝政」命中全部蓝政店铺。')} <input type="text" id="xft-f-store" placeholder="模糊:蓝政 / (一组)"></label>
                    <label class="xft-grow">订单${qTip('批量粘贴:空格 / 换行 / 逗号分隔,最多 1000 个;<br>自动匹配<b>订单号 / 包裹号 / 运单号</b>。')} <input type="text" id="xft-f-order" placeholder="订单号 / 包裹号 / 运单号"></label>
                    <label>物流方式 <select id="xft-f-carrier"><option value="">全部</option></select></label>
                    <label>目标国家 <select id="xft-f-country"><option value="">全部</option></select></label>
                    <label class="xft-range">下单日期 <span class="xft-dates"><input type="date" id="xft-f-order-from"> ~ <input type="date" id="xft-f-order-to"></span></label>
                    <label class="xft-range">发货日期 <span class="xft-dates"><input type="date" id="xft-f-ship-from"> ~ <input type="date" id="xft-f-ship-to"></span></label>
                    <div class="xft-filterfoot"><span class="xft-fcount" id="xft-f-count"></span>
                    <button class="xft-btn" id="xft-f-reset">重置</button></div>
                </div>

                <div class="xft-unitrow">
                    <span>展示口径:</span>
                    <span class="xft-segctl">
                        <button id="xft-unit-h" class="xft-on">小时</button>
                        <button id="xft-unit-d">自然日</button>
                    </span>
                    <span class="xft-gap"></span>
                    <span>分段阈值(天):</span>
                    ≤ <input type="number" id="xft-t1" min="1" value="5">
                    / ≤ <input type="number" id="xft-t2" min="1" value="7">
                    / ≤ <input type="number" id="xft-t3" min="1" value="10">,
                    <span>超过则计为超时</span>
                </div>

                <div class="xft-kpis">
                    <div class="xft-kpi"><div class="xft-klabel">统计单数${qTip('当前筛选范围内的已签收订单数量。')}</div><div class="xft-kvalue" id="xft-kpi-n">–</div></div>
                    <div class="xft-kpi"><div class="xft-klabel">平均履约时效${qTip('「签收时间 − 下单时间」的算术平均值,即全程履约时效的平均水平。')}</div><div class="xft-kvalue" id="xft-kpi-avg">–</div></div>
                    <div class="xft-kpi"><div class="xft-klabel">中位数${qTip('履约时效排序后取中间值:一半订单快于此值、一半慢于此值;不受个别极端慢单影响。')}</div><div class="xft-kvalue" id="xft-kpi-med">–</div></div>
                    <div class="xft-kpi"><div class="xft-klabel">P90${qTip('90 分位数:90% 的订单履约时效不超过此值,用于观察最慢 10% 长尾订单。')}</div><div class="xft-kvalue" id="xft-kpi-p90">–</div></div>
                    <div class="xft-kpi"><div class="xft-klabel"><span id="xft-kpi-ok-label">≤7天占比</span>${qTip('履约时效不超过达标线(分段第二个阈值,默认 7 天)的订单占比,随阈值输入联动。')}</div><div class="xft-kvalue" id="xft-kpi-ok">–</div></div>
                </div>

                <div class="xft-section-title">分段占比(当前筛选结果)</div>
                <div class="xft-segbar" id="xft-segbar"></div>
                <div class="xft-seglegend" id="xft-seglegend"></div>

                <div class="xft-section-title">时效拆解(单位随上方口径切换)</div>
                <div class="xft-compbar" id="xft-compbar"></div>
                <div class="xft-complegend" id="xft-complegend"></div>
                <table class="xft-table" id="xft-seg-table"></table>

                <div class="xft-tabs">
                    <button data-tab="store" class="xft-on">分店铺</button>
                    <button data-tab="carrier">分物流方式</button>
                    <button data-tab="country">分国家</button>
                    <button data-tab="day">按下单日</button>
                </div>
                <table class="xft-table" id="xft-dim-table"></table>

                <div class="xft-section-title">订单明细(预览前 10 单,按签收时间倒序;完整明细在导出 CSV 中)</div>
                <table class="xft-table" id="xft-detail-table"></table>
            </div>
            <div class="xft-footer">
                <span id="xft-view-count"></span>
                <span>·</span>
                <span>导出 CSV 不含收件人等隐私字段</span>
                <span class="xft-spacer"></span>
                <div class="xft-footer-actions"><button class="xft-btn" id="xft-export-detail">导出明细 CSV</button>
                <button class="xft-btn" id="xft-export-summary">导出当前汇总 CSV</button></div>
            </div>`;

        document.body.appendChild(ball);
        document.body.appendChild(panel);

        ball.addEventListener('click', () => {
            panel.style.display = 'flex';
            ball.style.display = 'none';
        });
        $('xft-close').addEventListener('click', () => {
            panel.style.display = 'none';
            ball.style.display = '';
        });

        $('xft-start').addEventListener('click', () => { startCollection(); });
        $('xft-pause').addEventListener('click', () => {
            state.paused = !state.paused;
            setCollectControls();
        });
        $('xft-stop').addEventListener('click', () => {
            state.cancelRequested = true;
            state.paused = false;
        });
        $('xft-export-detail').addEventListener('click', exportDetail);
        $('xft-export-summary').addEventListener('click', exportSummary);

        $('xft-unit-h').addEventListener('click', () => setUnit('h'));
        $('xft-unit-d').addEventListener('click', () => setUnit('d'));
        ['xft-t1', 'xft-t2', 'xft-t3'].forEach(id => $(id).addEventListener('input', onThresholdInput));

        ['xft-f-store', 'xft-f-order'].forEach(id => $(id).addEventListener('input', applyFilters));
        ['xft-f-carrier', 'xft-f-country', 'xft-f-order-from', 'xft-f-order-to',
            'xft-f-ship-from', 'xft-f-ship-to'].forEach(id => $(id).addEventListener('change', applyFilters));
        $('xft-f-reset').addEventListener('click', () => {
            ['xft-f-store', 'xft-f-order', 'xft-f-carrier', 'xft-f-country',
                'xft-f-order-from', 'xft-f-order-to', 'xft-f-ship-from', 'xft-f-ship-to']
                .forEach(id => { $(id).value = ''; });
            applyFilters();
        });

        panel.querySelectorAll('.xft-tabs button').forEach(btn => {
            btn.addEventListener('click', () => {
                state.tab = btn.dataset.tab;
                panel.querySelectorAll('.xft-tabs button').forEach(b => b.classList.toggle('xft-on', b === btn));
                renderDimTable(state.view);
            });
        });

        bindTooltips(panel);
        makeDraggable(panel, $('xft-header'));
        loadPrefs();
    }

    function setUnit(unit) {
        state.unit = unit;
        syncUnitButtons();
        savePrefs();
        renderAll();
    }

    function syncUnitButtons() {
        const h = $('xft-unit-h');
        const d = $('xft-unit-d');
        if (!h || !d) return;
        h.classList.toggle('xft-on', state.unit === 'h');
        d.classList.toggle('xft-on', state.unit === 'd');
    }

    function onThresholdInput() {
        const t1 = Math.max(1, Number($('xft-t1').value) || 5);
        const t2 = Math.max(t1 + 1, Number($('xft-t2').value) || 7);
        const t3 = Math.max(t2 + 1, Number($('xft-t3').value) || 10);
        state.thresholds = [t1 * 24, t2 * 24, t3 * 24];
        savePrefs();
        renderAll();
    }

    function syncThresholdInputs() {
        $('xft-t1').value = String(Math.round(state.thresholds[0] / 24));
        $('xft-t2').value = String(Math.round(state.thresholds[1] / 24));
        $('xft-t3').value = String(Math.round(state.thresholds[2] / 24));
    }

    // 浮层限制在面板内,避免右侧 KPI 和底部定义被滚动容器裁切。
    function bindTooltips(panel) {
        function positionTip(ev) {
            const question = ev.target.closest('.xft-q');
            if (!question) return;
            const tip = question.querySelector('.xft-tip');
            const bounds = panel.getBoundingClientRect();
            const anchor = question.getBoundingClientRect();
            const width = Math.min(260, bounds.width - 48);
            tip.style.width = width + 'px';
            tip.style.left = Math.max(bounds.left + 24,
                Math.min(anchor.left, bounds.right - width - 24)) + 'px';
            const height = tip.getBoundingClientRect().height;
            const below = anchor.bottom + 6;
            tip.style.top = Math.max(bounds.top + 24,
                Math.min(below, bounds.bottom - height - 24)) + 'px';
        }
        panel.addEventListener('mouseover', positionTip);
        panel.addEventListener('focusin', positionTip);
    }

    function makeDraggable(panel, handle) {
        let startY = 0;
        let startTop = 0;
        let dragging = false;
        handle.addEventListener('mousedown', ev => {
            if (ev.target.closest('.xft-close')) return;
            dragging = true;
            startY = ev.clientY;
            startTop = panel.getBoundingClientRect().top;
            ev.preventDefault();
        });
        document.addEventListener('mousemove', ev => {
            if (!dragging) return;
            const maxTop = window.innerHeight - panel.getBoundingClientRect().height - 24;
            panel.style.top = Math.min(Math.max(startTop + ev.clientY - startY, 8), maxTop) + 'px';
            panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => { dragging = false; });
    }

    // ===== 启动 =====
    function init() {
        buildDom();
        applyFilters();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

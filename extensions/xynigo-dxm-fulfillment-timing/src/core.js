'use strict';

// 纯逻辑模块:解析店小秘物流追踪接口数据、计算履约时效、筛选、统计与 CSV。
// 内容脚本与 Node 单测共用,不得依赖 DOM。时间口径:店小秘展示均为北京时间(UTC+8),
// 字符串与毫秒时间戳按固定偏移互转,差值计算不受机器时区影响。

const CARRIER_PICKUP_RULES = [
    { carrier: /fedex/i, match: ev => /picked up/i.test(ev.Details || '') },
    { carrier: /j&t/i, match: ev => /pick-up|picked up/i.test(ev.Details || '') },
    { carrier: /imile/i, match: ev => /received,\s*【|has been received/i.test(ev.Details || '') },
];
// 未识别承运商的兜底规则(J&T 签收文本含 "Received!",故兜底不匹配裸 "received")
const GENERIC_PICKUP_MATCH = ev => /picked up|pick-up,|has been received/i.test(ev.Details || '');
const SIGN_TIME_TAIL = /,(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/;
const DEFAULT_PAGE_BODY = 'pageSize=50&stateType=delivered&platform=&shopId=-1&country=&authId=' +
    '&searchType=orderId&searchValue=&isComm=&orderField=shipped_time&isDesc=1&isDel=0' +
    '&history=&isStop=0&noUpdateDays=0&shipStartTime=&shipEndTime=';
const DEFAULT_THRESHOLDS = Object.freeze([120, 168, 216]);
const ORDER_KEYWORD_LIMIT = 1000;
const SEGMENT_NAMES = ['快速', '正常', '偏慢', '超时'];

const BEIJING_OFFSET_MS = 8 * 3600000; // 店小秘展示口径为北京时间(UTC+8,无夏令时)

function validateThresholdDays(values) {
    if (!Array.isArray(values) || values.length !== 3 || values.some(v =>
        String(v).trim() === '' || !Number.isSafeInteger(Number(v)) || Number(v) <= 0 ||
        !Number.isSafeInteger(Number(v) * 24))) {
        return '请输入三个正整数天数';
    }
    const [a, b, c] = values.map(Number);
    return a < b && b < c ? '' : '三段阈值须严格递增：第一段 < 第二段 < 第三段';
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

// "YYYY-MM-DD HH:MM" 按北京时间墙上值 → 纪元毫秒,失败返回 null。
// 与 formatWallTime 互逆;固定偏移纯算术,结果不受机器时区影响。
function parseWallTime(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(text || '').trim());
    if (!m) return null;
    const utcWall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    const t = utcWall - BEIJING_OFFSET_MS;
    return Number.isFinite(t) ? t : null;
}

function formatWallTime(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms + BEIJING_OFFSET_MS);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
        ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

function wallDate(ms) {
    return formatWallTime(ms).slice(0, 10);
}

// 签收时刻在最新事件文本尾部,固定 ",YYYY-MM-DD HH:MM" 格式
function extractSignTime(lastEvent) {
    const m = SIGN_TIME_TAIL.exec(String(lastEvent || ''));
    return m ? m[1] : null;
}

function parseOriginaInfo(raw) {
    let v = raw;
    if (typeof raw === 'string') {
        try { v = JSON.parse(raw); } catch (e) { return []; }
    }
    if (!Array.isArray(v)) return [];
    return v.filter(e => e && typeof e === 'object');
}

// 轨迹数组最新在前;揽收取最早(从尾部向前)的命中节点
function extractPickupTime(events, carrierName) {
    if (!Array.isArray(events) || !events.length) return null;
    const rule = CARRIER_PICKUP_RULES.find(r => r.carrier.test(String(carrierName || '')));
    const match = rule ? rule.match : GENERIC_PICKUP_MATCH;
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev && match(ev)) return String(ev.Date || '') || null;
    }
    return null;
}

function hoursBetween(aMs, bMs) {
    if (aMs == null || bMs == null || !Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;
    return (bMs - aMs) / 3600000;
}

function daysBetween(aMs, bMs) {
    if (aMs == null || bMs == null || !Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;
    const a = parseWallTime(wallDate(aMs) + ' 00:00');
    const b = parseWallTime(wallDate(bMs) + ' 00:00');
    if (a == null || b == null) return null;
    return Math.max(0, Math.round((b - a) / 86400000));
}

// 接口优先；缺失时按时间排序取最早有效轨迹，不依赖数组顺序。
function resolveOnlineTime(raw, events) {
    const ms = typeof raw === 'string' && /^\d{13}$/.test(raw.trim()) ? Number(raw) : raw;
    if (Number.isFinite(ms) && ms > 0 && Number.isFinite(new Date(ms).getTime())) {
        return { ms, source: '接口上网时间' };
    }
    let earliest = null;
    for (const event of events || []) {
        const text = String(event.Date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::[0-5]\d)?$/.test(text)) continue;
        const time = parseWallTime(text);
        // round-trip 拒绝2月30日、25点等被 Date 自动进位的无效日期。
        if (time == null || formatWallTime(time) !== text.slice(0, 16).replace('T', ' ')) continue;
        if (earliest == null || time < earliest) earliest = time;
    }
    return { ms: earliest, source: earliest == null ? '缺失' : '轨迹起始时间补取' };
}

// 发货异常(重大业务事故):上网时间早于订单下单时间。
// 揽收早于发货登记属正常现象,不计为异常(业务口径 2026-09-15 Jeff 调整)。
function isShippingAnomaly(order) {
    return Number.isFinite(order.onlineMs) && Number.isFinite(order.orderMs)
        && order.onlineMs < order.orderMs;
}

function shippingAnomalyOrders(orders) {
    return (orders || []).filter(isShippingAnomaly);
}

// 接口单条记录 → 归一化订单对象;时间为北京时间墙上值
function buildOrderFromRow(row, shopNameMap) {
    if (!row || typeof row !== 'object') return null;
    const orderMs = Number.isFinite(row.orderCreateTime) ? row.orderCreateTime : null;
    const shipMs = Number.isFinite(row.shippedTime) ? row.shippedTime : null;
    const events = parseOriginaInfo(row.originaInfo);
    const online = resolveOnlineTime(row.onlineTime, events);
    const onlineMs = online.ms;
    const signText = extractSignTime(row.lastEvent) ||
        (events.length ? String(events[0].Date || '') || null : null);
    const pickupText = extractPickupTime(events, row.newCarrierName);
    const signMs = parseWallTime(signText);
    const pickupMs = parseWallTime(pickupText);
    const shopId = row.shopId == null ? '' : String(row.shopId);
    const order = {
        packageNo: row.packageNumber || '',
        orderNo: row.orderId || '',
        shopId,
        store: (shopNameMap && shopNameMap.get(shopId)) || shopId,
        platform: String(row.platform || '').toUpperCase(),
        country: row.buyerCountry || '',
        carrier: row.newCarrierName || row.newCarrierCode || '',
        trackNo: row.trackingNumber || '',
        status: row.trackingState || '',
        orderMs, shipMs, onlineMs, signMs, pickupMs,
        orderTime: formatWallTime(orderMs),
        shipTime: formatWallTime(shipMs),
        onlineTime: formatWallTime(onlineMs),
        onlineTimeSource: online.source,
        pickupTime: pickupText || '',
        signTime: signText || '',
        backupH: hoursBetween(orderMs, shipMs),
        handoffH: hoursBetween(shipMs, pickupMs),
        lastLegH: hoursBetween(pickupMs, signMs),
        transitH: hoursBetween(onlineMs, signMs),
        fulfillH: hoursBetween(orderMs, signMs),
        backupD: daysBetween(orderMs, shipMs),
        handoffD: daysBetween(shipMs, pickupMs),
        lastLegD: daysBetween(pickupMs, signMs),
        transitD: daysBetween(onlineMs, signMs),
        fulfillD: daysBetween(orderMs, signMs),
        dxmTransitDays: row.itemTimeLength == null ? null : row.itemTimeLength,
        dxmWaybillDays: row.startItemTimeLength == null ? null : row.startItemTimeLength,
        amazonEta: row.latestDeliveryDateStr || '',
        comment: row.comment || '',
        lastEvent: row.lastEvent || '',
        rowId: row.idStr || row.id || '',
    };
    return order;
}

// 接口返回的 itemTimeLength/startItemTimeLength 与导出表格"运输天数/运单天数"的
// 对应关系待真机复核,取值时保证非空回退,避免展示 NaN
function dxmDays(value) {
    return value == null ? '' : String(value);
}

function segOf(fulfillH, thresholds) {
    if (!Number.isFinite(fulfillH)) return -1;
    const [t1, t2, t3] = thresholds;
    if (fulfillH <= t1) return 0;
    if (fulfillH <= t2) return 1;
    if (fulfillH <= t3) return 2;
    return 3;
}

function statsOf(values) {
    const vs = values.slice().sort((a, b) => a - b);
    const n = vs.length;
    if (!n) return { avg: null, med: null, p90: null, max: null };
    const sum = vs.reduce((s, v) => s + v, 0);
    const med = n % 2 ? vs[(n - 1) / 2] : (vs[n / 2 - 1] + vs[n / 2]) / 2;
    let p90;
    if (n === 1) p90 = vs[0];
    else {
        const idx = (n - 1) * 0.9;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        p90 = sortedInterp(vs, lo, hi, idx);
    }
    return { avg: sum / n, med, p90, max: vs[n - 1] };
}

function sortedInterp(vs, lo, hi, idx) {
    return vs[lo] + (vs[hi] - vs[lo]) * (idx - lo);
}

// 六维筛选:店铺账号模糊、订单批量(订单号/包裹号/运单号,≤1000)、物流、国家、双日期区间
function applyFilters(orders, filters) {
    const f = filters || {};
    const store = String(f.store || '').trim().toLowerCase();
    const rawTokens = String(f.orderKeywords || '')
        .split(/[\n,，;；\s]+/).map(s => s.trim()).filter(Boolean);
    const tokens = rawTokens.slice(0, ORDER_KEYWORD_LIMIT).map(t => t.toLowerCase());
    const carrier = String(f.carrier || '');
    const country = String(f.country || '');
    const orderFrom = String(f.orderFrom || '');
    const orderTo = String(f.orderTo || '');
    const shipFrom = String(f.shipFrom || '');
    const shipTo = String(f.shipTo || '');
    const result = orders.filter(o =>
        (!store || o.store.toLowerCase().includes(store)) &&
        (!tokens.length || tokens.some(t =>
            o.orderNo.toLowerCase().includes(t) ||
            o.packageNo.toLowerCase().includes(t) ||
            o.trackNo.toLowerCase().includes(t))) &&
        (!carrier || o.carrier === carrier) &&
        (!country || o.country === country) &&
        (!orderFrom || (o.orderTime && o.orderTime.slice(0, 10) >= orderFrom)) &&
        (!orderTo || (o.orderTime && o.orderTime.slice(0, 10) <= orderTo)) &&
        (!shipFrom || (o.shipTime && o.shipTime.slice(0, 10) >= shipFrom)) &&
        (!shipTo || (o.shipTime && o.shipTime.slice(0, 10) <= shipTo))
    );
    return {
        orders: result,
        orderTokenCount: tokens.length,
        orderTokenTruncated: rawTokens.length > ORDER_KEYWORD_LIMIT,
        matchedStoreCount: store ? new Set(result.map(o => o.store)).size : null,
    };
}

// 时效拆解统计。covered = 该指标有值的订单数;揽收/尾程额外给负值单数(尾程理论无负值,兜底)。
function stageStats(orders, thresholds, unit) {
    const pick = (o, key) => (unit === 'd' ? o[key + 'D'] : o[key + 'H']);
    const mk = key => {
        const vals = orders.map(o => pick(o, key)).filter(v => Number.isFinite(v));
        const s = statsOf(vals);
        return {
            covered: vals.length,
            avg: s.avg, med: s.med, p90: s.p90, max: s.max,
            negCount: vals.filter(v => v < 0).length,
        };
    };
    return {
        backup: mk('backup'),
        handoff: mk('handoff'),
        lastLeg: mk('lastLeg'),
        transit: mk('transit'),
        fulfill: mk('fulfill'),
    };
}

function aggregate(orders, opts) {
    const opts2 = opts || {};
    const thresholds = opts2.thresholds && opts2.thresholds.length === 3
        ? opts2.thresholds
        : DEFAULT_THRESHOLDS;
    const unit = opts2.unit === 'd' ? 'd' : 'h';
    const stages = stageStats(orders, thresholds, unit);
    const fulfills = orders.map(o => o.fulfillH).filter(Number.isFinite);
    const segCounts = [0, 0, 0, 0];
    orders.forEach(o => {
        const s = segOf(o.fulfillH, thresholds);
        if (s >= 0) segCounts[s]++;
    });
    const okLimit = thresholds[1];
    const okCount = orders.filter(o => Number.isFinite(o.fulfillH) && o.fulfillH <= okLimit).length;
    return {
        count: orders.length,
        unit,
        thresholds,
        segCounts,
        segmentNames: SEGMENT_NAMES,
        okCount,
        stages,
    };
}

function groupOrders(orders, keyFn, thresholds, unit) {
    const map = new Map();
    orders.forEach(o => {
        const k = keyFn(o);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(o);
    });
    const rows = [...map.entries()].map(([key, list]) => {
        const fulfills = list.map(o => o.fulfillH).filter(Number.isFinite);
        const fulfillsD = list.map(o => o.fulfillD).filter(Number.isFinite);
        const s = unit === 'd' ? statsOf(fulfillsD) : statsOf(fulfills);
        const ok = list.filter(o => Number.isFinite(o.fulfillH) && o.fulfillH <= thresholds[1]).length;
        return {
            key,
            n: list.length,
            avg: s.avg, med: s.med, p90: s.p90,
            okRate: list.length ? ok / list.length : 0,
        };
    });
    rows.sort((a, b) => b.n - a.n);
    return rows;
}

function csvEscape(value) {
    const s = value == null ? '' : String(value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
    return '\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}

const DETAIL_CSV_HEADER = [
    '包裹号', '订单号', '店铺', '平台', '国家', '物流方式', '运单号', '运输状态',
    '下单时间', '发货时间', '上网时间', '揽收时间', '签收时间',
    '履约时效(小时)', '履约时效(自然日)', '时效分段',
    '备货时效(小时)', '揽收时效(小时)', '运输时效(小时,签收减上网)',
    '店小秘运输天数', '店小秘运单天数', 'Amazon预计送达时间', '备注',
    '上网时间来源', '发货判定',
];

function buildDetailCsv(orders, thresholds) {
    const num = v => (Number.isFinite(v) ? v.toFixed(1) : '');
    const rows = [DETAIL_CSV_HEADER];
    orders.forEach(o => {
        const seg = segOf(o.fulfillH, thresholds);
        rows.push([
            o.packageNo, o.orderNo, o.store, o.platform, o.country, o.carrier, o.trackNo, o.status,
            o.orderTime, o.shipTime, o.onlineTime, o.pickupTime, o.signTime,
            num(o.fulfillH), o.fulfillD == null ? '' : String(o.fulfillD),
            seg >= 0 ? SEGMENT_NAMES[seg] : '',
            num(o.backupH), num(o.handoffH), num(o.transitH),
            dxmDays(o.dxmTransitDays), dxmDays(o.dxmWaybillDays), o.amazonEta, o.comment,
            o.onlineTimeSource || '缺失', isShippingAnomaly(o) ? '发货异常(上网早于下单)' : ((Number.isFinite(o.onlineMs) && Number.isFinite(o.orderMs)) ? '正常' : '无法判定'),
        ]);
    });
    return toCsv(rows);
}

const SUMMARY_CSV_HEADER = ['维度', '单数', '平均值', '中位数', 'P90', '达标占比'];

function buildSummaryCsv(groups, unit) {
    const unitName = unit === 'd' ? '天' : '小时';
    const rows = [[SUMMARY_CSV_HEADER[0], SUMMARY_CSV_HEADER[1],
        SUMMARY_CSV_HEADER[2] + '(' + unitName + ')', SUMMARY_CSV_HEADER[3] + '(' + unitName + ')',
        SUMMARY_CSV_HEADER[4] + '(' + unitName + ')', SUMMARY_CSV_HEADER[5]]];
    const num = v => (Number.isFinite(v) ? v.toFixed(1) : '');
    groups.forEach(g => rows.push([
        g.key, String(g.n), num(g.avg), num(g.med), num(g.p90), Math.round(g.okRate * 100) + '%',
    ]));
    return toCsv(rows);
}

// 统计始终限定已签收,其他页面筛选保持不变。
function buildDeliveredPageBody(body) {
    const params = new URLSearchParams(body || DEFAULT_PAGE_BODY);
    params.set('stateType', 'delivered');
    params.set('pageSize', '1000');
    params.set('pageNo', '1');
    return params.toString();
}

// 接口翻页参数:从捕获到的请求体替换页码,保留页面当前筛选
function replacePageNo(body, pageNo) {
    const params = new URLSearchParams(String(body || ''));
    params.set('pageNo', String(pageNo));
    return params.toString();
}

function countParam(body, stateType) {
    const params = new URLSearchParams(String(body || ''));
    return params.get('pageSize') || '50';
}

// 深度扫描 index.json / authList,构建 shopId → 店铺名 映射(尽力而为)。
// 已确认来源:index.json → data.accountMap.{platform}[] 每项 {id, name}。
function extractShopMap(text) {
    const map = new Map();
    let root;
    try { root = JSON.parse(text); } catch (e) { return map; }
    const add = (id, name) => {
        if (id == null || name == null) return;
        const key = String(id);
        const value = String(name);
        if (key && value && !map.has(key)) map.set(key, value);
    };
    const visit = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 8) return;
        if (Array.isArray(node)) {
            node.forEach(n => visit(n, depth + 1));
            return;
        }
        if (node.accountMap && typeof node.accountMap === 'object') {
            Object.values(node.accountMap).forEach(list => {
                if (Array.isArray(list)) {
                    list.forEach(entry => {
                        if (entry && typeof entry === 'object') add(entry.id, entry.name);
                    });
                }
            });
        }
        if (node.shopId != null) {
            add(node.shopId, node.shopName != null ? node.shopName : node.name);
        }
        Object.keys(node).forEach(k => {
            if (k !== 'originaInfo') visit(node[k], depth + 1);
        });
    };
    visit(root, 0);
    return map;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { /* Node 单测入口 */
        SEGMENT_NAMES,
        DEFAULT_THRESHOLDS,
        validateThresholdDays,
        ORDER_KEYWORD_LIMIT,
        DEFAULT_PAGE_BODY,
        DETAIL_CSV_HEADER,
        parseWallTime,
        formatWallTime,
        wallDate,
        extractSignTime,
        parseOriginaInfo,
        extractPickupTime,
        buildOrderFromRow,
        resolveOnlineTime,
        isShippingAnomaly,
        shippingAnomalyOrders,
        dxmDays,
        segOf,
        statsOf,
        applyFilters,
        stageStats,
        aggregate,
        groupOrders,
        buildDetailCsv,
        buildSummaryCsv,
        buildDeliveredPageBody,
        replacePageNo,
        extractShopMap,
    };
}
if (typeof window !== 'undefined') {
    window.XftCore = { /* 内容脚本入口 */
        SEGMENT_NAMES,
        DEFAULT_THRESHOLDS,
        validateThresholdDays,
        ORDER_KEYWORD_LIMIT,
        DEFAULT_PAGE_BODY,
        DETAIL_CSV_HEADER,
        parseWallTime,
        formatWallTime,
        wallDate,
        extractSignTime,
        parseOriginaInfo,
        extractPickupTime,
        buildOrderFromRow,
        resolveOnlineTime,
        isShippingAnomaly,
        shippingAnomalyOrders,
        dxmDays,
        segOf,
        statsOf,
        applyFilters,
        stageStats,
        aggregate,
        groupOrders,
        buildDetailCsv,
        buildSummaryCsv,
        buildDeliveredPageBody,
        replacePageNo,
        extractShopMap,
    };
}

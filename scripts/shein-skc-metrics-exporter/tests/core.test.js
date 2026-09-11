'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const exporter = require('../shein_skc_metrics_exporter.user.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'shein_skc_metrics_exporter.user.js'), 'utf8');
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function buildTableDoc({ withSideTable = false } = {}) {
    const rows = (start, count) => Array.from({ length: count }, (_, index) => {
        const n = start + index;
        return `<tr><td>SKC${String(n).padStart(4, '0')}</td><td>商品${n}</td><td>${100 * n}</td><td>${50 * n}</td><td>${10 * n}</td></tr>`;
    }).join('');
    const sideTable = withSideTable
        ? '<table id="side"><thead><tr><th>名称</th><th>值</th></tr></thead><tbody><tr><td>a</td><td>1</td></tr></tbody></table>'
        : '';
    return new JSDOM(`<!doctype html><html><body>
        <div class="page">共 6 条</div>
        <main>
            <table id="main">
                <thead>
                    <tr><th colspan="2">商品指标</th><th colspan="3">流量指标</th></tr>
                    <tr><th>SKC</th><th>商品名称</th><th>曝光量</th><th>浏览量</th><th>访客数</th></tr>
                </thead>
                <tbody>
                    ${rows(1, 3)}
                    <tr><td colspan="5">已勾选商品合计</td></tr>
                    <tr><td>暂无相关数据</td></tr>
                    ${rows(4, 3)}
                </tbody>
            </table>
            <nav class="ant-pagination" id="pager">
                <li class="ant-pagination-prev"><button>上一页</button></li>
                <li class="ant-pagination-next" id="next-page"><button>下一页</button></li>
            </nav>
        </main>
        ${sideTable}
    </body></html>`, { url: 'https://sellerhub.shein.com/#/ssa/analysis', runScripts: 'outside-only' });
}

test('normalizes cell text and parses page totals', () => {
    assert.equal(exporter.normalizeCellText('  曝光\n量\t '), '曝光 量');
    assert.equal(exporter.parseTotalCount('共 1,234 条'), 1234);
    assert.equal(exporter.parseTotalCount('共1,234条'), 1234);
    assert.equal(exporter.parseTotalCount('共 0 条'), 0);
    assert.equal(exporter.parseTotalCount('没有总数'), null);
});

test('extracts unique header names and fills empty ones', () => {
    assert.deepEqual(
        exporter.extractHeaderNames(['SKC', '曝光量', '曝光量', '']),
        ['SKC', '曝光量', '曝光量#2', '列4'],
    );
});

test('skips placeholder rows only', () => {
    assert.equal(exporter.isSkippableRow(['暂无相关数据']), true);
    assert.equal(exporter.isSkippableRow(['No data']), true);
    assert.equal(exporter.isSkippableRow(['SKC0001', '商品1']), false);
    assert.equal(exporter.isSkippableRow(['-']), true);
});

test('requires at least one selected column', () => {
    assert.throws(() => exporter.applyColumnSelection(['A', 'B'], [false, false]), /至少勾选一列/);
    assert.deepEqual(exporter.applyColumnSelection(['A', 'B', 'C'], [true, false, true]), [0, 2]);
});

test('builds CSV with BOM, quoting, formula guard and page column', () => {
    const csv = exporter.buildCsv({
        headers: ['SKC', '曝光量', '备注'],
        rows: [['SKC0001', '100', '=SUM(A1)'], ['SKC0002', 'with "quote"', 'ok']],
        selectedIndices: [0, 1, 2],
        pageNumbers: [1, 2],
    });
    assert.equal(csv.startsWith('\uFEFF'), true);
    const lines = csv.slice(1).split('\n');
    assert.deepEqual(lines[0], '"SKC","曝光量","备注","页码"');
    assert.deepEqual(lines[1], '"SKC0001","100","\'=SUM(A1)","1"');
    assert.deepEqual(lines[2], '"SKC0002","with ""quote""","ok","2"');
    assert.throws(() => exporter.buildCsv({ headers: ['A'], rows: [], selectedIndices: [] }), /缺少表头或列选择/);
});

test('dedupes full rows and keeps first occurrence', () => {
    const result = exporter.dedupeRows([['A', '1'], ['B', '2'], ['A', '1']]);
    assert.deepEqual(result.rows, [['A', '1'], ['B', '2']]);
    assert.equal(result.duplicateCount, 1);
});

test('row signature changes when page content changes', () => {
    const before = exporter.rowSignature([['A', '1', 'x'], ['B', '2', 'y']]);
    assert.equal(exporter.rowSignature([['A', '1', 'x'], ['B', '2', 'y']]), before);
    assert.notEqual(exporter.rowSignature([['C', '3', 'z'], ['B', '2', 'y']]), before);
    assert.notEqual(exporter.rowSignature([['A', '1', 'x']]), before);
});

test('clamps paging options into safe ranges', () => {
    assert.equal(exporter.clampPageInterval(10), exporter.CONFIG.minPageIntervalMs);
    assert.equal(exporter.clampPageInterval(999999), exporter.CONFIG.maxPageIntervalMs);
    assert.equal(exporter.clampPageInterval('abc'), exporter.CONFIG.pageIntervalMs);
    assert.equal(exporter.clampMaxPages(0), exporter.CONFIG.defaultMaxPages);
    assert.equal(exporter.clampMaxPages(99999), exporter.CONFIG.maxPagesLimit);
});

test('decides pagination from control state and stops at disabled next', () => {
    const dom = buildTableDoc();
    const doc = dom.window.document;
    const controls = exporter.findNextPageControls(doc);
    assert.ok(controls.length >= 1);
    const decision = exporter.decideNextPage(controls);
    assert.equal(decision.action, 'click');

    const next = doc.getElementById('next-page');
    next.classList.add('ant-pagination-disabled');
    assert.equal(exporter.isElementDisabled(next), true);
    assert.equal(exporter.decideNextPage(exporter.findNextPageControls(doc)).action, 'last-page');

    const empty = new JSDOM('<body><main></main></body>').window.document;
    assert.equal(exporter.decideNextPage(exporter.findNextPageControls(empty)).action, 'no-control');
});

test('disabled detection walks up to pagination container only', () => {
    const dom = new JSDOM(`<body>
        <ul class="ant-pagination"><li class="ant-pagination-next disabled" id="a"><button>下一页</button></li></ul>
        <div class="some-disabled-wrapper"><ul class="ant-pagination"><li id="b"><button>下一页</button></li></ul></div>
    </body>`);
    const doc = dom.window.document;
    assert.equal(exporter.isElementDisabled(doc.getElementById('a')), true);
    assert.equal(exporter.isElementDisabled(doc.getElementById('b')), false);
});

test('reads headers from leaf header row and skips non-data rows', () => {
    const dom = buildTableDoc();
    const table = dom.window.document.getElementById('main');
    const page = exporter.readTablePage(table);
    assert.deepEqual(page.headers, ['SKC', '商品名称', '曝光量', '浏览量', '访客数']);
    assert.equal(page.rows.length, 6);
    assert.equal(page.skippedRows, 2);
    assert.deepEqual(page.rows[0], ['SKC0001', '商品1', '100', '50', '10']);
    assert.deepEqual(page.rows[3], ['SKC0004', '商品4', '400', '200', '40']);
});

test('prefers the largest table and rejects tiny or headerless tables', () => {
    const dom = buildTableDoc({ withSideTable: true });
    const candidates = exporter.findDataTableCandidates(dom.window.document);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].table.id, 'main');

    const plain = new JSDOM('<body><table><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table></body>');
    assert.equal(exporter.findDataTableCandidates(plain.window.document).length, 0);
});

test('collects only the current page in current mode', async () => {
    const dom = buildTableDoc();
    const result = await exporter.collectTableData({
        doc: dom.window.document,
        mode: 'current',
    });
    assert.equal(result.pages, 1);
    assert.equal(result.rows.length, 6);
    assert.equal(result.endReason, 'current-page');
    assert.equal(result.error, null);
    assert.deepEqual(result.pageNumbers, [1, 1, 1, 1, 1, 1]);
});

test('auto-pagination walks pages until next is disabled and preserves data', async () => {
    const dom = buildTableDoc();
    const doc = dom.window.document;
    const tbody = doc.querySelector('#main tbody');
    const next = doc.getElementById('next-page');
    let turned = false;
    next.addEventListener('click', () => {
        if (turned) return;
        turned = true;
        tbody.innerHTML = Array.from({ length: 3 }, (_, index) => (
            `<tr><td>SKC9${index}</td><td>商品9${index}</td><td>${index}</td><td>${index}</td><td>${index}</td></tr>`
        )).join('');
        next.classList.add('ant-pagination-disabled');
    });

    const result = await exporter.collectTableData({
        doc,
        mode: 'all',
        pageIntervalMs: 300,
        sleepImpl: () => Promise.resolve(),
        pollIntervalMs: 10,
        pageTurnTimeoutMs: 2000,
    });

    assert.equal(result.error, null);
    assert.equal(result.pages, 2);
    assert.equal(result.rows.length, 9);
    assert.equal(result.endReason, 'last-page');
    assert.deepEqual(result.pageNumbers.slice(6), [2, 2, 2]);
});

test('auto-pagination stops at max pages and keeps partial data', async () => {
    const dom = buildTableDoc();
    const result = await exporter.collectTableData({
        doc: dom.window.document,
        mode: 'all',
        maxPages: 1,
        sleepImpl: () => Promise.resolve(),
    });
    assert.equal(result.pages, 1);
    assert.equal(result.endReason, 'page-limit');
    assert.equal(result.truncatedByPageLimit, true);
    assert.equal(result.rows.length, 6);
});

test('collect keeps partial data and reports error when page never changes', async () => {
    const dom = buildTableDoc();
    const result = await exporter.collectTableData({
        doc: dom.window.document,
        mode: 'all',
        sleepImpl: () => Promise.resolve(),
        pollIntervalMs: 10,
        pageTurnTimeoutMs: 60,
    });
    assert.equal(result.pages, 1);
    assert.match(result.error, /翻页后第 2 页内容未变化/);
    assert.equal(result.rows.length, 6);
});

test('builds deterministic export filenames', () => {
    assert.equal(exporter.buildExportFilename('SKCEXP-20260911T0330-AB12'), 'shein-skc-metrics-skcexp-20260911t0330-ab12.csv');
    assert.equal(exporter.buildExportFilename('SKCEXP-1', 'xlsx'), 'shein-skc-metrics-skcexp-1.xlsx');
});

// ---------- XLSX 生成 ----------

const JSZip = require(path.join(repoRoot, 'extensions', 'xynigo-shein-skc-metrics-exporter', 'vendor', 'jszip.min.js'));

test('escapes xml and computes spreadsheet column letters', () => {
    assert.equal(exporter.escapeXml('<a&"b>\'c'), '&lt;a&amp;&quot;b&gt;&apos;c');
    assert.equal(exporter.escapeXml('a\u0001b'), 'ab');
    assert.equal(exporter.columnLetter(0), 'A');
    assert.equal(exporter.columnLetter(25), 'Z');
    assert.equal(exporter.columnLetter(26), 'AA');
    assert.equal(exporter.columnLetter(27), 'AB');
});

test('maps cell values to typed xlsx data', () => {
    assert.deepEqual(exporter.toXlsxCellData('1,036', '销量'), { type: 'n', value: 1036 });
    assert.deepEqual(exporter.toXlsxCellData('MXN 438.80', 'GMV（MXN）'), { type: 'n', value: 438.8 });
    assert.deepEqual(exporter.toXlsxCellData('4.54%', '点击率'), { type: 'p', value: 0.0454 });
    assert.deepEqual(exporter.toXlsxCellData('0.00%', '支付率'), { type: 'p', value: 0 });
    assert.deepEqual(exporter.toXlsxCellData('438.81', '原价'), { type: 'n', value: 438.81 });
    assert.deepEqual(exporter.toXlsxCellData('207152685', '供方货号'), { type: 's', value: '207152685' });
    assert.deepEqual(exporter.toXlsxCellData('sh260810', 'SKC'), { type: 's', value: 'sh260810' });
    assert.deepEqual(exporter.toXlsxCellData('10~20', '原价'), { type: 's', value: '10~20' });
    assert.deepEqual(exporter.toXlsxCellData('', '销量'), { type: 'empty', value: '' });
});

test('builds xlsx with typed numbers, percent style and deduped embedded images', async () => {
    const imageDatas = new Map([['https://img.ltwebstatic.com/a.jpg', 'data:image/jpeg;base64,AAAA']]);
    const bytes = await exporter.buildXlsxBytes({
        headers: ['商品名称', 'SKC', 'GMV（MXN）', '点击率', '销量', '原价'],
        rows: [
            ['Test 裙子', 'sh001', 'MXN 438.80', '4.54%', '1,036', '438.81'],
            ['Test 裙子2', 'sh002', 'MXN 0.00', '0.00%', '2', '10~20'],
        ],
        imageUrls: ['https://img.ltwebstatic.com/a.jpg', 'https://img.ltwebstatic.com/a.jpg'],
        imageDatas,
        zipImpl: JSZip,
    });

    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    assert.ok(zip.file('xl/media/image1.jpeg'), '去重后应只有一个媒体文件');
    assert.ok((await zip.file('[Content_Types].xml').async('string')).includes('Extension="jpeg"'));
    const drawing = await zip.file('xl/drawings/drawing1.xml').async('string');
    assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) || []).length, 2, '两行各锚定一张图');
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(sheet.includes('ht="56"'));

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    const ws = workbook.getWorksheet('SKC指标');
    assert.equal(ws.getRow(1).cellCount, 7);
    assert.equal(ws.getCell('A1').value, '图片URL');
    assert.equal(ws.getCell('A2').value, 'https://img.ltwebstatic.com/a.jpg');
    assert.equal(ws.getCell('C2').value, 'sh001');
    assert.equal(ws.getCell('D2').value, 438.8);
    assert.equal(ws.getCell('E2').value, 0.0454);
    assert.equal(ws.getCell('E2').numFmt, '0.00%');
    assert.equal(ws.getCell('F2').value, 1036);
    assert.equal(ws.getCell('G2').value, 438.81);
    assert.equal(ws.getCell('G3').value, '10~20');
    assert.equal(workbook.model.media?.length ?? 0, 1);
});

test('builds xlsx without image parts when urls are absent', async () => {
    const bytes = await exporter.buildXlsxBytes({
        headers: ['SKC', '销量'],
        rows: [['sh001', '10']],
        imageUrls: [],
        zipImpl: JSZip,
    });
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    assert.equal(zip.file('xl/media/image1.jpeg'), null);
    assert.equal(zip.file('xl/drawings/drawing1.xml'), null);
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(!sheet.includes('<drawing'));
    assert.ok(sheet.includes('t="inlineStr"'));
});

// ---------- 真机结构适配（20260911 卖家后台商品分析 SKC 列表实测形状） ----------

const COMPOUND_PRODUCT_CELL = [
    'Test Dress 裙子', 'Test Dress 裙子',
    'SKC:sd260101000000000000001', 'SPU:td26010100000000001',
    '供方货号:123456789',
    '品类:服饰 / 女装 / 连衣裙', '服饰 / 女装 / 连衣裙',
    '备货款A', '非在售下架',
].join('');

// 分组表头：rowSpan 列 + colSpan 组 + 叶子行（与真实页面同构，列数压缩为 6）
const GROUPED_HEADER_HTML = `
    <thead>
        <tr><th rowspan="2">商品</th><th colspan="2">商品基本信息</th><th colspan="2">交易</th><th rowspan="2">操作</th></tr>
        <tr><th>活动标签</th><th>价格</th><th>GMV</th><th>销量</th></tr>
    </thead>`;

const SOUI_PAGER_HTML = `
    <div class="pagination"><div class="soui-pagination">
        <span>共 4 条</span>
        <div class="soui-pagination-buttons">
            <button type="button" class="soui-pagination-button-item soui-button-disabled" disabled>◀</button>
            <button type="button" class="soui-pagination-button-item">1</button>
            <button type="button" class="soui-pagination-button-item">2</button>
            <button type="button" class="soui-pagination-button-item" id="soui-next">▶</button>
        </div>
    </div></div>`;

function splitBodyRow(index) {
    return `<tr><td>商品${index}<img src="https://img.ltwebstatic.com/t${index}.jpg">SKC:sd${index}</td><td>无活动</td><td>$10</td><td>MXN ${index * 10}.00</td><td>${index}</td><td>查看趋势</td></tr>`;
}

function buildSplitTableDoc() {
    return new JSDOM(`<!doctype html><html><body>
        <div class="page">共 4 条</div>
        <div id="widget">
            <div class="soui-table-head-wrapper"><table id="header-table">${GROUPED_HEADER_HTML}</table></div>
            <div class="table-x-scroll"><table id="body-table"><tbody>
                ${splitBodyRow(1)}${splitBodyRow(2)}
            </tbody></table></div>
        </div>
        ${SOUI_PAGER_HTML}
    </body></html>`, { url: 'https://sellerhub.shein.com/#/sbn/merchandise/details', runScripts: 'outside-only' });
}

test('dedupes repeated title text in compound cells', () => {
    assert.equal(exporter.dedupeRepeatedText('Test Dress 裙子Test Dress 裙子'), 'Test Dress 裙子');
    assert.equal(exporter.dedupeRepeatedText('普通文本'), '普通文本');
    assert.equal(exporter.dedupeRepeatedText('abcabcabc'), 'abcabcabc');
});

test('splits the compound product cell into structured columns', () => {
    const split = exporter.splitProductCell(COMPOUND_PRODUCT_CELL);
    assert.deepEqual(split, {
        '商品名称': 'Test Dress 裙子',
        'SKC': 'sd260101000000000000001',
        'SPU': 'td26010100000000001',
        '供方货号': '123456789',
        '品类': '服饰 / 女装 / 连衣裙',
        '备货款': 'A',
        '商品状态': '非在售/下架',
    });
    assert.equal(exporter.splitProductCell('普通文本没有SKC'), null);
});

test('expands grouped headers across colSpan and rowSpan occupancy', () => {
    const dom = buildSplitTableDoc();
    const headerTable = dom.window.document.getElementById('header-table');
    const grid = exporter.expandHeaderGrid([...headerTable.tHead.rows]);
    assert.equal(grid.columnCount, 6);
    assert.deepEqual(grid.names, ['商品', '活动标签', '价格', 'GMV', '销量', '操作']);
});

test('pairs a split header table with its body table', () => {
    const dom = buildSplitTableDoc();
    const doc = dom.window.document;
    const candidates = exporter.findDataTableCandidates(doc);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, 'split');
    assert.equal(candidates[0].headers.length, 6);
    assert.equal(candidates[0].rows.length, 2);
    assert.deepEqual(candidates[0].imageUrls, [
        'https://img.ltwebstatic.com/t1.jpg',
        'https://img.ltwebstatic.com/t2.jpg',
    ]);
    const page = exporter.readCandidateRows(candidates[0], { splitProductColumn: true });
    assert.equal(page.splitApplied, true);
    assert.deepEqual(page.headers.slice(0, 9), ['商品名称', 'SKC', 'SPU', '供方货号', '品类', '备货款', '商品状态', '图片URL', '商品(原始)']);
    assert.equal(page.rows[0][1], 'sd1');
    assert.equal(page.rows[0][7], 'https://img.ltwebstatic.com/t1.jpg');
});

test('splits price column into list price and sale price', () => {
    assert.deepEqual(exporter.splitPriceCell('原价：438.81~438.81特价：0.0~0.0'), { 原价: '438.81', 特价: '0.0' });
    assert.deepEqual(exporter.splitPriceCell('原价：10~20特价：5~8'), { 原价: '10~20', 特价: '5~8' });
    assert.equal(exporter.splitPriceCell('暂无生效活动'), null);

    const result = exporter.applyPriceSplit({
        headers: ['活动标签', '价格', '销量'],
        rows: [['无活动', '原价：438.81~438.81特价：0.0~0.0', '5'], ['无活动', '价格待定', '6']],
    });
    assert.equal(result.priceSplitApplied, true);
    assert.deepEqual(result.headers, ['活动标签', '原价', '特价', '销量']);
    assert.deepEqual(result.rows[0], ['无活动', '438.81', '0.0', '5']);
    assert.deepEqual(result.rows[1], ['无活动', '价格待定', '', '6']);

    const untouched = exporter.applyPriceSplit({ headers: ['A', 'B'], rows: [['1', '2']] });
    assert.equal(untouched.priceSplitApplied, false);
    const unparseable = exporter.applyPriceSplit({ headers: ['价格', 'B'], rows: [['$10', '2']] });
    assert.equal(unparseable.priceSplitApplied, false);
});

test('collect pipeline adds image column and price split together', () => {
    const combined = exporter.applyExportTransforms({
        headers: ['商品', '价格', '销量'],
        rows: [['商品ASKC:sd1SPU:sp1供方货号:123品类:服饰备货款A在售', '原价：10~10特价：5~5', '3']],
        imageUrls: ['https://img.ltwebstatic.com/a.jpg'],
        splitProductColumn: true,
        priceSplit: true,
    });
    assert.equal(combined.splitApplied, true);
    assert.equal(combined.priceSplitApplied, true);
    assert.deepEqual(combined.headers.slice(0, 9), ['商品名称', 'SKC', 'SPU', '供方货号', '品类', '备货款', '商品状态', '图片URL', '商品(原始)']);
    assert.deepEqual(combined.headers.slice(9), ['原价', '特价', '销量']);
    assert.equal(combined.rows[0][1], 'sd1');
    assert.equal(combined.rows[0][9], '10');
    assert.equal(combined.rows[0][10], '5');

    const appended = exporter.applyExportTransforms({
        headers: ['A', 'B'],
        rows: [['1', '2']],
        imageUrls: ['u1'],
        splitProductColumn: false,
        priceSplit: false,
    });
    assert.deepEqual(appended.headers, ['A', 'B', '图片URL']);
    assert.deepEqual(appended.rows[0], ['1', '2', 'u1']);

    const noImages = exporter.applyExportTransforms({
        headers: ['A', 'B'],
        rows: [['1', '2']],
        imageUrls: ['', ''],
        splitProductColumn: false,
        priceSplit: false,
    });
    assert.deepEqual(noImages.headers, ['A', 'B']);
});

test('detects soui pagination next button and its disabled state', () => {
    const dom = buildSplitTableDoc();
    const doc = dom.window.document;
    const controls = exporter.findNextPageControls(doc);
    assert.equal(controls[0].id, 'soui-next');
    assert.equal(exporter.decideNextPage(controls).action, 'click');

    doc.getElementById('soui-next').classList.add('soui-button-disabled');
    assert.equal(exporter.isElementDisabled(doc.getElementById('soui-next')), true);
    assert.equal(exporter.decideNextPage(exporter.findNextPageControls(doc)).action, 'last-page');
});

test('collects across split-table pages driven by soui pagination', async () => {
    const dom = buildSplitTableDoc();
    const doc = dom.window.document;
    const tbody = doc.querySelector('#body-table tbody');
    const next = doc.getElementById('soui-next');
    let turned = false;
    next.addEventListener('click', () => {
        if (turned) return;
        turned = true;
        tbody.innerHTML = splitBodyRow(3) + splitBodyRow(4);
        next.classList.add('soui-button-disabled');
    });

    const result = await exporter.collectTableData({
        doc,
        mode: 'all',
        splitProductColumn: true,
        pageIntervalMs: 300,
        sleepImpl: () => Promise.resolve(),
        pollIntervalMs: 10,
        pageTurnTimeoutMs: 2000,
    });

    assert.equal(result.error, null);
    assert.equal(result.pages, 2);
    assert.equal(result.rows.length, 4);
    assert.equal(result.endReason, 'last-page');
    assert.equal(result.headers[1], 'SKC');
    assert.deepEqual(result.rows.map((cells) => cells[1]), ['sd1', 'sd2', 'sd3', 'sd4']);
});

test('mounts launcher on table pages and collects current page end to end', async () => {
    const dom = buildTableDoc({ withSideTable: true });
    dom.window.eval(source);
    const document = dom.window.document;

    const launcher = document.getElementById(`${exporter.CONFIG.appId}-launcher`);
    assert.ok(launcher, '检测到表格时应显示悬浮按钮');
    launcher.click();

    const overlay = document.getElementById(`${exporter.CONFIG.appId}-overlay`);
    const role = (name) => overlay.querySelector(`[data-role="${name}"]`);
    assert.equal(overlay.hidden, false);
    assert.match(role('table-info').textContent, /5 列 × 当前页 6 行/);
    assert.equal(role('columns').querySelectorAll('input[type="checkbox"]:checked').length, 5);

    role('start').click();
    await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
            if (!role('export').hidden || Date.now() - startedAt > 5000) return resolve();
            setTimeout(poll, 20);
        };
        poll();
    });

    assert.equal(role('export').hidden, false, '采集完成后应显示导出按钮');
    assert.match(role('result').textContent, /数据行：6/);
    assert.match(role('result').textContent, /预期总条数：6 条（与采集行数一致）/);
    dom.window.close();
});

test('shows no launcher on pages without data tables', () => {
    const dom = new JSDOM('<!doctype html><html><body><p>空页面</p></body></html>', {
        url: 'https://sellerhub.shein.com/',
        runScripts: 'outside-only',
    });
    dom.window.eval(source);
    assert.equal(dom.window.document.getElementById(`${exporter.CONFIG.appId}-launcher`), null);
    dom.window.close();
});

import { UI_CSS } from './style.mjs';
import { icon } from './icons.mjs';
import { APP_VERSION } from './app.mjs';
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function mountPackageUI(win, app) {
  const doc = win.document, host = doc.createElement('div'); host.id = 'lingxing-package-data-assistant';
  const root = host.attachShadow({ mode: 'open' }), local = { selected: '', filter: 'all', search: '', lastView: 'preview', open: false, file: null, confirm: null };
  const esc = escapeHTML, state = app.state, $ = id => root.getElementById(id);
  root.innerHTML = '<style>' + UI_CSS + '</style><div class="backdrop hidden" id="backdrop"><section class="panel" aria-label="FBA 包装数据维护助手"><header class="header"><div class="brand"><span class="brand-mark">' + icon('package') + '</span><div><h1>FBA 包装数据维护助手</h1><small>亚马逊费用预估 → 领星商品档案</small></div></div><div class="header-actions"><span class="prototype-badge">试用版 ' + APP_VERSION + '</span><button class="history-btn" data-action="history">' + icon('history') + '更新记录</button><button class="icon-btn" data-action="close" aria-label="最小化窗口">' + icon('minus') + '</button><button class="icon-btn" data-action="close" aria-label="关闭窗口">' + icon('x') + '</button></div></header><section class="toolbar"><div class="toolbar-row"><span class="field-label">店铺</span><select id="store" class="store-select" aria-label="领星店铺"></select><span class="field-label" style="margin-left:8px">报告日期</span><input id="reportDate" type="date" aria-label="报告日期"><span class="toolbar-sep"></span><button class="primary" data-action="import">' + icon('upload') + '导入报告</button><button class="rematch" data-action="rematch">' + icon('refresh') + '重新匹配</button><span class="grow"></span><button class="ghost export-top" data-action="export">' + icon('download') + '导出</button></div><div class="source-line" id="sourceLine"></div></section><nav class="workflow"><div class="steps"><button class="step" data-action="import" id="step1"><b>01</b>导入与匹配</button><span class="step-sep"></span><button class="step" data-action="preview" id="step2"><b>02</b>差异预览</button><span class="step-sep"></span><button class="step" data-action="result" id="step3"><b>03</b>更新与核验</button></div><div class="stats" id="stats"></div></nav><div class="global-error hidden" id="errorLine"><span id="errorText"></span><button class="text-btn" data-action="dismissError">收起</button></div><div class="busy-note hidden" id="busyLine"><i class="activity-dot"></i><span id="busyText"></span><button class="text-btn" data-action="stop" style="float:right">停止等待</button></div><div class="workspace"><aside class="sidebar"><div class="sidebar-head"><label class="search">' + icon('search') + '<input id="search" placeholder="搜索商品 / MSKU / 本地 SKU" aria-label="搜索商品或 SKU"></label><div class="filters" id="filters"></div></div><div class="list-label"><span id="listLabel">报告商品</span><span id="visibleCount"></span></div><div class="record-list" id="recordList"></div><div class="sidebar-foot" id="sideFoot"></div></aside><main class="main" id="main"></main></div><footer class="footer" id="footer"></footer></section></div><button class="launcher" data-action="open" aria-label="打开 FBA 包装数据维护助手">' + icon('package') + '</button><dialog id="dialog" aria-label="操作弹窗"></dialog>';
  doc.documentElement.appendChild(host);
  function source() { return state.view === 'result' && state.currentBatch ? state.currentBatch : state.report; }
  function current() { return state.records.find(r => r.id === local.selected); }
  function productArt(record) {
    const url = record.product?.imageUrl;
    return '<div class="product-art" style="color:#ad98c7" title="' + (url ? '商品图片' : '领星未提供商品图片') + '">' + icon('package') + (url ? '<img src="' + esc(url) + '" alt="' + esc(record.title) + '" decoding="async" referrerpolicy="no-referrer">' : '') + '</div>';
  }
  function display(value, i) { return value === undefined || value === null || value === '' ? '—' : Number.isFinite(Number(value)) ? Number(value).toFixed(i === 3 && String(value).split('.')[1]?.replace(/0+$/, '').length > 2 ? 4 : 2) : esc(value); }
  function statusBadge(record) { const s = record.status; const tone = s.key === 'ready' ? 'ready' : ['same', 'skipped'].includes(s.key) ? 'same' : ['invalid', 'unpaired', 'identity'].includes(s.kind) ? 'danger' : 'warn'; const title = s.key === 'ready' ? s.kind === 'fill' ? '可补全' : '可更新' : s.key === 'same' ? '完全一致' : s.key === 'skipped' ? '已跳过' : ({ conflict: '来源冲突', box: '待确认箱规', existing: '已有值有差异', unpaired: '未配对', identity: '身份待核对', unknown: '结果待核实', unit: '规格单位待核对', market: '站点待核对' }[s.kind] || '报表异常'); return '<span class="badge ' + tone + '"><i class="dot"></i>' + title + '</span>'; }
  function resultBadge(row) { return '<span class="badge ' + (row.status === 'success' ? 'success' : row.status === 'not_submitted' ? 'same' : 'warn') + '"><i class="dot"></i>' + (row.status === 'success' ? '核验通过' : row.status === 'not_submitted' ? '未提交' : ['prepared', 'submitted', 'verifying'].includes(row.status) && state.busy ? '待核验' : '结果待核实') + '</span>'; }
  function renderHeader() {
    const batch = state.view === 'result' ? state.currentBatch : null, data = source();
    $('store').innerHTML = '<option value="">请选择领星店铺</option>' + state.stores.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('');
    $('store').value = batch?.store.id || state.storeId;
    $('store').disabled = state.busy || state.blocked || !!batch;
    $('reportDate').value = data?.reportDate || state.reportDate;
    $('reportDate').disabled = state.busy || state.blocked || !!batch;
    $('sourceLine').innerHTML = data ? '<span class="file-kind">' + (/\.xlsx$/i.test(data.filename) ? 'XLSX' : /\.csv$/i.test(data.filename) ? 'CSV' : 'TXT') + '</span><span class="source-name mono" title="' + esc(data.filename) + '">' + esc(data.filename) + '</span><span class="source-tick">' + icon('check-circle') + (batch ? '本批 ' + batch.rows.length + ' 个商品' : '已解析 ' + state.report.rows.length + ' 条') + '</span><span class="source-divider">|</span><span>来源：亚马逊费用预估</span>' : '<span class="muted">导入费用预估报告后，自动读取领星已有商品配对关系</span>';
    const skipped = state.records.filter(r => r.status.key === 'skipped').length;
    if (data && !batch && !state.busy && skipped) $('sourceLine').innerHTML += '<span class="source-divider">|</span><span>已跳过 ' + skipped + ' 条其他站点记录</span>';
    $('step1').className = 'step ' + (state.report ? 'complete' : 'active');
    $('step2').className = 'step ' + (state.report && state.view === 'preview' ? 'active' : '');
    $('step3').className = 'step ' + (state.view === 'result' ? 'active' : '');
    $('errorLine').classList.toggle('hidden', !state.error); $('errorText').textContent = state.error;
    $('busyLine').classList.toggle('hidden', !state.busy); $('busyText').textContent = state.busyLabel;
  }
  function renderList() {
    const result = state.view === 'result' && state.currentBatch, data = result ? state.currentBatch.rows : state.records;
    const kind = row => result ? row.status === 'success' ? 'success' : row.status === 'not_submitted' ? 'skipped' : 'unknown' : row.status.key;
    const groups = result ? [['all', '本批', data.length], ['success', '核验通过', data.filter(r => kind(r) === 'success').length], ['unknown', '待核实', data.filter(r => kind(r) === 'unknown').length], ['skipped', '未提交', data.filter(r => kind(r) === 'skipped').length]] : [['all', '全部', data.length], ['ready', '可更新', data.filter(r => kind(r) === 'ready').length], ['issue', '待处理', data.filter(r => kind(r) === 'issue').length], ['skipped', '已跳过', data.filter(r => kind(r) === 'skipped').length]];
    $('filters').innerHTML = groups.map(([key, label, count]) => '<button data-filter="' + key + '" class="' + (local.filter === key ? 'active' : '') + '"><b>' + count + '</b>' + label + '</button>').join('');
    $('stats').innerHTML = groups.slice(1).map(([, label, count], i) => '<span class="' + ['green', 'amber', 'gray', 'gray'][i] + '"><strong>' + count + '</strong>' + label + '</span>').join('');
    const query = local.search.toLowerCase(), visible = data.filter(r => (local.filter === 'all' || kind(r) === local.filter) && (!query || [r.title, r.localSku, ...(r.sources || []).map(s => s.msku)].join(' ').toLowerCase().includes(query)));
    $('visibleCount').textContent = visible.length + ' 条'; $('listLabel').textContent = result ? '本批执行商品' : '报告商品';
    const scroll = $('recordList').scrollTop;
    $('recordList').innerHTML = visible.length ? visible.map((r, i) => '<div class="record ' + (!result && r.id === local.selected ? 'selected' : '') + '" role="button" tabindex="0" data-' + (result ? 'result-row' : 'row') + '="' + esc(r.id) + '" aria-label="查看' + esc(r.title) + '">' + (!result ? '<input type="checkbox" data-check="' + esc(r.id) + '" aria-label="选择' + esc(r.title) + '" ' + (state.checked.has(r.id) ? 'checked ' : '') + (r.status.key !== 'ready' || state.busy ? 'disabled' : '') + '>' : '') + '<div class="record-body"><div class="record-title" title="' + esc(r.title) + '">' + esc(r.title) + '</div><div class="record-sku mono">' + esc(r.localSku || r.sources[0]?.msku) + '</div><div class="record-bottom">' + (result ? resultBadge(r) : statusBadge(r)) + '<span class="record-number">' + String(i + 1).padStart(2, '0') + '</span></div></div></div>').join('') : '<div class="empty-sidebar">' + (state.report || result ? '没有符合条件的商品' : '导入报告后展示商品列表') + '</div>';
    $('recordList').scrollTop = scroll;
    $('sideFoot').innerHTML = result ? icon('history') + '<span>点击商品查看本批差异</span>' : icon('list-check') + '<button data-action="selectAll">选择全部可更新</button><span class="grow"></span><button data-action="clearSelection">清空</button>';
  }
  function issuePanel(record) {
    if (record.status.key !== 'issue') return '';
    const kind = record.status.kind; let detail = '', action = '', label = '';
    if (kind === 'conflict') { detail = '请明确采用其中一组完整数据；同一本地商品只更新一次。'; action = 'resolveSource'; label = '选择来源'; }
    else if (kind === 'box') { detail = '原生更新模板维护默认箱规，请确认该箱规对应本次销售包装。'; action = 'resolveBox'; label = '确认箱规'; }
    else if (kind === 'existing') { detail = '切换“按报告更新”，核对后勾选该商品。'; action = 'overwrite'; label = '切换模式'; }
    else if (kind === 'unpaired') detail = '在领星完成 Listing 与本地商品配对后，返回本批重新匹配。';
    else if (kind === 'unknown') { detail = '先检查商品现值和执行记录，不自动重复提交。'; action = 'history'; label = '查看记录'; }
    else detail = '请核对报表原始行和领星资料后重新匹配。';
    return '<div class="issue-panel">' + icon('alert') + '<div><strong>' + esc(record.status.text) + '</strong><p>' + esc(detail) + '</p></div>' + (action ? '<button data-action="' + action + '">' + label + '</button>' : '') + '</div>';
  }
  function renderPreview() {
    const record = current();
    $('main').className = 'main' + (record?.status.key === 'issue' ? ' compact' : '');
    if (!state.report || !record) { $('main').innerHTML = '<div class="welcome"><div><div class="welcome-mark">' + icon('package') + '</div><h2>把报表包装数据，维护到领星商品档案</h2><p>选择店铺，导入亚马逊费用预估报告。<br>自动读取已有配对关系，先核对差异，再批量更新。</p><button class="primary" data-action="import">' + icon('upload') + '导入费用预估报告</button><div class="empty-hint">支持 TXT / TSV / CSV / XLSX</div></div></div>'; return; }
    if (record.status.key === 'skipped') {
      const source = record.sources[0], store = state.stores.find(s => s.id === state.storeId);
      $('main').innerHTML = '<div class="detail-top"><span class="eyebrow">已跳过的报告记录</span></div><div class="product"><div class="product-info"><h2>' + esc(record.title) + '</h2><p class="product-sub mono">' + esc(source.msku) + '</p></div>' + statusBadge(record) + '</div><div class="issue-panel">' + icon('info') + '<div><strong>' + esc(record.status.text) + '</strong><p>本行不参与本次更新，请在对应站点的领星店铺处理。</p></div></div><section class="mini-card"><div class="mini-title">' + icon('file') + '跳过原因</div>' + [['报表站点', source.market], ['当前店铺', store?.name], ['当前站点', store?.country], ['报告 MSKU', source.msku], ['ASIN', source.asin], ['原始行号', source.line]].map(([label, value]) => '<div class="mapping-row"><span class="mapping-label">' + label + '</span><span class="mapping-value mono">' + esc(value || '—') + '</span></div>').join('') + '</section>';
      return;
    }
    const source = record.source || record.sources[0], proposed = ['ready', 'same'].includes(record.status.key), box = record.box;
    const fields = ['包装规格 · 长', '包装规格 · 宽', '包装规格 · 高', '单品毛重'];
    const cells = fields.map((label, i) => '<tr><td>' + label + '</td><td>' + (box && Number(box.raw[i]) ? '<span class="cell-val">' + display(box.raw[i], i) + '</span><span class="unit">' + esc(box.units[i === 3 ? 1 : 0]) + '</span>' : '<span class="blank">未维护</span>') + '</td><td><span class="cell-val">' + esc(source.raw?.[i] || '—') + '</span><span class="unit">' + esc(i === 3 ? source.weightUnit : source.dimensionUnit) + '</span></td><td>' + (proposed && record.values ? display(record.values[i], i) + '<span class="unit">' + (i === 3 ? 'g' : 'cm') + '</span>' + (record.status.key === 'ready' ? '<span class="new-mark">' + (record.status.kind === 'fill' ? '补全' : '更新') + '</span>' : '') : '<span class="blank">待确认</span>') + '</td></tr>').join('');
    const num = state.records.indexOf(record) + 1;
    $('main').innerHTML = '<div class="detail-top"><span class="eyebrow">商品差异预览</span><div class="detail-nav"><span>' + String(num).padStart(2, '0') + ' / ' + state.records.length + '</span><button data-action="prev" aria-label="上一个商品">' + icon('left') + '</button><button data-action="next" aria-label="下一个商品">' + icon('right') + '</button></div></div><div class="product">' + productArt(record) + '<div class="product-info"><h2>' + esc(record.title) + '</h2><p class="product-sub">' + esc(record.localSku || '待配对本地商品') + '</p><div class="identity"><span><span class="label">ASIN</span><span class="mono">' + esc(source.asin || '—') + '</span></span><span><span class="label">FNSKU</span><span class="mono">' + esc(source.fnsku || '—') + '</span></span></div></div>' + statusBadge(record) + '</div>' + issuePanel(record) + '<section class="diff-panel"><div class="section-heading"><h3>' + icon('compare') + '包装资料对比</h3><div class="mode-switch"><button data-mode="fill" class="' + (state.mode === 'fill' ? 'active' : '') + '">仅补全</button><button data-mode="overwrite" class="' + (state.mode === 'overwrite' ? 'active' : '') + '">按报告更新</button></div></div><table class="diff-table"><thead><tr><th>目标字段</th><th>领星当前值</th><th>亚马逊费用预估</th><th>本次更新后</th></tr></thead><tbody>' + cells + '</tbody></table><div class="diff-foot">' + icon('info') + '目标统一为 cm、g；四项成组更新<span class="foot-check">报告第 ' + source.line + ' 行' + (record.sources.length > 1 ? ' · 合并 ' + record.sources.length + ' 条来源' : '') + '</span></div></section><div class="detail-cards"><section class="mini-card"><div class="mini-title">' + icon('link') + '商品配对' + (record.localSku ? '<span class="badge ready">已有配对</span>' : '<span class="badge danger">待处理</span>') + '</div><div class="mapping-row"><span class="mapping-label">报告 MSKU</span><span class="mapping-value mono">' + esc(source.msku || '—') + '</span></div><div class="mapping-arrow">↓ 选定店铺的 Listing 配对关系</div><div class="mapping-row"><span class="mapping-label">本地 SKU</span><span class="mapping-value mono">' + esc(record.localSku || '—') + '</span></div></section><section class="mini-card"><div class="mini-title">' + icon('box') + '目标箱规<button class="text-btn" data-action="mapping" style="margin-left:auto;font-size:10px">查看字段映射</button></div><div class="box-name">' + esc(box?.title || '待确认') + ' <span class="tag">销售包装</span></div><p class="box-detail">库存单位：<strong>' + esc(record.product?.unit || '—') + '</strong><span style="margin:0 8px">|</span>仅维护包装三边与单品毛重</p><p class="box-detail">ERP 单品净重：<strong>' + (record.product ? display(record.product.netRaw, 3) + ' ' + esc(record.product.netUnit) : '—') + '</strong></p></section></div><div class="source-note">' + icon('file') + '<div><b>采用来源：亚马逊费用预估</b><span style="margin:0 9px">|</span>报告 ' + esc(state.report.reportDate) + '<span style="margin-left:12px">报告日期不代表仓库测量时间。</span></div></div>';
    const image = $('main').querySelector('.product-art img');
    image?.addEventListener('error', () => { image.parentElement.title = '商品图片加载失败'; image.remove(); }, { once: true });
  }
  function renderResults() {
    const batch = state.currentBatch; $('main').className = 'main';
    if (!batch) { app.showPreview(); return; }
    const ok = batch.rows.filter(r => r.status === 'success').length, pending = batch.rows.filter(r => !['success', 'not_submitted'].includes(r.status)).length;
    $('main').innerHTML = '<div class="detail-top"><span class="eyebrow">更新与核验</span><span class="tag">批次 ' + esc(batch.id.slice(0, 8)) + '</span></div><div class="result-top"><div class="result-icon">' + icon('shield') + '</div><div><h2>' + (state.busy ? '正在提交与核验' : pending ? '本批有 ' + pending + ' 个结果待核实' : '本批核验已完成') + '</h2><p>' + esc(batch.store.name) + ' · ' + esc(batch.reportDate) + ' · 逐商品核对四项值与单位</p></div></div><div class="result-counters"><div class="result-count"><b>' + batch.rows.length + '</b>本批商品</div><div class="result-count ok"><b>' + ok + '</b>核验通过</div><div class="result-count warn"><b>' + pending + '</b>' + (state.busy ? '待核验' : '结果待核实') + '</div></div><table class="result-table"><thead><tr><th>本地商品</th><th>目标包装数据</th><th>核验结果</th><th style="width:92px">操作</th></tr></thead><tbody>' + batch.rows.map(r => '<tr><td class="result-product">' + esc(r.title) + '<small class="mono">' + esc(r.localSku) + '</small></td><td class="mono">' + r.values.slice(0, 3).map(v => display(v, 0)).join(' × ') + ' cm<br><small>' + display(r.values[3], 3) + ' g</small></td><td>' + resultBadge(r) + '</td><td><button data-result-row="' + esc(r.id) + '">查看差异</button></td></tr>').join('') + '</tbody></table><div class="' + (pending ? 'result-note' : 'source-note') + '" style="margin-top:13px">' + icon(pending ? 'info' : 'check-circle') + '<div>' + (pending ? '结果待核实的商品先检查现值与原生导入记录，不自动重新提交。' : '四项包装值与单位已核验一致，执行记录保留更新前数值。') + '<br>原生任务：' + esc(batch.nativeTaskId || '尚未取得任务编号') + '</div></div>';
  }
  function renderFooter() {
    const batch = state.view === 'result' ? state.currentBatch : null, count = state.checked.size;
    if (batch) {
      const ok = batch.rows.filter(r => r.status === 'success').length, pending = batch.rows.some(r => !['success', 'not_submitted'].includes(r.status));
      $('footer').innerHTML = '<div class="selection-info"><div class="select-icon">' + icon('shield') + '</div><div class="selection-copy"><strong>已核验 <b>' + ok + '</b> / ' + batch.rows.length + ' 个商品</strong><small>数据来源及更新前后数值已留存</small></div></div><div class="footer-actions"><button data-action="preview">返回差异预览</button>' + (pending ? '<button data-action="verify">' + icon('refresh') + '重新核验</button>' : '') + '<button class="primary" data-action="exportBatch">' + icon('download') + '导出执行记录</button></div>';
    } else $('footer').innerHTML = '<div class="selection-info"><div class="select-icon">' + icon('list-check') + '</div><div class="selection-copy"><strong>已选择 <b>' + count + '</b> 个商品</strong><small>更新默认箱规的包装长、宽、高及单品毛重</small></div></div><div class="footer-actions"><button data-action="export">' + icon('download') + '导出更新预览</button><button class="primary" data-action="confirm" ' + (!count ? 'disabled' : '') + '>确认更新 ' + count + ' 个商品' + icon('arrow') + '</button></div>';
  }
  function render() {
    if (state.blocked) {
      local.file = null; local.confirm = null; local.selected = ''; local.search = ''; local.filter = 'all';
      $('search').value = '';
      if ($('dialog').open) $('dialog').close();
      $('dialog').replaceChildren();
    }
    if (local.lastView !== state.view) { local.filter = 'all'; local.lastView = state.view; }
    if (!state.records.some(r => r.id === local.selected)) local.selected = state.records[0]?.id || '';
    renderHeader(); renderList(); state.view === 'result' ? renderResults() : renderPreview(); renderFooter();
    for (const button of root.querySelectorAll('.panel button')) {
      if (['close', 'dismissError', 'stop'].includes(button.dataset.action)) continue;
      const action = button.dataset.action;
      button.disabled = state.busy || state.blocked || (action === 'confirm' && !state.checked.size) || (action === 'export' && !state.report && !state.currentBatch) || (action === 'result' && !state.currentBatch && !state.batches.length);
    }
    for (const el of root.querySelectorAll('button[data-action=import]')) el.disabled = state.busy || state.blocked || !state.stores.length;
    const rematch = root.querySelector('button[data-action=rematch]'); rematch.disabled = state.busy || state.blocked || !state.report || state.view === 'result';
  }
  function dialog(title, subtitle, body, footer = '') {
    const d = $('dialog');
    d.innerHTML = '<div class="dialog-header"><div><h2 id="dialogTitle">' + title + '</h2><p>' + subtitle + '</p></div><button class="icon-btn" data-action="dismiss" aria-label="关闭弹窗">' + icon('x') + '</button></div><div class="dialog-body">' + body + '</div>' + (footer ? '<div class="dialog-footer">' + footer + '</div>' : '');
    d.setAttribute('aria-labelledby', 'dialogTitle'); if (!d.open) d.showModal();
  }
  function importDialog() {
    if (state.busy || state.blocked || !state.stores.length) return;
    local.file = null;
    dialog('导入亚马逊费用预估报告', '一个批次对应一个具体店铺和一份报告', '<div class="dialog-form"><label>领星店铺<select id="importStore"><option value="">请选择报告所属店铺</option>' + state.stores.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></label><label>报告日期<input id="importDate" type="date" value="' + esc(state.reportDate || new Date().toLocaleDateString('sv-SE')) + '"></label></div><div class="dropzone" id="dropzone"><div class="upload-circle">' + icon('upload') + '</div><strong id="chosenFile">拖入 TXT / TSV / CSV / XLSX 报告</strong><p>按亚马逊原始表头识别尺寸、重量和单位</p><button data-action="chooseFile">' + icon('file') + '选择文件</button><input id="fileInput" type="file" accept=".txt,.tsv,.csv,.xlsx" hidden></div><p class="dialog-tip">自动读取领星已有的 Listing 与本地商品配对关系，无需填写 SKU 对应表。<br>报告日期用于来源追溯，不代表仓库测量时间。</p>', '<button data-action="dismiss">取消</button><button class="primary" id="parseButton" data-action="parse" disabled>解析并匹配' + icon('arrow') + '</button>');
    $('importStore').value = state.currentBatch?.store.id || state.storeId;
    const chosen = file => { local.file = file; $('chosenFile').textContent = file?.name || '拖入原始报表'; $('parseButton').disabled = !file; };
    $('fileInput').addEventListener('change', e => chosen(e.target.files[0]));
    $('dropzone').addEventListener('dragover', e => { e.preventDefault(); $('dropzone').classList.add('dragging'); });
    $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
    $('dropzone').addEventListener('drop', e => { e.preventDefault(); $('dropzone').classList.remove('dragging'); chosen(e.dataTransfer.files[0]); });
  }
  function confirmDialog() {
    local.confirm = app.confirmation(); const c = local.confirm, n = c.rows.length;
    dialog('确认本批更新', '提交后将使用领星原生导入更新，随后读回核验', '<div class="confirmation-summary">' + icon('package') + '<div><strong>即将更新 <b>' + n + '</b> 个商品</strong><small>每个商品 1 组完整包装数据，共 ' + n * 4 + ' 个数值字段</small></div></div><div class="review-list"><div class="review-row"><span>目标店铺</span><b>' + esc(c.store.name) + '</b></div><div class="review-row"><span>数据来源</span><b>亚马逊费用预估 · ' + esc(c.report.reportDate) + '</b></div><div class="review-row"><span>更新模式</span><b>' + (c.mode === 'fill' ? '仅补全' : '按报告更新') + '</b></div><div class="review-row"><span>更新字段</span><b>包装长 / 宽 / 高（cm）、单品毛重（g）</b></div><div class="review-row"><span>更新位置</span><b>商品档案 → 默认箱规</b></div></div><label class="confirm-check"><input id="confirmChecked" type="checkbox"><span>已核对选中商品及本次四项更新值<small>提交前重新检查配对与现值；结果不明确时先核实。</small></span></label>', '<button data-action="dismiss">返回预览</button><button class="primary" id="executeButton" data-action="execute" disabled>提交更新 ' + n + ' 个商品' + icon('arrow') + '</button>');
    $('confirmChecked').addEventListener('change', e => { $('executeButton').disabled = !e.target.checked; });
  }
  function resolveSource() {
    const r = current(); if (!r?.conflict) return;
    dialog('选择采用的数据来源', '同一本地商品只更新一次，按完整的一组数据维护', r.sources.map((s, i) => '<label class="source-option"><input type="radio" name="source" value="' + esc(s.key) + '" ' + (!i ? 'checked' : '') + '><div><b>' + s.values.slice(0, 3).map(v => display(v, 0)).join(' × ') + ' cm · ' + display(s.values[3], 3) + ' g</b><p>第 ' + s.line + ' 行 · MSKU ' + esc(s.msku) + '</p></div></label>').join(''), '<button data-action="dismiss">返回</button><button class="primary" data-action="applySource">采用所选数据</button>');
  }
  function resolveBox() {
    const r = current(); if (!r?.product) return;
    const defaults = r.product.packs.filter(p => p.isDefault);
    dialog('确认目标箱规', '首版原生模板仅维护默认箱规，请确认其对应本次销售包装', r.product.packs.map(p => '<label class="source-option ' + (!p.isDefault ? 'disabled' : '') + '"><input type="radio" name="box" value="' + esc(p.id) + '" ' + (p.isDefault && defaults.length === 1 ? 'checked' : 'disabled') + '><div><b>' + esc(p.title) + (p.isDefault ? ' · 默认箱规' : ' · 非默认箱规') + '</b><p>' + p.old.slice(0, 3).map(v => display(v, 0)).join(' × ') + ' cm · ' + display(p.old[3], 3) + ' g</p></div></label>').join('') + (defaults.length !== 1 ? '<p class="dialog-tip">默认标记不明确，请先在领星核对销售包装与默认箱规。</p>' : ''), '<button data-action="dismiss">返回</button><button class="primary" data-action="applyBox" ' + (defaults.length !== 1 ? 'disabled' : '') + '>确认目标箱规</button>');
  }
  async function historyDialog() {
    const batches = await app.refreshHistory();
    dialog('更新记录', '仅显示当前领星账号的本地批次记录', '<div class="history-scroll">' + (batches.length ? batches.slice(0, 30).map(b => '<div class="history-card"><div><strong>' + esc(b.store.name) + ' · ' + esc(b.createdAt.slice(0, 16).replace('T', ' ')) + '</strong><p>' + b.rows.length + ' 个商品 · ' + b.rows.filter(r => r.status === 'success').length + ' 个核验通过 · ' + esc(b.reportDate) + '</p></div><button data-batch="' + esc(b.id) + '">查看' + icon('right') + '</button></div>').join('') : '<div class="history-empty">' + icon('history') + '<h3>暂无更新记录</h3><p>提交前会先保存本批意图，随后记录核验结果。</p></div>') + '</div>', '<button data-action="dismiss">关闭</button>');
  }
  function resultDetail(id) {
    const r = state.currentBatch?.rows.find(r => r.id === id); if (!r) return;
    dialog('本批更新差异', esc(r.localSku), '<div class="review-list"><div class="review-row"><span>更新前包装规格</span><b>' + r.rawOld.slice(0, 3).map(esc).join(' × ') + ' ' + esc(r.oldUnits[0]) + '</b></div><div class="review-row"><span>更新前单品毛重</span><b>' + esc(r.rawOld[3]) + ' ' + esc(r.oldUnits[1]) + '</b></div><div class="review-row"><span>本批目标规格</span><b>' + r.values.slice(0, 3).map(esc).join(' × ') + ' cm</b></div><div class="review-row"><span>本批目标毛重</span><b>' + esc(r.values[3]) + ' g</b></div></div><p class="dialog-tip">' + esc(r.message || '等待核验') + '<br>来源：亚马逊费用预估 · ' + esc(state.currentBatch.reportDate) + '<br>原始文件：' + esc(state.currentBatch.filename) + '</p>', '<button data-action="dismiss">关闭</button>');
  }
  function exportDialog() {
    if (!state.report) return;
    dialog('导出本批数据', '预览与异常清单为 CSV，原生更新文件为最小 7 列 XLSX', '<div class="export-menu"><button data-action="exportPreview">' + icon('file') + '导出全部差异预览</button><button data-action="exportIssues">' + icon('alert') + '导出待处理清单</button><button data-action="exportUpdate" ' + (!state.checked.size ? 'disabled' : '') + '>' + icon('package') + '导出已选 ' + state.checked.size + ' 个商品的原生更新表</button></div><p class="dialog-tip">原生更新表只包含本地 SKU、包装三边、单品毛重及相应单位。导出前会重新核对配对关系和现值。</p>', '<button data-action="dismiss">关闭</button>');
  }
  const actions = {
    open() { local.open = true; $('backdrop').classList.remove('hidden'); root.querySelector('.launcher').classList.add('hidden'); render(); },
    close() { local.open = false; if ($('dialog').open) $('dialog').close(); $('backdrop').classList.add('hidden'); root.querySelector('.launcher').classList.remove('hidden'); },
    dismiss: () => $('dialog').close(), import: importDialog, chooseFile: () => $('fileInput').click(),
    async parse() { const file = local.file, id = $('importStore').value, date = $('importDate').value; if (!file || !id || !date) { $('chosenFile').textContent = '请选择店铺、报告日期和文件'; return; } $('dialog').close(); local.filter = 'all'; local.search = ''; $('search').value = ''; await app.importReport(file, id, date); },
    rematch: () => app.rematch(), history: historyDialog, confirm: confirmDialog,
    async execute() { const c = local.confirm; $('dialog').close(); await app.execute(c); },
    verify: () => app.verify(state.currentBatch.id), stop: () => app.stop(), dismissError: () => app.dismissError(),
    preview: () => app.showPreview(), result() { if (state.currentBatch) app.showBatch(state.currentBatch.id); else return historyDialog(); },
    selectAll: () => app.selectAll(), clearSelection: () => app.clearSelection(), overwrite: () => app.setMode('overwrite'),
    resolveSource, resolveBox, applySource() { const r = current(), key = root.querySelector('input[name=source]:checked')?.value; if (r && key) { $('dialog').close(); app.chooseSource(r.productId, key); } },
    applyBox() { const r = current(), id = root.querySelector('input[name=box]:checked')?.value; if (r && id) { $('dialog').close(); app.chooseBox(r.productId, id); } },
    export() { if (state.view === 'result' && state.currentBatch) app.exportBatch(); else exportDialog(); }, exportPreview() { app.exportPreview(); $('dialog').close(); }, exportIssues() { app.exportPreview(true); $('dialog').close(); },
    async exportUpdate() { $('dialog').close(); await app.exportUpdate(); }, exportBatch: () => app.exportBatch(),
    mapping() { dialog('字段映射', '维护的是默认箱规中的销售包装数据', [['longest-side', '包装规格 · 长（cm）'], ['median-side', '包装规格 · 宽（cm）'], ['shortest-side', '包装规格 · 高（cm）'], [state.report?.weightField || 'item-package-weight', '单品毛重（g）']].map(([a, b]) => '<div class="mapping-mini"><span class="mono">' + esc(a) + '</span>' + icon('arrow') + '<span>' + b + '</span></div>').join('') + '<p class="dialog-tip">保留单品净重、本体规格、外箱资料与成本。</p>', '<button data-action="dismiss">知道了</button>'); },
    prev() { const i = state.records.findIndex(r => r.id === local.selected); local.selected = state.records[(i - 1 + state.records.length) % state.records.length]?.id; render(); },
    next() { const i = state.records.findIndex(r => r.id === local.selected); local.selected = state.records[(i + 1) % state.records.length]?.id; render(); }
  };
  async function invoke(action) { try { await action(); } catch (error) { if (!state.error) { state.error = String(error?.message || '操作未完成').slice(0, 220); render(); } } }
  root.addEventListener('click', e => {
    const target = e.target;
    const action = target.closest('[data-action]'); if (action) { if (!action.disabled) invoke(actions[action.dataset.action]); return; }
    if (target.closest('[data-check]')) return;
    const row = target.closest('[data-row]'); if (row) { local.selected = row.dataset.row; render(); return; }
    const resultRow = target.closest('[data-result-row]'); if (resultRow) { resultDetail(resultRow.dataset.resultRow); return; }
    const filter = target.closest('[data-filter]'); if (filter) { local.filter = filter.dataset.filter; renderList(); return; }
    const mode = target.closest('[data-mode]'); if (mode) { app.setMode(mode.dataset.mode); return; }
    const batch = target.closest('[data-batch]'); if (batch) { $('dialog').close(); invoke(() => app.showBatch(batch.dataset.batch)); }
  });
  root.addEventListener('change', e => { if (e.target.dataset.check) app.select(e.target.dataset.check, e.target.checked); });
  root.addEventListener('keydown', e => { const row = e.target.closest('[data-row]'); if (row && e.target === row && ['Enter', ' '].includes(e.key)) { e.preventDefault(); local.selected = row.dataset.row; render(); } });
  $('search').addEventListener('input', e => { local.search = e.target.value; renderList(); });
  $('store').addEventListener('change', e => invoke(() => app.selectStore(e.target.value)));
  $('reportDate').addEventListener('change', e => invoke(() => app.setDate(e.target.value)));
  const unsubscribe = app.subscribe(render);
  return { host, root, open: actions.open, close: actions.close, dispose() { unsubscribe(); host.remove(); }, setVisible(visible) { host.style.display = visible ? '' : 'none'; } };
}

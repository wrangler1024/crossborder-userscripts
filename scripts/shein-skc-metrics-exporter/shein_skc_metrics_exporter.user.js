// ==UserScript==
// @name         SHEIN 商品分析指标导出（SKC 列表）
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      0.1.0
// @description  只读采集 SHEIN 卖家后台商品分析 SKC 列表的可见指标（表头表体分离、分组表头、soui 翻页已适配），支持勾选列、拆分商品首列与自动翻页，导出 UTF-8 CSV 供 Excel 筛选汇总
// @author       大大怪将军 / Xynigo
// @match        https://sellerhub.shein.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-skc-metrics-exporter/shein_skc_metrics_exporter.user.js
// @updateURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-skc-metrics-exporter/shein_skc_metrics_exporter.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = Object.freeze({
        appId: 'xynigo-shein-skc-exporter',
        version: '0.1.0',
        minHeaderColumns: 3,
        pageIntervalMs: 1500,
        minPageIntervalMs: 300,
        maxPageIntervalMs: 10000,
        pageTurnTimeoutMs: 15000,
        pollIntervalMs: 300,
        defaultMaxPages: 50,
        maxPagesLimit: 200,
        maxRows: 20000,
        launcherPollMs: 1500,
        previewHeaderCount: 10,
        pairedBodySearchLevels: 5,
    });

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function normalizeCellText(text) {
        return String(text ?? '').replace(/\s+/g, ' ').trim();
    }

    function parseTotalCount(text) {
        const match = String(text || '').match(/共\s*([0-9][0-9,，\s]*)\s*(?:条|个|款)/);
        if (!match) return null;
        const value = Number(match[1].replace(/[,,，\s]/g, ''));
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    function extractHeaderNames(headerTexts) {
        const names = [];
        const seen = new Map();
        (headerTexts || []).forEach((text, index) => {
            let name = normalizeCellText(text) || `列${index + 1}`;
            const count = seen.get(name) || 0;
            seen.set(name, count + 1);
            if (count > 0) name = `${name}#${count + 1}`;
            names.push(name);
        });
        return names;
    }

    // 双重文本去重：SHEIN 商品单元格常见 title 属性与可见文本重复输出
    function dedupeRepeatedText(text) {
        const value = normalizeCellText(text);
        if (!value || value.length % 2 !== 0) return value;
        const half = value.slice(0, value.length / 2);
        return value.slice(value.length / 2) === half ? half : value;
    }

    function isSkippableRow(cells) {
        if (cells.length > 1) return false;
        return /^(暂无[^,，。;；]*数据|没有(找到)?[^,，。;；]*数据|no data|-.*)$/i.test(normalizeCellText(cells[0] || ''));
    }

    function splitProductCell(text) {
        const raw = normalizeCellText(text);
        // SKC 值后紧跟 SPU:/供方货号: 等键且无分隔符，需按下一字段键截断
        const skc = raw.match(/SKC[:：]\s*([A-Za-z0-9]+?)(?=SPU[:：]|供方货号[:：]|品类[:：]|备货款|$)/)?.[1] || '';
        if (!skc) return null;
        const nameRaw = raw.split(/SKC[:：]/)[0] || '';
        const spu = raw.match(/SPU[:：]\s*([A-Za-z0-9]+?)(?=供方货号[:：]|品类[:：]|备货款|SKC[:：]|$)/)?.[1] || '';
        const vendorCode = raw.match(/供方货号[:：]\s*([A-Za-z0-9]+)/)?.[1] || '';
        const categoryRaw = raw.match(/品类[:：]\s*(.+?)(?=备货款|$)/)?.[1] || '';
        const statusMatches = raw.match(/非在售|在售|下架|禁售|清仓/g) || [];
        return {
            '商品名称': dedupeRepeatedText(nameRaw),
            'SKC': skc,
            'SPU': spu,
            '供方货号': vendorCode,
            '品类': dedupeRepeatedText(categoryRaw),
            '备货款': raw.match(/备货款([A-Za-z0-9]+)/)?.[1] || '',
            '商品状态': [...new Set(statusMatches)].join('/'),
        };
    }

    const SPLIT_PRODUCT_COLUMNS = Object.freeze(['商品名称', 'SKC', 'SPU', '供方货号', '品类', '备货款', '商品状态']);

    function shouldSplitProductColumn(headers) {
        return Boolean(headers?.length && /商品|产品|SKU|SKC/i.test(headers[0]));
    }

    function applyProductCellSplit({ headers, rows, skippedRows = 0 }) {
        if (!shouldSplitProductColumn(headers)) {
            return { headers, rows, skippedRows, splitApplied: false };
        }
        const parsed = rows.map((cells) => splitProductCell(cells[0] || ''));
        if (!parsed.some(Boolean)) {
            return { headers, rows, skippedRows, splitApplied: false };
        }
        const newHeaders = [...SPLIT_PRODUCT_COLUMNS, `${headers[0]}(原始)`, ...headers.slice(1)];
        const newRows = rows.map((cells, index) => {
            const split = parsed[index] || {};
            return [
                ...SPLIT_PRODUCT_COLUMNS.map((name) => split[name] ?? ''),
                cells[0] ?? '',
                ...cells.slice(1),
            ];
        });
        return { headers: newHeaders, rows: newRows, skippedRows, splitApplied: true };
    }

    function buildTableModel({ headerTexts, rows }) {
        const headers = extractHeaderNames(headerTexts);
        if (!headers.length) {
            throw new Error('未识别到表头，无法采集');
        }
        const normalizedRows = (rows || [])
            .map((cells) => (Array.isArray(cells) ? cells.map(normalizeCellText) : []))
            .filter((cells) => cells.length > 0 && !isSkippableRow(cells));
        return { headers, rows: normalizedRows, columnCount: headers.length };
    }

    function applyColumnSelection(headers, selectedFlags) {
        const indices = [];
        (selectedFlags || []).forEach((flag, index) => {
            if (flag && index < headers.length) indices.push(index);
        });
        if (!indices.length) {
            throw new Error('请至少勾选一列指标');
        }
        return indices;
    }

    function escapeCsvCell(value) {
        let text = String(value ?? '');
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
    }

    function buildCsv({ headers, rows, selectedIndices, pageNumbers = [] }) {
        if (!headers?.length || !Array.isArray(selectedIndices) || !selectedIndices.length) {
            throw new Error('导出数据不完整：缺少表头或列选择');
        }
        const lines = [];
        lines.push(selectedIndices.map((index) => headers[index]).concat(['页码']).map(escapeCsvCell).join(','));
        (rows || []).forEach((cells, rowIndex) => {
            const values = selectedIndices.map((index) => cells[index] ?? '');
            values.push(pageNumbers[rowIndex] ?? '');
            lines.push(values.map(escapeCsvCell).join(','));
        });
        return `\uFEFF${lines.join('\n')}`;
    }

    function dedupeRows(rows) {
        const seen = new Set();
        const uniqueRows = [];
        let duplicateCount = 0;
        (rows || []).forEach((cells) => {
            const key = JSON.stringify(cells);
            if (seen.has(key)) {
                duplicateCount += 1;
                return;
            }
            seen.add(key);
            uniqueRows.push(cells);
        });
        return { rows: uniqueRows, duplicateCount };
    }

    function rowSignature(rows) {
        const list = rows || [];
        const first = (list[0] || []).slice(0, 3).join('|');
        const last = (list[list.length - 1] || []).slice(0, 3).join('|');
        return `${list.length}#${first}#${last}`;
    }

    function createOperationId(now = new Date()) {
        const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        return `SKCEXP-${stamp}-${suffix}`;
    }

    function buildExportFilename(operationId) {
        return `shein-skc-metrics-${String(operationId || 'export').toLowerCase()}.csv`;
    }

    function clampPageInterval(ms) {
        const value = Number(ms);
        if (!Number.isFinite(value)) return CONFIG.pageIntervalMs;
        return Math.min(Math.max(Math.round(value), CONFIG.minPageIntervalMs), CONFIG.maxPageIntervalMs);
    }

    function clampMaxPages(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 1) return CONFIG.defaultMaxPages;
        return Math.min(Math.round(number), CONFIG.maxPagesLimit);
    }

    // ---------- 表头网格展开（处理分组表头 colSpan/rowSpan） ----------

    function expandHeaderGrid(headRows) {
        const grid = [];
        (headRows || []).forEach((row, rowIndex) => {
            let col = 0;
            [...row.cells].forEach((cell) => {
                while (grid[rowIndex] && grid[rowIndex][col] !== undefined) col += 1;
                const colSpan = Math.max(1, Number(cell.colSpan) || 1);
                const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);
                const text = normalizeCellText(cell.textContent);
                for (let i = 0; i < colSpan; i += 1) {
                    for (let j = 0; j < rowSpan; j += 1) {
                        const r = rowIndex + j;
                        grid[r] = grid[r] || [];
                        grid[r][col + i] = text;
                    }
                }
                col += colSpan;
            });
        });
        if (!grid.length) return { names: [], columnCount: 0 };
        const columnCount = Math.max(...grid.map((r) => r.length));
        const lastRow = grid[grid.length - 1] || [];
        const names = Array.from({ length: columnCount }, (_, c) => {
            const leaf = lastRow[c];
            if (leaf !== undefined && leaf !== '') return leaf;
            for (let r = grid.length - 2; r >= 0; r -= 1) {
                const text = grid[r]?.[c];
                if (text) return text;
            }
            return `列${c + 1}`;
        });
        return { names: extractHeaderNames(names), columnCount };
    }

    // ---------- 表格识别与读取（DOM 适配层） ----------

    function tableHeaderNames(table) {
        if (!table) return null;
        if (table.tHead && table.tHead.rows.length) {
            const grid = expandHeaderGrid([...table.tHead.rows]);
            return grid.columnCount >= CONFIG.minHeaderColumns ? grid.names : null;
        }
        const first = table.querySelector('tr');
        if (first && first.querySelectorAll('th').length >= CONFIG.minHeaderColumns) {
            const grid = expandHeaderGrid([first]);
            return grid.names;
        }
        return null;
    }

    function readBodyRows(table, headerCount) {
        const rows = [];
        let skippedRows = 0;
        const minCells = Math.ceil(headerCount / 2);
        table.querySelectorAll('tbody tr').forEach((tr) => {
            const normalized = [...tr.cells].map((cell) => normalizeCellText(cell.textContent));
            if (!normalized.length || isSkippableRow(normalized) || normalized.length < minCells) {
                skippedRows += 1;
                return;
            }
            rows.push(normalized);
        });
        return { rows, skippedRows };
    }

    function readTablePage(table) {
        const headers = tableHeaderNames(table);
        if (!headers) return null;
        const body = readBodyRows(table, headers.length);
        return { headers, rows: body.rows, skippedRows: body.skippedRows };
    }

    function findPairedBodyTable(headerTable, headerCount) {
        let node = headerTable;
        for (let level = 0; node && level < CONFIG.pairedBodySearchLevels; level += 1) {
            node = node.parentElement;
            if (!node) break;
            const tables = node.querySelectorAll(':scope table');
            for (const candidate of tables) {
                if (candidate === headerTable || headerTable.contains(candidate)) continue;
                const body = readBodyRows(candidate, headerCount);
                if (body.rows.length) {
                    const counts = body.rows.map((cells) => cells.length);
                    const modal = counts.sort((a, b) => counts.filter((v) => v === a).length - counts.filter((v) => v === b).length).pop();
                    if (modal === headerCount) return candidate;
                }
            }
        }
        return null;
    }

    function findDataTableCandidates(doc) {
        const candidates = [];
        doc.querySelectorAll('table').forEach((table) => {
            const headers = tableHeaderNames(table);
            if (!headers) return;
            const ownBody = readBodyRows(table, headers.length);
            if (!ownBody.rows.length) {
                const paired = findPairedBodyTable(table, headers.length);
                if (paired) {
                    const body = readBodyRows(paired, headers.length);
                    candidates.push({
                        kind: 'split',
                        headerTable: table,
                        bodyTable: paired,
                        headers,
                        rows: body.rows,
                        skippedRows: body.skippedRows,
                        score: headers.length * body.rows.length,
                    });
                    return;
                }
            }
            candidates.push({
                kind: 'normal',
                table,
                headers,
                rows: ownBody.rows,
                skippedRows: ownBody.skippedRows,
                score: headers.length * Math.max(ownBody.rows.length, 1),
            });
        });
        candidates.sort((a, b) => b.score - a.score || b.headers.length - a.headers.length);
        return candidates;
    }

    function headerKeyOf(headers) {
        return (headers || []).join('\u0001');
    }

    function readCandidateRows(candidate, splitProductColumn) {
        const base = candidate.kind === 'split'
            ? { headers: candidate.headers, ...readBodyRows(candidate.bodyTable, candidate.headers.length) }
            : readTablePage(candidate.table);
        if (!base) return null;
        return splitProductColumn ? applyProductCellSplit(base) : { ...base, splitApplied: false };
    }

    function selectTargetTable(doc, knownHeaderKey, splitProductColumn = false) {
        const candidates = findDataTableCandidates(doc);
        if (!candidates.length) return null;
        let candidate = candidates[0];
        if (knownHeaderKey) {
            const matched = candidates.find((item) => headerKeyOf(
                splitProductColumn ? applyProductCellSplit({ headers: item.headers, rows: item.rows }).headers : item.headers,
            ) === knownHeaderKey);
            if (matched) candidate = matched;
        }
        return candidate;
    }

    // ---------- 翻页识别 ----------

    function findNextPageControls(doc) {
        const seen = new Set();
        const ordered = [];
        const push = (element) => {
            if (element && !seen.has(element)) {
                seen.add(element);
                ordered.push(element);
            }
        };
        // SHEIN 自研 soui 分页：按钮序列的最后一个按钮即“下一页”箭头
        doc.querySelectorAll('.soui-pagination-buttons').forEach((box) => {
            const buttons = [...box.querySelectorAll('button.soui-pagination-button-item')];
            if (buttons.length >= 2) push(buttons[buttons.length - 1]);
        });
        const selectors = [
            '.ant-pagination-next',
            '[class*="pagination" i] [class*="next" i]',
            '[class*="pager" i] [class*="next" i]',
            'li[class*="next" i]',
            'button[aria-label*="next" i]',
            'a[aria-label*="next" i]',
        ];
        selectors.forEach((selector) => {
            doc.querySelectorAll(selector).forEach(push);
        });
        doc.querySelectorAll('li, button, a').forEach((element) => {
            const text = normalizeCellText(element.textContent);
            if (text === '下一页' || /^next$/i.test(text)) push(element);
        });
        return ordered;
    }

    function isElementDisabled(element) {
        if (!element) return false;
        if (element.disabled === true) return true;
        if (element.closest('button[disabled], [aria-disabled="true"]')) return true;
        let node = element;
        while (node && node.nodeType === 1 && node !== node.ownerDocument.body) {
            const className = typeof node.className === 'string' ? node.className : '';
            if (/(^|\s)disabled(\s|$)/i.test(className) || /-disabled/i.test(className)) return true;
            if (node.tagName === 'UL' || node.tagName === 'NAV') break;
            node = node.parentElement;
        }
        return false;
    }

    function decideNextPage(controls) {
        const usable = (controls || []).filter((element) => !isElementDisabled(element));
        if (usable.length) return { action: 'click', control: usable[0] };
        if (controls?.length) return { action: 'last-page', control: null };
        return { action: 'no-control', control: null };
    }

    // ---------- 采集流程 ----------

    async function waitForTableChange(doc, headerKey, previousSignature, options = {}) {
        const timeoutMs = options.timeoutMs ?? CONFIG.pageTurnTimeoutMs;
        const pollIntervalMs = options.pollIntervalMs ?? CONFIG.pollIntervalMs;
        const sleepImpl = options.sleepImpl || sleep;
        const shouldStop = options.shouldStop || (() => false);
        const startedAt = options.now ? options.now() : Date.now();
        const now = options.now || (() => Date.now());
        while (now() - startedAt < timeoutMs) {
            if (shouldStop()) return { changed: false, stopped: true };
            const target = selectTargetTable(doc, headerKey, options.splitProductColumn);
            const page = target ? readCandidateRows(target, options.splitProductColumn) : null;
            if (page && rowSignature(page.rows) !== previousSignature) {
                return { changed: true, stopped: false };
            }
            await sleepImpl(pollIntervalMs);
        }
        return { changed: false, stopped: false };
    }

    async function collectTableData(options = {}) {
        const doc = options.doc;
        const mode = options.mode === 'current' ? 'current' : 'all';
        const splitProductColumn = Boolean(options.splitProductColumn);
        const maxPages = clampMaxPages(options.maxPages ?? CONFIG.defaultMaxPages);
        const pageIntervalMs = clampPageInterval(options.pageIntervalMs ?? CONFIG.pageIntervalMs);
        const shouldStop = options.shouldStop || (() => false);
        const onProgress = options.onProgress || (() => {});
        const sleepImpl = options.sleepImpl || sleep;

        const pages = [];
        let headerKey = null;
        let headers = [];
        let endReason = mode === 'current' ? 'current-page' : null;
        let stopped = false;
        let truncatedByPageLimit = false;
        let truncatedByRowLimit = false;
        let error = null;
        const collectedAt = new Date().toISOString();

        try {
            let pageNumber = 0;
            while (true) {
                if (shouldStop()) {
                    stopped = true;
                    endReason = endReason || 'stopped';
                    break;
                }
                const target = selectTargetTable(doc, headerKey, splitProductColumn);
                if (!target) {
                    throw new Error('未找到可采集的数据表格：请确认当前页面已显示列表，再点击“重新检测”');
                }
                const page = readCandidateRows(target, splitProductColumn);
                if (!page || (!page.rows.length && !pages.length)) {
                    throw new Error('数据表格结构读取失败：表头不完整或表格已变化，请重新检测');
                }
                if (!headerKey) {
                    headerKey = headerKeyOf(page.headers);
                    headers = page.headers;
                } else if (headerKeyOf(page.headers) !== headerKey) {
                    throw new Error('翻页后表头发生变化，已停止采集以避免错列数据');
                }
                pageNumber += 1;
                pages.push({ pageNumber, rows: page.rows, skippedRows: page.skippedRows });
                const totalRowsSoFar = pages.reduce((total, item) => total + item.rows.length, 0);
                onProgress({ stage: 'page-read', pageNumber, rowCount: page.rows.length, totalRowsSoFar, headerCount: page.headers.length });
                if (totalRowsSoFar >= CONFIG.maxRows) {
                    truncatedByRowLimit = true;
                    endReason = 'row-limit';
                    break;
                }
                if (mode === 'current') break;
                if (pageNumber >= maxPages) {
                    truncatedByPageLimit = true;
                    endReason = 'page-limit';
                    break;
                }
                const decision = decideNextPage(findNextPageControls(doc));
                if (decision.action !== 'click') {
                    endReason = decision.action;
                    break;
                }
                onProgress({ stage: 'page-turn', nextPageNumber: pageNumber + 1 });
                decision.control.click();
                const wait = await waitForTableChange(doc, headerKey, rowSignature(page.rows), {
                    shouldStop,
                    sleepImpl,
                    splitProductColumn,
                    timeoutMs: options.pageTurnTimeoutMs,
                    pollIntervalMs: options.pollIntervalMs,
                    now: options.now,
                });
                if (wait.stopped) {
                    stopped = true;
                    endReason = 'stopped';
                    break;
                }
                if (!wait.changed) {
                    throw new Error(`翻页后第 ${pageNumber + 1} 页内容未变化：可能已到最后一页但“下一页”仍可点，或页面翻页控件非标准结构。已采集的 ${pages.reduce((total, item) => total + item.rows.length, 0)} 行仍可导出。`);
                }
                await sleepImpl(pageIntervalMs);
            }
        } catch (caughtError) {
            error = caughtError?.message || String(caughtError);
        }

        const rowsWithPage = [];
        const pageNumbers = [];
        let skippedRowsTotal = 0;
        pages.forEach((page) => {
            page.rows.forEach((cells) => {
                rowsWithPage.push(cells);
                pageNumbers.push(page.pageNumber);
            });
            skippedRowsTotal += page.skippedRows;
        });
        const dedupe = dedupeRows(rowsWithPage);

        return {
            operationId: createOperationId(),
            collectedAt,
            mode,
            pages: pages.length,
            headers,
            rows: dedupe.rows,
            pageNumbers,
            duplicateCount: dedupe.duplicateCount,
            skippedRowsTotal,
            truncatedByPageLimit,
            truncatedByRowLimit,
            endReason,
            stopped,
            error,
        };
    }

    // ---------- 页面 UI ----------

    function mountApp() {
        installStyles();
        const state = {
            modal: null,
            elements: null,
            target: null,
            lastResult: null,
            running: false,
            stopRequested: false,
        };

        function detectTable() {
            const split = state.elements ? state.elements.splitToggle.checked : true;
            const target = selectTargetTable(document, null, split);
            state.target = target;
            return target;
        }

        function syncLauncher() {
            const launcher = document.getElementById(`${CONFIG.appId}-launcher`);
            const target = detectTable();
            const shouldShow = Boolean(target) && !state.running;
            if (shouldShow && !launcher) {
                const button = document.createElement('button');
                button.id = `${CONFIG.appId}-launcher`;
                button.type = 'button';
                button.textContent = '导出商品指标';
                button.addEventListener('click', openModal);
                document.body.appendChild(button);
            } else if (!shouldShow && launcher) {
                launcher.remove();
                if (!state.running && state.modal) state.modal.hidden = true;
            }
        }

        function openModal() {
            if (!state.modal) createModal();
            refreshTableInfo();
            state.modal.hidden = false;
            state.elements.dialog.focus();
        }

        function refreshTableInfo() {
            const target = detectTable();
            const info = state.elements.tableInfo;
            const columnsBox = state.elements.columns;
            const startButton = state.elements.startButton;
            columnsBox.replaceChildren();
            if (!target) {
                info.textContent = '未检测到可采集的数据表格：请先在后台打开“数据-商品分析-商品明细-SKC列表”并确认列表已加载。';
                startButton.disabled = true;
                return;
            }
            const split = state.elements.splitToggle.checked;
            const preview = applyProductCellSplit({ headers: target.headers, rows: target.rows });
            const previewInfo = split && preview.splitApplied ? `（已开启商品首列拆分，表头含 SKC 等提取列）` : '';
            const headerPreview = preview.headers.slice(0, CONFIG.previewHeaderCount).join('、');
            const more = preview.headers.length > CONFIG.previewHeaderCount ? ` 等 ${preview.headers.length} 列` : '';
            info.textContent = `已检测到表格：${preview.headers.length} 列 × 当前页 ${preview.rows.length} 行${previewInfo}。表头：${headerPreview}${more}`;
            preview.headers.forEach((name, index) => {
                const label = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                checkbox.dataset.columnIndex = String(index);
                label.append(checkbox, document.createTextNode(name));
                columnsBox.appendChild(label);
            });
            startButton.disabled = false;
            state.elements.result.hidden = true;
            state.elements.exportButton.hidden = true;
        }

        function setAllColumns(checked) {
            state.elements.columns.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
                checkbox.checked = checked;
            });
        }

        function selectedFlags() {
            return [...state.elements.columns.querySelectorAll('input[type="checkbox"]')]
                .sort((a, b) => Number(a.dataset.columnIndex) - Number(b.dataset.columnIndex))
                .map((checkbox) => checkbox.checked);
        }

        function setStatus(message, tone = 'neutral') {
            if (!state.elements) return;
            state.elements.status.textContent = message || '';
            state.elements.status.dataset.tone = tone;
        }

        function setFormDisabled(disabled) {
            state.elements.redetectButton.disabled = disabled;
            state.elements.selectAllButton.disabled = disabled;
            state.elements.clearButton.disabled = disabled;
            state.elements.splitToggle.disabled = disabled;
            state.elements.columns.querySelectorAll('input').forEach((input) => { input.disabled = disabled; });
            state.elements.scopeRadios.forEach((radio) => { radio.disabled = disabled; });
            state.elements.pageIntervalInput.disabled = disabled;
            state.elements.maxPagesInput.disabled = disabled;
            state.elements.startButton.disabled = disabled || !state.target;
        }

        function createModal() {
            const overlay = document.createElement('div');
            overlay.id = `${CONFIG.appId}-overlay`;
            overlay.hidden = true;
            overlay.innerHTML = `
                <section class="xse-dialog" role="dialog" aria-modal="true" aria-labelledby="xse-title" tabindex="-1">
                    <header class="xse-header">
                        <div><h2 id="xse-title">SHEIN 商品分析指标导出 <span class="xse-version">v${CONFIG.version}</span></h2><p>只读采集当前页面表格并导出 CSV，不发送任何写请求。请先在后台选好日期与指标页签。</p></div>
                        <button class="xse-icon-button" type="button" data-role="close" aria-label="关闭">×</button>
                    </header>
                    <div class="xse-body">
                        <div class="xse-field"><span>表格检测</span>
                            <div class="xse-table-info" data-role="table-info"></div>
                            <label class="xse-radio"><input type="checkbox" data-role="split-toggle" checked />拆分商品首列（提取 商品名称/SKC/SPU/供方货号/品类/备货款/状态）</label>
                            <button type="button" class="xse-secondary" data-role="redetect">重新检测</button>
                        </div>
                        <div class="xse-field"><span>导出指标（列，可多选）</span>
                            <div class="xse-column-actions">
                                <button type="button" class="xse-secondary" data-role="select-all">全选</button>
                                <button type="button" class="xse-secondary" data-role="clear-all">全不选</button>
                            </div>
                            <div class="xse-columns" data-role="columns"></div>
                        </div>
                        <div class="xse-field"><span>采集范围</span>
                            <label class="xse-radio"><input type="radio" name="xse-scope" value="current" checked />仅当前页（首次建议先用本页核对列名）</label>
                            <label class="xse-radio"><input type="radio" name="xse-scope" value="all" />自动翻页采集全部（相当于人工逐页点击“下一页”）</label>
                        </div>
                        <div class="xse-field"><span>翻页参数（仅自动翻页生效）</span>
                            <label class="xse-inline">页间隔(毫秒) <input type="number" data-role="page-interval" min="300" max="10000" step="100" value="${CONFIG.pageIntervalMs}" /></label>
                            <label class="xse-inline">最大页数 <input type="number" data-role="max-pages" min="1" max="${CONFIG.maxPagesLimit}" value="${CONFIG.defaultMaxPages}" /></label>
                        </div>
                        <div class="xse-status" data-role="status" aria-live="polite"></div>
                        <div class="xse-progress" data-role="progress" hidden><div data-role="progress-bar"></div></div>
                        <div class="xse-result" data-role="result" hidden></div>
                    </div>
                    <footer class="xse-footer">
                        <span class="xse-note">只读工具 · 不修改任何后台数据</span>
                        <span class="xse-spacer"></span>
                        <button type="button" class="xse-secondary" data-role="stop" hidden>停止采集</button>
                        <button type="button" class="xse-primary" data-role="start">开始采集</button>
                        <button type="button" class="xse-secondary" data-role="export" hidden>导出 CSV</button>
                    </footer>
                </section>`;
            document.body.appendChild(overlay);

            const query = (role) => overlay.querySelector(`[data-role="${role}"]`);
            state.modal = overlay;
            state.elements = {
                dialog: overlay.querySelector('.xse-dialog'),
                tableInfo: query('table-info'),
                splitToggle: query('split-toggle'),
                redetectButton: query('redetect'),
                columns: query('columns'),
                selectAllButton: query('select-all'),
                clearButton: query('clear-all'),
                scopeRadios: [...overlay.querySelectorAll('input[name="xse-scope"]')],
                pageIntervalInput: query('page-interval'),
                maxPagesInput: query('max-pages'),
                status: query('status'),
                progress: query('progress'),
                progressBar: query('progress-bar'),
                result: query('result'),
                startButton: query('start'),
                stopButton: query('stop'),
                exportButton: query('export'),
                closeButton: query('close'),
            };

            state.elements.closeButton.addEventListener('click', () => {
                if (state.running) {
                    window.alert('采集仍在进行。请先停止采集，等待当前页读取结束。');
                    return;
                }
                state.modal.hidden = true;
            });
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) state.elements.closeButton.click();
            });
            state.elements.redetectButton.addEventListener('click', () => {
                refreshTableInfo();
                setStatus('已重新检测表格。', 'neutral');
            });
            state.elements.splitToggle.addEventListener('change', refreshTableInfo);
            state.elements.selectAllButton.addEventListener('click', () => setAllColumns(true));
            state.elements.clearButton.addEventListener('click', () => setAllColumns(false));
            state.elements.startButton.addEventListener('click', handleStart);
            state.elements.stopButton.addEventListener('click', () => {
                state.stopRequested = true;
                state.elements.stopButton.disabled = true;
                setStatus('已请求停止：当前页读取完成后停止，已采集数据仍可导出。', 'warning');
            });
            state.elements.exportButton.addEventListener('click', exportLastResult);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && !state.modal?.hidden) state.elements.closeButton.click();
            });
            refreshTableInfo();
        }

        function describeEndReason(result) {
            switch (result.endReason) {
                case 'current-page': return '仅采集当前页';
                case 'last-page': return '已到最后一页（“下一页”不可点击）';
                case 'no-control': return '未找到“下一页”控件，按单页结束';
                case 'page-limit': return '达到本次最大页数上限';
                case 'row-limit': return `达到单次行数上限 ${CONFIG.maxRows}`;
                case 'stopped': return '用户手动停止';
                default: return result.endReason || '未知结束原因';
            }
        }

        async function handleStart() {
            if (state.running || !state.target) return;
            const split = state.elements.splitToggle.checked;
            const previewHeaders = applyProductCellSplit({ headers: state.target.headers, rows: state.target.rows }).headers;
            let selectedIndices;
            try {
                selectedIndices = applyColumnSelection(previewHeaders, selectedFlags());
            } catch (error) {
                setStatus(error.message, 'error');
                return;
            }
            const mode = state.elements.scopeRadios.find((radio) => radio.checked)?.value === 'all' ? 'all' : 'current';
            const pageIntervalMs = clampPageInterval(state.elements.pageIntervalInput.value);
            const maxPages = clampMaxPages(state.elements.maxPagesInput.value);

            state.running = true;
            state.stopRequested = false;
            setFormDisabled(true);
            state.elements.startButton.disabled = true;
            state.elements.stopButton.hidden = false;
            state.elements.stopButton.disabled = false;
            state.elements.exportButton.hidden = true;
            state.elements.result.hidden = true;
            state.elements.progress.hidden = false;
            state.elements.progressBar.style.width = '0%';
            setStatus('正在读取当前页表格…', 'working');

            const expectedTotal = parseTotalCount(document.body.textContent);
            const result = await collectTableData({
                doc: document,
                mode,
                splitProductColumn: split,
                pageIntervalMs,
                maxPages,
                shouldStop: () => state.stopRequested,
                onProgress: (event) => {
                    if (event.stage === 'page-read') {
                        setStatus(`已读取第 ${event.pageNumber} 页（本页 ${event.rowCount} 行，累计 ${event.totalRowsSoFar} 行）…`, 'working');
                        const estimate = expectedTotal ? Math.min(event.totalRowsSoFar / expectedTotal, 1) : 0;
                        state.elements.progressBar.style.width = `${Math.round(estimate * 100)}%`;
                    } else if (event.stage === 'page-turn') {
                        setStatus(`正在翻到第 ${event.nextPageNumber} 页…`, 'working');
                    }
                },
            });

            state.lastResult = { ...result, selectedIndices, expectedTotal };
            state.running = false;
            state.stopRequested = false;
            setFormDisabled(false);
            state.elements.stopButton.hidden = true;
            state.elements.progress.hidden = true;
            renderResult(state.lastResult);
            syncLauncher();
        }

        function renderResult(result) {
            const box = state.elements.result;
            box.replaceChildren();
            const title = document.createElement('h3');
            title.textContent = result.error && result.rows.length ? '采集部分完成' : (result.error ? '采集失败' : '采集完成');
            const lines = [
                `页数：${result.pages}；数据行：${result.rows.length}${result.duplicateCount ? `（另剔除整行重复 ${result.duplicateCount} 行）` : ''}；列数：${result.headers.length}。`,
                `结束原因：${describeEndReason(result)}。`,
                `预期总条数：${result.expectedTotal === null ? '未在页面识别到“共 N 条”' : `${result.expectedTotal} 条${result.expectedTotal !== result.rows.length ? '（与采集行数不一致，请核对筛选项与翻页结果）' : '（与采集行数一致）'}`}。`,
            ];
            if (result.skippedRowsTotal) lines.push(`已跳过疑似非数据行 ${result.skippedRowsTotal} 行（合并行、提示行等）。`);
            if (result.truncatedByPageLimit) lines.push('注意：因页数上限提前结束，可调大“最大页数”后重采。');
            if (result.truncatedByRowLimit) lines.push(`注意：达到单次行数上限 ${CONFIG.maxRows}，请缩小日期范围分批采集。`);
            if (result.error) lines.push(`错误信息：${result.error}`);
            lines.push('已自动追加“页码”列，便于核对采集过程。');
            const list = document.createElement('ul');
            lines.forEach((line) => {
                const item = document.createElement('li');
                item.textContent = line;
                list.appendChild(item);
            });
            const idLine = document.createElement('p');
            idLine.textContent = `采集编号：${result.operationId}（${result.collectedAt}）`;
            box.append(title, list, idLine);
            box.hidden = false;
            if (result.rows.length && result.headers.length) {
                state.elements.exportButton.hidden = false;
                setStatus(result.error ? '采集存在错误，可先导出已采集部分。' : '采集完成，可导出 CSV。', result.error ? 'warning' : 'success');
            } else {
                setStatus(result.error || '未采集到数据行。', 'error');
            }
        }

        function exportLastResult() {
            const result = state.lastResult;
            if (!result || !result.rows.length) return;
            const csv = buildCsv({
                headers: result.headers,
                rows: result.rows,
                selectedIndices: result.selectedIndices,
                pageNumbers: result.pageNumbers,
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = buildExportFilename(result.operationId);
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        syncLauncher();
        window.addEventListener('hashchange', syncLauncher);
        window.addEventListener('popstate', syncLauncher);
        setInterval(syncLauncher, CONFIG.launcherPollMs);
    }

    function installStyles() {
        const css = `
            #${CONFIG.appId}-launcher{position:fixed;top:110px;right:20px;z-index:9998;border:0;border-radius:8px;background:#0f766e;color:#fff;padding:10px 14px;font-size:14px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer}
            #${CONFIG.appId}-launcher:hover{background:#0d9488}
            #${CONFIG.appId}-overlay{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#1f2937}
            #${CONFIG.appId}-overlay[hidden]{display:none!important}
            .xse-dialog{width:min(720px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.3);outline:none}
            .xse-header{display:flex;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid #e5e7eb}.xse-header h2{margin:0 0 4px;font-size:20px}.xse-version{font-size:13px;color:#0f766e;font-weight:700}.xse-header p{margin:0;color:#6b7280;font-size:13px}
            .xse-icon-button{border:0;background:transparent;font-size:28px;line-height:1;color:#6b7280;cursor:pointer}.xse-body{padding:20px 24px}
            .xse-field{margin-bottom:16px}.xse-field>span{display:block;margin-bottom:7px;font-weight:700;font-size:13px}
            .xse-table-info{background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:8px;word-break:break-all}
            .xse-secondary{border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;background:#e5e7eb;color:#1f2937}.xse-secondary:disabled{cursor:not-allowed;opacity:.45}
            .xse-primary{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer;background:#0f766e;color:#fff}.xse-primary:disabled{cursor:not-allowed;opacity:.45}
            .xse-column-actions{display:flex;gap:8px;margin-bottom:8px}
            .xse-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;max-height:180px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;padding:10px}
            .xse-columns label{display:flex;align-items:center;gap:6px;font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.xse-columns input{margin:0;flex:none}
            .xse-radio{display:block;font-size:13px;margin:6px 0}.xse-radio input{margin:0 6px 0 0}
            .xse-inline{display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-right:16px}.xse-inline input{width:90px;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font:inherit}
            .xse-status{min-height:20px;margin-top:10px;font-size:13px}.xse-status[data-tone="error"]{color:#b91c1c}.xse-status[data-tone="warning"]{color:#b45309}.xse-status[data-tone="success"]{color:#047857}.xse-status[data-tone="working"]{color:#1d4ed8}.xse-status[data-tone="neutral"]{color:#64748b}
            .xse-progress{height:8px;margin-top:10px;overflow:hidden;border-radius:99px;background:#e5e7eb}.xse-progress>div{height:100%;width:0;background:#0f766e;transition:width .2s}
            .xse-result{background:#f0fdfa;border:1px solid #5eead4;border-radius:9px;padding:12px 14px;margin:12px 0}.xse-result h3{margin:0 0 10px;font-size:15px}.xse-result ul{margin:0;padding-left:18px}.xse-result li{margin:4px 0;font-size:13px}.xse-result p{margin:8px 0 0;font-size:12px;color:#64748b}
            .xse-footer{position:sticky;bottom:0;display:flex;align-items:center;gap:10px;padding:15px 24px;background:#fff;border-top:1px solid #e5e7eb}.xse-note{font-size:12px;color:#059669;font-weight:700}.xse-spacer{flex:1}
            @media(max-width:680px){.xse-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.xse-footer{flex-wrap:wrap}.xse-spacer{display:none}.xse-footer button{flex:1 1 44%}}
        `;
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }
    }

    const api = {
        CONFIG,
        normalizeCellText,
        parseTotalCount,
        extractHeaderNames,
        dedupeRepeatedText,
        isSkippableRow,
        splitProductCell,
        shouldSplitProductColumn,
        applyProductCellSplit,
        SPLIT_PRODUCT_COLUMNS,
        buildTableModel,
        applyColumnSelection,
        escapeCsvCell,
        buildCsv,
        dedupeRows,
        rowSignature,
        createOperationId,
        buildExportFilename,
        clampPageInterval,
        clampMaxPages,
        expandHeaderGrid,
        tableHeaderNames,
        readBodyRows,
        readTablePage,
        findPairedBodyTable,
        findDataTableCandidates,
        headerKeyOf,
        readCandidateRows,
        selectTargetTable,
        findNextPageControls,
        isElementDisabled,
        decideNextPage,
        waitForTableChange,
        collectTableData,
        mountApp,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') mountApp();
})();

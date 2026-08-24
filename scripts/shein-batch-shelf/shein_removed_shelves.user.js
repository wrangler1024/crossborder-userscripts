// ==UserScript==
// @name         SHEIN 批量上下架（安全版）
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      2.0.0
// @description  通过预览、二次确认、分批执行和真实结果汇总安全地批量上下架商品
// @author       大大怪将军 / Xynigo
// @match        https://sellerhub.shein.com/*
// @match        https://sso.geiwohuo.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-batch-shelf/shein_removed_shelves.user.js
// @updateURL    https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-batch-shelf/shein_removed_shelves.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = Object.freeze({
        appId: 'xynigo-shein-batch-shelf',
        batchSize: 50,
        batchIntervalMs: 350,
        maxRetries: 2,
        retryBaseDelayMs: 800,
        requestTimeoutMs: 30000,
        soldOutPageSize: 100,
        maxSkcCount: 5000,
        historyLimit: 10,
        historyStorageKey: 'xynigo-shein-batch-shelf-history-v2',
    });

    const ACTIONS = Object.freeze({
        LIST: Object.freeze({ key: 'LIST', label: '批量上架', verb: '上架', shelfState: 1, source: 'manual', confirmationText: '确认上架' }),
        UNLIST: Object.freeze({ key: 'UNLIST', label: '批量下架', verb: '下架', shelfState: 2, source: 'manual', confirmationText: '确认下架' }),
        UNLIST_SOLD_OUT: Object.freeze({ key: 'UNLIST_SOLD_OUT', label: '下架已售罄商品', verb: '下架', shelfState: 2, source: 'sold-out', confirmationText: '确认下架' }),
    });

    const SITE_MAPPING = Object.freeze({
        '法国站': Object.freeze({ site_abbr: 'shein-fr', store_type: 1 }),
        '西班牙站': Object.freeze({ site_abbr: 'shein-es', store_type: 1 }),
        '德国站': Object.freeze({ site_abbr: 'shein-de', store_type: 1 }),
        '意大利站': Object.freeze({ site_abbr: 'shein-it', store_type: 1 }),
        '荷兰站': Object.freeze({ site_abbr: 'shein-nl', store_type: 1 }),
        '瑞典站': Object.freeze({ site_abbr: 'shein-se', store_type: 1 }),
        '波兰站': Object.freeze({ site_abbr: 'shein-pl', store_type: 1 }),
        '葡萄牙站': Object.freeze({ site_abbr: 'shein-pt', store_type: 1 }),
        '美国站': Object.freeze({ site_abbr: 'shein-us', store_type: 1 }),
        '墨西哥站': Object.freeze({ site_abbr: 'shein-mx', store_type: 1 }),
    });

    class RequestError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'RequestError';
            this.status = options.status || 0;
            this.retryable = Boolean(options.retryable);
            this.attempts = options.attempts || 1;
            this.responseData = options.responseData;
        }
    }

    function parseSkcInput(rawInput) {
        const tokens = String(rawInput || '')
            .split(/[\s,，;；]+/)
            .map((item) => item.trim())
            .filter(Boolean);
        const skcs = [];
        const seen = new Set();
        const invalidTokens = [];

        tokens.forEach((token) => {
            if (token.length > 100) {
                invalidTokens.push(token);
                return;
            }
            if (!seen.has(token)) {
                seen.add(token);
                skcs.push(token);
            }
        });

        return {
            skcs,
            duplicateCount: tokens.length - skcs.length - invalidTokens.length,
            invalidTokens,
        };
    }

    function normalizeSkcList(items) {
        return parseSkcInput((Array.isArray(items) ? items : []).join('\n'));
    }

    function chunkItems(items, size = CONFIG.batchSize) {
        if (!Number.isInteger(size) || size <= 0) {
            throw new Error('批次大小必须是正整数');
        }
        const chunks = [];
        for (let index = 0; index < items.length; index += size) {
            chunks.push(items.slice(index, index + size));
        }
        return chunks;
    }

    function validateSiteNames(siteNames) {
        const selected = [...new Set(Array.isArray(siteNames) ? siteNames : [])];
        const unknown = selected.filter((name) => !SITE_MAPPING[name]);
        if (unknown.length) {
            throw new Error(`存在未知站点：${unknown.join('、')}`);
        }
        if (!selected.length) {
            throw new Error('请至少选择一个目标站点');
        }
        return selected;
    }

    function buildPlan({ actionKey, rawSkcs = '', soldOutSkcs = [], siteNames = [] }) {
        const action = ACTIONS[actionKey];
        if (!action) {
            throw new Error('请选择有效的操作类型');
        }
        const selectedSiteNames = validateSiteNames(siteNames);
        const parsed = action.source === 'sold-out' ? normalizeSkcList(soldOutSkcs) : parseSkcInput(rawSkcs);
        if (parsed.invalidTokens.length) {
            throw new Error(`存在超长 SKC，请检查后重试：${parsed.invalidTokens.slice(0, 3).join('、')}`);
        }
        if (!parsed.skcs.length) {
            throw new Error(action.source === 'sold-out' ? '没有读取到可下架的已售罄 SKC' : '请输入至少一个 SKC');
        }
        if (parsed.skcs.length > CONFIG.maxSkcCount) {
            throw new Error(`单次最多处理 ${CONFIG.maxSkcCount} 个 SKC，请拆分后执行`);
        }

        return {
            actionKey: action.key,
            actionLabel: action.label,
            verb: action.verb,
            shelfState: action.shelfState,
            source: action.source,
            confirmationText: action.confirmationText,
            siteNames: selectedSiteNames,
            sites: selectedSiteNames.map((name) => SITE_MAPPING[name]),
            skcs: parsed.skcs,
            duplicateCount: parsed.duplicateCount,
            batchCount: Math.ceil(parsed.skcs.length / CONFIG.batchSize),
            operationCount: parsed.skcs.length * selectedSiteNames.length,
            createdAt: new Date().toISOString(),
        };
    }

    function extractSoldOutPage(data, pageSize = CONFIG.soldOutPageSize) {
        const items = data?.info?.data;
        const totalCount = Number(data?.info?.meta?.count);
        if (!Array.isArray(items) || !Number.isFinite(totalCount) || totalCount < 0) {
            throw new RequestError('已售罄商品接口返回结构异常，已停止执行', { retryable: false, responseData: data });
        }

        const skcs = items.flatMap((item) => {
            const list = Array.isArray(item?.skc_info_list) ? item.skc_info_list : [];
            return list.map((skc) => String(skc?.skc_name || '').trim()).filter(Boolean);
        });

        return {
            skcs,
            totalCount,
            totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
        };
    }

    function isBusinessSuccess(data) {
        return String(data?.msg || '').toUpperCase() === 'OK';
    }

    function extractBusinessError(data) {
        return String(data?.info?.meta?.message || data?.info?.message || data?.message || data?.msg || '接口未返回明确的成功标识');
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function asRequestError(error, attempts = 1) {
        if (error instanceof RequestError) {
            error.attempts = attempts;
            return error;
        }
        const isAbort = error?.name === 'AbortError';
        return new RequestError(isAbort ? '请求超时' : `网络请求失败：${error?.message || String(error)}`, { retryable: true, attempts });
    }

    async function fetchJsonWithRetry(url, requestOptions = {}, options = {}) {
        const fetchImpl = options.fetchImpl || globalThis.fetch;
        const sleepImpl = options.sleepImpl || sleep;
        const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : CONFIG.maxRetries;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : CONFIG.requestTimeoutMs;
        if (typeof fetchImpl !== 'function') {
            throw new RequestError('当前环境不支持 fetch 请求', { retryable: false });
        }

        for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
            let timeoutId = null;
            let controller = null;
            try {
                if (typeof AbortController !== 'undefined' && timeoutMs > 0) {
                    controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                }
                const response = await fetchImpl(url, {
                    ...requestOptions,
                    credentials: 'include',
                    ...(controller ? { signal: controller.signal } : {}),
                });
                const responseText = await response.text();
                let data = null;
                if (responseText) {
                    try {
                        data = JSON.parse(responseText);
                    } catch (error) {
                        throw new RequestError('服务器返回了无法解析的数据', {
                            status: response.status,
                            retryable: response.status === 429 || response.status >= 500,
                        });
                    }
                }
                if (!response.ok) {
                    throw new RequestError(`请求失败（HTTP ${response.status}）`, {
                        status: response.status,
                        retryable: response.status === 429 || response.status >= 500,
                        responseData: data,
                    });
                }
                if (data === null) {
                    throw new RequestError('服务器返回了空响应', { status: response.status, retryable: false });
                }
                return { data, attempts: attempt };
            } catch (error) {
                const requestError = asRequestError(error, attempt);
                if (!requestError.retryable || attempt > maxRetries) {
                    throw requestError;
                }
                options.onRetry?.({ attempt, nextAttempt: attempt + 1, error: requestError });
                await sleepImpl(CONFIG.retryBaseDelayMs * (2 ** (attempt - 1)));
            } finally {
                if (timeoutId !== null) clearTimeout(timeoutId);
            }
        }
        throw new RequestError('请求重试次数已耗尽', { retryable: false });
    }

    async function fetchAllSoldOutSkcs(options = {}) {
        const allSkcs = [];
        let currentPage = 1;
        let totalPages = 1;

        while (currentPage <= totalPages) {
            options.onProgress?.({ currentPage, totalPages });
            const { data } = await fetchJsonWithRetry(
                `/spmp-api-prefix/spmp/product/list?page_num=${currentPage}&page_size=${CONFIG.soldOutPageSize}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        language: 'de',
                        only_recommend_resell: false,
                        only_spmb_copy_product: false,
                        search_abandon_product: false,
                        search_illegal: false,
                        search_less_inventory: false,
                        shelf_type: 'SOLD_OUT',
                        sort_type: 1,
                    }),
                },
                options,
            );
            const page = extractSoldOutPage(data);
            allSkcs.push(...page.skcs);
            totalPages = page.totalPages;
            currentPage += 1;
        }

        return normalizeSkcList(allSkcs);
    }

    async function submitShelfBatch(plan, batch, options = {}) {
        const { data, attempts } = await fetchJsonWithRetry(
            '/spmp-api-prefix/spmp/product/batch_operate_Shelf_status',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shelf_state: plan.shelfState, sites: plan.sites, skc_names: batch }),
            },
            options,
        );

        if (!isBusinessSuccess(data)) {
            throw new RequestError(extractBusinessError(data), { retryable: false, attempts, responseData: data });
        }
        return { attempts, responseMessage: String(data.msg) };
    }

    function summarizeExecution(plan, results, stopped) {
        const acceptedSkcCount = results.filter((result) => result.status === 'accepted').reduce((total, result) => total + result.skcs.length, 0);
        const failedSkcCount = results.filter((result) => result.status === 'failed').reduce((total, result) => total + result.skcs.length, 0);
        const processedSkcCount = acceptedSkcCount + failedSkcCount;
        return {
            totalSkcCount: plan.skcs.length,
            acceptedSkcCount,
            failedSkcCount,
            notExecutedSkcCount: Math.max(0, plan.skcs.length - processedSkcCount),
            acceptedBatchCount: results.filter((result) => result.status === 'accepted').length,
            failedBatchCount: results.filter((result) => result.status === 'failed').length,
            stopped: Boolean(stopped),
        };
    }

    async function executePlan(plan, options = {}) {
        const batches = chunkItems(plan.skcs);
        const results = [];
        const executor = options.executor || ((batch) => submitShelfBatch(plan, batch, options));
        let stopped = false;

        for (let index = 0; index < batches.length; index += 1) {
            if (options.shouldStop?.()) {
                stopped = true;
                break;
            }
            const batch = batches[index];
            options.onProgress?.({ stage: 'batch-start', batchIndex: index + 1, batchCount: batches.length, batch });
            try {
                const response = await executor(batch, index + 1);
                const result = {
                    batchIndex: index + 1,
                    status: 'accepted',
                    skcs: batch,
                    attempts: response?.attempts || 1,
                    responseMessage: response?.responseMessage || 'OK',
                    error: '',
                };
                results.push(result);
                options.onProgress?.({ stage: 'batch-end', result, batchIndex: index + 1, batchCount: batches.length });
            } catch (error) {
                const result = {
                    batchIndex: index + 1,
                    status: 'failed',
                    skcs: batch,
                    attempts: error?.attempts || 1,
                    responseMessage: '',
                    error: error?.message || String(error),
                };
                results.push(result);
                options.onProgress?.({ stage: 'batch-end', result, batchIndex: index + 1, batchCount: batches.length });
            }
            if (index < batches.length - 1 && !options.shouldStop?.()) {
                await (options.sleepImpl || sleep)(CONFIG.batchIntervalMs);
            }
        }

        if (options.shouldStop?.() && results.length < batches.length) stopped = true;
        return { results, summary: summarizeExecution(plan, results, stopped) };
    }

    function escapeCsvCell(value) {
        let text = String(value ?? '');
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
    }

    function buildResultCsv(record) {
        const rows = [['operation_id', 'created_at', 'action', 'sites', 'batch', 'skc', 'status', 'attempts', 'error']];
        record.results.forEach((result) => {
            result.skcs.forEach((skc) => {
                rows.push([
                    record.operationId,
                    record.createdAt,
                    record.plan.actionLabel,
                    record.plan.siteNames.join('|'),
                    result.batchIndex,
                    skc,
                    result.status === 'accepted' ? 'API已受理_待复核' : '失败',
                    result.attempts,
                    result.error,
                ]);
            });
        });
        if (record.summary.notExecutedSkcCount) {
            const processedSet = new Set(record.results.flatMap((result) => result.skcs));
            record.plan.skcs.filter((skc) => !processedSet.has(skc)).forEach((skc) => {
                rows.push([
                    record.operationId,
                    record.createdAt,
                    record.plan.actionLabel,
                    record.plan.siteNames.join('|'),
                    '',
                    skc,
                    '未执行',
                    0,
                    '用户停止或页面离开',
                ]);
            });
        }
        return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n')}`;
    }

    function createOperationId(now = new Date()) {
        const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        return `SHELF-${stamp}-${suffix}`;
    }

    function compactPlan(plan) {
        return {
            actionKey: plan.actionKey,
            actionLabel: plan.actionLabel,
            shelfState: plan.shelfState,
            source: plan.source,
            siteNames: plan.siteNames,
            skcs: plan.skcs,
            batchCount: plan.batchCount,
            operationCount: plan.operationCount,
        };
    }

    function saveOperationRecord(record, storage) {
        try {
            const targetStorage = storage || globalThis.localStorage;
            if (!targetStorage) return false;
            const history = JSON.parse(targetStorage.getItem(CONFIG.historyStorageKey) || '[]');
            const next = [record, ...(Array.isArray(history) ? history : [])].slice(0, CONFIG.historyLimit);
            targetStorage.setItem(CONFIG.historyStorageKey, JSON.stringify(next));
            return true;
        } catch (error) {
            console.warn('[SHEIN 批量上下架] 本地记录保存失败：', error);
            return false;
        }
    }

    function isTargetPage(url) {
        const value = String(url || '');
        return value.includes('/#/spmp/commdities/list') || value.includes('/#/spmp/commodities/list');
    }

    function mountApp() {
        installStyles();
        const state = {
            modal: null,
            elements: null,
            currentPlan: null,
            lastRecord: null,
            running: false,
            previewing: false,
            previewNonce: 0,
            stopRequested: false,
        };

        function syncLauncher() {
            const launcher = document.getElementById(`${CONFIG.appId}-launcher`);
            if (!isTargetPage(window.location.href)) {
                state.previewNonce += 1;
                if (state.running && !state.stopRequested) {
                    state.stopRequested = true;
                    setStatus('检测到已离开商品列表页：当前请求完成后停止后续批次。', 'warning');
                }
                if (!state.running) {
                    launcher?.remove();
                    state.currentPlan = null;
                    if (state.elements) {
                        state.elements.preview.hidden = true;
                        state.elements.confirmField.hidden = true;
                        state.elements.confirmInput.value = '';
                        state.elements.executeButton.disabled = true;
                    }
                    if (state.modal) state.modal.hidden = true;
                }
                return;
            }
            if (launcher) return;
            const button = document.createElement('button');
            button.id = `${CONFIG.appId}-launcher`;
            button.type = 'button';
            button.textContent = '安全批量上下架';
            button.addEventListener('click', openModal);
            document.body.appendChild(button);
        }

        function openModal() {
            if (!state.modal) createModal();
            state.modal.hidden = false;
            state.elements.dialog.focus();
        }

        function closeModal() {
            if (state.running) {
                window.alert('操作仍在执行。请先停止后续批次，等待当前请求结束。');
                return;
            }
            if (state.modal) state.modal.hidden = true;
        }

        function createModal() {
            const overlay = document.createElement('div');
            overlay.id = `${CONFIG.appId}-overlay`;
            overlay.hidden = true;
            overlay.innerHTML = `
                <section class="xbs-dialog" role="dialog" aria-modal="true" aria-labelledby="xbs-title" tabindex="-1">
                    <header class="xbs-header">
                        <div><h2 id="xbs-title">SHEIN 安全批量上下架</h2><p>预览不会修改商品；只有完成确认后才发送写请求。</p></div>
                        <button class="xbs-icon-button" type="button" data-role="close" aria-label="关闭">×</button>
                    </header>
                    <div class="xbs-body">
                        <label class="xbs-field"><span>操作类型</span>
                            <select data-role="action">
                                <option value="UNLIST">批量下架 · 指定 SKC</option>
                                <option value="LIST">批量上架 · 指定 SKC</option>
                                <option value="UNLIST_SOLD_OUT">批量下架 · 自动读取已售罄</option>
                            </select>
                        </label>
                        <label class="xbs-field" data-role="skc-field"><span>SKC（换行、空格、逗号或制表符分隔）</span>
                            <textarea data-role="skcs" rows="7" placeholder="每行粘贴一个 SKC；生成预览时会自动去重"></textarea>
                        </label>
                        <div class="xbs-field"><span>目标站点（默认不选）</span><div class="xbs-site-grid" data-role="sites"></div></div>
                        <div class="xbs-warning">高风险写操作：请先在测试店铺使用少量 SKC 和单一站点验收。</div>
                        <div class="xbs-preview" data-role="preview" hidden></div>
                        <label class="xbs-field xbs-confirm" data-role="confirm-field" hidden>
                            <span>输入 <strong data-role="confirm-phrase"></strong> 完成二次确认</span>
                            <input data-role="confirm-input" autocomplete="off" spellcheck="false" />
                        </label>
                        <div class="xbs-status" data-role="status" aria-live="polite"></div>
                        <div class="xbs-progress" data-role="progress" hidden><div data-role="progress-bar"></div></div>
                        <div class="xbs-result" data-role="result" hidden></div>
                    </div>
                    <footer class="xbs-footer">
                        <button type="button" class="xbs-secondary" data-role="export" hidden>导出结果 CSV</button>
                        <span class="xbs-spacer"></span>
                        <button type="button" class="xbs-secondary" data-role="stop" hidden>停止后续批次</button>
                        <button type="button" class="xbs-secondary" data-role="preview-button">生成操作预览</button>
                        <button type="button" class="xbs-danger" data-role="execute" disabled>确认并执行</button>
                    </footer>
                </section>`;
            document.body.appendChild(overlay);

            const query = (role) => overlay.querySelector(`[data-role="${role}"]`);
            state.modal = overlay;
            state.elements = {
                dialog: overlay.querySelector('.xbs-dialog'),
                action: query('action'),
                skcField: query('skc-field'),
                skcs: query('skcs'),
                sites: query('sites'),
                preview: query('preview'),
                confirmField: query('confirm-field'),
                confirmPhrase: query('confirm-phrase'),
                confirmInput: query('confirm-input'),
                status: query('status'),
                progress: query('progress'),
                progressBar: query('progress-bar'),
                result: query('result'),
                exportButton: query('export'),
                stopButton: query('stop'),
                previewButton: query('preview-button'),
                executeButton: query('execute'),
                closeButton: query('close'),
            };

            Object.keys(SITE_MAPPING).forEach((siteName) => {
                const label = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = siteName;
                label.append(checkbox, document.createTextNode(siteName));
                state.elements.sites.appendChild(label);
            });

            state.elements.closeButton.addEventListener('click', closeModal);
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) closeModal();
            });
            state.elements.action.addEventListener('change', () => {
                updateInputVisibility();
                invalidatePreview();
            });
            state.elements.skcs.addEventListener('input', invalidatePreview);
            state.elements.sites.addEventListener('change', invalidatePreview);
            state.elements.confirmInput.addEventListener('input', updateExecuteState);
            state.elements.previewButton.addEventListener('click', handlePreview);
            state.elements.executeButton.addEventListener('click', handleExecute);
            state.elements.stopButton.addEventListener('click', () => {
                state.stopRequested = true;
                state.elements.stopButton.disabled = true;
                setStatus('已请求停止：当前批次仍会等待明确结果，之后不再发送新批次。', 'warning');
            });
            state.elements.exportButton.addEventListener('click', exportLastResult);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && !state.modal?.hidden) closeModal();
            });
            updateInputVisibility();
        }

        function selectedSiteNames() {
            return [...state.elements.sites.querySelectorAll('input:checked')].map((item) => item.value);
        }

        function updateInputVisibility() {
            const action = ACTIONS[state.elements.action.value];
            state.elements.skcField.hidden = action?.source === 'sold-out';
        }

        function invalidatePreview() {
            if (state.running || state.previewing) return;
            state.currentPlan = null;
            state.elements.preview.hidden = true;
            state.elements.confirmField.hidden = true;
            state.elements.confirmInput.value = '';
            state.elements.executeButton.disabled = true;
            state.elements.result.hidden = true;
            state.elements.exportButton.hidden = true;
            setStatus('输入或站点已变化，请重新生成操作预览。', 'neutral');
        }

        function setFormDisabled(disabled) {
            state.elements.action.disabled = disabled;
            state.elements.skcs.disabled = disabled;
            state.elements.sites.querySelectorAll('input').forEach((input) => { input.disabled = disabled; });
            state.elements.previewButton.disabled = disabled;
        }

        function setStatus(message, tone = 'neutral') {
            if (!state.elements) return;
            state.elements.status.textContent = message || '';
            state.elements.status.dataset.tone = tone;
        }

        function renderPreview(plan) {
            const preview = state.elements.preview;
            preview.replaceChildren();
            const title = document.createElement('h3');
            title.textContent = '操作预览（尚未发送写请求）';
            const stats = document.createElement('dl');
            [
                ['操作', plan.actionLabel],
                ['SKC', `${plan.skcs.length} 个${plan.duplicateCount ? `（已去重 ${plan.duplicateCount} 个）` : ''}`],
                ['站点', `${plan.siteNames.length} 个：${plan.siteNames.join('、')}`],
                ['影响组合', `${plan.operationCount} 个 SKC × 站点组合`],
                ['批次', `${plan.batchCount} 批，每批最多 ${CONFIG.batchSize} 个 SKC`],
            ].forEach(([label, value]) => {
                const dt = document.createElement('dt');
                const dd = document.createElement('dd');
                dt.textContent = label;
                dd.textContent = value;
                stats.append(dt, dd);
            });
            const sample = document.createElement('p');
            sample.className = 'xbs-sample';
            sample.textContent = `SKC 示例：${plan.skcs.slice(0, 12).join('、')}${plan.skcs.length > 12 ? '…' : ''}`;
            const caveat = document.createElement('p');
            caveat.className = 'xbs-caveat';
            caveat.textContent = '接口返回 OK 只记为“API 已受理”，不代表每个 SKC 的最终状态已经逐条复核。';
            preview.append(title, stats, sample, caveat);
            preview.hidden = false;
            state.elements.confirmPhrase.textContent = plan.confirmationText;
            state.elements.confirmField.hidden = false;
            state.elements.confirmInput.value = '';
            state.elements.confirmInput.focus();
            updateExecuteState();
        }

        function updateExecuteState() {
            state.elements.executeButton.disabled = !state.currentPlan
                || state.running
                || state.elements.confirmInput.value.trim() !== state.currentPlan.confirmationText;
        }

        async function handlePreview() {
            if (state.running || state.previewing) return;
            const previewNonce = state.previewNonce + 1;
            state.previewNonce = previewNonce;
            state.previewing = true;
            setFormDisabled(true);
            state.elements.executeButton.disabled = true;
            state.elements.result.hidden = true;
            state.elements.exportButton.hidden = true;
            state.currentPlan = null;
            try {
                const actionKey = state.elements.action.value;
                const siteNames = validateSiteNames(selectedSiteNames());
                let soldOutSkcs = [];
                let soldOutDuplicateCount = 0;
                if (ACTIONS[actionKey].source === 'sold-out') {
                    setStatus('正在只读获取已售罄商品，任意分页失败都会中止预览…', 'working');
                    const soldOut = await fetchAllSoldOutSkcs({
                        onProgress: ({ currentPage, totalPages }) => {
                            setStatus(`正在读取已售罄商品：第 ${currentPage}/${Math.max(totalPages, 1)} 页…`, 'working');
                        },
                    });
                    soldOutSkcs = soldOut.skcs;
                    soldOutDuplicateCount = soldOut.duplicateCount;
                }
                if (previewNonce !== state.previewNonce || !isTargetPage(window.location.href)) {
                    throw new Error('页面已变化，本次预览已作废，请返回商品列表页重新生成');
                }
                const plan = buildPlan({ actionKey, rawSkcs: state.elements.skcs.value, soldOutSkcs, siteNames });
                if (soldOutDuplicateCount) plan.duplicateCount = soldOutDuplicateCount;
                state.currentPlan = plan;
                renderPreview(plan);
                setStatus('预览已生成。核对无误后输入确认词，再点击“确认并执行”。', 'success');
            } catch (error) {
                state.elements.preview.hidden = true;
                state.elements.confirmField.hidden = true;
                setStatus(error?.message || String(error), 'error');
            } finally {
                state.previewing = false;
                setFormDisabled(false);
            }
        }

        async function handleExecute() {
            const plan = state.currentPlan;
            if (!plan || state.running) return;
            if (state.elements.confirmInput.value.trim() !== plan.confirmationText) {
                setStatus(`请输入“${plan.confirmationText}”后再执行。`, 'error');
                return;
            }

            state.running = true;
            state.stopRequested = false;
            setFormDisabled(true);
            state.elements.confirmInput.disabled = true;
            state.elements.executeButton.disabled = true;
            state.elements.stopButton.hidden = false;
            state.elements.stopButton.disabled = false;
            state.elements.exportButton.hidden = true;
            state.elements.result.hidden = true;
            state.elements.progress.hidden = false;
            state.elements.progressBar.style.width = '0%';
            const operationId = createOperationId();
            const createdAt = new Date().toISOString();
            setStatus(`操作 ${operationId} 已开始，尚未执行任何批次。`, 'working');

            try {
                const execution = await executePlan(plan, {
                    shouldStop: () => state.stopRequested,
                    onRetry: ({ nextAttempt, error }) => {
                        setStatus(`请求失败，准备第 ${nextAttempt} 次尝试：${error.message}`, 'warning');
                    },
                    onProgress: (event) => {
                        if (event.stage === 'batch-start') {
                            const start = (event.batchIndex - 1) * CONFIG.batchSize + 1;
                            const end = start + event.batch.length - 1;
                            setStatus(`正在${plan.verb}第 ${start}–${end} 个 SKC（批次 ${event.batchIndex}/${event.batchCount}）…`, 'working');
                            state.elements.progressBar.style.width = `${((event.batchIndex - 1) / event.batchCount) * 100}%`;
                        } else if (event.stage === 'batch-end') {
                            state.elements.progressBar.style.width = `${(event.batchIndex / event.batchCount) * 100}%`;
                            const resultText = event.result.status === 'accepted' ? 'API 已受理' : `失败：${event.result.error}`;
                            setStatus(`批次 ${event.batchIndex}/${event.batchCount} ${resultText}`, event.result.status === 'accepted' ? 'working' : 'warning');
                        }
                    },
                });
                const record = {
                    operationId,
                    createdAt,
                    completedAt: new Date().toISOString(),
                    plan: compactPlan(plan),
                    results: execution.results,
                    summary: execution.summary,
                };
                state.lastRecord = record;
                saveOperationRecord(record);
                renderResult(record);
            } catch (error) {
                setStatus(`执行器异常终止：${error?.message || String(error)}`, 'error');
            } finally {
                state.running = false;
                state.stopRequested = false;
                state.currentPlan = null;
                setFormDisabled(false);
                state.elements.confirmInput.disabled = false;
                state.elements.confirmInput.value = '';
                state.elements.confirmField.hidden = true;
                state.elements.stopButton.hidden = true;
                state.elements.progress.hidden = true;
                state.elements.executeButton.disabled = true;
                syncLauncher();
            }
        }

        function renderResult(record) {
            const { summary } = record;
            const result = state.elements.result;
            result.replaceChildren();
            const title = document.createElement('h3');
            title.textContent = summary.stopped ? '操作已停止' : '批次执行结束';
            const line = document.createElement('p');
            line.textContent = `API 已受理 ${summary.acceptedSkcCount} 个，失败 ${summary.failedSkcCount} 个，未执行 ${summary.notExecutedSkcCount} 个。`;
            const idLine = document.createElement('p');
            idLine.textContent = `操作编号：${record.operationId}`;
            const caveat = document.createElement('p');
            caveat.className = 'xbs-caveat';
            caveat.textContent = '“API 已受理”不等于商品最终状态已逐条复核，请在 SHEIN 后台抽查后再扩大批量。';
            result.append(title, line, idLine, caveat);
            result.hidden = false;
            state.elements.exportButton.hidden = false;
            const tone = summary.failedSkcCount || summary.notExecutedSkcCount ? 'warning' : 'success';
            setStatus(summary.stopped ? '已停止发送后续批次，结果可导出。' : '所有批次已处理，结果可导出。', tone);
        }

        function exportLastResult() {
            if (!state.lastRecord) return;
            const csv = buildResultCsv(state.lastRecord);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `shein-batch-shelf-${state.lastRecord.operationId}.csv`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        syncLauncher();
        window.addEventListener('hashchange', syncLauncher);
        window.addEventListener('popstate', syncLauncher);
        setInterval(syncLauncher, 1500);
    }

    function installStyles() {
        const css = `
            #${CONFIG.appId}-launcher{position:fixed;top:60px;right:20px;z-index:9998;border:0;border-radius:8px;background:#f59e0b;color:#1f2937;padding:10px 14px;font-size:14px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer}
            #${CONFIG.appId}-launcher:hover{background:#fbbf24}
            #${CONFIG.appId}-overlay{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#1f2937}
            #${CONFIG.appId}-overlay[hidden]{display:none!important}
            .xbs-dialog{width:min(760px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.3);outline:none}
            .xbs-header{display:flex;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid #e5e7eb}.xbs-header h2{margin:0 0 4px;font-size:21px}.xbs-header p{margin:0;color:#6b7280;font-size:13px}
            .xbs-icon-button{border:0;background:transparent;font-size:28px;line-height:1;color:#6b7280;cursor:pointer}.xbs-body{padding:20px 24px}.xbs-field{display:block;margin-bottom:16px}.xbs-field>span{display:block;margin-bottom:7px;font-weight:700;font-size:13px}.xbs-field select,.xbs-field textarea,.xbs-confirm input{box-sizing:border-box;width:100%;border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;font:inherit;background:#fff}.xbs-field textarea{resize:vertical;min-height:110px}.xbs-field select:focus,.xbs-field textarea:focus,.xbs-confirm input:focus{outline:2px solid #fbbf24;border-color:#f59e0b}
            .xbs-site-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.xbs-site-grid label{display:flex;align-items:center;gap:6px;padding:8px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px}.xbs-site-grid input{margin:0}
            .xbs-warning,.xbs-preview,.xbs-result{border-radius:9px;padding:12px 14px;margin:12px 0}.xbs-warning{background:#fff7ed;border:1px solid #fdba74;color:#9a3412;font-weight:700}.xbs-preview{background:#f8fafc;border:1px solid #cbd5e1}.xbs-preview h3,.xbs-result h3{margin:0 0 10px;font-size:15px}.xbs-preview dl{display:grid;grid-template-columns:90px 1fr;gap:5px 12px;margin:0}.xbs-preview dt{font-weight:700;color:#475569}.xbs-preview dd{margin:0}.xbs-sample{word-break:break-all;color:#475569}.xbs-caveat{color:#b45309;font-weight:700}.xbs-confirm{padding:12px;border:1px solid #fca5a5;border-radius:9px;background:#fef2f2}.xbs-confirm strong{color:#b91c1c}
            .xbs-status{min-height:20px;margin-top:12px;font-size:13px}.xbs-status[data-tone="error"]{color:#b91c1c}.xbs-status[data-tone="warning"]{color:#b45309}.xbs-status[data-tone="success"]{color:#047857}.xbs-status[data-tone="working"]{color:#1d4ed8}.xbs-status[data-tone="neutral"]{color:#64748b}
            .xbs-progress{height:8px;margin-top:10px;overflow:hidden;border-radius:99px;background:#e5e7eb}.xbs-progress>div{height:100%;width:0;background:#f59e0b;transition:width .2s}.xbs-result{background:#f0fdf4;border:1px solid #86efac}.xbs-result p{margin:5px 0}
            .xbs-footer{position:sticky;bottom:0;display:flex;align-items:center;gap:10px;padding:15px 24px;background:#fff;border-top:1px solid #e5e7eb}.xbs-footer button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}.xbs-footer button:disabled{cursor:not-allowed;opacity:.45}.xbs-secondary{background:#e5e7eb;color:#1f2937}.xbs-danger{background:#dc2626;color:#fff}.xbs-spacer{flex:1}
            @media(max-width:680px){.xbs-site-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.xbs-footer{flex-wrap:wrap}.xbs-spacer{display:none}.xbs-footer button{flex:1 1 44%}}
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
        ACTIONS,
        SITE_MAPPING,
        RequestError,
        parseSkcInput,
        normalizeSkcList,
        chunkItems,
        validateSiteNames,
        buildPlan,
        extractSoldOutPage,
        isBusinessSuccess,
        extractBusinessError,
        fetchJsonWithRetry,
        fetchAllSoldOutSkcs,
        submitShelfBatch,
        summarizeExecution,
        executePlan,
        escapeCsvCell,
        buildResultCsv,
        createOperationId,
        compactPlan,
        saveOperationRecord,
        isTargetPage,
        mountApp,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') mountApp();
})();

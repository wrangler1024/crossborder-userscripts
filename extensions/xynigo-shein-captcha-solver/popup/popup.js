'use strict';

// 弹窗：模型配置 + 连通性测试 + 实时统计 + 双模型对比汇总 + 样本回放评测。
(function bootPopup(root) {
    const Config = root.XynigoCaptchaConfig;
    const Puzzle = root.XynigoCaptchaPuzzle;
    const Stats = root.XynigoCaptchaStats;
    if (!Config || !Puzzle || !Stats || typeof chrome === 'undefined' || !chrome.runtime) return;
    Stats.setScoreAnswer(Puzzle.scoreAnswer);

    const $ = (id) => document.getElementById(id);
    const PRESETS = Config.PROVIDER_PRESETS;

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response || response.ok === false) {
                    reject(new Error((response && response.error) || 'background 响应异常'));
                    return;
                }
                resolve(response);
            });
        });
    }

    function fillProviderSelect(select) {
        select.innerHTML = '';
        Object.keys(PRESETS).forEach((key) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = PRESETS[key].label;
            select.appendChild(option);
        });
    }

    function prefixedId(prefix, suffix) {
        if (prefix) return prefix + suffix;
        return suffix.charAt(0).toLowerCase() + suffix.slice(1);
    }

    function applyPreset(prefix) {
        const provider = $(prefixedId(prefix, 'Provider')).value;
        const preset = PRESETS[provider];
        $(prefixedId(prefix, 'BaseUrl')).value = preset.baseUrl || '';
        $(prefixedId(prefix, 'Model')).value = preset.models[0] || '';
        const datalist = $(prefix === '' ? 'modelList' : 'compareModelList');
        datalist.innerHTML = '';
        preset.models.forEach((model) => {
            const option = document.createElement('option');
            option.value = model;
            datalist.appendChild(option);
        });
        if (prefix === '') $('keyHint').textContent = preset.keyHint || '';
    }

    function fillForm(config) {
        $('provider').value = config.provider;
        $('baseUrl').value = config.baseUrl;
        $('model').value = config.model;
        $('apiKey').value = config.apiKey;
        applyPreset('');
        $('model').value = config.model; // applyPreset 覆盖后回填用户选择。
        $('autoSolve').checked = config.autoSolve !== false;
        $('compareEnabled').checked = Boolean(config.compareEnabled);
        $('compareProvider').value = config.compare.provider;
        $('compareBaseUrl').value = config.compare.baseUrl;
        $('compareModel').value = config.compare.model;
        $('compareApiKey').value = config.compare.apiKey;
        applyPreset('compare');
        $('compareModel').value = config.compare.model;
        $('collectSamples').checked = config.collectSamples !== false;
        $('maxSamples').value = config.maxSamples;
        $('compareFields').classList.toggle('off', !config.compareEnabled);
        $('compareDetails').open = Boolean(config.compareEnabled);
        renderConfigState(config);
    }

    function renderConfigState(config) {
        const chip = $('configState');
        const stateText = $('configStateText');
        $('activeModelLabel').textContent = config.model || '—';
        if (!config.apiKey) {
            chip.dataset.kind = 'error';
            stateText.textContent = 'API Key 待配置';
        } else if (config.autoSolve === false) {
            chip.dataset.kind = 'warning';
            stateText.textContent = '自动解题已关闭';
        } else {
            chip.dataset.kind = 'success';
            stateText.textContent = '自动解题已开启';
        }
    }

    function collectConfig() {
        return Config.normalizeConfig({
            provider: $('provider').value,
            baseUrl: $('baseUrl').value.trim(),
            model: $('model').value.trim(),
            apiKey: $('apiKey').value.trim(),
            autoSolve: $('autoSolve').checked,
            compareEnabled: $('compareEnabled').checked,
            compareProvider: $('compareProvider').value,
            compareBaseUrl: $('compareBaseUrl').value.trim(),
            compareModel: $('compareModel').value.trim(),
            compareApiKey: $('compareApiKey').value.trim(),
            collectSamples: $('collectSamples').checked,
            maxSamples: Number($('maxSamples').value),
        });
    }

    function setStatus(text, isError) {
        const status = $('status');
        status.textContent = text;
        status.classList.toggle('error', Boolean(isError));
        setTimeout(() => { status.textContent = ''; }, 15000); // 结果保留 15 秒，避免闪没。
    }

    async function ensureCustomOriginPermission(config) {
        const targets = [config, Config.effectiveCompareConfig(config)];
        for (const target of targets) {
            const preset = PRESETS[target.provider];
            if (preset && target.provider !== 'custom') continue;
            if (!target.baseUrl) continue;
            let origin;
            try { origin = new URL(target.baseUrl).origin + '/*'; } catch (_error) { continue; }
            const granted = await chrome.permissions.contains({ origins: [origin] });
            if (!granted) await chrome.permissions.request({ origins: [origin] });
        }
    }

    function renderStats(logs, sampleCount) {
        const tbody = $('statsTable').querySelector('tbody');
        tbody.innerHTML = '';
        const rows = Stats.aggregateSolves(logs);
        $('statsEmpty').classList.toggle('hidden', rows.length > 0);
        rows.forEach((row) => {
            const tr = document.createElement('tr');
            [row.model, row.attempts, row.pass, row.fail, row.error,
                row.passRate == null ? '—' : row.passRate + '%',
                row.avgLatencyMs == null ? '—' : row.avgLatencyMs + 'ms'].forEach((value) => {
                const td = document.createElement('td');
                td.textContent = String(value);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        const pair = Stats.pairCompare(logs);
        $('pairSummary').textContent = pair.pairs
            ? `双模型配对：${pair.pairs} 组，答案一致率 ${pair.agreeRate}%（不一致 ${pair.disagree} 组），主模型过验率 ${pair.primaryPassRate}%`
            : '双模型配对：暂无配对数据（开启对比模式后自动积累）。';
        $('sampleCount').textContent = `当前样本 ${sampleCount} 条。`;
    }

    function renderReplay(summary) {
        const table = $('replayTable');
        table.classList.remove('hidden');
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';
        summary.rows.forEach((row) => {
            const tr = document.createElement('tr');
            const cells = [
                row.sampleId.slice(-6),
                row.groundTruth.join(',') || '—',
                row.answer.join(',') || '—',
                row.ok ? (row.exact ? '✔' : '✘') : '错误',
                Math.round(row.precision * 100) + '%',
                Math.round(row.recall * 100) + '%',
                row.latencyMs + 'ms',
            ];
            cells.forEach((value, index) => {
                const td = document.createElement('td');
                td.textContent = String(value);
                if (index === 3 && row.ok) td.className = row.exact ? 'pass' : 'fail';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        $('replaySummary').textContent = `回放完成：${summary.n} 条样本，全对率 ${summary.exactRate}%，格子查准 ${summary.avgPrecision}%，查全 ${summary.avgRecall}%，平均耗时 ${summary.avgLatencyMs == null ? '—' : summary.avgLatencyMs + 'ms'}。`;
    }

    async function loadAll() {
        const response = await sendMessage({ type: 'captchaGetAll' });
        fillForm(response.config);
        renderStats(response.logs, response.samples.length);
        return response;
    }

    // Comet 会把 popup 保留为长期存活的独立窗口：页面解题期间日志/配置已变，
    // 旧窗口却不会重跑启动逻辑。用轻量防抖在 storage 变化、窗口获焦时重新读取。
    let refreshTimer = null;
    function scheduleLoadAll() {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            loadAll().catch((error) => setStatus('刷新状态失败：' + error.message, true));
        }, 120);
    }
    if (chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
        chrome.storage.onChanged.addListener((_changes, areaName) => {
            if (areaName === 'local') scheduleLoadAll();
        });
    }
    window.addEventListener('focus', scheduleLoadAll);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleLoadAll();
    });

    $('save').addEventListener('click', async () => {
        try {
            const config = collectConfig();
            if (!config.apiKey) { setStatus('API Key 不能为空', true); return; }
            await ensureCustomOriginPermission(config);
            await sendMessage({ type: 'captchaSaveConfig', config });
            setStatus('已保存 ✔');
        } catch (error) {
            setStatus('保存失败：' + error.message, true);
        }
    });

    $('test').addEventListener('click', async () => {
        try {
            setStatus('测试中…');
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#e02020';
            ctx.fillRect(0, 0, 16, 16);
            const response = await sendMessage({
                type: 'captchaTestConnection',
                config: collectConfig(),
                image: canvas.toDataURL('image/png'),
                prompt: 'Reply with OK.',
            });
            setStatus(response.ok ? `连通 ✔（${response.latencyMs}ms）` : `失败：${response.error}`, !response.ok);
        } catch (error) {
            setStatus('测试失败：' + error.message, true);
        }
    });

    $('compareEnabled').addEventListener('change', (event) => {
        $('compareFields').classList.toggle('off', !event.target.checked);
        if (event.target.checked) $('compareDetails').open = true;
    });
    $('provider').addEventListener('change', () => applyPreset(''));
    $('compareProvider').addEventListener('change', () => applyPreset('compare'));

    $('clearSamples').addEventListener('click', async () => {
        await sendMessage({ type: 'captchaClear', target: 'samples' });
        await loadAll();
        setStatus('样本已清空');
    });
    $('clearLogs').addEventListener('click', async () => {
        await sendMessage({ type: 'captchaClear', target: 'logs' });
        await loadAll();
        setStatus('日志已清空');
    });

    $('replay').addEventListener('click', async () => {
        try {
            $('replay').disabled = true;
            $('replaySummary').textContent = '回放中…';
            const response = await sendMessage({ type: 'captchaGetAll' });
            const samples = response.samples;
            if (!samples.length) {
                $('replaySummary').textContent = '暂无样本：先开启样本采集，等验证码真实过验后积累。';
                return;
            }
            const entries = [];
            for (const sample of samples) {
                const result = await sendMessage({
                    type: 'captchaSolve',
                    image: sample.image,
                    prompt: sample.prompt || Puzzle.PROMPT,
                    configOverride: response.config,
                });
                entries.push({ sample, result: result.primary });
                await new Promise((resolve) => setTimeout(resolve, 300)); // 轻微节流。
            }
            renderReplay(Stats.scoreReplay(entries));
        } catch (error) {
            $('replaySummary').textContent = '回放失败：' + error.message;
        } finally {
            $('replay').disabled = false;
        }
    });

    $('export').addEventListener('click', async () => {
        const response = await sendMessage({ type: 'captchaGetAll' });
        const payload = { exportedAt: new Date().toISOString(), logs: response.logs, samples: response.samples.map((s) => ({ id: s.id, groundTruth: s.groundTruth })) };
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        setStatus('统计 JSON 已复制到剪贴板');
    });

    // 先同步填入 Provider 选项与默认配置：storage 读取慢或失败时表单也不再空白，
    // 避免在空表单上保存出半空配置（2026-08-28 空白表单事故的修复）。
    fillProviderSelect($('provider'));
    fillProviderSelect($('compareProvider'));
    fillForm(Config.normalizeConfig({}));

    $('version').textContent = 'v' + chrome.runtime.getManifest().version;
    loadAll().catch((error) => setStatus('加载失败：' + error.message, true));
})(typeof globalThis !== 'undefined' ? globalThis : this);

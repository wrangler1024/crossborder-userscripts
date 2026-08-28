'use strict';

// 扩展端接线：chrome.runtime 桥接 background（取图/识别/落库），启动解题 agent。
(function bootCaptchaContent(root) {
    const agentFactory = root.XynigoCaptchaAgent;
    if (!agentFactory || typeof chrome === 'undefined' || !chrome.runtime) return;

    const isTopFrame = (() => {
        try { return typeof window !== 'undefined' && window.top === window; } catch (_error) { return true; }
    })();

    // 页内常驻状态卡：用 Shadow DOM 隔离 SHEIN 样式，让用户不开 DevTools 也能看到
    // “等待 / 配置异常 / 识别 / 点击 / 成功 / 失败”。all_frames 下仅顶层页显示，避免 iframe 重复。
    function createPageStatus() {
        if (!isTopFrame || typeof document === 'undefined') return { update() {} };

        const HOST_ID = 'xynigo-captcha-status-host';
        const version = (() => {
            try { return chrome.runtime.getManifest().version; } catch (_error) { return '?'; }
        })();
        let host = null;
        let card = null;
        let message = null;
        let toggle = null;
        let collapsed = false;

        function mount() {
            if (host && host.isConnected) return;
            if (!host) {
                host = document.createElement('div');
                host.id = HOST_ID;
                host.setAttribute('data-xynigo-owner', 'captcha-solver');
                host.setAttribute('style', [
                    'all:initial!important',
                    'position:fixed!important',
                    'right:16px!important',
                    'bottom:16px!important',
                    'z-index:2147483647!important',
                    'display:block!important',
                    'pointer-events:none!important',
                ].join(';'));
                const shadow = host.attachShadow({ mode: 'open' });
                const style = document.createElement('style');
                style.textContent = `
                    * { box-sizing: border-box; }
                    .card {
                        --accent: #0f766e;
                        width: min(320px, calc(100vw - 32px));
                        padding: 11px 12px;
                        border: 1px solid rgba(255,255,255,.18);
                        border-left: 4px solid var(--accent);
                        border-radius: 10px;
                        background: rgba(15, 23, 42, .94);
                        box-shadow: 0 10px 30px rgba(15, 23, 42, .28);
                        color: #f8fafc;
                        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                        pointer-events: auto;
                        backdrop-filter: blur(8px);
                    }
                    .card[data-kind="working"] { --accent: #3b82f6; }
                    .card[data-kind="success"] { --accent: #22c55e; }
                    .card[data-kind="warning"] { --accent: #f59e0b; }
                    .card[data-kind="error"] { --accent: #ef4444; }
                    .head { display: flex; align-items: center; gap: 8px; min-width: 0; }
                    .dot { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
                    .title { flex: 1; min-width: 0; font-weight: 700; letter-spacing: .01em; }
                    .version { color: #94a3b8; font-size: 11px; font-weight: 500; }
                    .toggle { border: 0; padding: 0 2px; background: transparent; color: #cbd5e1; font: 700 16px/1 sans-serif; cursor: pointer; }
                    .message { margin-top: 6px; color: #e2e8f0; overflow-wrap: anywhere; }
                    .card.collapsed { width: auto; min-width: 158px; padding: 9px 10px; }
                    .card.collapsed .message, .card.collapsed .version { display: none; }
                `;
                card = document.createElement('div');
                card.className = 'card';
                card.dataset.kind = 'working';
                card.setAttribute('role', 'status');
                card.setAttribute('aria-live', 'polite');
                const head = document.createElement('div');
                head.className = 'head';
                const dot = document.createElement('span');
                dot.className = 'dot';
                const title = document.createElement('span');
                title.className = 'title';
                title.textContent = 'Xynigo 验证码插件';
                const versionNode = document.createElement('span');
                versionNode.className = 'version';
                versionNode.textContent = 'v' + version;
                toggle = document.createElement('button');
                toggle.className = 'toggle';
                toggle.type = 'button';
                toggle.textContent = '−';
                toggle.setAttribute('aria-label', '收起验证码插件状态');
                toggle.addEventListener('click', () => {
                    collapsed = !collapsed;
                    card.classList.toggle('collapsed', collapsed);
                    toggle.textContent = collapsed ? '+' : '−';
                    toggle.setAttribute('aria-label', collapsed ? '展开验证码插件状态' : '收起验证码插件状态');
                });
                message = document.createElement('div');
                message.className = 'message';
                message.textContent = '插件正在初始化…';
                head.append(dot, title, versionNode, toggle);
                card.append(head, message);
                shadow.append(style, card);
            }
            (document.documentElement || document.body).appendChild(host);
        }

        function printable(value) {
            if (typeof value === 'string') return value;
            try { return JSON.stringify(value); } catch (_error) { return String(value); }
        }

        function update(kind, ...parts) {
            mount();
            const nextKind = ['ready', 'working', 'success', 'warning', 'error'].includes(kind) ? kind : 'ready';
            card.dataset.kind = nextKind;
            host.setAttribute('data-status', nextKind);
            message.textContent = parts.map(printable).filter(Boolean).join(' ').slice(0, 240) || '等待验证码…';
        }

        mount();
        return { update };
    }

    const pageStatus = createPageStatus();
    pageStatus.update('working', '插件正在初始化…');

    function statusKind(parts, warning) {
        const text = parts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join(' ');
        if (/已通过/.test(text)) return 'success';
        if (warning) return /失败|错误|无效|未配置|未找到|停止|超时/.test(text) ? 'error' : 'warning';
        if (/检测到|开始处理|识别|点击|迁移/.test(text)) return 'working';
        return 'ready';
    }

    const pageLog = (...args) => {
        pageStatus.update(statusKind(args, false), ...args);
        console.log('[XynigoCaptchaSolver]', ...args);
    };
    const pageWarn = (...args) => {
        pageStatus.update(statusKind(args, true), ...args);
        console.warn('[XynigoCaptchaSolver]', ...args);
    };

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

    const bridge = {
        getConfig: async () => {
            const response = await sendMessage({ type: 'captchaGetConfig' });
            return response.config;
        },
        fetchImage: async (url) => {
            const response = await sendMessage({ type: 'captchaFetchImage', url });
            return response.dataUrl;
        },
        solve: async (image, prompt) => await sendMessage({ type: 'captchaSolve', image, prompt }),
        appendLogs: async (records) => { await sendMessage({ type: 'captchaAppendLogs', records }); },
        appendSample: async (sample) => { await sendMessage({ type: 'captchaAppendSample', sample }); },
    };

    function showConfigStatus(config) {
        if (!config || !config.apiKey) {
            pageStatus.update('error', 'API Key 未配置：请在插件弹窗保存识别模型配置。');
        } else if (config.autoSolve === false) {
            pageStatus.update('warning', '自动解题已关闭：检测到验证码时将交给人工处理。');
        } else {
            pageStatus.update('ready', '自动解题已开启，正在等待验证码。');
        }
    }

    // popup 保存配置后立即同步页面卡；Tampermonkey shim 无 storage.onChanged 时自动跳过。
    if (chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !changes.xynigoCaptchaConfig) return;
            bridge.getConfig().then(showConfigStatus).catch((error) => {
                pageStatus.update('error', '更新页面配置状态失败：' + String((error && error.message) || error));
            });
        });
    }

    const agent = agentFactory.createAgent(bridge, {
        log: pageLog,
        warn: pageWarn,
    });

    // v0.2.0 曾把 API Key 存在站点 localStorage（xynigoCaptchaGlmKey），v0.3.x 配置在
    // chrome.storage。新配置缺 key 时自动迁移并开启自动解题，避免人工重填。
    async function migrateLegacyConfig() {
        try {
            const config = await bridge.getConfig();
            if (config && config.apiKey) return;
            const legacy = (typeof localStorage !== 'undefined' && localStorage.getItem('xynigoCaptchaGlmKey')) || '';
            if (!legacy) return;
            await sendMessage({
                type: 'captchaSaveConfig',
                config: Object.assign({}, config, { apiKey: legacy, autoSolve: true }),
            });
            pageLog('已从 v0.2.0 localStorage 迁移 API Key，并开启自动解题。');
        } catch (error) {
            pageWarn('旧版配置迁移失败：', error && error.message);
        }
    }

    async function startAgent() {
        await migrateLegacyConfig();
        agent.start();
        try {
            const config = await bridge.getConfig();
            showConfigStatus(config);
        } catch (error) {
            pageStatus.update('error', '读取插件配置失败：' + String((error && error.message) || error));
        }
    }

    startAgent().catch((error) => {
        pageWarn('插件启动失败：', error && error.message);
        agent.start();
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);

'use strict';

// Tampermonkey 运行时桥接：在 userscript 环境里装一个与 MV3 同形的 chrome 对象，
// 让 src/ 的 content.js / captcha-agent.js 无差别运行。识别请求经 GM_xmlhttpRequest 绕 CORS。
(function exposeXynigoCaptchaUserscriptRuntime(rootMod, factory) {
    const api = factory(rootMod);
    if (typeof module === 'object' && module.exports) module.exports = api;
    rootMod.XynigoCaptchaUserscriptRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntime(globalRef) {

    const CONFIG_KEY = 'xynigoCaptchaConfig';
    const LOGS_KEY = 'xynigoCaptchaLogs';
    const SAMPLES_KEY = 'xynigoCaptchaSamples';
    const LOGS_CAP = 500;

    function gmFetch(options) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            return Promise.reject(new Error('当前环境无 GM_xmlhttpRequest，无法跨域请求。'));
        }
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {},
                data: options.data != null ? String(options.data) : undefined,
                responseType: options.responseType,
                timeout: options.timeout || 60000,
                onload: resolve,
                onerror: () => reject(new Error('网络请求失败')),
                ontimeout: () => reject(new Error('网络请求超时')),
            });
        });
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('图片转码失败'));
            reader.readAsDataURL(blob);
        });
    }

    function storageGet(key, fallback) {
        try {
            const raw = globalRef.localStorage.getItem(key);
            return raw == null ? fallback : JSON.parse(raw);
        } catch (_error) {
            return fallback;
        }
    }

    function storageSet(key, value) {
        try {
            globalRef.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (_error) {
            return false;
        }
    }

    // 识别调用直接在 userscript 侧执行（与 background 同一套 vision-client）。
    async function handleSolve(message) {
        const Config = globalRef.XynigoCaptchaConfig;
        const Puzzle = globalRef.XynigoCaptchaPuzzle;
        const Vision = globalRef.XynigoCaptchaVision;
        const config = message.configOverride ? Config.normalizeConfig(message.configOverride) : Config.normalizeConfig(storageGet(CONFIG_KEY, {}));
        const callWith = async (cfg) => {
            const result = await Vision.callVisionModel(cfg, message.image, message.prompt || Puzzle.PROMPT, (url, requestOptions) => gmFetch({
                url,
                method: requestOptions.method,
                headers: requestOptions.headers,
                data: requestOptions.body,
                timeout: 60000,
            }).then((response) => ({
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                text: () => Promise.resolve(String(response.responseText || '')),
            })));
            if (!result.ok) return { ok: false, text: '', latencyMs: result.latencyMs, error: result.error || '识别失败' };
            try {
                return { ok: true, text: result.text, latencyMs: result.latencyMs, answer: Puzzle.parseModelAnswer(result.text).matches, error: '' };
            } catch (error) {
                return { ok: true, text: result.text, latencyMs: result.latencyMs, answer: [], parseError: error.message, error: '' };
            }
        };
        const primary = await callWith(config);
        let shadow = null;
        let compare = null;
        if (config.compareEnabled) {
            const compareConfig = Config.effectiveCompareConfig(config);
            shadow = await callWith(compareConfig);
            compare = { provider: compareConfig.provider, model: compareConfig.model };
        }
        return { ok: true, primary, shadow, compare, config: { provider: config.provider, model: config.model } };
    }

    function appendCapped(key, records, cap) {
        const list = storageGet(key, []);
        records.forEach((record) => list.push(record));
        while (list.length > cap) list.shift();
        storageSet(key, list);
    }

    // 把 GM 版消息处理装成 chrome.runtime.sendMessage 同形接口。
    function createChromeShim() {
        async function dispatch(message) {
            switch (message.type) {
                case 'captchaGetConfig':
                case 'captchaGetAll': {
                    const config = globalRef.XynigoCaptchaConfig.normalizeConfig(storageGet(CONFIG_KEY, {}));
                    if (message.type === 'captchaGetConfig') return { ok: true, config };
                    return { ok: true, config, logs: storageGet(LOGS_KEY, []), samples: storageGet(SAMPLES_KEY, []) };
                }
                case 'captchaSaveConfig': {
                    const config = globalRef.XynigoCaptchaConfig.normalizeConfig(message.config);
                    storageSet(CONFIG_KEY, config);
                    return { ok: true, config };
                }
                case 'captchaFetchImage': {
                    const response = await gmFetch({ method: 'GET', url: message.url, responseType: 'blob', timeout: 30000 });
                    if (response.status !== 200) throw new Error(`图片拉取 HTTP ${response.status}`);
                    return { ok: true, dataUrl: await blobToDataUrl(response.response) };
                }
                case 'captchaSolve':
                    return handleSolve(message);
                case 'captchaTestConnection': {
                    const config = globalRef.XynigoCaptchaConfig.normalizeConfig(message.config);
                    const result = await globalRef.XynigoCaptchaVision.callVisionModel(config, message.image, message.prompt || 'Reply with OK.', (url, requestOptions) => gmFetch({
                        url, method: requestOptions.method, headers: requestOptions.headers, data: requestOptions.body,
                    }).then((response) => ({
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        text: () => Promise.resolve(String(response.responseText || '')),
                    })));
                    return { ok: result.ok, text: result.text, latencyMs: result.latencyMs, error: result.error, status: result.status };
                }
                case 'captchaAppendLogs':
                    appendCapped(LOGS_KEY, message.records || [], LOGS_CAP);
                    return { ok: true };
                case 'captchaAppendSample': {
                    const sample = message.sample || {};
                    const config = globalRef.XynigoCaptchaConfig.normalizeConfig(storageGet(CONFIG_KEY, {}));
                    appendCapped(SAMPLES_KEY, [sample], Math.min(config.maxSamples || 50, 200));
                    return { ok: true };
                }
                case 'captchaClear':
                    storageSet(message.target === 'samples' ? SAMPLES_KEY : LOGS_KEY, []);
                    return { ok: true };
                default:
                    throw new Error('未知消息类型：' + message.type);
            }
        }

        return {
            runtime: {
                id: 'xynigo-captcha-userscript',
                getManifest: () => ({ version: globalRef.__xynigoCaptchaVersion || '0.0.0' }),
                sendMessage(message, callback) {
                    dispatch(message).then(
                        (result) => callback && callback(result),
                        (error) => {
                            if (callback) {
                                globalRef.chrome.runtime.lastError = { message: String((error && error.message) || error) };
                                try { callback(undefined); } finally { globalRef.chrome.runtime.lastError = null; }
                            }
                        },
                    );
                },
            },
            permissions: {
                contains: async () => true,
                request: async () => true,
            },
        };
    }

    function install() {
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('编辑模型配置（JSON）', () => {
                const Config = globalRef.XynigoCaptchaConfig;
                const current = Config.normalizeConfig(storageGet(CONFIG_KEY, {}));
                const input = globalRef.prompt(
                    '识别模型配置 JSON（provider: zhipu/doubao/gemini/custom；对比模型 compare* 字段；仅保存在本机）：',
                    JSON.stringify({
                        provider: current.provider, baseUrl: current.baseUrl, model: current.model, apiKey: current.apiKey,
                        compareEnabled: current.compareEnabled, compareProvider: current.compare.provider,
                        compareBaseUrl: current.compare.baseUrl, compareModel: current.compare.model,
                        compareApiKey: current.compare.apiKey, collectSamples: current.collectSamples,
                    }, null, 1),
                );
                if (input == null) return;
                try {
                    const next = Config.normalizeConfig(JSON.parse(input));
                    storageSet(CONFIG_KEY, next);
                    globalRef.alert('配置已保存：' + next.provider + ' / ' + next.model);
                } catch (error) {
                    globalRef.alert('配置解析失败：' + error.message);
                }
            });
        }
        globalRef.chrome = createChromeShim();
    }

    return { install };
});

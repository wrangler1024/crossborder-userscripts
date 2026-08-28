'use strict';

// 识别模型配置：所有 provider 统一走 OpenAI 兼容 /chat/completions。
(function exposeCaptchaConfig(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.XynigoCaptchaConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createConfig() {

    // 预置 provider：baseUrl 到 chat/completions 的拼接规则见 vision-client。
    const PROVIDER_PRESETS = Object.freeze({
        zhipu: {
            label: '智谱 GLM（免费档）',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            models: ['glm-4v-flash', 'glm-4.6v-flash', 'glm-4.1v-thinking-flash'],
            keyHint: 'open.bigmodel.cn 控制台创建 API Key，glm-4v-flash / glm-4.6v-flash 免费调用。',
        },
        doubao: {
            label: '豆包 · 火山方舟',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            models: ['doubao-seed-1.8', 'doubao-seed-1.6-vision'],
            keyHint: '火山方舟需实名认证并创建推理接入点；model 填 ep-xxxx 或模型名。',
        },
        gemini: {
            label: 'Google Gemini（国际）',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
            keyHint: 'Google AI Studio 创建 API Key；免费档约 5-15 RPM。',
        },
        custom: {
            label: '自定义（OpenAI 兼容）',
            baseUrl: '',
            models: [],
            keyHint: 'Base URL 需兼容 OpenAI /chat/completions 协议。',
        },
    });

    const STORAGE_KEYS = Object.freeze({
        config: 'xynigoCaptchaConfig',
        logs: 'xynigoCaptchaLogs',
        samples: 'xynigoCaptchaSamples',
    });

    const DEFAULT_CONFIG = Object.freeze({
        provider: 'zhipu',
        baseUrl: PROVIDER_PRESETS.zhipu.baseUrl,
        model: 'glm-4v-flash',
        apiKey: '',
        autoSolve: true,
        maxRounds: 3,
        settleTimeoutMs: 8000,
        // 对比模式：同一张拼图并行发给第二组模型，只记录不点击，用于配对比较。
        compareEnabled: false,
        compareProvider: 'zhipu',
        compareBaseUrl: PROVIDER_PRESETS.zhipu.baseUrl,
        compareModel: 'glm-4.6v-flash',
        compareApiKey: '',
        // 样本采集：解题通过的拼图 + 金标准编号落盘，供回放评测。
        collectSamples: true,
        maxSamples: 50,
    });

    const LIMITS = Object.freeze({
        maxLogs: 500,
        maxSamples: 200,
        sampleMaxChars: 400000, // 单样本拼图 dataURL 上限，防止撑爆 storage。
    });

    function clampInt(value, fallback, min, max) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function asBool(value, fallback) {
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        return fallback;
    }

    function pickProviderFields(source, prefix) {
        const p = prefix || '';
        const provider = String(source[p ? p + 'Provider' : 'provider'] || '').trim();
        const baseUrl = String(source[p ? p + 'BaseUrl' : 'baseUrl'] || '').trim();
        const model = String(source[p ? p + 'Model' : 'model'] || '').trim();
        const apiKey = String(source[p ? p + 'ApiKey' : 'apiKey'] || '').trim();
        const resolvedProvider = PROVIDER_PRESETS[provider]
            ? provider
            : (p ? DEFAULT_CONFIG.compareProvider : DEFAULT_CONFIG.provider);
        const preset = PROVIDER_PRESETS[resolvedProvider];
        return {
            provider: resolvedProvider,
            baseUrl: baseUrl || (preset ? preset.baseUrl : ''),
            model,
            apiKey,
        };
    }

    // 任意来源（storage / 表单 / 旧数据）收敛为合法配置；未知字段丢弃。
    function normalizeConfig(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const primary = pickProviderFields(source, '');
        return {
            provider: primary.provider,
            baseUrl: primary.baseUrl,
            model: primary.model || DEFAULT_CONFIG.model,
            apiKey: primary.apiKey,
            autoSolve: asBool(source.autoSolve, DEFAULT_CONFIG.autoSolve),
            maxRounds: clampInt(source.maxRounds, DEFAULT_CONFIG.maxRounds, 1, 5),
            settleTimeoutMs: clampInt(source.settleTimeoutMs, DEFAULT_CONFIG.settleTimeoutMs, 3000, 30000),
            compareEnabled: asBool(source.compareEnabled, DEFAULT_CONFIG.compareEnabled),
            compare: pickProviderFields(source, 'compare'),
            collectSamples: asBool(source.collectSamples, DEFAULT_CONFIG.collectSamples),
            maxSamples: clampInt(source.maxSamples, DEFAULT_CONFIG.maxSamples, 1, LIMITS.maxSamples),
        };
    }

    // 对比配置若未单独填 key，回落主 key（同 provider 场景最常见）。
    function effectiveCompareConfig(config) {
        const compare = config.compare || {};
        return {
            provider: compare.provider || config.provider,
            baseUrl: compare.baseUrl || config.baseUrl,
            model: compare.model || config.model,
            apiKey: compare.apiKey || config.apiKey,
        };
    }

    return { PROVIDER_PRESETS, STORAGE_KEYS, DEFAULT_CONFIG, LIMITS, normalizeConfig, effectiveCompareConfig };
});

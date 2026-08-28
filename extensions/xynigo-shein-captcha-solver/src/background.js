'use strict';

// MV3 service worker（classic）：识别调用、取图中转、日志与样本存储。
// importScripts 相对路径以本文件所在目录（src/）为基准；带 src/ 前缀会解析成
// src/src/*.js 导致 SW 启动即崩，弹窗保存与页面 agent 全部失联（2026-08-28 事故根因）。
importScripts('config.js', 'puzzle.js', 'vision-client.js', 'stats.js');

const Config = globalThis.XynigoCaptchaConfig;
const Puzzle = globalThis.XynigoCaptchaPuzzle;
const Vision = globalThis.XynigoCaptchaVision;

function storageGet(key, fallback) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (values) => {
            const value = values && values[key];
            resolve(value === undefined ? fallback : value);
        });
    });
}

function storageSet(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
    });
}

// 出口链路（墨西哥代理）可能黑洞挂起：所有外发请求 30 秒强制超时，避免弹窗状态永远停在"测试中"。
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) throw new Error('请求超时（30秒无响应），检查网络/代理到 ' + new URL(url).hostname + ' 的可达性');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function loadConfig() {
    return Config.normalizeConfig(await storageGet(Config.STORAGE_KEYS.config, {}));
}

// MV3 service worker 无 FileReader 依赖时也能工作：arrayBuffer + btoa 转 dataURL。
async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }
    return 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(binary);
}

async function recognizeWithMeta(config, image, prompt, fetchImpl) {
    const result = await Vision.callVisionModel(config, image, prompt, fetchImpl || fetch);
    if (!result.ok) {
        return { ok: false, text: '', latencyMs: result.latencyMs, error: result.error || '识别失败', status: result.status };
    }
    try {
        return { ok: true, text: result.text, latencyMs: result.latencyMs, answer: Puzzle.parseModelAnswer(result.text).matches, error: '' };
    } catch (error) {
        return { ok: true, text: result.text, latencyMs: result.latencyMs, answer: [], parseError: error.message, error: '' };
    }
}

async function handleCaptchaSolve(message) {
    const config = message.configOverride ? Config.normalizeConfig(message.configOverride) : await loadConfig();
    const prompt = message.prompt || Puzzle.PROMPT;
    const primary = await recognizeWithMeta(config, message.image, prompt, fetchWithTimeout);
    let shadow = null;
    let compare = null;
    if (config.compareEnabled) {
        const compareConfig = Config.effectiveCompareConfig(config);
        const shadowResult = await recognizeWithMeta(compareConfig, message.image, prompt, fetchWithTimeout);
        shadow = shadowResult;
        compare = { provider: compareConfig.provider, model: compareConfig.model };
    }
    return {
        ok: true,
        primary,
        shadow,
        compare,
        config: { provider: config.provider, model: config.model },
    };
}

async function handle(message) {
    switch (message.type) {
        case 'captchaGetConfig':
            return { ok: true, config: await loadConfig() };
        case 'captchaSaveConfig': {
            const normalized = Config.normalizeConfig(message.config);
            await storageSet(Config.STORAGE_KEYS.config, normalized);
            return { ok: true, config: normalized };
        }
        case 'captchaFetchImage': {
            const response = await fetchWithTimeout(message.url, { credentials: 'omit' });
            if (!response.ok) throw new Error(`图片拉取失败 HTTP ${response.status}`);
            return { ok: true, dataUrl: await blobToDataUrl(await response.blob()) };
        }
        case 'captchaSolve':
            return handleCaptchaSolve(message);
        case 'captchaTestConnection': {
            const config = Config.normalizeConfig(message.config);
            const result = await Vision.callVisionModel(config, message.image, message.prompt || 'Reply with OK.', fetchWithTimeout);
            return { ok: result.ok, text: result.text, latencyMs: result.latencyMs, error: result.error, status: result.status };
        }
        case 'captchaAppendLogs': {
            const logs = await storageGet(Config.STORAGE_KEYS.logs, []);
            const cap = Config.LIMITS.maxLogs;
            const next = (message.records || []).reduce((acc, record) => globalThis.XynigoCaptchaStats.appendTrim(acc, record, cap), logs);
            await storageSet(Config.STORAGE_KEYS.logs, next);
            return { ok: true };
        }
        case 'captchaAppendSample': {
            const sample = message.sample || {};
            if (String(sample.image || '').length > Config.LIMITS.sampleMaxChars) return { ok: false, error: '样本过大' };
            const samples = await storageGet(Config.STORAGE_KEYS.samples, []);
            const config = await loadConfig();
            const next = globalThis.XynigoCaptchaStats.appendTrim(samples, sample, Math.min(config.maxSamples, Config.LIMITS.maxSamples));
            await storageSet(Config.STORAGE_KEYS.samples, next);
            return { ok: true };
        }
        case 'captchaGetAll':
            return {
                ok: true,
                config: await loadConfig(),
                logs: await storageGet(Config.STORAGE_KEYS.logs, []),
                samples: await storageGet(Config.STORAGE_KEYS.samples, []),
            };
        case 'captchaClear': {
            const key = message.target === 'samples' ? Config.STORAGE_KEYS.samples : Config.STORAGE_KEYS.logs;
            await storageSet(key, []);
            return { ok: true };
        }
        default:
            throw new Error('未知消息类型：' + message.type);
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handle(message)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
    return true;
});

'use strict';

// 视觉识别客户端：三家 provider 全部走 OpenAI 兼容 chat/completions，单编码号拼图。
(function exposeCaptchaVision(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.XynigoCaptchaVision = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createVisionClient() {

    function chatCompletionsUrl(baseUrl) {
        const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
        if (!trimmed) throw new Error('Base URL 未配置');
        if (/\/chat\/completions$/.test(trimmed)) return trimmed;
        return trimmed + '/chat/completions';
    }

    function buildChatBody(config, imageDataUrl, prompt) {
        if (!config.model) throw new Error('model 未配置');
        if (!config.apiKey) throw new Error('API Key 未配置');
        return {
            model: config.model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: imageDataUrl } },
                ],
            }],
            temperature: 0,
            max_tokens: 1024, // glm-4v-flash 上限 1024（越界报 1210）；答案只是一小段 JSON，足够。
            stream: false,
        };
    }

    function buildRequest(config, imageDataUrl, prompt) {
        return {
            url: chatCompletionsUrl(config.baseUrl),
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + config.apiKey,
                },
                body: JSON.stringify(buildChatBody(config, imageDataUrl, prompt)),
            },
        };
    }

    // content 可能是字符串，也可能是分段数组；思考型模型可能把正文放 reasoning_content。
    function extractResponseText(json) {
        const message = json && json.choices && json.choices[0] && json.choices[0].message;
        if (!message) return '';
        if (typeof message.content === 'string' && message.content.trim()) return message.content;
        if (Array.isArray(message.content)) {
            const text = message.content
                .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
                .join('');
            if (text.trim()) return text;
        }
        if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
            return message.reasoning_content;
        }
        return '';
    }

    function stripDataUrlPrefix(dataUrl) {
        const commaIndex = String(dataUrl || '').indexOf(',');
        return commaIndex >= 0 ? String(dataUrl).slice(commaIndex + 1) : String(dataUrl || '');
    }

    function isImageRejection(status, bodyText) {
        if (status === 1210) return true;
        const text = String(bodyText || '');
        return /image|base64|图片/i.test(text) && !/quota|余额|欠费|api key|invalid/i.test(text);
    }

    // 发起识别调用。个别 provider 对 data:image 前缀不兼容：失败且疑似图片格式问题时，
    // 自动降级为裸 base64 重试一次。返回 {ok, status, text, latencyMs, error, retryUsed}。
    async function callVisionModel(config, imageDataUrl, prompt, fetchImpl) {
        const doFetch = fetchImpl || globalThis.fetch;
        if (typeof doFetch !== 'function') throw new Error('当前环境无 fetch 实现');

        async function attempt(payloadImage) {
            const request = buildRequest(config, payloadImage, prompt);
            const startedAt = Date.now();
            const response = await doFetch(request.url, request.options);
            const latencyMs = Date.now() - startedAt;
            let bodyText = '';
            try { bodyText = await response.text(); } catch (_error) { /* 空响应体 */ }
            let json = null;
            try { json = JSON.parse(bodyText); } catch (_error) { /* 非 JSON 响应 */ }
            return { response, latencyMs, bodyText, json };
        }

        let first;
        try {
            first = await attempt(imageDataUrl);
        } catch (error) {
            return { ok: false, status: 0, text: '', latencyMs: 0, error: '网络请求失败：' + error.message, retryUsed: false };
        }
        if (first.response.ok) {
            return { ok: true, status: first.response.status, text: extractResponseText(first.json), latencyMs: first.latencyMs, error: '', retryUsed: false };
        }
        if (isImageRejection(first.response.status, first.bodyText)) {
            try {
                const second = await attempt(stripDataUrlPrefix(imageDataUrl));
                if (second.response.ok) {
                    return { ok: true, status: second.response.status, text: extractResponseText(second.json), latencyMs: second.latencyMs, error: '', retryUsed: true };
                }
                return { ok: false, status: second.response.status, text: '', latencyMs: second.latencyMs, error: second.bodyText.slice(0, 300), retryUsed: true };
            } catch (error) {
                return { ok: false, status: 0, text: '', latencyMs: 0, error: '重试网络失败：' + error.message, retryUsed: true };
            }
        }
        return { ok: false, status: first.response.status, text: '', latencyMs: first.latencyMs, error: first.bodyText.slice(0, 300), retryUsed: false };
    }

    return { chatCompletionsUrl, buildChatBody, buildRequest, extractResponseText, stripDataUrlPrefix, isImageRejection, callVisionModel };
});

'use strict';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;

function isAllowedImageUrl(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return url.protocol === 'https:' && (
            host === 'ltwebstatic.com'
            || host.endsWith('.ltwebstatic.com')
            || host === 'img.shein.com'
            || host === 'us.shein.com'
            || host === 'shein.com.mx'
            || host.endsWith('.shein.com.mx')
        );
    } catch (_error) {
        return false;
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function isAllowedJsonUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'api.sheinshuju.com'
            && url.pathname === '/api/v1/goods/card'
            && /^\d+$/.test(url.searchParams.get('goodsId') || '')
            && /^\d+$/.test(url.searchParams.get('mallId') || '')
            && /^(?:mx|us)$/.test(url.searchParams.get('siteUID') || '');
    } catch (_error) {
        return false;
    }
}

function fetchImage(message, sendResponse) {
    if (!isAllowedImageUrl(message.url)) {
        sendResponse({ ok: false, error: '不允许的图片地址' });
        return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    fetch(message.url, { credentials: 'omit', signal: controller.signal })
        .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const mime = response.headers.get('content-type')?.split(';')[0] || '';
            if (!mime.startsWith('image/')) throw new Error('响应不是图片');
            const buffer = await response.arrayBuffer();
            if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('图片大小超出限制');
            return { mime, base64: arrayBufferToBase64(buffer) };
        })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.name === 'AbortError' ? '图片获取超时' : error.message }))
        .finally(() => clearTimeout(timer));
    return true;
}

function fetchJson(message, sendResponse) {
    if (!isAllowedJsonUrl(message.url)) {
        sendResponse({ ok: false, error: '不允许的数据地址' });
        return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    fetch(message.url, { credentials: 'omit', cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const contentLength = Number(response.headers.get('content-length'));
            if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) throw new Error('数据响应超出限制');
            const text = await response.text();
            if (!text || new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('数据响应无效');
            return JSON.parse(text);
        })
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => sendResponse({ ok: false, error: error.name === 'AbortError' ? '数据请求超时' : error.message }))
        .finally(() => clearTimeout(timer));
    return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'XYNIGO_FETCH_IMAGE') return fetchImage(message, sendResponse);
    if (message?.type === 'XYNIGO_FETCH_JSON') return fetchJson(message, sendResponse);
    return false;
});

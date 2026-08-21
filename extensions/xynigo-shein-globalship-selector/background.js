'use strict';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'XYNIGO_FETCH_IMAGE') return false;
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
});

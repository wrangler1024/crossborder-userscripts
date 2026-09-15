'use strict';

// 主世界桥接:content script 隔离世界无法监听页面自身的 XHR,
// 也不能保证带齐店小秘接口的请求上下文,因此由主世界代为:
// 1. 捕获页面自己发出的 /api/tracking/pageList.json 请求参数(被动学习当前筛选);
// 2. 代理插件发起的同源 POST(带 cookie 与站点一致的头)。
// 两侧通过 document 上的 CustomEvent(JSON 字符串 detail)通信。

(function () {
    'use strict';
    if (window.__xftBridgeInstalled) return;
    window.__xftBridgeInstalled = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this.__xftUrl = String(url || '');
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        const xhr = this;
        if (xhr.__xftUrl && xhr.__xftUrl.indexOf('/api/tracking/pageList.json') !== -1) {
            xhr.addEventListener('load', function () {
                try {
                    document.dispatchEvent(new CustomEvent('xft:pagelist-captured', {
                        detail: JSON.stringify({
                            url: xhr.__xftUrl,
                            body: body == null ? '' : String(body),
                            status: xhr.status,
                        }),
                    }));
                } catch (e) { /* 捕获失败不影响页面 */ }
            });
        }
        return origSend.apply(this, arguments);
    };

    document.addEventListener('xft:fetch-request', function (ev) {
        let req;
        try { req = JSON.parse(ev.detail); } catch (e) { return; }
        if (!req || !req.reqId || !req.url) return;
        (async () => {
            let status = 0;
            let text = '';
            try {
                const resp = await fetch(req.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    body: req.body || '',
                    credentials: 'include',
                });
                status = resp.status;
                text = await resp.text();
            } catch (e) {
                status = 0;
                text = String((e && e.message) || e);
            }
            try {
                document.dispatchEvent(new CustomEvent('xft:fetch-response', {
                    detail: JSON.stringify({ reqId: req.reqId, status, text: String(text).slice(0, 4000000) }),
                }));
            } catch (e) { /* 页面已卸载等情况忽略 */ }
        })();
    });
})();

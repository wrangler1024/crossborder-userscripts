// ==UserScript==
// @name         领星广告创建助手
// @namespace    https://github.com/wrangler1024/crossborder-userscripts/lingxing-ads-assistant
// @version      0.9.7
// @description  Excel导入、库存与建议价校验、三活动预览，确认后批量创建；本地保存与备份。
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/extensions/lingxing-ads-assistant
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @match        https://ads.lingxing.com/amazon/*
// @match        https://ads.lingxing.com/ad_report/*
// @run-at       document-start
// @sandbox      raw
// @noframes
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @require      https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/lingxing-ads-assistant-v0.9.7/scripts/lingxing-ads-assistant/lingxing-ads-assistant.runtime.js#sha256=24b54b238ba253200e06570e41d3e5d6da283f61b9ea54abedc6b5272f6922ce
// @updateURL    https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant.meta.js
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant.user.js
// ==/UserScript==

// Small installation entry. The versioned runtime above is integrity-checked and cached by Tampermonkey.
(function(){'use strict';
if(typeof startLingxingAdsAssistant!=='function'){
  console.error('广告助手程序未加载，请检查网络并在油猴中检查更新，然后刷新领星页面。');
  return;
}
startLingxingAdsAssistant();
})();

'use strict';

// 工具栏图标与页面状态条共用“打开详情”动作，不注入脚本或申请新权限。
chrome.action.onClicked.addListener((tab) => {
    if (!Number.isInteger(tab?.id)) return;
    chrome.tabs.sendMessage(tab.id, { type: 'XYNIGO_PRICE_COMPARE_OPEN_DETAILS' })
        .catch(() => { /* 非支持页面或页面尚未加载内容脚本时不产生控制台错误。 */ });
});

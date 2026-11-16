chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'open-package-assistant') return;
  const ready = location.hostname === 'erp.lingxing.com' && /^\/erp\/productManage\/?$/.test(location.pathname);
  if (ready) window.dispatchEvent(new Event('lingxing-package-assistant-open'));
  sendResponse({ ready });
});

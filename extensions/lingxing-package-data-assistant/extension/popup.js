document.getElementById('open').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'open-package-assistant' });
    if (result?.ready) window.close(); else status.textContent = '请先打开已登录的领星产品管理页。';
  } catch { status.textContent = '请刷新领星产品管理页，再点击打开。'; }
});

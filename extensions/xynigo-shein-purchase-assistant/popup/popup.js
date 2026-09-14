'use strict';

const statusNode = document.getElementById('status');
const hubStatusNode = document.getElementById('hubStatus');
const sourceTitleNode = document.getElementById('sourceTitle');
const sourceBadgeNode = document.getElementById('sourceBadge');
const sourceDescriptionNode = document.getElementById('sourceDescription');
const sourceNoticeNode = document.getElementById('sourceNotice');
const memberNameNode = document.getElementById('memberName');
const sourceTypeNode = document.getElementById('sourceType');
const sourceSheetNode = document.getElementById('sourceSheet');
const sourceResolutionNode = document.getElementById('sourceResolution');
const executorAddressNode = document.getElementById('executorAddress');
const shortcutValueNode = document.getElementById('shortcutValue');
const openDesktopSettingsButton = document.getElementById('openDesktopSettings');
const openShortcutSettingsButton = document.getElementById('openShortcutSettings');
const refreshButton = document.getElementById('refresh');
const messageNode = document.getElementById('message');

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, code: 'extension_unavailable', error: '插件后台暂不可用' });
        return;
      }
      resolve(response || { ok: false, code: 'extension_no_response', error: '插件后台无响应' });
    });
  });
}

function setStatus(text, tone) {
  statusNode.dataset.tone = tone || 'checking';
  statusNode.querySelector('span').textContent = text;
}

function showMessage(text, error) {
  messageNode.textContent = text || '';
  messageNode.classList.toggle('error', Boolean(error));
}

function renderHub(hubStudio) {
  const hub = hubStudio || {};
  if (hub.available) {
    hubStatusNode.dataset.tone = 'success';
    hubStatusNode.textContent = 'HubStudio Local API 已就绪';
    return;
  }
  hubStatusNode.dataset.tone = hub.clientRunning ? 'warning' : 'neutral';
  hubStatusNode.textContent = hub.message || 'HubStudio 增强能力当前不可用';
}

function resolutionLabel(value) {
  return {
    environment_binding: 'HubStudio 环境精确映射',
    member_default: '当前采购员默认',
    team_default: '团队默认数据源',
  }[String(value || '')] || '桌面客户端配置';
}

function renderSource(source) {
  const data = source || {};
  const active = data.active || data;
  const scope = data.scope || active.scope || data.mode || active.mode;
  const label = data.label || active.label || '已配置收件信息数据源';
  const memberName = data.member && data.member.name;
  sourceTitleNode.textContent = label;
  sourceBadgeNode.dataset.tone = 'success';
  sourceBadgeNode.textContent = '已就绪';
  memberNameNode.textContent = memberName || '当前登录成员';
  sourceTypeNode.textContent = scope === 'personal' ? '个人速填表' : '团队协作表';
  sourceSheetNode.textContent = [
    active.sheetName || '工作表名称未记录',
    active.cellRange || '范围已配置',
  ].join(' · ');
  sourceResolutionNode.textContent = resolutionLabel(data.resolution || active.resolution);
  sourceDescriptionNode.textContent = '搜索订单时将由本地执行器使用该飞书数据源，插件不保存链接或收件信息。';
  sourceNoticeNode.dataset.tone = 'neutral';
  sourceNoticeNode.textContent = '需要修改时，请在 Xynigo 桌面客户端的“采购助手数据源”中操作。';
}

function renderFailure(result) {
  const response = result || {};
  const code = String(response.code || '');
  const titles = {
    authentication_required: '请先登录 Xynigo 桌面客户端',
    cloud_unreachable: '无法验证当前采购员',
    data_source_mapping_required: '当前采购员尚未配置数据源',
    executor_update_required: '本地执行器需要更新',
    executor_unreachable: '未找到 Xynigo 本地执行器',
  };
  const title = titles[code] || '采购助手尚未就绪';
  setStatus(title, 'error');
  sourceTitleNode.textContent = title;
  sourceBadgeNode.dataset.tone = 'error';
  sourceBadgeNode.textContent = '需处理';
  memberNameNode.textContent = '—';
  sourceTypeNode.textContent = '—';
  sourceSheetNode.textContent = '—';
  sourceResolutionNode.textContent = '—';
  sourceDescriptionNode.textContent = response.error || '请打开 Xynigo 桌面客户端检查状态。';
  sourceNoticeNode.dataset.tone = code === 'executor_unreachable' ? 'warning' : 'error';
  sourceNoticeNode.textContent = response.error || '本地配置不完整。';
  hubStatusNode.dataset.tone = 'neutral';
  hubStatusNode.textContent = '等待本地执行器就绪';
}

function loadShortcut() {
  chrome.commands.getAll((commands) => {
    if (chrome.runtime.lastError) {
      shortcutValueNode.textContent = '未设置';
      return;
    }
    const command = (commands || []).find((item) => item.name === 'open-purchase-assistant');
    shortcutValueNode.textContent = command && command.shortcut ? command.shortcut : '未设置';
  });
}

async function loadStatus() {
  refreshButton.disabled = true;
  setStatus('正在自动发现本地执行器…', 'checking');
  showMessage('');
  const result = await sendMessage({ type: 'EXECUTOR_HEALTH' });
  const settingsResult = await sendMessage({ type: 'GET_SETTINGS' });
  executorAddressNode.textContent = settingsResult.ok
    && settingsResult.settings && settingsResult.settings.executorBaseUrl
    ? settingsResult.settings.executorBaseUrl
    : '未发现可用端口';
  if (!result.ok) {
    renderFailure(result);
    showMessage(result.error || '连接失败', true);
    refreshButton.disabled = false;
    return;
  }
  setStatus('Xynigo 本地执行器已连接', 'success');
  renderHub(result.hubStudio);
  renderSource(result.source);
  showMessage('会话已自动配对 · 配置来自桌面客户端');
  refreshButton.disabled = false;
}

openDesktopSettingsButton.addEventListener('click', async () => {
  openDesktopSettingsButton.disabled = true;
  const result = await sendMessage({ type: 'OPEN_DESKTOP_SETTINGS' });
  if (!result.ok) showMessage(result.error || '无法打开桌面设置', true);
  openDesktopSettingsButton.disabled = false;
});

openShortcutSettingsButton.addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

refreshButton.addEventListener('click', loadStatus);

loadShortcut();
loadStatus();

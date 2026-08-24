# SHEIN 店铺接码助手

> 版本：0.1.1-auto-dispatch-detection
> 状态：HubStudio 验收可用 · 团队扩展维护版

## 业务目标

运营人员在 SHEIN 全球商家中心登录时，如果首次验证弹窗已由 SHEIN 自动发送验证码，插件会根据“已发送”文案或倒计时自动开始接码。如果页面未自动发码，则仍由运营人员手动点击“获取验证码”后触发插件。“确认”登录始终由运营人员手动完成。

## 已实现

- 仅在 `https://sellerhub.shein.com/*` 注入页面功能。
- 仅允许配置 `https://api.68sms.com/api/sms/get?key=...` 链接。
- 接码链接保存于当前 Hub 环境的 `chrome.storage.local`。
- 识别实测页面验证码输入框 `input#verifyCode`。
- 在登录弹窗出现前预先读取旧码基线，避免把上一次验证码当成新码。
- 识别“验证码已发送”或 `55s` 类倒计时，自动处理首次弹窗已发码场景。
- 监听运营人员手动点击“获取验证码”，不代替用户点击。
- 每 2.5 秒轮询一次，120 秒后超时。
- 兼容 JSON、纯文本和 HTML 形式的接码响应。
- 优先识别 SHEIN/OTP/验证码语义附近的 4–8 位数字，排除状态码、年份和手机号。
- 填充后只提示“请手动点击确认”，不自动提交。

## 安全边界

- 插件源码与交付包不包含任何真实接码链接或 key。
- 不输出验证码、接码链接或短信原文到控制台。
- 插件不读取 HubStudio 环境备注。
- 插件不点击“确认”、不自动提交登录。

## 开发验证

```bash
cd extensions/xynigo-shein-store-otp-assistant
npm test
npm run build:dev
npm run build
```

构建结果统一输出到仓库根目录 `dist/`：

- `xynigo-shein-store-otp-assistant-dev/`：HubStudio / Chrome 加载已解压扩展。
- `xynigo-shein-store-otp-assistant-v<版本>.zip`：团队扩展上传或版本归档。

当前团队使用时，从 HubStudio 环境的“扩展管理 → 团队扩展”安装“SHEIN 店铺接码助手”。每个店铺环境仍需单独配置对应接码链接。

安装与现场测试见 [INSTALL.md](INSTALL.md)。

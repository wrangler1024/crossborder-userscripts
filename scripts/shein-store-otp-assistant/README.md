# Xynigo SHEIN 店铺接码助手（Tampermonkey）

## 一键安装

已安装 Tampermonkey 的浏览器可直接点击：

### [一键安装 Xynigo SHEIN 店铺接码助手 v0.1.1](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-store-otp-assistant/xynigo_shein_store_otp_assistant.user.js)

脚本通过 `@updateURL` 自动检查本仓库 `main` 分支的后续版本。

## 首次配置

1. 打开 SHEIN 全球商家中心。
2. 点击 Tampermonkey 图标，找到当前脚本的菜单。
3. 点击“配置 SHEIN 接码链接”。
4. 粘贴当前店铺的完整接码链接并保存。
5. 点击“测试 SHEIN 接码链接”确认接口可访问。

接码链接只保存在当前浏览器环境的 Tampermonkey 存储中。每个 HubStudio 店铺环境需要分别配置一次。

## 登录流程

- 首次验证弹窗已经自动发码：脚本识别“已发送验证码，请查看”或倒计时并自动开始接码。
- 页面仍显示“获取验证码”：由运营人员手动点击，脚本随后开始接码。
- 验证码填入后，由运营人员手动点击“确认”。

## 安全边界

- 不读取 HubStudio 环境备注。
- 不自动点击“登录”“获取验证码”或“确认”。
- 不在控制台输出接码链接、验证码或短信原文。
- 源码和测试样例不包含真实接码 key、验证码或账号信息。

Chrome / HubStudio 扩展版源码位于 [`extensions/xynigo-shein-store-otp-assistant`](../../extensions/xynigo-shein-store-otp-assistant/README.md)。

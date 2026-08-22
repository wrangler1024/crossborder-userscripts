# Xynigo 店小秘运营采购助手（Tampermonkey）

## 一键安装

### ➡️ [点击一键安装 Xynigo 店小秘运营采购助手 v0.1.45](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-purchase-assistant/xynigo_dxm_purchase_assistant.user.js)

点击后应自动打开 Tampermonkey 安装确认页。安装前请停用浏览器中已加载的“Xynigo 店小秘运营采购助手”扩展版，避免两个版本同时注入订单详情。

## 与扩展版的关系

- 页面解析、采购明细表单、利润计算和审核门禁复用同一套源码。
- 扩展弹窗中的设置，在 Tampermonkey 版改由脚本菜单提供。
- 可在 Tampermonkey 菜单切换审核门禁、切换自动打开备注、导出或清除本地采购记录。
- Tampermonkey 通过 `@updateURL` 与 `@downloadURL` 自动检查 GitHub Raw 上的新版本。

## 当前边界

- 当前版本只保存浏览器本地预览采购单，尚未连接飞书。
- 不自动保存店小秘备注，不自动点击审核。
- 不保存客户姓名、邮箱、电话和完整地址。
- 仅匹配 `dianxiaomi.com` 及其子域名。

完整功能与安装说明见 [Manifest V3 扩展目录](../../extensions/xynigo-dxm-purchase-assistant/README.md)。

## 构建与测试

用户脚本由共享扩展源码生成，请勿直接修改生成的 `.user.js`：

```bash
node scripts/dxm-purchase-assistant/build-userscript.js
node --check scripts/dxm-purchase-assistant/xynigo_dxm_purchase_assistant.user.js
node --test scripts/dxm-purchase-assistant/userscript.test.js
node scripts/dxm-purchase-assistant/userscript-browser-smoke.js
```

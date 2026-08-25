# Xynigo 店小秘运营采购助手（Tampermonkey）

## 一键安装

### ➡️ [点击一键安装 Xynigo 店小秘运营采购助手 v0.1.45](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-purchase-assistant/xynigo_dxm_purchase_assistant.user.js)

点击后应自动打开 Tampermonkey 安装确认页。安装前请停用浏览器中已加载的“Xynigo 店小秘运营采购助手”扩展版，避免两个版本同时注入订单详情。

## 与扩展版的关系

- 页面解析、采购明细表单和利润计算复用扩展版源码。
- 可在 Tampermonkey 菜单查看联调说明、导出或清除本地采购记录。
- 店小秘审核、备注与采购助手完全解耦，两种版本都不会控制审核或填写备注。
- Tampermonkey 通过 `@updateURL` 与 `@downloadURL` 自动检查 GitHub Raw 上的新版本。

## 当前边界

- 当前飞书测试 Base 联调只支持独立扩展版；Tampermonkey 版不持有本机服务令牌，点击保存/提交时会明确提示改用扩展版。
- 不填写店小秘备注，不点击、锁定、解锁或拦截审核。
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

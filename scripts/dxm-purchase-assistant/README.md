# Xynigo 店小秘运营采购助手（Tampermonkey）

## 一键安装

### ➡️ [点击一键安装 Xynigo 店小秘运营采购助手 v0.12.2](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-purchase-assistant/xynigo_dxm_purchase_assistant.user.js)

点击后应自动打开 Tampermonkey 安装确认页。安装前请停用浏览器中已加载的“Xynigo 店小秘运营采购助手”扩展版，避免两个版本同时注入订单详情。

## 首次飞书登录

1. 打开任意店小秘页面，点击浏览器工具栏的 Tampermonkey 图标。
2. 在当前脚本菜单中点击“使用飞书登录 Xynigo”。
3. 在新页面完成飞书授权；授权结果会自动回传，成功后会显示系统通知。
4. 再次打开 Tampermonkey 菜单，可用“查看 Xynigo 登录状态”核对成员和组织。

运营电脑不需要启动 Xynigo 本机服务，也不需要先开放或登录 Xynigo 工作台。退出、到期或云端返回 401 后，可从同一菜单重新登录。

## 与扩展版的关系

- 页面解析、采购明细表单和利润计算复用扩展版源码。
- 油猴版复用扩展版的云端登录、采购 API、页面解析、采购明细表单和利润计算源码。
- 可在 Tampermonkey 菜单登录/退出 Xynigo、查看状态，以及导出或清除脱敏本地采购记录。
- 两种版本都不控制店小秘审核；云端正式提交成功后按现行流程预填一条 XYP2 客服备注，仍由运营核对并点击店小秘保存。
- Tampermonkey 通过 `@updateURL` 与 `@downloadURL` 自动检查 GitHub Raw 上的新版本。

## 安全边界

- 飞书 App Secret 和飞书用户令牌始终留在 Xynigo 云端；脚本只接收短期 Xynigo 会话。
- Tampermonkey 没有 `chrome.storage.session`，因此短期会话连同云端到期时间保存在脚本隔离存储；每次请求前校验到期时间，并在到期、401、403 或主动退出时清除。云端默认有效期为 8 小时。
- 跨域请求使用 `GM_xmlhttpRequest` 的匿名模式，不携带店小秘或 Xynigo 网页 Cookie。
- 不点击、锁定、解锁或拦截审核。
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

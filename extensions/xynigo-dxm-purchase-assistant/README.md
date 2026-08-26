# Xynigo 店小秘运营采购助手

Manifest V3 浏览器扩展，用于在店小秘订单详情中录入采购明细。运营可直接在插件中使用飞书登录，不需要安装或运行 Xynigo 本机服务。

```text
店小秘订单详情
→ 逐商品录入 SHEIN 精确采购链接
→ 扩展 Service Worker
→ Xynigo 云端飞书登录 + 采购 API
→ PostgreSQL + Outbox
→ 飞书 Base 异步镜像（同步 Worker 待部署）
```

当前线上运营测试版为 `0.12.2-cloud-login-distribution-test`，同时提供独立扩展包和可在线更新的 Tampermonkey 安装脚本，不是 Chrome Web Store 稳定版。

## 0.12.2 关键变更

- Tampermonkey 版新增独立飞书登录、登录状态、退出登录和云端采购接口，不再依赖本机 `8766` 服务。
- 油猴版通过 GitHub Raw 的 `@downloadURL` / `@updateURL` 在线安装和检查更新，修复版本也会附加到 GitHub Release。
- 油猴版使用匿名跨域请求，不携带网页 Cookie；短期 Xynigo 会话按云端返回的到期时间校验，到期或认证失败立即清除。
- 独立扩展版同步增加会话到期校验和云端注销能力。

## 0.12.1 基线能力

- 插件独立发起飞书登录，不再扫描 `127.0.0.1`、不再配对本机桥，也不依赖 Xynigo 工作台登录态。
- 飞书 App Secret 和飞书用户令牌始终留在 Xynigo 云端。扩展后台只在 `chrome.storage.session` 保留短期 Xynigo 会话，店小秘内容脚本无法读取。
- 云端正式提交成功后，才切换到店小秘原生“备注信息”选项卡，并把紧凑的 `[XYP2]...[/XYP2]` 填入一条新客服备注；运营核对后自行点击店小秘“保存”，订单详情继续停留在“备注信息”便于核对。
- 云端失败时只保留剪贴板兜底，绝不写入店小秘客服备注。
- 已正式提交但仍未被采购认领时，插件提供“提交修改”，云端更新同一采购单版本；已认领或进入采购执行后拒绝直接修改。
- 修订成功不新增第二条客服备注：插件在当前订单恰好存在一条 XYP2 时进入编辑、替换结构块、提交并回读验证；人工文字保持不变。原 XYP2 已被人工删除时重新预填一条，多条、内容竞态或回读失败时停止自动修改并保留剪贴板兜底。
- 当前待保存备注已有 XYP1/XYP2/V1 结构化文本时，不新增、不覆盖。
- 首次提交或删除后重新预填成功时，订单详情必须停留在原生“备注信息”页签；兼容页签后带备注数量的店小秘页面。

## XYP2 数据口径

- 每条明细用数组保存`源SKU / goods_id / skucode / main_attr / 主规格 / 次规格 / 原价 / 优惠率 / 指导价 / 数量`，解析工具可重建精确采购链接。
- 同一采购单的站点、币种和 `mallCode` 只保存一次。
- 店小秘实测导出会在 1000 字符截断客服备注；测试版使用 900 字安全上限，超限时阻止提交。
- 首次正式提交只预填新备注，不代替运营点击保存；修订唯一既有 XYP2 备注时会点击该行“编辑/提交”。插件始终不点击、锁定或拦截店小秘审核。

## 首次登录

1. 保持浏览器可访问 `https://xynigo.samforo.icu`，无需启动 Xynigo 本机服务。
2. 打开扩展弹窗，点击“使用飞书登录”。
3. 在扩展登录页继续，完成飞书授权。
4. 登录成功后扩展登录页会自动关闭；重新打开扩展，确认当前成员、组织和提单权限。

浏览器退出、扩展重载或云端会话失效后，需重新飞书登录；不需要打开 Xynigo 工作台。

## 当前能力

- 在订单详情左侧原生选项卡下追加“采购明细”。
- 识别订单商品、图片、销售数量、销售额、SKU、站点和店小秘下单时间。
- 解析商品型号助手生成的 SHEIN 精确链接，支持一单多商品和手工新增明细。
- 前端展示指导采购总额、预估利润和利润率；ROI 继续计算并随 `estimatedMetrics` 提交，但不在运营录入界面展示。
- 浏览器持久缓存只保留脱敏采购草稿，自动移除收件人姓名、电话和完整地址。

## 安全边界

- 扩展只在 `dianxiaomi.com` 及其子域名注入业务页，网络权限仅允许 Xynigo 云端域名。
- 扩展不包含飞书 App Secret、Base Token、Table ID 或固定内部服务令牌。
- 短期 Xynigo Bearer 只存放在 Service Worker 可访问的 `chrome.storage.session`，不写 `storage.local`、URL、日志或店小秘页面。
- 所有云端请求强制忽略浏览器 Cookie，只使用上述短期 Bearer；插件不会借用 Xynigo 网页登录态，也不会触发网页 CSRF 流程。
- 收件信息只在用户点击保存/提交时由 Service Worker 直接发往 Xynigo 云端，不写 URL 或本地采购缓存。
- 所有权限仍由 Xynigo 云端 RBAC 最终裁决。
- 已提交后的修改由云端同时校验原提交人和采购执行状态，前端按钮可用不代表可以绕过认领锁定。
- 自动编辑备注只匹配五列备注表中的“客服备注”类型、唯一 XYP2 行和精确“编辑/提交”入口；绝不点击删除，也不覆盖 XYP1、V1 或非结构化人工备注。

## 开发与验证

```bash
cd extensions/xynigo-dxm-purchase-assistant
npm test
node --check src/core.js
node --check src/background.js
node --check src/content.js
node --check popup/popup.js
node --check login/login.js
npm run build:dev
```

构建结果输出到仓库根目录 `dist/`。页面回归脚本位于 `tests/browser-smoke.js`，运行时需要 Playwright。

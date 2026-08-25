# Xynigo 店小秘运营采购助手

Manifest V3 浏览器扩展，用于在店小秘订单详情中录入采购明细，并按 Xynigo 当前登录成员的身份保存草稿或正式提交。

```text
店小秘订单详情
→ 逐商品录入 SHEIN 精确采购链接
→ 扩展 Service Worker
→ Xynigo 本机安全桥
→ Xynigo 云端 API + PostgreSQL
→ 飞书 Base 异步镜像（同步 Worker 待部署）
```

当前协同测试版为 `0.11.1-operator-attribution-test`，使用采购契约 v2 显式提交基础店铺名和运营姓名；通过 GitHub Prerelease `dxm-purchase-assistant-v0.11.1` 发布。它仍是 Xynigo 联调版本，不是 Chrome Web Store 稳定版，必须与支持采购契约 v2 的 Xynigo 客户端和云端服务配合使用。

## 0.11.1 对接语义

- “保存采购单”调用 `procurement.request.save`，可保存未完成草稿。
- “提交采购单”调用 `procurement.request.submit`，完成链接、指导价、数量和收件信息校验后正式提交。
- 店小秘店铺原值完整保留，并从“店铺名-运营姓名（组别）”中拆出 `storeBaseName`、`operatorName`；组别暂不拆字段。
- 正式提交人和提交时间由 Xynigo 云端依据已认证会话写入，不信任浏览器传入的姓名。
- 同一组织的 `orderKey` 幂等保存；已正式提交的采购单不能被变更后的草稿覆盖。
- 云端首先在 PostgreSQL 事务中保存采购单、明细和同步事件；接口返回 `syncStatus=pending` 表示飞书镜像尚待异步处理，不表示 Base 已写入。

## 首次连接

1. 启动包含插件桥的 Xynigo 本地版，并在 Xynigo 内完成飞书登录。
2. 打开扩展弹窗，点击“连接 Xynigo”。
3. 扩展只扫描 `127.0.0.1:8765-8779`，找到 Xynigo 后打开本地确认页。
4. 在确认页核对这是刚刚发起的请求，点击“确认连接”。
5. 重新打开扩展，确认当前成员、组织和提单权限正确。

连接凭据只是 Xynigo 本机进程内存中的随机桥接令牌，与扩展 ID 绑定；Xynigo 重启或重新配对后需重连。飞书令牌和 Xynigo 云端 Bearer 会话不会交给扩展。

## 当前能力

- 在订单详情左侧原生选项卡下追加“采购明细”。
- 识别订单商品、图片、销售数量、销售额、SKU、站点和店小秘下单时间。
- 解析商品型号助手生成的 SHEIN 精确链接，支持一单多商品和手工新增明细。
- 计算指导采购总额、预估利润、利润率与 ROI。
- 浏览器只保留脱敏缓存，自动移除收件人姓名、电话和完整地址。
- 不填写店小秘备注，不点击、锁定、解锁或拦截店小秘审核。

## 安全边界

- 扩展只在 `dianxiaomi.com` 及其子域名运行，只能访问回环地址 `http://127.0.0.1/*`。
- 配对需要 Xynigo 已登录成员在同源本地页面主动确认。
- 扩展不包含飞书 App Secret、Base Token、Table ID、云端会话或固定内部服务令牌。
- 收件信息只在用户点击保存/提交时经回环网关发往 Xynigo，不写入公开源码、URL 或本地缓存。
- 当前代码和测试不代表云端迁移、飞书同步 Worker 或真实 Base 写入已部署。

## 开发与验证

```bash
cd extensions/xynigo-dxm-purchase-assistant
npm test
node --check src/core.js
node --check src/background.js
node --check src/content.js
node --check popup/popup.js
```

构建结果输出到仓库根目录 `dist/`。浏览器回归脚本位于 `tests/browser-smoke.js`，运行时需要本机提供 Playwright。

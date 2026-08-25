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

当前协同测试候选版为 `0.11.0-xynigo-test`，与 Xynigo v0.11.0 测试客户端及云端服务统一版本；已发布的公开预览版仍为 `0.1.45`。`0.11.0` 尚未发布为稳定版，不应用公开版的安装链接替代本地测试构建包。

## 0.11.0 对接语义

- “保存采购单”调用 `procurement.request.save`，可保存未完成草稿。
- “提交采购单”调用 `procurement.request.submit`，完成链接、指导价、数量和收件信息校验后正式提交。
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

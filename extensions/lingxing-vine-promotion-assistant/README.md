# 领星 Vine 推广标注助手

版本：`0.1.4`

面向领星 ERP「销售 → 平台订单 → 订单列表 → 销售订单」的 Manifest V3 浏览器扩展。插件先只读检查 Vine 订单，展示尚未进入推广订单的记录；运营人工勾选并确认后，再按小批次调用领星原生“标记推广”，最后重新读取 `isAssessed` 回读校验。

## 文档

- [开发文档](./DEVELOPMENT.md)：业务口径、技术架构、接口边界、执行状态机、测试与发布。
- [操作文档](./OPERATIONS.md)：安装升级、首次检查、人工确认、回读结果、异常处理和常见问题。
- [安装说明](./INSTALL.md)：两种安装渠道的快速步骤。

## 业务口径

- Vine 判定：订单商品行 `slist[].promotionIds` 中存在以 `vine.enrollment.` 开头的值。
- 是否已标注：以 `isAssessed = 1` 为准，不使用 `isPromotion` 或订单金额判断。
- `Pending` 订单也纳入检查。
- 已取消、退款状态的 Vine 订单仍纳入检查。
- 推广类型保持默认，不写入推广费用。
- 只调用“标记推广”，不修改订单状态、备注、退款、费用或其他字段。

## 工作流

1. 插件在领星页面内观察正常请求的会话头，仅保存在当前页面内存中，不持久化 `auth-token`。
2. 只读调用 `POST /amz-order/api/order/OrderList`，默认读取近 30 天，最多读取 50 页。
3. 去除买家字段后展示 Vine 待标订单、现有已标数量和订单核对信息。
4. 点击“确认标注”时先重新只读检查，确认选中订单仍然存在、仍为 Vine、仍未被标注。
5. 二次确认弹窗要求人工勾选核对，再按每批最多 20 笔提交。
6. 写接口仅允许 `POST /amz-order/api/order/setAssess`，负载只包含 `sid`、`amazonOrderId`、`purchaseDateLocal`。
7. 提交后重新读取 `isAssessed`。失败或回读不一致时停止，不自动重复提交。

## 安装渠道

- Chrome / Edge / Ego：加载原生扩展包。
- Tampermonkey：安装 [同版本 `.user.js` 单文件脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-vine-promotion-assistant/lingxing-vine-promotion-assistant.user.js)，检查逻辑、界面和安全边界与扩展一致。

Tampermonkey 新版本发布后，脚本管理器按 `@updateURL` 检查更新；更新后刷新领星页面。

## 数据与权限

- 页面通信层在把订单传给插件界面前剔除买家姓名、邮箱和地址；界面和本地记录不保存这些字段。
- 不保存领星会话头、Cookie、`auth-token` 或请求正文。
- 本机只保存检查摘要、待标订单核对字段和最近执行记录。
- 写请求必须携带 `confirmed: true`，主页面通信层还会再次校验订单字段和单批 20 笔上限。
- 检查记录最多保留 20 条，可在插件窗口导出 CSV。

## 文件

- `src/core.js`：Vine 判定、分页响应解析、写负载构造、回读和 CSV。
- `src/page-session.js`：在领星页面主环境观察会话头，代理受限读写请求。
- `src/content.js`：插件窗口、每日检查、人工确认和执行状态。
- `src/panel.css`：与项目内广告创建助手、FBA 包装助手一致的插件视觉。
- `popup/`：工具栏弹窗入口和上次检查摘要。
- `scripts/lingxing-vine-promotion-assistant/`：油猴单文件版、构建脚本和分发测试。

页面入口默认收为右侧图标，悬停或键盘聚焦时展开状态摘要；按住入口上下拖动可调整位置，松开后自动记忆。点击入口仍直接打开插件窗口。

## 本地检查

```bash
npm test
npm run check
npm run build:dev
```

正式压缩包：

```bash
npm run build
```

## 注意事项

- 安装或重新加载扩展后，必须刷新已打开的领星页面，页面主环境才能重新注入会话观察脚本。
- 2026-11-16 已依据真实订单接口完成只读核对；完整写入与回读状态机另使用页面内模拟响应验证。运营测试已确认插件可用、已验收。
- 插件依赖当前领星网页会话。会话过期、账号切换或接口结构变化时停止，不绕过登录或权限。

## 验收状态

2026-11-16 技术验证与运营验收分开记录：

- 近 30 天：293 笔销售订单，2 页。
- Vine：68 笔，已标 65 笔，待标 3 笔。
- 待标订单当时均为 `Pending`；公开文档不保留具体订单号。
- 已验证真实只读分页、筛选、勾选、导出、提交前复核、二次确认、响应式布局和本地记录。
- 完整提交与回读状态机使用页面内模拟响应验收，期间网络监听确认真实 `setAssess` 请求为 0。
- 2026-11-16 运营测试确认插件可用、已验收。

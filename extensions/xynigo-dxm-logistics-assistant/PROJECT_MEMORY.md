# Xynigo 店小秘物流助手｜项目记忆

> 用途：新会话或新 Agent 修改代码前必读。本文记录稳定业务事实、接口口径、不可破坏的安全边界和已经确认的工程约束。即时状态看 [`handoff.md`](./handoff.md)，开发任务看 [`task.md`](./task.md)。

## 1. 一句话定义

这是给采购部物流专员使用的店小秘页面插件：在店小秘“订单—待处理”页面导入订单号、物流单号和物流商，完成精确预检后执行商家自履约“不打单/导入发货”；SHEIN 一单多件时支持先按采购子单拆包，再分批发货。

## 2. 唯一源码与发布关系

- 唯一正式源码仓库：`/Users/jeff/Documents/crossborder-userscripts`。
- 扩展共享源码：`extensions/xynigo-dxm-logistics-assistant/`。
- Tampermonkey 构建器：`scripts/dxm-logistics-assistant/build-userscript.js`。
- 生成文件：`scripts/dxm-logistics-assistant/xynigo_dxm_logistics_assistant.user.js`，不得直接手改。
- GitHub 仓库：`wrangler1024/crossborder-userscripts`；当前分支 `main`。
- Tampermonkey 主安装链接：<https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-logistics-assistant/xynigo_dxm_logistics_assistant.user.js>。
- 扩展版和 Tampermonkey 版在同一浏览器二选一，不能同时启用，否则页面会出现重复入口和重复事件监听。

## 3. 页面范围是硬约束

- 唯一生效页面：店小秘“订单—待处理”。
- 当前前端路由：`/web/order/approved`，菜单参数通常为 `go=m101`。
- 店小秘“待审核”是 `/web/order/paid`，不是本插件页面。
- 扩展 manifest 和 Tampermonkey `@match` 都只匹配 `/web/order/approved*`。
- 运行时仍会把尾部 `/` 去掉后严格检查 pathname 必须等于 `/web/order/approved`。
- 店小秘是 SPA。插件每 250ms 检测 pathname；离开待处理页后移除悬浮入口和空闲窗口。
- 拆单和发货写入前还会再次检查页面；即使旧窗口残留，也不能在其他页面提交。

不要再次把 `/web/order/paid` 配成物流助手页面。2026-09-05 曾因业务口语混淆误改到待审核，随后已在 `v0.3.2` 修正。

## 4. 当前业务功能

### 4.1 普通首次发货

- 输入：订单号、物流单号，可选第三列物流商；也可上传三列表格。
- 插件先切到店小秘原生“搜索”模式，按本批订单号收敛列表，再逐包调用详情接口回读。
- 当前页面没找到的订单可安全标记为“已排除”；混入非本批行、多个候选包裹、详情回读失败或承运商歧义时整批阻断。
- 只有平台承运商预检唯一匹配、人工核对并勾选不可撤销确认后，才提交发货。

### 4.2 SHEIN 拆单分批发货

- 采购子单号是 Xynigo 自定义字段，统一为 `原销售订单号-序号`，例如 `GSH1SAMPLE0001A-1`；店小秘没有该字段。
- 只录入本批已经出物流的采购子单，尚未出物流的子单不必等待。
- 尚未拆包的 SHEIN 多件订单：读取可拆商品，由采购按图片、SKU/规格和数量把采购子单分配给商品。
- 已出物流子单各生成一个包裹；未分配商品数量保留在原包裹，后续出物流时可再处理。
- 第一次确认只执行拆单；拆单后重新搜索并回读新包裹，人工映射采购子单与包裹。
- 第二次确认才写入物流并发货。拆单成功不等于发货成功。
- 已经拆好的订单跳过拆单写入，直接进入包裹映射。

### 4.3 导入与模板

- 每批最多 300 行，与店小秘单页可安全回读规模一致；超过后拆批。
- 模板字段：`订单号`、`物流单号`、`物流商渠道`；拆单模式可把第一列表头写成 `采购子单号`。
- `.xlsx` 和 `.csv` 都在浏览器本地解析，不上传到 Xynigo 或第三方。
- 长 USPS 单号必须保存为文本；数字单元格、科学计数法和公式型物流号会被阻止。
- Comet 不能直接打开 `chrome-extension://` 下载地址。模板先作为扩展内置数据读出，再通过页面 Blob 下载。

## 5. 物流商口径

当前输入支持：`UPS`、`USPS`、`FedEx`、`DHL`、`J&T`、`iMile`、`GOFO`、`SpeedX`。

- Xynigo Web/模板名称只负责归一化；最终提交名称必须来自店小秘当前订单的实时平台承运商选项。
- `J&T Express`、`JT`、`JNT` 可归一到输入侧 `J&T`，但提交仍使用店小秘返回的精确名称。
- `iMile` 大小写敏感。店小秘中的 `imile` 是另一个选项，不能代替 `iMile`。
- 墨西哥站和美国站是否能“不打单/导入发货”取决于店铺履约方式，不允许按国家一刀切拦截。团队运营店铺为商家自履约，人工流程已验证能使用该入口。

## 6. 已确认的店小秘接口

所有调用都使用当前店小秘登录会话、同源相对路径和 `credentials: include`；代码内没有店小秘账号、密码、Cookie 或第三方服务凭证。

| 用途 | 方法与路径 | 关键参数/口径 |
|---|---|---|
| 订单详情 | `POST /api/order/detail.json` | `orderId=<内部包裹ID>&history=`；必须回读销售订单号并与输入匹配。 |
| 拆单详情 | `POST /api/order/splitedOrderDetail.json` | `packageId=<内部包裹ID>&type=1`；当前只允许返回平台为 `shein`。 |
| SHEIN 批量拆单 | `POST /api/order/batchSplitOrder.json` | `packageId` + JSON 字符串 `splitOrderList`。 |
| 平台承运商选项 | `POST /api/order/withOutPrintShippingList.json` | `packageIds`；按每个包裹的平台选项做唯一匹配。 |
| 不打单发货 | `POST /api/package/withOutPrintShip.json` | `packageIds`、`tracingNumbers`、`providerNames`、`isShipStr=1` 等。 |
| 失败单继续提交 | `POST /api/package/commitPlatform.json` | 旧能力仍留在源码，但 `v0.3.2` 页面范围已移除入口，当前不可从 UI 使用。 |

### 6.1 拆单请求不可破坏的矩阵格式

- `splitedOrderDetail` 返回每个商品的 `splitKey` 和 `productCount`。
- `splitOrderList` 是包裹数组；每个包裹都必须包含所有商品，元素格式为 `{ sku: splitKey, num: "数量" }`。
- 数量是字符串；不在该包裹的商品也必须带上并填 `"0"`。
- 所有包裹的同一 `splitKey` 数量合计必须等于原商品总数。
- 有残余商品时，第一组是原包裹残余；本批采购子单依次追加新包裹。
- 全部分配完时不能提交一个空原包裹，第一条采购子单向量作为原包裹，其余作为新包裹。
- 不能根据采购子单序号猜商品，必须由采购看图片和规格选择。

## 7. 写入安全状态机

```text
输入/模板
  → 搜索收敛与订单详情回读
  → （需要时）商品分配与第一次确认
  → 串行拆单
  → 搜索并回读预期包裹数
  → 人工映射采购子单与新包裹
  → 平台承运商预检
  → 最终预览与第二次确认
  → 受控并发发货
  → 到店小秘发货成功/失败列表复核平台结果
```

- 拆单按原订单严格串行，不自动重试。
- 拆单超时、断网、5xx、非 JSON、缺少/无效结果码，均视为“结果未知”，立即锁定并停止后续拆单和发货。
- 拆单接口返回 `code=0` 只表示受理；必须回读到与计划完全一致的包裹数量才可继续。
- 发货默认并发 2，可选 1–4。
- 店小秘明确返回“正在执行移入运单号申请操作”时有限重试，并把后续请求降为串行。
- 发货超时、断网或响应无法解析时停止派发剩余订单，未派发项标记为“暂停未提交”。
- 发货接口 `code=0` 只表示店小秘受理，不得显示为平台已发货成功。

## 8. 搜索与 DOM 口径

- 必须先定位并启用店小秘原生“搜索”模式，不得直接扫描当前整页订单。
- 搜索输入多个订单号时使用英文逗号连接。
- 同一包裹可能因固定列/隐藏表格产生镜像 DOM 行；以内部 `rowid` 去重。
- 页面可能同时残留旧分页总数和本次搜索总数；优先采用与当前目标包裹行数一致且不超过预期上限的计数。
- 如果仍有非本批可见行、页面总数大于预期、目标包裹无法回读或原订单缺失，必须停止。
- 商品图既从详情接口读取，也保留列表页图片作为人工核对证据；无图时提示人工回详情核验，不能猜。

## 9. 当前版本和验证状态

- 当前代码版本：`v0.3.2-processing-only-beta`。
- 当前功能代码基线提交：`737db41`，已推送 `origin/main`；本交接文档的后续提交号以 `git log` 为准。
- 本地正式 ZIP：`dist/xynigo-dxm-logistics-assistant-v0.3.2.zip`。
- ZIP SHA-256：`6948a3e8325f0ce4d48dc6c70839600cce5612d9860d9b3186131b79f90042ec`。
- 完整测试：54 项通过、0 失败；3 项旧“发货失败页重提”浏览器测试因页面范围收窄而跳过。
- 普通发货、既有拆包映射、并发降级等流程此前有团队实际使用反馈。
- `v0.3.0+` 自动执行 SHEIN 拆单只完成脱敏模拟回归；截至 2026-09-05 尚未用真实订单完成不可撤销拆单验收。
- GitHub Release 的稳定扩展包仍是旧版 `v0.1.14`；`v0.3.2` 目前是主分支 Tampermonkey 测试版和本地构建包，不得描述成已发布稳定 Release。

## 10. 不可破坏的安全边界

- 公开仓不得写入真实客户姓名、电话、地址、订单数据、账号、Cookie、API Key、访问令牌或内部台账。
- 测试夹具只使用 `GSH1SAMPLE...`、`JMXTEST...` 等脱敏样例。
- 新 Agent 不得为验证代码自行点击真实店小秘拆单或发货；真实平台写入必须取得当次明确授权，并先用 1 个低风险测试订单。
- 不自动识别物流商；当前需求已明确暂缓。物流商仍由模板或输入提供，再与店小秘实时选项匹配。
- 不根据输入顺序、采购子单尾号、标题或物流号样式猜商品和包裹映射。
- 不把 GitHub Raw 缓存旧版本误判为推送失败；先用 `git ls-remote` 和提交固定 URL 核对远端，再等待 Raw 主分支缓存刷新。
- 工作区可能存在采购助手和根 README 的用户未提交改动。物流助手开发只能暂存明确路径，禁止顺手提交、覆盖或清理其他改动。

## 11. 新会话固定阅读顺序

1. 读仓库上层 `AGENTS.md`（若存在）。
2. 读本文件。
3. 读 [`handoff.md`](./handoff.md)。
4. 读 [`task.md`](./task.md)。
5. 读 [`README.md`](./README.md) 和 [`INSTALL.md`](./INSTALL.md)。
6. 执行 `git status --short`，区分物流助手改动与用户的其他脏文件。
7. 执行 `git log -5 --oneline -- extensions/xynigo-dxm-logistics-assistant scripts/dxm-logistics-assistant`，不要只凭文档推断远端版本。
8. 修改共享源码，运行完整测试，再由构建器生成 Tampermonkey 脚本；禁止直接编辑生成文件。

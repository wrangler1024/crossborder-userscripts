# 领星 Vine 推广标注助手 开发文档

适用版本：`0.1.4`。更新日期：2026-11-16。面向项目负责人及后续开发维护人员。

当前状态：2026-11-16 运营测试确认插件可用，已验收。技术验证与运营验收按不同证据层记录，详见本文“验证记录”。

# 开发背景

财务要求将销售订单中的 Vine 测评订单标记为推广订单。领星订单列表中的 Vine 订单分散在多个市场、店铺和订单状态中，逐笔人工核对容易漏标，也不便于复核执行结果。

本助手在领星 ERP 页面内先读取真实销售订单，按固定口径识别 Vine 且尚未进入推广订单的记录；运营核对订单号、店铺、状态和商品信息并明确确认后，才调用领星原生“标记推广”，随后重新读取 `isAssessed` 完成回读校验。

插件不改变财务口径，不以订单金额、买家信息或 `isPromotion` 推测是否已标。是否已标只以订单的 `isAssessed` 为准。

# 适用边界

- 页面入口仅出现在 `https://erp.lingxing.com/erp/orderList`。
- 检查对象是当前领星公司及账号可见的销售订单，不读取其他 ERP 模块的推广记录。
- 默认检查近 30 天，可切换近 7 / 30 / 90 天。
- `Pending`、已取消和退款状态的 Vine 订单均纳入检查，不因订单状态自动排除。
- 推广类型保持领星默认值，不填写推广费用。
- 只调用“标记推广”，不修改订单状态、备注、退款、费用或其他字段。
- 插件不会在后台持续监听订单，也不会自动提交标注。每天首次进入领星并取得页面会话后，只自动执行一次只读检查；写入必须经过运营选择和二次确认。
- 油猴版和原生扩展版选择一种启用，避免重复入口或重复操作。

# 固定业务口径

| 项目 | 实现口径 |
|-|-|
| Vine 判定 | 任一商品行 `slist[].promotionIds` 含以 `vine.enrollment.` 开头的值 |
| 已标注判定 | 订单 `isAssessed === 1`；不使用 `isPromotion`、金额或买家字段推断 |
| 待标注判定 | 已认定为 Vine，且 `isAssessed !== 1` |
| 订单状态 | `Pending`、取消、退款均保留；状态只用于展示和人工核对 |
| 推广类型 | 默认，不显式写入推广类型或推广费用 |
| 写入范围 | 每笔订单只提交 `sid`、`amazonOrderId`、`purchaseDateLocal` |
| 写入接口 | `POST /amz-order/api/order/setAssess` |
| 单批上限 | 每小批最多 20 笔；选中更多订单时串行分批 |
| 检查分页 | 每页 200 笔，最多 50 页；超出上限时要求缩小时间范围 |

同一订单以 `sid + amazonOrderId + purchaseDateLocal` 作为稳定键，用于去重、提交前复核和回读匹配。

# 架构与数据流

处理顺序：

1. 领星页面自身发起网关请求，`page-session.js` 从该请求中观察当前登录会话头。
2. 插件只读分页调用 `OrderList`，读取所选日期范围内的销售订单。
3. `core.js` 筛选 Vine 商品行，按 `isAssessed` 分为已标和待标，并生成去重后的核对数据。
4. 隔离环境的 `content.js` 只在页面通信层完成脱敏后接收订单字段，展示统计、市场筛选、搜索、清单和 CSV 预览。
5. 运营勾选订单并点击“确认标注”后，插件再次只读扫描全部范围，确认本批订单仍然存在、仍为 Vine、仍未标注。
6. 二次确认弹窗要求人工勾选核对项。确认后，插件先保存执行意图，再按每批最多 20 笔串行调用 `setAssess`。
7. 提交完成后重新扫描范围，逐笔读取 `isAssessed`。只有 `isAssessed === 1` 才记为核验通过。
8. 结果、批次号和本地执行记录可供运营导出；异常时停止，不自动重试写请求。

主要模块：

| 文件 | 职责 |
|-|-|
| `manifest.json` | Manifest V3 声明、页面匹配、权限和双世界脚本注入 |
| `src/page-session.js` | 页面主环境中的会话观察、请求白名单和受限请求代理 |
| `src/core.js` | Vine 识别、分页模型、写负载、预复核、回读判定和 CSV |
| `src/content.js` | Shadow DOM 插件窗口、每日检查、选择、确认、执行和本地记录 |
| `src/panel.css` | 与项目内广告创建助手、FBA 包装数据维护助手一致的视觉样式 |
| `popup/` | 浏览器工具栏入口和上次检查摘要 |
| `build.sh` | 原生扩展的开发目录和正式 ZIP 构建 |
| `scripts/lingxing-vine-promotion-assistant/` | 油猴单文件构建、元信息、本地存储适配和分发测试 |

# 领星页面接入

## 会话取得

原生扩展的页面主环境脚本在 `document_start` 注入，在领星页面正常发起网关请求时观察受限会话头。油猴版在 `document-start` 注入同一套页面逻辑。

观察到的会话头只保留在页面内存中，要求至少具备 `auth-token` 与公司标识后才视为就绪。公司、用户和租户身份会生成短哈希作为会话范围，用于识别账号切换；不保存原始令牌、Cookie 或请求头。

安装、重新加载扩展或更新油猴脚本后，都已打开的领星页面必须刷新，页面主环境才能重新注入。

## 已验证接口

| 用途 | 方法与路径 | 当前处理 |
|-|-|-|
| 订单只读查询 | `POST /amz-order/api/order/OrderList` | 按日期、页码和每页 200 笔读取；校验 `code === 1` 和分页结构 |
| 标记推广 | `POST /amz-order/api/order/setAssess` | 只接受人工确认后的 1 至 20 笔订单 |

网关域名为 `https://gw.lingxingerp.com`。这两个接口是当前页面已验证的内部能力，不代表领星承诺稳定的公开 API。页面通信层以固定白名单拒绝其他路径，开发时不能通过修改页面消息临时扩大接口或字段范围。

写负载结构：

```json
[
  {
    "sid": 12439,
    "amazonOrderId": "amazon-order-id",
    "purchaseDateLocal": "2026-11-16 10:03:18"
  }
]
```

页面通信层还会再次校验 `confirmed === true`、批次为 1 至 20 笔、必填字段完整，然后只发送上述三个字段。请求超时 30 秒；401/403 会使当前会话失效并重新等待页面请求。

# 识别、分页与预览

`string[]` 形式的 `promotionIds` 直接逐项判断；字符串形式的标识按逗号、竖线或空白拆分。只要订单中有一个商品行命中 `vine.enrollment.`，订单即进入 Vine 集合。SKU、ASIN 和商品名称从命中的 Vine 商品行汇总，便于运营核对。

页面通信层在把订单传给插件窗口前，仅保留订单核对所需字段，不传递买家姓名、邮箱和地址。推广判定不依赖这些字段。

检查会读取整个日期范围内的全部销售订单页，不受订单列表当前页面筛选或排序影响。默认近 30 天；若超过 50 页或 10,000 笔，插件停止并要求缩小范围，避免静默截断。

待标预览提供市场分面、订单号/店铺/SKU/ASIN 搜索、勾选框、全选和清空。首次检查后默认勾选全部待标订单；运营必须在确认前取消本批不需要处理的订单。

“导出预览”只导出当前勾选订单，列为：生成时间、市场、店铺、订单号、订单状态、金额、SKU、ASIN、识别结果、拟用推广类型。CSV 仅用于核对，不会提交标注。

# 提交前复核、写入与回读

执行链路使用以下约束：

| 阶段 | 约束 |
|-|-|
| 选择快照 | 记录当前勾选订单及其订单指纹 |
| 提交前复核 | 重新扫描完整日期范围，不发送写请求；快照中任一订单不再待标即停止 |
| 最后确认 | 展示订单号、市场、店铺、状态、默认推广类型和修改范围；必须勾选人工核对项 |
| 本地意图 | 写入前先保存批次意图；保存失败则不发请求 |
| 分批提交 | 每批最多 20 笔，串行执行；单批失败即停止后续批次 |
| 结果回读 | 对已受理订单重新读取 `isAssessed`，不以接口受理代替成功 |
| 异常恢复 | 提交结果不明确时标记为待核实，阻止新写入并要求先只读回读 |

回读结果含义：

| 结果 | 判定 |
|-|-|
| 核验通过 | 回读找到订单，且 `isAssessed === 1` |
| 仍待标 | 回读找到订单，但 `isAssessed !== 1` |
| 回读未找到 | 当前检查范围和 Vine 集合中未找到订单 |
| 未回读 | 请求已受理，但回读整体失败 |
| 结果待核实 | 写请求响应不明确，不能判断领星是否受理 |
| 未提交 | 前序批次异常后，本批未发送 |

写请求失败后不自动重试。页面关闭或刷新也不会撤回领星已经受理的标注，因此提交过程中应保持当前页面和账号不变。

当前实现没有跨浏览器标签页的写锁。同一账号需要多人复核时，应在单一标签页完成一个批次，不要在两个标签页同时提交。

# 本地记录与隐私

原生扩展使用 `chrome.storage.local`，油猴版使用站点 `localStorage`，键名前缀为 `xynigo:lingxing-vine:`。主要键如下：

| 键 | 内容 |
|-|-|
| `lingxingVineCheckV1` | 最近一次检查摘要和待标订单核对字段 |
| `lingxingVineHistoryV1` | 最近 20 条检查/执行摘要 |
| `lingxingVineExecutionV1` | 最近一次执行批次及逐单结果 |
| `lingxingVineLauncherTopV1` | 页面入口的纵向位置 |

本机记录可包含订单号、市场、店铺、状态、金额、SKU、ASIN、执行时间和结果，用于复核及异常恢复。不会持久化会话头、Cookie、密码、买家姓名、邮箱或地址。清理浏览器站点数据会删除这些记录；不同浏览器和设备之间不会同步。

执行记录可导出为 CSV，列为：批次号、执行时间、市场、店铺、订单号、下单时间、金额、提交结果、回读结果、推广类型。

# 安全边界

- 原生扩展只申请 `storage` 权限和领星页面/网关域名访问权限。
- 页面主环境脚本只允许 `OrderList` 与 `setAssess` 两个路径。
- `setAssess` 必须同时满足人工确认、批次上限和字段白名单。
- 不持久化 `auth-token`、Cookie、请求头或密码。
- 不透传买家联系方式；界面和本地记录只保留业务核对字段。
- 不绕过登录、权限、限流或领星原生校验。
- 回读失败、会话变化、接口结构变化或结果不明确时停止，不自动循环重试。
- 关闭、停用插件或在领星撤销推广标记，都不是插件自动完成的回滚操作。

# 双渠道实现与发布

## 原生扩展

Manifest V3 使用两个执行环境：

- `src/page-session.js` 在 `MAIN` 世界、`document_start` 注入，观察页面请求并代理受限调用。
- `src/core.js` 与 `src/content.js` 在 `ISOLATED` 世界、`document_idle` 注入，使用 Shadow DOM 隔离界面和页面样式。

正式包为 GitHub Release 中的 ZIP。安装或更新时需要重新加载扩展并刷新领星页面。原生扩展没有商店自动更新。

## Tampermonkey

油猴版由同一份 `core.js`、`page-session.js`、`content.js` 和 `panel.css` 生成单文件程序，`@grant none`、`@run-at document-start`、`@noframes`，不依赖远程运行时代码。

固定分发地址：

| 文件 | 地址与职责 |
|-|-|
| 完整程序 | `scripts/lingxing-vine-promotion-assistant/lingxing-vine-promotion-assistant.user.js`，用于安装和下载更新 |
| 更新元信息 | `scripts/lingxing-vine-promotion-assistant/lingxing-vine-promotion-assistant.meta.js`，供 Tampermonkey 检查版本 |

Tampermonkey 按 `@updateURL` 检查更新，再从 `@downloadURL` 获取完整程序。更新是否自动安装取决于脚本管理器和网络设置；更新后刷新领星页面生效。

不要直接编辑生成的 `.user.js` 或 `.meta.js`，应修改扩展源码后重新构建。扩展与油猴版必须选择一种启用。

# 构建、测试与发布

在仓库根目录使用 Node.js 22：

```bash
npm run test:lingxing-vine
npm run build:lingxing-vine:userscript
npm run build:lingxing-vine
```

构建结果：

- `dist/lingxing-vine-promotion-assistant-dev/`：可直接加载的开发目录，必须直接包含 `manifest.json`。
- `dist/lingxing-vine-promotion-assistant-v0.1.4.zip`：正式扩展包。
- `scripts/lingxing-vine-promotion-assistant/` 下的 `.user.js` 和 `.meta.js`：油猴分发文件。

`npm run test:lingxing-vine` 会执行扩展测试、重新生成油猴文件并执行分发测试。测试覆盖 Vine 判定、已标口径、日期范围、分页上限、写负载、20 笔上限、提交前复核、回读分类、CSV、MV3 注入方式、会话头限制、买家字段隔离、入口拖动/展开和油猴更新元信息。

发布前应确认：

1. `manifest.json`、`package.json`、README/INSTALL 中的版本一致。
2. 扩展和油猴测试通过，生成的 `.user.js` 与 `.meta.js` 已提交。
3. 在干净提交上构建正式 ZIP，核对 ZIP 直接包含 `manifest.json`、资源完整、版本正确。
4. Release tag 使用 `lingxing-vine-promotion-assistant-v版本号`，资产包含扩展 ZIP、`.user.js`、`.meta.js`、安装说明和校验和。
5. 不从开发分支覆盖 `main` 的油猴更新地址，不替换同版本资产。

当前 `0.1.4` Release：

- 发布页：<https://github.com/wrangler1024/crossborder-userscripts/releases/tag/lingxing-vine-promotion-assistant-v0.1.4>
- 油猴一键安装：<https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-vine-promotion-assistant/lingxing-vine-promotion-assistant.user.js>

# 验证记录

## 自动测试

`0.1.4` 当前共 23 项自动测试：原生扩展 18 项，油猴生成与分发 5 项。覆盖范围见上一节。

## 真实接口只读验收

2026-11-16 使用真实领星订单页面完成只读检查：

- 近 30 天共 293 笔销售订单，分 2 页读取。
- 识别 Vine 订单 68 笔，其中已标 65 笔、待标 3 笔。
- 3 笔待标订单在检查时均为 `Pending`。
- 已验证真实会话观察、只读分页、Vine 识别、待标展示、市场筛选、搜索、勾选和预览导出。

公开文档不保留真实买家信息或具体订单号。需要复核时，以运营本地导出的预览和领星原生订单为准。

## 页面内模拟验收

完整提交、分批和回读状态机使用页面内模拟响应验收。模拟批次展示了待标订单、确认门禁和回读结果；网络监听确认该过程没有向真实 `setAssess` 发送请求。

## 运营验收

2026-11-16 运营测试确认插件可用、已验收。该结论说明运营侧已认可当前双渠道版本和操作流程；它不替代领星侧的逐批执行记录，也不把历史模拟结果表述为真实写入结果。

# 维护与排查

| 现象 | 优先检查 |
|-|-|
| 一直显示等待领星会话 | 刷新订单列表；确认页面曾发起正常领星网关请求；确认安装后已刷新页面 |
| 更新后仍是旧版 | 检查实际加载渠道、版本号、油猴脚本更新结果，并刷新领星页面 |
| 找不到页面入口 | 确认地址为订单列表、只启用一个渠道、窗口未被收起 |
| 订单被识别为已标但业务有疑问 | 核对订单 `isAssessed`；不能用 `isPromotion`、金额或买家字段替代 |
| 检查结果超限 | 缩小到近 7/30 天或按实际业务范围重查 |
| 提交前提示订单已变化 | 按刷新后的待标清单重新核对并确认，不能沿用旧快照 |
| 回读失败或结果待核实 | 先查看执行记录，再使用“回读上次批次”只读复核；不要直接重复提交 |
| 接口结构或页面组件升级 | 先在测试环境核对网关请求、分页结构和写负载，再更新插件 |

领星页面升级后，优先检查 `OrderList` 分页结构、`isAssessed` 字段、`promotionIds` 标识和 `setAssess` 请求格式。任何无法确认的变化都应停止发布，不通过扩大写入范围“兼容”。

# 文档与更新记录

- 开发文档：`extensions/lingxing-vine-promotion-assistant/DEVELOPMENT.md`
- 操作文档：`extensions/lingxing-vine-promotion-assistant/OPERATIONS.md`
- 安装说明：`extensions/lingxing-vine-promotion-assistant/INSTALL.md`
- 功能摘要：`extensions/lingxing-vine-promotion-assistant/README.md`

更新记录：

- 2026-11-16：整理开发背景、业务口径、双渠道架构、接口边界、执行与回读状态机、安全约束、测试发布流程和运营验收记录，适用 `0.1.4`。

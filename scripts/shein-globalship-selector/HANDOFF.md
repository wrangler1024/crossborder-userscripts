# Shein Global Selector 开发交接

## 里程碑

- 当前正式版本：`0.5.1`
- 当前本地候选：无
- Git 标签：`shein-globalship-selector-v0.5.1`
- 扩展包：`xynigo-shein-globalship-selector-v0.5.1.zip`
- 支持站点：SHEIN 美国站与墨西哥站桌面版
- 支持路由：搜索页 `/pdsearch/`、类目页 `-c-数字.html`、集合页 `-sc-数字.html`
- 明确不运行：商品详情、购物车、结算、账户和订单页

`0.5.1` 是第三阶段正式里程碑：在正式商品网格、翻页累计与导出闭环上，增加紧凑页面筛选、提交式数字输入、常用筛选模板，以及模板和当前筛选条件的浏览器持久化。

## 完成状态

### 交互与工作台

- 页面右侧为可上下拖动的 `SHEIN选品助手` 磁吸入口；默认收起为小犀头像，悬停展开。
- 底部工作台支持上下调节高度、最大化、收起，并保持在官方分页切换时稳定显示。
- 工具栏包含上一页、下一页、重新扫描、补全规格、清空筛选、复制链接、快捷键、导出已选和概览。
- Product 与 Sold by 列支持向右拉宽、键盘方向键调整和本机宽度持久化。
- Product 图片与标题均可打开对应的干净商品链接。
- Price / Coupon 卡片使用 340px 紧凑布局，Min / Max 输入区优先分配空间，自定义优惠券区收窄并与上方分割线对齐。
- 最小化后保留工具栏与整行筛选器，隐藏表格和概览；筛选条件同步隐藏当前 SHEIN 正式商品网格中的未命中卡片，推荐模块不受影响。
- Sales/Price/Coupon 输入只保存草稿，按 Enter 或点击“应用”时再一次应用；输入框获得焦点时延后后台补全、扫描与隐藏表格的 DOM 重建。
- 工具栏新增常用模板入口和快捷新建；每个模板保留“一键应用”“编辑”和“更多”三个入口，更多菜单包含覆盖、复制和两步确认删除。
- 模板按 MX/US 站点分别持久化，每站最多 12 套；应用模板不会清空累计商品或跨页勾选，模板启用后继续手动修改条件会标记为“已修改”。
- 扩展版模板、当前选中模板和筛选条件保存在 `chrome.storage.local`，关闭标签页或浏览器后恢复；首次升级会读取旧 `localStorage` 并迁移。工具栏顺序为“重新扫描 → 常用模板 → 清空筛选 → 补全规格”。

### 筛选与排序

- Fulfillment：GlobalShip / QuickShip 互斥筛选。
- 官方信号：Trends / New Arrivals。
- 规格：Single-Spec；`Single / Dual / —` 分别表示单规格、主次双规格、信息不足。
- 数值筛选：Sales、Price Min/Max、Coupon 65%/30%/0%/自定义、Rating All/4.0+/4.2+/4.5+。
- 首次仅开启 GlobalShip；其他条件不设限制。`All` 表示 Rating 不筛选。
- Page Price、Effective Price、Sales、Reviews、Listed On 支持数值或日期升降序。
- “清空筛选”只清条件，不清运营已勾选的商品。

### 商品数据与导出

- 表格字段：图片、Goods ID、Product SKU、标题、页面价、券后价、Sales、Rating、Reviews、Listed On、Spec Type、Pri Spec、Sec Spec、Fulfillment、Sold by、官方信号与决策。
- 复制商品链接默认取全部累计页面的筛选命中结果，去查询参数、去重、每行一条；复制范围可改为已选商品，默认快捷键为 `Alt+L`。
- 导出始终只导出勾选商品，支持跨页勾选，格式为 `.xlsx`；可选择把压缩主图直接插入单元格，导出期间显示进度。
- 页码优先读取 SHEIN 官方分页 `aria-current="page"`；URL `page` 参数仅作回退，避免 SPA 已回到第 1 页但 URL 残留旧页码。
- 只采集 SHEIN 正式商品网格，排除 `También podría gustarte`、空结果推荐和猜你喜欢；风险验证和空页不会用推荐商品生成页分组。
- 翻页累计与 SHEIN 当前页同步：第 1 页只保留第 1 页，第 2 页保留 1+2 页，返回前页时移除更高页数据与仅属于被移除页的选择。
- 页分组栏固定在表头下方，支持全选本页；跨页重复行保留展示，累计命中、复制和导出按 Goods ID 去重。

## 数据来源与不可破坏的口径

1. SHEIN 列表页数据优先，极鲸云匿名 `goods/card` 只补空值。
2. 非零 SHEIN Sales 不允许被第三方数据覆盖；页面 Sales 为 `0` 时，只有极鲸云同口径正销量才能兜底。
3. Listed On 只使用 `onSaleTime`，不能用采集库 `createTime` 冒充，也不能当作官方 New Arrivals。
4. Sold by 依次读取列表结构化店铺字段、可见店铺节点、`data-trend-label`、商品链接延迟写入的 `data-store_code`，最后才请求极鲸云。
5. 极鲸云请求必须 `credentials: omit`，不得携带 SHEIN Cookie、账号令牌或其他凭证。
6. `is_single_sku` 不是 Spec Type；不能再把 Multi-SKU、SKU 数量和主/次规格混为一列。
7. 信息不足时显示 `—`，不根据标题、品牌词或商品名推测店铺和规格。
8. GlobalShip 是当前业务定义下的国际配送候选，下单前仍需复核。

## 当前卡点

### Sold by 完整率

SHEIN 并非为所有列表商品公开店铺名。已验证部分商品即使拿到真实 `data-store_code`，SHEIN 列表、极鲸云 `goods/card` 和商品信息接口仍全部缺少店铺名称；此时保持 `—` 是正确行为，不是渲染失败。

2026-08-21 墨西哥样本页仍为空的复现 ID：`368765246`、`511994384`、`524238481`、`108961334`、`479401451`。这些 ID 只用于复现，页面和第三方数据可能随时间变化。

### 规格补全风控

- 详情结构化接口在高并发时会返回 `/risk/action/limit`，但商品页仍可能正常打开；这属于接口限流，不等同于 CAPTCHA。
- 当前固定 5 个 worker、全局请求启动间隔 300ms；触发限流后降为 1 并发，并按 15–60 秒冷却后续跑。
- 只有 `/risk/challenge` 才提示人工验证。不要再次把 8/20 并发直接上线。
- 页面未提供完整规格且接口持续限流时，Spec Type 会保持 `—`；插件不能补造 Single。

### 外部接口稳定性

- `api.sheinshuju.com` 当前匿名可用，但没有公开稳定性或兼容性承诺。
- 美国站公开 Sales 经常为 `0`，极鲸云也未必返回可用兜底。
- 任何第三方接口调整都必须先检查字段语义和来源优先级，不能为了填满表格覆盖 SHEIN 原值。

### 前台 DOM 漂移

SHEIN 会延迟写入图片和 `data-store_code`，也可能在 SPA 切换后留下过期 URL 参数。新增解析必须覆盖延迟属性、官方控件状态和页面局部重渲染，不能只测试首屏静态 DOM。

## 下一步计划

### P0：发布后稳定性

1. 在 US/MX 的搜索、类目、集合三类页面各保留一个回归样本。
2. 观察翻页、懒加载和极鲸云补全是否出现重复扫描、工作台跳动或失败缓存不重试。
3. `0.5.1` 发布后优先处理真实生产回归，较大功能继续通过原型和本地候选版本验收后再发布。

### P1：数据可观测性

1. 为 Sold by、Sales、Rating、Reviews、Listed On 增加更明确的来源/失败原因展示。
2. 在概览中区分“来源无值”“请求失败”“等待重试”，避免把所有 `—` 当成同一问题。
3. 研究 SHEIN 自身可稳定取得店铺名的详情结构化字段；在没有可靠来源前不增加推测型兜底。

### P1：规格链路

1. 为规格补全增加更清晰的剩余队列、冷却时间和逐项重试状态。
2. 继续验证 5 worker + 300ms 启动间隔在 US/MX 的长期稳定性。
3. 为 Single / Dual 增加更多真实结构化夹具，尤其是只有 Size、Color + Size、单 SKU 三类。

### P2：工程化

1. 增加 CI：测试、版本一致性、正式构建、ZIP 内容检查与敏感信息扫描。
2. 每次正式发布生成 SHA-256，并验证 Git 标签、Release、ZIP 内 manifest 三者版本一致。
3. 将长期变更日志从 README 的“已知限制”拆为独立 `CHANGELOG.md`。

## 踩坑经验

- 静态原型通过不等于插件通过；必须构建固定 dev 目录、在 `chrome://extensions/` 重载、刷新真实 SHEIN 页面。
- Comet 仍显示旧 UI 时，先检查扩展版本、已加载目录和页面刷新，不要立即怀疑代码。
- 图片不能优先取 `currentSrc/src`，其中可能是透明或灰色 `1x1` 占位图；先读 `data-src`、`data-srcset`、`data-original`。
- 翻页优先点击 SHEIN 官方分页控件；直接改 `location.href` 会导致工作台跳动或 SPA 状态错位。
- 页码不能只信 URL；SHEIN SPA 可能展示第 1 页但保留 `?page=3`。
- `data-store_code` 可能在首轮扫描后才写入；MutationObserver 必须监听相关属性并自动重扫。
- 瞬时请求失败不能永久缓存；极鲸云失败使用 5/10/20/40/60 秒指数退避。
- 规格接口的 `/risk/action/limit` 与真实 CAPTCHA 必须分开处理。
- 20 并发和 8 并发均实测快速触发限流；不要重复走这条路。
- `Styles`、`Multi-SKU`、SKU Qty、Spec Type 是不同概念；字段命名不清会直接导致筛选逻辑错误。
- 发版时不要把本地候选描述成已发布；必须核对远端 tag、GitHub Release、资产和哈希后再宣布完成。

## 关键路径与命令

- 主脚本：`scripts/shein-globalship-selector/shein_globalship_selector.user.js`
- 单元测试：`scripts/shein-globalship-selector/tests/selector.test.js`
- 扩展：`extensions/xynigo-shein-globalship-selector/`
- 静态原型：`docs/prototypes/xynigo-shein-selector-dashboard/`
- 本地开发目录：`dist/xynigo-shein-globalship-selector-dev/`

```bash
npm install
npm run test:xynigo-selector
npm run build:xynigo-selector:dev
npm run build:xynigo-selector
```

Comet 验收顺序：构建 dev 目录 → 扩展管理页重新加载 → 刷新 SHEIN 页面 → 核对版本、入口唯一性、分页、懒加载图片、筛选、模板的应用/编辑/更多菜单、列宽、复制和导出。

## 安全边界

- 不提交 Cookie、Token、API Key、账号、地址、订单或付款数据。
- 插件不加购、不下单、不写入妙手或其他采集箱。
- 不在公开仓库加入墨西哥代采项目的私有台账、账号或商业数据。
- 新 Agent 若要新增第三方数据源，必须先确认调用范围、字段语义、隐私和稳定性，再改代码。

# Shein Global Selector

> 当前正式版本：`0.3.21` 里程碑版

面向 SHEIN 运营选品的独立浏览器插件。它在商品列表页右侧增加 `SHEIN选品助手` 磁吸入口，并在页面底部打开可调高度、可最大化的 `Shein Global Selector` 工作台。

## 安装

- [Tampermonkey 一键安装 v0.3.21](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js)
- [下载 Chrome / Comet / HubStudio 通用扩展包 v0.3.21](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-globalship-selector-v0.3.21/xynigo-shein-globalship-selector-v0.3.21.zip)

两种安装方式只启用一种，避免页面重复运行。扩展包解压安装步骤见 [INSTALL.md](../../extensions/xynigo-shein-globalship-selector/INSTALL.md)。

## 支持范围

| 站点 | 搜索结果页 `/pdsearch/` | 类目页 `-c-数字.html` | 集合页 `-sc-数字.html` |
| --- | --- | --- | --- |
| SHEIN 美国站 `us.shein.com` | 支持 | 支持 | 支持 |
| SHEIN 墨西哥站 `shein.com.mx` / `www.shein.com.mx` | 支持 | 支持 | 支持 |

商品详情页、购物车、结算、账户和订单页面不会启动工作台。

## 当前功能

- 列表字段：商品主图、Goods ID、Product SKU（页面提供时）、标题、页面价、销量、Rating、Reviews、Listed On、Spec Type、Pri Spec、Sec Spec、Fulfillment、Sold by 和官方信号。
- Product 与 Sold by 列右侧均可拖拽扩宽并保存本机宽度；商品主图和标题均可在新标签页打开对应商品页。
- Page Price、Effective Price、Sales、Reviews 和 Listed On 支持升序/降序排列。
- 一期数据补全：Sold by 先读取 SHEIN 列表结构化字段、商品链接的 `data-store_code`、可见店铺节点和 `data-trend-label` 中的店铺编号/名称；仍缺失时，通过极鲸云匿名 `goods/card` 接口补全 Sold by、Sales、Rating、Reviews 和 Listed On。非零 SHEIN Sales 始终优先；仅当页面缺失销量，或页面为 `0` 且极鲸云返回正销量时才兜底。
- 极鲸云请求遇到扩展后台刚重载、网络瞬断或超时时，失败结果不再永久缓存；插件会以 5 / 10 / 20 / 40 / 60 秒上限的指数退避自动重试，重新扫描也会保留后续重试。
- Fulfillment：`GlobalShip` 与 `QuickShip` 独立筛选并互斥；商品卡出现精确 `Local` 或 `QuickShip` 标签时归入 QuickShip，其余作为 GlobalShip 候选。
- 筛选器：Single-Spec、Sales、Price、优惠券比例（65% / 30% / 0% / 自定义）、Rating All / 4.0 / 4.2 / 4.5、Trends、New Arrivals。
- `Single-Spec` 打开时只保留没有次规格的商品；只有主规格归为 `Single`，Color + Size 等主规格与次规格同时存在的商品归为 `Dual`，信息不足归为 `—`。
- Pri Spec / Sec Spec 的规格名显示为主文字，可选值数量显示在下方小字；例如 `Color` 下方的 `37` 表示37个主规格选项，不代表37个 SKU。
- 首次使用只默认开启 GlobalShip；Single-Spec、Sales、Price、Coupon、Rating 和官方信号均不设限制，避免“已扫描但零命中”。
- 墨西哥代采可手动设置业务模板：65% OFF、折后价不低于 MXN 100，再按任务要求设置销量和 Rating；美国站同样由运营按任务输入金额与比例。
- “复制商品链接”默认复制当前页全部筛选命中商品；可在快捷键设置中切换为“已选商品”。链接会去除查询参数与锚点、自动去重并按每行一条写入剪贴板。
- 复制快捷键默认 `Alt+L`，支持自定义为包含 Alt、Ctrl 或 Command 的组合键；快捷键和复制范围保存在本机浏览器。
- “清空筛选”一键关闭全部筛选条件，但不会清除已经勾选的商品；“导出已选”始终只导出勾选商品。
- 导出 `.xlsx`：一商品一行；导出前可选择是否把主图直接插入 Excel 单元格，不生成 ZIP。
- 选择导出图片时，浏览器端将主图压缩为约 60×80 px 的低质量 JPEG；单张图片失败只在该行写入“图片获取失败”，不影响其他商品导出。
- 翻页、重新扫描、窗口上下调节与最大化。
- 底部工作台随浏览器宽度自适应：中等宽度收紧工具栏，窄屏保持筛选器和商品表格可滚动，选品概览可按需展开。

## 导出字段

站点、页面类型、关键词/类目、页码、扫描时间、Goods ID、Product SKU、商品标题、商品链接、商品主图、主图 URL、币种、原价、页面价、优惠券 OFF %、支付比例 %、折后价、销量原文、销量下限、星级、评论数、上架日期、规格类型、主规格、次规格、SKU Qty、Fulfillment、Sold by、店铺类型、Trends、New Arrivals、Best Seller、Almost sold out、Repeat customers、Other sellers、筛选结果、未命中原因、筛选条件。

## 数据边界

- 优先显示 SHEIN 列表页可直接取得的数据；缺失的 Sold by、Sales、Rating、Reviews 和 Listed On 才尝试用极鲸云补全，仍缺失时写 `—`。例外是 SHEIN Sales 明确显示 `0` 而极鲸云的同口径 `sold` / `last90DaysSoldNum` 返回正数时，允许以极鲸云值兜底并标注来源。
- 极鲸云 Sales 只接受与“最近销量”对应的 `sold` / `last90DaysSoldNum`，不用 `totalSold` 冒充前台 Sales；当前匿名样本的该字段经常为空。
- Listed On 只使用极鲸云 `onSaleTime`，不用采集库 `createTime` 冒充上架日期，也不把它当作 SHEIN 官方 New Arrivals 标签。
- 规格结构优先读取列表结构化数据中的主规格、SKU 规格定义及可选值；`relatedColorNew`/官方 Colorways 用于识别 Color 维度，`is_single_sku` 只辅助确认当前商品是否还有 SKU 规格，不能直接当作“多规格”。
- 当前 US/MX 列表页未提供完整规格定义时，规格名称、可选值数量或 `SKU Qty` 先显示 `—`；开启 `Single-Spec` 或主动点击“补全规格”后，插件通过同站点公开结构化详情接口补齐，无需真实打开每个商品页。信息不足的商品不会被 `Single-Spec` 筛选器误判为命中。
- 星级可从五个官方星级图标换算到 0.1 精度，用于 4.0 / 4.2 / 4.5 门槛筛选。
- `GlobalShip` 是按当前业务定义得出的国际配送候选，最终发货方式仍需在详情页或下单前复核。
- 插件不读取 Cookie、密码、地址、付款、订单或妙手数据；不加购、不下单，也不会把商品链接提交到妙手或其他采集箱。
- 数据补全请求只向 `api.sheinshuju.com/api/v1/goods/card` 发送 Goods ID、店铺 `store_code`/发现出的 `mallId` 和站点代码，使用 `credentials: omit`，不附带 SHEIN Cookie 或极鲸云账号令牌。该接口未提供公开稳定性承诺，返回空值或失败时插件保持 `—`。
- 只有用户勾选“将商品主图插入 Excel”并点击导出时，扩展才通过受限后台请求读取 SHEIN 图片 CDN；请求不携带站点凭据，单张上限 5 MB。

## 本地构建与测试

```bash
npm install
npm run test:xynigo-selector
npm run build:xynigo-selector:dev
```

首次在 Comet 开发者模式中选择固定目录 `dist/xynigo-shein-globalship-selector-dev/`。后续每次改动只需重新执行上述开发构建，在扩展管理页点击“重新加载”，并刷新 SHEIN 页面。

本地验收通过后再执行：

```bash
npm run build:xynigo-selector
```

正式 ZIP 产物位于 `dist/xynigo-shein-globalship-selector-v<版本号>.zip`。

## 开发验收重点

1. 在 US/MX 各打开一个搜索页和一个类目页，共四种组合。
2. 验证入口、底部工作台、页面币种和默认条件。
3. 分别核对至少一个 GlobalShip 商品和一个带 Local/QuickShip 标签商品。
4. 分别核对一个 `Single`、一个 `Dual` 和一个信息不足的商品，确认 `Single-Spec` 只命中 `Single`；同时核对 Reviews 独立列及规格数量小字。
5. 分别向右拖动 Product 与 Sold by 表头分割线，确认列宽增加、刷新后保留且页面水平滚动正常；分别点击主图和标题，确认新标签页打开正确商品链接。
6. 不勾选商品直接复制，确认默认复制当前页全部筛选命中结果，且一行一条、没有 `mallCode` 等跟踪参数；再验证自定义快捷键与“已选商品”范围。
7. 各导出一次不含图片和包含图片的 Excel，确认行数、字段、图片单元格及失败降级。

## 已知限制

- 2026-08-21 已核对 US/MX 搜索页与类目页的真实商品卡结构；SHEIN 前台 class 名或结构化字段变化后仍需重新验收。
- 列表页未公开精确 SKU 数量、规格或店铺字段时，插件不会补造数据。
- 0.3.2 优先触发 SHEIN 官方分页控件，找不到时才回退到 `page` 查询参数；若某个专题页使用其他分页协议，需要为该路由增加适配器。
- 0.3.3 不再把列表页“只观察到 Color”直接判为 Single；开启 Single-Spec 筛选时，会对先通过其他筛选条件的待确认商品限并发读取详情规格，并按站点 + Goods ID 缓存结果。
- 0.3.4 增加“补全规格”按钮，可独立补采当前页全部待确认商品；详情规格依次从完整 `gbRawData`、JSON-LD 和详情 DOM 规格组中解析。失败结果只短期缓存，点击按钮可立即重试。
- 0.3.5 改用 SHEIN 详情页同款结构化数据接口补全规格；US 请求传入匹配的 `mallCode`，MX 使用墨西哥站参数。一旦识别到 SHEIN 验证码/风控页就暂停剩余请求；失败标记支持悬停和点击查看具体原因。
- 0.3.6 将规格补全从串行升级为 3 并发，每个 worker 仍保留请求间隔。任一并发请求命中风控时，立即取消其他在途请求，未完成商品恢复为待补全状态。
- 0.3.7 按运营测试需求将规格补全提高到固定 20 并发；任一请求命中风控时，取消其他仍在途的请求，不再发出下一批。
- 0.3.8 根据 20 并发触发接口级风控的实测结果，将规格补全回调为固定 8 并发，保留在途请求取消与下一批阻断机制。
- 0.3.9 保留 8 个工作 worker，但将全局请求启动时间错开 300ms，避免首批 8 个请求同时打向规格接口。如第一个请求已命中接口限流，尚未启动的 worker 队列会立即取消。
- 0.3.10 将规格补全降为 5 个 worker，继续使用全局 300ms 请求启动间隔。单元测试验证最大在途请求不超过 5，且首个请求命中限流时可在第 2 个请求启动前取消队列。
- 0.3.11 将 `/risk/action/limit` 与真实 CAPTCHA 拆分：前者标记为规格接口限流，无需人工验证。限流后本页降为 1 并发，冷却时间从 15 秒指数增长到最高 60 秒；点击“补全规格”可排队，冷却结束后自动续跑。只有 `/risk/challenge` 才提示人工验证。
- 0.3.12 增加极鲸云匿名数据一期补全与 On Sale 列；所有补全字段只填空值，不覆盖 SHEIN 数据，并保留公开销量 `0`。
- 0.3.14 首次打开仅默认启用 GlobalShip，销量、价格、优惠券、星级和 Single-Spec 均保持未筛选；旧会话执行一次筛选迁移，避免“已扫描但零命中”被误认为扫描失败。零命中时表格仍显示明确的清空筛选引导。
- 0.3.15 解析 SHEIN 商品卡原生 `data-trend-label`，修复可见 Trends 标签统计为 0；列表缺少 `store_code` 时通过 Goods ID 两段式发现 `mallId` 并补全 Sold by；表头 `ON SALE` 更名为语义更准确的 `LISTED ON`。
- 0.3.16 从 SHEIN 列表结构化字段、可见店铺节点和 `data-trend-label` 中直接提取 Sold by / `storeCode`；页面 Sales 为 `0` 时，仅允许极鲸云返回的正 `sold` / `last90DaysSoldNum` 兜底，不覆盖任何非零页面销量。
- 0.3.17 修复极鲸云瞬时请求失败被永久缓存的问题；改为指数退避自动重试，避免同一页一批商品的 Sold by、Rating、Reviews 和 Listed On 长期为空。
- 0.3.18 直接读取 SHEIN 商品链接公开的 `data-store_code`，用真实店铺编号请求极鲸云；修复占位 `mallId=1` 无法反查部分 Sold by 的问题。
- 0.3.19 监听 SHEIN 延迟写入商品链接的 `data-store_code`；属性出现后自动重扫并触发店铺补全，无需人工点击“重新扫描”。
- 0.3.20 Rating 下拉框增加可重复选择的 `All` 选项；选择后取消星级限制，效果与默认状态及“清空筛选”一致。
- 0.3.21 Sold by 列增加可持久化的横向拉宽手柄；页码优先读取 SHEIN 官方分页的 `aria-current="page"`，修复 SPA 已回到第 1 页但 URL 残留旧 `page` 参数时的误报。

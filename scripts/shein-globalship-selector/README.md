# Shein Global Selector

> 当前状态：`0.2.0` 正式版

面向 SHEIN 运营选品的独立浏览器插件。它在商品列表页右侧增加 `SHEIN选品助手` 磁吸入口，并在页面底部打开可调高度、可最大化的 `Shein Global Selector` 工作台。

## 安装

- [Tampermonkey 一键安装 v0.2.0](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js)
- [下载 Chrome / Comet / HubStudio 通用扩展包 v0.2.0](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-globalship-selector-v0.2.0/xynigo-shein-globalship-selector-v0.2.0.zip)

两种安装方式只启用一种，避免页面重复运行。扩展包解压安装步骤见 [INSTALL.md](../../extensions/xynigo-shein-globalship-selector/INSTALL.md)。

## 支持范围

| 站点 | 搜索结果页 `/pdsearch/` | 类目页 `-c-数字.html` | 集合页 `-sc-数字.html` |
| --- | --- | --- | --- |
| SHEIN 美国站 `us.shein.com` | 支持 | 支持 | 支持 |
| SHEIN 墨西哥站 `shein.com.mx` / `www.shein.com.mx` | 支持 | 支持 | 支持 |

商品详情页、购物车、结算、账户和订单页面不会启动工作台。

## 当前功能

- 列表字段：商品主图、Goods ID、Product SKU（页面提供时）、标题、页面价、销量、星级、评论数、Multi-SKU、Styles/Colorways、Fulfillment、Sold by 和官方信号。
- Fulfillment：`GlobalShip` 与 `QuickShip` 独立筛选并互斥；商品卡出现精确 `Local` 或 `QuickShip` 标签时归入 QuickShip，其余作为 GlobalShip 候选。
- 筛选器：Sales、Price、优惠券比例（65% / 30% / 0% / 自定义）、Rating 4.0 / 4.2 / 4.5、Trends、New Arrivals。
- 墨西哥站默认业务条件：65% OFF、折后价不低于 MXN 100、销量不低于 1,000、Rating 4.5+、GlobalShip。
- 美国站默认不预设价格下限，优惠券默认为 0%；运营可自行输入金额和比例。
- “复制商品链接”默认复制当前页全部筛选命中商品；可在快捷键设置中切换为“已选商品”。链接会去除查询参数与锚点、自动去重并按每行一条写入剪贴板。
- 复制快捷键默认 `Alt+L`，支持自定义为包含 Alt、Ctrl 或 Command 的组合键；快捷键和复制范围保存在本机浏览器。
- “清空筛选”一键关闭全部筛选条件，但不会清除已经勾选的商品；“导出已选”始终只导出勾选商品。
- 导出 `.xlsx`：一商品一行；导出前可选择是否把主图直接插入 Excel 单元格，不生成 ZIP。
- 选择导出图片时，浏览器端将主图压缩为约 60×80 px 的低质量 JPEG；单张图片失败只在该行写入“图片获取失败”，不影响其他商品导出。
- 翻页、重新扫描、窗口上下调节与最大化。

## 导出字段

站点、页面类型、关键词/类目、页码、扫描时间、Goods ID、Product SKU、商品标题、商品链接、商品主图、主图 URL、币种、原价、页面价、优惠券 OFF %、支付比例 %、折后价、销量原文、销量下限、星级、评论数、多规格、款式数、规格、SKU Qty、Fulfillment、Sold by、店铺类型、Trends、New Arrivals、Best Seller、Almost sold out、Repeat customers、Other sellers、筛选结果、未命中原因、筛选条件。

## 数据边界

- 列表页能直接取得的数据才会显示和导出；缺失字段写 `—`，不推测。
- `Multi-SKU` 可依据列表结构化数据中的 `is_single_sku` 判断，`Styles` 可依据 `relatedColorNew` 等列表数据统计。
- 当前 US/MX 列表页未提供上述 JSON 时，插件会读取商品卡的官方 Colorways 计数；大于 1 时可确认 `Multi-SKU = Yes`，只有 1 款时仍保留为待确认。星级可从五个官方星级图标换算到 0.1 精度，用于 4.0 / 4.2 / 4.5 门槛筛选。
- 精确规格和 `SKU Qty` 通常需要商品详情页数据；0.2.0 不会为了这些字段自动打开详情页，因此缺失时显示 `—`。
- `GlobalShip` 是按当前业务定义得出的国际配送候选，最终发货方式仍需在详情页或下单前复核。
- 插件不读取 Cookie、密码、地址、付款、订单或妙手数据；不加购、不下单，也不会把链接提交到后台服务。
- 只有用户勾选“将商品主图插入 Excel”并点击导出时，扩展才通过受限后台请求读取 SHEIN 图片 CDN；请求不携带站点凭据，单张上限 5 MB。

## 本地构建与测试

```bash
npm install
npm run test:xynigo-selector
sh extensions/xynigo-shein-globalship-selector/build.sh
```

构建产物位于 `dist/xynigo-shein-globalship-selector-v0.2.0.zip`。

## 开发验收重点

1. 在 US/MX 各打开一个搜索页和一个类目页，共四种组合。
2. 验证入口、底部工作台、页面币种和默认条件。
3. 分别核对至少一个 GlobalShip 商品和一个带 Local/QuickShip 标签商品。
4. 不勾选商品直接复制，确认默认复制当前页全部筛选命中结果，且一行一条、没有 `mallCode` 等跟踪参数；再验证自定义快捷键与“已选商品”范围。
5. 各导出一次不含图片和包含图片的 Excel，确认行数、字段、图片单元格及失败降级。

## 已知限制

- 2026-08-21 已核对 US/MX 搜索页与类目页的真实商品卡结构；SHEIN 前台 class 名或结构化字段变化后仍需重新验收。
- 列表页未公开精确 SKU 数量、规格或店铺字段时，插件不会补造数据。
- 0.2.0 的上一页/下一页按 `page` 查询参数导航；若某个 SHEIN 专题页使用不同的分页协议，需要为该路由增加适配器。

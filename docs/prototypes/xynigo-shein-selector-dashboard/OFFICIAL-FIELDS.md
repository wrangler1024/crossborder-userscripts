# SHEIN 官方商品字段扩展研究

查询日期：2026-08-21

适用站点：SHEIN México 前台

用途：Shein Global Selector 选品字段规划，不代表 SHEIN 开放平台接口承诺。

## 结论

`Trends` 与 `New Arrivals` 均有 SHEIN 官方集合页，可作为官方选品信号。它们适合做“是否进入官方集合”的布尔筛选，但不是商品精确上架日期，不能直接换算成“近 7 天 / 近 30 天”。

当前墨西哥站搜索结果的结构化商品对象已经提供 `is_single_sku`、`relatedColorNew` 和 `isSkcMultiPrice`，因此可以在搜索页直接做“单 SKU / 多 SKU”和“关联颜色款数”初筛。但搜索对象没有 `sku_list`、尺码列表或完整规格组合，精确 SKU 数量及规格层级仍需进入详情页补采。

## 字段优先级

| 优先级 | 字段 | 官方前台来源 | 选品价值 | 实现建议 |
|---|---|---|---|---|
| P0 | GlobalShip / QuickShip / Local | 搜索卡片、配送标签 | 区分国际配送与本土发货 | 保留独立筛选器 |
| P0 | 当前价、原价、折扣率 | 搜索卡片、详情页 | 成本空间、促销强度 | 原值采集；券后价另行计算 |
| P0 | 销量文本 | 搜索卡片 | 基础需求验证 | 保存原始文本和归一化下限，如 `1.7k+ → 1700` |
| P0 | Rating、评价数量 | 搜索卡片或详情页（页面发布时） | 质量与社会证明 | 分字段保存，缺失不补造 |
| P0 | Trends 集合成员 | 官方 `/trends/` 集合页或官方标签 | 趋势性 | 记录命中集合 URL 与扫描时间 |
| P0 | New Arrivals 集合成员 | 官方 `/new/` 集合页或 `Novedades` 标签 | 新品发现 | 只保存布尔信号，不推导上架日期 |
| P1 | Best Seller 排名及类目 | 搜索卡片，例如 `#4 Más vendidos` | 类目竞争力强于单独销量 | 保存排名数字和排名类目 |
| P1 | Almost sold out | 搜索卡片，例如 `¡Casi agotado!` | 需求热度与断货风险 | 作为布尔信号，不推算库存件数 |
| P1 | Repeat customers | 搜索卡片，例如 `Clientes habituales` | 复购与稳定需求 | 作为布尔信号 |
| P1 | Other sellers 数量 | 搜索卡片，例如 `2 otros vendedores` | 同款竞争程度 | 保存卖家数量，不等同于跟卖利润 |
| P1 | 品牌 / 店铺名称 | 搜索卡片、详情页 | 品牌风险与店铺聚类 | 与商品 ID 分开存储 |
| P1 | 单 SKU / 多 SKU | 搜索结果结构化字段 `is_single_sku` | 排除单规格或控制采购复杂度 | 直接做布尔筛选；保存原始值 |
| P1 | 关联颜色款数 | 搜索结果 `relatedColorNew` | 判断颜色丰富度与同款扩展空间 | 计数作为 `Colorways`，不等同于 SKU 总数 |
| P1 | 官方质量反馈人数 | 详情页 `Quality` 文案 | 质量口碑辅助判断 | 保存官方原文和人数，不替代星级 |
| P1 | 评论日期与评论变体 | 详情页评价 | 观察近期活跃度、尺码和颜色反馈 | 评论日期不是商品上架日期 |
| P1 | SKU、商品 ID、商品链接 | 详情页、URL | 去重、追踪与导出 | SKU 与前台商品 ID 不混为一个字段 |
| P2 | 精确 SKU 数量、规格层级 | 详情页 `modules.saleAttr` | 控制变体复杂度、采集工作量 | 统计 `multiLevelSaleAttribute.sku_list`，并按规格名去重 |
| P2 | 颜色、可售尺码 | 详情页 | 变体丰富度与可售性 | 保存可见选项；库存状态单独处理 |
| P2 | 材质、成分、弹性、版型、风格 | 类目筛选、详情属性 | 质量判断、退货风险、产品匹配 | 详情页按原始属性键值保存 |
| P2 | 领口、袖长、长度、透明度、护理方式、件数 | 详情属性 | 细分类选品与履约描述 | 按类目动态扩展，不强制所有商品同构 |
| P2 | 类目、颜色、价格区间、活动场景等官方筛选属性 | 官方集合/列表页 | 批量缩小选品范围 | 保存筛选维度和站点语言原文 |

## 搜索页可直接扩展

优先考虑不需要逐个打开详情页的字段：

- 折扣率、当前价、销量文本。
- Best Seller 排名与所属细分类目。
- Almost sold out、Repeat customers 等官方运营标签。
- Other sellers 数量。
- 品牌/店铺名称、Local 标签及官方集合信号。
- `is_single_sku`：可直接判断单 SKU / 多 SKU。
- `relatedColorNew.length`：可作为关联颜色款数；它不是完整 SKU 组合数。
- `isSkcMultiPrice`：只适合表示同一款下是否存在多价信号，不应当代替多规格判断。
- SHEIN 在特定类目公开的材质、成分、版型、弹性、颜色、尺码和价格筛选维度。

## 详情页补采字段

- `multiLevelSaleAttribute.sku_list`：当前颜色商品的精确 SKU 数量、每个 SKU 的规格值和库存状态。
- `mainSaleAttribute.info`：关联颜色款列表；结合 `sku_list[].sku_sale_attr` 可判断颜色、尺码等规格层级。
- SKU、颜色列表、尺码列表、官方 Shipping Type。
- 原价与当前价。
- Material、Composition、Fit Type、Style、Occasion、Neckline、Sleeve Length、Length、Fabric Elasticity、Sheer、Care Instructions、Number of Pieces 等属性。
- Rating、评价量、官方质量反馈人数、评论日期和评论对应颜色/尺码（仅在页面实际发布时采集）。

## 不应当包装成官方字段

- 精确上架时间戳：当前前台集合身份和 `Novedades` 标签不足以证明具体发布时间。
- 精确库存件数：`Almost sold out` 只表示官方紧迫标签。
- 精确销量：`100+ / 1.7k+` 是区间化展示，只能归一化为下限。
- 内部趋势分、GMV、转化率、广告投放量：前台未公开时只能标记为缺失，不能推测为官方数据。
- 券后价：属于插件根据页面价格和运营输入优惠比例计算的衍生字段，必须保留计算参数与来源价格。

## 变体筛选口径

建议拆成三个字段，不把不同含义合并为一个“变体数量”：

1. `Multi-SKU`：搜索页 `is_single_sku === "0"`，可直接快速筛选。
2. `Colorways`：搜索页 `relatedColorNew.length`，表示关联颜色款数量。
3. `SKU Qty`：详情页当前商品 `sku_list.length`，表示当前颜色下的实际 SKU 数量；如需全颜色的完整组合数，需要继续逐个颜色款补采。

2026-08-21 实测商品 `454654532`：搜索页为 `is_single_sku = "0"`、`Colorways = 6`；详情页当前颜色的 `sku_list = 6`，规格名为 `Size`。这证明搜索页能先判断是否多 SKU，但不能仅凭搜索页准确计算完整颜色 × 尺码组合数。

## 官方页面证据

- Trends：<https://www.shein.com.mx/trends/TRENDS-sc-0061875330.html>
- New Arrivals：<https://www.shein.com.mx/new/New--Arrivals-sc-002309999.html>
- New in 60 Days 示例：<https://www.shein.com.mx/new/T-shirts-New-in-60-Days-sc-00200202.html>
- 搜索页变体字段实测：<https://www.shein.com.mx/pdsearch/playeras%20mujer/>
- 详情页 SKU 列表示例：<https://www.shein.com.mx/Sweet-Spicy-Style-Sakura-Pink-Ombre-Short-Sleeve-T-Shirt-Korean-Loose-Letter-Print-Tee-Ins-Aesthetic-Casual-Summer-Y2K-Aesthetic-p-454654532.html>
- 商品详情字段示例：<https://www.shein.com.mx/SHEIN-BASICS-Women-Casual-Basic-Solid-Color-Round-Neck-Long-Sleeve-Oversized-Cropped-Cardigan-Autumn-For-Women-Office-School-Light-Red-p-68976337.html>

页面字段和集合内容会随站点、类目、实验分组和时间变化；开发时需要保存原始文本、站点、页面 URL 与扫描时间。

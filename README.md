# 🛒 crossborder-userscripts

> 跨境电商团队 · 效率油猴脚本集合

为团队统一维护的 Tampermonkey 用户脚本库。团队成员只需安装一次 Tampermonkey，再安装已开放分发的脚本；脚本通过 `@updateURL` 自动同步后续版本。

> 安全约定：迁移脚本在完成当前平台实测前不直接开放给运营。涉及删除、审核、上下架、议价、库存修改等写入操作的脚本，必须先用测试账号和小批量数据验收。

---

## 📋 已开放分发

| 脚本 | 解决的问题 | 一键安装 |
|---|---|---|
| **领星 ERP 禁用双指滑动后退** | 在领星查看宽表格（如「产品表现」）时，左右拖动误触发浏览器后退 | [一键安装](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-disable-swipe-back/lingxing-disable-swipe-back.user.js) |

## 🧪 新开发脚本（待验收）

| 脚本 | 主要用途 | 当前状态 | 一键安装 | 说明 |
|---|---|---|---|---|
| **Shein Global Selector** | 美国站/墨西哥站搜索页、类目页和集合页选品工作台；支持 GlobalShip/QuickShip、销量、价格、优惠券、星级、官方标签筛选，链接复制与 Excel 导出 | **v0.2.0·只读选品** | **[Tampermonkey v0.2.0](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js)** / **[Chrome + Comet + HubStudio 通用包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-globalship-selector-v0.2.0/xynigo-shein-globalship-selector-v0.2.0.zip)** | [功能说明](./scripts/shein-globalship-selector/README.md) |
| **Xynigo SHEIN 商品型号助手** | 通用校验主规格、次规格、实时售价和单规格 SKU，生成精简精准链接，通过按钮或自定义快捷键复制三行采购信息 | **墨西哥站试运行·只读** | **[Tampermonkey v0.1.15](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-product-variant-helper/shein_product_variant_helper.user.js)** / **[Chrome + HubStudio 通用包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-variant-helper-v0.1.15/xynigo-shein-variant-helper-v0.1.15.zip)** | [功能说明](./scripts/shein-product-variant-helper/README.md) |
| **Xynigo 店小秘运营采购助手** | 在店小秘待审核订单详情中录入逐商品采购链接、规格、指导价和采购数量，并计算预估采购成本与利润指标 | **v0.1.45·公开预览** | **[Tampermonkey 一键安装](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-purchase-assistant/xynigo_dxm_purchase_assistant.user.js)** / **[Chrome + Comet 通用包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/dxm-purchase-assistant-v0.1.45/xynigo-dxm-purchase-assistant-v0.1.45.zip)** | [功能说明](./extensions/xynigo-dxm-purchase-assistant/README.md) |

## 🧪 前 IT 脚本迁移区（待验收）

以下脚本从原公司业务工具仓库迁移，源码已纳入本仓库并切换自动更新地址。状态为“暂停分发”的脚本不得直接发给运营安装。

| 脚本 | 主要用途 | 当前状态 | 说明 |
|---|---|---|---|
| Amazon 搜索页加载全部商品 | 合并全部搜索分页、清理部分广告位 | 待验收 | [说明](./scripts/amazon-all-products-on-one-page/README.md) |
| Amazon 物流验证 | 批量查询物流号并导出 Excel | 业务口径待确认 | [说明](./scripts/amazon-track/README.md) |
| 店小秘 ASIN 转链接 | 按订单国家生成 Amazon 商品链接 | 待验收 | [说明](./scripts/asin-to-link/README.md) |
| 店小秘删除图片 | 批量删除指定页之后的图片 | **暂停分发·高风险** | [说明](./scripts/dxm-delete-image/README.md) |
| Samforo 工具箱 | 店小秘、Amazon、TikTok、1688、物流综合辅助 | 待拆分验收 | [说明](./scripts/dxm-erp-review-assistant/README.md) |
| 店小秘批量发缺货 | 批量提交 SHEIN 虚拟发货缺货 | **暂停分发·高风险** | [说明](./scripts/dxm-send-out-of-stock/README.md) |
| 店小秘批量填写跟踪号 | 把剪贴板物流号依次填入发货窗口 | 待验收 | [说明](./scripts/dxm-ship-without-order/README.md) |
| 店小秘提取品牌词 | 从 SHEIN 商品标题提取疑似品牌首词 | 待验收 | [说明](./scripts/extract-brand-words/README.md) |
| 妙手 SHEIN 采集箱工具 | 原计划处理指定站点商品 | **暂停分发·代码未完成** | [说明](./scripts/miaoshou-europe-cjx/README.md) |
| 妙手批量采集 | 根据 Amazon 链接提取变体并尝试触发采集 | **暂停分发·依赖待确认** | [说明](./scripts/ms-batch-plugin-collection/README.md) |
| OZON 批量修改库存 | 批量设置当前商品库存 | **暂停分发·高风险** | [说明](./scripts/ozon-modify-inventory/README.md) |
| 店小秘核价审核助手 | 抓取 Amazon 价格并写备注、审核订单 | **暂停分发·旧财务口径** | [说明](./scripts/price-assistant/README.md) |
| SHEIN 批量议价 | 批量接受平台建议价 | **暂停分发·高风险** | [说明](./scripts/shein-agree-to-negotiate-price/README.md) |
| SHEIN 导出议价待确认 | 导出议价数据到 Excel | 待验收 | [说明](./scripts/shein-export-pending-confirmation/README.md) |
| SHEIN 提取活动 SKC | 导出当天零点前上架的 SKC | 待验收 | [说明](./scripts/shein-extract-product-list/README.md) |
| SHEIN 批量上下架 | 按站点和 SKC 批量修改上下架状态 | **v2.0.0·安全改造完成·待测试店验收** | [HubStudio / Chrome 测试包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-batch-shelf-v2.0.0/xynigo-shein-batch-shelf-v2.0.0.zip) / [说明](./scripts/shein-batch-shelf/README.md) |

---

## 🚀 快速开始（团队新人必读）

1. **装 Tampermonkey**（一次性）—— 见 [安装教程](./docs/how-to-install.md)
2. **点“已开放分发”脚本旁的「一键安装」** —— Tampermonkey 自动弹确认框，点安装即可
3. 完事。打开目标网站直接用

详细的图文教程和常见问题：👉 **[docs/how-to-install.md](./docs/how-to-install.md)**

---

## 📁 仓库结构

```
crossborder-userscripts/
├── README.md                # 你现在看的这个
├── docs/
│   └── how-to-install.md    # Tampermonkey 安装图文教程
├── extensions/              # Chrome/HubStudio 通用扩展打包配置
└── scripts/
    └── <脚本名>/
        ├── README.md        # 脚本说明 + 原理 + 已知限制
        └── <脚本名>.user.js # 脚本本体
```

后续新增脚本都按 `scripts/<脚本名>/` 这个结构组织，每个脚本自带独立说明文档。迁移脚本完成实测后，才从“待验收”移动到“已开放分发”。

---

## 🔧 技术约定（给脚本作者）

为了保证脚本能在团队内稳定分发和自动更新，新增脚本时请遵守：

- 文件名以 **`.user.js`** 结尾 —— 浏览器/Tampermonkey 据此识别为用户脚本，点击链接才会触发自动安装框
- **必须有 `@version`**，每次修改递增
- **必须配置 `@downloadURL` 和 `@updateURL`**，指向本仓库的 raw 链接，保证自动更新可用：
  ```
  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/<脚本名>/<脚本名>.user.js
  ```
- 用 `@match` 精确限定生效域名，避免影响其他网站
- 推荐加 `@icon`（可用 Google Favicon 服务），方便团队成员在脚本列表辨认
- 每个脚本独立子目录，配 `README.md` 说明用途、原理和已知限制

---

## 🤝 贡献与反馈

- Bug 反馈 / 需求建议：[提交 Issue](https://github.com/wrangler1024/crossborder-userscripts/issues)
- 欢迎团队成员提交 PR 补充新脚本

---

## 📄 License

[MIT](./LICENSE) —— 自由使用、修改、分发。

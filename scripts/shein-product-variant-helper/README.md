# Xynigo SHEIN 商品型号助手

> 当前状态：**待实页验收（只读）**
> 版本：`0.1.0`

## 功能

- 仅在 SHEIN 商品详情页显示“解析商品型号”悬浮按钮。
- 按钮可拖动，并保存上次位置。
- 解析商品层 `goods_id` / `goods_sn` / `productRelationID` / 颜色。
- 解析每个尺码的 `attr_value_id` / `sku_code` / 页面库存 / 价格。
- 识别当前在 SHEIN 页面选中的尺码，生成精确型号键：

  ```text
  站点:goods_id:sku_code
  例：US:312187195:I3c0auhysow1
  ```

- 可复制当前型号摘要，或单独复制某个尺码的精确采购链接。

## 支持站点

- SHEIN 美国站：`https://us.shein.com/*`
- SHEIN 墨西哥站：`https://shein.com.mx/*` 及其子域名

## 数据来源与校验

脚本优先解析当前 HTML 中的 `window.gbRawData`，并使用 `goodsDetailSchema` JSON-LD 补充价格、可售状态和精确型号 URL。

复制前强制检查：

```text
URL 中的 p-编号
= gbRawData.canonicalInfo.goods_id
= modules.productInfo.goods_id
= modules.saleAttr.multiLevelSaleAttribute.goods_id
= JSON-LD 中的 goods_id
```

不一致时标记“需刷新校验”并禁用复制按钮，避免 SHEIN 站内切换关联款后，把旧 SSR 的 SKU 配到新商品。

## 安全边界

- 只读取当前商品页的公开 HTML 和已渲染选项。
- 不读取 Cookie、账号、地址、订单或付款数据。
- 不发起额外网络请求，不上传数据。
- 不加购、不下单、不修改 SHEIN 账号状态。
- 库存和价格为页面快照；下单前仍以购物车为准。

## 验收人员安装

脚本在完成美国站和墨西哥站实页验收前，不纳入团队已开放分发清单。验收人员可通过 Raw 地址安装：

[安装测试脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-product-variant-helper/shein_product_variant_helper.user.js)

1. 在 Comet/Chromium 中启用 Tampermonkey。
2. 安装上述 `.user.js`。
3. 打开 SHEIN 商品详情页，确认右侧出现悬浮按钮。
4. 切换尺码，确认面板中的“当前选中型号”同步变化。
5. 点击复制后，用新标签页打开链接，核对颜色与尺码。

## 在线更新

支持 Tampermonkey 在线更新：

- `@version`：当前脚本版本；每次发布必须递增。
- `@updateURL`：指向 GitHub Raw 上的 `.user.js`，Tampermonkey 从这里检查新版本。
- `@downloadURL`：检测到新版本后，从同一 GitHub Raw 地址下载完整脚本。

注意：

- 请从本 README 提供的 Raw 地址安装，不要手工新建同名脚本后粘贴代码。
- 不要在 Tampermonkey 编辑器中修改已安装代码，本地修改过的脚本可能不再自动更新。
- Tampermonkey 的“检查间隔”不能设为“从不”；也可在管理面板手动执行“检查用户脚本更新”。
- Comet 中 Tampermonkey 的站点访问权限需允许访问 GitHub Raw 和 SHEIN；如权限被限定为少数站点，在线更新可能失败。

## 本地测试

```bash
node --check scripts/shein-product-variant-helper/shein_product_variant_helper.user.js
node --test scripts/shein-product-variant-helper/tests/parser.test.js
```

测试样例为最小化、脱敏的公开商品结构，不含账号、Cookie、订单、地址或买家信息。

## 已知限制

- SHEIN 可能改动 `gbRawData` 字段结构，发版前需用美国站和墨西哥站各至少一个真实商品复验。
- 关联款的颜色文字可能重复，脚本始终以 `goods_id + sku_code` 为最终型号键。
- 如页面在客户端切款后保留旧 SSR，必须刷新当前 URL 后再复制。

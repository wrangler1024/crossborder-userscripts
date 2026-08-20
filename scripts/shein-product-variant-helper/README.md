# Xynigo SHEIN 商品型号助手

> 当前状态：**待实页验收（只读）**
> 版本：`0.1.2`

## 一键安装（Comet + Tampermonkey）

### ➡️ [点击一键安装 Xynigo SHEIN 商品型号助手 v0.1.2](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-product-variant-helper/shein_product_variant_helper.user.js)

点击后应自动打开 Tampermonkey 安装确认页，核对脚本名为“Xynigo SHEIN 商品型号助手”，然后点击“安装”。

## 功能

- 仅在 SHEIN 商品详情页显示“解析商品型号”悬浮按钮。
- 按钮可拖动，并保存上次位置。
- 解析商品层 `goods_id` / `goods_sn` / `productRelationID` / 颜色。
- 解析每个尺码的 `attr_value_id` / `sku_code` / 页面库存 / 价格。
- 切换颜色后如检测到 URL 商品 ID 与页面数据不一致，自动刷新一次并恢复打开面板。
- 同一商品最多自动刷新一次，避免网络异常或 SHEIN 数据未同步时循环刷新。
- 识别当前在 SHEIN 页面选中的尺码，生成精确型号键：

  ```text
  站点:goods_id:sku_code
  例：US:312187195:I3c0auhysow1
  ```

- 可选择无优惠券、`30%`、`50%`、`60%` 或 `65%` 优惠券。
- 按“页面售价 ×（1 - 优惠比例）”计算采购价，四舍五入保留两位小数。
- 当前型号和其他可购尺码都可一键复制店小秘订单备注。

复制格式：

```text
采购链接：<精准链接>
规格：Black / 12Y
采购价格：3.64
```

示例中页面售价为 `10.39`，买家号选择 `65%` 优惠券，采购价为 `10.39 × 35% = 3.64`。

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

切换颜色导致不一致时，先禁用复制按钮，再自动刷新一次并恢复打开面板。如刷新后仍不一致，保持禁用并提示重新校验，避免把旧 SSR 的 SKU 配到新商品。

## 安全边界

- 只读取当前商品页的公开 HTML 和已渲染选项。
- 不读取 Cookie、账号、地址、订单或付款数据。
- 不发起额外网络请求，不上传数据。
- 不加购、不下单、不修改 SHEIN 账号状态。
- 库存和价格为页面快照；下单前仍以购物车为准。

## 验收步骤

脚本在完成美国站和墨西哥站实页验收前，不纳入团队正式分发清单。

1. 在 Comet/Chromium 中启用 Tampermonkey。
2. 通过页面顶部的“一键安装”链接安装 `.user.js`。
3. 打开 SHEIN 商品详情页，确认右侧出现悬浮按钮。
4. 切换尺码，确认面板中的“当前选中型号”同步变化。
5. 选择当前买家号的优惠券类型。
6. 点击“复制当前型号”或其他尺码的“复制备注”，粘贴到店小秘订单备注。
7. 用新标签页打开备注中的链接，核对颜色、尺码和购物车实际价格。

## 在线更新

支持 Tampermonkey 在线更新：

- `@version`：当前脚本版本；每次发布必须递增。
- `@updateURL`：指向 GitHub Raw 上的 `.user.js`，Tampermonkey 从这里检查新版本。
- `@downloadURL`：检测到新版本后，从同一 GitHub Raw 地址下载完整脚本。

注意：

- 请从本 README 提供的 Raw 地址安装，不要手工新建同名脚本后粘贴代码。
- 不要在 Tampermonkey 编辑器中修改已安装代码，本地修改过的脚本可能不再自动更新。
- Tampermonkey 的“检查间隔”不能设为“从不”；也可在管理面板手动执行“检查用户脚本更新”。
- Comet 中 Tampermonkey 的站点访问权限需允许访问 GitHub Raw 和 SHEIN，并在扩展详情页开启“允许运行用户脚本”。

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

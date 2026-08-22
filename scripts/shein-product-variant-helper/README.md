# Xynigo SHEIN 商品型号助手

> 当前状态：**墨西哥站试运行（只读）**
> 版本：`0.1.19`

## 一键安装（Comet + Tampermonkey）

### ➡️ [点击一键安装 Xynigo SHEIN 商品型号助手 v0.1.19](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-product-variant-helper/shein_product_variant_helper.user.js)

点击后应自动打开 Tampermonkey 安装确认页，核对脚本名为“Xynigo SHEIN 商品型号助手”，然后点击“安装”。

## Chrome + HubStudio 通用安装包

### ➡️ [下载同一个 Chromium 扩展安装包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-variant-helper-v0.1.19/xynigo-shein-variant-helper-v0.1.19.zip)

这一份 ZIP 同时支持 Google Chrome 与 HubStudio/Hub 浏览器，不需要 Tampermonkey。解压后进入 `chrome://extensions/`，打开“开发者模式”，点击“加载已解压的扩展程序”，选择解压得到的 `xynigo-shein-variant-helper-v0.1.19` 文件夹。

安装扩展包前，请先停用 Tampermonkey 中的同名脚本，避免页面重复运行。详细步骤见扩展目录的 [安装说明](../../extensions/xynigo-shein-variant-helper/INSTALL.md)。

## 功能

- 仅在 SHEIN 商品详情页显示带 Xynigo 小犀头像的“解析商品型号”悬浮按钮；头像采用 42px 外溢式方案，便于运营快速识别。
- 按钮可拖动，并保存上次位置。
- 运营主动展开型号卡片后会记住展开状态，后续打开同站点商品页自动保持展开；主动收起后，后续页面继续保持收起。
- 支持“复制采购链接”全局快捷键，默认 `Alt + Shift + C`；可在面板右上角齿轮中重新录制或恢复默认。快捷键与主按钮共用库存、价格和商品 ID 校验，不会绕过禁用条件。
- “复制采购链接”为第一主操作，把精准链接、主规格、次规格、指导采购价和币种编码为一行 URL，供后续运营下单助手直接解析；“复制当前型号”保留为下方的三行备注次操作。
- 商品识别信息默认折叠，减少面板占用空间；当前型号按“主规格/次规格”显示。
- 解析商品层 `goods_id` / `goods_sn` / `productRelationID` / 主规格（例如 Color、Style Type）。
- 通用解析次规格的 `attr_value_id` / `sku_code` / 页面库存 / 价格，不依赖固定的尺码属性编号。
- 当规格名称在括号内区分型号、容量或兼容设备时，保留完整语义并优先按属性 ID 精确锁定 SKU。
- 唯一 SKU 的单规格商品自动锁定当前型号，不再要求虚构的尺码选项。
- 切换主规格后如检测到 URL 商品 ID 与页面数据不一致，先替换残留的旧 `goods_id`、删除旧 `skucode`，再自动刷新并恢复打开面板和刷新前选中的次规格。
- 同一商品最多自动刷新一次，避免网络异常或 SHEIN 数据未同步时循环刷新。
- 快照库存为 `0` 或库存未返回的型号禁止复制，并明确标记“已售罄”或“库存待确认”。
- 如原选次规格在新主规格中不存在或库存为 `0`，不强行恢复，提示运营改选有库存型号。
- 识别当前在 SHEIN 页面选中的型号，生成精确型号键：

  ```text
  站点:goods_id:sku_code
  例：US:312187195:I3c0auhysow1
  ```

- 可选择无优惠券、`30%`、`50%`、`60%` 或 `65%` 优惠券。
- 页面实时渲染售价优先于 JSON-LD 结构化价格；墨西哥站不同尺码可能显示不同售价，因此只有页面当前真正选中的型号可使用实时价复制，其他型号需先在页面点选。
- 切换主规格或次规格后高频采样页面售价；价格持续稳定后提前恢复复制，常见约 `1.4–2.6` 秒，检测到二次跳价则继续等待，最长约 `4.2` 秒兜底。
- 按“页面售价 ×（1 - 优惠比例）”计算采购价，四舍五入保留两位小数。
- 只有页面当前选中型号提供“复制当前型号”入口；其他次规格用紧凑库存网格快速展示，不再渲染无效的复制按钮、价格和 SKU。
- 单规格备注只输出真实规格值，不补 `- / -`。
- 精准采购链接使用插件智能精简格式：缩短商品路径，去掉推荐位和来源追踪参数，只保留商品 ID、SKU、主规格和商城参数。
- 打开精简链接后，脚本会校验库存并自动点选链接中的 `skucode`；页面真正选中前，不会把 URL 中的 SKU 误当成已选型号。

复制格式：

```text
<精准链接>
Black / 12Y
3.64
```

一行采购链接格式：

```text
<精准链接>#xv=1&p=Black&s=12Y&gp=3.64&c=USD
```

`skucode`、`main_attr` 等 SHEIN 精准定位参数保持在 `#` 之前且不作修改；`#` 后仅保存 Xynigo 业务元数据，不会把规格或指导价拼进 SHEIN 查询参数。短参数映射为：`xv`=格式版本、`p`=主规格、`s`=次规格、`gp`=指导采购价、`c`=币种。单规格商品省略 `s`。点击链接仍按原精准链接打开商品，运营下单助手可单独解析 `#` 后的字段。

示例中页面售价为 `10.39`，买家号选择 `65%` 优惠券，采购价为 `10.39 × 35% = 3.64`。

精简链接示例（实际参数由页面生成）：

```text
https://us.shein.com/x-p-428645064.html?...&goods_id=428645064&skucode=I9mn4kthaev5ws
```

这是 SHEIN 站内直链，不依赖第三方短链服务，避免跳转服务失效或收集采购数据。精简路径能在 SHEIN 打开商品，但自动恢复到具体次规格需要浏览器启用本脚本 v0.1.5 或更高版本。

## 支持站点

- SHEIN 美国站：`https://us.shein.com/*`
- SHEIN 墨西哥站：`https://shein.com.mx/*` 及其子域名

## 数据来源与校验

脚本优先解析当前 HTML 中的 `window.gbRawData`，并使用 `goodsDetailSchema` JSON-LD 补充可售状态和型号映射。价格优先读取商品页当前实时显示售价；JSON-LD 价格仅作为备用。

复制前强制检查：

```text
URL 中的 p-编号
= gbRawData.canonicalInfo.goods_id
= modules.productInfo.goods_id
= modules.saleAttr.multiLevelSaleAttribute.goods_id
= JSON-LD 中的 goods_id
```

切换主规格导致不一致时，先禁用复制按钮，再自动刷新一次并恢复打开面板。如刷新后仍不一致，保持禁用并提示重新校验，避免把旧 SSR 的 SKU 配到新商品。

## 安全边界

- 只读取当前商品页的公开 HTML 和已渲染选项。
- 不读取 Cookie、账号、地址、订单或付款数据。
- 不发起额外网络请求，不上传数据。
- 不加购、不下单、不修改 SHEIN 账号状态。
- 库存和价格为页面快照；下单前仍以购物车为准。

## 验收步骤

脚本已完成美国站与墨西哥站商品页只读实测，当前进入墨西哥站运营试运行；下单前仍需在购物车复核库存和价格。

1. 在 Comet/Chromium 中启用 Tampermonkey。
2. 通过页面顶部的“一键安装”链接安装 `.user.js`。
3. 打开 SHEIN 商品详情页，确认右侧出现悬浮按钮。
4. 确认“商品识别信息”默认折叠；切换次规格后，“当前选中型号”以 `主规格/次规格` 同步变化，唯一 SKU 应自动选中。
5. 选择库存为 `0` 的型号，确认当前型号和次规格列表的复制按钮都被禁用。
6. 选择有库存的次规格后切换主规格，确认自动刷新后恢复原次规格；新主规格无该型号时应显示提示。
7. 选择当前买家号的优惠券类型。
8. 点击上方“复制采购链接”，或按默认快捷键 `Alt + Shift + C`，确认剪贴板只有一行 URL，且 `#` 后分别包含 `xv`、`p`、`s`、`gp`、`c`。再从齿轮设置中录制一个新组合键并复测。
9. 点击下方“复制当前型号”，确认剪贴板仍是链接、规格、价格三行。
10. 用新标签页打开三行备注中的精简链接和一行采购链接，分别核对主规格、次规格和购物车实际价格。

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

Chrome/HubStudio 通用扩展包采用本地加载方式，浏览器不会从 GitHub 自动更新；发布新版本后需下载新 ZIP，解压覆盖旧目录，再到扩展管理页点击“重新加载”。

### 本地开发包

开发和运营联调时使用固定目录的未压缩扩展包：

```bash
npm run build:xynigo-variant:dev
```

首次在浏览器开发者模式中选择 `dist/xynigo-shein-variant-helper-dev`。后续修改代码后重新执行上述命令，再到扩展管理页点击“重新加载”并刷新商品页即可，不需要重复解压或重新选择目录。Tampermonkey 同名脚本仍需保持停用，避免两个版本同时运行。

## 本地测试

```bash
node --check scripts/shein-product-variant-helper/shein_product_variant_helper.user.js
npm run test:xynigo-variant
```

测试样例为最小化、脱敏的公开商品结构，不含账号、Cookie、订单、地址或买家信息。

## 已知限制

- SHEIN 可能改动 `gbRawData` 字段结构，发版前需用美国站和墨西哥站各至少一个真实商品复验。
- 主规格文字可能重复，脚本始终以 `goods_id + sku_code` 为最终型号键。
- 如页面在客户端切款后保留旧 SSR，必须刷新当前 URL 后再复制。

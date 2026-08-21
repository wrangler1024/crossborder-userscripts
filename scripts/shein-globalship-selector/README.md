# Xynigo SHEIN GlobalShip Selector

> 当前状态：**美国站搜索页待运营试用（只读）**
> 版本：`0.1.1`

这是一个独立选品器，不依赖也不修改“Xynigo SHEIN 商品型号助手”。当前首项能力是在 SHEIN 美国站搜索页增加 `GlobalShip` 按钮，帮助妙手选品采集前先排除本土发货商品。

## 一键安装（Comet + Tampermonkey）

### ➡️ [安装 Xynigo SHEIN GlobalShip Selector v0.1.1](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js)

## Chrome + HubStudio 通用安装包

### ➡️ [下载 Chromium 扩展安装包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-globalship-selector-v0.1.1/xynigo-shein-globalship-selector-v0.1.1.zip)

解压后进入 `chrome://extensions/`，打开“开发者模式”，点击“加载已解压的扩展程序”，选择 `xynigo-shein-globalship-selector-v0.1.1` 文件夹。

Tampermonkey 用户脚本和 Chromium 扩展是同一份功能的两种安装方式，只启用一种，避免重复插入按钮。

## 当前功能

- 在 SHEIN 美国站搜索结果页的原生 `QuickShip` 右侧插入 `GlobalShip` 按钮。
- 标签高度、内边距、图标尺寸、字体、选中颜色和边框对齐官方 QuickShip；选中后右上角显示同尺寸 `×` 标识。
- `GlobalShip` 开启后，隐藏商品卡上带精确 `Local` 或 `QuickShip` 徽标的本土发货商品，保留国际配送（全托管）商品。
- 不使用商品标题中的 `local` 等关键词，避免误判标题内容。
- `GlobalShip` 与原生 `QuickShip` 互斥：开启 GlobalShip 时自动退出 QuickShip；用户点击 QuickShip 时自动关闭 GlobalShip。
- 搜索词切换、翻页和懒加载后自动对新商品重新筛选。
- 当前标签页内记住开关状态；关闭标签页后不会永久保存。

## 数据与安全边界

- 只读取搜索页公开 DOM 中的商品链接、`Local` / `QuickShip` 徽标和原生 QuickShip 状态。
- 不读取 Cookie、账号、订单、地址、付款或妙手数据。
- 不发起额外网络请求，不上传数据。
- 不加购、不下单、不改动 SHEIN 账号状态。
- 这是前端显示筛选；最终发货方式仍需在商品详情页或下单前复核。

## 验收步骤

1. 打开 SHEIN 美国站任一 `/pdsearch/` 搜索结果页。
2. 确认 `GlobalShip` 出现在原生 `QuickShip` 右侧，默认关闭。
3. 在普通混合结果页开启 `GlobalShip`，确认带 `Local` / `QuickShip` 徽标的商品卡被隐藏。
4. 先开启原生 QuickShip，再点击 GlobalShip，确认 QuickShip 自动退出，随后显示国际配送商品。
5. GlobalShip 开启时点击原生 QuickShip，确认 GlobalShip 自动关闭。
6. 翻页或滚动加载更多商品，确认新商品按相同规则筛选。

## 本地测试

```bash
node --check scripts/shein-globalship-selector/shein_globalship_selector.user.js
node --test scripts/shein-globalship-selector/tests/selector.test.js
node --test extensions/xynigo-shein-globalship-selector/package.test.js
```

## 已知限制

- 当前业务规则以“带 `Local` 或 `QuickShip` 徽标 = 本土发货；其余 = 国际配送候选”为准。
- 如果 SHEIN 改名、不再渲染徽标或调整商品卡结构，需要重新校准选择器。
- 当前只支持已验证的美国站搜索页，未把这一判断直接复制到其他站点。

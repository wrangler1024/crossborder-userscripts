# Xynigo SHEIN GlobalShip Selector 安装说明

版本：`0.1.1`

这是独立的 Chromium 扩展，可安装到 Google Chrome、Comet 和 HubStudio/Hub 浏览器，不依赖“Xynigo SHEIN 商品型号助手”。

## 安装

1. 完整解压 ZIP，不要直接从压缩包内打开文件。
2. 在浏览器地址栏输入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `xynigo-shein-globalship-selector-v0.1.1` 文件夹；文件夹内应直接看到 `manifest.json`。
6. 打开或刷新 SHEIN 美国站搜索结果页，原生 QuickShip 右侧应出现 `GlobalShip` 按钮。

如果 Tampermonkey 中已经安装同名用户脚本，请先停用用户脚本，避免重复运行。

## 更新

本地加载的扩展不会自动更新。拿到新版本 ZIP 后，解压到固定目录，再到扩展管理页点击“重新加载”。

## 权限与安全边界

- 仅在 `https://us.shein.com/pdsearch/*` 运行。
- 不申请任何扩展权限。
- 只读取公开商品卡和发货徽标，并在当前页面隐藏本土发货商品卡。
- 不读取 Cookie、账号、订单、地址或付款信息，不发起额外网络请求。

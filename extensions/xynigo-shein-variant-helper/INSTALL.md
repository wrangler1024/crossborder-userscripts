# Xynigo SHEIN 商品型号助手安装说明

版本：`0.1.20`

同一个 ZIP 可安装到 Google Chrome 和 HubStudio/Hub 浏览器，不依赖 Tampermonkey。

## 安装

1. 完整解压 ZIP，不要直接从压缩包内打开文件。
2. 在浏览器地址栏输入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压得到的 `xynigo-shein-variant-helper-v0.1.20` 文件夹；该文件夹内应直接看到 `manifest.json`。
6. 打开或刷新 SHEIN 美国站、墨西哥站商品页，右侧应出现“解析商品型号”悬浮按钮。
7. 默认按 `Alt + Shift + C` 可复制一行采购链接；要修改时，打开悬浮面板并点击右上角齿轮录制新快捷键。

如果 Tampermonkey 中已经安装了“Xynigo SHEIN 商品型号助手”，请先停用同名用户脚本，避免两个版本同时在商品页运行。

## 更新

本地加载的扩展不会从 GitHub 自动更新。拿到新版本 ZIP 后：

1. 解压并覆盖旧扩展目录，或解压到新的固定目录。
2. 回到 `chrome://extensions/`。
3. 在“Xynigo SHEIN 商品型号助手”卡片上点击“重新加载”。

请勿删除正在加载的扩展目录，否则浏览器重启后扩展会失效。

## 开发者模式联调

在仓库根目录执行：

```bash
npm run build:xynigo-variant:dev
```

首次加载时选择固定目录 `dist/xynigo-shein-variant-helper-dev`。后续每次修改后重新执行命令，在 `chrome://extensions/` 点击“重新加载”，再刷新 SHEIN 商品页即可验证，不需要重复解压或重新选择扩展目录。

## 权限与安全边界

- 仅在 `us.shein.com`、`shein.com.mx` 及其子域名运行。
- 只读取商品页公开结构、当前规格、售价与库存。
- 剪贴板权限只用于复制三行采购备注或包含规格、页面原价、优惠券比例、指导采购价和币种的一行采购链接。
- 不读取 Cookie、买家账号、订单、地址或付款信息。
- 不加购、不下单、不修改 SHEIN 账号状态。

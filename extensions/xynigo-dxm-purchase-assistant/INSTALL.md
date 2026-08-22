# Xynigo 店小秘运营采购助手安装说明

版本：`0.1.45`（公开预览版）

同一个 ZIP 可安装到 Google Chrome、Comet 及兼容 Manifest V3 的 Chromium 浏览器。

## 安装

1. 从 [GitHub Release](https://github.com/wrangler1024/crossborder-userscripts/releases/tag/dxm-purchase-assistant-v0.1.45) 下载 `xynigo-dxm-purchase-assistant-v0.1.45.zip`。
2. 完整解压 ZIP，不要直接从压缩包内打开文件。
3. 在浏览器地址栏打开 `chrome://extensions/`。
4. 开启右上角“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择解压得到的 `xynigo-dxm-purchase-assistant-v0.1.45` 文件夹；该文件夹内应直接看到 `manifest.json`。
7. 刷新店小秘待审核订单页面。

本扩展独立运行，不依赖、也不修改 Xynigo SHEIN 商品型号助手。

如果浏览器已安装 Tampermonkey，也可使用 [油猴一键安装版](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-purchase-assistant/xynigo_dxm_purchase_assistant.user.js)。扩展版和油猴版二选一，不要同时启用。

## 第一次测试

1. 保持扩展弹窗中的“启用审核门禁”关闭。
2. 打开一张脱敏或允许测试的待审核订单详情。
3. 确认页面默认进入“采购明细”，并正确识别订单商品、销售数量和销售额。
4. 为每个商品粘贴包含 `goods_id` 与 `skucode` 的 SHEIN 精确采购链接。
5. 检查自动解析的主规格、次规格、指导价和币种。
6. 点击“提交采购单”。当前版本仅保存浏览器本地采购记录，并把一行一个采购链接的备注填入店小秘备注窗口。
7. 人工核对并保存备注；扩展不会自动点击备注保存或订单审核。
8. 流程验证正常后，再按需开启“启用审核门禁”。

## 更新

本地加载的扩展不会从 GitHub 自动更新。下载新版 ZIP 并解压后，在 `chrome://extensions/` 对扩展点击“重新加载”。

## 当前限制

- 尚未连接飞书；“已录入”表示浏览器本地预览记录存在。
- 店小秘页面结构变化时，可能需要同步更新页面解析规则。
- 备注只自动填入，不自动保存。
- 不支持批量审核。
- 当前要求每个订单商品都有采购链接，采购数量必须等于销售数量。

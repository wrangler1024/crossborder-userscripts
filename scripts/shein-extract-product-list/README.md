# SHEIN 提取可参加活动的 SKC

> 当前状态：**待验收（只读导出）**

## 功能

- 读取全部已上架商品。
- 筛选首次上架时间早于当天零点的 SKC。
- 每 500 条生成一个活动 Excel 文件。

## 使用与验收

- 登录 SHEIN SellerHub 商品列表。
- 点击“提取可参加活动的SKC”，核对导出数量和活动模板。

## 风险与限制

- “可参加活动”仅按上架时间判断，不代表满足平台全部活动条件。
- 需与当前墨西哥站活动规则重新对齐。

## 安装

验收人员可通过以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-extract-product-list/shein_extract_product_list.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/shein_extract_product_list.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

# SHEIN 导出议价待确认

> 当前状态：**待验收（只读导出）**

## 功能

- 分页读取待确认议价商品。
- 导出议价单号、SPU、SKC、SKU、报价、建议价和剩余次数等字段。

## 使用与验收

- 登录 SHEIN SellerHub 并进入议价相关页面。
- 点击“导出议价待确认订单”，检查 Excel 行数和字段。

## 风险与限制

- 依赖 SHEIN 内部接口字段。
- 需要与页面总数量对账后才能判定导出完整。

## 安装

验收人员可通过以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-export-pending-confirmation/shein_export_premium_pending_confirmation.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/shein_export_premium_pending_confirmation.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

# Samforo 工具箱

> 当前状态：**待拆分验收**

## 功能

- 提取 Amazon、TikTok、1688 商品与采购备注。
- 辅助店小秘备注、库存、采购计划和建品信息处理。
- 提取 1688 待付款订单、发送改价消息并查询物流状态。

## 使用与验收

- Alt+Q：按当前网站提取商品或订单信息。
- Alt+E：在支持页面处理库存建品信息。
- Alt+H：显示脚本帮助。

## 风险与限制

- 一个脚本覆盖多个网站和流程，权限范围较大。
- 部分功能会写入店小秘备注或依赖 17TRACK、1688 页面结构，应拆分后逐项验收。

## 安装

验收人员可通过以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-erp-review-assistant/dxm_erp_review_assistant.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/dxm_erp_review_assistant.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

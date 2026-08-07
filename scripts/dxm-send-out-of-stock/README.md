# 店小秘批量发缺货

> 当前状态：**暂停分发·高风险**

## 功能

- 遍历店小秘当前搜索结果。
- 逐个选择“SHEIN 虚拟发货 缺货”并确认。

## 使用与验收

- 仅在测试店铺用少量订单验收。
- 运行前固定搜索条件并人工核对目标订单。

## 风险与限制

- 会批量提交订单状态，缺少逐单预览和回滚。
- 页面选择器失效可能点错操作入口。

## 安装

当前不向运营开放安装。开发或验收人员确认风险后，可使用以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-send-out-of-stock/dxm_send_out_of_stock.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/dxm_send_out_of_stock.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

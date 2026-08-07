# 店小秘批量填写跟踪号

> 当前状态：**待验收**

## 功能

- 读取剪贴板中每行一个物流号。
- 按照包裹顺序填入店小秘发货窗口并提示数量差异。

## 使用与验收

- 复制与包裹顺序一致的物流号列表。
- 打开发货窗口，点击“粘贴板>跟踪号”并逐项复核。

## 风险与限制

- 脚本只负责填入，不保证物流号与订单匹配。
- 正式提交前必须人工核对首尾订单、数量和承运商。

## 安装

验收人员可通过以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-ship-without-order/dxm_ship_without_order_form_ctrl_v.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/dxm_ship_without_order_form_ctrl_v.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

# OZON 批量修改库存

> 当前状态：**暂停分发·高风险**

## 功能

- 读取当前 OZON 商品列表。
- 批量把库存设置为指定数量，支持设置为 0。

## 使用与验收

- 仅使用测试账号和少量商品验收库存写入。
- 价格修改入口尚未实现。

## 风险与限制

- 会直接修改平台库存，缺少变更前快照和回滚。
- 代码中的价格功能不可用。

## 安装

当前不向运营开放安装。开发或验收人员确认风险后，可使用以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/ozon-modify-inventory/ozon_0_modify_inventory.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/ozon_0_modify_inventory.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

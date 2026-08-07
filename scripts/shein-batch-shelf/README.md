# SHEIN 批量上下架

> 当前状态：**暂停分发·高风险**

## 功能

- 批量下架已售罄商品。
- 按 SKC 和站点批量上架或下架。
- 内置美国、墨西哥和多个欧洲站点映射。

## 使用与验收

- 仅在测试店铺使用少量 SKC 和单一站点验收。
- 生产使用前必须生成操作预览和二次确认。

## 风险与限制

- 会直接改变多个站点的商品销售状态。
- 当前脚本缺少逐条结果汇总、失败重试和回滚。

## 安装

当前不向运营开放安装。开发或验收人员确认风险后，可使用以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-batch-shelf/shein_removed_shelves.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/shein_removed_shelves.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

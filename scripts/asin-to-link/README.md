# 店小秘 ASIN 转 Amazon 链接

> 当前状态：**待验收（只读页面）**

## 功能

- 监听店小秘订单详情数据。
- 根据订单国家把 ASIN 转为对应 Amazon 站点商品链接。

## 使用与验收

- 打开店小秘订单列表并查看订单详情。
- 确认 ASIN 已变成可点击链接并跳转到正确国家站点。

## 风险与限制

- 依赖店小秘订单详情接口和页面选择器。
- 国家映射表需要随新市场扩展。

## 安装

验收人员可通过以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/asin-to-link/asin_to_link.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/asin_to_link.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

# Amazon 搜索页加载全部商品

> 当前状态：**待验收（只读页面）**

## 功能

- 把 Amazon 搜索结果的全部分页追加到当前页面。
- 移除部分空商品位和广告干扰，方便集中选品。

## 使用与验收

- 打开 Amazon 搜索结果页。
- 点击页面右上角“加载全部商品”，等待按钮显示完成页数。

## 风险与限制

- 依赖 Amazon 当前分页和商品 DOM 结构，页面改版后可能失效。
- 一次加载大量页面可能触发限流或造成浏览器卡顿。

## 安装

验收人员可通过以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/amazon-all-products-on-one-page/amazon_all_products_on_one_page.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/amazon_all_products_on_one_page.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

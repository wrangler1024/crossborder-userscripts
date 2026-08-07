# 妙手批量采集

> 当前状态：**暂停分发·依赖待确认**

## 功能

- 接收多条 Amazon 链接。
- 解析父子变体 ASIN 并请求 Amazon 变体接口。

## 使用与验收

- 需先确认是否依赖妙手官方采集扩展拦截请求。
- 完整端到端链路确认前不向运营分发。

## 风险与限制

- 仓库代码中没有直接向妙手接口提交商品。
- 脚本单独运行不代表商品已进入妙手采集箱。

## 安装

当前不向运营开放安装。开发或验收人员确认风险后，可使用以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/ms-batch-plugin-collection/ms_batch_plugin_collection.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/ms_batch_plugin_collection.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

# Amazon 物流验证

> 当前状态：**业务口径待确认**

## 功能

- 批量读取每行一个物流号。
- 调用 Amazon Tracking 页面接口并导出 Excel 结果。

## 使用与验收

- 登录并打开 track.amazon.com。
- 点击“验证物流”，粘贴物流号后确认并等待 Excel 下载。

## 风险与限制

- 当前代码把“没有 eventHistory”判为通过，更接近无既有轨迹检查，不等于妥投或真实有效。
- 在运营负责人确认验证口径前不得作为发货判断依据。

## 安装

验收人员可通过以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/amazon-track/amazon_track.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/amazon_track.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

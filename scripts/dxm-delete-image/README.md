# 店小秘批量删除图片

> 当前状态：**暂停分发·高风险**

## 功能

- 在店小秘图片空间增加批量删除入口。
- 循环删除指定页之后的图片。

## 使用与验收

- 仅允许开发或测试账号验收。
- 验收前先备份图片并记录目标页码、预计删除数量。

## 风险与限制

- 删除不可自动恢复，且没有预览、撤销和完整数量校验。
- 不得在生产账号直接运行。

## 安装

当前不向运营开放安装。开发或验收人员确认风险后，可使用以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-delete-image/dxm_delete_image.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/dxm_delete_image.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

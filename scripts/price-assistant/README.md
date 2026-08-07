# 店小秘核价审核助手

> 当前状态：**暂停分发·旧财务口径**

## 功能

- 从店小秘订单进入 Amazon 商品核价。
- 读取页面价、优惠券、预计送达日期。
- 满足条件后写入备注并审核订单。

## 使用与验收

- 当前仅允许开发人员进行只读核价验证。
- 重写财务模型和写入确认机制后再开放审核功能。

## 风险与限制

- 旧公式为“优惠后页面价×1.064+1”，利润率分母为采购成本。
- 不符合当前以 SHEIN 应收金额为分母的财务毛利率口径。
- 会写订单备注并提交审核，属于生产写入操作。

## 安装

当前不向运营开放安装。开发或验收人员确认风险后，可使用以下 Raw 地址安装：

[安装脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/price-assistant/price_assistant.user.js)

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/price_assistant.user.js)
- 迁移快照：`ddcc16d`
- 迁移时保留原业务逻辑和原作者信息，仅切换下载、更新和支持地址。

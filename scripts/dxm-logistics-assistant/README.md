# Xynigo 店小秘物流助手（篡改猴版）

适用于采购部物流专员在店小秘订单页批量导入订单号、物流单号和物流商渠道。插件完成精确预检后，仍需人工逐行核对并确认发货。

## 一键安装

[点击安装 Xynigo 店小秘物流助手](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-logistics-assistant/xynigo_dxm_logistics_assistant.user.js)

安装前请先安装并启用 Tampermonkey。打开链接后由 Tampermonkey 展示脚本权限和版本，再点击“安装”。

## 更新

脚本通过同一个 GitHub Raw 地址检查更新。也可以打开 Tampermonkey 管理面板，使用“检查脚本更新”。

## 安全边界

- 只匹配店小秘订单页面。
- 不保存账号、Cookie、订单号或物流单号。
- 模板下载和解析均在本地完成。
- 发货前必须通过订单和平台承运商预检，并再次人工确认。
- 每批最多 300 条；超过后需要拆批。

该文件由扩展共享源码构建，请勿直接修改生成的 `.user.js`。

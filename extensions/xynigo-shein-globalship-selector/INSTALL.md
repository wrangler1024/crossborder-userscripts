# Shein Global Selector 安装说明

版本：`0.2.0` 正式版

## 安装

1. 解压 `xynigo-shein-globalship-selector-v0.2.0.zip`。
2. 打开 `chrome://extensions/` 并开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的同名文件夹。
4. 刷新 SHEIN 美国站或墨西哥站的搜索结果页、类目页或集合页。
5. 页面右侧应出现 `SHEIN选品助手` 磁吸按钮，点击后在底部打开 `Shein Global Selector` 工作台。

支持的桌面站点：

- `https://us.shein.com/`
- `https://shein.com.mx/`
- `https://www.shein.com.mx/`

支持的页面类型：`/pdsearch/`、`-c-数字.html`、`-sc-数字.html`。

如果 Tampermonkey 中已启用同名用户脚本，请停用其中一个版本，避免重复插入。

## 权限说明

- `clipboardWrite`：仅在运营点击“复制商品链接”或使用自定义快捷键时，把当前复制范围内的干净链接按每行一条写入剪贴板；默认范围为当前页全部筛选结果。
- SHEIN/图片 CDN 域名访问：仅在勾选“将商品主图插入 Excel”后读取并压缩商品主图；不发送 Cookie，不上传数据。
- 插件不读取账号、地址、付款、订单或妙手数据，不执行加购和下单。

## 更新

开发者模式加载的扩展不会自动更新。拿到新版 ZIP 后解压覆盖到固定目录，再在扩展管理页点击“重新加载”。

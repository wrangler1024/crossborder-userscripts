# Shein Global Selector 安装与本地测试

当前正式版本为 `0.4.6`。GitHub Release 提供的 ZIP 用于正式安装；固定 `dev` 目录仅用于本地开发验收。

## 本地开发测试（推荐）

1. 在仓库根目录执行 `npm run build:xynigo-selector:dev`。
2. 打开 `chrome://extensions/` 并开启“开发者模式”。
3. 只在首次点击“加载已解压的扩展程序”，选择固定目录 `dist/xynigo-shein-globalship-selector-dev/`。
4. 以后代码更新后，重新执行第 1 步，再在扩展管理页点击该扩展的“重新加载”图标，最后刷新 SHEIN 页面即可。

这个流程不需要重复打 ZIP、上传 GitHub 或重复选择扩展目录。不要移动或删除上述 `dev` 目录，否则 Comet 会失去已加载扩展的文件路径。

## 正式包安装

1. 解压 `xynigo-shein-globalship-selector-v<版本号>.zip`。
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

- `clipboardWrite`：仅在运营点击“复制商品链接”或使用自定义快捷键时，把当前复制范围内的干净链接按每行一条写入剪贴板；默认范围为全部累计页面中的筛选命中结果。
- SHEIN 页面域名访问：用于在商品列表页注入工作台，并在开启 Single-Spec 或运营主动点击“补全规格”时，以同站点 GET 请求读取公开结构化商品详情规格；不打开每个商品页，不提交表单，不执行账号、购物车、订单或付款操作。如返回 SHEIN 风控/验证页，插件会暂停剩余补采。
- 极鲸云数据域名访问：Sold by 优先从 SHEIN 列表页直采，包括商品链接公开的 `data-store_code`；仍缺失时，向 `api.sheinshuju.com/api/v1/goods/card` 发送 Goods ID、`store_code`/发现出的 `mallId` 和 US/MX 站点代码，尝试补全店铺名、最近销量、评分、评论数和上架日期。列表缺少 `store_code` 时会先发现真实 `mallId` 再补查店铺名；请求不携带 Cookie 或账号令牌。极鲸云仅可填充缺失值，或将页面 Sales `0` 更新为同口径的正销量；不覆盖非零 SHEIN 销量。瞬时失败会自动指数退避重试，不会继续将该商品永久跳过。
- 图片 CDN 域名访问：仅在勾选“将商品主图插入 Excel”后读取并压缩商品主图；不发送 Cookie，不上传数据。
- 插件不读取账号、地址、付款、订单或妙手数据，不执行加购和下单。

## 更新

开发者模式加载的扩展不会自动更新。本地测试使用上述固定 `dev` 目录；正式发版时再执行 `npm run build:xynigo-selector` 生成 ZIP。

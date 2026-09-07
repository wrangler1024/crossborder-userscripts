# Xynigo SHEIN 采购售价对比

当前版本：**v0.1.4**。独立的 Manifest V3 扩展，适用于 Chrome、Comet 和 HubStudio 中的 SHEIN 墨西哥站、美国站商品页。

采购人员打开型号助手生成的采购链接时，插件对比审单页面售价与当前页面售价，并提示商品下架、型号售罄或暂不可购买。普通链接默认只显示小入口；用户启用后才检查商品。点击状态条或工具栏图标打开详情，点击窗口外收起；等待价格稳定时显示动态进度。

## 安装与更新

- [v0.1.4 版本与安装包](https://github.com/wrangler1024/crossborder-userscripts/releases/tag/shein-price-compare-v0.1.4)
- [Chrome / Comet 解压加载包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-price-compare-v0.1.4/xynigo-shein-price-compare-v0.1.4.zip)
- [HubStudio 团队扩展上传包](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-price-compare-v0.1.4/xynigo-shein-price-compare-v0.1.4-hubstudio.zip)
- [完整使用说明](./使用说明.md)

更新已解压安装的扩展时，先在扩展详情中确认“加载来源”。将新版运行文件同步到该目录，点击这款扩展的“重新加载”，再刷新商品页即可。旧目录名即使包含旧版本号，也不需要改名或重新安装。仅更新另一份开发目录不会更新原来的扩展；GitHub 发版也不会让已解压扩展自动升级。

## 链接协议

型号助手通过商品 URL 的查询参数定位型号，通过 fragment 保存价格快照。`op` 表示审单时优惠券前的页面售价，不是划线价。基准只保存在当前标签页内存中。

| 字段 | 含义 |
| --- | --- |
| `goods_id` / 商品页路径编号 | 商品身份 |
| `skucode` | 目标 SKU |
| `mallCode` / `main_attr` | 商城与主规格定位参数（按链接提供） |
| `xv=1` | Xynigo 链接格式版本 |
| `op` / `c` | 审单页面售价与币种，墨西哥 MXN、美国 USD |
| `p` / `s` | 主规格、次规格显示文本 |
| `pt` | 可选，原售价快照的 Unix 秒数；旧链接缺失时仍能比价 |

`cr`、`gp` 由型号助手继续提供，采购对比不以优惠券指导价替代 `op`。型号、商城、币种不一致或价格存在歧义时显示待确认，不生成涨跌结论。插件不自动加购、下单或支付。

## 开发与维护

在仓库根目录执行：

```sh
npm ci
npm run test:xynigo-variant
npm run test:xynigo-price-compare
npm run build:xynigo-price-compare:dev
```

开发目录为 `dist/xynigo-shein-price-compare-dev`。首次加载后保持该路径，后续更新同一目录并重新加载。若浏览器已经加载其他目录，应继续更新浏览器实际加载的目录。

| 文件 | 职责 |
| --- | --- |
| `core.js` | 采购链接校验、稳定窗口、价格比较 |
| `availability.js` | 当前商品与目标型号可售状态 |
| `watcher.js` | 过滤无关页面变动 |
| `content.js` | 采样调度、型号定位和详情交互 |
| `background.js` | 工具栏点击发送打开详情消息 |
| `build.js` | 生成开发目录、解压加载 ZIP、HubStudio 根目录 ZIP |

构建时从 [商品型号助手](../../scripts/shein-product-variant-helper/shein_product_variant_helper.user.js) 生成 `variant-library.js`，通过 `XynigoSheinVariantLibraryOnly` 关闭其界面，仅复用解析 API。不要手工维护第二份型号与价格解析器。变更解析接口或链接协议时，两套测试应一起通过。

发布时更新 `manifest.json` 版本和两份说明，运行 `npm run build:xynigo-price-compare`。核对两个 ZIP 的 manifest、运行文件、图标和完整性后，使用 `shein-price-compare-v版本号` 标签发布。构建产物和浏览器调试记录不提交到源码仓库。

GitHub Actions 会在相关源码或依赖变化时运行两套测试，并验证两个安装包。测试使用仓库中的合成页面和脱敏商品数据；真实 HubStudio 多标签页性能与站点布局仍需现场验收。

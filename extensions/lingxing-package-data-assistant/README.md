# FBA 包装数据维护助手

试用版 `0.1.4`。将亚马逊费用预估报告中的销售包装尺寸和重量，维护到领星商品默认箱规。界面沿用领星广告创建助手的紫色主题。

已完成 67 项自动化测试、真实领星只读联调、原生更新配置核对和真实图片显示验证；用户已确认实际提交回填并核对 ERP 保存值成功。普通运营角色权限和油猴实际运行仍待单独核验。发布渠道为 GitHub 试用 Release，保留预览和人工确认。

## 下载与安装

[GitHub 试用版下载](https://github.com/wrangler1024/crossborder-userscripts/releases/tag/lingxing-package-data-assistant-v0.1.4) 提供原生扩展 ZIP、完整油猴脚本、安装说明和 SHA-256 校验文件。

- 原生扩展：解压 `lingxing-package-data-assistant-0.1.4.zip`，在浏览器 `chrome://extensions/` 开启开发者模式，点击「加载未打包的扩展程序」，选择直接包含 `manifest.json` 的目录。更新时替换同一目录文件、重新加载扩展，再刷新领星页面。
- 油猴：下载 Release 的 `lingxing-package-data-assistant.user.js`，在 Tampermonkey 新建脚本，粘贴完整内容并保存，刷新领星商品管理页。
- 两个渠道选择一个启用。试用包采用手动更新，不跟随自动更新地址；升级时下载新的 Release 并确认窗口版本。

源码维护入口：[crossborder-userscripts](https://github.com/wrangler1024/crossborder-userscripts/tree/main/extensions/lingxing-package-data-assistant)。

## 使用流程

1. 在已登录的领星「产品管理」按 SKU 页面打开右侧入口，选择报告所属店铺和报告日期。
2. 导入亚马逊费用预估原始 TXT、TSV、CSV 或 XLSX；首版每批最多 500 条、文件不超过 20 MB。
3. 插件按「店铺 + MSKU」读取 Listing，交叉核对 ASIN/FNSKU，再采用领星已有配对关系中的本地商品 ID 和本地 SKU。运营无需填写或上传 SKU 对应表。
4. 差异预览默认「按报告更新」，以费用预览为准替换已有包装四项；可选「仅补全」，仅处理四项均为空或为 0 的商品。核对并勾选商品，切换模式不会自动勾选新增候选。
5. 点击「确认更新」，核对数量、来源、店铺、模式和四个字段。确认后重新读取配对、箱规和旧值，再交给领星原生导入组件。
6. 读取商品现值，逐条核验数值、单位及其他规格资料。结果不明确时保留为「结果待核实」，阻止再次选择；使用「重新核验」只读检查，不自动重新上传。

来源统一显示「亚马逊费用预估」。报告日期、导入时间、原始文件 SHA-256、来源行号、原始数值与单位、采用来源、旧值、新值和原生任务编号进入本地执行记录。无法取得的实测时间为空，不以报表日期代替。

文本支持 UTF-8、带 BOM 的 UTF-16，以及匹配标识均为 ASCII 的 Windows-1252 CSV。可兼容精确的 `?"sku",` 表头前缀，不改写商品 MSKU；编码和表头兼容情况会记录在报告元数据中。支持 `centimeters` / `centimetres` 等完整公制单位名。显式 Unicode BOM 损坏、控制字符或旧编码的非 ASCII 匹配标识仍要求重新导出 UTF-8，以免猜测商品身份。

## 更新范围

| 报告字段 | 默认箱规目标 |
| --- | --- |
| longest-side | 包装规格长 |
| median-side | 包装规格宽 |
| shortest-side | 包装规格高 |
| item-package-weight 或 item-weight | 单品毛重 |

目标单位为 cm、g，尺寸保留 2 位、重量保留 4 位小数，采用明确的十进制换算和舍入。界面保留报告原始值与单位。

原生 XLSX 只包含「产品」工作表和经真实模板核对的 7 列：`*SKU`、`单品毛重`、`单品毛重单位`、`包装规格长`、`包装规格宽`、`包装规格高`、`包装规格单位`。SKU 按文本写入，使用已配对的本地 SKU。公司字典、示例商品和其他业务列不会进入文件。

原生更新内容严格限定为 `cg_product_gross_weight`、`cg_package`。单品净重、本体规格、外箱规格和成本不在更新列中。多箱规商品需确认唯一的默认箱规；首版不维护非默认箱规。

库存计量单位为空、报告包装重低于 ERP 净重不影响本次包装四项回填，预览及提交前均不据此拦截；单品净重继续保留原值。ERP 净重字段的既有格式也不参与报表包装值的有效性判断。

已识别的其他站点记录自动跳过，不读取其本店铺配对、不进入更新批次；界面单列「已跳过」数量，并说明报表站点与当前店铺站点。站点无法识别、未配对、身份不符、重复候选、包装单位模式不兼容、无有效默认箱规和无效报表行仍列为待处理。多个 MSKU 配对同一本地商品时合并；来源不同则由操作者选择一组完整来源。

商品列表筛选为「全部、可更新、待处理、已跳过」，四项一行展示。已一致记录可在「全部」中查看，继续跳过重复更新。商品预览使用领星已有主图，无图或加载失败时保留包装图标，不影响回填。

## 从源码构建

在开发检查通过后运行 `npm run build`，生成：

- Chrome 扩展：`dist/extension/`；压缩包 `dist/lingxing-package-data-assistant-0.1.4.zip`。
- 油猴脚本：仓库 `scripts/lingxing-package-data-assistant/lingxing-package-data-assistant.user.js`。
- 资产哈希：`dist/artifacts.json`。

Chrome 试用：解压 ZIP，在 `chrome://extensions/` 开启开发者模式，点击「加载已解压的扩展程序」，选择含 `manifest.json` 的目录。刷新领星产品管理页。

油猴试用：在 Tampermonkey 新建脚本，粘贴生成的 `.user.js` 内容并保存，再刷新产品管理页。试用脚本没有公开下载或自动更新地址。两种渠道共用源码，重复启用时页面只保留一个实例。

原生扩展使用页面主执行环境访问领星已有组件和会话；会话签名、Cookie 和鉴权处理由领星原生请求层完成，不要求新的 API 密钥，也不把凭证写入执行记录。浏览器兼容依据见 [Chrome content scripts 文档](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)。

## 开发与检查

```bash
npm ci --ignore-scripts
npm test
npm run build
npm run check:generated
```

`src/` 为业务源码，`extension/` 为扩展入口，`scripts/build.mjs` 生成两个分发渠道。`vendor/` 固定 SheetJS 字节及许可证，构建时核对 SHA-256；不加载远程执行代码。

`dev/index.html` 是独立浏览器功能测试页，使用合成商品、刻意不同的 MSKU/本地 SKU 和模拟导入器，不连接 ERP。先构建，再从模块根目录运行：

```bash
python3 -m http.server 19437 --bind 127.0.0.1
```

访问 `http://127.0.0.1:19437/dev/index.html`。该测试页和合成数据不进入扩展或油猴运行包。

自动化覆盖解析和换算、精确匹配与去重、冲突和默认箱规、最小更新文件、原生导入参数、提交前复查、持久化失败、只读恢复、账号隔离、公司范围互斥、HTML 转义及 UI 确认。报表字段参考 [Amazon Fee Preview 报告定义](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-fee-preview-report)。

## 当前验证边界

- 真实页面已验证已有配对读取、商品详情读取、默认箱规映射、异常阻止、原生模板字段及原生导入准备；准备过程未传入或上传文件。
- 用户已确认 0.1.3 实际回填并核对 ERP 保存后的尺寸和重量成功；具体条数、操作账号角色和原生任务编号未记录，不扩大为普通运营角色验收。自动化及浏览器合成数据中的执行仍属于模拟验证。
- 原生异步导入没有已验证的服务端版本条件，提交前检查不能阻止其他客户端随后修改。互斥覆盖同一浏览器实例内同一公司，不提供跨设备锁。
- 执行记录保存在当前浏览器的 IndexedDB。公司与账号用哈希隔离；清理浏览器站点数据会丢失本机记录。源文件和记录应按需导出留存。
- GitHub 试用 Release 用于按需安装与后续验收。原生扩展已完成实际页面只读验证，用户反馈实际写入核对成功；普通运营角色和油猴运行适配仍待单独核验。

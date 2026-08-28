# Xynigo SHEIN 采购助手（MVP）

> 版本：0.5.2
> 状态：地址填写 MVP，默认只读飞书普通表格，不自动保存地址、继续结算或支付。

## 下载与运行要求

从 [GitHub Release v0.5.2](https://github.com/wrangler1024/crossborder-userscripts/releases/tag/shein-purchase-assistant-v0.5.2) 下载 `xynigo-shein-purchase-assistant-v0.5.2.zip`，完整解压后可在 Chrome、Comet 或 HubStudio 的扩展开发者模式中加载。

地址读取与填写需要本机运行 Xynigo Sourcing 主执行器；HubStudio 环境定位、打开和关闭需要 Xynigo `0.12.7+`。旧执行器仍可使用核心填写链路，插件会按 API 功能声明自动降级。

## 目标

采购员在 HubStudio 的 SHEIN 墨西哥结算地址页中：

1. 插件默认收起，采购员点击右侧“采购助手”悬浮入口后，在面板输入销售订单号或包裹号。
2. Xynigo Sourcing 主执行器只返回飞书《采购执行协作表》中最多 20 个匹配任务；采购员手动选择当前订单后，插件立即只读加载并显示收件信息。
3. 点击“一键填写收件信息”。
4. 插件临时读取完整收件信息，填写并回读八个地址字段。
5. 同一份收件信息按飞书原始七字段在插件面板临时显示，并额外显示符合 SHEIN 输入要求的 `Nombre（SHEIN）` / `Apellido（SHEIN）` 拆分结果；鼠标点击任一字段整行，立即复制该字段当前显示值，供自动填写失败时手动粘贴。
6. 采购员人工补充 CURP/RFC、核对地址，并自行继续后续流程。

收起状态下，右侧悬浮入口默认为贴住页面右边缘的非圆形胶囊，仅显示图标；鼠标悬停或键盘聚焦时右边缘保持不动并向左伸长，显示“采购助手”。可拖动悬浮入口上下调整位置，普通点击仍打开面板；展开状态可拖动深蓝标题栏上下移动整个窗口。窗口打开时，无论鼠标或键盘焦点在页面哪个位置，按 `Esc` 都会收起插件窗口。默认使用 `Alt+Shift+P` 在 SHEIN 页面任意位置打开窗口；可在插件设置弹窗查看当前快捷键，并进入浏览器原生扩展快捷键页修改。入口和面板都限制在当前可视区内，面板内容区保持独立纵向滚动。

## 组成

    Chrome MV3 扩展
    ├── SHEIN 地址页任务面板
    ├── 姓名空格拆分
    ├── 文本字段填写与回读
    ├── 州 → 城市下拉联动选择
    └── 后台 localhost 请求代理

扩展管理页、浏览器工具栏、设置弹窗、页面悬浮入口和面板头部统一使用 Xynigo 品牌 VI v1.1 中为 Hub 采购插件保留的“采购确认签”图标：青蓝采购签、珊瑚橙红确认勾和深蓝背片。发布包仅包含 16 / 32 / 48 / 128 px 运行尺寸，不包含透明母版。

    Xynigo Sourcing 主执行器（xynigo.localhost 本机回环域名）
    ├── 仅监听 127.0.0.1
    ├── 每次启动生成短期会话口令，由插件后台自动配对获取
    ├── 通过飞书 OpenAPI 只读普通电子表格
    ├── App Secret 来自操作系统安全存储
    ├── tenant_access_token 仅在内存中缓存
    ├── 任务列表剔除姓名、电话和地址
    ├── 与 HubStudio、云端通道共用同一主进程，不再启动独立 sidecar
    ├── 直接调用 HubStudio Local API，不通过 hubstudio-cli
    └── 用户点击任务卡或一键填写后才返回当前任务的七项收件信息

## HubStudio 能力解耦

采购助手的核心填写链路和 HubStudio 环境控制是两项独立能力：

```text
核心填写：插件 → Xynigo 主执行器 → 飞书普通共享表 → 当前 SHEIN 页面
环境增强：插件 → Xynigo 主执行器 → HubStudio Local API → HubStudio 客户端
```

HubStudio Local API 可用时，面板开放按环境序号或 `containerCode` 定位、打开、关闭的手动增强操作。Local API 不可用时，面板隐藏这些控制并显示“HubStudio 自动化暂不可用，不影响当前页面填写”；任务搜索、收件信息预览、点击复制和一键填写继续可用。

页面面板与插件设置弹窗统一显示“localhost 执行器已连接 · 自动配对完成”或“localhost 执行器未连接”。每次展开面板都会重新检查；任务搜索或收件信息读取成功也会立即校正为已连接。连接检查使用最新请求优先规则，较早返回的失败结果不能覆盖较新的成功状态。

`hubstudio-cli` 不是生产依赖，不需要安装，也不需要配置 PATH。主执行器使用已保存端口并仅对少量已知端口做有限回退，不执行宽范围扫描。

必须区分两个开关：

- “团队偏好 → 全局设置 → 本地访问”决定 HubStudio 环境网页能否访问 Xynigo localhost。
- “HubStudio Local API”决定 Xynigo 主执行器能否查询和控制 HubStudio 客户端。

前者关闭会阻断插件连接主执行器；后者关闭只影响环境增强操作。

## 数据源

执行器读取普通飞书电子表格，依赖以下表头：

- 任务定位：“系统订单键”；缺失时回退为“销售订单号|包裹号”。
- 任务摘要：“采购员、销售订单号、店铺、包裹号、采购状态、主规格、次规格、需求数量、采购指导价”。
- 收件信息：“收货人姓名、收货人电话、地址1、地址2、收货人城市、收货人州/省、邮编”。

临时简化流程不校验采购状态、认领状态或采购员。任务按“系统订单键”聚合；同一任务中的空地址商品行会被忽略，唯一一组完整收件信息时才返回。如出现两组不同的完整地址，仍停止自动填写。

## 当前页面如何确定填哪个地址

    SHEIN 当前结算页
          ↓ 输入销售订单号 / 包裹号搜索
    手动点选匹配的右侧任务卡
          ↓ 锁定该卡的系统订单键
    点击“一键填写收件信息”
          ↓
    只读取该任务唯一完整地址并填写

当前不从 SHEIN 页面的商品或 HubStudio 环境序号自动猜测任务，避免选错地址。

## 飞书 API 凭证链路

    Xynigo 系统设置保存的团队企业应用 App ID + App Secret
    （macOS 钥匙串 / Windows CurrentUser DPAPI）
           ↓
    POST /auth/v3/tenant_access_token/internal
           ↓
    内存中的 tenant_access_token
           ↓
    GET /sheets/v2/spreadsheets/{token}/values/{range}

这条链路复用 Xynigo 执行器已配置的团队企业自建应用，不使用个人 `user_access_token`，也不依赖 CLI 进程。执行器只读 Xynigo 既有安全凭证存储，不在插件中保存第二份 App Secret。

## 姓名拆分

    清除首尾空格 → 合并连续空格 → 按空格拆分
    Nombre   = 第一个词；少于 4 个字符时，有至少三个词则合并前两个词
    Apellido = 剩余词重新用空格连接

例如 `Ana Carolina Torres` 拆分为 `Ana Carolina` / `Torres`，保留完整姓名内容，不添加数字或虚构姓氏。只有一个词，或仅有两个词且第一个词少于 4 位时，自动判定为姓名数据不完整并停止填写。Nombre 和 Apellido 顺序填写，避免切换订单时 SHEIN 恢复上一组姓名。字段值一致但 SHEIN 仍标记 `aria-invalid` 或浏览器原生校验失败时，不计为填写成功。

## SHEIN 字段策略

SHEIN 当前地址组件的 id/name 不稳定，因此插件按 aria-labelledby 关联的西班牙语标签定位字段：

- Nombre / Apellido
- Número de Teléfono
- Código postal
- Estado
- Municipio/Distrito/Ciudad
- Dirección de la calle
- Apartamento, suite, unidad

文本字段先点击激活，再使用浏览器原生 value setter 或浏览器文本插入命令派发事件并回读。Nombre/Apellido 作为一组，交替填写顺序并成组稳定回读，解决已有地址上切换订单时 SHEIN 恢复上一组姓名的问题。单字段失败不会中止其他字段。邮编需要保持输入焦点等待建议，因此作为独立阶段按 SHEIN 自动补全控件处理：优先选择包含精确五位邮编的建议项，并在当前 DOM 节点上持续稳定回读；若 SHEIN 异步重建输入框并清空值，则自动重试。插件随后等待邮编自动带出州和城市；未带出或值不一致时，才回退到州 → 城市下拉选择，并在最后重新核对邮编。地理字段稳定后再并行填写街道和地址补充，避免 SHEIN 重建地址组件时清空街道；最终回读前还会对被页面重置的文本字段逐项自动重试。州和城市点击 SUI 外层控件，并只在与当前字段匹配的 listbox 内选择真实选项。

## 安全边界

- 插件不保存完整姓名、电话或地址。
- App Secret 不写入项目文件、配置文件或日志。
- 飞书 `tenant_access_token` 仅保存在执行器内存中，不返回给浏览器插件。
- 完整收件信息只在用户点击任务卡或一键填写后读取；为支持手动复制，临时渲染在当前页面面板 DOM 中。
- 重新搜索、切换任务或关闭页面时清除面板中的收件信息；不写入 `chrome.storage`、日志或本地文件。
- 任务列表接口不返回收件信息。
- 会话口令由扩展后台通过本机专用请求自动获取，只存 `chrome.storage.session`，关闭浏览器即失效。
- 自动配对接口要求本机回环 Host 和扩展专用请求头；普通网页无法直接读取。
- 执行器只绑定 127.0.0.1，不开放局域网监听。
- HubStudio Local API Key 只保存在主执行器本机 Keychain / CurrentUser DPAPI；插件不持有、不读取也不记录该 Key。
- 环境控制接口要求回环来源、扩展专用请求头和短时会话；批量操作最多接受 20 个显式目标。
- 执行器响应固定 Cache-Control: no-store。
- 不生成、填写或保存 CURP/RFC。
- 不点击 GUARDAR、CONTINUAR、支付或任何下单按钮。
- 不写飞书，不回填采购状态。

## 本地开发

    cd extensions/xynigo-shein-purchase-assistant
    npm test
    npm run build:dev
    npm run build

Comet / Chromium 本地测试使用构建结果中的：

```text
dist/
  xynigo-shein-purchase-assistant-dev/
    manifest.json
    src/
    popup/
    icons/
```

在 Comet 扩展管理页开启开发者模式，选择“加载已解压的扩展程序”，直接选择上述 `*-dev` 目录。该目录不包含执行器、真实配置或任务样例；本机仍使用已安装的 Xynigo 主执行器。

## 已知限制

- 仅针对 shein.com.mx 墨西哥站地址页。
- 表格列名改动后需要同步更新执行器字段映射。
- SHEIN 页面语言或 SUI 组件结构变化时，字段定位可能需要升级。
- 首版只读协作表；下单结果、订单号、物流回填尚未实现。
- 首版由采购员在插件面板选择任务，尚未自动关联 HubStudio 环境序号。
- 浏览器在部分网络错误中只返回通用失败信息；终端已经显示主执行器运行但插件仍不可达时，应继续检查团队“本地访问”。
- 当前仍由普通飞书电子表格临时供数；采购中心 API 上线后再替换 provider。
- 更新团队扩展时应取消旧版对同一环境的分配，避免多个版本的内容脚本同时运行。

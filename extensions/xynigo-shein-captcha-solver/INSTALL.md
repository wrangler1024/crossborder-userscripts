# Xynigo SHEIN Captcha Auto Solver 安装说明

选品/采购过程中自动处理 SHEIN 的 nine-captcha 九宫格验证码（整页 `/risk/challenge` 或弹窗形态），按页面当前规则标题识别“同类”“相同卡片”“包含某物”等玩法变体。
识别层为**可配置视觉模型**：智谱 GLM / 豆包·火山方舟 / Google Gemini / 任意 OpenAI 兼容接口，
并内置**双模型对比**与**样本回放评测**，用于横向比较模型效果。API Key 仅保存在本机。
页面右下角常驻状态卡，会实时显示等待、配置异常、识别轮次、点击编号、通过或失败，可手动收起。
扩展图标与设置页对齐 Xynigo VI：深海军蓝、小犀青、包裹黄与珊瑚红分别承载系统、交互、处理中与通过状态。

## 安装（Chrome / Comet / HubStudio，开发者模式）

1. 打开浏览器扩展管理页（如 `chrome://extensions/`），开启右上角「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本目录（含 `manifest.json` 的 `xynigo-shein-captcha-solver/`）。
3. 本扩展为独立模块，不依赖 Shein Global Selector，可与其他扩展并存。

## 配置识别模型（扩展弹窗）

点击工具栏扩展图标打开弹窗：

| Provider | Base URL（预填） | model 填法 | Key 来源 |
|---|---|---|---|
| 智谱 GLM（免费档） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-flash`（快）/ `glm-4.6v-flash`（视觉推理，准确率优先）/ `glm-4.1v-thinking-flash` | [open.bigmodel.cn](https://open.bigmodel.cn) 控制台 |
| 豆包 · 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 推理接入点 `ep-xxxx`（需实名+创建接入点）或模型名 | 火山方舟控制台 |
| Google Gemini | `…/v1beta/openai` | `gemini-2.5-flash` 等 Flash 系列 | Google AI Studio |
| 自定义 | 任意 OpenAI 兼容地址 | 按服务商文档 | 对应平台；首次保存时会请求该域名的访问权限 |

- 保存前可点「测试连接」验证 endpoint / key / 图像链路。
- Tampermonkey 形态：菜单「编辑模型配置（JSON）」可改全部字段。

## 模型效果对比（两种方式）

1. **双模型对比模式**（弹窗开启）：每次真实解题，同一张编号拼图并行发给主模型与影子模型，
   主模型负责点击过验，影子模型只记录答案。日志按 puzzleId 配对，弹窗展示各模型过验率与答案一致率。
2. **样本回放评测**：开启「采集样本」后，每次过验的拼图 + 命中编号自动存为样本（本机，上限可配）。
   换任意模型配置后点「对样本回放当前模型」，即离线得到该模型的全对率/查准/查全/平均耗时，
   不需要等真实验证码触发，也不影响选品。

## 工作原理（v0.4.0）

1. MutationObserver + 2 秒轮询检测 `<nine-captcha-custom>`（内容在 open Shadow DOM，含 iframe 搜索）。
2. 穿透 shadowRoot 取 1 张提示图（≤64px）+ 9 张格子图（≥80px，按视觉位置行优先排序）；
   `ltwebstatic.com` 图片 URL 有过期机制，取到立即拉取，单图失败画灰格容错（超过 3 张放弃本轮）。
3. 本地 Canvas 合成「提示图 + 编号九宫格」单图（每格左上角印红色编号 1-9，384x556）。
4. 发给所配置的视觉模型（OpenAI 兼容 chat/completions），只回同类格子编号 JSON；
   个别平台拒绝 dataURL 时自动降级裸 base64 重试。
5. 在格子中心合成 pointer+mouse 全序列事件逐个点击（点够自动校验，无确认按钮）；
   失败点刷新按钮换图重试，最多 3 轮后交还人工。
6. 扩展形态的跨域请求（拉图 + 识别 API）由 background service worker 执行（host_permissions 豁免 CORS）。

## 验证方式

1. 弹窗「测试连接」：先验证 endpoint/Key/图像链路通。
2. 正常选品、翻页，等验证码自然触发；DevTools Console 观察 `[XynigoCaptchaSolver]` 前缀日志：
   已启动 → 第 n 轮识别 → 识别结果 → 验证码已通过。
3. 连续 3 轮失败会停止并交还人工；401 提示 Key 无效，在弹窗更新即可。

## 已知限制（v0.4.0）

- 仅覆盖 nine-captcha 九宫格形态；会从弹窗标题提取本轮选择规则，其他验证码形态未实现。
- 点击为合成鼠标事件（isTrusted=false）；SHEIN 当前不拦，若升级检测可能失效。
- 各家 API 从墨西哥出口的可达性/延迟、免费档并发限速尚未实测；建议先用「测试连接」验证。
- 样本金标准 = 点击后过验的编号组合；若 SHEIN 接受部分命中，回放评分存在少量噪声。

## 维护

- 规范源 = 扩展 `src/`（config / puzzle / vision-client / stats / captcha-agent / content / background）；
  userscript 由 `scripts/shein-captcha-solver/build-userscript.js` 从共享源码生成，勿手改。
- 版本单一事实源 = `manifest.json`；`sh build.sh [--dev|--release|--all]` 一键校验+构建+测试。
- 评测数据（日志/样本）存 `chrome.storage.local`，键 `xynigoCaptchaLogs` / `xynigoCaptchaSamples`；
  Tampermonkey 形态存站点 localStorage 同名键。
- 本模块为独立扩展（不搭车选品器），当前为内部验证版，未上架 Chrome 商店、未随其他扩展发版。

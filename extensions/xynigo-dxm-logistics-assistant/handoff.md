# Xynigo 店小秘物流助手｜新会话交接

> 更新时间：2026-09-05（Asia/Shanghai）
>
> 当前结论：代码已落到 `v0.3.2`，下一会话优先做待处理页面范围验收和 1 个真实测试订单的拆单前现场核对；未经用户当次授权不要执行真实拆单或发货。

## 1. 当前里程碑

| 项目 | 当前值 |
|---|---|
| 版本 | `0.3.2` / `0.3.2-processing-only-beta` |
| 分支 | `main` |
| 功能代码基线 | `737db41 fix(logistics): activate on processing page`；交接文档提交号以 `git log` 为准 |
| 生效页 | 店小秘“订单—待处理” `/web/order/approved` |
| 明确不生效 | 待审核 `/web/order/paid`、已交运、发货失败、全部订单及其他页面 |
| Tampermonkey | 主分支脚本已推送；如 Raw 主链接仍缓存旧版，用提交固定链接核对 |
| 扩展 ZIP | `dist/xynigo-dxm-logistics-assistant-v0.3.2.zip` |
| ZIP SHA-256 | `6948a3e8325f0ce4d48dc6c70839600cce5612d9860d9b3186131b79f90042ec` |
| 自动化测试 | 54 通过、0 失败、3 个旧失败单重提测试跳过 |
| 真实自动拆单验收 | 尚未执行 |

立即安装当前提交：

<https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/737db41/scripts/dxm-logistics-assistant/xynigo_dxm_logistics_assistant.user.js>

主分支自动更新地址：

<https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/dxm-logistics-assistant/xynigo_dxm_logistics_assistant.user.js>

## 2. 本轮最后完成的功能

1. 店小秘待处理页面范围限定：manifest、Tampermonkey `@match` 和运行时 pathname 三层都指向 `/web/order/approved`。
2. SPA 切页保护：离开待处理页后自动移除入口和空闲窗口；拆单和发货前再做一次路径检查。
3. SHEIN 自动拆单：读取 `splitKey/productCount`，按采购子单分配商品和数量，生成完整数量矩阵。
4. 两次确认：第一次只拆单，拆后回读新包裹；人工映射和承运商预检后第二次确认才发货。
5. 部分到货：本批已出物流子单拆出，未出物流商品留在原包裹，下次继续。
6. 并发发货：默认 2、可选 1–4；接口繁忙自动降为串行，结果未知停止派发。
7. 发货执行监控：显示进度、时长、初始/当前并发、繁忙次数和首次触发行。

## 3. Bug 排查与修复记录

| 现象 | 根因 | 修复 | 防回归 |
|---|---|---|---|
| 发货请求 HTTP 404 | 旧脚本/错误路径与店小秘当前接口不一致 | 发货固定为 `/api/package/withOutPrintShip.json`，平台选项为 `/api/order/withOutPrintShippingList.json` | package test 校验端点；浏览器冒烟验证请求体 |
| 输入 iMile 但店小秘发货失败 | 店小秘同时可能返回 `iMile` 与小写 `imile`，二者不是同一可提交选项 | `iMile` 改为大小写敏感精确匹配；小写 `imile` 不再作为兜底 | core test 覆盖两者同时存在和仅小写场景 |
| J&T/J&T Express 名称不一致 | Xynigo Web 名称和店小秘平台承运商名称不同 | 输入侧归一为 `J&T`，提交使用店小秘实时唯一匹配的精确 providerName | 墨西哥承运商夹具覆盖 |
| 搜索同批订单提示“未找到”，并出现大量无法回读记录 | 插件曾扫描当前整页，店小秘搜索未真正收敛 | 强制切“搜索”模式，选择订单号类型，提交本批订单号后只读目标 `rowid` | 无搜索框、混入外部行、五订单批量测试 |
| 搜索结果显示 10 条但 5 条不属于本批 | 店小秘页面残留其他行/旧状态，插件不能把未收敛结果当目标 | 页面仍含非本批行时整批阻断，不继续详情和发货 | “search result still contains rows outside batch” 冒烟测试 |
| 已搜索成功仍被旧分页数量阻止 | SPA 同时保留旧分页总数和新搜索结果总数 | 优先选择等于当前目标行数或在预期上限内的合理计数 | commit `917e0c6` 及 stale paginator 测试 |
| 固定列导致重复包裹/行数异常 | VXE 表格会渲染主表和固定列镜像行 | 按内部 `rowid` 合并，图片证据去重 | 多行读取和计数测试 |
| 当前只剩 1 个包裹时可能误映射 | 不能判断它是未拆原包裹还是最后残余包裹 | 单包裹额外人工确认；多件未拆时进入拆单计划 | single-package confirmation 测试 |
| 50 行限制不够 | 初版为了避免跨页漏读设置过小 | 统一提高为 300，与单页安全回读上限一致 | import/core 300/301 边界测试 |
| Comet 屏蔽模板下载 | 直接打开 `chrome-extension://` 地址被浏览器拦截 | 内置模板转 Blob URL，在页面上下文触发下载 | userscript/浏览器下载冒烟测试 |
| Excel 长物流号变科学计数法/丢位 | WPS/Excel 默认把长数字当数值 | 模板输入区设文本格式；导入拒绝数字、公式和科学计数法 | xlsx/import 测试 |
| 模板录入区域不易逐行核对 | 只有表头样式，没有输入区网格 | 300 行输入区增加浅灰单元格线 | 模板打包测试 |
| 批量并发开始快、后面明显降速 | 店小秘返回“正在执行移入运单号申请”，旧 UI 不解释降级 | 记录繁忙事件并自动降并发为 1，窗口展示当前并发和时长 | commit `688b34c`、并发降级测试 |
| 误把待审核配置为生效页 | “待审核/待处理”业务口语混淆；店小秘路由名并不直观 | 最终确认：`paid=待审核`、`approved=待处理`，`v0.3.2` 只用后者 | processing route + SPA navigation test |
| GitHub Raw 主链接短时仍显示旧版本 | Raw CDN 缓存滞后，不是推送失败 | 先用 `git ls-remote` 和提交固定 Raw URL 核对，再等待主链接刷新 | 发版交接固定记录 commit URL |

## 4. 拆单接口现场研究结论

- 当前店小秘前端对 SHEIN 使用批量多包裹拆单模式 `type=1`。
- 拆单详情：`POST /api/order/splitedOrderDetail.json`。
- 实际拆单：`POST /api/order/batchSplitOrder.json`。
- `splitOrderList` 必须是 JSON 字符串；每个包裹向量都带全量 `splitKey`，数量为字符串，不属于该包裹的商品填 `"0"`。
- `/api/order/batchSplitOrderBySku.json` 的当前前端提示只适用于 Shopify/手工订单，不应用于 SHEIN。
- `/api/order/splitOrder.json` 是其他平台的单拆模式，不应用于当前 SHEIN 流程。
- 研究时只读打开过店小秘拆单计划界面，确认商品、包裹 1/2 和“添加包裹”交互；没有点击最终拆分按钮。

## 5. 当前已知限制与风险

- 自动执行拆单仍是 beta，尚缺真实测试订单验收；模拟通过不能等同生产可用。
- 页面范围改到待处理后，需要现场确认团队账号在该页能正常读取拆单详情和调用不打单发货。
- 一个原订单若当前同时存在多个待处理包裹，但本批采购子单数量又多于包裹数，插件会因无法确定应继续拆哪个包裹而阻断。
- 商品与采购子单仍需人工按图片、SKU/规格和数量匹配，暂不做智能猜测。
- 自动识别物流商需求已暂缓；不要在下一会话自行扩展。
- 失败单重提代码仍在共享源码，但页面入口已移除且 manifest 不匹配发货失败页；3 个相关浏览器测试目前跳过。后续可单独删除死代码，或拆成另一个明确作用域插件。
- GitHub Release 稳定包仍是 `v0.1.14`。不要给采购把 `v0.3.2` 说成稳定 Release。

## 6. 工作区注意事项

当前仓库长期存在与本项目无关的用户改动，主要包括：

- 根 `README.md`；
- `extensions/xynigo-dxm-purchase-assistant/**`；
- `scripts/dxm-purchase-assistant/**`。

不要重置、清理、暂存或提交这些文件。发版时始终使用明确路径 `git add`，提交前检查 `git diff --cached --name-only`。

## 7. 关键文件

- `src/core.js`：输入解析、物流商匹配、详情解析、拆单矩阵、发货响应分类、CSV。
- `src/content.js`：页面范围、UI、搜索收敛、接口调用、拆单/发货状态机、并发队列。
- `src/content.css`：右侧入口、弹窗、拆单计划、映射和执行监控样式。
- `src/import.js`：CSV/XLSX 本地导入和字段校验。
- `src/template-data.js`：由内置 xlsx 转出的 Base64 模板数据。
- `tests/browser-smoke.test.js`：完整页面流程与安全边界。
- `tests/core.test.js`：纯逻辑和拆单矩阵。
- `tests/package.test.js`：manifest、端点、版本和包结构。
- `scripts/dxm-logistics-assistant/userscript.test.js`：生成脚本一致性与 Tampermonkey 运行。

## 8. 新会话启动命令

```bash
cd /Users/jeff/Documents/crossborder-userscripts
git status --short
git log -5 --oneline -- extensions/xynigo-dxm-logistics-assistant scripts/dxm-logistics-assistant
npm run test:xynigo-dxm-logistics
```

构建：

```bash
npm run build:xynigo-dxm-logistics:userscript
npm run build:xynigo-dxm-logistics:dev
npm run build:xynigo-dxm-logistics
```

完整构建会生成：

- `dist/xynigo-dxm-logistics-assistant-dev/`
- `dist/xynigo-dxm-logistics-assistant-v<version>.zip`

## 9. 推荐的下一步

严格按 [`task.md`](./task.md) 的 P0 顺序执行。第一步只验证页面范围和只读预检；真实拆单必须等用户提供一个明确测试订单并在最终点击前再次授权。

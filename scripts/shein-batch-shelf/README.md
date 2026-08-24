# SHEIN 批量上下架（安全版）

> 当前版本：**v2.0.0**
> 当前状态：**安全改造完成，待测试店铺验收；暂不向运营开放**

## 功能

- 按 SKC 和站点批量上架或下架。
- 自动读取全部“已售罄”商品后批量下架。
- 支持美国、墨西哥以及法国、西班牙、德国、意大利、荷兰、瑞典、波兰、葡萄牙站。
- 每 50 个 SKC 组成一个批次，顺序执行。

## v2.0.0 安全改造

- 站点默认全部不选，未选择站点不能生成预览。
- SKC 自动清理空值和重复项，单次最多处理 5000 个。
- 写入前展示操作、SKC、站点、影响组合和批次数量。
- 必须输入“确认上架”或“确认下架”才能发送写请求。
- 执行期间锁定输入，防止重复提交。
- 支持停止后续批次；已经发送的当前批次会等待明确结果。
- 网络错误、HTTP 429 和 5xx 最多自动重试两次；业务拒绝不盲目重试。
- 已售罄商品任意分页读取失败时中止预览，不使用不完整数据继续下架。
- 分别统计“API 已受理”“失败”和“未执行”，不再按输入数量显示假成功。
- 结果可导出 CSV；最近 10 次操作同时保存在当前浏览器本地。
- 移除未使用的高权限 Userscript grant，不向第三方发送 Cookie、账号或商品数据。

## 操作流程

1. 进入 SHEIN 卖家后台商品列表页，点击右上角“安全批量上下架”。
2. 选择操作类型，粘贴 SKC；“下架已售罄商品”由脚本只读获取 SKC。
3. 手动选择目标站点。建议验收阶段只选择一个站点。
4. 点击“生成操作预览”，核对 SKC 数量、站点和批次。
5. 输入页面指定的确认词，然后点击“确认并执行”。
6. 等待批次结束并导出 CSV；在 SHEIN 后台抽查商品最终状态。

## 结果口径

- **API 已受理**：SHEIN 接口对该批次返回明确的 `msg: OK`。
- **失败**：HTTP、网络或业务返回未获得明确成功结果。
- **未执行**：用户停止、离开商品列表页或执行器提前中止后，没有发送的 SKC。

“API 已受理”不等于每个 SKC 的最终状态已经逐条复核。当前没有确认可靠的批量状态查询接口，因此 v2.0.0 不宣称自动验收或自动回滚。

## 测试店验收标准

- 使用脱敏或测试 SKC，首次只处理 3～5 个 SKC 和一个站点。
- 未生成预览、未输入正确确认词时，浏览器不得发送上下架写请求。
- API 失败时不得显示为“已受理”。
- 点击停止后，只允许当前已发送批次结束，不再发送新批次。
- CSV 中的 SKC、站点、状态和后台实际结果一致。
- 通过上架、指定 SKC 下架、已售罄下架三种场景后，才考虑扩大样本。

自动化测试：

```bash
npm run test:shein-batch-shelf
```

## 安装

当前仍不向运营开放。开发或验收人员确认风险后，可使用以下 Raw 地址安装：

[安装测试版脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-batch-shelf/shein_removed_shelves.user.js)

Chrome / HubStudio 通用安装包可在仓库根目录构建：

```bash
npm run build:xynigo-shelf
```

输出文件为 `dist/xynigo-shein-batch-shelf-v2.0.0.zip`。扩展不依赖 Tampermonkey；详细步骤见包内 `INSTALL.md`。本地联调可执行 `npm run build:xynigo-shelf:dev`，然后在扩展管理页加载 `dist/xynigo-shein-batch-shelf-dev`。

已构建的测试版安装包：

[下载 HubStudio / Chrome v2.0.0 ZIP](https://github.com/wrangler1024/crossborder-userscripts/releases/download/shein-batch-shelf-v2.0.0/xynigo-shein-batch-shelf-v2.0.0.zip)

## 已知限制

- 依赖 SHEIN 卖家后台内部接口、路由和返回结构，平台更新后可能失效。
- 当前只能得到批次级接口受理结果，不能证明每个 SKC 的最终状态。
- 未实现操作前状态快照、状态复查和自动回滚。
- 本地操作记录保存在浏览器站点存储中，清理浏览器数据后会丢失；重要操作应导出 CSV。

## 迁移来源

- 原始文件：[68110923/chrome_plugins](https://github.com/68110923/chrome_plugins/blob/ddcc16ddcd324c502f4a3294480e8a7bcf921064/plugins_yh/shein_removed_shelves.user.js)
- 迁移快照：`ddcc16d`
- v1.0.4 迁移时保留原业务逻辑和原作者信息；v2.0.0 在此基础上完成安全执行改造。

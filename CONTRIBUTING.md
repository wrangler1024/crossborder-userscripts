# 插件开发与分发

状态：v1 定稿 · 20260910，经 Jeff 确认。共同底线见 [AGENTS.md](AGENTS.md)。所有命令均在本仓根目录执行；使用 Node.js 22，先运行 `npm ci`。仓库没有覆盖全部组件的根目录 `npm test`，不能用不存在的统一命令代替组件测试。

## 源码与生成方向

| 组件 | 权威源与输出方向 | 验证入口 |
|---|---|---|
| 店小秘提单助手 | `extensions/xynigo-dxm-purchase-assistant/` 源码，加 `scripts/dxm-purchase-assistant/userscript-runtime.js` → 同目录生成油猴脚本；扩展 build.sh 打包 | 扩展 tests 与油猴 userscript.test.js |
| 店小秘物流助手 | `extensions/xynigo-dxm-logistics-assistant/` 源码、模板与资源 → `scripts/dxm-logistics-assistant/` 生成油猴；扩展 build.sh 打包 | 扩展 tests 与油猴 userscript.test.js |
| SHEIN 采购助手 | `extensions/xynigo-shein-purchase-assistant/` → 扩展包；当前不假定存在油猴版 | `npm run test:xynigo-shein-purchase` |
| 验证码解题助手 | 扩展 `src/` 加 `scripts/shein-captcha-solver/userscript-runtime.js` → 油猴；扩展 build.sh 打包 | 扩展 tests 与油猴 tests |
| SHEIN 选品器 | `scripts/shein-globalship-selector/` 油猴源 → 扩展 content.js；扩展目录维护 manifest/background | `npm run test:xynigo-selector` |
| 售价对比 | `extensions/xynigo-shein-price-compare/` 加型号助手油猴源 → 扩展包及嵌入的 variant-library.js | `npm run test:xynigo-price-compare` 和 `npm run test:xynigo-variant` |
| 型号助手 | `scripts/shein-product-variant-helper/` 油猴源 → 扩展 content.js；扩展目录维护 manifest | `npm run test:xynigo-variant` |
| 店铺接码助手 | 扩展源码加 `scripts/shein-store-otp-assistant/userscript-runtime.js` → 油猴；扩展 build.sh 打包 | 扩展 tests 与油猴 userscript.test.js |
| 批量上下架 | `scripts/shein-batch-shelf/` 油猴源 → 扩展 content.js；扩展目录维护 manifest | `npm run test:shein-batch-shelf` |
| SKC 指标导出 | `scripts/shein-skc-metrics-exporter/` 油猴源 → 扩展 content.js；扩展目录维护 manifest | `npm run test:xynigo-skc-export` |

生成器仍可能读取模板、CSS、图标或 vendor 文件，准确清单以脚本为准。不是所有 `.user.js` 都是生成文件，也不是所有扩展都是唯一源。`dist/` 和交付 ZIP 是产物，不作为编辑入口；模板二进制与嵌入数据变更需检查实际下载内容一致。

## 生成检查和组件测试

修改时按组件生成并审阅差异。验证已提交候选时使用专用独立 worktree，将 `XYNIGO_REVIEW_SHA` 设置为交接中的完整候选提交 SHA，先执行下面检查；任一步失败即停止，不在开发者使用中的目录切换检出：

```bash
: "${XYNIGO_REVIEW_SHA:?请先设置评审交接中的完整候选提交SHA}"
test -z "$(git status --porcelain)" || exit 1
git switch --detach "$XYNIGO_REVIEW_SHA" || exit 1
test "$(git rev-parse HEAD)" = "$XYNIGO_REVIEW_SHA" || exit 1
git log -1 --format='%H %s'
```

确认候选一致后运行受影响生成器，再比较提交与输出；不能让测试中的自动生成掩盖原提交漏文件。

当前四个油猴生成入口如下，按影响范围选择：

```bash
node scripts/dxm-purchase-assistant/build-userscript.js
node scripts/dxm-logistics-assistant/build-userscript.js
node scripts/shein-captcha-solver/build-userscript.js
node scripts/shein-store-otp-assistant/build-userscript.js
git diff --exit-code -- scripts extensions
git ls-files --others --exclude-standard -- scripts extensions
```

diff 须无差异，新增文件列表须为空；否则报告候选生成物不同步。生成器没有只读检查模式，本段步骤会写入独立验证工作区。公开待办及验收要求见下方[待实施的机器门禁](#待实施的机器门禁)。

以上四组组件测试可直接运行，不通过先生成的 npm 包装命令：

```bash
node --test extensions/xynigo-dxm-purchase-assistant/tests/*.test.js scripts/dxm-purchase-assistant/userscript.test.js
node --test extensions/xynigo-dxm-logistics-assistant/tests/*.test.js scripts/dxm-logistics-assistant/userscript.test.js
node --test extensions/xynigo-shein-captcha-solver/tests/*.test.js scripts/shein-captcha-solver/tests/*.test.js
node --test extensions/xynigo-shein-store-otp-assistant/tests/*.test.js scripts/shein-store-otp-assistant/userscript.test.js
```

其余组件使用上表入口。根目录 `test:xynigo-dxm-logistics`、`test:xynigo-shein-otp` 会先生成；不能只提供这两个命令成功就宣称提交中的生成文件已一致。

当前 [.github/workflows/shein-price-compare.yml](.github/workflows/shein-price-compare.yml) 覆盖售价对比和型号助手相关路径，未覆盖九个组件。其他组件提供命令与结果，不将 CI 未触发称为通过。后续 CI 扩容应覆盖受影响组件及共享依赖，不能仅按扩展目录过滤而漏掉脚本、模板或公共依赖变更。

## 待实施的机器门禁

本节是本仓贡献者可直接查阅的公开工程待办；不依赖私有审阅索引。以下能力尚未在本次文档修订中实现：

| 工作 | 验收要求 |
|---|---|
| 四组油猴生成器增加只读检查 | 共享生成逻辑；正确输出通过，过期/缺失输出失败；不写文件或创建目录，检查前后工作区不变 |
| CI 扩容到九个组件及共享依赖 | 按影响运行检查，覆盖脚本、模板、公共依赖；只读一致性检查先于任何生成或构建，不能先补生成再报告原提交通过 |

## 打包与验收

使用对应扩展 `build.sh` / `build.js` 或 package.json 中已存在的入口。build 可能重新生成油猴并改写 dist，执行后再次核对版本和 diff。版本号以该组件 manifest/油猴源的既有规则维护；递增对应发布版本，不对九个独立组件统一凑版本。

打包检查包含：manifest 版本、油猴 `@version`、源码对应关系、ZIP 目录结构、资源和脚本引用、权限与匹配站点。售价对比的 HubStudio 包与普通包结构不同；不能把一种 ZIP 结构推广到所有组件。清洁构建目录，防止旧文件混入。

油猴版与扩展版分别检查启动、样式、请求桥、剪贴板和下载；不能以 Node 单元测试代替真实浏览器适配验收。不要在同一页面同时启用同一组件的油猴和扩展，更新团队扩展时核对旧版分配，防止重复入口或重复写入。

涉及删除、审核、上下架、议价、库存修改、拆单和发货等写入时，先用明确授权的测试账号及小批量目标验收。保留预览、精确匹配、不可逆确认和结果未知停止机制；接口受理不代表最终成功，超时不默认重试。验收证据脱敏记录，未验收能力不向运营开放。

## 分发与自动更新

发布记录分别写清：源码 SHA/版本、油猴渠道与版本、扩展包版本/哈希、验收范围、最低执行器能力和独立评审状态。README 展示与实际链接对象要一致；不能让 README 写稳定版而安装链接实际指向未经验收的新脚本。

推送到运营跟随的 `@updateURL` / `@downloadURL` 路径会产生分发影响，即使没有打 tag 或上传 ZIP。本仓目前多处链接跟随 main，须在合并到该路径前满足该渠道的授权、评审和验收要求。

待验收开发保留在独立分支/受控测试包中，不提前覆盖运营更新入口；若需要稳定/测试双渠道，先形成具体地址与版本策略并取得授权，再更改现有入口。本次规约定稿没有迁移任何分发渠道，也不假定已经有双渠道实现。

发版依次完成：固定候选与兼容范围、组件验证与独立评审、授权范围确认、从干净提交构建、核对资产与元数据、按授权分发、回读实际可下载版本/哈希及更新入口、更新发布记录。只记录真实完成的步骤；未发布时可提交草案或候选，不将其描述为已上线。

tag 发布后不移动，同版本包不静默替换；修复发布新版本。跨仓协议遵循“接收方先兼容新旧输入，再发布生产者”，并考虑历史数据与旧客户端，不硬编码主仓必定先发。

## 提交安全与交接

`git diff --check` 后逐文件暂存，查看 `git diff --cached`；不要将 node_modules、dist、临时输出、真实凭证、接码链接、订单或完整页面记录提交公开仓库。插件权限、站点匹配和网络目标变化列入评审，不将公共发布当作上传私有排障材料的渠道。

交接写核验时间、仓库/分支/SHA、未提交改动归属、验证、评审、分发状态和下一步。组件既有 handoff 可以继续使用，但历史不得冒充当前状态；只读评审无需覆盖全仓交接。

共同契约及模板按 [AGENTS.md](AGENTS.md) 指向主仓读取。若相关文档仍在配对草案分支，使用任务交接列出的分支/提交；两仓合并后再核验公共链接。

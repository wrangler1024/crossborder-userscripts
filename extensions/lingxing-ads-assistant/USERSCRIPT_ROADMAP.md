# 油猴与Chrome双渠道发布

本地版本：0.9.7（未发布），线上版本：0.9.6，2026-11-11。运营使用固定油猴安装链接，本地开发继续在 Ego 扩展管理加载原生开发目录。两渠道每次发布使用相同版本、业务源码、空白模板和固定 SheetJS。

## 安装与更新

- [油猴一键安装](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant.user.js)：先安装 Tampermonkey，允许用户脚本，然后确认安装。
- [Chrome安装包](https://github.com/wrangler1024/crossborder-userscripts/releases/tag/lingxing-ads-assistant-v0.9.6)：解压并加载。开发目录为本模块 `dist/extension`。
- [版本元信息](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant.meta.js)：仅用于自动检查版本。

油猴的 name、namespace、安装地址和更新地址保持稳定，发版递增 version。更新检查频率由 Tampermonkey 设置决定；也可点油猴菜单“检查广告助手更新”。更新不会自动运行校验或创建。依据：[Tampermonkey官方更新说明](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url)。

## 源码与适配

| 内容 | 原生扩展 | 油猴版 |
| --- | --- | --- |
| 广告模型、校验、预览、创建、回读 | 同一份 `src/`，由 `scripts/bundle.mjs`组装 | 同左 |
| 入口 | 贴边入口、浏览器扩展弹窗 | 贴边入口、Tampermonkey菜单 |
| 本地数据 | `chrome.storage.local`，后台串行服务 | 领星站点 IndexedDB，每次操作持有跨标签 Web Lock |
| 更新 | 覆盖原目录、重新加载、刷新领星 | 稳定 meta/user 地址检查版本并下载；刷新领星使用新版 |
| 交付 | `dist/extension`及ZIP | 仓库 `scripts/lingxing-ads-assistant/`的生成 user/meta/runtime 文件 |

完整助手仅匹配 `https://ads.lingxing.com/amazon/*` 顶层页面；0.9.2另匹配`https://ads.lingxing.com/ad_report/*`顶层旧广告页面，仅提供轻量跳转入口。旧页点击后同标签页跳固定新版SP地址，通过一次性短期标记打开助手，不传递旧页店铺或MSKU查询参数。标记优先使用sessionStorage，不可用时回退到带时效的URL参数；消费后移除。原生仍仅申请storage；油猴仅使用unsafeWindow与菜单权限。0.9.1起安装入口使用一个固定tag、带SHA-256 SRI的同仓runtime依赖，由Tampermonkey下载并缓存；校验失败不执行，禁止降级为无校验动态加载。页面会话只在内存，不写入本地记录、备份或源码。

油猴不使用每页缓存作为创建记录权威。缺少IndexedDB、Web Locks或保存失败时停止创建；多页旧版本不能覆盖新保存。单页同时加载两渠道时，运行标记拦截第二实例，但不同渠道的数据库仍独立，运营须选择一种启用。

## 从原生切换

旧原生版先沿用原目录更新到0.9.0，导出“本地备份”；停用原生扩展并刷新领星；油猴版在同一领星账号下导入。备份包含预览与创建记录，恢复时校验账号、结构、负载及哈希。同名冲突拒绝导入，不将已提交记录降为可重发。

更新保留现有存储；清理领星站点数据会清除油猴记录，卸载原生扩展会清除其记录。跨电脑不自动同步。备份属于内部业务文件，不上传公开仓库。未知结果恢复后先核实，不自动再提交。

## 每次发布

1. 在独立工作区改权威源码、递增模块package与APP_VERSION，执行模块 `npm ci`。
2. `npm run build:all`生成两渠道；`npm test`检查共享流程和实际生成脚本。
3. 固定候选提交，独立评审者先运行根目录 `npm run check:lingxing-ads:userscript`，再测试、构建，防止自动生成掩盖漏文件。
4. 在Ego使用原生本地包；油猴验收启动、预览、恢复、菜单和更新。写入适配变更需额外小批量授权验收。
5. `npm run release:lingxing-ads`生成Chrome包与运营试用包，核对版本、内容和哈希。公开上传前为ZIP准备ASCII版本文件名（如`lingxing-ads-assistant-v0.9.6-chrome.zip`），发布校验清单必须对应实际下载文件名，避免GitHub简化中文名后无法直接校验；本地中文包可继续保留。
6. 通过独立评审后，先推送指向已审核提交的唯一版本tag，回读tag下runtime文件并校验SHA-256。依赖可达后才推送main的user/meta更新入口，最后发布Release，同次上传Chrome包、user/meta/runtime和校验文件。tag必须先于更新入口可用，不能让运营收到依赖尚不存在的更新。

不要移动已发布tag或静默替换同版本资产。0.9.3起支持有效库存0–9件预览和暂停创建；启用仍要求至少10件，且提交前重新读取。不会在到货后自动启用。

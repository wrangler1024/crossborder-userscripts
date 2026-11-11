# 领星广告创建助手 油猴版

版本：0.9.0。首次安装 Tampermonkey 并允许用户脚本，然后点击[一键安装](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant.user.js)。

后续使用同一安装地址；脚本管理器按设置检查meta版本，再下载新脚本。运营也可从油猴菜单点击“检查广告助手更新”。同版本[Chrome/Ego安装包](https://github.com/wrangler1024/crossborder-userscripts/releases/tag/lingxing-ads-assistant-v0.9.0)同时发布，本地开发仍使用原生扩展管理加载未打包目录。

使用前停用同功能原生扩展；切换渠道请先在0.9.0原渠道导出本地备份，再在新渠道同一领星账号下导入。两个渠道存储独立。油猴数据保存在领星站点的本机IndexedDB，清理站点数据前请备份。

广告模型、批量创建和确认保护共用源码。导入、安装、升级、恢复不会自动提交广告；批量创建必须在预览后明确确认。

权威源与完整说明在[扩展模块](../../extensions/lingxing-ads-assistant/README.md)。此目录的user/meta由 `node scripts/lingxing-ads-assistant/build-userscript.mjs` 生成，不手工修改。只读一致性检查使用 `npm run check:lingxing-ads:userscript`。

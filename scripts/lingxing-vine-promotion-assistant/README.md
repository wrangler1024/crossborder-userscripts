# 领星 Vine 推广标注助手油猴版

版本：`0.1.4`

一键安装：

https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-vine-promotion-assistant/lingxing-vine-promotion-assistant.user.js

油猴版与 Chrome 扩展使用相同的 Vine 判断、待标预览、人工确认、分批标注和回读逻辑。单文件包含核心逻辑、页面会话监听、插件界面和样式，不依赖远程运行时代码。

## 构建

```bash
node scripts/lingxing-vine-promotion-assistant/build-userscript.mjs
node --test scripts/lingxing-vine-promotion-assistant/tests/userscript.test.js
```

构建会生成：

- `lingxing-vine-promotion-assistant.user.js`
- `lingxing-vine-promotion-assistant.meta.js`

## 安全边界

- 扩展和油猴版选择一种启用。
- 会话请求头仅保存在当前页面内存，不写入油猴存储。
- 油猴存储只保存检查摘要、待标核对字段、执行记录和入口位置。
- 写接口仍要求人工勾选与二次确认；每批最多 20 笔，提交后逐单回读。

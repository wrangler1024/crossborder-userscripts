# 🛒 crossborder-userscripts

> 跨境电商团队 · 效率油猴脚本集合

为团队统一维护的 Tampermonkey 用户脚本库。团队成员只需装一次 Tampermonkey，点击下方「一键安装」即可使用所有脚本，**后续更新全自动同步，无需重装**。

---

## 📋 脚本目录

| 脚本 | 解决的问题 | 一键安装 |
|---|---|---|
| **领星 ERP 禁用双指滑动后退** | 在领星查看宽表格（如「产品表现」）时，左右拖动误触发浏览器后退 | [一键安装](./scripts/lingxing-disable-swipe-back/lingxing-disable-swipe-back.user.js) |
| _（更多脚本持续添加中…）_ | | |

---

## 🚀 快速开始（团队新人必读）

1. **装 Tampermonkey**（一次性）—— 见 [安装教程](./docs/how-to-install.md)
2. **点脚本旁的「一键安装」** —— Tampermonkey 自动弹确认框，点安装即可
3. 完事。打开目标网站直接用

详细的图文教程和常见问题：👉 **[docs/how-to-install.md](./docs/how-to-install.md)**

---

## 📁 仓库结构

```
crossborder-userscripts/
├── README.md                # 你现在看的这个
├── docs/
│   └── how-to-install.md    # Tampermonkey 安装图文教程
└── scripts/
    └── <脚本名>/
        ├── README.md        # 脚本说明 + 原理 + 已知限制
        └── <脚本名>.user.js # 脚本本体
```

后续新增脚本都按 `scripts/<脚本名>/` 这个结构组织，每个脚本自带独立说明文档。

---

## 🔧 技术约定（给脚本作者）

为了保证脚本能在团队内稳定分发和自动更新，新增脚本时请遵守：

- 文件名以 **`.user.js`** 结尾 —— 浏览器/Tampermonkey 据此识别为用户脚本，点击链接才会触发自动安装框
- **必须有 `@version`**，每次修改递增
- **必须配置 `@downloadURL` 和 `@updateURL`**，指向本仓库的 raw 链接，保证自动更新可用：
  ```
  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/<脚本名>/<脚本名>.user.js
  ```
- 用 `@match` 精确限定生效域名，避免影响其他网站
- 推荐加 `@icon`（可用 Google Favicon 服务），方便团队成员在脚本列表辨认
- 每个脚本独立子目录，配 `README.md` 说明用途、原理和已知限制

---

## 🤝 贡献与反馈

- Bug 反馈 / 需求建议：[提交 Issue](https://github.com/wrangler1024/crossborder-userscripts/issues)
- 欢迎团队成员提交 PR 补充新脚本

---

## 📄 License

[MIT](./LICENSE) —— 自由使用、修改、分发。

# 如何安装本团队的效率脚本

> 第一次使用的同学请按顺序完成下面两步。之后“已开放分发”的脚本都能一键安装，无需重复配置。

---

## 第一步：安装 Tampermonkey（一次性）

Tampermonkey 是一个浏览器扩展，用来运行本仓库的 `.user.js` 脚本。各浏览器入口：

| 浏览器 | 安装入口 |
|---|---|
| **Chrome（推荐）** | [Chrome 应用商店 - Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| **Edge** | [Edge 扩展商店 - Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/iikmkjmpaadaobahmlepeloendndfphd) |
| **Firefox** | [Firefox 附加组件 - Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) |
| **Safari** | App Store 搜索 "Tampermonkey"（付费，¥18） |

安装后浏览器右上角会出现 Tampermonkey 的**黑色方块图标**，表示就绪。

---

## 第二步：安装脚本（每个脚本一次）

1. 打开 [仓库主页](../README.md)，只在「已开放分发」表格中选择需要的脚本；“待验收”或“暂停分发”脚本不得自行安装。
2. 点击该行的 **「一键安装」** 链接。
3. 浏览器会自动跳转并弹出 Tampermonkey 安装确认页：
   - 核对脚本名称、版本、权限
   - 点击绿色的 **「安装」** 按钮
4. 完成。打开对应的目标网站即可生效。

> 💡 安装页会显示脚本完整源码，可以先扫一眼确认没有可疑代码再装。

---

## 关于自动更新

本仓库的脚本都配置了 `@updateURL`。Tampermonkey 默认每天检查一次更新（可在 Tampermonkey 设置 → 更新 中调整），**仓库推送新版本后你会自动收到更新**，无需手动重装。

如果想立刻拉取最新版：

1. 点浏览器右上角 Tampermonkey 图标 → **「管理面板」**
2. 切到 **「已安装脚本」** 标签
3. 找到脚本，点右侧的时钟图标 → **「检查更新」**

---

## 常见问题

**Q：点击安装链接没反应，只看到一堆代码？**
A：确认 Tampermonkey 已启用。点击浏览器右上角黑色方块图标，看到「管理面板」能打开即正常。然后回到安装链接强制刷新一次。

**Q：装了脚本但没生效？**
A：① 确认你访问的是脚本 `@match` 声明的域名；② 在 Tampermonkey 管理面板确认脚本是「启用」状态（开关为绿色）。

**Q：怎么卸载？**
A：Tampermonkey 管理面板 → 找到脚本 → 点右侧垃圾桶图标。

# 领星 ERP 禁用双指滑动后退

> 在领星 ERP 查看宽表格（如「产品表现」）时，水平拖动很容易误触发浏览器的「双指后退」。本脚本只在领星域名下生效，通过切断滚动链来消除这种误触，其他网站完全不受影响。

## 🎯 解决什么问题

领星 ERP 的数据表格字段较多，运营同学经常需要左右拖动查看。但 macOS 触控板/Trackpad 的双指水平滑动，在到达边界后会触发浏览器「后退/前进」导航手势，导致：

- 看一半数据突然跳走
- 表格状态丢失，要重新打开筛选
- 工作流被打断

## 📦 一键安装

已安装 Tampermonkey 的同学，点击下方链接会自动弹出安装框：

**👉 [安装此脚本](https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-disable-swipe-back/lingxing-disable-swipe-back.user.js)**

> 未安装 Tampermonkey？先看 [安装教程](../../docs/how-to-install.md)。

## 🔧 工作原理

脚本只做一件事：

脚本给 `html/body` 设置 `overscroll-behavior-x: none`，并给领星实际使用的 `vxe-table--body-wrapper.body--wrapper` 横向滚动容器设置 `contain`。这样表格仍接收原生双指横向滚动，滚动到边界时不再把过冲传给浏览器导航。

> ⚠️ 历史回归记录：
> - 1.0.0 曾附带「拦截水平 wheel 事件」的兜底逻辑，把触控板双指横滑的默认滚动行为一起禁掉，导致表格横向拖动失灵，1.1.0 移除；
> - 1.1.0 曾用 `*` 通配符把 `overscroll-behavior-x: contain` 应用到所有元素，1.1.1 收窄为根元素，1.1.2 再针对实际的表格滚动容器设置 `contain`。

**如果开启脚本后表格无法左右滚动：**请确认 Tampermonkey 中运行的是 1.1.2 或更新版本，并刷新领星页面。如果自动更新尚未完成，可重新点击上方安装链接，用新版本替换旧版。旧版会在捕获阶段取消水平 `wheel` 事件。

### ⚠️ 已知限制（设计如此，非 bug）

脚本主要针对表格滚动容器。在页面空白处水平滑动仍可能触发后退，原因：

- Chrome 的双指后退是浏览器**底层手势**，发生在网页 JS 事件循环之外，JS 无法拦截。
- `overscroll-behavior-x` 只在「先有水平滚动、再到达边界」时才有机会介入。页面空白区没有水平滚动需求，一滑动就直达手势识别层，CSS 没机会生效。

这是浏览器安全/UX 设计的必然结果——网页不允许完全剥夺用户导航手势。对我们的使用场景（重点是表格区）来说，当前效果是最理想的：**表格内不误触，表格外保留原生手势**。

## 🛠️ 适用范围

| 项 | 值 |
|---|---|
| 生效域名 | `erp.lingxing.com`、`*.lingxing.com` |
| 浏览器 | Chrome / Edge（推荐）、Firefox |
| 不支持 | Safari（系统手势太底层，需在系统设置关闭全局） |

## 🔄 自动更新

脚本配置了 `@updateURL` / `@downloadURL`，仓库推新版本后，Tampermonkey 会在**检查更新周期**自动拉取，无需重新手动安装。

## 🐛 反馈

如遇问题或想提需求，请到 [主仓库 Issues](https://github.com/wrangler1024/crossborder-userscripts/issues) 反馈。

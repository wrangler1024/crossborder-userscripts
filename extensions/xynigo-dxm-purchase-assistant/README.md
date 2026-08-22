# Xynigo 店小秘运营采购助手

Manifest V3 浏览器扩展，用于在店小秘待审核订单详情中建立“运营提交采购明细、采购部门后续执行采购”的协同入口。

```text
打开订单详情
→ 逐商品录入 SHEIN 精确采购链接
→ 校验规格、指导价与采购数量
→ 保存本地预览采购单
→ 自动填入一行一个采购链接的订单备注
→ 解锁店小秘原生审核
```

当前公开预览版本为 `0.1.44`。前端交互原型已经成型，飞书采购表对接尚未接入。

## 安装

从 [GitHub Releases](https://github.com/wrangler1024/crossborder-userscripts/releases/tag/dxm-purchase-assistant-v0.1.44) 下载 `xynigo-dxm-purchase-assistant-v0.1.44.zip`，完整解压后通过浏览器开发者模式加载。

详细步骤见 [INSTALL.md](./INSTALL.md)。

## 当前能力

- 在订单详情左侧原生选项卡下追加“采购明细”。
- 识别订单商品、销售数量、销售额、SKU 与 SHEIN 原始 goods_id。
- 根据订单市场生成美国站或墨西哥站原商品快捷链接。
- 解析一行精准采购链接中的规格、指导价与币种。
- 支持一单多商品和手工新增采购明细。
- 计算预估采购总额、利润、利润率与 ROI。
- 墨西哥订单指导采购总额不足 MXN 100 时，按凑单后 MXN 100 估算成本。
- 提交后生成一行一个采购链接的店小秘备注，并按设置决定是否启用审核门禁。

## 安全边界

- 默认关闭审核门禁，不自动点击店小秘审核。
- 不连接飞书，不包含飞书 App Secret、访问令牌或其他服务端凭证。
- 采购记录只保存在浏览器扩展本地存储。
- 不保存客户姓名、邮箱、电话和完整地址。
- 仅在 `dianxiaomi.com` 及其子域名运行。
- 当前版本为前端流程预览，不代表采购部门已经完成真实下单。

## 开发与构建

```bash
cd extensions/xynigo-dxm-purchase-assistant
npm test
sh build.sh --dev
sh build.sh --release
```

构建结果统一输出到仓库根目录的 `dist/`。浏览器页面回归脚本位于 `tests/browser-smoke.js`，运行时需要本机提供 Playwright。

## 后续接口边界

飞书对接通过内部服务完成。浏览器扩展只提交采购业务数据，不保存飞书应用密钥；服务端负责鉴权、幂等写入、采购单状态查询与错误处理。

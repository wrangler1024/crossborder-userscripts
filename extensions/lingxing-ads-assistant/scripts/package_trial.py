# -*- coding: utf-8 -*-
"""Build a novice-friendly trial bundle from the verified extension release."""
from pathlib import Path
from html import escape
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
version = json.loads((root / "package.json").read_text())["version"]
release = dist / f"领星广告创建助手-v{version}-Chrome本地扩展.zip"
runtime = [
    "manifest.json", "content.js", "legacy-entry.js", "storage-bridge.js", "background.mjs",
    "storage-service.mjs", "popup.html", "popup.css", "popup.js", "launcher-bridge.js", "launcher-settings.mjs", "LICENSE-SheetJS.txt",
    "广告创建详细参数模板.xlsx",
]
with zipfile.ZipFile(release) as source:
    assert source.testzip() is None
    for line in source.read("SHA256SUMS.txt").decode().splitlines():
        expected, name = line.split("  ", 1)
        assert hashlib.sha256(source.read(name)).hexdigest() == expected, name
    assert json.loads(source.read("manifest.json"))["version"] == version
    files = {f"插件/{name}": source.read(name) for name in runtime}
    files["广告创建详细参数模板.xlsx"] = source.read("广告创建详细参数模板.xlsx")

manual = (root / "使用说明.md").read_text()
manual = manual.replace(release.name, f"领星广告创建助手-v{version}-运营试用包.zip")
manual = manual.replace("确认目录中直接包含`manifest.json`、`content.js`、`popup.html`等文件。", "进入解压目录中的“插件”文件夹，其中包含`manifest.json`、`content.js`、`popup.html`等文件。")
manual = manual.replace("选择刚才解压的目录，不能选择ZIP文件。", "选择解压目录中的“插件”文件夹，不能选择ZIP文件或上一层目录。")
files["安装与使用.md"] = manual.encode()
files["运营试用说明.md"] = (root / "运营试用说明.md").read_bytes()
files["试用反馈模板.txt"] = (f"领星广告创建助手 v{version} 试用反馈\n\n"
    "填写人：\n浏览器（Chrome / Ego）及操作系统：\n插件版本：\n店铺 / 站点：\n涉及MSKU：\n"
    "操作步骤：\n实际结果或提示原文：\n希望的结果：\n发生时间：\n是否每次都出现：\n\n"
    "请附问题截图；涉及创建结果时，附插件“导出创建记录”的文件。\n"
    "改进建议也可以直接填写，不一定要有报错。\n").encode("utf-8-sig")
files["版本说明.txt"] = (f"领星广告创建助手 v{version} 运营试用版\n构建日期：2026-11-11\n\n"
    "可用流程：Excel导入 → 商品与库存校验 → 建议竞价与可编辑预览 → 确认批量创建 → 回读结果。\n"
    "支持：自动广告、广泛关键词、扩展ASIN；本地保存与恢复；建议价有限重试。\n"
    "创建默认暂停，可明确选择启用。当前不自动绑定兜底规则，不自动修改已有广告。\n\n"
    "验证范围见开发交接与对应Release；原生加拿大首批3款9活动此前已核实全部暂停。\n"
    "英国运营子账号已验证3款9活动预览及创建前检查（未提交）；澳大利亚、阿联酋的账号联调仍待首批验证。\n"
    "0.8.1修复了广告类型数字/文本格式导致的创建结果误报。\n"
    "0.8.2改从SP广告列表进入，提示Listing数据范围，并在提交前检查超级结构查看、编辑权限。\n\n"
    "0.9.1修复油猴安装页卡顿；小体积入口加载固定版本且校验完整性的程序。预览和创建记录继续保留。\n\n"
    "0.9.2支持旧版广告页入口，点击后跳转新版SP广告并自动打开助手；不会自动校验或创建。\n\n"
    "0.9.3支持零库存预览及暂停创建，库存不足10件不可直接启用，到货后手动开启。\n\n"
    "0.9.4优化低库存卡片标识和分秒计时显示。\n\n"
    "先从每人3款开始试用，记录实际使用反馈，后续继续更新。\n"
    "更新时覆盖原安装目录后重新加载扩展，保留本机预览和创建记录。\n").encode("utf-8-sig")

guide = """<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>领星广告创建助手 运营试用</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#20354b;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:920px;margin:32px auto;padding:0 22px 32px}header{padding:28px 30px;background:#153650;color:white;border-radius:14px}h1{font-size:28px;margin:4px 0 10px}header p{margin:0;color:#d0e0ec}.badge{font-size:13px;color:#b4d9fb}section{margin-top:18px;padding:22px 28px;border:1px solid #dce5ed;border-radius:12px;background:white}h2{font-size:20px;margin:0 0 10px}p{margin:8px 0}li{margin:7px 0}code{padding:2px 6px;background:#edf3fa;color:#164c7e;border-radius:4px;overflow-wrap:anywhere}a{color:#125cc3}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:9px;text-align:left;border-bottom:1px solid #e4eaf0}th{background:#f1f5fa}.callout{padding:12px 16px;border-left:4px solid #2b78d1;background:#edf5ff;border-radius:4px}.links{display:flex;flex-wrap:wrap;gap:10px;margin-top:15px}.links a{display:inline-block;padding:7px 13px;background:#edf5ff;border:1px solid #c9ddf3;border-radius:7px;text-decoration:none}footer{margin-top:22px;color:#6d8194;font-size:13px}@media(max-width:600px){main{margin:14px auto;padding:0 12px}header,section{padding:18px}h1{font-size:23px}}
</style>
<main><header><div class="badge">运营试用版 · v{VERSION} · 2026-11-11</div><h1>领星广告创建助手</h1><p>填表、校验、调整预览，再批量创建广告。第一批先选 3 款商品。</p></header>
<section><h2>运营油猴版</h2><p>先安装 Tampermonkey，再<a href="https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant.user.js">一键安装广告助手</a>。后续由脚本管理器检查在线更新；也可使用下面的原生包。</p><p>两种版本选一种启用。切换前在0.9.0原渠道导出本地备份，停用旧渠道并刷新，再导入新渠道。油猴数据在领星站点本地存储，清理站点数据前请备份。</p></section><section><h2>1. 安装原生扩展</h2><ol><li>把 ZIP 完整解压到固定文件夹，安装后保留该文件夹。</li><li>用 Chrome 或 Ego 打开 <code>chrome://extensions/</code>，开启“开发者模式”。</li><li>点击“加载未打包的扩展程序”，选择本包中的 <strong>插件</strong> 文件夹；其中应能看到 <code>manifest.json</code>。</li><li>正常登录领星并进入SP广告列表，刷新页面，点击右侧贴边“广告”，或从浏览器扩展菜单选择“打开当前页助手”。</li></ol><p>本人账号需能在原生创建SP活动页面搜到商品；批量创建还需“广告 → 超级结构 → 查看、编辑”权限。由管理员核对Listing负责人及广告数据范围。</p><p>已有旧版：把新版“插件”里的文件覆盖到原安装目录，点击扩展的重新加载，再刷新领星页面。</p></section>
<section><h2>2. 填写前五列</h2><table><thead><tr><th>字段</th><th>填写要求</th></tr></thead><tbody><tr><td>店铺</td><td>复制领星广告系统中的完整店铺名称。</td></tr><tr><td>MSKU / ASIN</td><td>填写同一个主推子体。一个父产品只选一个子体。</td></tr><tr><td>KEYWORDS</td><td>选填 1–5 个广泛关键词，单元格内每行一个。</td></tr><tr><td>TARGET_ASIN</td><td>选填 3–5 个相关畅销商品 ASIN，单元格内每行一个。</td></tr></tbody></table><p>其余默认参数保持原样。后两列留空则跳过对应手动活动；只填前 3 列可创建自动广告。FBA可售库存0–9件只可暂停创建；直接启用需至少10件，到货后手动开启。</p><div class="links"><a href="广告创建详细参数模板.xlsx">打开空白导入模板</a><a href="https://github.com/wrangler1024/crossborder-userscripts/blob/main/extensions/lingxing-ads-assistant/README.md" target="_blank" rel="noopener">查看使用说明</a></div></section>
<section><h2>3. 预览后确认创建</h2><ol><li>选择 Excel，点击“校验并生成预览”。核对商品、库存、建议价和投放目标。</li><li>可剔除或添加关键词、勾选自动投放类型。点击“刷新”会查询当前商品的整组建议价。</li><li>点击“创建广告”，等待检查，勾选本次活动，核对日期和预算。</li><li><strong>首次建议保留默认“暂停”</strong>，确认后等待创建结果。需要直接投放时可选择“启用”。</li></ol><div class="callout">单活动日预算：加拿大 CAD 4、澳大利亚 AUD 4、阿联酋 AED 10、英国 GBP 2。三活动全选时，预算按三个活动累计。</div></section>
<section><h2>4. 看结果，再继续下一批</h2><p><strong>已完成：</strong>创建与配置核对通过。暂停活动需在领星启用后才会投放。</p><p><strong>后台创建中：</strong>稍后点击“检查创建结果”。</p><p><strong>待核对 / 结果待核实 / 失败：</strong>先查领星“结构 → 超级结构”里的日志和已有记录，避免重复创建同批商品。</p><p>预览与创建记录保存在本机，刷新后可恢复。“停止后续提交”只停止尚未发送的活动。</p></section>
<section><h2>5. 反馈试用体验</h2><p>记录版本、店铺、MSKU、操作步骤和提示原文，附截图。涉及创建结果时，同时附插件导出的创建记录。</p><div class="links"><a href="试用反馈模板.txt">打开反馈模板</a><a href="运营试用说明.md">运营试用说明</a><a href="安装与使用.md">完整使用说明</a><a href="版本说明.txt">版本与验证范围</a></div></section>
<footer>Windows / macOS 桌面版 Chrome、Ego 可加载此原生扩展，无需篡改猴或 API 密钥。更多使用反馈将纳入后续版本。</footer></main></html>
""".replace("{VERSION}", escape(version))
files["先看这里.html"] = guide.encode()
files["SHA256SUMS.txt"] = "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in files.items()).encode()

folder = "领星广告创建助手"
package = dist / f"领星广告创建助手-v{version}-运营试用包.zip"
with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    for name, data in files.items():
        info = zipfile.ZipInfo(f"{folder}/{name}", (2026, 11, 11, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        bundle.writestr(info, data)
with zipfile.ZipFile(package) as bundle:
    assert bundle.testzip() is None
    assert set(bundle.namelist()) == {f"{folder}/{name}" for name in files}
    for name, data in files.items():
        assert bundle.read(f"{folder}/{name}") == data
package_hash = hashlib.sha256(package.read_bytes()).hexdigest()
(dist / f"{package.name}.sha256").write_text(f"{package_hash}  {package.name}\n")
print(f"Trial package {package.name}: {package.stat().st_size} bytes, {len(files)} files")

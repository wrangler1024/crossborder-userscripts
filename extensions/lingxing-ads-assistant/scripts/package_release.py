"""Package only operator artifacts, never live account evidence or test fixtures."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
version = json.loads((root / "package.json").read_text())["version"]
files = {
    "manifest.json": dist / "extension" / "manifest.json",
    "content.js": dist / "extension" / "content.js",
    "legacy-entry.js": dist / "extension" / "legacy-entry.js",
    "storage-bridge.js": dist / "extension" / "storage-bridge.js",
    "background.mjs": dist / "extension" / "background.mjs",
    "storage-service.mjs": dist / "extension" / "storage-service.mjs",
    "popup.html": dist / "extension" / "popup.html",
    "popup.css": dist / "extension" / "popup.css",
    "popup.js": dist / "extension" / "popup.js",
    "launcher-bridge.js": dist / "extension" / "launcher-bridge.js",
    "launcher-settings.mjs": dist / "extension" / "launcher-settings.mjs",
    "广告创建详细参数模板.xlsx": dist / "广告创建详细参数模板.xlsx",
    "安装与使用.md": root / "使用说明.md",
    "LICENSE-SheetJS.txt": root / "vendor" / "LICENSE-SheetJS.txt",
}
payloads = {name: path.read_bytes() for name, path in files.items()}
checksums = "".join(
    f"{hashlib.sha256(data).hexdigest()}  {name}\n"
    for name, data in payloads.items()
)
payloads["SHA256SUMS.txt"] = checksums.encode()
for name in ["安装与使用.md", "LICENSE-SheetJS.txt", "SHA256SUMS.txt"]:
    (dist / name).write_bytes(payloads[name])
for name in ["安装与使用.md", "广告创建详细参数模板.xlsx", "SHA256SUMS.txt"]:
    (dist / "extension" / name).write_bytes(payloads[name])
package = dist / f"领星广告创建助手-v{version}-Chrome本地扩展.zip"
with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    for name, data in payloads.items():
        info = zipfile.ZipInfo(name, (2026, 11, 11, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        bundle.writestr(info, data)
with zipfile.ZipFile(package) as bundle:
    assert set(bundle.namelist()) == set(payloads)
    assert bundle.testzip() is None
    for name, data in payloads.items():
        assert bundle.read(name) == data
package_hash = hashlib.sha256(package.read_bytes()).hexdigest()
(dist / f"{package.name}.sha256").write_text(f"{package_hash}  {package.name}\n")
print(f"Packaged {package.name}: {package.stat().st_size} bytes, {len(payloads)} files")

"""Create a reproducible extension archive containing only operator files."""

from pathlib import Path
import sys
import zipfile


source, destination = map(Path, sys.argv[1:])
expected = {
    "manifest.json", "content.js", "bridge.js", "popup.html", "popup.css",
    "popup.js", "LICENSE-SheetJS.txt", "README.md",
}
files = {path.relative_to(source).as_posix(): path for path in source.rglob("*") if path.is_file()}
if set(files) != expected:
    raise SystemExit("Unexpected extension archive contents")
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name, path in sorted(files.items()):
        entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        entry.create_system = 3
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, path.read_bytes())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == expected
    assert all(archive.read(name) == path.read_bytes() for name, path in files.items())

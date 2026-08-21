#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
MANIFEST_PATH="$SCRIPT_DIR/manifest.json"
INSTALL_PATH="$SCRIPT_DIR/INSTALL.md"
USERSCRIPT_PATH="$REPO_ROOT/scripts/shein-globalship-selector/shein_globalship_selector.user.js"
MASCOT_PATH="$REPO_ROOT/assets/xynigo-mascot.png"
BACKGROUND_PATH="$SCRIPT_DIR/background.js"
EXCELJS_LICENSE_PATH="$SCRIPT_DIR/EXCELJS-LICENSE.txt"
EXCELJS_PATH="$REPO_ROOT/node_modules/exceljs/dist/exceljs.min.js"
OUTPUT_DIR="$REPO_ROOT/dist"

MANIFEST_VERSION=$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" "$MANIFEST_PATH")
USERSCRIPT_VERSION=$(sed -n 's/^\/\/ @version[[:space:]]*//p' "$USERSCRIPT_PATH" | head -n 1)

if [ -z "$MANIFEST_VERSION" ] || [ "$MANIFEST_VERSION" != "$USERSCRIPT_VERSION" ]; then
    echo "版本不一致：manifest=$MANIFEST_VERSION userscript=$USERSCRIPT_VERSION" >&2
    exit 1
fi

if [ ! -f "$EXCELJS_PATH" ]; then
    echo "缺少 ExcelJS，请先在仓库根目录执行 npm install" >&2
    exit 1
fi

TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xynigo-shein-globalship-selector.XXXXXX")
PACKAGE_NAME="xynigo-shein-globalship-selector-v$MANIFEST_VERSION"
PACKAGE_DIR="$TEMP_ROOT/$PACKAGE_NAME"
OUTPUT_PATH="$OUTPUT_DIR/$PACKAGE_NAME.zip"

cleanup() {
    rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$PACKAGE_DIR" "$OUTPUT_DIR"
cp "$MANIFEST_PATH" "$PACKAGE_DIR/manifest.json"
cp "$USERSCRIPT_PATH" "$PACKAGE_DIR/content.js"
cp "$BACKGROUND_PATH" "$PACKAGE_DIR/background.js"
cp "$EXCELJS_PATH" "$PACKAGE_DIR/exceljs.min.js"
cp "$EXCELJS_LICENSE_PATH" "$PACKAGE_DIR/EXCELJS-LICENSE.txt"
cp "$MASCOT_PATH" "$PACKAGE_DIR/xynigo-mascot.png"
cp "$INSTALL_PATH" "$PACKAGE_DIR/INSTALL.md"

rm -f -- "$OUTPUT_PATH"
(
    cd "$TEMP_ROOT"
    zip -q -r "$OUTPUT_PATH" "$PACKAGE_NAME"
)

printf '%s\n' "$OUTPUT_PATH"

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
DEV_DIR="$OUTPUT_DIR/xynigo-shein-globalship-selector-dev"

MODE=${1:---release}

case "$MODE" in
    --dev|--release|--all)
        ;;
    *)
        echo "用法：sh $0 [--dev|--release|--all]" >&2
        exit 2
        ;;
esac

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

PACKAGE_NAME="xynigo-shein-globalship-selector-v$MANIFEST_VERSION"
OUTPUT_PATH="$OUTPUT_DIR/$PACKAGE_NAME.zip"

copy_extension_files() {
    TARGET_DIR=$1
    mkdir -p "$TARGET_DIR"
    cp "$MANIFEST_PATH" "$TARGET_DIR/manifest.json"
    cp "$USERSCRIPT_PATH" "$TARGET_DIR/content.js"
    cp "$BACKGROUND_PATH" "$TARGET_DIR/background.js"
    cp "$EXCELJS_PATH" "$TARGET_DIR/exceljs.min.js"
    cp "$EXCELJS_LICENSE_PATH" "$TARGET_DIR/EXCELJS-LICENSE.txt"
    cp "$MASCOT_PATH" "$TARGET_DIR/xynigo-mascot.png"
    cp "$INSTALL_PATH" "$TARGET_DIR/INSTALL.md"
}

mkdir -p "$OUTPUT_DIR"

if [ "$MODE" = "--dev" ] || [ "$MODE" = "--all" ]; then
    copy_extension_files "$DEV_DIR"
    printf '%s\n' "$DEV_DIR"
fi

if [ "$MODE" = "--release" ] || [ "$MODE" = "--all" ]; then
    TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xynigo-shein-globalship-selector.XXXXXX")
    PACKAGE_DIR="$TEMP_ROOT/$PACKAGE_NAME"

    cleanup() {
        rm -rf -- "$TEMP_ROOT"
    }
    trap cleanup EXIT HUP INT TERM

    copy_extension_files "$PACKAGE_DIR"

    rm -f -- "$OUTPUT_PATH"
    (
        cd "$TEMP_ROOT"
        zip -q -r "$OUTPUT_PATH" "$PACKAGE_NAME"
    )

    printf '%s\n' "$OUTPUT_PATH"
fi

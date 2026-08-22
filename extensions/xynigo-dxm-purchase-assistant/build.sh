#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
OUTPUT_DIR="$REPO_ROOT/dist"
DEV_DIR="$OUTPUT_DIR/xynigo-dxm-purchase-assistant-dev"
MODE=${1:---release}

case "$MODE" in
    --dev|--release|--all)
        ;;
    *)
        echo "用法：sh $0 [--dev|--release|--all]" >&2
        exit 2
        ;;
esac

VERSION=$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(m.version)" "$SCRIPT_DIR/manifest.json")
PACKAGE_NAME="xynigo-dxm-purchase-assistant-v$VERSION"
OUTPUT_PATH="$OUTPUT_DIR/$PACKAGE_NAME.zip"

node --check "$SCRIPT_DIR/src/core.js"
node --check "$SCRIPT_DIR/src/content.js"
node --check "$SCRIPT_DIR/popup/popup.js"
node --test "$SCRIPT_DIR/tests"/*.test.js

copy_extension_files() {
    TARGET_DIR=$1
    mkdir -p "$TARGET_DIR/src" "$TARGET_DIR/popup"
    cp "$SCRIPT_DIR/manifest.json" "$TARGET_DIR/manifest.json"
    cp "$SCRIPT_DIR/README.md" "$TARGET_DIR/README.md"
    cp "$SCRIPT_DIR/INSTALL.md" "$TARGET_DIR/INSTALL.md"
    cp "$SCRIPT_DIR/src/core.js" "$TARGET_DIR/src/core.js"
    cp "$SCRIPT_DIR/src/content.js" "$TARGET_DIR/src/content.js"
    cp "$SCRIPT_DIR/src/content.css" "$TARGET_DIR/src/content.css"
    cp "$SCRIPT_DIR/popup/popup.html" "$TARGET_DIR/popup/popup.html"
    cp "$SCRIPT_DIR/popup/popup.css" "$TARGET_DIR/popup/popup.css"
    cp "$SCRIPT_DIR/popup/popup.js" "$TARGET_DIR/popup/popup.js"
}

mkdir -p "$OUTPUT_DIR"

if [ "$MODE" = "--dev" ] || [ "$MODE" = "--all" ]; then
    rm -rf -- "$DEV_DIR"
    copy_extension_files "$DEV_DIR"
    printf '%s\n' "$DEV_DIR"
fi

if [ "$MODE" = "--release" ] || [ "$MODE" = "--all" ]; then
    TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xynigo-dxm-extension.XXXXXX")
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

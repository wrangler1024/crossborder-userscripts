#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
OUTPUT_DIR="$REPO_ROOT/dist"
DEV_DIR="$OUTPUT_DIR/xynigo-shein-captcha-solver-dev"
USERSCRIPT_DIR="$REPO_ROOT/scripts/shein-captcha-solver"
MODE=${1:---release}

case "$MODE" in
    --dev|--release|--all)
        ;;
    *)
        echo "用法：sh $0 [--dev|--release|--all]" >&2
        exit 2
        ;;
esac

# 版本单一事实源 = manifest.json（userscript 由共享源码生成，版本随动）。
VERSION=$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(m.version)" "$SCRIPT_DIR/manifest.json")
PACKAGE_NAME="xynigo-shein-captcha-solver-v$VERSION"
OUTPUT_PATH="$OUTPUT_DIR/$PACKAGE_NAME.zip"

node --check "$SCRIPT_DIR/src/config.js"
node --check "$SCRIPT_DIR/src/puzzle.js"
node --check "$SCRIPT_DIR/src/vision-client.js"
node --check "$SCRIPT_DIR/src/stats.js"
node --check "$SCRIPT_DIR/src/captcha-agent.js"
node --check "$SCRIPT_DIR/src/content.js"
node --check "$SCRIPT_DIR/src/background.js"
node --check "$SCRIPT_DIR/popup/popup.js"
node --check "$USERSCRIPT_DIR/userscript-runtime.js"
node "$USERSCRIPT_DIR/build-userscript.js"
node --check "$USERSCRIPT_DIR/xynigo_shein_captcha_solver.user.js"
node --test "$SCRIPT_DIR/tests"/*.test.js "$USERSCRIPT_DIR/tests"/*.test.js

copy_extension_files() {
    TARGET_DIR=$1
    mkdir -p "$TARGET_DIR/src" "$TARGET_DIR/popup" "$TARGET_DIR/icons"
    cp "$SCRIPT_DIR/manifest.json" "$TARGET_DIR/manifest.json"
    cp "$SCRIPT_DIR/INSTALL.md" "$TARGET_DIR/INSTALL.md"
    for file in config.js puzzle.js vision-client.js stats.js captcha-agent.js content.js background.js; do
        cp "$SCRIPT_DIR/src/$file" "$TARGET_DIR/src/$file"
    done
    cp "$SCRIPT_DIR/popup/popup.html" "$TARGET_DIR/popup/popup.html"
    cp "$SCRIPT_DIR/popup/popup.css" "$TARGET_DIR/popup/popup.css"
    cp "$SCRIPT_DIR/popup/popup.js" "$TARGET_DIR/popup/popup.js"
    for size in 16 32 48 128; do
        cp "$SCRIPT_DIR/icons/icon$size.png" "$TARGET_DIR/icons/icon$size.png"
    done
}

mkdir -p "$OUTPUT_DIR"

if [ "$MODE" = "--dev" ] || [ "$MODE" = "--all" ]; then
    case "$DEV_DIR" in
        "$OUTPUT_DIR"/xynigo-shein-captcha-solver-dev) ;;
        *)
            echo "拒绝清理意外的构建路径：$DEV_DIR" >&2
            exit 1
            ;;
    esac
    rm -rf -- "$DEV_DIR"
    copy_extension_files "$DEV_DIR"
    printf '%s\n' "$DEV_DIR"
fi

if [ "$MODE" = "--release" ] || [ "$MODE" = "--all" ]; then
    TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xynigo-captcha-extension.XXXXXX")
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

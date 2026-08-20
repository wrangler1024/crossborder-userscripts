#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
MANIFEST_PATH="$SCRIPT_DIR/manifest.json"
INSTALL_PATH="$SCRIPT_DIR/INSTALL.md"
USERSCRIPT_PATH="$REPO_ROOT/scripts/shein-product-variant-helper/shein_product_variant_helper.user.js"
OUTPUT_DIR="$REPO_ROOT/dist"

MANIFEST_VERSION=$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" "$MANIFEST_PATH")
USERSCRIPT_VERSION=$(sed -n 's/^\/\/ @version[[:space:]]*//p' "$USERSCRIPT_PATH" | head -n 1)

if [ -z "$MANIFEST_VERSION" ] || [ "$MANIFEST_VERSION" != "$USERSCRIPT_VERSION" ]; then
    echo "版本不一致：manifest=$MANIFEST_VERSION userscript=$USERSCRIPT_VERSION" >&2
    exit 1
fi

TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xynigo-shein-extension.XXXXXX")
PACKAGE_NAME="xynigo-shein-variant-helper-v$MANIFEST_VERSION"
PACKAGE_DIR="$TEMP_ROOT/$PACKAGE_NAME"
OUTPUT_PATH="$OUTPUT_DIR/$PACKAGE_NAME.zip"

cleanup() {
    rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$PACKAGE_DIR" "$OUTPUT_DIR"
cp "$MANIFEST_PATH" "$PACKAGE_DIR/manifest.json"
cp "$USERSCRIPT_PATH" "$PACKAGE_DIR/content.js"
cp "$INSTALL_PATH" "$PACKAGE_DIR/INSTALL.md"

rm -f -- "$OUTPUT_PATH"
(
    cd "$TEMP_ROOT"
    zip -q -r "$OUTPUT_PATH" "$PACKAGE_NAME"
)

printf '%s\n' "$OUTPUT_PATH"

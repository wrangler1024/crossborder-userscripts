'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const mode = process.argv[2] || '--release';
if (!['--dev', '--release'].includes(mode)) throw new Error('用法：node build.js [--dev|--release]');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const name = mode === '--dev' ? 'xynigo-shein-price-compare-dev' : `xynigo-shein-price-compare-v${manifest.version}`;
const output = path.join(root, 'dist', name);
fs.mkdirSync(output, { recursive: true });
for (const file of ['manifest.json', 'core.js', 'availability.js', 'watcher.js', 'content.js', 'background.js', '使用说明.md']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
}
const helper = fs.readFileSync(path.join(root, 'scripts/shein-product-variant-helper/shein_product_variant_helper.user.js'), 'utf8');
fs.writeFileSync(path.join(output, 'variant-library.js'),
    'globalThis.XynigoSheinVariantLibraryOnly = true;\n' + helper + '\ndelete globalThis.XynigoSheinVariantLibraryOnly;\n');
fs.mkdirSync(path.join(output, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
    fs.copyFileSync(path.join(__dirname, 'icons', `icon${size}.png`), path.join(output, 'icons', `icon${size}.png`));
}
// 页面入口内嵌同一张图标；不增加站点资源权限或图片网络请求。
const iconData = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'icons/icon48.png')).toString('base64');
const content = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
fs.writeFileSync(path.join(output, 'content.js'), 'globalThis.XynigoPriceCompareIconData = ' + JSON.stringify(iconData) + ';\n' + content);
if (mode === '--dev') {
    console.log(output);
    process.exit(0);
}
const zip = `${output}.zip`;
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-q', '-r', zip, name], { cwd: path.dirname(output) });
// HubStudio 团队扩展上传要求 manifest 在 ZIP 根目录，仅打包运行文件。
const hubZip = `${output}-hubstudio.zip`;
fs.rmSync(hubZip, { force: true });
execFileSync('zip', ['-q', '-r', hubZip, 'manifest.json', 'background.js', 'variant-library.js', 'core.js',
    'availability.js', 'watcher.js', 'content.js', 'icons'], { cwd: output });
console.log(output);
console.log(zip);
console.log(hubZip);

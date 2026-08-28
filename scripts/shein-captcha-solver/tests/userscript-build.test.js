'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// 构建产物门禁：版本同步、双形态完整性、公开仓库安全（无密钥/无 SadCaptcha 残留）。
const scriptDir = __dirname;
const generatedPath = path.join(scriptDir, '..', 'xynigo_shein_captcha_solver.user.js');
const manifest = JSON.parse(fs.readFileSync(path.join(scriptDir, '..', '..', '..', 'extensions', 'xynigo-shein-captcha-solver', 'manifest.json'), 'utf8'));

require('../build-userscript.js'); // 幂等：测试直接驱动构建，保证产物存在且最新。

const source = fs.readFileSync(generatedPath, 'utf8');

test('generated userscript version matches the extension manifest', () => {
    assert.match(source, new RegExp(`^// @version\\s+${manifest.version}$`, 'm'));
});

test('generated userscript wires the runtime shim before the content boot', () => {
    const installIndex = source.indexOf('XynigoCaptchaUserscriptRuntime.install()');
    const contentIndex = source.indexOf('bootCaptchaContent');
    assert.ok(installIndex > 0, 'runtime install 缺失');
    assert.ok(contentIndex > installIndex, 'content 必须在 chrome 桥接安装之后执行');
    assert.match(source, /@connect\s+open\.bigmodel\.cn/);
    assert.match(source, /@connect\s+ark\.cn-beijing\.volces\.com/);
    assert.match(source, /@connect\s+generativelanguage\.googleapis\.com/);
    assert.match(source, /@connect\s+\*\.ltwebstatic\.com/);
});

test('source keeps secrets out and SadCaptcha fully removed (public repo gate)', () => {
    for (const text of [source]) {
        assert.doesNotMatch(text, /sk-[A-Za-z0-9]{16,}/);
        assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        assert.doesNotMatch(text, /sadcaptcha/i);
        assert.match(text, /Bearer '/); // Key 只通过 Authorization 头注入。
    }
});

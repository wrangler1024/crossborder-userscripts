'use strict';

// 打包门禁：manifest 注册路径、SW 依赖与弹窗脚本引用必须真实存在。
// 2026-08-28 事故：background.js 里 importScripts('src/...') 相对自身目录解析成
// src/src/*，SW 启动即崩，弹窗保存与页面 agent 全部失联——用本测试防回归。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(extensionDir, relativePath), 'utf8');

test('manifest registered files all exist', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const registered = [
        manifest.background && manifest.background.service_worker,
        manifest.action && manifest.action.default_popup,
        ...Object.values(manifest.icons || {}),
        ...Object.values((manifest.action && manifest.action.default_icon) || {}),
        ...manifest.content_scripts.flatMap((entry) => entry.js),
    ].filter(Boolean);
    for (const file of registered) {
        assert.ok(fs.existsSync(path.join(extensionDir, file)), `manifest 引用的文件不存在：${file}`);
    }
});

test('service worker importScripts resolve inside the worker directory', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const workerPath = manifest.background.service_worker;
    const workerDir = path.dirname(workerPath);
    const source = read(workerPath);
    const matches = [...source.matchAll(/importScripts\(([^)]*)\)/g)];
    for (const match of matches) {
        for (const literal of match[1].match(/['"]([^'"]+)['"]/g) || []) {
            const target = literal.slice(1, -1);
            if (/^https?:/.test(target)) continue;
            assert.ok(
                fs.existsSync(path.join(extensionDir, workerDir, target)),
                `importScripts 目标不存在：${workerPath} → ${target}（相对 ${workerDir}/ 解析）`
            );
        }
    }
    assert.match(source, /message\.prompt\s*\|\|\s*Puzzle\.PROMPT/, '真实解题必须允许页面规则 prompt 覆盖默认同类提示词');
});

test('popup script and style references resolve', () => {
    const html = read('popup/popup.html');
    const popupSource = read('popup/popup.js');
    const contentSource = read('src/content.js');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    for (const ref of refs) {
        if (/^https?:/.test(ref)) continue;
        assert.ok(fs.existsSync(path.join(extensionDir, 'popup', ref)), `popup 引用不存在：${ref}`);
    }
    assert.match(contentSource, /xynigo-captcha-status-host/, '内容脚本必须提供页内状态卡');
    assert.match(contentSource, /aria-live/, '页内状态必须可被辅助技术感知');
    assert.match(html, /\.\.\/icons\/icon48\.png/, 'popup 品牌头必须使用验证码助手图标');
    assert.match(html, /id="configState"/, 'popup 必须显示当前运行配置状态');
    assert.match(popupSource, /function prefixedId\(/, '主表单与影子表单必须统一解析字段 ID');
    assert.doesNotMatch(popupSource, /\$\(prefix \+ ['"]Provider['"]\)/, '禁止空前缀解析成不存在的 Provider ID');
    assert.match(popupSource, /tr\.appendChild\(td\)/, '统计单元格必须追加到行');
    assert.match(popupSource, /tbody\.appendChild\(tr\)/, '统计行必须追加到 tbody');
    assert.doesNotMatch(popupSource, /tbody\.appendChild\(td\)/, '禁止把 td 直接追加到 tbody');
    assert.match(popupSource, /chrome\.storage\.onChanged\.addListener/, 'Comet 长驻 popup 必须监听配置/日志变化');
    assert.match(popupSource, /window\.addEventListener\(['"]focus['"]/, 'popup 重新获焦时必须刷新');
});

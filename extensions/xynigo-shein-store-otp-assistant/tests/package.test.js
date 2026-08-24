'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildScript = fs.readFileSync(path.join(root, 'build.sh'), 'utf8');
const installGuide = fs.readFileSync(path.join(root, 'INSTALL.md'), 'utf8');

test('is a Manifest V3 extension restricted to SHEIN Seller Hub', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.name, /SHEIN 店铺接码助手/);
  assert.equal(manifest.version, '0.1.1');
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://sellerhub.shein.com/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/page-state.js', 'src/content.js']);
  assert.deepEqual(manifest.host_permissions, ['https://api.68sms.com/*']);
  assert.deepEqual(manifest.permissions, ['storage']);
});

test('detects the inspected SHEIN OTP input and manual get-code click', () => {
  assert.match(content, /input#verifyCode/);
  assert.match(content, /获取验证码/);
  assert.match(content, /setNativeInputValue/);
  assert.match(content, /请手动点击“确认”/);
});

test('automatically starts polling when SHEIN has already dispatched the first OTP', () => {
  assert.match(content, /getDispatchEvidence/);
  assert.match(content, /dispatchEvidence\.autoSent/);
  assert.match(content, /trigger:\s*'automatic'/);
  assert.match(content, /检测到 SHEIN 已自动发送验证码/);
});

test('does not auto-submit or contain embedded receiver credentials', () => {
  assert.doesNotMatch(content, /requestSubmit\s*\(/);
  assert.doesNotMatch(content, /\.submit\s*\(/);
  assert.doesNotMatch(content, /确认[^\n]{0,120}\.click\s*\(/);
  assert.doesNotMatch(`${background}\n${content}`, /key=[a-f0-9]{20,}/i);
});

test('receiver requests omit credentials and disable cache', () => {
  assert.match(background, /credentials:\s*'omit'/);
  assert.match(background, /cache:\s*'no-store'/);
});

test('keeps repository metadata and build output aligned with the extension version', () => {
  const installVersion = installGuide.match(/版本：`([^`]+)`/)?.[1];
  assert.equal(packageJson.name, 'xynigo-shein-store-otp-assistant');
  assert.equal(packageJson.version, manifest.version);
  assert.equal(installVersion, manifest.version);
  assert.match(buildScript, /--dev\|--release\|--all/);
  assert.match(buildScript, /xynigo-shein-store-otp-assistant-dev/);
  assert.match(buildScript, /xynigo-shein-store-otp-assistant-v\$VERSION/);
});

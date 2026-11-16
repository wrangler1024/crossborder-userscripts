import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const extensionDir = path.join(repoRoot, 'extensions/lingxing-vine-promotion-assistant');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const version = manifest.version;
const rawBase = 'https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main';
const userFile = 'lingxing-vine-promotion-assistant.user.js';
const metaFile = 'lingxing-vine-promotion-assistant.meta.js';
const downloadUrl = `${rawBase}/scripts/lingxing-vine-promotion-assistant/${userFile}`;
const updateUrl = `${rawBase}/scripts/lingxing-vine-promotion-assistant/${metaFile}`;

const metadata = `// ==UserScript==
// @name         领星 Vine 推广标注助手
// @namespace    crossborder-userscripts/lingxing-vine-promotion-assistant
// @version      ${version}
// @description  只读检查领星 Vine 订单，人工确认后小批量标记推广并回读；Pending、取消和退款订单纳入检查
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/extensions/lingxing-vine-promotion-assistant
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @icon         ${rawBase}/extensions/lingxing-vine-promotion-assistant/icons/icon128.png
// @match        https://erp.lingxing.com/erp/*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    ${updateUrl}
// @downloadURL  ${downloadUrl}
// ==/UserScript==
`;

const core = fs.readFileSync(path.join(extensionDir, 'src/core.js'), 'utf8');
const pageSession = fs.readFileSync(path.join(extensionDir, 'src/page-session.js'), 'utf8');
const content = fs.readFileSync(path.join(extensionDir, 'src/content.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(extensionDir, 'src/panel.css'), 'utf8');
const runtime = fs.readFileSync(path.join(scriptDir, 'userscript-runtime.js'), 'utf8');

const bundle = `${metadata}
(() => {
  'use strict';
  if (globalThis.__LINGXING_VINE_USERSCRIPT_STARTED__) return;
  globalThis.__LINGXING_VINE_USERSCRIPT_STARTED__ = true;

${core}

${pageSession}

${runtime}

  (async () => {
    if (!document.documentElement) {
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    globalThis.__LINGXING_VINE_CHROME__ = globalThis.LingxingVineUserscriptRuntime.createChromeShim(
      globalThis,
      { prefix: 'xynigo:lingxing-vine:' },
    );
    const __LINGXING_VINE_INLINE_CSS__ = ${JSON.stringify(stylesheet)};

${content}
  })().catch((error) => {
    console.error('[Vine 推广标注助手] 油猴版初始化失败', error);
  });
})();
`;

fs.writeFileSync(path.join(scriptDir, metaFile), metadata);
fs.writeFileSync(path.join(scriptDir, userFile), bundle);
console.log(path.join(scriptDir, userFile));
console.log(path.join(scriptDir, metaFile));

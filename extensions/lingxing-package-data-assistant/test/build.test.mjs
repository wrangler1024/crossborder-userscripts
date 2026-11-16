import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { root, applicationBundle, extensionManifest, userscriptBundle, userscriptMetadata, VENDOR_HASH } from '../scripts/bundle.mjs';
import { APP_VERSION } from '../src/app.mjs';
test('MV3 permissions and matches are restricted to the Lingxing ERP runtime and toolbar opening', () => {
  const manifest = extensionManifest(APP_VERSION); assert.deepEqual(manifest.permissions, ['activeTab']); assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.content_scripts.map(s => s.world), ['MAIN', 'ISOLATED']);
  for (const script of manifest.content_scripts) assert.deepEqual(script.matches, ['https://erp.lingxing.com/erp/*']);
});
test('both generated runtimes are syntactically valid and cannot mount twice or activate outside ERP', async () => {
  const window = { location: { hostname: 'example.com', pathname: '/' }, addEventListener() {}, removeEventListener() {}, intervals: 0, setInterval() { return ++this.intervals; }, clearInterval() {} };
  const extension = await applicationBundle('extension'), userscript = await userscriptBundle(APP_VERSION);
  new vm.Script(extension).runInNewContext({ window }); new vm.Script(userscript).runInNewContext({ window });
  assert.equal(window.intervals, 1); assert.equal(window.__lingxingPackageAssistantV1.channel, 'extension'); assert.equal(window.fetch, undefined);
});
test('committed userscript matches source before any generator can mask stale output', async () => {
  const generated = await fs.readFile(path.resolve(root, '../../scripts/lingxing-package-data-assistant/lingxing-package-data-assistant.user.js'), 'utf8');
  assert.equal(generated, await userscriptBundle(APP_VERSION)); assert.doesNotMatch(generated, /^\/\/ @(?:require|connect)\s/m);
  assert.match(generated, /Third-party license \(SheetJS\)/);
});
test('automatic update manifest is metadata only and identical to the installed script header', async () => {
  const metadata = await fs.readFile(path.resolve(root, '../../scripts/lingxing-package-data-assistant/lingxing-package-data-assistant.meta.js'), 'utf8');
  const script = await fs.readFile(path.resolve(root, '../../scripts/lingxing-package-data-assistant/lingxing-package-data-assistant.user.js'), 'utf8');
  assert.equal(metadata, userscriptMetadata(APP_VERSION));
  assert.equal(script.slice(0, script.indexOf('// ==/UserScript==') + '// ==/UserScript==\n'.length), metadata);
  assert.ok(metadata.trim().split('\n').every(line => line.startsWith('//')));
  assert.match(metadata, new RegExp('^// @version\\s+' + APP_VERSION.replaceAll('.', '\\.') + '$', 'm'));
});
test('updates follow the release channel without changing installed identity or runtime permissions', () => {
  const metadata = userscriptMetadata(APP_VERSION);
  const fields = Object.fromEntries([...metadata.matchAll(/^\/\/ @(\S+)\s+(.+)$/gm)].map(([, key, value]) => [key, value]));
  const base = 'https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-package-data-assistant/lingxing-package-data-assistant';
  assert.equal(fields.updateURL, base + '.meta.js'); assert.equal(fields.downloadURL, base + '.user.js');
  assert.equal(fields.name, 'FBA 包装数据维护助手'); assert.equal(fields.namespace, 'crossborder-userscripts/lingxing-package-data-assistant');
  assert.equal(fields.match, 'https://erp.lingxing.com/erp/*'); assert.equal(fields.grant, 'none');
  assert.equal(fields.require, undefined); assert.equal(fields.connect, undefined);
  assert.equal([...metadata.matchAll(/^\/\/ @updateURL\s/gm)].length, 1); assert.equal([...metadata.matchAll(/^\/\/ @downloadURL\s/gm)].length, 1);
});
test('pinned parser integrity and absence of test harness data in production runtime', async () => {
  const bytes = await fs.readFile(path.join(root, 'vendor/xlsx.full.min.cjs')); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), VENDOR_HASH);
  const source = await applicationBundle('extension'); assert.doesNotMatch(source, /packageHarness|AMZ-001|LOCAL-001|\/Users\//);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { root, applicationBundle, extensionManifest, userscriptBundle, VENDOR_HASH } from '../scripts/bundle.mjs';
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
  assert.equal(generated, await userscriptBundle(APP_VERSION)); assert.doesNotMatch(generated, /^\/\/ @(?:updateURL|downloadURL|require|connect)\s/m);
  assert.match(generated, /Third-party license \(SheetJS\)/);
});
test('pinned parser integrity and absence of test harness data in production runtime', async () => {
  const bytes = await fs.readFile(path.join(root, 'vendor/xlsx.full.min.cjs')); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), VENDOR_HASH);
  const source = await applicationBundle('extension'); assert.doesNotMatch(source, /packageHarness|AMZ-001|LOCAL-001|\/Users\//);
});

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { root, applicationBundle, extensionManifest, userscriptBundle } from './bundle.mjs';
import { APP_VERSION } from '../src/app.mjs';
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== APP_VERSION) throw new Error('Application and package versions must match');
const check = process.argv.includes('--check'), repo = path.resolve(root, '../..');
const userPath = path.join(repo, 'scripts/lingxing-package-data-assistant/lingxing-package-data-assistant.user.js');
const userscript = await userscriptBundle(APP_VERSION);
const content = await applicationBundle('extension');
const manifest = extensionManifest(APP_VERSION);
const files = { 'content.js': content, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' };
for (const file of ['bridge.js', 'popup.html', 'popup.css', 'popup.js']) files[file] = (await fs.readFile(path.join(root, 'extension', file), 'utf8')).replaceAll('{{VERSION}}', APP_VERSION);
files['LICENSE-SheetJS.txt'] = await fs.readFile(path.join(root, 'vendor/LICENSE-SheetJS.txt'), 'utf8');
files['README.md'] = await fs.readFile(path.join(root, 'README.md'), 'utf8');
if (check) {
  if (await fs.readFile(userPath, 'utf8') !== userscript) throw new Error('Generated userscript is stale');
  for (const [name, data] of Object.entries(files)) if (await fs.readFile(path.join(root, 'dist/extension', name), 'utf8') !== data) throw new Error('Generated extension file is stale: ' + name);
  console.log('Both distributions match the shared source.');
} else {
  await fs.mkdir(path.dirname(userPath), { recursive: true }); await fs.writeFile(userPath, userscript);
  const extension = path.join(root, 'dist/extension'); await fs.rm(extension, { recursive: true, force: true }); await fs.mkdir(extension, { recursive: true });
  for (const [name, data] of Object.entries(files)) await fs.writeFile(path.join(extension, name), data);
  await fs.copyFile(path.join(root, 'vendor/xlsx.full.min.cjs'), path.join(root, 'dist/xlsx.js'));
  const zip = path.join(root, 'dist/lingxing-package-data-assistant-' + APP_VERSION + '.zip'); await fs.rm(zip, { force: true });
  execFileSync('python3', [path.join(root, 'scripts/package_release.py'), extension, zip]);
  const hashes = { version: APP_VERSION, userscript: crypto.createHash('sha256').update(userscript).digest('hex'), extension: crypto.createHash('sha256').update(await fs.readFile(zip)).digest('hex') };
  await fs.writeFile(path.join(root, 'dist/artifacts.json'), JSON.stringify(hashes, null, 2) + '\n');
  console.log('Built trial artifacts ' + APP_VERSION + ' (publication is a separate step).');
}

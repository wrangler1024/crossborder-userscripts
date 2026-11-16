import { getNativeContext, contextIdentity, onProductPage, accountScope, companyScope } from './native-context.mjs';
import { createERPClient } from './client.mjs';
import { openJournal } from './journal.mjs';
import { createNativeImporter } from './native-import.mjs';
import { createPackageApp } from './app.mjs';
import { mountPackageUI } from './ui.mjs';
export function startPackageAssistant(win, { XLSX, channel = 'extension' }) {
  const key = '__lingxingPackageAssistantV1';
  if (win[key]) return win[key];
  let app, ui, identity, connecting = false, disposed = false, wantsOpen = false;
  async function connect() {
    if (disposed || connecting || app || !onProductPage(win)) return;
    let context; try { context = getNativeContext(win); contextIdentity(context); } catch { return; }
    connecting = true;
    try {
      identity = contextIdentity(context);
      const scope = await accountScope(context, win.crypto), lockScope = await companyScope(context, win.crypto);
      const client = createERPClient(win), importer = createNativeImporter(win);
      let journal;
      try { journal = await openJournal(win.indexedDB, scope, lockScope); }
      catch { journal = { scope, lockScope, list: async () => { throw new Error('无法保存本地执行记录，本次不会提交更新；请核对浏览器存储设置后刷新'); }, write: async () => { throw new Error('执行记录不可用'); }, close() {} }; }
      if (disposed || contextIdentity(getNativeContext(win)) !== identity) { journal.close(); return; }
      app = createPackageApp(win, { XLSX, client, journal, importer }); ui = mountPackageUI(win, app);
      if (wantsOpen) ui.open();
      app.initialize().catch(() => {});
    } catch { /* The normal ERP page may still be loading; the next tick can connect. No credentials are logged. */ }
    finally { connecting = false; }
  }
  function open() { wantsOpen = true; if (ui) ui.open(); else connect(); }
  function tick() {
    if (!onProductPage(win)) { ui?.setVisible(false); if (app?.state.busy) app.stop(); return; }
    if (!app) { connect(); return; }
    ui.setVisible(true);
    try { if (contextIdentity(getNativeContext(win)) !== identity && !app.state.blocked) app.invalidate(); }
    catch { if (!app.state.blocked) app.invalidate(); }
  }
  win.addEventListener('lingxing-package-assistant-open', open);
  const timer = win.setInterval(tick, 1000);
  const owner = { channel, open, dispose() { disposed = true; win.clearInterval(timer); win.removeEventListener('lingxing-package-assistant-open', open); app?.stop(); ui?.dispose(); if (app && !app.state.busy) app.dispose(); if (win[key] === owner) delete win[key]; } };
  win[key] = owner; tick(); return owner;
}

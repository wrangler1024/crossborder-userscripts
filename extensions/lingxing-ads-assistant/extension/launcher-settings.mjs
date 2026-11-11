export const LAUNCHER_SETTINGS_KEY='ads-launcher-v1';
export function normalizeLauncherPreferences(value){
  return {hidden:value?.hidden===true,position:typeof value?.position==='number'&&Number.isFinite(value.position)?Math.max(0,Math.min(1,value.position)):.5};
}
export function createLauncherSettings(storage){
  let queue=Promise.resolve();
  return request=>{
    const run=async()=>{
      if(!['read','write'].includes(request.action))throw new Error('入口设置操作无效');
      const current=normalizeLauncherPreferences((await storage.get(LAUNCHER_SETTINGS_KEY))[LAUNCHER_SETTINGS_KEY]);
      if(request.action==='read')return current;
      const patch=request.preferences;
      if(!patch||typeof patch!=='object'||Object.keys(patch).some(k=>!['hidden','position'].includes(k))||('hidden'in patch&&typeof patch.hidden!=='boolean')||('position'in patch&&(typeof patch.position!=='number'||!Number.isFinite(patch.position))))throw new Error('入口设置格式无效');
      const next=normalizeLauncherPreferences({...current,...patch});
      await storage.set({[LAUNCHER_SETTINGS_KEY]:next});
      return next;
    };
    const result=queue.then(run);queue=result.catch(()=>{});return result;
  };
}

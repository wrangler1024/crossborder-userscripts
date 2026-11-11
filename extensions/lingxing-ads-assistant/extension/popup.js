const openButton=document.getElementById('open-assistant'),showEntry=document.getElementById('show-entry'),status=document.getElementById('popup-status');
const preferences=async(action,patch)=>{
  const response=await chrome.runtime.sendMessage({type:'LX_ADS_LAUNCHER_PREFS',action,preferences:patch});
  if(!response?.ok)throw new Error(response?.error||'无法读取入口设置，请重新加载扩展');
  return response.result;
};
async function control(action,values){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id)throw new Error('请先打开领星广告页面');
  let response;
  try{response=await chrome.tabs.sendMessage(tab.id,{type:'LX_ADS_LAUNCHER_CONTROL',action,preferences:values});}
  catch{throw new Error('请先进入领星广告页面；更新插件后需刷新页面');}
  if(!response?.ok)throw new Error(response?.error||'请刷新领星广告页面后重试');
}
openButton.addEventListener('click',async()=>{
  openButton.disabled=true;status.textContent='正在打开助手…';
  try{await control('open');status.textContent='助手已在当前页面打开';window.close();}
  catch(error){status.textContent=error.message;}
  finally{openButton.disabled=false;}
});
showEntry.addEventListener('change',async()=>{
  showEntry.disabled=true;
  try{const value=await preferences('write',{hidden:!showEntry.checked});try{await control('preferences',value);status.textContent=showEntry.checked?'侧边入口已显示':'侧边入口已隐藏，仍可用上方按钮打开助手';}catch{status.textContent='设置已保存，打开或刷新领星广告页面后生效';}}
  catch(error){showEntry.checked=!showEntry.checked;status.textContent=error.message;}
  finally{showEntry.disabled=false;}
});
preferences('read').then(value=>{showEntry.checked=!value.hidden;showEntry.disabled=false;},error=>{status.textContent=error.message;});

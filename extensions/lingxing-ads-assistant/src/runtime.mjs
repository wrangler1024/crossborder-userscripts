// One UI and one session observer per page, even if both distributions are enabled.
export function claimAssistantRuntime(win,channel){
  const key='__lingxingAdsAssistantRuntimeV1';
  if(win[key]||win.document?.getElementById('lingxing-ad-preview-assistant'))return null;
  const owner={channel};win[key]=owner;
  return ()=>{if(win[key]===owner)delete win[key];};
}

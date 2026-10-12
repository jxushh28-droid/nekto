const base='http://127.0.0.1:3100';

async function openDashboard(){
 let ready=false;
 try{
  const response=await fetch(base+'/health',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(2500)});
  ready=response.ok&&(await response.json()).service==='nekto-local-extension';
 }catch{}
 await chrome.tabs.create({url:ready?base+'/audio':chrome.runtime.getURL('setup.html')});
}

chrome.action.onClicked.addListener(()=>{void openDashboard().catch(console.error);});

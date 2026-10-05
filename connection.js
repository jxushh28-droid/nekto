// A cookie control may stay visible but disabled after consent was already saved.
// It is optional and must never block the actual search button.
export async function startConversation(page,{wait=ms=>new Promise(r=>setTimeout(r,ms)),onState=()=>{}}={}){
 let requested=false,reloaded=false;
 for(let attempt=0;attempt<30;attempt++){
  const state=await page.evaluate(()=>window.__textHost?.status());
  if(state){onState(state);
   if(['verification','blocked'].includes(state.status))throw new Error(state.detail||'The site requires verification.');
   if(state.connected||state.status==='searching')return state;
  }
  const start=page.locator('#searchCompanyBtn');
  if(!requested&&await start.isVisible()){
   const cookies=page.locator('#acceptCookies');
   if(await cookies.isVisible()&&await cookies.isEnabled())await cookies.click({timeout:800}).catch(()=>{});
   await start.click({timeout:5000});requested=true;
  }
  if(!requested&&!reloaded&&state?.status==='ended'){await page.goto('https://nekto-me.kz/chat/',{waitUntil:'domcontentloaded',timeout:45000});reloaded=true;}
  await wait(500);
 }
 throw new Error(requested?'Nekto did not confirm starting the search.':'Nekto did not finish loading its Connect button. Try reconnecting.');
}

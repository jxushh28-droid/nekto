import {authorizeLiveToken} from './live-session.js';
export function textClientReady(){return Array.from(document.querySelectorAll('*')).some(el=>el.__vue__?.$store?.state?.user&&(el.__vue__.$store.state.system?.isAuth===true||el.__vue__.$store.state.system?.captchaRequired||el.__vue__.$store.state.system?.hcaptchaRequired)&&typeof((el.__vue__.$socketActions||el.__vue__.$store.$socketActions)?.authorize)==='function');}
export async function prepareTextSession(page,token,{reload=false}={}){
 const apply=async()=>{
  await page.waitForFunction(textClientReady,null,{timeout:20000});
  const result=await page.evaluate(authorizeLiveToken,{token});
  if(!result.ok)throw new Error(result.reason==='token-replaced'?'Nekto replaced the supplied token during authorization. Reapply a valid text-session token.':'Text-session authorization failed: '+result.reason);
  return result;
 };
 await apply();
 if(reload){await page.reload({waitUntil:'domcontentloaded',timeout:45000});await apply();}
 return {ok:true,reason:'accepted',refreshed:reload};
}

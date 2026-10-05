export function textSessionDiagnostics(){
 const app=Array.from(document.querySelectorAll('*')).map(el=>el.__vue__).find(vm=>vm?.$store?.state?.system);
 const system=app?.$store.state.system;
 return {path:location.pathname,route:location.hash,clientFound:!!app,authenticated:system?.isAuth??null,socketConnected:system?.socketConnected??null,captchaRequired:system?.captchaRequired??null,hcaptchaRequired:system?.hcaptchaRequired??null,masks:['mask_cap','mask_hcap','mask_bad','mask_bad_inet'].map(id=>{const el=document.getElementById(id);if(!el)return {id,present:false};const css=getComputedStyle(el),rect=el.getBoundingClientRect();return {id,present:true,display:css.display,visibility:css.visibility,opacity:css.opacity,width:rect.width,height:rect.height};})};
}

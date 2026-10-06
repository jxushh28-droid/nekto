export function voiceReady(){return [...document.querySelectorAll('*')].some(e=>e.__vue__?.$store?.state?.system&&(e.__vue__.$store.state.system.isFirstLoaded||e.__vue__.$store.state.system.captchaRequired||e.__vue__.$store.state.system.hcaptchaRequired));}
export function authorizeVoice({token,timeout=10000}){
 const vm=[...document.querySelectorAll('*')].map(e=>e.__vue__).find(v=>v?.$store?.state?.user&&typeof(v.$socketActions||v.$store.$socketActions)?.authorize==='function');if(!vm)return {ok:false,reason:'client-not-ready'};const store=vm.$store,actions=vm.$socketActions||store.$socketActions;
 const snapshot=()=>{let saved=false;try{saved=JSON.parse(localStorage.getItem('storage_audio_v2'))?.user?.authToken===token;}catch{}const s=store.state;return {savedTokenMatches:saved,liveTokenMatches:s.user.authToken===token,identityPresent:s.user.tokenId!=null,authenticated:s.system.isAuth===true,socketConnected:s.system.socketConnected===true,captcha:!!s.system.captchaRequired,hcaptcha:!!s.system.hcaptchaRequired};};
 const valid=d=>d.savedTokenMatches&&d.liveTokenMatches&&d.identityPresent&&d.authenticated&&d.socketConnected&&!d.captcha&&!d.hcaptcha;
 const initial=snapshot();if(initial.captcha||initial.hcaptcha)return {ok:false,reason:'verification-required',diagnostics:initial};if(valid(initial))return {ok:true,reason:'already-authorized',diagnostics:initial};
 return new Promise(resolve=>{let done=false,unsubscribe=()=>{},timer,poll,requested=false,registered=false;
 const finish=result=>{if(done)return;done=true;clearTimeout(timer);clearInterval(poll);unsubscribe();resolve({...result,diagnostics:snapshot()});};
 const check=()=>{if(done)return;const d=snapshot();if(d.captcha||d.hcaptcha)return finish({ok:false,reason:'verification-required'});if(registered&&valid(d))return finish({ok:true,reason:'accepted'});if(!requested&&d.socketConnected){requested=true;try{actions.authorize();}catch{finish({ok:false,reason:'authorization-failed'});}}};
 unsubscribe=store.subscribe(m=>{if(m.type==='user/registered'){if(m.payload?.success)registered=true;else if(m.payload?.success===false)return finish({ok:false,reason:'authorization-rejected'});}Promise.resolve().then(check);});
 timer=setTimeout(()=>finish({ok:false,reason:requested?'authorization-timeout':'socket-timeout'}),timeout);poll=setInterval(check,50);try{store.commit('user/setAuthToken',token);check();}catch{finish({ok:false,reason:'authorization-failed'});}
 });
}

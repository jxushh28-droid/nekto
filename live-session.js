// Runs inside the Nekto text page using its existing Vuex mutation and
// authorization method. It does not alter verification or rejection handlers.
export function authorizeLiveToken({token,timeout=10000,repeat=false}){
 const app=Array.from(document.querySelectorAll('*')).map(el=>el.__vue__).find(vm=>vm?.$store?.state?.user&&typeof(vm.$socketActions||vm.$store.$socketActions)?.authorize==='function');
 if(!app)return {ok:false,reason:'client-not-ready'};
 const store=app.$store,actions=app.$socketActions||store.$socketActions;
 let saved=false;try{saved=JSON.parse(localStorage.getItem('storage_v2'))?.user?.authToken===token;}catch{}
 const current=store.state;
 if(current.system?.captchaRequired||current.system?.hcaptchaRequired)return {ok:false,reason:'verification-required'};
 if(!repeat&&current.system?.isAuth===true&&current.system?.socketConnected===true&&current.user.authToken===token&&current.user.tokenModel?.tokenInfo?.authToken===token&&saved)return {ok:true,reason:'already-authorized'};
 return new Promise(resolve=>{
  let finished=false,unsubscribe=()=>{},timer;
  const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);unsubscribe();resolve(result);};
  unsubscribe=store.subscribe(mutation=>{
   if(store.state.system?.captchaRequired||store.state.system?.hcaptchaRequired)return finish({ok:false,reason:'verification-required'});
   if(mutation.type==='user/socket_auth.successToken'){
    // Allow all client subscribers to persist the accepted response first.
    Promise.resolve().then(()=>{
     let saved=false;try{saved=JSON.parse(localStorage.getItem('storage_v2'))?.user?.authToken===token;}catch{}
     const live=store.state.user.authToken===token;
     finish({ok:live&&saved,reason:live?(saved?'accepted':'storage-mismatch'):'token-replaced'});
    });
   }
  });
  timer=setTimeout(()=>finish({ok:false,reason:'authorization-timeout'}),timeout);
  try{store.commit('user/setAuthToken',token);actions.authorize();}catch{finish({ok:false,reason:'authorization-failed'});}
 });
}

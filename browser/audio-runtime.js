(()=>{
 if(window.__audioHost)return;
 let hadConnection=false,observedStore=null,previousToken=null,tokenSeen=false,tokenChanges=0,lastStateKey=null,sequence=0,unsubscribe=()=>{};const history=[];
 const visible=el=>{if(!el?.isConnected)return false;return el.checkVisibility?el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):!!el.getClientRects().length&&getComputedStyle(el).display!=='none';};
 function client(){return [...document.querySelectorAll('*')].map(e=>e.__vue__).find(vm=>vm?.$store?.state?.system&&vm.$store.state.user);}
 function observe(){if(!observedStore){observedStore=client()?.$store;if(!observedStore)return;if(typeof observedStore.subscribe==='function')unsubscribe=observedStore.subscribe(()=>observe());}const {system,user}=observedStore.state;if(tokenSeen&&user.authToken!==previousToken)tokenChanges++;previousToken=user.authToken;tokenSeen=true;const entry={registrationError:Number(system.errorRegistered)||0,authenticated:system.isAuth===true,socketConnected:system.socketConnected===true,captcha:!!system.captchaRequired,hcaptcha:!!system.hcaptchaRequired,restricted:!!system.forceDisconnectReason,tokenChanges};const key=JSON.stringify(entry);if(key===lastStateKey)return;lastStateKey=key;history.push({...entry,seq:++sequence,time:Date.now()});if(history.length>24)history.shift();}
 const traceTimer=setInterval(observe,100);window.addEventListener('pagehide',()=>{clearInterval(traceTimer);unsubscribe();},{once:true});
 function diagnostics(){observe();return history.map(entry=>({...entry}));}
 function status(){observe();const vm=client(),s=vm?.$store?.state,system=s?.system,user=s?.user,chat=s?.chat;const block=['#mask_bad','#mask_bad_inet','.swal2-popup'].map(x=>document.querySelector(x)).find(visible);const verification=!!(system?.captchaRequired||system?.hcaptchaRequired);const searching=!!user?.isSearching||/#\/?scan(?:[/?]|$)/.test(location.hash)||visible(document.querySelector('#search_company_loading'));
 const id=chat?.activeConnectionId??null;const connected=!!id&&system?.isAuth===true&&system?.socketConnected===true&&!verification&&!block&&!system?.forceDisconnectReason;
 if(connected){hadConnection=true;}const ended=hadConnection&&id==null&&!verification;
 const detail=verification?'Nekto требует проверку этого сеанса.':block?(block.innerText||'Nekto отказал в подключении.').trim().slice(0,200):system?.forceDisconnectReason?'Nekto отключил этот сеанс.':'';
 return {connected,ended,connectionId:id,status:verification?'verification':block||system?.forceDisconnectReason?'blocked':ended?'ended':connected?'connected':searching?'searching':visible(document.querySelector('#searchCompanyBtn'))?'ready':'loading',detail,authenticated:system?.isAuth===true,socketConnected:system?.socketConnected===true,registrationError:Number(system?.errorRegistered)||0,diagnostics:diagnostics()};}
 window.__audioHost={status,diagnostics};
})();

(()=>{
 if(window.__audioHost)return;
 let hadConnection=false,connectionId=null;
 const visible=el=>{if(!el?.isConnected)return false;return el.checkVisibility?el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):!!el.getClientRects().length&&getComputedStyle(el).display!=='none';};
 function client(){return [...document.querySelectorAll('*')].map(e=>e.__vue__).find(vm=>vm?.$store?.state?.system&&vm.$store.state.user);}
 function status(){const vm=client(),s=vm?.$store?.state,system=s?.system,user=s?.user,chat=s?.chat;const block=['#mask_bad','#mask_bad_inet','.swal2-popup'].map(x=>document.querySelector(x)).find(visible);const verification=!!(system?.captchaRequired||system?.hcaptchaRequired);const searching=!!user?.isSearching||/#\/?scan(?:[/?]|$)/.test(location.hash)||visible(document.querySelector('#search_company_loading'));
 const id=chat?.activeConnectionId??null;const connected=!!id&&system?.isAuth===true&&system?.socketConnected===true&&!verification&&!block;
 if(connected){hadConnection=true;connectionId=id;}const ended=hadConnection&&id==null&&!verification;
 const detail=verification?'Nekto требует проверку этого сеанса.':block?(block.innerText||'Nekto отказал в подключении.').trim().slice(0,200):system?.forceDisconnectReason?'Nekto отключил этот сеанс.':'';
 return {connected,ended,connectionId:id,status:verification?'verification':block||system?.forceDisconnectReason?'blocked':ended?'ended':connected?'connected':searching?'searching':visible(document.querySelector('#searchCompanyBtn'))?'ready':'loading',detail,authenticated:system?.isAuth===true,socketConnected:system?.socketConnected===true};}
 window.__audioHost={status};
})();

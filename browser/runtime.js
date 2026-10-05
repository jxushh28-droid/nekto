(()=>{
 if(window.__textHost)return;
 let profile=null,connected=false,input=null,route='',generation=0,seen=new WeakMap(),counter=0,initialized=false,dialogId=null,seenKeys=new Set();
 const doc=crypto.randomUUID();
 const state={epoch:doc+':0',connected:false,status:'loading',detail:''};
 const visible=NTGAdapter.visible;
 function read(){
  profile=NTGAdapter.detect();const d=NTGAdapter.read(profile);
  if(!!d.connected!==connected||(d.connected&&(input!==d.input||route!==location.hash||dialogId!==d.dialog?.id))){
   connected=!!d.connected;input=d.input;route=location.hash;dialogId=d.dialog?.id;seenKeys=new Set();state.epoch=doc+':'+(++generation);seen=new WeakMap();
   // Only seed history when attaching to an already-running document. The first
   // incoming message in a newly connected conversation must not be discarded.
   if(!initialized&&connected)for(const m of d.messages){seen.set(m.el,m.text);if(m.key)seenKeys.add(m.key);}
  }
  initialized=true;state.connected=connected;
  const blocking=d.blocking.element,verification=d.blocking.required;state.verification=d.blocking.verification;
  const searching=visible(document.querySelector('#search_company_loading'))||/\/searching(?:[/?]|$)/.test(location.hash);
  const start=visible(document.querySelector('#searchCompanyBtn'));
  state.status=verification?'verification':blocking?'blocked':connected?'connected':searching?'searching':start?'ready':d.native&&d.dialog?.close||visible(document.querySelector('.status-end'))?'ended':'loading';
  state.detail=verification?'Nekto запросил проверку CAPTCHA для этого сеанса.':blocking?(blocking.innerText||blocking.textContent||'').trim().slice(0,260):'';
  return d;
 }
 window.__textHost={
  poll(){const d=read(),messages=[];for(const m of d.messages){if(seen.get(m.el)===m.text||(m.key&&seenKeys.has(m.key)))continue;seen.set(m.el,m.text);if(m.key)seenKeys.add(m.key);if(connected)messages.push({id:doc+':'+(++counter),text:m.text});}return {...state,messages};},
  async send(text,epoch){
   const d=read();if(!connected||state.epoch!==epoch)return 'changed';if(d.native){
    if(text.length>4000)return 'too long';if(typeof d.actions?.anonMessage!=='function')return 'unavailable';
    const randomId=Date.now()*1000+Math.floor(Math.random()*1000),id=d.dialog.id;
    return new Promise(resolve=>{
     let done=false,unsub=()=>{},timer;
     const finish=result=>{if(done)return;done=true;clearTimeout(timer);unsub();resolve(result);};
     unsub=d.store.subscribe(()=>{
      const now=read();if(!connected||state.epoch!==epoch)return finish('changed');
      const accepted=now.dialog?.messages?.some(m=>m.randomId===randomId&&m.id!=null&&String(m.senderId)===String(d.store.state.user.tokenModel?.id));
      if(accepted)finish('confirmed');
     });
     timer=setTimeout(()=>finish('unconfirmed'),8000);
     try{d.actions.anonMessage(id,text,randomId);}catch{finish('failed');}
    });
   }
   if(!d.input)return 'unavailable';if(NTGAdapter.value(d.input)?.trim())return 'draft';if(text.length>(d.input.maxLength>0?d.input.maxLength:4000))return 'too long';
   NTGAdapter.setValue(d.input,text);d.input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Unidentified'}));
   for(let n=0;n<10;n++){await new Promise(r=>setTimeout(r,n===0?80:50));const now=read();if(!connected||state.epoch!==epoch||now.input!==d.input)return 'changed';if(!now.send.disabled){now.send.click();return 'submitted';}}
   if(NTGAdapter.value(d.input)===text)NTGAdapter.setValue(d.input,'');return 'wait';
  },
  cleared(){const d=read();return !!d.input&&!NTGAdapter.value(d.input)?.trim();},
  status(){read();return {...state};}
 };
})();

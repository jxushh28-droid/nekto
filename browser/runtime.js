(()=>{
 if(window.__textHost)return;
 let profile=null,connected=false,input=null,route='',generation=0,seen=new WeakSet(),counter=0;
 const doc=crypto.randomUUID();
 const state={epoch:doc+':0',connected:false};
 function read(){
  profile=NTGAdapter.detect();const d=NTGAdapter.read(profile);
  if(!!d.connected!==connected||(d.connected&&(input!==d.input||route!==location.hash))){
   connected=!!d.connected;input=d.input;route=location.hash;state.epoch=doc+':'+(++generation);
   seen=new WeakSet();for(const m of d.messages)seen.add(m.el);
  }
  state.connected=connected;return d;
 }
 window.__textHost={
  poll(){const d=read(),messages=[];for(const m of d.messages){if(seen.has(m.el))continue;seen.add(m.el);if(connected)messages.push({id:doc+':'+(++counter),text:m.text.slice(0,4000)});}return {...state,messages};},
  send(text,epoch){const d=read();if(!connected||state.epoch!==epoch)return 'changed';if(NTGAdapter.value(d.input)?.trim())return 'draft';if(d.send.disabled)return 'wait';if(text.length>(d.input.maxLength>0?d.input.maxLength:4000))return 'too long';NTGAdapter.setValue(d.input,text);d.send.click();return 'submitted';},
  cleared(){const d=read();return !d.input||!NTGAdapter.value(d.input)?.trim();},
  status(){read();return {...state};}
 };
})();

import {loadVideoSessions,saveVideoSessions,validateVideoSessions} from './video-session-config.js';
import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const target='https://ometv.chat/';
const injection=await readFile(new URL('./browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('./browser/video-runtime.js',import.meta.url),'utf8');

function videoFailure(error,stage,sessions){
 let detail=String(error?.message||error).split('\n')[0];
 for(const session of sessions)for(const key of ['token','SnDataStr','SnHmac'])if(session?.[key])detail=detail.split(session[key]).join('[redacted]');
 detail=detail.replace(/[A-Za-z0-9+/_=-]{40,}/g,'[redacted]').replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi,'[redacted]').replace(/https?:\/\/\S+/g,'[url]');
 const reason=/detached/i.test(detail)?'frame-detached':/destroyed|closed/i.test(detail)?'client-replaced':/missing/i.test(detail)?'iframe-missing':/Timeout/i.test(error?.name||detail)?'client-timeout':/SecurityError|denied/i.test(detail)?'storage-denied':/not defined/i.test(detail)?'client-reference-error':'client-operation-error';
 return {stage,reason,detail:detail.slice(0,180)};
}

export class VideoHost{
 constructor({getBrowser,data}){this.getBrowser=getBrowser;this.data=data;this.slots=[null,null];this.clients=[new Set(),new Set()];this.enabled=false;this.sessionSetup=false;this.sessions=[null,null];this.sessionsLoaded=loadVideoSessions(data).then(value=>{this.sessions=value;});this.closed=false;this.timer=setInterval(()=>this.tick(),700);this.polling=false;}
 frame(slot){return slot?.page.frames().find(f=>{try{const u=new URL(f.url());return u.hostname==='ometv.chat'&&u.pathname==='/embed/index.html'||slot.fixture&&u.hostname==='127.0.0.1';}catch{return false;}});}
 async open(i,{remember=false,fixture=false,port=3000}={}){if(this.slots[i])return;await this.sessionsLoaded;const browser=await this.getBrowser();let saved;if(remember)try{saved=JSON.parse(await readFile(this.data+'/video-'+i+'.json','utf8'));}catch{}
 const context=await browser.newContext({viewport:{width:1280,height:720},storageState:saved});await context.grantPermissions(['camera','microphone'],{origin:target});const slot={id:randomUUID(),context,page:null,pages:[],status:'loading',connected:false,busy:true,remember,fixture,cache:[],cacheBytes:0,generation:null,error:'',savedAt:Date.now()};this.slots[i]=slot;
 try{if(!fixture&&this.sessions[i])await context.addInitScript(session=>{if(location.hostname==='ometv.chat')localStorage.setItem('snid',JSON.stringify(session));},this.sessions[i]);await context.exposeBinding('__videoSegment',async({frame},segment)=>{if(this.slots[i]!==slot||frame!==this.frame(slot))return;await this.segment(i,slot,segment);});await context.addInitScript({content:injection});context.on('page',page=>{slot.pages.push(page);slot.activePage=page;page.on('dialog',d=>d.dismiss().catch(()=>{}));});slot.page=await context.newPage();slot.activePage=slot.page;
 if(fixture){await slot.page.goto('http://127.0.0.1:'+port+'/video-fixture',{waitUntil:'domcontentloaded'});const frame=this.frame(slot);await frame.evaluate(({color,frequency})=>window.__videoHost.fixture(color,frequency),{color:i===0?'#ff0000':'#0000ff',frequency:i===0?440:660});}else await slot.page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});slot.status='ready';
 }catch{await this.close(i);throw new Error('Could not open the hosted OmeTV session.');}finally{slot.busy=false;}}
 async segment(i,slot,packet){if(!packet||typeof packet.generation!=='string'||typeof packet.data!=='string'||packet.data.length>750000)return;if(slot.generation!==packet.generation){slot.retired||=new Set();if(slot.retired.has(packet.generation))return;if(slot.generation)slot.retired.add(slot.generation);if(slot.retired.size>64)slot.retired.delete(slot.retired.values().next().value);slot.generation=packet.generation;slot.cache=[];slot.cacheBytes=0;}slot.cache.push(packet);slot.cacheBytes+=packet.data.length;
 for(const res of this.clients[i]){if(res.writableLength>4000000){res.end();this.clients[i].delete(res);}else res.write('data: '+JSON.stringify(packet)+'\n\n');}
 const other=this.slots[1-i],frame=this.frame(other);if(this.enabled&&other?.connected&&slot.connected&&frame)await frame.evaluate(p=>window.__videoHost?.receive(p),packet).catch(()=>{other.error='Video receiver unavailable.';});
 if(slot.cacheBytes>3500000){slot.cache=[];slot.cacheBytes=0;await this.frame(slot)?.evaluate(()=>window.__videoHost?.restart()).catch(()=>{});}}
 subscribe(i,res){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');this.clients[i].add(res);const slot=this.slots[i];if(slot&&slot.cache.length<=10)for(const packet of slot.cache)res.write('data: '+JSON.stringify(packet)+'\n\n');else if(slot)this.frame(slot)?.evaluate(()=>window.__videoHost?.restart()).catch(()=>{});const timer=setInterval(()=>res.write(': ping\n\n'),15000);res.on('close',()=>{clearInterval(timer);this.clients[i].delete(res);});}
 async tick(){if(this.polling||this.closed)return;this.polling=true;try{for(let i=0;i<2;i++){const slot=this.slots[i];if(!slot||slot.busy)continue;const frame=this.frame(slot);if(!frame){slot.status='login';continue;}const state=await frame.evaluate(()=>window.__videoHost?.status()).catch(()=>null);if(!state){slot.status='loading';continue;}const wasConnected=slot.connected;slot.connected=state.connected;slot.status=state.verification?'verification':state.login?'login':state.connected?'connected':slot.searchRequested?'searching':'ready';slot.mediaReady=state.mediaReady;slot.receiverFailed=state.receiverFailed;
 if(state.ended&&!state.connected){await this.close(i);continue;}if(wasConnected&&!slot.connected){slot.cache=[];slot.cacheBytes=0;await this.frame(this.slots[1-i])?.evaluate(()=>window.__videoHost?.clearIncoming()).catch(()=>{});}await frame.evaluate(value=>window.__videoHost?.routing(value),{enabled:this.enabled,otherConnected:!!this.slots[1-i]?.connected});if(slot.remember&&Date.now()-slot.savedAt>60000){slot.savedAt=Date.now();await slot.context.storageState({path:this.data+'/video-'+i+'.json'});}}
 }catch{}finally{this.polling=false;}}

 async currentClient(slot,timeout=15000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
   if(slot.page.isClosed?.())throw new Error('OmeTV client closed.');
   const frame=this.frame(slot);
   if(frame&&!frame.isDetached?.()){
    try{const state=await frame.evaluate(()=>{const state=window.__videoHost?.status();if(state?.verification)return state;if(document.readyState==='loading'||!document.getElementById('local-video')||!document.getElementById('chat-text'))return null;return state;});if(state?.mediaReady)return {frame,state};}
    catch(e){if(!/detached|context.*destroyed|cannot find context|context.*not found/i.test(e.message))throw e;}
   }
   await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('OmeTV client did not load.');
 }
 async prepareSession(i){
  await this.sessionsLoaded;const session=this.sessions[i];
  if(!session)throw new Error('Paste this side’s complete OmeTV snid session first.');
  await this.open(i);const slot=this.slots[i];if(slot.preparedToken===session.token)return;
  slot.busy=true;let stage='wait-client';
  try{
   const initial=await this.currentClient(slot);if(initial.state.verification)throw new Error('OmeTV requires verification.');
   for(let pass=0;pass<2;pass++){
    stage='wait-apply-'+(pass+1);const current=await this.currentClient(slot);
    if(current.state.verification)throw new Error('OmeTV requires verification.');
    stage='apply-'+(pass+1);
    await slot.page.evaluate(session=>{
     localStorage.setItem('snid',JSON.stringify(session));
     const iframe=document.getElementById('videochat');
     if(!iframe?.contentWindow)throw Error('OmeTV frame missing');
     iframe.contentWindow.postMessage({setAuthToken:session.token,videochatDataStr:session.SnDataStr,videochatHmac:session.SnHmac,source:'sn'},'https://ometv.chat');
    },session);
    stage='settle-'+(pass+1);await new Promise(r=>setTimeout(r,800));
    const settled=await this.currentClient(slot);if(settled.state.verification)throw new Error('OmeTV requires verification.');
   }
   stage='confirm-client';let state;
   for(let n=0;n<20;n++){
    ({state}=await this.currentClient(slot));if(state.verification)throw new Error('OmeTV requires verification.');
    if(!state.login)break;await new Promise(r=>setTimeout(r,250));
   }
   if(state.login)throw new Error('OmeTV did not accept this session. Copy a fresh complete snid value.');
   slot.preparedToken=session.token;slot.status='ready';slot.error='';
  }catch(e){
   slot.preparedToken=null;const failure=videoFailure(e,stage,this.sessions);
   console.warn(JSON.stringify({event:'video_session_failed',slot:i===0?'A':'B',...failure}));
   slot.error='OmeTV session failed at '+failure.stage+': '+failure.reason;
   throw new Error(/^(OmeTV requires|OmeTV did not accept|OmeTV client)/.test(e.message)?e.message:slot.error);
  }finally{slot.busy=false;}
 }
 async applySessions(values){const sessions=validateVideoSessions(values);if(this.sessionSetup)throw new Error('Video session setup is busy.');this.sessionSetup=true;try{await this.sessionsLoaded;await this.close(0);await this.close(1);await saveVideoSessions(this.data,sessions);this.sessions=sessions;const results=[];for(let i=0;i<2;i++){try{await this.start(i);results.push({slot:i,ok:true});}catch(e){const error=/^(OmeTV session failed|Paste this side|OmeTV requires|OmeTV did not accept|OmeTV client|Could not apply|Could not open|The video bridge)/.test(e.message)?e.message:'Hosted video connection failed.';if(this.slots[i])this.slots[i].error=error;results.push({slot:i,ok:false,error});}}return {ok:results.every(r=>r.ok),results};}finally{this.sessionSetup=false;}}
 async start(i){await this.prepareSession(i);const slot=this.slots[i];slot.busy=true;try{const {state}=await this.currentClient(slot);if(state?.verification)throw new Error('OmeTV requires verification.');if(state?.login)throw new Error('OmeTV did not accept this session. Copy a fresh complete snid value.');if(state?.connected)return;if(!state?.mediaReady)throw new Error('The video bridge is not ready.');await slot.page.frameLocator('iframe#videochat').getByText('Start',{exact:true}).click({timeout:5000});slot.searchRequested=true;slot.status='searching';slot.error='';}catch(e){const failure=videoFailure(e,'start',this.sessions);console.warn(JSON.stringify({event:'video_session_failed',slot:i===0?'A':'B',...failure}));if(/^(OmeTV requires|OmeTV did not accept|OmeTV client|The video bridge)/.test(e.message))throw e;slot.error='OmeTV session failed at start: '+failure.reason;throw new Error(slot.error);}finally{slot.busy=false;}}
 async toggle(enabled,consent){if(enabled&&!consent)throw new Error('Confirm that both connected participants know about the bridge.');if(enabled&&!this.slots.every(s=>s?.connected))throw new Error('Connect both participants first.');this.enabled=!!enabled;for(let i=0;i<2;i++){const slot=this.slots[i];if(!slot)continue;const frame=this.frame(slot);await frame?.evaluate(()=>window.__videoHost?.clearIncoming());await frame?.evaluate(value=>window.__videoHost?.routing(value),{enabled:this.enabled,otherConnected:!!this.slots[1-i]?.connected});if(enabled)await frame?.evaluate(()=>window.__videoHost?.restart());}}
 async close(i){const slot=this.slots[i];if(!slot)return;this.slots[i]=null;this.enabled=false;const other=this.slots[1-i];await this.frame(other)?.evaluate(()=>{window.__videoHost?.routing({enabled:false,otherConnected:false});window.__videoHost?.clearIncoming();}).catch(()=>{});for(const res of this.clients[i]){res.write('event: closed\ndata: {}\n\n');res.end();}this.clients[i].clear();if(slot.remember)await slot.context.storageState({path:this.data+'/video-'+i+'.json'}).catch(()=>{});await slot.context.close().catch(()=>{});}
 status(){return {enabled:this.enabled,sessionSetup:this.sessionSetup,sessionConfigured:this.sessions.map(Boolean),slots:this.slots.map((s,i)=>({label:i===0?'A':'B',open:!!s,status:s?.status||'closed',connected:!!s?.connected,busy:!!s?.busy,error:s?.error||'',remember:!!s?.remember,receiverFailed:!!s?.receiverFailed}))};}
 async send(i,text){if(typeof text!=='string'||!text.trim()||text.length>4000)throw new Error('Write a message of 1–4000 characters.');const slot=this.slots[i],frame=this.frame(slot);if(!slot?.connected||!frame)throw new Error('Connect this participant first.');const current=await frame.evaluate(()=>window.__videoHost?.status());if(!current?.connected)throw new Error('Connect this participant first.');const input=frame.locator('#chat-text');await input.fill(text);await input.press('Enter');}
 async test(port){if(this.slots.some(Boolean))throw new Error('Close video sessions before running the generated-media test.');try{await this.open(0,{fixture:true,port});await this.open(1,{fixture:true,port});for(let n=0;n<8&&!this.slots.every(s=>s?.connected);n++){await this.tick();await new Promise(r=>setTimeout(r,250));}await this.toggle(true,true);let samples;for(let n=0;n<30;n++){await new Promise(r=>setTimeout(r,500));samples=await Promise.all(this.slots.map(s=>this.frame(s).evaluate(()=>window.__videoHost.diagnostics())));const [a,b]=samples;if(a.outgoingPixel[2]>180&&a.outgoingPixel[0]<80&&b.outgoingPixel[0]>180&&b.outgoingPixel[2]<80&&a.audioPeak>500&&a.audioPeak<800&&b.audioPeak>300&&b.audioPeak<550)return {ok:true,videoBothWays:true,audioBothWays:true};}return {ok:false,samples};}finally{await this.close(0);await this.close(1);}}
 async shutdown(){this.closed=true;clearInterval(this.timer);await this.close(0);await this.close(1);for(const clients of this.clients)for(const res of clients)res.end();}
}

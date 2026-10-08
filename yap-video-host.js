import {VideoHost} from './video-host.js';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {BrowserProfiles} from './browser-profile.js';

const target='https://yap.chat/video';
const injection=await readFile(new URL('./browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('./browser/video-runtime.js',import.meta.url),'utf8');

export function yapPreferences(selfGender='male',previous={cookies:[],origins:[]}){
 if(selfGender!=='male'&&selfGender!=='female')throw Error('Yap requires a valid gender selection before connecting.');
 const state=structuredClone(previous);
 let origin=state.origins.find(entry=>entry.origin==='https://yap.chat');
 if(!origin){origin={origin:'https://yap.chat',localStorage:[]};state.origins.push(origin);}
 let gender=origin.localStorage.find(item=>item.name==='uhmingle_selected_gender');
 if(!gender){gender={name:'uhmingle_selected_gender',value:selfGender};origin.localStorage.push(gender);}else gender.value=selfGender;
 return state;
}

export class YapVideoHost extends VideoHost{
 constructor(options){super({...options,pageUrl:target,sessionless:true});this.lastAttempts=[null,null];this.profiles=new BrowserProfiles(options.data+'/yap-profiles','https://yap.chat');}
 frame(slot){
  if(!slot?.page)return;
  return slot.page.frames().find(f=>{try{const u=new URL(f.url());return slot.fixture?u.hostname==='127.0.0.1':u.origin==='https://yap.chat'&&u.pathname==='/video';}catch{return false;}});
 }
 async open(i,{fixture=false,port=3000,selfGender='male'}={}){
  yapPreferences(selfGender);
  if(this.slots[i])return;
  const profile=fixture?{state:{cookies:[],origins:[]},restored:false}:await this.profiles.load(i);
  const storageState=yapPreferences(selfGender,profile.state);
  this.lastAttempts[i]=null;
  const browser=await this.getBrowser();
  // Yap reads this normal setup preference at mount. Without it, permission
  // approval opens the gender picker and its own socket effect cannot run.
  const context=await browser.newContext({viewport:{width:1280,height:720},storageState});
  const slot={id:randomUUID(),context,page:null,pages:[],status:'loading',connected:false,busy:true,remember:false,fixture,selfGender,profile:{restored:profile.restored,saved:false,saveFailed:false},cache:[],cacheBytes:0,generation:null,error:'',network:{httpErrors:[],failedRequests:0,sockets:0,socketErrors:0,sentFrames:0,receivedFrames:0}};
  this.slots[i]=slot;
  try{
   await context.grantPermissions(['camera','microphone'],{origin:'https://yap.chat'});
   await context.exposeBinding('__videoSegment',async({frame},segment)=>{if(this.slots[i]===slot&&frame===this.frame(slot))await this.segment(i,slot,segment);});
   // Multiple init scripts have no guaranteed ordering. Configure the adapter
   // in the same script, before it allocates its media streams.
   await context.addInitScript({content:"window.__videoHostConfig={width:320,provider:'yap'};\n"+injection});
   slot.page=await context.newPage();slot.pages.push(slot.page);
   slot.page.on('requestfailed',()=>{if(this.slots[i]===slot)slot.network.failedRequests++;});
   slot.page.on('response',response=>{
    if(this.slots[i]!==slot||response.status()<400)return;
    try{const u=new URL(response.url());if(u.origin==='https://yap.chat'&&u.pathname.startsWith('/api/'))slot.network.httpErrors=[...slot.network.httpErrors,{status:response.status(),endpoint:u.pathname==='/api/socket-token'?'socket-token':u.pathname==='/api/country'?'country':'other-api'}].slice(-8);}catch{}
   });
   slot.page.on('websocket',socket=>{
    slot.network.sockets++;
    socket.on('framesent',()=>slot.network.sentFrames++);
    socket.on('framereceived',()=>slot.network.receivedFrames++);
    socket.on('socketerror',()=>slot.network.socketErrors++);
   });
   slot.page.on('dialog',d=>d.dismiss().catch(()=>{}));
   slot.page.on('popup',p=>p.close().catch(()=>{}));
   slot.page.on('crash',()=>{slot.crashed=true;slot.connected=false;slot.status='error';slot.error='Yap video browser ran out of memory.';this.enabled=false;});
   await slot.page.goto(fixture?'http://127.0.0.1:'+port+'/video-fixture':target,{waitUntil:'domcontentloaded',timeout:45000});
   if(fixture)await this.frame(slot).evaluate(({color,frequency})=>window.__videoHost.fixture(color,frequency),{color:i===0?'#ff0000':'#0000ff',frequency:i===0?440:660});
   slot.status='ready';
  }catch(e){await this.close(i);throw Error(e?.name==='TimeoutError'?'Yap video page did not load within 45 seconds.':'Could not open the hosted Yap video session.');}
  finally{slot.busy=false;}
 }
 async currentClient(slot,timeout=15000){
  if(slot.crashed)throw Error('Yap video browser crashed.');
  await slot.page.waitForFunction(()=>!!window.__videoHost?.status().mediaReady,null,{timeout});
  const frame=this.frame(slot);if(!frame)throw Error('Yap video client is unavailable.');
  const state=await frame.evaluate(()=>window.__videoHost.status());
  slot.lastNativeState=state;if(state.connected)slot.hadLiveMedia=true;
  return {frame,state};
 }
 async prepareSession(i){await this.open(i);await this.currentClient(this.slots[i]);}
 async persistProfile(i,slot){
  if(slot.fixture||slot.crashed||!slot.context?.storageState)return;
  slot.profile||={restored:false,saved:false,saveFailed:false};
  try{await this.profiles.save(i,await slot.context.storageState());slot.profile.saved=true;slot.profile.saveFailed=false;}
  catch{slot.profile.saveFailed=true;console.warn(JSON.stringify({event:'yap_profile_save_failed',slot:i?'B':'A'}));}
 }
 checkNative(state){
  if(state.verification)throw Error('Yap requires verification.');
  if(state.login)throw Error('Yap requires sign-in before starting this session.');
  if(state.nativeError)throw Error(state.nativeError);
  if(state.genderRequired)throw Error('Yap requires a gender selection. Disconnect this side and choose its gender before connecting.');
 }
 async start(i,{selfGender='male'}={}){
  yapPreferences(selfGender);
  if(this.slots[i]?.crashed)await this.close(i);
  if(this.slots[i]?.selfGender&&this.slots[i].selfGender!==selfGender)throw Error('Yap gender was changed. Disconnect this side before connecting with the new selection.');
  await this.open(i,{selfGender});const slot=this.slots[i];slot.busy=true;slot.startFailed=false;let stage='wait-media-runtime';
  try{
   let {state}=await this.currentClient(slot);
   this.checkNative(state);
   if(state.connected||state.searching||state.playbackWaiting){slot.connected=!!state.connected;slot.status=state.connected?'connected':state.playbackWaiting?'playback':'searching';slot.searchRequested=!state.connected;slot.searchAt||=Date.now();return;}
   stage='wait-entry';
   // The media adapter can be ready before React mounts/hydrates Yap's UI.
   // Wait for a native handler, then click the entry only once.
   await slot.page.waitForFunction(()=>{
    const state=window.__videoHost?.status();
    if(state?.verification||state?.login||state?.nativeError)return true;
    return [...document.querySelectorAll('button')].some(button=>{
     const text=(button.innerText||'').replace(/\s+/g,' ').trim();
     if(!/^(?:Start Random Video Chat|(?:▶\s*)?START)$/i.test(text)||button.disabled||!button.getClientRects().length)return false;
     const key=Object.keys(button).find(k=>k.startsWith('__reactProps$'));
     return typeof button.onclick==='function'||typeof button[key]?.onClick==='function';
    });
   },null,{timeout:30000});
   ({state}=await this.currentClient(slot));
   this.checkNative(state);
   const landing=slot.page.getByRole('button',{name:/^Start Random Video Chat$/i});
   stage='enter-video-client';
   if(await landing.isVisible())await landing.click({timeout:5000});
   // Only the normal Start button; never Adult, Next, sign-in or a challenge.
   const start=slot.page.getByRole('button',{name:/^(?:▶\s*)?START$/i}).filter({visible:true}).first();
   stage='wait-native-start';
   await start.waitFor({state:'visible',timeout:30000});
   await slot.page.waitForFunction(()=>{
    const state=window.__videoHost?.status();
    if(state?.verification||state?.login||state?.nativeError)return true;
    return [...document.querySelectorAll('button')].some(button=>{
     if(!/^(?:▶\s*)?START$/i.test((button.innerText||'').replace(/\s+/g,' ').trim())||button.disabled||!button.getClientRects().length)return false;
     const key=Object.keys(button).find(k=>k.startsWith('__reactProps$'));
     return typeof button.onclick==='function'||typeof button[key]?.onClick==='function';
    });
   },null,{timeout:30000});
   ({state}=await this.currentClient(slot));
   this.checkNative(state);
   stage='wait-native-ready';
   await slot.page.waitForFunction(()=>{
    const state=window.__videoHost?.status();
    return !!(state?.verification||state?.login||state?.nativeError||state?.genderRequired||state?.connected||state?.searching||state?.playbackWaiting||state?.nativeClientFound&&state?.nativeSocketConnected&&state?.nativeMediaReady);
   },null,{timeout:30000});
   ({state}=await this.currentClient(slot));
   this.checkNative(state);
   if(state.connected||state.searching||state.playbackWaiting){slot.connected=!!state.connected;slot.status=state.connected?'connected':state.playbackWaiting?'playback':'searching';slot.searchRequested=!state.connected;slot.searchAt||=Date.now();return;}
   await this.persistProfile(i,slot);
   stage='click-native-start';
   await start.click({timeout:5000});
   slot.searchRequested=true;slot.searchAt=Date.now();slot.status='starting';slot.error='';
   stage='confirm-native-search';
   await slot.page.waitForFunction(()=>{const s=window.__videoHost?.status();return !!(s?.connected||s?.searching||s?.playbackWaiting||s?.login||s?.verification||s?.nativeError);},null,{timeout:15000});
   ({state}=await this.currentClient(slot));this.checkNative(state);
   slot.connected=!!state.connected;slot.status=state.connected?'connected':state.playbackWaiting?'playback':'searching';slot.searchRequested=!state.connected;
  }catch(e){slot.startFailed=true;slot.failureStage=stage;slot.error=/^(Yap|Could not open)/.test(e.message)?e.message:stage==='confirm-native-search'?'Yap did not confirm starting the search. Disconnect this side before retrying.':stage==='wait-native-ready'?'Yap camera, microphone and socket setup did not become ready. Disconnect this side before retrying.':'Yap video could not start at '+stage+'.';slot.status=/verification/.test(slot.error)?'verification':/sign-in/.test(slot.error)?'login':'error';console.warn(JSON.stringify({event:'yap_video_start_failed',slot:i?'B':'A',stage,reason:e?.name==='TimeoutError'?'timeout':'client-error'}));throw Error(slot.error);}
  finally{slot.busy=false;}
 }
 async tick(){await super.tick();for(const s of this.slots){if(s?.status==='waiting')s.error='Yap has not connected a participant yet.';else if(s?.status==='playback')s.error='';}}
 async close(i){
  const slot=this.slots[i];if(!slot)return;
  if(!slot.fixture){
   const state=slot.lastNativeState||{};
   await this.persistProfile(i,slot);
   this.lastAttempts[i]={at:Date.now(),ended:!!state.ended,selfGender:slot.selfGender||null,nativeStatus:state.nativeStatus||null,nativeSocketConnected:!!state.nativeSocketConnected,nativeMatchKind:state.nativeMatchKind||null,nativeMode:state.nativeMode||null,hadLiveMedia:!!slot.hadLiveMedia,profile:slot.profile?{...slot.profile}:null,failureStage:slot.failureStage||null};
   console.info(JSON.stringify({event:'yap_video_closed',slot:i?'B':'A',reason:state.ended?'participant-ended':'closed',nativeStatus:state.nativeStatus||null,matchKind:state.nativeMatchKind||null,hadLiveMedia:!!slot.hadLiveMedia}));
  }
  await super.close(i);
 }
 status(){const status=super.status();return {...status,provider:'yap',requiresSession:false,slots:status.slots.map((slot,i)=>({...slot,status:!slot.open&&this.lastAttempts[i]?.ended?'ended':slot.status,error:!slot.open&&this.lastAttempts[i]?.ended?'Yap participant disconnected or the native room changed. Connect this side again when ready.':slot.error,selfGender:this.slots[i]?.selfGender||this.lastAttempts[i]?.selfGender||null,lastAttempt:this.lastAttempts[i]}))};}
 async inspect(){const result=await super.inspect();for(let i=0;i<2;i++){result.slots[i].failureStage=this.slots[i]?.failureStage||null;result.slots[i].lastAttempt=this.lastAttempts[i];result.slots[i].profile=this.slots[i]?.profile?{...this.slots[i].profile}:null;}return result;}
 async send(i,text){
  if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Write a message of 1–4000 characters.');
  const slot=this.slots[i];if(!slot?.connected)throw Error('Connect this participant first.');
  const state=await this.frame(slot).evaluate(()=>window.__videoHost.status());
  if(!state.connected)throw Error('Connect this participant first.');
  if(!state.canSend)throw Error('Yap does not currently show a text-message control.');
  const input=slot.page.locator('textarea:not([disabled]), input[type="text"]:not([disabled])').filter({visible:true}).first();
  await input.fill(text);await input.press('Enter');
 }
}

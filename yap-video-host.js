import {VideoHost} from './video-host.js';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const target='https://yap.chat/video';
const injection=await readFile(new URL('./browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('./browser/video-runtime.js',import.meta.url),'utf8');

export class YapVideoHost extends VideoHost{
 constructor(options){super({...options,pageUrl:target,sessionless:true});}
 frame(slot){
  if(!slot?.page)return;
  return slot.page.frames().find(f=>{try{const u=new URL(f.url());return slot.fixture?u.hostname==='127.0.0.1':u.origin==='https://yap.chat'&&u.pathname==='/video';}catch{return false;}});
 }
 async open(i,{fixture=false,port=3000}={}){
  if(this.slots[i])return;
  const browser=await this.getBrowser();
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  const slot={id:randomUUID(),context,page:null,pages:[],status:'loading',connected:false,busy:true,remember:false,fixture,cache:[],cacheBytes:0,generation:null,error:''};
  this.slots[i]=slot;
  try{
   await context.grantPermissions(['camera','microphone'],{origin:'https://yap.chat'});
   await context.exposeBinding('__videoSegment',async({frame},segment)=>{if(this.slots[i]===slot&&frame===this.frame(slot))await this.segment(i,slot,segment);});
   await context.addInitScript(()=>{window.__videoHostConfig={width:320,provider:'yap'};});
   await context.addInitScript({content:injection});
   slot.page=await context.newPage();slot.pages.push(slot.page);
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
  return {frame,state};
 }
 async prepareSession(i){await this.open(i);await this.currentClient(this.slots[i]);}
 async start(i){
  if(this.slots[i]?.crashed)await this.close(i);
  await this.open(i);const slot=this.slots[i];slot.busy=true;
  try{
   let {state}=await this.currentClient(slot);
   if(state.verification)throw Error('Yap requires verification.');
   if(state.nativeError)throw Error(state.nativeError);
   if(state.connected||state.searching)return;
   const landing=slot.page.getByRole('button',{name:'Start Random Video Chat',exact:true});
   if(await landing.isVisible())await landing.click({timeout:5000});
   // Only the normal Start button; never Adult, Next, sign-in or a challenge.
   const start=slot.page.getByRole('button',{name:/^(?:▶\s*)?START$/i}).filter({visible:true}).first();
   await start.waitFor({state:'visible',timeout:20000});
   ({state}=await this.currentClient(slot));
   if(state.verification)throw Error('Yap requires verification.');
   if(state.nativeError)throw Error(state.nativeError);
   await start.click({timeout:5000});
   slot.searchRequested=true;slot.searchAt=Date.now();slot.status='starting';slot.error='';
  }catch(e){slot.error=/^(Yap|Could not open)/.test(e.message)?e.message:'Yap video could not start. Its native Start control was unavailable.';slot.status=/verification/.test(slot.error)?'verification':'error';throw Error(slot.error);}
  finally{slot.busy=false;}
 }
 async tick(){await super.tick();for(const s of this.slots)if(s?.status==='waiting')s.error='Yap has not connected a participant yet.';}
 status(){return {...super.status(),provider:'yap',requiresSession:false};}
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

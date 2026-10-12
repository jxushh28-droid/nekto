import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {VideoHost} from './video-host.js';
import {BrowserProfiles} from './browser-profile.js';
import {validateNativeInput} from './native-input.js';
import {videoProvider,videoProviders,loadProviderConfig,saveProviderConfig,providerSessionPair} from './video-providers.js';
const injection=await readFile(new URL('./browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('./browser/video-runtime.js',import.meta.url),'utf8');

export class ProviderVideoHost extends VideoHost{
  constructor(options){
    super({...options,sessionless:true});this.provider='umingle';this.config={provider:'umingle',sessions:{umingle:[null,null],chatruletka:[null,null]}};
    this.sessionsLoaded=loadProviderConfig(this.data).then(config=>{this.config=config;this.provider=config.provider;this.sessions=config.sessions[this.provider];});
  }
  get definition(){return videoProvider(this.provider);}
  profiles(){return new BrowserProfiles(this.data+'/video-profiles/'+this.provider,this.definition.origin);}
  frame(slot){return slot?.page?.mainFrame();}
  safeError(e){return /^(Umingle|Chatruletka|Video |Connect |Write |Close |Open |Invalid browser|The video bridge|Could not open)/.test(e?.message||'')?String(e.message).slice(0,250):this.definition.name+' could not complete this operation. Check its native screen.';}
  async selectProvider(id){
    const provider=videoProvider(id);await this.sessionsLoaded;
    if(this.sessionSetup||this.slots.some(Boolean))throw Error('Close both video sessions before changing provider.');
    this.sessionSetup=true;
    try{this.provider=provider.id;this.config.provider=provider.id;this.sessions=this.config.sessions[provider.id];await saveProviderConfig(this.data,this.config);return this.status();}finally{this.sessionSetup=false;}
  }
  async open(i,{fixture=false,port=3000}={}){
    await this.sessionsLoaded;if(this.slots[i])return;
    const provider=this.definition,session=this.sessions[i],profiles=this.profiles(),identity=session?JSON.stringify(session):null;
    const profile=fixture?{state:{cookies:[],origins:[]},restored:false}:await profiles.load(i,identity);
    const browser=await this.getBrowser(),context=await browser.newContext({viewport:{width:1280,height:720},storageState:session||profile.state});
    const slot={id:randomUUID(),context,page:null,pages:[],provider:provider.id,status:'loading',connected:false,busy:true,fixture,cache:[],cacheBytes:0,generation:null,error:'',profile:{restored:profile.restored},identity,profiles};this.slots[i]=slot;
    try{
      await context.grantPermissions(['camera','microphone'],{origin:provider.origin});
      await context.exposeBinding('__videoSegment',async({frame},packet)=>{if(this.slots[i]===slot&&frame===this.frame(slot))await this.segment(i,slot,packet);});
      const runtimeOrigin=fixture?'http://127.0.0.1:'+port:provider.origin;
      await context.addInitScript({content:'if(location.origin==='+JSON.stringify(runtimeOrigin)+'){window.__videoHostConfig='+JSON.stringify({width:320,provider:provider.id,providerName:provider.name})+';\n'+injection+'\n}'});
      slot.page=await context.newPage();slot.pages.push(slot.page);
      slot.page.on('dialog',d=>d.dismiss().catch(()=>{}));slot.page.on('popup',p=>p.close().catch(()=>{}));
      slot.page.on('crash',()=>{slot.crashed=true;slot.connected=false;slot.status='error';slot.error=provider.name+' browser crashed. Disconnect this side before retrying.';this.enabled=false;});
      await slot.page.goto(fixture?'http://127.0.0.1:'+port+'/video-fixture':provider.url,{waitUntil:'domcontentloaded',timeout:45000});
      if(fixture)await this.frame(slot).evaluate(({color,frequency})=>window.__videoHost.fixture(color,frequency),{color:i?'#0000ff':'#ff0000',frequency:i?660:440});
      slot.status='ready';
    }catch(e){await this.close(i);throw Error('Could not open the hosted '+provider.name+' page.');}finally{slot.busy=false;}
  }
  async currentClient(slot,timeout=20000){
    if(slot.crashed)throw Error(this.definition.name+' browser crashed.');
    await slot.page.waitForFunction(()=>!!window.__videoHost?.status().mediaReady,null,{timeout});
    const frame=this.frame(slot),state=await frame.evaluate(()=>window.__videoHost.status());
    slot.lastNativeState=state;return {frame,state};
  }
  checkNative(state){
    if(state.verification)throw Error(this.definition.name+' requires verification. Complete it on the native screen.');
    if(state.nativeError)throw Error(state.nativeError);
    if(state.login)throw Error(this.definition.name+' requires sign-in on its native screen.');
    if(state.attention)throw Error(this.definition.name+' requires a response on its native screen.');
  }
  async prepareSession(i){await this.open(i);const result=await this.currentClient(this.slots[i]);this.checkNative(result.state);return result;}
  async start(i){
    if(this.slots[i]?.crashed)await this.close(i);await this.open(i);const slot=this.slots[i];slot.busy=true;slot.startFailed=false;
    try{
      let {state}=await this.currentClient(slot);this.checkNative(state);
      if(state.connected||state.searching){slot.connected=state.connected;slot.status=state.connected?'connected':'searching';return;}
      const button=slot.page.locator(this.definition.start);
      await button.waitFor({state:'visible',timeout:25000});
      await slot.page.waitForFunction(()=>{
        const s=window.__videoHost?.status();return s&&(s.verification||s.login||s.attention||s.nativeError||s.connected||s.searching||s.nativeMediaReady);
      },null,{timeout:20000});
      ({state}=await this.currentClient(slot));this.checkNative(state);
      if(state.connected||state.searching){slot.connected=state.connected;slot.status=state.connected?'connected':'searching';return;}
      if(await button.count()!==1||!await button.isEnabled())throw Error(this.definition.name+' Start control is unavailable.');
      const label=(await button.innerText()).replace(/\s+/g,' ').trim();
      if(this.provider==='umingle'&&!/^Start(?:\s+Esc)?$/i.test(label))throw Error('Umingle is waiting for another native action.');
      await slot.page.evaluate(()=>window.__videoHost.newConversation());await button.click({timeout:5000});slot.searchRequested=true;slot.searchAt=Date.now();slot.status='starting';slot.error='';
      await slot.page.waitForFunction(()=>{const s=window.__videoHost?.status();return s&&(s.connected||s.searching||s.verification||s.login||s.attention||s.nativeError);},null,{timeout:15000});
      ({state}=await this.currentClient(slot));this.checkNative(state);slot.connected=state.connected;slot.status=state.connected?'connected':'searching';
      await this.persistProfile(i,slot);
    }catch(e){slot.startFailed=true;slot.error=this.safeError(e);slot.status=/verification/i.test(slot.error)?'verification':/sign-in/i.test(slot.error)?'login':'error';throw Error(slot.error);}finally{slot.busy=false;}
  }
  async applySessions(values){
    await this.sessionsLoaded;if(this.sessionSetup)throw Error('Video session setup is busy.');
    const sessions=providerSessionPair(values,this.provider);this.sessionSetup=true;
    try{for(let i=0;i<2;i++)await this.close(i);this.sessions=sessions;this.config.sessions[this.provider]=sessions;await saveProviderConfig(this.data,this.config);
      const results=[];for(let i=0;i<2;i++){try{await this.start(i);results.push({slot:i,ok:true});}catch(e){results.push({slot:i,ok:false,error:this.safeError(e)});}}
      return {ok:results.every(r=>r.ok),results};
    }finally{this.sessionSetup=false;}
  }
  async validateSessions(){
    await this.sessionsLoaded;if(this.sessionSetup)throw Error('Video session setup is busy.');this.sessionSetup=true;
    try{const results=[];for(let i=0;i<2;i++){try{await this.prepareSession(i);results.push({slot:i,ok:true});}catch(e){results.push({slot:i,ok:false,error:this.safeError(e)});}}
      return {ok:results.every(r=>r.ok),results};
    }finally{this.sessionSetup=false;}
  }
  async persistProfile(i,slot){if(slot.fixture||slot.crashed)return;await slot.profiles.save(i,await slot.context.storageState(),slot.identity).catch(()=>{});}
  async tick(){
    if(this.polling||this.closed||this.sessionSetup)return;this.polling=true;
    try{for(let i=0;i<2;i++){
      const slot=this.slots[i];if(!slot||slot.busy||slot.crashed)continue;
      const frame=this.frame(slot),state=await frame.evaluate(()=>window.__videoHost?.status()).catch(()=>null);
      if(this.slots[i]!==slot||!state)continue;slot.lastNativeState=state;
      const previous=slot.connected;slot.connected=!!state.connected&&!state.verification&&!state.nativeError&&!state.login&&!state.attention;
      slot.status=state.verification?'verification':state.login?'login':state.attention?'attention':state.nativeError?'error':slot.connected?'connected':state.ended?'ended':state.searching?'searching':slot.searchRequested&&Date.now()-slot.searchAt<15000?'starting':'ready';
      slot.error=state.nativeError||(slot.startFailed?slot.error:'');
      slot.canSend=slot.connected&&!!state.canSend;slot.receiverFailed=!!state.receiverFailed;
      if(previous&&!slot.connected||state.ended||state.verification||state.nativeError||state.login||state.attention){
        this.enabled=false;slot.cache=[];slot.cacheBytes=0;
        for(const other of this.slots)await this.frame(other)?.evaluate(()=>{window.__videoHost?.routing({enabled:false,otherConnected:false});window.__videoHost?.clearIncoming();}).catch(()=>{});
      }
      if(slot.connected){slot.searchRequested=false;slot.startFailed=false;slot.error='';}
      await frame.evaluate(value=>window.__videoHost?.routing(value),{enabled:this.enabled,otherConnected:!!this.slots[1-i]?.connected,preview:this.clients[i].size>0});
    }}finally{this.polling=false;}
  }
  status(){return {...super.status(),provider:this.provider,providers:Object.values(videoProviders).map(({id,name,url})=>({id,name,url})),sessionOptional:true,slots:super.status().slots.map((s,i)=>({...s,epoch:this.slots[i]?.id||null}))};}
  async inspect(){return {provider:this.provider,slots:this.slots.map((s,i)=>({label:i?'B':'A',open:!!s,state:s?.lastNativeState||null}))};}
  async send(i,text){
    if(typeof text!=='string'||!text.trim()||text.length>1000)throw Error('Write a message of 1–1000 characters.');
    const slot=this.slots[i];if(!slot?.connected)throw Error('Connect this participant first.');
    const {state}=await this.currentClient(slot);this.checkNative(state);if(!state.connected)throw Error('Connect this participant first.');
    const input=slot.page.locator(this.definition.message);await input.fill(text);await input.press('Enter');
  }
  async screen(i){const slot=this.slots[i];if(!slot||slot.crashed)return null;return {epoch:slot.id,bytes:await slot.page.screenshot({type:'jpeg',quality:60,timeout:5000})};}
  async input(i,data){
    const slot=this.slots[i];if(!slot||slot.crashed)throw Error('Open this video side first.');if(data.epoch!==slot.id)throw Error('Video session changed. Wait for its new native screen.');
    if(slot.busy||this.sessionSetup)throw Error('Video session is busy.');let input;try{input=validateNativeInput(data);}catch{throw Error('Video native screen action is invalid.');}slot.busy=true;
    try{
      const state=await slot.page.evaluate(()=>window.__videoHost?.status());if(state?.nativeError)throw Error(state.nativeError);
      if(new URL(slot.page.url()).origin!==this.definition.origin)throw Error('Video native screen left its provider.');
      if(input.action==='click'){const size=slot.page.viewportSize();await slot.page.mouse.click(input.x*size.width,input.y*size.height);}
      else if(input.action==='text')await slot.page.keyboard.insertText(input.text);
      else if(input.action==='key')await slot.page.keyboard.press(input.key);
      else await slot.page.mouse.wheel(0,input.deltaY);
      slot.startFailed=false;return {ok:true};
    }finally{slot.busy=false;}
  }
  async close(i){const slot=this.slots[i];if(slot)await this.persistProfile(i,slot);await super.close(i);}
}

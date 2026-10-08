import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {pcmLevel} from './audio-level.js';
import {AudioGraph} from './audio-graph.js';
import {saveTokens} from './token-config.js';
import {loadAudioTokens,saveAudioTokens} from './audio-token-config.js';
import {confirmVoiceSession,voiceReady} from './voice-session.js';
import {primeVoiceStorage} from './voice-bootstrap.js';
import {voiceStorageState} from './voice-storage-state.js';
import {BrowserProfiles} from './browser-profile.js';
import {voiceWireFrame} from './voice-wire.js';
import {inspectVoiceToken} from './voice-inspection.js';
import {validateNativeInput} from './native-input.js';

const runtime=await readFile(new URL('./browser/audio-runtime.js',import.meta.url),'utf8');
const site='https://nekto-me.kz/audiochat';

function redactWsText(value) {
  return String(value)
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[UUID]"
    )
    .replace(/\b[0-9a-f]{64}\b/gi, "[HEX64]")
    .replace(
      /("(?:auth_?token|token|access_?token|refresh_?token|authorization|password|secret|cookie|SnDataStr|SnHmac)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[REDACTED]"'
    );
}


export class AudioHost{
  constructor({data,graph=new AudioGraph(),launch=options=>chromium.launch(options)}){
    this.data=data+'/audio';
    this.profiles=new BrowserProfiles(this.data+'/profiles','https://nekto-me.kz');
    this.graph=graph;
    this.launch=launch;
    this.slots=[null,null];
    this.clients=[new Set(),new Set()];
    this.captures=[null,null];
    this.requested=false;
    this.enabled=false;
    this.setup=false;
    this.polling=false;
    this.ops=new Set();
    this.attempts=[null,null];
    this.screens=[null,null];
    this.loaded=mkdir(this.data,{recursive:true}).then(()=>loadAudioTokens(this.data)).then(v=>this.tokens=v);
    this.timer=setInterval(()=>void this.tick(),500);
  }

  hasOpen(){return this.setup||this.ops.size>0||this.slots.some(s=>s&&!s.stopped);}

  error(e){
    let message=String(e?.message||e);
    for(const token of this.tokens||[])if(token)message=message.split(token).join('[redacted]');
    return /^(Nekto|Enter|Use|Audio|Close)/.test(message)?message.slice(0,200):'Audio operation failed. Disconnect this side and try again.';
  }

  async prepare(i){
    await this.loaded;
    if(!this.tokens[i])throw Error('Enter this side’s voice authToken first.');
    let s=this.slots[i];
    if(s?.stopped)throw Error('Audio session stopped after failure. Disconnect this side before testing again. Your saved token has been retained.');
    if(s?.prepared)return s;

    if(!s){
      const profile=await this.profiles.load(i,this.tokens[i]);
      await this.graph.ensure();

      const browser=await this.launch({
        headless:true,
        channel:'chromium',
        ignoreDefaultArgs:['--mute-audio'],
        args:['--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'],
        env:this.graph.browserEnv(i)
      });

      try{
      const context=await browser.newContext({
        storageState:voiceStorageState(this.tokens[i],profile.state),
        viewport:{width:1920,height:1080},
        isMobile:false,
        hasTouch:false,
        locale:'ru-RU'
      });

      const bootstrap={ok:false,reason:'await-document-start'};

      await context.grantPermissions(['microphone'],{origin:'https://nekto-me.kz'});

      await context.addInitScript(primeVoiceStorage,this.tokens[i]);
      await context.addInitScript({content:runtime});

      const page=await context.newPage();

function safeSocketUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, "[REDACTED]");
    }
    return redactWsText(url.href);
  } catch {
    return "[unavailable]";
  }
}

let socketSequence = 0;

page.on("websocket", ws => {
  const socketId = ++socketSequence;
  let frameSequence = 0;

  const log = (event, details = {}) => {
    console.log(JSON.stringify({
      time: new Date().toISOString(),
      slot:i?'B':'A',
      attemptId:s.epoch,
      socketId,
      event,
      ...details
    }));
  };

  log("created", { url: safeSocketUrl(ws.url()) });

  const logFrame = (direction, { payload }) => {
    const binary = Buffer.isBuffer(payload);
    const nativeSocket=new URL(ws.url()).hostname==='audio.nekto-me.kz';
    const wire=nativeSocket?voiceWireFrame(direction,payload,s.profileIdentity):null;
    if(wire){Object.assign(s.wire,wire);this.recordAttempt(i,s);log('native-registration',{...wire});}
    log(direction, {
      frameSequence: ++frameSequence,
      binary,
      bytes: binary
        ? payload.length
        : Buffer.byteLength(payload, "utf8"),
      payloadOmitted: true
    });
  };

  ws.on("framesent", frame => logFrame("sent", frame));
  ws.on("framereceived", frame => logFrame("received", frame));
  ws.on("socketerror", () => log("error"));
  ws.on("close", () => log("closed"));
});
      s={browser,context,page,bootstrap,profileIdentity:this.tokens[i],profile:{restored:profile.restored,saved:false,saveFailed:false},wire:{registrationSent:false,sentTokenMatches:null,registrationReceived:false,registrationSucceeded:null,registrationError:null,lastResult:null},stage:'navigate',status:'loading',connected:false,prepared:false,error:'',epoch:this.attempts[i]?.attemptId||crypto.randomUUID()};
      this.slots[i]=s;
      this.screens[i]=null;
      this.recordAttempt(i,s);
      console.log(JSON.stringify({event:'audio_token_init_registered',slot:i?'B':'A',attemptId:s.epoch,storageOrigin:'https://nekto-me.kz',initialization:'context-storage-before-page',browserVersion:typeof browser.version==='function'?browser.version():null}));

      page.on('dialog',d=>d.dismiss().catch(()=>{}));
      page.on('popup',p=>p.close().catch(()=>{}));
      page.on('crash',()=>{
        s.crashed=true;
        s.connected=false;
        s.status='error';
        s.error='Audio browser ran out of memory. Disconnect unused modes first.';
        void this.graph.routing(false).catch(()=>{});
        this.enabled=false;
      });

      await page.goto(site,{waitUntil:'domcontentloaded',timeout:45000});
      s.bootstrap=await page.evaluate(()=>window.__voiceTokenBootstrap||{ok:false,reason:'extension-init-not-run'});
      this.recordAttempt(i,s);
      console.log(JSON.stringify({event:'audio_token_bootstrap',slot:i?'B':'A',attemptId:s.epoch,...s.bootstrap}));
      }catch(e){
        if(s&&this.slots[i]===s){
          const timeout=e?.name==='TimeoutError';
          s.error=s.crashed?s.error:timeout?'Nekto audio page did not finish loading within 45 seconds.':'Nekto audio page could not load.';
          s.status='error';
          this.recordAttempt(i,s);
          await this.stopFailed(i,s);
          throw Error(s.error);
        }
        await browser.close().catch(()=>{});
        throw e;
      }
    }

    // Only document-start seeding is valid. A post-navigation write is too
    // late to establish which token the site's client loaded at startup.
    const bootstrap=s.bootstrap||{ok:false,reason:'extension-init-not-verified'};

    if(!bootstrap.ok||bootstrap.phase&&bootstrap.phase!=='document-start')throw Error('Nekto voice token could not be saved before startup: '+bootstrap.reason);

    s.stage='await-native-client';
    try{await s.page.waitForFunction(voiceReady,null,{timeout:20000});}
    catch(e){if(e?.name==='TimeoutError')throw Error('Nekto audio client did not become ready within 20 seconds. The call has not been started.');throw e;}
    s.stage='confirm-native-session';
    const registrationDiagnostic = await s.page.evaluate(() => {
  const stores = [...document.querySelectorAll("*")]
    .map(el => el.__vue__?.$store)
    .filter(store => store?.state?.system && store.state.user);

  const store = stores[0];
  if (!store) return { clientFound: false };

  const { system, user, chat } = store.state;

  let savedToken = null;
  let storageReadable = true;

  try {
    savedToken = JSON.parse(
      localStorage.getItem("storage_audio_v2") || "{}"
    )?.user?.authToken ?? null;
  } catch {
    storageReadable = false;
  }

  return {
    clientFound: true,
    firstLoadCompleted: system.isFirstLoaded === true,
    clientAuthFlag: system.isAuth === true,
    socketConnected: system.socketConnected === true,
    registrationError: Number(system.errorRegistered)||0,
    disconnectReason: typeof system.forceDisconnectReason==='number'?system.forceDisconnectReason:system.forceDisconnectReason?'present':null,
    captchaRequired: !!system.captchaRequired,
    hcaptchaRequired: !!system.hcaptchaRequired,
    liveTokenPresent: !!user.authToken,
    savedTokenPresent: !!savedToken,
    savedMatchesLive:
      !!savedToken && savedToken === user.authToken,
    storageReadable,
    identityPresent: user.tokenId != null,
    searching: !!user.isSearching,
    callPresent: chat?.activeConnectionId != null
  };
});

console.log(JSON.stringify({event:'audio_registration_diagnostic',slot:i?'B':'A',attemptId:s.epoch,...registrationDiagnostic}));
    const result=await s.page.evaluate(confirmVoiceSession,{token:this.tokens[i]});
    s.authorization=result.diagnostics;
    this.recordAttempt(i,s);

    const trace=await s.page.evaluate(()=>window.__audioHost?.diagnostics?.()||[]);
    this.recordDiagnostics(i,s,trace);

    console.log(JSON.stringify({event:'audio_session_confirmation',slot:i?'B':'A',attemptId:s.epoch,ok:result.ok,reason:result.reason,...result.diagnostics}));
    if(!result.ok){
      s.failureStatus=result.reason==='verification-required'?'verification':result.reason==='native-restriction'?'blocked':'error';
      throw Error(
        result.reason==='verification-required'
          ?'Nekto requires verification for this voice session.'
          :result.diagnostics?.registrationError
            ?'Nekto rejected voice registration (code '+result.diagnostics.registrationError+').'
            :'Nekto did not confirm this voice session: '+result.reason
      );
    }
    if(s.wire&&(!s.wire.registrationSent||!s.wire.sentTokenMatches||!s.wire.registrationReceived||!s.wire.registrationSucceeded))throw Error('Nekto native registration did not confirm sending and accepting the saved token. The call has not been started.');

    s.prepared=true;
    s.stage='native-session-ready';
    s.status='ready';
    await this.persistProfile(i,s);
    return s;
  }

  async state(s){
    if(s.crashed)throw Error(s.error);
    let timer;
    try{
      return await Promise.race([
        s.page.evaluate(()=>window.__audioHost?.status()),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Audio browser did not respond.')),5000);})
      ]);
    }finally{clearTimeout(timer);}
  }

  async inspectToken(i,s,phase){
    if(!s.profileIdentity)return null;
    const snapshot=await s.page.evaluate(inspectVoiceToken,s.profileIdentity);
    if(this.slots[i]!==s)throw Error('Audio session changed during token inspection.');
    s.tokenInspection={phase,at:Date.now(),...snapshot};
    if(phase==='before-start'||phase==='after-start'){
      s.callToken=s.callToken||{};
      s.callToken[phase==='before-start'?'before':'after']={...s.tokenInspection};
    }
    this.recordAttempt(i,s);
    return snapshot;
  }

  assertToken(snapshot,s){
    if(s?.wire?.sentTokenMatches===false||snapshot&&(!snapshot.clientFound||!snapshot.storageReadable||!snapshot.savedTokenMatches||!snapshot.liveTokenMatches))throw Object.assign(Error('Nekto voice token changed in the active session. The bridge is disabled. Disconnect this side before applying your saved token again.'),{code:'TOKEN_MISMATCH'});
  }

  async start(i){
    if(this.ops.has(i)||this.setup)throw Error('Audio session is busy.');
    if(this.slots[i]?.paused)throw Error('Audio session is paused. Complete the check using its native screen before starting a call.');
    this.ops.add(i);
    this.attempts[i]={attemptId:crypto.randomUUID(),stage:'prepare',startedAt:Date.now()};
    if(this.slots[i])this.slots[i].operationError='';
    try{
      const s=await this.prepare(i);
      // Keep document-start seeding unchanged and let native startup settle.
      // State is checked again after the wait, before any Start click.
      s.stage='wait-before-start';
      this.recordAttempt(i,s);
      await new Promise(resolve=>setTimeout(resolve,7000));
      if(this.slots[i]!==s||s.stopped)throw Error('Audio session closed before starting the call.');
      s.stage='before-start';
      for(let n=0,clicked=false;n<30;n++){
        const state=await this.state(s);
        if(state){
          this.recordDiagnostics(i,s,state.diagnostics);
          this.recordNativeState(s,state);
        }
        if(s.stage==='wait-search'&&!s.microphone)await this.inspectMicrophone(i,s,'after-start');
        if(s.stage==='wait-search')this.assertToken(await this.inspectToken(i,s,'after-start'),s);
        if(['verification','blocked','attention'].includes(state?.status)){s.failureStatus=state.status;throw Error(state.detail?'Nekto: '+state.detail:'Nekto requires attention before starting this voice session.');}
        if(state?.connected||state?.status==='searching'){
          Object.assign(s,{connected:state.connected,status:state.status,error:''});
          s.stage=state.status;
          return;
        }
        if(!clicked&&state?.authenticated&&state?.socketConnected&&await s.page.locator('#searchCompanyBtn').isVisible()){
          const cookies=s.page.locator('#acceptCookies');
          if(await cookies.isVisible()&&await cookies.isEnabled())await cookies.click({timeout:800}).catch(()=>{});
          this.assertToken(await this.inspectToken(i,s,'before-start'),s);
          s.stage='start-click';
          console.log(JSON.stringify({event:'audio_search_start',slot:i?'B':'A',attemptId:s.epoch,phase:'before-click',authenticated:state.authenticated,socketConnected:state.socketConnected,registrationError:state.registrationError||0}));
          await s.page.locator('#searchCompanyBtn').click({timeout:5000});
          clicked=true;
          s.stage='wait-search';
          console.log(JSON.stringify({event:'audio_search_start',slot:i?'B':'A',attemptId:s.epoch,phase:'clicked'}));
        }
        await new Promise(r=>setTimeout(r,500));
      }
      throw Error('Nekto did not confirm starting the voice search.');
    }catch(e){
      if(this.slots[i]){
        this.slots[i].error=this.error(e);
        this.slots[i].operationError=this.error(e);
        this.slots[i].status=this.slots[i].failureStatus||'error';
        this.slots[i].connected=false;
        await this.stopFailed(i,this.slots[i]);
      }
      throw Error(this.error(e));
    }finally{
      if(this.slots[i])this.recordAttempt(i,this.slots[i]);
      this.ops.delete(i);
    }
  }

  async apply(values,consent){
    if(this.setup||this.ops.size)throw Error('Audio session is busy.');
    this.setup=true;
    try{
      await this.loaded;
      const saved=await saveTokens(this.data,values);
      await this.close(0);
      await this.close(1);
      this.tokens=saved;
      this.requested=!!consent;
    }finally{
      this.setup=false;
    }
    return this.connectBoth();
  }

  async applySingle(i,token,{startCall=true}={}){
    if(i!==0&&i!==1)throw Error('Invalid audio side.');
    if(typeof token!=='string'||!token.trim())throw Error('Enter this side’s voice authToken first.');
    if(this.setup||this.ops.size)throw Error('Audio session is busy.');
    this.setup=true;
    try{
      await this.loaded;
      const values=[...this.tokens];
      values[i]=token;
      const saved=await saveAudioTokens(this.data,values);
      await this.close(0);
      await this.close(1);
      this.tokens=saved;
      this.requested=false;
    }finally{
      this.setup=false;
    }
    try{
      if(startCall)await this.start(i);else await this.checkAuthorization(i);
      return {ok:true,operation:startCall?'call':'authorization',results:[{slot:i,ok:true}]};
    }catch(e){
      return {ok:false,results:[{slot:i,ok:false,error:this.error(e)}]};
    }
  }

  async checkAuthorization(i){
    if(this.ops.has(i)||this.setup)throw Error('Audio session is busy.');
    this.ops.add(i);this.attempts[i]={attemptId:crypto.randomUUID(),stage:'prepare'};
    try{const s=await this.prepare(i);s.stage='authorized-no-call';this.recordAttempt(i,s);}
    catch(e){const s=this.slots[i];if(s){s.error=this.error(e);s.status=s.failureStatus||'error';await this.stopFailed(i,s);}throw Error(this.error(e));}
    finally{this.ops.delete(i);}
  }

  recordNativeState(s,state){
    s.lastState={status:state.status,authenticated:state.authenticated===true,socketConnected:state.socketConnected===true,registrationError:Number(state.registrationError)||0,restrictionSource:state.restrictionSource||null,disconnectCode:typeof state.disconnectCode==='number'?state.disconnectCode:null};
  }

  async connectBoth(){
    const results=await Promise.all([0,1].map(async slot=>{
      try{await this.start(slot);return {slot,ok:true};}
      catch(e){return {slot,ok:false,error:this.error(e)};}
    }));
    return {ok:results.every(x=>x.ok),results};
  }

  recordAttempt(i,s){
    this.attempts[i]={attemptId:s.epoch,stage:s.stage||'prepare',status:s.status,stopped:!!s.stopped,paused:!!s.paused,bootstrap:s.bootstrap?{ok:s.bootstrap.ok,reason:s.bootstrap.reason,phase:s.bootstrap.phase||null}:null,authorization:s.authorization?{...s.authorization}:null,tokenInspection:s.tokenInspection?{...s.tokenInspection}:null,callToken:s.callToken?{...s.callToken}:null,wire:s.wire?{...s.wire}:null,profile:s.profile?{...s.profile}:null,lastState:s.lastState?{...s.lastState}:null,microphone:s.microphone?{...s.microphone}:null};
  }

  async persistProfile(i,s){
    if(!s?.context?.storageState||s.crashed)return;
    try{await this.profiles.save(i,await s.context.storageState(),s.profileIdentity);if(s.profile){s.profile.saved=true;s.profile.saveFailed=false;}}
    catch{if(s.profile)s.profile.saveFailed=true;console.warn(JSON.stringify({event:'audio_profile_save_failed',slot:i?'B':'A'}));}
    this.recordAttempt(i,s);
  }

  recordDiagnostics(i,s,entries=[]){
    for(const entry of entries){
      if(entry.seq<=(s.lastDiagnostic||0))continue;
      s.lastDiagnostic=entry.seq;
      console.log(JSON.stringify({event:'audio_native_state',slot:i?'B':'A',attemptId:s.epoch,...entry}));
    }
    s.diagnostics=entries.slice(-24);
  }

  async tick(){
    if(this.polling||this.setup)return;
    this.polling=true;
    try{
      for(let i=0;i<2;i++){
        const s=this.slots[i];
        if(!s||this.ops.has(i)||s.crashed||s.stopped)continue;
        try{
          const state=await this.state(s);
          if(this.setup)return;
          if(!state||this.slots[i]!==s||this.ops.has(i))continue;
          this.recordDiagnostics(i,s,state.diagnostics);
          this.recordNativeState(s,state);
          const token=await this.inspectToken(i,s,'current');
          if(this.slots[i]!==s||this.ops.has(i)||this.setup)continue;
          this.assertToken(token,s);
          if(token?.restricted){state.status='blocked';state.connected=false;}
          if(s.paused&&!['verification','attention','blocked'].includes(state.status)){
            // Recovery follows the native client; never click Start or reauthorize.
            if(token&&(!token.authenticated||!token.socketConnected||!token.identityPresent||!s.wire?.sentTokenMatches||!s.wire?.registrationSucceeded))continue;
            s.paused=false;s.operationError='';s.failureStatus=null;
            if(token)s.prepared=true;
            s.stage='native-check-completed';
            await this.persistProfile(i,s);
            if(this.slots[i]!==s||this.ops.has(i)||this.setup)continue;
          }
          if(state.ended){await this.close(i);continue;}
          if(s.operationError&&!state.connected&&!['verification','blocked','attention'].includes(state.status)){
            state.status='error';
            state.detail=s.operationError;
          }
          if(s.status!==state.status)
            console.log(JSON.stringify({event:'audio_session_status',slot:i?'B':'A',status:state.status,authenticated:state.authenticated,socketConnected:state.socketConnected}));
          Object.assign(s,{status:state.status,connected:state.connected,error:state.detail||''});
          if(['verification','blocked','attention'].includes(state.status))await this.stopFailed(i,s);
        }catch(e){
          if(this.slots[i]!==s||this.setup||this.ops.has(i))continue;
          s.status='error';
          s.connected=false;
          s.error=this.error(e);
          await this.stopFailed(i,s);
        }
      }

      for(let i=0;i<2;i++){
        const s=this.slots[i];
        if(!s)continue;
        if(!s.paused&&!s.stopped&&(s.connected||this.clients[i].size))this.ensureCapture(i);
        else this.stopCapture(i);
      }

      const enabled=!!this.graph.process&&this.requested&&this.slots.every(s=>s?.connected&&!s.crashed&&!s.paused&&!s.stopped);
      if(this.graph.process)await this.graph.routing(enabled);
      this.enabled=enabled;
    }catch{
      this.enabled=false;
      this.requested=false;
      if(this.graph.process)await this.graph.routing(false).catch(()=>{});
    }finally{
      this.polling=false;
    }
  }

  async consent(value){
    this.requested=!!value;
    if(!value){
      this.enabled=false;
      if(this.graph.process)await this.graph.routing(false);
    }
    await this.tick();
  }

  status(){
    return {
      enabled:this.enabled,
      requested:this.requested,
      setup:this.setup,
      configured:(this.tokens||[null,null]).map(Boolean),
      slots:this.slots.map((s,i)=>({
        label:i?'B':'A',
        open:!!s&&!s.stopped,
        closable:!!s,
        stopped:!!s?.stopped,
        paused:!!s?.paused,
        interactive:!!s&&!s.stopped&&!s.crashed&&!this.ops.has(i)&&!this.setup,
        attemptId:s?.epoch||null,
        stage:s?.stage||null,
        bootstrap:s?.bootstrap||null,
        lastAttempt:this.attempts[i],
        status:s?.status||'closed',
        connected:!!s?.connected,
        busy:this.setup||this.ops.has(i),
        error:s?.error||s?.captureError||'',
        authorization:s?.authorization||null,
        tokenInspection:s?.tokenInspection||null,
        callToken:s?.callToken||null,
        wire:s?.wire?{...s.wire}:null,
        profile:s?.profile?{...s.profile}:null,
        diagnostics:s?.diagnostics||[],
        microphone:s?.microphone||null,
        screenAvailable:!!s&&this.screens[i]?.epoch===s.epoch,
        screenAt:s&&this.screens[i]?.epoch===s.epoch?this.screens[i].at:null,
        level:s?.connected&&Date.now()-(s.levelAt||0)<500?s?.meter?.level||0:0,
        db:s?.connected&&Date.now()-(s.levelAt||0)<500?s?.meter?.db??-60:-60
      }))
    };
  }

  ensureCapture(i){
    const original=this.slots[i];
    if(!original||original.crashed||original.stopped||original.paused||original.captureFailed||this.captures[i])return;
    const child=this.captures[i]=this.graph.capture(i);
    let carry=Buffer.alloc(0);

    child.stdout.on('data',bytes=>{
      if(this.slots[i]!==original||this.captures[i]!==child)return;
      carry=Buffer.concat([carry,bytes]);
      while(carry.length>=2048){
        const pcm=carry.subarray(0,2048);
        carry=carry.subarray(2048);
        original.meter=pcmLevel(pcm);
        original.levelAt=Date.now();
        if(!this.clients[i].size)continue;
        const packet={generation:original.epoch,rate:24000,data:pcm.toString('base64')};
        for(const r of this.clients[i]){
          if(r.writableLength>262144){r.end();this.clients[i].delete(r);}
          else r.write('data: '+JSON.stringify(packet)+'\n\n');
        }
      }
    });

    const failed=()=>{
      if(this.slots[i]!==original||this.captures[i]!==child)return;
      original.captureFailed=true;
      original.captureError='Audio level capture stopped. Reconnect this side to restart the meters.';
      original.meter=null;
      this.captures[i]=null;
      for(const r of this.clients[i]){
        r.write('event: closed\ndata: {}\n\n');
        r.end();
      }
      this.clients[i].clear();
    };

    child.on('error',failed);
    child.on('exit',failed);
  }

  stopCapture(i){
    const child=this.captures[i];
    this.captures[i]=null;
    child?.kill('SIGTERM');
    const s=this.slots[i];
    if(s){s.meter=null;s.levelAt=0;}
  }

  subscribe(i,res){
    res.writeHead(200,{
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-store',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    });
    res.write(': connected\n\n');
    this.clients[i].add(res);
    this.ensureCapture(i);
    const timer=setInterval(()=>res.write(': ping\n\n'),15000);
    res.on('close',()=>{
      clearInterval(timer);
      this.clients[i].delete(res);
      if(!this.clients[i].size&&!this.slots[i]?.connected)this.stopCapture(i);
    });
  }

  async inspectMicrophone(i,s,phase){
    if(typeof this.graph.inputStatus!=='function')return;
    let device;
    try{device={available:true,...await this.graph.inputStatus(i)};}
    catch{device={available:false};}
    if(this.slots[i]!==s)return;
    s.microphone={phase,...device};
    console.log(JSON.stringify({event:'audio_microphone_diagnostic',slot:i?'B':'A',attemptId:s.epoch,...s.microphone}));
    this.recordAttempt(i,s);
  }

  async captureScreen(i,s,final=false){
    if(this.slots[i]!==s||typeof s.page?.screenshot!=='function')return null;
    if(s.screenPromise){await s.screenPromise;if(!final)return this.screens[i]?.epoch===s.epoch?this.screens[i]:null;}
    if(this.slots[i]!==s)return null;
    if(s.stopped&&!final)return this.screens[i]?.epoch===s.epoch?this.screens[i]:null;
    s.screenPromise=(async()=>{
      try{
        const bytes=await s.page.screenshot({type:'jpeg',quality:65,timeout:2000});
        if(this.slots[i]!==s)return null;
        return this.screens[i]={epoch:s.epoch,bytes,at:Date.now()};
      }catch{return this.screens[i]?.epoch===s.epoch?this.screens[i]:null;}
    })();
    try{return await s.screenPromise;}finally{s.screenPromise=null;}
  }

  async screen(i){
    const s=this.slots[i];if(!s)return null;
    const cached=this.screens[i]?.epoch===s.epoch?this.screens[i]:null;
    if(s.stopped||cached&&Date.now()-cached.at<1500)return cached;
    return this.captureScreen(i,s);
  }

  async stopFailed(i,s){
    if(this.slots[i]!==s||s.stopped)return;
    if(['verification','attention'].includes(s.status))return this.pauseForInput(i,s);
    s.stopped=true;s.connected=false;this.requested=false;this.enabled=false;
    this.recordAttempt(i,s);
    this.stopCapture(i);
    for(const r of this.clients[i]){r.write('event: closed\ndata: {}\n\n');r.end();}
    this.clients[i].clear();
    console.warn(JSON.stringify({event:'audio_session_stopped',slot:i?'B':'A',attemptId:s.epoch,stage:s.stage,status:s.status}));
    if(this.graph.process)await this.graph.routing(false).catch(()=>{});
    await this.inspectMicrophone(i,s,'before-stop');
    await this.captureScreen(i,s,true);
    await this.persistProfile(i,s);
    await s.browser.close().catch(()=>{});
  }

  async pauseForInput(i,s){
    if(this.slots[i]!==s||s.stopped)return;
    const alreadyPaused=s.paused;
    s.paused=true;s.connected=false;this.requested=false;this.enabled=false;
    this.stopCapture(i);
    for(const r of this.clients[i]){r.write('event: closed\ndata: {}\n\n');r.end();}
    this.clients[i].clear();
    if(this.graph.process)await this.graph.routing(false).catch(()=>{});
    this.recordAttempt(i,s);
    if(!alreadyPaused){
      console.warn(JSON.stringify({event:'audio_session_paused',slot:i?'B':'A',attemptId:s.epoch,stage:s.stage,status:s.status}));
      await this.captureScreen(i,s);
      await this.persistProfile(i,s);
    }
  }

  async input(i,input){
    const action=validateNativeInput(input),s=this.slots[i];
    if(!s||s.stopped||s.crashed)throw Error('Audio native browser is closed.');
    if(this.setup||this.ops.has(i))throw Error('Audio session is busy.');
    if(input.epoch!==s.epoch)throw Error('Audio screen changed. Refresh it before interacting.');
    this.ops.add(i);
    try{
      if(new URL(s.page.url()).origin!=='https://nekto-me.kz')throw Error('Audio native browser left Nekto. Close this side.');
      const state=await this.state(s);
      const token=await this.inspectToken(i,s,'before-input');
      this.assertToken(token,s);
      if(state?.status==='blocked'||token?.restricted){
        s.status='blocked';s.error=state?.detail||'Nekto has blocked this session.';
        await this.stopFailed(i,s);
        throw Error('Nekto has blocked this session. Screen controls cannot remove that restriction.');
      }
      if(['verification','attention'].includes(state?.status)){s.status=state.status;s.error=state.detail||'';await this.pauseForInput(i,s);}
      if(this.slots[i]!==s)throw Error('Audio screen changed. Refresh it before interacting.');
      if(action.action==='click'){
        const viewport=s.page.viewportSize();
        if(!viewport)throw Error('Audio screen size is unavailable.');
        await s.page.mouse.click(Math.min(viewport.width-1,action.x*viewport.width),Math.min(viewport.height-1,action.y*viewport.height));
      }else if(action.action==='text')await s.page.keyboard.insertText(action.text);
      else if(action.action==='key')await s.page.keyboard.press(action.key);
      else await s.page.mouse.wheel(0,action.deltaY);
      this.screens[i]=null;
      await this.captureScreen(i,s,true);
      return {ok:true};
    }catch(e){
      if(e.code==='TOKEN_MISMATCH'&&this.slots[i]===s){s.status='error';s.error=this.error(e);await this.stopFailed(i,s);}
      throw e;
    }finally{this.ops.delete(i);}
  }

  async inspect(i){
    const s=this.slots[i];
    if(!s||s.stopped||s.crashed)return {open:false,attempt:this.attempts[i]};
    if(this.setup||this.ops.has(i))throw Error('Audio session is busy.');
    this.ops.add(i);
    try{await this.inspectToken(i,s,'inspect');return {open:true,attempt:this.attempts[i]};}
    finally{this.ops.delete(i);}
  }

  async close(i){
    this.requested=false;
    this.enabled=false;
    if(this.graph.process)await this.graph.routing(false).catch(()=>{});
    const s=this.slots[i];
    this.slots[i]=null;
    this.screens[i]=null;
    this.stopCapture(i);
    for(const r of this.clients[i]){
      r.write('event: closed\ndata: {}\n\n');
      r.end();
    }
    this.clients[i].clear();
    if(s){if(!s.stopped)await this.persistProfile(i,s);await s.browser.close().catch(()=>{});}
  }

  async shutdown(){
    clearInterval(this.timer);
    await this.close(0);
    await this.close(1);
    await this.graph.close();
  }
}

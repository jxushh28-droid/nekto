import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {pcmLevel} from './audio-level.js';
import {AudioGraph} from './audio-graph.js';
import {saveTokens} from './token-config.js';
import {loadAudioTokens,saveAudioTokens} from './audio-token-config.js';
import {confirmVoiceSession,voiceReady} from './voice-session.js';
import {primeVoiceStorage} from './voice-bootstrap.js';

const runtime=await readFile(new URL('./browser/audio-runtime.js',import.meta.url),'utf8');
const site='https://nekto-me.kz/audiochat';

export class AudioHost{
  constructor({data,graph=new AudioGraph(),launch=options=>chromium.launch(options)}){
    this.data=data+'/audio';
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
    this.loaded=mkdir(this.data,{recursive:true}).then(()=>loadAudioTokens(this.data)).then(v=>this.tokens=v);
    this.timer=setInterval(()=>void this.tick(),500);
  }

  hasOpen(){return this.setup||this.ops.size>0||this.slots.some(Boolean);}

  error(e){
    let message=String(e?.message||e);
    for(const token of this.tokens||[])if(token)message=message.split(token).join('[redacted]');
    return /^(Nekto|Enter|Use|Audio|Close)/.test(message)?message.slice(0,200):'Audio operation failed. Disconnect this side and try again.';
  }

  async prepare(i){
    await this.loaded;
    if(!this.tokens[i])throw Error('Enter this side’s voice authToken first.');
    let s=this.slots[i];
    if(s?.prepared)return s;

    if(!s){
      await this.graph.ensure();

      const browser=await this.launch({
        headless:true,
        channel:'chromium',
        ignoreDefaultArgs:['--mute-audio'],
        args:['--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'],
        env:this.graph.browserEnv(i)
      });

      const context=await browser.newContext({
        viewport:{width:420,height:760},
        locale:'ru-RU',
        bypassCSP:true
      });

      await context.grantPermissions(['microphone'],{origin:'https://nekto-me.kz'});

      await context.addInitScript(primeVoiceStorage,this.tokens[i]);
      await context.addInitScript({content:runtime});

      const page=await context.newPage();
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
      socketId,
      event,
      ...details
    }));
  };

  log("created", { url: safeSocketUrl(ws.url()) });

  const logFrame = (direction, { payload }) => {
    const binary = Buffer.isBuffer(payload);
    log(direction, {
      frameSequence: ++frameSequence,
      binary,
      bytes: binary
        ? payload.length
        : Buffer.byteLength(payload, "utf8"),
      payload: redactWsText(
        binary ? payload.toString("utf8") : payload
      )
    });
  };

  ws.on("framesent", frame => logFrame("sent", frame));
  ws.on("framereceived", frame => logFrame("received", frame));
  ws.on("socketerror", error =>
    log("error", { message: redactWsText(error) })
  );
  ws.on("close", () => log("closed"));
});
      s={browser,context,page,status:'loading',connected:false,prepared:false,error:'',epoch:crypto.randomUUID()};
      this.slots[i]=s;

      page.on('dialog',d=>d.dismiss().catch(()=>{}));
      page.on('popup',p=>p.close().catch(()=>{}));
      page.on('crash',()=>{
        s.crashed=true;
        s.connected=false;
        s.status='error';
        s.error='Audio browser ran out of memory. Disconnect unused modes first.';
        void this.graph.routing(false);
        this.enabled=false;
      });

      await page.goto(site,{waitUntil:'domcontentloaded',timeout:45000});
    }

    let bootstrap=await s.page.evaluate(()=>window.__voiceTokenBootstrap||{ok:false,reason:'bootstrap-not-run'});

    // Fallback: if the init script was blocked or didn't run, write the token
    // directly via evaluate before the app finishes hydrating.
    if(!bootstrap.ok){
      await s.page.evaluate(({token,key})=>{
        try{
          const saved=JSON.parse(localStorage.getItem(key)||'{}')||{};
          if(typeof saved!=='object'||Array.isArray(saved))return;
          saved.user=(saved.user&&typeof saved.user==='object'&&!Array.isArray(saved.user))?saved.user:{};
          saved.user.authToken=token;
          localStorage.setItem(key,JSON.stringify(saved));
          const matches=JSON.parse(localStorage.getItem(key))?.user?.authToken===token;
          window.__voiceTokenBootstrap={ok:matches,reason:matches?'evaluate-fallback':'fallback-mismatch'};
        }catch{
          window.__voiceTokenBootstrap={ok:false,reason:'evaluate-fallback-failed'};
        }
      },{token:this.tokens[i],key:'storage_audio_v2'});
      bootstrap=await s.page.evaluate(()=>window.__voiceTokenBootstrap||{ok:false,reason:'bootstrap-not-run'});
    }

    console.log(JSON.stringify({event:'audio_token_bootstrap',slot:i?'B':'A',...bootstrap}));
    if(!bootstrap.ok)throw Error('Nekto voice token could not be saved before startup: '+bootstrap.reason);

    await s.page.waitForFunction(voiceReady,null,{timeout:20000});
    const registrationDiagnostic = await page.evaluate(() => {
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
    registrationError: system.errorRegistered ?? null,
    disconnectReason: system.forceDisconnectReason ?? null,
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

console.log(
  redactWsText(JSON.stringify(registrationDiagnostic, null, 2))
);
    const result=await s.page.evaluate(confirmVoiceSession,{token:this.tokens[i]});
    s.authorization=result.diagnostics;

    const trace=await s.page.evaluate(()=>window.__audioHost?.diagnostics?.()||[]);
    this.recordDiagnostics(i,s,trace);

    console.log(JSON.stringify({event:'audio_session_confirmation',slot:i?'B':'A',ok:result.ok,reason:result.reason,...result.diagnostics}));
    if(!result.ok){
      throw Error(
        result.reason==='verification-required'
          ?'Nekto requires verification for this voice session.'
          :result.diagnostics?.registrationError
            ?'Nekto rejected voice registration (code '+result.diagnostics.registrationError+').'
            :'Nekto did not confirm this voice session: '+result.reason
      );
    }

    s.prepared=true;
    s.status='ready';
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

  async start(i){
    if(this.ops.has(i)||this.setup)throw Error('Audio session is busy.');
    this.ops.add(i);
    if(this.slots[i])this.slots[i].operationError='';
    try{
      const s=await this.prepare(i);
      for(let n=0,clicked=false;n<30;n++){
        const state=await this.state(s);
        if(state?.status==='verification'||state?.status==='blocked')throw Error(state.detail||'Nekto refused this voice session.');
        if(state?.connected||state?.status==='searching'){
          Object.assign(s,{connected:state.connected,status:state.status,error:''});
          return;
        }
        if(!clicked&&await s.page.locator('#searchCompanyBtn').isVisible()){
          const cookies=s.page.locator('#acceptCookies');
          if(await cookies.isVisible()&&await cookies.isEnabled())await cookies.click({timeout:800}).catch(()=>{});
          await s.page.locator('#searchCompanyBtn').click({timeout:5000});
          clicked=true;
        }
        await new Promise(r=>setTimeout(r,500));
      }
      throw Error('Nekto did not confirm starting the voice search.');
    }catch(e){
      if(this.slots[i]){
        this.slots[i].error=this.error(e);
        this.slots[i].operationError=this.error(e);
        this.slots[i].status='error';
        this.slots[i].connected=false;
      }
      throw Error(this.error(e));
    }finally{
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

  async applySingle(i,token){
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
      await this.start(i);
      return {ok:true,results:[{slot:i,ok:true}]};
    }catch(e){
      return {ok:false,results:[{slot:i,ok:false,error:this.error(e)}]};
    }
  }

  async connectBoth(){
    const results=await Promise.all([0,1].map(async slot=>{
      try{await this.start(slot);return {slot,ok:true};}
      catch(e){return {slot,ok:false,error:this.error(e)};}
    }));
    return {ok:results.every(x=>x.ok),results};
  }

  recordDiagnostics(i,s,entries=[]){
    for(const entry of entries){
      if(entry.seq<=(s.lastDiagnostic||0))continue;
      s.lastDiagnostic=entry.seq;
      console.log(JSON.stringify({event:'audio_native_state',slot:i?'B':'A',...entry}));
    }
    s.diagnostics=entries.slice(-24);
  }

  async tick(){
    if(this.polling||this.setup)return;
    this.polling=true;
    try{
      for(let i=0;i<2;i++){
        const s=this.slots[i];
        if(!s||this.ops.has(i)||s.crashed)continue;
        try{
          const state=await this.state(s);
          if(!state)continue;
          this.recordDiagnostics(i,s,state.diagnostics);
          if(state.ended){await this.close(i);continue;}
          if(state.status==='verification'&&!s.authorization?.captcha&&!s.authorization?.hcaptcha&&s.authorization?.authenticated)
            state.detail='Nekto потребовал проверку после авторизации. Токен был применён; повторное применение не выполняется.';
          if(s.operationError&&!state.connected&&!['verification','blocked'].includes(state.status)){
            state.status='error';
            state.detail=s.operationError;
          }
          if(s.status!==state.status)
            console.log(JSON.stringify({event:'audio_session_status',slot:i?'B':'A',status:state.status,authenticated:state.authenticated,socketConnected:state.socketConnected}));
          Object.assign(s,{status:state.status,connected:state.connected,error:state.detail||''});
        }catch(e){
          s.status='error';
          s.connected=false;
          s.error=this.error(e);
        }
      }

      for(let i=0;i<2;i++){
        const s=this.slots[i];
        if(!s)continue;
        if(s.connected||this.clients[i].size)this.ensureCapture(i);
        else this.stopCapture(i);
      }

      const enabled=!!this.graph.process&&this.requested&&this.slots.every(s=>s?.connected&&!s.crashed);
      if(this.graph.process)await this.graph.routing(enabled);
      this.enabled=enabled;
    }catch{
      this.enabled=false;
      this.requested=false;
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
        open:!!s,
        status:s?.status||'closed',
        connected:!!s?.connected,
        busy:this.setup||this.ops.has(i),
        error:s?.error||s?.captureError||'',
        authorization:s?.authorization||null,
        diagnostics:s?.diagnostics||[],
        level:s?.connected&&Date.now()-(s.levelAt||0)<500?s?.meter?.level||0:0,
        db:s?.connected&&Date.now()-(s.levelAt||0)<500?s?.meter?.db??-60:-60
      }))
    };
  }

  ensureCapture(i){
    const original=this.slots[i];
    if(!original||original.crashed||original.captureFailed||this.captures[i])return;
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

  async close(i){
    this.requested=false;
    this.enabled=false;
    if(this.graph.process)await this.graph.routing(false).catch(()=>{});
    const s=this.slots[i];
    this.slots[i]=null;
    this.stopCapture(i);
    for(const r of this.clients[i]){
      r.write('event: closed\ndata: {}\n\n');
      r.end();
    }
    this.clients[i].clear();
    if(s)await s.browser.close().catch(()=>{});
  }

  async shutdown(){
    clearInterval(this.timer);
    await this.close(0);
    await this.close(1);
    await this.graph.close();
  }
}

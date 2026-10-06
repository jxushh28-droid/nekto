import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {chromium} from 'playwright';
import {Relay,labels} from './relay.js';
import {withToken,validateTokens} from './session.js';
import {Transcript} from './transcript.js';
import {startConversation} from './connection.js';
import {prepareTextSession} from './prepare-session.js';
import {loadTokens,saveTokens} from './token-config.js';
import {VideoHost} from './video-host.js';
import {closeSession} from './session-lifecycle.js';
import {textSessionDiagnostics} from './diagnostics.js';
const password=process.env.DASHBOARD_PASSWORD;
if(!password||password.length<16)throw new Error('Set DASHBOARD_PASSWORD (at least 16 characters)');
const relay=new Relay(),slots=Array(2).fill(null),locks=Array(2).fill(null),sessions=new Set();
let configuredTokens=[null,null],tokenSetup=false;
const tokenStatus=[false,false],transcripts=[new Transcript(),new Transcript()];
relay.toggle(true);
const safeError=e=>{let text=String(e?.message||e);for(const token of configuredTokens)if(token)text=text.split(token).join('[redacted]');return text.slice(0,180);};
const data=process.env.TEXT_DATA_DIR||'/data/text-host';await mkdir(data,{recursive:true});configuredTokens=await loadTokens(data);
let browser=null,launching=null,videoBrowser=null,videoLaunching=null;
async function getVideoBrowser(){if(videoBrowser?.isConnected())return videoBrowser;if(!videoLaunching)videoLaunching=chromium.launch({headless:true,args:['--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream']}).then(b=>{videoBrowser=b;return b;}).finally(()=>videoLaunching=null);return videoLaunching;}
const video=new VideoHost({getBrowser:getVideoBrowser,data}),videoOps=new Set();
const injection=await readFile(new URL('./browser/adapter.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('./browser/runtime.js',import.meta.url),'utf8');
const site='https://nekto-me.kz/chat/';
async function getBrowser(){if(browser?.isConnected())return browser;if(!launching)launching=chromium.launch({headless:true,args:['--disable-dev-shm-usage']}).then(b=>{browser=b;return b;}).finally(()=>launching=null);return launching;}
async function open(i){
 if(slots[i])return;const b=await getBrowser();let saved;try{saved=JSON.parse(await readFile(data+'/slot-'+i+'.json','utf8'));}catch{}
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
const failures=new Map();
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/health')return json(res,200,{ok:true,service:'nekto-text-host'});
 if(req.method==='GET'&&['/','/app.js','/style.css','/video','/video.js','/video.css','/stream-player.js','/video-fixture'].includes(url.pathname)){
  if(url.pathname==='/video-fixture'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><body>Generated media test</body>');}
  const name=url.pathname==='/'?'index.html':url.pathname==='/video'?'video.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(new URL((name==='stream-player.js'?'./browser/':'./public/')+name,import.meta.url)));}
 if(req.method==='POST'){
  const origin=req.headers.origin;if(origin&&origin!== 'https://'+req.headers.host&&origin!=='http://'+req.headers.host)return json(res,403,{error:'Invalid origin'});
 }
 if(url.pathname==='/api/login'&&req.method==='POST'){
  const ip=req.socket.remoteAddress,record=failures.get(ip)||{count:0,at:Date.now()};if(Date.now()-record.at>600000){record.count=0;record.at=Date.now();}if(record.count>=15)return json(res,429,{error:'Too many attempts. Wait 10 minutes.'});
  const b=await body(req),a=Buffer.from(String(b.password||'')),p=Buffer.from(password);if(a.length!==p.length||!timingSafeEqual(a,p)){record.count++;failures.set(ip,record);return json(res,401,{error:'Incorrect password'});}
  const token=crypto.randomUUID();sessions.add(token);setTimeout(()=>sessions.delete(token),86400000).unref();res.setHeader('Set-Cookie','session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'+(process.env.NODE_ENV==='production'?'; Secure':''));return json(res,200,{ok:true});
 }
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(!sessions.has(token))return json(res,401,{error:'Sign in first'});
 if(url.pathname==='/api/video/status'&&req.method==='GET')return json(res,200,video.status());
 if(url.pathname==='/api/video/sessions'&&req.method==='GET'){await video.sessionsLoaded;return json(res,200,{sessions:video.sessions});}
 if(url.pathname==='/api/video/diagnostics'&&req.method==='GET')return json(res,200,await video.inspect());
 if(url.pathname==='/api/video/validate'&&req.method==='POST'){if(videoOps.size||video.slots.some(s=>s?.busy)||video.sessionSetup)return json(res,409,{error:'Video session is busy'});return json(res,200,await video.validateSessions());}
 if(url.pathname==='/api/video/sessions'&&req.method==='POST'){if(videoOps.size||video.slots.some(s=>s?.busy)||video.sessionSetup)return json(res,409,{error:'Video session is busy'});const b=await body(req,80000);try{return json(res,200,await video.applySessions(b.sessions));}catch(e){return json(res,400,{error:/^(Paste the complete|OmeTV session requires|Provide two|Use two|Video session setup)/.test(e.message)?e.message:'Could not save the OmeTV sessions.'});}}
 if(url.pathname==='/api/video/toggle'&&req.method==='POST'){const b=await body(req);await video.toggle(!!b.enabled,!!b.consent);return json(res,200,{ok:true});}
 if(url.pathname==='/api/video/test'&&req.method==='POST')return json(res,200,await video.test(Number(process.env.PORT||3000)));
 const videoMatch=url.pathname.match(/^\/api\/video\/([01])\/(start|close|send|stream)$/);
 if(videoMatch){const i=Number(videoMatch[1]),operation=videoMatch[2];if(operation==='stream'&&req.method==='GET')return video.subscribe(i,res);if(req.method!=='POST')return json(res,405,{error:'POST required'});const b=await body(req);if(video.sessionSetup||video.slots[i]?.busy||videoOps.has(i))return json(res,409,{error:'Video session is busy'});videoOps.add(i);try{if(operation==='start')await video.start(i);else if(operation==='close')await video.close(i);else if(operation==='send')await video.send(i,b.text);else return json(res,404,{error:'Unknown video operation'});return json(res,200,{ok:true});}catch(e){const allowed=/^(OmeTV has restricted|OmeTV could not|OmeTV session failed|Paste this side|OmeTV client|Could not apply|OmeTV requires|Sign in to|The video bridge|Connect this participant|Write a message|OmeTV did not|Open this video|Invalid browser|Could not open)/.test(e.message);return json(res,400,{error:allowed?e.message:'Hosted video operation failed. Check your OmeTV session and try again.'});}finally{videoOps.delete(i);}}
 if(url.pathname==='/api/status')return json(res,200,{enabled:relay.enabled,tokenSetup,slots:relay.members.map((m,i)=>({...m,queue:m.queue.length,label:labels[i],open:!!slots[i],busy:!!locks[i]||!!slots[i]?.opening,opening:!!slots[i]?.opening,tokenImported:tokenStatus[i],verification:slots[i]?.verification||null,status:slots[i]?.status||'closed',detail:slots[i]?.detail||'',messages:transcripts[i].items}))});
 if(url.pathname==='/api/tokens'&&req.method==='POST'){
  if(tokenSetup||locks.some(Boolean)||slots.some(s=>s?.opening))return json(res,409,{error:'Wait for the current session operation to finish.'});
  const values=validateTokens((await body(req)).tokens);tokenSetup=true;relay.toggle(false);
  try{for(let i=0;i<2;i++){locks[i]=true;const s=slots[i];if(s)while(s.busy)await new Promise(r=>setTimeout(r,50));relay.update(i,{connected:false,epoch:null});transcripts[i].reset(null);tokenStatus[i]=false;if(s)s.preparedToken=null;}
   configuredTokens=await saveTokens(data,values);relay.toggle(true);const results=[];for(let i=0;i<2;i++){try{await connect(i);results.push({slot:i,ok:true,tokenImported:tokenStatus[i]});}catch(e){const error=operationError(i,e);results.push({slot:i,ok:false,error,tokenImported:tokenStatus[i]});}}
   return json(res,200,{ok:results.every(r=>r.ok),results});
  }finally{locks.fill(null);tokenSetup=false;}
 }
 if(url.pathname==='/api/toggle'&&req.method==='POST'){relay.toggle(!!(await body(req)).enabled);return json(res,200,{ok:true});}
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
async function shutdown(){relay.toggle(false);await video.shutdown();await videoBrowser?.close().catch(()=>{});for(const s of slots)if(s)await s.context.close().catch(()=>{});await browser?.close().catch(()=>{});server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

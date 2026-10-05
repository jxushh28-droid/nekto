import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {chromium} from 'playwright';
import {Relay,labels} from './relay.js';
import {withToken,validateTokens} from './session.js';
const password=process.env.DASHBOARD_PASSWORD;
if(!password||password.length<16)throw new Error('Set DASHBOARD_PASSWORD (at least 16 characters)');
const relay=new Relay(),slots=Array(2).fill(null),locks=Array(2).fill(null),sessions=new Set();
let configuredTokens=[null,null],tokenSetup=false;
const tokenStatus=[false,false];
const safeError=e=>{let text=String(e?.message||e);for(const token of configuredTokens)if(token)text=text.split(token).join('[redacted]');return text.slice(0,180);};
const data=process.env.TEXT_DATA_DIR||'/data/text-host';await mkdir(data,{recursive:true});
let browser=null,launching=null;
const injection=await readFile(new URL('./browser/adapter.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('./browser/runtime.js',import.meta.url),'utf8');
const site='https://nekto-me.kz/chat/';
async function getBrowser(){if(browser?.isConnected())return browser;if(!launching)launching=chromium.launch({headless:true,args:['--disable-dev-shm-usage']}).then(b=>{browser=b;return b;}).finally(()=>launching=null);return launching;}
async function open(i){
 if(slots[i])return;const b=await getBrowser();let saved;try{saved=JSON.parse(await readFile(data+'/slot-'+i+'.json','utf8'));}catch{}
 const token=configuredTokens[i];
 if(token){
  let imported=withToken(saved,token);
  if(!imported.count){
   const probe=await b.newContext({viewport:{width:420,height:760},locale:'ru-RU'});
   try{const probePage=await probe.newPage();await probePage.goto(site,{waitUntil:'domcontentloaded',timeout:45000});
    for(let tries=0;tries<15;tries++){saved=await probe.storageState();imported=withToken(saved,token);if(imported.count)break;await new Promise(r=>setTimeout(r,1000));}
   }finally{await probe.close();}
  }
  if(!imported.count)throw new Error('Text chat did not expose a supported authToken field. Complete the initial site setup on Screen and try again.');
  saved=imported.state;tokenStatus[i]=true;
 }
 const context=await b.newContext({viewport:{width:420,height:760},locale:'ru-RU',storageState:saved});
 await context.addInitScript({content:injection});const page=await context.newPage();
 const slot={page,context,busy:false,lastSend:0,opening:true,saveAt:0};slots[i]=slot;
 page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));page.on('popup',p=>p.close().catch(()=>{}));
 page.on('crash',()=>{relay.members[i].error='Browser page crashed. Close and reopen this session.';relay.update(i,{connected:false,epoch:null});});
 try{await page.goto(site,{waitUntil:'domcontentloaded',timeout:45000});}catch(e){relay.members[i].error=safeError(e);}finally{slot.opening=false;}
}
async function tick(i){const s=slots[i];if(!s||s.busy||s.opening||locks[i])return;s.busy=true;
 try{
  if(!new URL(s.page.url()).hostname.match(/(^|\.)nekto-me\.kz$/)){relay.update(i,{connected:false,epoch:null});return;}
  const state=await s.page.evaluate(()=>window.__textHost?.poll());if(!state)return;relay.update(i,state);
  const m=relay.members[i];for(const msg of state.messages)relay.incoming(i,msg.text);
  while(m.queue.length&&!relay.valid(i,m.queue[0]))m.queue.shift();
  if(m.queue.length&&Date.now()-s.lastSend>=1100){const item=m.queue[0];
   const result=await s.page.evaluate(({text,epoch})=>window.__textHost.send(text,epoch),{text:item.text,epoch:item.targetEpoch});
   if(result==='submitted'){s.lastSend=Date.now();m.queue.shift();let cleared=false;for(let n=0;n<10;n++){await new Promise(r=>setTimeout(r,100));cleared=await s.page.evaluate(()=>window.__textHost.cleared());if(cleared)break;}if(cleared){m.sent++;m.error='';}else{m.error='Send was not confirmed. Clear the message field to continue.';}}
   else if(result==='draft'||result==='wait')m.error='Waiting: send or clear the draft in this chat.';
   else{m.queue.shift();m.error='Delivery stopped: '+result;}
  }
  if(Date.now()-s.saveAt>60000){s.saveAt=Date.now();await s.context.storageState({path:data+'/slot-'+i+'.json'});}
 }catch(e){relay.members[i].error=safeError(e);relay.update(i,{connected:false,epoch:null});}finally{s.busy=false;}
}
setInterval(()=>{for(let i=0;i<2;i++)void tick(i);},700);
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>12000)throw new Error('Request too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const failures=new Map();
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/health')return json(res,200,{ok:true,service:'nekto-text-host'});
 if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(new URL('./public/'+name,import.meta.url)));}
 if(req.method==='POST'){
  const origin=req.headers.origin;if(origin&&origin!== 'https://'+req.headers.host&&origin!=='http://'+req.headers.host)return json(res,403,{error:'Invalid origin'});
 }
 if(url.pathname==='/api/login'&&req.method==='POST'){
  const ip=req.socket.remoteAddress,record=failures.get(ip)||{count:0,at:Date.now()};if(Date.now()-record.at>600000){record.count=0;record.at=Date.now();}if(record.count>=15)return json(res,429,{error:'Too many attempts. Wait 10 minutes.'});
  const b=await body(req),a=Buffer.from(String(b.password||'')),p=Buffer.from(password);if(a.length!==p.length||!timingSafeEqual(a,p)){record.count++;failures.set(ip,record);return json(res,401,{error:'Incorrect password'});}
  const token=crypto.randomUUID();sessions.add(token);setTimeout(()=>sessions.delete(token),86400000).unref();res.setHeader('Set-Cookie','session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'+(process.env.NODE_ENV==='production'?'; Secure':''));return json(res,200,{ok:true});
 }
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(!sessions.has(token))return json(res,401,{error:'Sign in first'});
 if(url.pathname==='/api/status')return json(res,200,{enabled:relay.enabled,slots:relay.members.map((m,i)=>({...m,queue:m.queue.length,label:labels[i],open:!!slots[i],opening:!!slots[i]?.opening,tokenImported:tokenStatus[i]}))});
 if(url.pathname==='/api/tokens'&&req.method==='POST'){
  if(tokenSetup||locks.some(Boolean)||slots.some(s=>s?.opening))return json(res,409,{error:'Wait for the current session operation to finish.'});
  const values=validateTokens((await body(req)).tokens);tokenSetup=true;relay.toggle(false);
  try{for(let i=0;i<2;i++){locks[i]=true;const s=slots[i];if(s){while(s.busy)await new Promise(r=>setTimeout(r,50));await s.context.close();slots[i]=null;}relay.update(i,{connected:false,epoch:null});tokenStatus[i]=false;}
   configuredTokens=values;const results=[];for(let i=0;i<2;i++){try{await open(i);results.push({slot:i,ok:true,tokenImported:tokenStatus[i]});}catch(e){const error=safeError(e);configuredTokens[i]=null;tokenStatus[i]=false;results.push({slot:i,ok:false,error});}}
   return json(res,200,{ok:results.every(r=>r.ok),results});
  }finally{locks.fill(null);tokenSetup=false;}
 }
 if(url.pathname==='/api/toggle'&&req.method==='POST'){relay.toggle(!!(await body(req)).enabled);return json(res,200,{ok:true});}
 const match=url.pathname.match(/^\/api\/slot\/([01])\/(open|close|screen|action)$/);if(!match)return json(res,404,{error:'Not found'});
 const i=Number(match[1]),operation=match[2];if(operation==='screen'&&req.method==='GET'){
  if(!slots[i])return json(res,409,{error:'Open session first'});const image=await slots[i].page.screenshot({type:'jpeg',quality:65,timeout:10000});res.setHeader('Content-Type','image/jpeg');return res.end(image);}
 if(req.method!=='POST')return json(res,405,{error:'POST required'});if(tokenSetup||locks[i])return json(res,409,{error:'Session is busy'});
 locks[i]=true;try{
  if(operation==='open')await open(i);
  else if(operation==='close'){const s=slots[i];slots[i]=null;relay.update(i,{connected:false,epoch:null});if(s){await s.context.storageState({path:data+'/slot-'+i+'.json'});await s.context.close();}}
  else{const s=slots[i];if(!s)throw new Error('Open session first');const b=await body(req);if(b.type==='click'){if(!Number.isFinite(b.x)||!Number.isFinite(b.y)||b.x<0||b.x>420||b.y<0||b.y>760)throw new Error('Invalid coordinates');await s.page.mouse.click(b.x,b.y);}else if(b.type==='type'){await s.page.keyboard.insertText(String(b.text||'').slice(0,4000));}else if(b.type==='key'&&['Enter','Backspace','Tab','Escape'].includes(b.key))await s.page.keyboard.press(b.key);else if(b.type==='scroll')await s.page.mouse.wheel(0,Math.max(-700,Math.min(700,Number(b.delta)||0)));else if(b.type==='reload'){relay.update(i,{connected:false,epoch:null});await s.page.goto(site,{waitUntil:'domcontentloaded',timeout:45000});}else throw new Error('Unknown action');}
  return json(res,200,{ok:true});
 }finally{locks[i]=null;}
 }catch(e){json(res,400,{error:safeError(e)});}});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Nekto text dashboard ready'));
async function shutdown(){relay.toggle(false);for(const s of slots)if(s)await s.context.close().catch(()=>{});await browser?.close().catch(()=>{});server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

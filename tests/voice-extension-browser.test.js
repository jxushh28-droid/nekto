import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {primeVoiceStorage} from '../voice-bootstrap.js';
import {AudioHost} from '../audio-host.js';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';

// Exact storage operation from the uploaded prime extension, with a fixture
// credential. Every web request is fulfilled locally; no Nekto connection.
const prime=`(() => {
 const TOKEN = "fixture-voice-token";
 const KEY = "storage_audio_v2";
 const write = () => {
  try {
   const saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
   if (saved?.user?.authToken === TOKEN) return true;
   saved.user = saved.user || {};
   saved.user.authToken = TOKEN;
   localStorage.setItem(KEY, JSON.stringify(saved));
   return true;
  } catch { return false; }
 };
 if (!write()) document.addEventListener("readystatechange", write, { once: true });
})();`;

test('actual MV3 isolated-world extension and init script seed identical first-script state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'voice-extension-'));
 const extension=join(directory,'extension');await mkdir(extension);
 await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Voice storage fixture',version:'1.0',content_scripts:[{matches:['https://nekto-me.kz/*'],js:['prime.js'],run_at:'document_start',all_frames:true}],host_permissions:['https://nekto-me.kz/*']}));
 await writeFile(join(extension,'prime.js'),prime);
 const results=[];let context;
 try{
  for(const useExtension of [true,false]){
   context=await chromium.launchPersistentContext(join(directory,useExtension?'extension-profile':'init-profile'),{channel:'chromium',headless:true,args:useExtension?['--disable-extensions-except='+extension,'--load-extension='+extension]:[]});
   if(!useExtension)await context.addInitScript(primeVoiceStorage,'fixture-voice-token');
   await context.route('**/*',route=>{const iframe=new URL(route.request().url()).pathname==='/audiochat'?'<iframe src="/frame"></iframe>':'';return route.fulfill({contentType:'text/html',body:'<!doctype html><script>window.firstScriptState=JSON.parse(localStorage.getItem("storage_audio_v2")||"{}");</script>'+iframe});});
   const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
   assert.equal(page.frames().length,2);
   for(const frame of page.frames())assert.equal(await frame.evaluate(()=>window.firstScriptState.user.authToken),'fixture-voice-token');
   await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('storage_audio_v2'));saved.user.volume=37;saved.chat={lastStartDialogTime:123};localStorage.setItem('storage_audio_v2',JSON.stringify(saved));});
   await page.reload();results.push(await page.evaluate(()=>window.firstScriptState));
   await context.close();context=null;
  }
  assert.deepEqual(results[0],results[1]);
  assert.deepEqual(results[0],{user:{authToken:'fixture-voice-token',volume:37},chat:{lastStartDialogTime:123}});
 }finally{await context?.close();await rm(directory,{recursive:true,force:true});}
});
test('AudioHost seeds each actual Chromium context before its first page and iframe script',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'voice-context-'));
 const sockets=new Set(),server=createServer();
 server.on('upgrade',(request,socket)=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  let buffered=Buffer.alloc(0);
  socket.on('data',chunk=>{
   buffered=Buffer.concat([buffered,chunk]);
   while(buffered.length>=2){
    const opcode=buffered[0]&15,masked=!!(buffered[1]&128);let length=buffered[1]&127,offset=2;
    if(length===127){socket.destroy();return;}
    if(length===126){if(buffered.length<4)return;length=buffered.readUInt16BE(2);offset=4;}
    if(buffered.length<offset+(masked?4:0)+length)return;
    const mask=masked?buffered.subarray(offset,offset+4):null;offset+=masked?4:0;
    const payload=Buffer.from(buffered.subarray(offset,offset+length));buffered=buffered.subarray(offset+length);
    if(mask)for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
    if(opcode===8){socket.end(Buffer.from([0x88,0]));return;}
    if(opcode!==1)continue;
    const packet=JSON.parse(payload.toString().slice(2));
    if(packet[0]!=='event'||packet[1]?.type!=='register')continue;
    const reply=Buffer.from('42["event",{"type":"registered","success":true}]');socket.write(Buffer.concat([Buffer.from([0x81,reply.length]),reply]));
   }
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const browsers=[];
 const host=new AudioHost({data:directory,graph:{ensure:async()=>{},browserEnv:()=>({...process.env}),close:async()=>{}},launch:async options=>{
  const browser=await chromium.launch({...options,args:[...options.args,'--allow-running-insecure-content','--host-resolver-rules=MAP audio.nekto-me.kz 127.0.0.1']});browsers.push(browser);
  const createContext=browser.newContext.bind(browser);
  browser.newContext=async config=>{
   const context=await createContext(config);
   await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><script>window.firstScriptToken=JSON.parse(localStorage.getItem('storage_audio_v2')||'{}')?.user?.authToken;</script><div id="app"></div><button id="searchCompanyBtn">Start</button><script>const state={user:{authToken:window.firstScriptToken,tokenId:null},system:{isAuth:false,socketConnected:false},chat:{}};document.getElementById('app').__vue__={$store:{state}};document.getElementById('searchCompanyBtn').onclick=()=>{window.startToken=state.user.authToken;state.user.isSearching=true;};if(window===top){const socket=new WebSocket('ws://audio.nekto-me.kz:${port}/websocket/');socket.onopen=()=>{state.system.socketConnected=true;socket.send('42'+JSON.stringify(['event',{type:'register',userId:state.user.authToken}]));};socket.onmessage=()=>{state.user.tokenId=123;state.system.isAuth=true;};}</script>`+(new URL(route.request().url()).pathname==='/audiochat'?'<iframe src="/frame"></iframe>':'')}));
   return context;
  };
  return browser;
 }});
 clearInterval(host.timer);
 try{
  await host.loaded;host.tokens=['fixture-token-A','fixture-token-B'];
  for(const side of [0,1]){
   const slot=await host.prepare(side);
   assert.equal(slot.context.browser(),browsers[side]);assert.equal(slot.page.context(),slot.context);
   assert.equal(slot.bootstrap.phase,'document-start');assert.equal(slot.authorization.liveTokenMatches,true);
   assert.equal(slot.wire.sentTokenMatches,true);assert.equal(slot.wire.registrationSucceeded,true);
   await slot.page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow?.firstScriptToken===window.firstScriptToken);
   for(const frame of slot.page.frames())assert.equal(await frame.evaluate(()=>window.firstScriptToken),host.tokens[side]);
  }
  assert.notEqual(host.slots[0].context,host.slots[1].context);
  await Promise.all([host.start(0),host.start(1)]);
  for(const side of [0,1]){
   const slot=host.slots[side];assert.equal(await slot.page.evaluate(()=>window.startToken),host.tokens[side]);
   assert.equal(slot.callToken.before.savedTokenMatches,true);assert.equal(slot.callToken.before.liveTokenMatches,true);
   assert.equal(slot.callToken.after.savedTokenMatches,true);assert.equal(slot.callToken.after.liveTokenMatches,true);
   assert.equal(slot.wire.sentTokenMatches,true);assert.equal(slot.wire.registrationSucceeded,true);
  }
 }finally{await host.shutdown();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {VideoHost} from '../video-host.js';
test('real Chromium follows replaced iframe and clicks the native container when Start text rejects pointer events',async()=>{
 const data=await mkdtemp(join(tmpdir(),'video-frame-')),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const host=new VideoHost({data,getBrowser:async()=>({newContext:async options=>{
  const context=await browser.newContext(options);
  await context.route('https://ometv.chat/**',async route=>{
   const embed=new URL(route.request().url()).pathname==='/embed/index.html';
   const html=embed?`<!doctype html><body><video id="local-video"></video><input id="chat-text"><div class="btn btn-main" id="start" style="width:148px;height:157px;display:flex;align-items:center;justify-content:center"><div class="btn__bg" style="pointer-events:none"><span data-tr="start">Start</span></div></div><script>
    window.__videoHost={status:()=>({mediaReady:true,login:false,verification:false,connected:false})};
    window.addEventListener('message',e=>{if(e.data?.source==='sn')parent.postMessage({replace:true},'https://ometv.chat')});
    document.getElementById('start').onclick=()=>parent.postMessage({started:true},'https://ometv.chat');
   </script>`:`<!doctype html><body><iframe id="videochat" src="/embed/index.html"></iframe><script>
    window.fixtureApplies=0;window.fixtureStarted=0;
    window.addEventListener('message',e=>{
     if(e.data?.replace){window.fixtureApplies++;const old=document.getElementById('videochat');const fresh=document.createElement('iframe');fresh.id='videochat';fresh.src='/embed/index.html';old.replaceWith(fresh);}
     if(e.data?.started)window.fixtureStarted++;
    });
   </script>`;
   await route.fulfill({contentType:'text/html',body:html});
  });
  return context;
 }})});
 try{
  await host.sessionsLoaded;host.sessions[0]={token:'fixture-token',SnDataStr:'fixture-signed-data',SnHmac:'fixture-signature'};
  await host.open(0);await host.currentClient(host.slots[0]);
  await assert.rejects(host.slots[0].page.frameLocator('iframe#videochat').getByText('Start',{exact:true}).click({trial:true,timeout:500}),/Timeout/);
  await host.start(0);
  await host.slots[0].page.waitForFunction(()=>window.fixtureStarted===1,{},{timeout:5000});
  const result=await host.slots[0].page.evaluate(()=>({applications:window.fixtureApplies,starts:window.fixtureStarted}));
  assert.deepEqual(result,{applications:2,starts:1});
 }finally{await host.shutdown();await browser.close();await rm(data,{recursive:true,force:true});}
});
test('runtime detects ICE connections with streamless incoming tracks',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream']});
 const context=await browser.newContext();
 const {readFile}=await import('node:fs/promises');
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://ometv.chat/**',route=>route.fulfill({contentType:'text/html',body:'<video id="local-video"></video><video id="remote-video"></video><input id="chat-text">'}));
  const page=await context.newPage();await page.goto('https://ometv.chat/embed/index.html');
  const result=await page.evaluate(async()=>{
   const devices=await navigator.mediaDevices.enumerateDevices();
   const peer=new RTCPeerConnection();Object.defineProperty(peer,'iceConnectionState',{value:'connected',configurable:true});
   const canvas=document.createElement('canvas'),track=canvas.captureStream(15).getVideoTracks()[0],event=new Event('track');Object.defineProperties(event,{track:{value:track},streams:{value:[]}});peer.dispatchEvent(event);
   const status=window.__videoHost.status();window.__videoHost.dispose();peer.close();track.stop();return {connected:status.connected,tracks:status.remoteTracks,camera:devices.some(d=>d.kind==='videoinput')};
  });
  assert.equal(result.connected,true);assert.equal(result.camera,true);assert.deepEqual(result.tracks,[{kind:'video',state:'live'}]);
 }finally{await context.close();await browser.close();}
});
test('dashboard restores saved sessions and retains edited values after Apply',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();let imports=0,loads=0;
 const saved=[{token:'saved-A',SnDataStr:'data-A',SnHmac:'hmac-A'},{token:'saved-B',SnDataStr:'data-B',SnHmac:'hmac-B'}];
 try{
  await page.route('https://dashboard.test/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path==='/api/video/status')return route.fulfill({json:{slots:[0,1].map(i=>({label:i===0?'A':'B',open:false,status:'closed',connected:false,busy:false})),sessionConfigured:[true,true]}});
   if(path==='/api/video/sessions'){if(req.method()==='GET'){loads++;return route.fulfill({json:{sessions:saved}});}imports++;assert.deepEqual(req.postDataJSON().sessions,[JSON.stringify(saved[0]),'edited-B']);return route.fulfill({json:{ok:false,results:[{slot:0,ok:false,error:'fixture refusal'}]}});}
   const file=path==='/video'?'../public/video.html':path==='/video.js'?'../public/video.js':path==='/stream-player.js'?'../browser/stream-player.js':null;
   return route.fulfill({contentType:path.endsWith('.js')?'application/javascript':'text/html',body:file?await readFile(new URL(file,import.meta.url),'utf8'):''});
  });
  await page.goto('https://dashboard.test/video');await page.waitForFunction(()=>document.getElementById('sessionB').value.includes('saved-B'));
  await page.locator('#sessionB').fill('edited-B');await page.locator('#applySessions').click();await page.waitForFunction(()=>document.getElementById('error').textContent.includes('fixture refusal'));
  assert.equal(await page.locator('#sessionB').inputValue(),'edited-B');assert.equal(await page.locator('#sessionA').inputValue(),JSON.stringify(saved[0]));assert.equal(imports,1);assert.equal(loads,1);
  await page.reload();await page.waitForFunction(()=>document.getElementById('sessionB').value.includes('saved-B'));assert.equal(loads,2);
 }finally{await browser.close();}
});
test('site guidance and inactive notices cannot block Start; active errors remain detected',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://ometv.chat/**',route=>route.fulfill({contentType:'text/html',body:`<video id="local-video"></video><input id="chat-text"><span data-tr="rules">Breaking rules may get you banned. Enable your camera before starting.</span><div style="opacity:0"><span data-tr="banned">You have been banned.</span></div><div aria-hidden="true"><span data-tr="camera_error">Camera access denied.</span></div><div style="position:fixed;top:-1000px"><span data-tr="network_error">Connection failed.</span></div><div class="btn btn-main" id="start"><span data-tr="start">Start</span></div><script>window.starts=0;document.getElementById('start').onclick=()=>window.starts++;</script>`}));
  const page=await context.newPage();await page.goto('https://ometv.chat/embed/index.html');
  assert.equal(await page.evaluate(()=>window.__videoHost.status().nativeError),'');
  await page.locator('.btn.btn-main').click();assert.equal(await page.evaluate(()=>window.starts),1);
  await page.evaluate(()=>{const el=document.createElement('div');el.dataset.tr='active_error';el.textContent='You have been banned.';document.body.append(el);});
  assert.equal(await page.evaluate(()=>window.__videoHost.status().nativeError),'OmeTV has restricted this session.');
  await page.evaluate(()=>document.querySelector('[data-tr="active_error"]').textContent='Camera access denied.');
  assert.equal(await page.evaluate(()=>window.__videoHost.status().nativeError),'OmeTV could not access the hosted camera.');
  await page.evaluate(()=>document.querySelector('[data-tr="active_error"]').textContent='Connection failed.');
  assert.equal(await page.evaluate(()=>window.__videoHost.status().nativeError),'OmeTV could not connect to its server.');
 }finally{await context.close();await browser.close();}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {VideoHost} from '../video-host.js';
import {YapVideoHost} from '../yap-video-host.js';
test('Yap bridge carries generated video and audio in both directions',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const host=new YapVideoHost({data:'/unused-yap',getBrowser:async()=>({newContext:async options=>{
  const context=await browser.newContext(options);
  await context.route('http://127.0.0.1:3000/video-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body>Generated media test</body>'}));
  return context;
 }})});
 try{assert.deepEqual(await host.test(3000),{ok:true,videoBothWays:true,audioBothWays:true});}finally{await host.shutdown();await browser.close();}
});
test('Yap uses isolated main pages and native Start with no credential injection',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const contexts=[];
 const host=new YapVideoHost({data:'/unused-yap',getBrowser:async()=>({newContext:async options=>{
  assert.equal(options.storageState,undefined);
  const context=await browser.newContext(options);contexts.push(context);
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><button id="entry">Start Random Video Chat</button><script>
   window.starts=0;document.getElementById('entry').onclick=()=>{document.body.innerHTML='<video muted autoplay></video><button id="normal">▶ START</button><button>Start Adult Chat</button>';document.querySelector('video').muted=true;document.getElementById('normal').onclick=async()=>{window.starts++;window.stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});document.querySelector('video').srcObject=window.stream;};};
  </script>`}));
  return context;
 }})});
 try{
  await host.start(0);await host.start(1);
  assert.equal(contexts.length,2);assert.notEqual(contexts[0],contexts[1]);
  for(const slot of host.slots){await slot.page.waitForFunction(()=>!!window.stream&&window.__videoHost.diagnostics().outgoingPixel[3]===255);assert.deepEqual(await slot.page.evaluate(()=>({starts:window.starts,credentials:localStorage.getItem('snid'),kinds:window.stream.getTracks().map(t=>t.kind).sort()})),{starts:1,credentials:null,kinds:['audio','video']});assert.equal(host.frame(slot),slot.page.mainFrame());assert.deepEqual(await slot.page.evaluate(()=>window.__videoHost.diagnostics().outgoingPixel),[0,0,0,255]);}
 }finally{await host.shutdown();await browser.close();}
});
test('real Chromium follows replaced iframe and clicks the native container when Start text rejects pointer events',async()=>{
 const data=await mkdtemp(join(tmpdir(),'video-frame-')),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const host=new VideoHost({data,pageUrl:'https://ometv.chat/',getBrowser:async()=>({newContext:async options=>{
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
  assert.deepEqual(result,{applications:1,starts:1});
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
   const status=window.__videoHost.status();window.__videoHost.routing({preview:true,enabled:false,otherConnected:false});const requested=window.__videoHost.status();window.__videoHost.dispose();peer.close();track.stop();return {connected:status.connected,tracks:status.remoteTracks,backgroundGeneration:status.streamGeneration,requestedGeneration:requested.streamGeneration,camera:devices.some(d=>d.kind==='videoinput')};
  });
  assert.equal(result.connected,true);assert.equal(result.backgroundGeneration,0);assert.equal(result.requestedGeneration,1);assert.equal(result.camera,true);assert.deepEqual(result.tracks,[{kind:'video',state:'live'}]);
 }finally{await context.close();await browser.close();}
});
test('Yap dashboard connects without fetching or importing OmeTV tokens',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();let starts=0,sessionRequests=0;
 try{
  await page.route('https://dashboard.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/video/status')return route.fulfill({json:{slots:[0,1].map(i=>({label:i===0?'A':'B',open:false,status:'closed',connected:false,busy:false}))}});
   if(path==='/api/video/sessions'){sessionRequests++;return route.fulfill({json:{sessions:[null,null]}});}
   if(path==='/api/video/0/start'){starts++;return route.fulfill({json:{ok:true}});}
   const file=path==='/video'?'../public/video.html':path==='/video.js'?'../public/video.js':path==='/stream-player.js'?'../browser/stream-player.js':null;
   return route.fulfill({contentType:path.endsWith('.js')?'application/javascript':'text/html',body:file?await readFile(new URL(file,import.meta.url),'utf8'):''});
  });
  await page.goto('https://dashboard.test/video');await page.waitForFunction(()=>!document.getElementById('videoHub').hidden);
  assert.equal(await page.locator('#sessionsForm').count(),0);
  await page.locator('#videoCard0 .start').click();await page.waitForFunction(()=>!document.querySelector('#videoCard0 .start').disabled);
  assert.equal(starts,1);assert.equal(sessionRequests,0);
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
  await page.evaluate(()=>{document.body.innerHTML='<div data-tr="youre-banned">Вы заблокированы</div>';});assert.equal(await page.evaluate(()=>window.__videoHost.status().nativeError),'OmeTV has restricted this session.');
 }finally{await context.close();await browser.close();}
});
test('delayed normal-page authorization completes without a second apply before Start',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),data=await mkdtemp(join(tmpdir(),'video-direct-')),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const urls=[],host=new VideoHost({data,getBrowser:async()=>({newContext:async options=>{
  const context=await browser.newContext(options);await context.route('https://ometv.chat/**',async route=>{const pathname=new URL(route.request().url()).pathname;urls.push(pathname);if(pathname==='/'){await route.fulfill({contentType:'text/html',body:`<iframe id="videochat" src="/embed/index.html" onload="setTimeout(()=>this.contentWindow.postMessage({setAuthToken:'direct-token',source:'sn'},'https://ometv.chat'),1500)"></iframe>`});return;}await route.fulfill({contentType:'text/html',body:`<video id="local-video"></video><input id="chat-text"><div class="btn btn-main"><span data-tr="start">Start</span></div><script>window.applies=0;window.starts=0;window.__videoHost={status:()=>({mediaReady:true,login:false,verification:false,connected:false})};window.addEventListener('message',e=>{if(e.origin==='https://ometv.chat'&&e.source===parent&&e.data.source==='sn'&&e.data.setAuthToken==='direct-token'){window.applies++;sessionStorage.setItem('token',e.data.setAuthToken);}});document.querySelector('.btn').onclick=()=>window.starts++;</script>`});});return context;
 }})});
 try{await host.sessionsLoaded;host.sessions[0]={token:'direct-token',SnDataStr:'signed-data',SnHmac:'signed-hmac'};await host.start(0);assert.deepEqual(await host.frame(host.slots[0]).evaluate(()=>({applies:window.applies,starts:window.starts})),{applies:1,starts:1});assert.equal(host.slots[0].bootstrapConfirmed,true);assert.equal(urls.includes('/'),true);assert.equal(urls.includes('/embed/index.html'),true);}finally{await host.shutdown();await browser.close();await rm(data,{recursive:true,force:true});}
});
test('native duplicate-window notice outside translation labels is detected',async()=>{const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext();try{await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});await context.route('https://ometv.chat/**',route=>route.fulfill({contentType:'text/html',body:'<video id="local-video"></video><input id="chat-text"><div>You have opened the application in another window or in another browser. Reload the page or click "Restart" button.</div>'}));const page=await context.newPage();await page.goto('https://ometv.chat/embed/index.html');assert.match(await page.evaluate(()=>window.__videoHost.status().nativeError),/separate active session/);}finally{await context.close();await browser.close();}});

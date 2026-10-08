import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {VideoHost} from '../video-host.js';
import {YapVideoHost} from '../yap-video-host.js';
test('Yap keeps a recovering ICE session, restarts its recording and ignores an old peer closing',async()=>{
 const {readFile}=await import('node:fs/promises');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:'<video id="native-remote" autoplay muted playsinline></video><button id="native">START</button>'}));
  const page=await context.newPage();await page.goto('https://yap.chat/video');
  await page.evaluate(()=>{
   const props={onStart(){},status:'inCall',socket:{connected:true},currentMatch:{type:'user',roomId:'same-fixture-room'}};
   document.getElementById('native').__reactFiber$fixture={return:{memoizedProps:props}};
   window.fixtureAudio=new AudioContext();window.fixtureCanvas=document.createElement('canvas');window.fixtureCanvas.getContext('2d').fillRect(0,0,300,150);
   window.fixtureStream=new MediaStream([...window.fixtureCanvas.captureStream(15).getTracks(),...window.fixtureAudio.createMediaStreamDestination().stream.getTracks()]);
   document.getElementById('native-remote').srcObject=window.fixtureStream;
   window.fixturePeer=new RTCPeerConnection();
   window.setPeerState=(peer,state)=>{for(const key of ['connectionState','iceConnectionState'])Object.defineProperty(peer,key,{value:state,configurable:true});peer.dispatchEvent(new Event('connectionstatechange'));};
   window.setPeerState(window.fixturePeer,'connected');
   const event=new Event('track');Object.defineProperties(event,{track:{value:window.fixtureStream.getVideoTracks()[0]},streams:{value:[window.fixtureStream]}});window.fixturePeer.dispatchEvent(event);
  });
  await page.waitForFunction(()=>window.__videoHost.status().connected);
  const initial=await page.evaluate(()=>{window.__videoHost.routing({preview:true,enabled:false,otherConnected:false});return window.__videoHost.status();});
  assert.equal(initial.recording,true);
  let state=await page.evaluate(()=>{window.setPeerState(window.fixturePeer,'disconnected');return window.__videoHost.status();});
  assert.equal(state.connected,false);assert.equal(state.ended,false);assert.equal(state.recording,false);assert.equal(state.remoteTracks.length,2);
  await page.waitForTimeout(600);
  state=await page.evaluate(()=>{window.setPeerState(window.fixturePeer,'connected');return window.__videoHost.status();});
  assert.equal(state.connected,true);assert.equal(state.ended,false);assert.equal(state.recording,true);assert.ok(state.streamGeneration>initial.streamGeneration);
  state=await page.evaluate(()=>{
   const old=window.fixturePeer;window.fixturePeer=new RTCPeerConnection();window.setPeerState(window.fixturePeer,'connected');
   const event=new Event('track');Object.defineProperties(event,{track:{value:window.fixtureStream.getVideoTracks()[0]},streams:{value:[window.fixtureStream]}});window.fixturePeer.dispatchEvent(event);
   window.setPeerState(old,'closed');old.close();return window.__videoHost.status();
  });
  assert.equal(state.connected,true);assert.equal(state.ended,false);
  await page.evaluate(()=>window.setPeerState(window.fixturePeer,'disconnected'));
  await page.waitForFunction(()=>window.__videoHost.status().ended,null,{timeout:6000});
  state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.connected,false);assert.equal(state.recording,false);
 }finally{await context.close();await browser.close();}
});
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
 const data=await mkdtemp(join(tmpdir(),'yap-profiles-')),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const contexts=[];
 const host=new YapVideoHost({data,getBrowser:async()=>({newContext:async options=>{
  assert.equal(options.storageState.origins[0].origin,'https://yap.chat');
  const context=await browser.newContext(options);contexts.push(context);
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><div>Loading...</div><script>
   window.bootGender=localStorage.getItem('uhmingle_selected_gender');window.starts=0;window.entries=0;window.earlyClicks=0;setTimeout(()=>{document.body.innerHTML='<button id="entry">Start Random Video Chat</button>';setTimeout(()=>{document.getElementById('entry').onclick=()=>{window.entries++;document.body.innerHTML='<video muted autoplay></video><button id="normal">▶ START</button><button>Start Adult Chat</button>';document.querySelector('video').muted=true;window.nativeProps={onStart(){},status:'idle',socket:{connected:false},currentMatch:null};document.getElementById('normal').__reactFiber$fixture={return:{memoizedProps:window.nativeProps}};setTimeout(()=>{document.getElementById('normal').onclick=async()=>{if(!window.stream||!window.nativeProps.socket.connected){window.earlyClicks++;return;}window.starts++;if(window.bootGender!=='male'&&window.bootGender!=='female'){document.body.innerHTML='<h2>Who are you?</h2><p>Pick your gender to start matching.</p>';return;}window.nativeProps.status='searching';const status=document.createElement('div');status.textContent='Searching for stranger...';document.body.append(status);};},200);setTimeout(async()=>{window.stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});document.querySelector('video').srcObject=window.stream;},400);setTimeout(()=>{window.nativeProps.socket.connected=true;},600);};},200);},200);
  </script>`}));
  return context;
 }})});
 try{
  await host.start(0,{selfGender:'male'});await host.start(1,{selfGender:'female'});
  assert.equal(contexts.length,2);assert.notEqual(contexts[0],contexts[1]);
  for(const slot of host.slots){await slot.page.waitForFunction(()=>!!window.stream&&window.__videoHost.diagnostics().outgoingPixel[3]===255);assert.deepEqual(await slot.page.evaluate(()=>({starts:window.starts,credentials:localStorage.getItem('snid'),kinds:window.stream.getTracks().map(t=>t.kind).sort()})),{starts:1,credentials:null,kinds:['audio','video']});assert.equal(await slot.page.evaluate(()=>window.entries),1);assert.equal(await slot.page.evaluate(()=>window.earlyClicks),0);assert.equal(await slot.page.evaluate(()=>window.bootGender),slot===host.slots[0]?'male':'female');assert.equal(host.frame(slot),slot.page.mainFrame());assert.equal(slot.status,'searching');const native=await slot.page.evaluate(()=>window.__videoHost.status());assert.equal(native.nativeMediaReady,true);assert.equal(native.genderRequired,false);assert.equal(native.selfGender,slot.selfGender);assert.equal(await slot.page.evaluate(()=>window.stream.getVideoTracks()[0].getSettings().width),320);assert.deepEqual(await slot.page.evaluate(()=>window.__videoHost.diagnostics().outgoingPixel),[0,0,0,255]);}
  await host.slots[0].page.evaluate(()=>localStorage.setItem('yapchat_user_id','native-fixture-identity-A'));await host.slots[1].page.evaluate(()=>localStorage.setItem('yapchat_user_id','native-fixture-identity-B'));
  await host.close(0);await host.start(0,{selfGender:'male'});
  assert.equal(await host.slots[0].page.evaluate(()=>localStorage.getItem('yapchat_user_id')),'native-fixture-identity-A');assert.equal(await host.slots[1].page.evaluate(()=>localStorage.getItem('yapchat_user_id')),'native-fixture-identity-B');assert.equal(host.slots[0].profile.restored,true);
 }finally{await host.shutdown();await browser.close();await rm(data,{recursive:true,force:true});}
});
test('Yap waits for incoming audio, video and its first decoded frame before reporting a connection',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:'<video id="native-remote" autoplay muted playsinline></video><button id="native">START</button>'}));
  const page=await context.newPage();await page.goto('https://yap.chat/video');
  await page.evaluate(()=>{
   window.nativeProps={onStart(){},status:'connecting',socket:{connected:true,auth:{mode:'normal',token:'private-token'}},currentMatch:{type:'user',roomId:'private-room'}};document.getElementById('native').__reactFiber$fixture={return:{memoizedProps:window.nativeProps}};
   window.fixturePeer=new RTCPeerConnection();Object.defineProperty(window.fixturePeer,'connectionState',{value:'connected'});
   window.fixtureAudio=new AudioContext();window.remoteStream=window.fixtureAudio.createMediaStreamDestination().stream;document.getElementById('native-remote').srcObject=window.remoteStream;
   const event=new Event('track');Object.defineProperties(event,{track:{value:window.remoteStream.getAudioTracks()[0]},streams:{value:[window.remoteStream]}});window.fixturePeer.dispatchEvent(event);
  });
  let state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.connected,false);assert.equal(state.ended,false);assert.equal(state.nativeMode,'normal');assert.equal(state.remoteTracks[0].kind,'audio');assert.doesNotMatch(JSON.stringify(state),/private-token|private-room/);
  await page.evaluate(()=>{
   window.fixtureCanvas=document.createElement('canvas');const track=window.fixtureCanvas.captureStream(15).getVideoTracks()[0];window.remoteStream.addTrack(track);window.nativeProps.status='inCall';window.fixtureCanvas.getContext('2d').fillRect(0,0,300,150);
   const event=new Event('track');Object.defineProperties(event,{track:{value:track},streams:{value:[window.remoteStream]}});window.fixturePeer.dispatchEvent(event);
  });
  await page.waitForFunction(()=>window.__videoHost.status().connected);
  state=await page.evaluate(()=>window.__videoHost.status());assert.deepEqual(state.remoteTracks.map(t=>t.kind).sort(),['audio','video']);assert.equal(state.ended,false);
  await page.evaluate(()=>window.remoteStream.getVideoTracks()[0].stop());assert.equal((await page.evaluate(()=>window.__videoHost.status())).connected,false);
 }finally{await context.close();await browser.close();}
});
test('Yap reports provider matching modes without treating test mode as proof of playback',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:'<button id="native">START</button>'}));
  const page=await context.newPage();await page.goto('https://yap.chat/video?mode=user');
  let state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.nativeMode,'test');assert.equal(state.nativeError,'');
  await page.goto('https://yap.chat/video?mode=matches');state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.nativeMode,'bot-only');assert.match(state.nativeError,/playback-only/);assert.equal(state.connected,false);
 }finally{await context.close();await browser.close();}
});
test('Yap reads leaf status messages and distinguishes sign-in and media failure from verification',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:'<button>Sign in</button><div id="notice">Connecting</div><div hidden>Login Required</div>'}));
  const page=await context.newPage();await page.goto('https://yap.chat/video');
  let state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.searching,false);assert.equal(state.login,false);assert.equal(state.verification,false);
  await page.locator('#notice').evaluate(e=>{e.textContent='Finding someone';});assert.equal((await page.evaluate(()=>window.__videoHost.status())).searching,true);
  await page.locator('#notice').evaluate(e=>{e.textContent='Sign in first';});state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.login,true);assert.equal(state.verification,false);
  await page.locator('#notice').evaluate(e=>{e.textContent='Camera/Microphone permissions are required to continue';});state=await page.evaluate(()=>window.__videoHost.status());assert.match(state.nativeError,/camera or microphone/);assert.equal(state.login,false);
  await page.locator('#notice').evaluate(e=>{e.textContent="Your camera isn't working — matching stopped.";});assert.match((await page.evaluate(()=>window.__videoHost.status())).nativeError,/camera or microphone/);
  await page.locator('#notice').evaluate(e=>{e.textContent='Pick your gender to start matching.';});assert.equal((await page.evaluate(()=>window.__videoHost.status())).genderRequired,true);
 }finally{await context.close();await browser.close();}
});
test('Yap diagnoses native React session status without exposing socket or identity data',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:'<button id="native">START</button>'}));
  const page=await context.newPage();await page.goto('https://yap.chat/video');
  await page.evaluate(()=>{document.getElementById('native').__reactFiber$fixture={return:{memoizedProps:{onStart(){},status:'searching',socket:{connected:true,auth:{token:'private-fixture-value'}},selfInfo:{userId:'private-fixture-value'},currentMatch:null}}};});
  let state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.nativeClientFound,true);assert.equal(state.nativeSocketConnected,true);assert.equal(state.searching,true);assert.equal(state.nativeStatus,'searching');assert.doesNotMatch(JSON.stringify(state),/private-fixture-value/);
  await page.evaluate(()=>{const props=document.getElementById('native').__reactFiber$fixture.return.memoizedProps;props.status='inCall';props.currentMatch={type:'bot',videoUrl:'private-fixture-value'};});
  state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.nativeMatchKind,'playback');assert.equal(state.connected,false);assert.equal(state.nativeError,'');assert.equal(state.playbackWaiting,true);assert.doesNotMatch(JSON.stringify(state),/private-fixture-value/);
 }finally{await context.close();await browser.close();}
});
test('Yap ignores stale React renders and closes only after a committed participant change',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:'<video id="native-remote" autoplay muted playsinline></video><button id="native">START</button>'}));
  const page=await context.newPage();await page.goto('https://yap.chat/video');
  await page.evaluate(()=>{
   const stale={memoizedProps:{onStart(){},status:'idle',socket:{connected:false},currentMatch:null}};
   const current={memoizedProps:{onStart(){},status:'inCall',socket:{connected:true,auth:{token:'private-token'}},currentMatch:{type:'user',roomId:'private-room-one'}}};
   const root={current:null},oldRoot={stateNode:root,child:stale},newRoot={stateNode:root,child:current};stale.return=oldRoot;current.return=newRoot;oldRoot.alternate=newRoot;newRoot.alternate=oldRoot;root.current=newRoot;
   window.fixtureRoot=root;window.fixtureCurrent=current;document.getElementById('native').__reactFiber$fixture={return:stale};
   window.fixturePeer=new RTCPeerConnection();Object.defineProperty(window.fixturePeer,'connectionState',{value:'connected'});
   window.fixtureAudio=new AudioContext();const audioTrack=window.fixtureAudio.createMediaStreamDestination().stream.getAudioTracks()[0];window.fixtureCanvas=document.createElement('canvas');window.fixtureTrack=window.fixtureCanvas.captureStream(15).getVideoTracks()[0];window.fixtureCanvas.getContext('2d').fillRect(0,0,300,150);const stream=new MediaStream([window.fixtureTrack,audioTrack]);document.getElementById('native-remote').srcObject=stream;const event=new Event('track');Object.defineProperties(event,{track:{value:window.fixtureTrack},streams:{value:[stream]}});window.fixturePeer.dispatchEvent(event);
  });
  await page.waitForFunction(()=>window.__videoHost.status().connected&&window.__videoHost.diagnostics().outgoingPixel[3]===255);
  let state=await page.evaluate(()=>window.__videoHost.status());assert.equal(state.nativeStatus,'inCall');assert.equal(state.nativeSocketConnected,true);assert.equal(state.ended,false);assert.equal(state.connected,true);assert.doesNotMatch(JSON.stringify(state),/private-token|private-room/);
  state=await page.evaluate(()=>{const pending=window.fixtureRoot.current.alternate.child;pending.memoizedProps={...window.fixtureCurrent.memoizedProps,currentMatch:{type:'user',roomId:'private-room-two'}};return window.__videoHost.status();});
  assert.equal(state.ended,false);assert.equal(state.connected,true);
  state=await page.evaluate(()=>{window.fixtureRoot.current=window.fixtureRoot.current.alternate;const state=window.__videoHost.status();window.__videoHost.dispose();window.fixturePeer.close();window.fixtureTrack.stop();void window.fixtureAudio.close();return state;});
  assert.equal(state.ended,true);assert.equal(state.connected,false);assert.doesNotMatch(JSON.stringify(state),/private-token|private-room/);
 }finally{await context.close();await browser.close();}
});
test('Yap participant changes stop media even when a replacement track arrives before polling',async()=>{
 const {readFile}=await import('node:fs/promises'),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext();
 try{
  await context.addInitScript({content:await readFile(new URL('../browser/stream-player.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/video-runtime.js',import.meta.url),'utf8')});
  await context.route('https://yap.chat/**',route=>route.fulfill({contentType:'text/html',body:'<video id="native-remote" autoplay muted playsinline></video><button id="native">START</button>'}));
  const page=await context.newPage();await page.goto('https://yap.chat/video');
  await page.evaluate(()=>{
   const props={onStart(){},status:'inCall',socket:{connected:true},currentMatch:{type:'user',roomId:'private-room-one'}};document.getElementById('native').__reactFiber$fixture={return:{memoizedProps:props}};
   window.fixturePeer=new RTCPeerConnection();Object.defineProperty(window.fixturePeer,'connectionState',{value:'connected'});
   window.fixtureAudio=new AudioContext();const audioTrack=window.fixtureAudio.createMediaStreamDestination().stream.getAudioTracks()[0];window.fixtureCanvas=document.createElement('canvas');window.fixtureTracks=[window.fixtureCanvas.captureStream(15).getVideoTracks()[0],audioTrack];window.fixtureCanvas.getContext('2d').fillRect(0,0,300,150);const stream=new MediaStream(window.fixtureTracks);document.getElementById('native-remote').srcObject=stream;
   const event=new Event('track');Object.defineProperties(event,{track:{value:window.fixtureTracks[0]},streams:{value:[stream]}});window.fixturePeer.dispatchEvent(event);
  });
  await page.waitForFunction(()=>window.__videoHost.status().connected&&window.__videoHost.diagnostics().outgoingPixel[3]===255);
  const state=await page.evaluate(()=>{
   document.getElementById('native').__reactFiber$fixture.return.memoizedProps.currentMatch.roomId='private-room-two';window.__videoHost.status();
   const track=window.fixtureCanvas.captureStream(15).getVideoTracks()[0];window.fixtureTracks.push(track);const event=new Event('track');Object.defineProperties(event,{track:{value:track},streams:{value:[new MediaStream([track])]}});window.fixturePeer.dispatchEvent(event);
   const state=window.__videoHost.status();window.__videoHost.dispose();window.fixturePeer.close();for(const t of window.fixtureTracks)t.stop();return state;
  });
  assert.equal(state.ended,true);assert.equal(state.connected,false);assert.doesNotMatch(JSON.stringify(state),/private-room/);
 }finally{await context.close();await browser.close();}
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
 const page=await browser.newPage();let starts=0,sessionRequests=0,startBody;
 try{
  await page.route('https://dashboard.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/video/status')return route.fulfill({json:{slots:[0,1].map(i=>({label:i===0?'A':'B',open:false,status:'closed',connected:false,busy:false}))}});
   if(path==='/api/video/sessions'){sessionRequests++;return route.fulfill({json:{sessions:[null,null]}});}
   if(path==='/api/video/0/start'){starts++;startBody=route.request().postDataJSON();return route.fulfill({json:{ok:true}});}
   const file=path==='/video'?'../public/video.html':path==='/video.js'?'../public/video.js':path==='/stream-player.js'?'../browser/stream-player.js':null;
   return route.fulfill({contentType:path.endsWith('.js')?'application/javascript':'text/html',body:file?await readFile(new URL(file,import.meta.url),'utf8'):''});
  });
  await page.goto('https://dashboard.test/video');await page.waitForFunction(()=>!document.getElementById('videoHub').hidden);
  assert.equal(await page.locator('#sessionsForm').count(),0);
  await page.locator('#videoCard0 .selfGender').selectOption('female');await page.locator('#videoCard0 .start').click();await page.waitForFunction(()=>!document.querySelector('#videoCard0 .start').disabled);
  assert.equal(starts,1);assert.equal(sessionRequests,0);assert.deepEqual(startBody,{selfGender:'female'});
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

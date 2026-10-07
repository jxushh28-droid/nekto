import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {EventEmitter} from 'node:events';import {AudioHost} from '../audio-host.js';import {confirmVoiceSession} from '../voice-session.js';
import {loadAudioTokens} from '../audio-token-config.js';
import {AudioGraph} from '../audio-graph.js';
import {primeVoiceStorage} from '../voice-bootstrap.js';
import {voiceReady} from '../voice-session.js';
import {runInNewContext} from 'node:vm';
test('authorized native client is ready without the optional isFirstLoaded flag',()=>{
 const state={system:{isAuth:true,socketConnected:true},user:{tokenId:123}};
 const sandbox={document:{querySelectorAll:()=>[{__vue__:{$store:{state}}}]}};
 assert.equal(runInNewContext('('+voiceReady.toString()+')()',sandbox),true);
 state.system.isAuth=false;assert.equal(runInNewContext('('+voiceReady.toString()+')()',sandbox),false);
});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'voice-test-'));const routes=[],states=[{connected:true,status:'connected'},{connected:true,status:'connected'}];const graph={process:true,routing:async v=>routes.push(v),close:async()=>{},capture:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{};return child;}};const host=new AudioHost({data:dir,graph});clearInterval(host.timer);await host.loaded;host.slots=[0,1].map(i=>({page:{evaluate:async()=>states[i]},browser:{close:async()=>{}},bootstrap:{ok:true,reason:'context-storage-before-navigation'},connected:true,epoch:String(i)}));return {host,states,routes,done:async()=>{await host.shutdown();await rm(dir,{recursive:true,force:true});}};}
test('preparation diagnostics use the stored page and an accessible redactor',async()=>{
 const f=await fixture();try{
  f.host.tokens=['diagnostic-fixture-token',null];let calls=0;
  const page=f.host.slots[0].page;page.waitForFunction=async()=>{};
  page.evaluate=async fn=>{
   calls++;
   if(fn===confirmVoiceSession)return {ok:true,reason:'native-session-confirmed',diagnostics:{authenticated:true,socketConnected:true}};
   if(fn.toString().includes('const stores'))return {clientFound:true,clientAuthFlag:true};
   if(fn.toString().includes('__voiceTokenBootstrap'))return {ok:true,reason:'saved-before-startup'};
   return [];
  };
  const slot=await f.host.prepare(0);
  assert.equal(slot.page,page);assert.equal(slot.prepared,true);assert.equal(calls,3);
 }finally{await f.done();}
});
test('failed document-start seeding never rewrites the token after the page starts',async()=>{
 const f=await fixture();try{
  f.host.tokens=['bootstrap-fixture-token',null];let fallbackWrites=0;
  f.host.slots[0].bootstrap={ok:false,reason:'context-storage-mismatch'};
  f.host.slots[0].page.evaluate=async fn=>{
   if(fn.toString().includes('localStorage.setItem')){fallbackWrites++;return;}
   return {ok:false,reason:'bootstrap-not-run'};
  };
  await assert.rejects(f.host.prepare(0),/before startup/);
  assert.equal(fallbackWrites,0);
 }finally{await f.done();}
});
test('a delayed bootstrap is rejected even when a later storage read matches',async()=>{
 const f=await fixture();try{
  f.host.tokens=['fixture-token',null];let reads=0;
  f.host.slots[0].bootstrap={ok:true,reason:'extension-storage-retry',phase:'poll:1'};
  f.host.slots[0].page.waitForFunction=async()=>reads++;
  await assert.rejects(f.host.prepare(0),/before startup/);assert.equal(reads,0);
 }finally{await f.done();}
});
test('a browser is closed when context setup fails before its slot is assigned',async()=>{
 const f=await fixture();try{
  f.host.tokens=['launch-fixture-token',null];f.host.slots[0]=null;
  f.host.graph.ensure=async()=>{};f.host.graph.browserEnv=()=>({});let closed=0;
  f.host.launch=async()=>({newContext:async()=>{throw Error('fixture setup failure');},close:async()=>closed++});
  await assert.rejects(f.host.prepare(0),/fixture setup failure/);
  assert.equal(closed,1);assert.equal(f.host.slots[0],null);
 }finally{await f.done();}
});
test('a delayed status from an old session cannot close its replacement',async()=>{
 const f=await fixture();try{
  let resolve;f.host.slots[0].page.evaluate=()=>new Promise(r=>resolve=r);
  const polling=f.host.tick();let closed=0;
  const replacement={...f.host.slots[0],page:{evaluate:async()=>({status:'ready',connected:false})},browser:{close:async()=>closed++},connected:false,epoch:'replacement'};
  f.host.slots[0]=replacement;resolve({status:'ended',ended:true,connected:false});await polling;
  assert.equal(f.host.slots[0],replacement);assert.equal(closed,0);
 }finally{await f.done();}
});
test('navigation timeout preserves the failed stage and native screen without retrying',async()=>{
 const f=await fixture();try{
  f.host.tokens=['fixture-token',null];f.host.slots[0]=null;
  f.host.graph.ensure=async()=>{};f.host.graph.browserEnv=()=>({});let visits=0,closed=0;
  const page=new EventEmitter();page.goto=async()=>{visits++;throw Object.assign(Error('private navigation details'),{name:'TimeoutError'});};page.screenshot=async()=>Buffer.from('fixture-screen');
  const context={grantPermissions:async()=>{},addInitScript:async()=>{},newPage:async()=>page};
  f.host.launch=async()=>({newContext:async()=>context,close:async()=>closed++});
  await assert.rejects(f.host.start(0),/page did not finish loading within 45 seconds/);
  assert.equal(visits,1);assert.equal(closed,1);assert.equal(f.host.slots[0].stopped,true);assert.equal(f.host.status().slots[0].stage,'navigate');assert.equal(f.host.status().slots[0].screenAvailable,true);
  assert.equal((await f.host.screen(0)).bytes.toString(),'fixture-screen');
 }finally{await f.done();}
});
test('native client readiness timeout explains that Start was never reached',async()=>{
 const f=await fixture();try{
  f.host.tokens=['fixture-token',null];
  f.host.slots[0].page.waitForFunction=async()=>{throw Object.assign(Error('fixture timeout'),{name:'TimeoutError'});};
  await assert.rejects(f.host.start(0),/client did not become ready within 20 seconds.*call has not been started/);
  assert.equal(f.host.slots[0].stopped,true);assert.equal(f.host.status().slots[0].stage,'await-native-client');
 }finally{await f.done();}
});
test('routing retries both mute commands after a partially failed unmute',async()=>{
 const graph=new AudioGraph();graph.inputs=[10,20];graph.routeKey=false;const commands=[];
 graph.pactl=async(...args)=>{commands.push(args);if(args[1]==='20'&&args[2]==='0')throw Error('fixture route failure');};
 await assert.rejects(graph.routing(true),/fixture route failure/);
 await graph.routing(false);
 assert.deepEqual(commands.slice(-2),[['set-sink-input-mute','10','1'],['set-sink-input-mute','20','1']]);
});
test('muting still attempts the second direction when the first mute fails',async()=>{
 const graph=new AudioGraph();graph.inputs=[10,20];graph.routeKey=true;const commands=[];
 graph.pactl=async(...args)=>{commands.push(args);if(args[1]==='10')throw Error('fixture mute failure');};
 await assert.rejects(graph.routing(false),/fixture mute failure/);assert.equal(commands.length,2);assert.equal(graph.routeKey,null);
});
test('Start waits for current native authorization instead of trusting a previously prepared slot',async()=>{
 const f=await fixture();try{
  let checks=0,clicks=0,preparedAt;f.host.prepare=async()=>{preparedAt=performance.now();return f.host.slots[0];};
  f.host.state=async()=>++checks===1?{status:'ready',authenticated:false,socketConnected:false}:checks===2?{status:'ready',authenticated:true,socketConnected:true}:{status:'searching',connected:false};
  f.host.slots[0].page.locator=selector=>({isVisible:async()=>selector==='#searchCompanyBtn',click:async()=>{assert.ok(performance.now()-preparedAt>=7000);assert.equal(checks,2);clicks++;}});
  await f.host.start(0);assert.equal(clicks,1);assert.equal(checks,3);
 }finally{await f.done();}
});
test('verification appearing during the seven-second wait prevents Start',async()=>{
 const f=await fixture();try{
  let clicks=0,preparedAt;f.host.prepare=async()=>{preparedAt=performance.now();return f.host.slots[0];};
  f.host.state=async()=>{assert.ok(performance.now()-preparedAt>=7000);return {status:'verification',authenticated:true,socketConnected:true};};
  f.host.slots[0].page.locator=()=>({isVisible:async()=>true,click:async()=>clicks++});
  await assert.rejects(f.host.start(0),/requires attention/);assert.equal(clicks,0);assert.equal(f.host.slots[0].stopped,true);
 }finally{await f.done();}
});
test('persistent WebSocket logging records metadata without payloads or raw errors',async()=>{
 const f=await fixture(),originalLog=console.log,logs=[];
 try{
  f.host.tokens=['logging-fixture-token',null];f.host.slots[0]=null;
  f.host.graph.ensure=async()=>{};f.host.graph.browserEnv=()=>({});
  const page=new EventEmitter();page.goto=async()=>{};page.waitForFunction=async()=>{};
  page.evaluate=async fn=>fn===confirmVoiceSession?{ok:true,diagnostics:{authenticated:true}}:fn.toString().includes('__voiceTokenBootstrap')?{ok:true}:fn.toString().includes('const stores')?{clientFound:true}:[];
  const initCalls=[];
  const context={grantPermissions:async()=>{},addInitScript:async (input,arg)=>{initCalls.push({input,arg});},newPage:async()=>{assert.equal(initCalls[0].input,primeVoiceStorage);assert.equal(initCalls[0].arg,'logging-fixture-token');assert.equal(typeof initCalls[1].input.content,'string');return page;}};
  f.host.launch=async()=>({newContext:async options=>{assert.equal(JSON.parse(options.storageState.origins[0].localStorage[0].value).user.authToken,'logging-fixture-token');assert.equal(options.storageState.origins[0].origin,'https://nekto-me.kz');assert.deepEqual(options.viewport,{width:1920,height:1080});assert.equal(options.isMobile,false);assert.equal(options.hasTouch,false);return context;},close:async()=>{}});
  console.log=value=>logs.push(String(value));
  await f.host.prepare(0);
  const ws=new EventEmitter();ws.url=()=> 'wss://audio.nekto-me.kz/websocket/?token=private-query-value';
  page.emit('websocket',ws);
  ws.emit('framesent',{payload:'42["event",{"s":"private-payload-value"}]'});
  ws.emit('framereceived',{payload:Buffer.from('private-binary-value')});
  ws.emit('socketerror','private-error-value');
  const all=logs.join('\n');for(const value of ['private-query-value','private-payload-value','private-binary-value','private-error-value'])assert.equal(all.includes(value),false);
  const frames=logs.map(value=>{try{return JSON.parse(value);}catch{return {};}}).filter(value=>['sent','received'].includes(value.event));
  assert.equal(frames.length,2);assert.ok(frames.every(value=>value.payloadOmitted===true&&!('payload' in value)&&value.bytes>0));
 }finally{console.log=originalLog;await f.done();}
});
test('authorization-only token check prepares one side without clicking Start or changing the other token',async()=>{
 const f=await fixture();try{
  f.host.tokens=[null,'other-fixture-token'];let starts=0;const checked=[];
  f.host.start=async()=>starts++;f.host.checkAuthorization=async i=>checked.push(i);
  const result=await f.host.applySingle(0,'check-fixture-token',{startCall:false});
  assert.equal(result.ok,true);assert.equal(result.operation,'authorization');assert.deepEqual(checked,[0]);assert.equal(starts,0);
  assert.deepEqual(await loadAudioTokens(f.host.data),['check-fixture-token','other-fixture-token']);
 }finally{await f.done();}
});
test('latest restriction source is retained after the socket disconnects',async()=>{
 const f=await fixture();try{
  f.states[0]={status:'blocked',connected:false,authenticated:false,socketConnected:false,restrictionSource:'#mask_bad_inet',disconnectCode:425};
  await f.host.tick();assert.equal(f.host.status().slots[0].lastAttempt.lastState.restrictionSource,'#mask_bad_inet');assert.equal(f.host.status().slots[0].lastAttempt.lastState.socketConnected,false);
 }finally{await f.done();}
});
test('single-token test opens only the selected side and persists an otherwise empty configuration',async()=>{
 for(const side of [0,1]){const f=await fixture();try{
  const starts=[];f.host.requested=true;f.host.start=async i=>starts.push(i);
  const result=await f.host.applySingle(side,'single-fixture-token');
  assert.deepEqual(starts,[side]);assert.equal(result.ok,true);assert.equal(result.results.length,1);
  assert.equal(f.host.requested,false);assert.deepEqual(f.host.slots,[null,null]);
  const saved=await loadAudioTokens(f.host.data);assert.equal(saved[side],'single-fixture-token');assert.equal(saved[1-side],null);
 }finally{await f.done();}}
});
test('single-token failure retains both saved tokens without starting or retrying the other side',async()=>{
 const f=await fixture();try{
  f.host.tokens=['previous-A-token','retained-B-token'];const starts=[];
  f.host.start=async i=>{starts.push(i);throw Error('Nekto requires verification for this voice session.');};
  const result=await f.host.applySingle(0,'replacement-A-token');
  assert.equal(result.ok,false);assert.match(result.results[0].error,/verification/);assert.deepEqual(starts,[0]);
  assert.deepEqual(await loadAudioTokens(f.host.data),['replacement-A-token','retained-B-token']);
 }finally{await f.done();}
});
test('audio routes only after consent and both sides connect; lost connection mutes',async()=>{const f=await fixture();try{await f.host.tick();assert.equal(f.host.enabled,false);await f.host.consent(true);assert.equal(f.host.enabled,true);f.states[1].connected=false;await f.host.tick();assert.equal(f.host.enabled,false);assert.equal(f.routes.at(-1),false);}finally{await f.done();}});
test('stranger disconnect closes that browser and disables routing',async()=>{const f=await fixture();try{await f.host.consent(true);f.states[0].ended=true;await f.host.tick();assert.equal(f.host.slots[0],null);assert.ok(f.host.slots[1]);assert.equal(f.host.requested,false);assert.equal(f.host.enabled,false);assert.equal(f.routes.at(-1),false);}finally{await f.done();}});
test('old capture chunks cannot leak into a replacement audio session',async()=>{const f=await fixture();const r=new EventEmitter();const writes=[];r.writeHead=()=>{};r.write=s=>writes.push(s);r.end=()=>r.emit('close');try{f.host.subscribe(0,r);const child=f.host.captures[0];child.stdout.emit('data',Buffer.alloc(2048));assert.equal(writes.filter(s=>s.startsWith('data:')).length,1);f.host.slots[0]={...f.host.slots[0],epoch:'new'};child.stdout.emit('data',Buffer.alloc(2048));assert.equal(writes.filter(s=>s.startsWith('data:')).length,1);}finally{await f.done();}});
test('meters measure each side independently without a listening subscriber',async()=>{const f=await fixture();try{await f.host.tick();const tone=Buffer.alloc(2048);for(let n=0;n<1024;n++)tone.writeInt16LE(8192,n*2);f.host.captures[0].stdout.emit('data',tone);f.host.captures[1].stdout.emit('data',Buffer.alloc(2048));const status=f.host.status();assert.equal(status.slots[0].db,-12);assert.equal(status.slots[0].level,80);assert.equal(status.slots[1].level,0);const old=f.host.captures[0];f.states[0].connected=false;await f.host.tick();assert.equal(f.host.captures[0],null);assert.equal(f.host.status().slots[0].level,0);old.stdout.emit('data',tone);assert.equal(f.host.status().slots[0].level,0);}finally{await f.done();}});
function voiceFixture({authenticated=false,live='expected-token',saved=live,restricted=false}={}){const old={document:global.document,localStorage:global.localStorage};let listener=()=>{},writes=0,requests=0;const user={authToken:live,tokenId:authenticated?321:null},system={isAuth:authenticated,socketConnected:true,forceDisconnectReason:restricted?'fixture-restriction':null};const store={state:{user,system},subscribe:fn=>{listener=fn;return()=>{listener=()=>{};};},commit:()=>writes++};global.document={querySelectorAll:()=>[{__vue__:{$store:store,$socketActions:{authorize:()=>requests++}}}]};global.localStorage={getItem:()=>JSON.stringify({user:{authToken:saved}}),setItem:()=>writes++};return {store,user,system,emit:()=>listener({type:'native-update'}),counts:()=>({writes,requests}),done:()=>{global.document=old.document;global.localStorage=old.localStorage;}};}
test('voice confirms existing native authorization without writing storage or sending a request',async()=>{const f=voiceFixture({authenticated:true});try{const result=await confirmVoiceSession({token:'expected-token',timeout:100});assert.equal(result.ok,true);assert.equal(result.reason,'native-session-confirmed');assert.deepEqual(f.counts(),{writes:0,requests:0});}finally{f.done();}});
test('voice waits for native startup to finish without manual authorization',async()=>{const f=voiceFixture();try{const pending=confirmVoiceSession({token:'expected-token',timeout:200});await new Promise(r=>setTimeout(r,10));assert.deepEqual(f.counts(),{writes:0,requests:0});f.user.tokenId=321;f.system.isAuth=true;f.emit();const result=await pending;assert.equal(result.ok,true);assert.deepEqual(f.counts(),{writes:0,requests:0});}finally{f.done();}});
test('voice stops when native startup requires verification, rejects the token or reports a restriction',async()=>{for(const kind of ['verification','token','restriction']){const f=voiceFixture(kind==='token'?{authenticated:true,live:'different-token'}:kind==='restriction'?{restricted:true}:{});try{const pending=confirmVoiceSession({token:'expected-token',timeout:200});if(kind==='verification'){f.system.captchaRequired=true;f.emit();}const result=await pending;assert.equal(result.ok,false);assert.equal(result.reason,kind==='verification'?'verification-required':kind==='token'?'token-not-accepted':'native-restriction');assert.deepEqual(f.counts(),{writes:0,requests:0});}finally{f.done();}}});
test('voice startup timeout never retries authorization',async()=>{const f=voiceFixture();try{const result=await confirmVoiceSession({token:'expected-token',timeout:20});assert.equal(result.reason,'native-authorization-timeout');assert.deepEqual(f.counts(),{writes:0,requests:0});}finally{f.done();}});
test('native registration rejection is reported without requesting a replacement token',async()=>{const f=voiceFixture();try{f.system.errorRegistered=425;const result=await confirmVoiceSession({token:'expected-token',timeout:100});assert.equal(result.reason,'native-registration-error-425');assert.equal(result.diagnostics.registrationError,425);assert.deepEqual(f.counts(),{writes:0,requests:0});}finally{f.done();}});
test('polling preserves a failed startup reason and never repeats preparation automatically',async()=>{const f=await fixture();let preparations=0;try{f.states[0]={status:'ready',connected:false};f.host.slots[0].connected=false;f.host.prepare=async()=>{preparations++;throw Error('Nekto rejected voice registration (code 425).');};await assert.rejects(f.host.start(0),/425/);await f.host.tick();await f.host.tick();const status=f.host.status().slots[0];assert.equal(status.status,'error');assert.match(status.error,/425/);assert.equal(preparations,1);}finally{await f.done();}});
test('verification during Start closes the browser and preserves the failure checkpoint without retries',async()=>{const f=await fixture();try{
 const s=f.host.slots[0];let closed=0,reads=0;s.stage='before-start';s.browser.close=async()=>closed++;
 f.host.prepare=async()=>s;f.host.state=async slot=>{if(slot!==s)return f.states[1];reads++;return {status:'verification',connected:false,detail:'Nekto requires verification.',authenticated:true,socketConnected:true,diagnostics:[{seq:1,captcha:true,tokenChanges:0}]};};
 await assert.rejects(f.host.start(0),/verification/);await f.host.tick();await f.host.tick();
 const result=f.host.status().slots[0];assert.equal(closed,1);assert.equal(reads,1);assert.equal(result.open,false);assert.equal(result.closable,true);assert.equal(result.stopped,true);assert.equal(result.status,'verification');assert.equal(result.stage,'before-start');assert.equal(result.bootstrap.ok,true);assert.equal(result.diagnostics[0].captcha,true);assert.equal(result.lastAttempt.lastState.authenticated,true);
 }finally{await f.done();}});
test('verification after search starts also closes the browser and blocks native reconnects',async()=>{const f=await fixture();try{
 let closed=0;f.host.slots[0].browser.close=async()=>closed++;f.host.slots[0].stage='searching';
 f.states[0]={status:'verification',connected:false,detail:'Nekto requires verification.'};
 await f.host.tick();await f.host.tick();assert.equal(closed,1);assert.equal(f.host.status().slots[0].stopped,true);assert.equal(f.host.requested,false);assert.equal(f.routes.at(-1),false);
 }finally{await f.done();}});

test('a native prompt stops Start once and preserves the actual explanation instead of timing out',async()=>{const f=await fixture();try{
 const s=f.host.slots[0];let reads=0,closed=0;s.browser.close=async()=>closed++;f.host.prepare=async()=>s;
 f.host.state=async slot=>slot===s?(reads++,{status:'attention',connected:false,detail:'Nekto requires microphone permission.',authenticated:true,socketConnected:true}):f.states[1];
 await assert.rejects(f.host.start(0),/microphone permission/);await f.host.tick();
 const status=f.host.status().slots[0];assert.equal(status.status,'attention');assert.equal(status.stopped,true);assert.equal(closed,1);assert.equal(reads,1);assert.equal(status.lastAttempt.lastState.status,'attention');
 }finally{await f.done();}});

test('microphone diagnosis selects the assigned source and omits device metadata',async()=>{
 const graph=new AudioGraph(),calls=[];graph.pactl=async(...args)=>{calls.push(args);return JSON.stringify(args.at(-1)==='sources'?[{index:10,name:'nekto_mic_A',properties:{private:'not-for-logs'}},{index:20,name:'nekto_mic_B'}]:[{source:10,mute:false},{source:20,mute:false},{source:10,mute:true}]);};
 assert.deepEqual(await graph.inputStatus(0),{devicePresent:true,openInputs:2,unmutedInputs:1});assert.deepEqual(await graph.inputStatus(1),{devicePresent:true,openInputs:1,unmutedInputs:1});assert.ok(calls.every(args=>args[2]==='list'));
 graph.pactl=async()=>JSON.stringify([]);assert.deepEqual(await graph.inputStatus(0),{devicePresent:false,openInputs:0,unmutedInputs:0});
});
test('failed call preserves microphone diagnosis before browser teardown without opening a microphone',async()=>{const f=await fixture();try{
 const s=f.host.slots[0],actions=[];s.browser.close=async()=>actions.push('close');f.host.graph.inputStatus=async()=>{actions.push('read');return {devicePresent:true,openInputs:1,unmutedInputs:1};};
 await f.host.stopFailed(0,s);assert.deepEqual(actions,['read','close']);assert.deepEqual(f.host.status().slots[0].lastAttempt.microphone,{phase:'before-stop',available:true,devicePresent:true,openInputs:1,unmutedInputs:1});
 }finally{await f.done();}});
test('failed audio diagnostic cannot prevent browser teardown or invent a missing microphone',async()=>{const f=await fixture();try{
 let closed=0;f.host.slots[0].browser.close=async()=>closed++;f.host.graph.inputStatus=async()=>{throw Error('private daemon detail');};
 await f.host.stopFailed(0,f.host.slots[0]);assert.equal(closed,1);assert.deepEqual(f.host.status().slots[0].microphone,{phase:'before-stop',available:false});
 }finally{await f.done();}});

test('native screen is cached per side and retained before a failed browser closes',async()=>{const f=await fixture();try{
 const s=f.host.slots[0],events=[];let shots=0;s.page.screenshot=async()=>{events.push('screen');shots++;return Buffer.from('private-image-'+shots);};s.browser.close=async()=>events.push('close');
 const first=await f.host.screen(0);assert.equal(first.bytes.toString(),'private-image-1');assert.equal((await f.host.screen(0)).bytes.toString(),'private-image-1');assert.equal(shots,1);assert.equal(await f.host.screen(1),null);
 await f.host.stopFailed(0,s);assert.deepEqual(events,['screen','screen','close']);assert.equal((await f.host.screen(0)).bytes.toString(),'private-image-2');assert.equal(f.host.status().slots[0].screenAvailable,true);assert.equal(JSON.stringify(f.host.status()).includes('private-image'),false);
 await f.host.close(0);assert.equal(await f.host.screen(0),null);
 }finally{await f.done();}});
test('an old screenshot cannot leak into a replacement session',async()=>{const f=await fixture();try{
 let resolve;f.host.slots[0].page.screenshot=()=>new Promise(r=>resolve=r);const pending=f.host.screen(0);
 f.host.slots[0]={...f.host.slots[0],page:{screenshot:async()=>Buffer.from('new-image')},screenPromise:null,epoch:'replacement'};resolve(Buffer.from('old-private-image'));
 assert.equal(await pending,null);assert.equal((await f.host.screen(0)).bytes.toString(),'new-image');
 }finally{await f.done();}});
test('concurrent screen reads share one screenshot operation',async()=>{const f=await fixture();try{
 let resolve,calls=0;f.host.slots[0].page.screenshot=()=>{calls++;return new Promise(r=>resolve=r);};const one=f.host.screen(0),two=f.host.screen(0);resolve(Buffer.from('fixture-image'));
 assert.equal((await one).bytes.toString(),'fixture-image');assert.equal((await two).bytes.toString(),'fixture-image');assert.equal(calls,1);
 }finally{await f.done();}});
test('screenshot failure cannot prevent browser cleanup',async()=>{const f=await fixture();try{
 let closed=0;f.host.slots[0].page.screenshot=async()=>{throw Error('private renderer detail');};f.host.slots[0].browser.close=async()=>closed++;
 await f.host.stopFailed(0,f.host.slots[0]);assert.equal(closed,1);assert.equal(await f.host.screen(0),null);
 }finally{await f.done();}});

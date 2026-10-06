import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {EventEmitter} from 'node:events';import {AudioHost} from '../audio-host.js';import {confirmVoiceSession} from '../voice-session.js';
import {loadAudioTokens} from '../audio-token-config.js';
import {AudioGraph} from '../audio-graph.js';
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
  let checks=0,clicks=0;f.host.prepare=async()=>f.host.slots[0];
  f.host.state=async()=>++checks===1?{status:'ready',authenticated:false,socketConnected:false}:checks===2?{status:'ready',authenticated:true,socketConnected:true}:{status:'searching',connected:false};
  f.host.slots[0].page.locator=selector=>({isVisible:async()=>selector==='#searchCompanyBtn',click:async()=>{assert.equal(checks,2);clicks++;}});
  await f.host.start(0);assert.equal(clicks,1);assert.equal(checks,3);
 }finally{await f.done();}
});
test('persistent WebSocket logging records metadata without payloads or raw errors',async()=>{
 const f=await fixture(),originalLog=console.log,logs=[];
 try{
  f.host.tokens=['logging-fixture-token',null];f.host.slots[0]=null;
  f.host.graph.ensure=async()=>{};f.host.graph.browserEnv=()=>({});
  const page=new EventEmitter();page.goto=async()=>{};page.waitForFunction=async()=>{};
  page.evaluate=async fn=>fn===confirmVoiceSession?{ok:true,diagnostics:{authenticated:true}}:fn.toString().includes('__voiceTokenBootstrap')?{ok:true}:fn.toString().includes('const stores')?{clientFound:true}:[];
  let imported;
  const context={storageState:async()=>imported,grantPermissions:async()=>{},addInitScript:async input=>{assert.equal(typeof input.content,'string');},newPage:async()=>page};
  f.host.launch=async()=>({newContext:async options=>{imported=options.storageState;return context;},close:async()=>{}});
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

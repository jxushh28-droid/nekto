import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {AudioHost} from '../audio-host.js';
import {inspectVoiceToken,readVoiceStorageToken} from '../voice-inspection.js';

const matchingToken={clientFound:true,storageReadable:true,savedTokenMatches:true,liveTokenMatches:true,authenticated:true,socketConnected:true,identityPresent:true,captcha:false,hcaptcha:false,restricted:false,registrationError:0};
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'native-input-')),actions=[],routes=[];
 const states=[{status:'connected',connected:true},{status:'connected',connected:true}];
 const graph={process:true,routing:async value=>routes.push(value),close:async()=>{},capture:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{};return child;}};
 const host=new AudioHost({data:dir,graph});clearInterval(host.timer);await host.loaded;
 host.slots=[0,1].map(i=>({epoch:'fixture-'+i,page:{evaluate:async()=>states[i]},browser:{close:async()=>{}},connected:true}));
 const s=host.slots[0];s.profileIdentity='interactive-fixture-token';s.wire={sentTokenMatches:true,registrationSucceeded:true};
 s.page.evaluate=async fn=>fn===inspectVoiceToken?{...matchingToken}:states[0];
 s.page.url=()=> 'https://nekto-me.kz/audiochat';s.page.viewportSize=()=>({width:1920,height:1080});
 s.page.mouse={click:async(x,y)=>actions.push(['click',x,y]),wheel:async(x,y)=>actions.push(['wheel',x,y])};
 s.page.keyboard={insertText:async text=>actions.push(['text',text]),press:async key=>actions.push(['key',key])};
 return {host,s,actions,routes,states,done:async()=>{await host.shutdown();await rm(dir,{recursive:true,force:true});}};
}
test('native controls click, type, press keys and scroll in the existing browser',async()=>{
 const f=await fixture();try{
  const {host,s,actions}=f;
  await host.input(0,{epoch:s.epoch,action:'click',x:.25,y:.5});
  await host.input(0,{epoch:s.epoch,action:'text',text:'fixture text'});
  await host.input(0,{epoch:s.epoch,action:'key',key:'Shift+Tab'});
  await host.input(0,{epoch:s.epoch,action:'scroll',deltaY:600});
  assert.deepEqual(actions,[['click',480,540],['text','fixture text'],['key','Shift+Tab'],['wheel',0,600]]);
  assert.equal(host.slots[0],s);assert.equal(host.ops.size,0);
  const inspected=await host.inspect(0);assert.equal(inspected.attempt.attemptId,s.profileIdentity);assert.equal(inspected.attempt.runId,s.profileIdentity);assert.equal(inspected.attempt.sessionId,s.epoch);
  delete inspected.attempt.attemptId;delete inspected.attempt.runId;assert.equal(JSON.stringify(inspected).includes(s.profileIdentity),false);
 }finally{await f.done();}
});
test('native controls reject replaced screens, invalid inputs, busy sessions and native restrictions',async()=>{
 const f=await fixture();try{
  const {host,s,actions}=f;
  for(const input of [{epoch:'replacement',action:'click',x:0,y:0},{epoch:s.epoch,action:'click',x:2,y:0},{epoch:s.epoch,action:'text',text:'a'.repeat(2001)},{epoch:s.epoch,action:'key',key:'F12'},{epoch:s.epoch,action:'eval',text:'alert(1)'},{epoch:s.epoch,action:'scroll',deltaY:5000}])await assert.rejects(host.input(0,input));
  host.ops.add(0);await assert.rejects(host.input(0,{epoch:s.epoch,action:'key',key:'Enter'}),/busy/);host.ops.delete(0);
  f.states[0]={status:'blocked',connected:false};await assert.rejects(host.input(0,{epoch:s.epoch,action:'key',key:'Enter'}),/blocked/);
  assert.deepEqual(actions,[]);assert.equal(host.ops.size,0);
 }finally{await f.done();}
});
test('verification recovery retains identity and requires new consent without another Start',async()=>{
 const f=await fixture();try{
  const {host,s,actions}=f;let closed=0;s.browser.close=async()=>closed++;
  f.states[0]={status:'verification',connected:false};host.requested=true;
  await host.tick();assert.equal(s.paused,true);assert.equal(host.enabled,false);assert.equal(host.captures[0],null);
  await assert.rejects(host.start(0),/paused/);assert.equal(host.ops.size,0);
  await host.input(0,{epoch:s.epoch,action:'key',key:'Enter'});
  f.states[0]={status:'searching',connected:false,authenticated:true,socketConnected:true};
  await host.tick();assert.equal(s.paused,false);assert.equal(s.prepared,true);assert.equal(s.status,'searching');assert.equal(s.error,'');
  assert.equal(host.slots[0],s);assert.equal(closed,0);assert.deepEqual(actions,[['key','Enter']]);
  f.states[0]={status:'connected',connected:true};await host.tick();assert.equal(host.enabled,false);assert.equal(host.requested,false);
  await host.consent(true);assert.equal(host.enabled,true);
 }finally{await f.done();}
});
test('native controls mute and close on a changed token before sending input',async()=>{
 const f=await fixture();try{
  const {host,s,actions}=f;let closed=0;s.browser.close=async()=>closed++;
  s.page.evaluate=async fn=>fn===inspectVoiceToken?{...matchingToken,liveTokenMatches:false}:f.states[0];
  host.requested=true;host.enabled=true;
  await assert.rejects(host.input(0,{epoch:s.epoch,action:'text',text:'fixture'}),/token changed/);
  assert.equal(closed,1);assert.deepEqual(actions,[]);assert.equal(host.enabled,false);assert.equal(f.routes.at(-1),false);assert.equal(s.stopped,true);
 }finally{await f.done();}
});
test('Start verifies the token before clicking instead of using a changed identity',async()=>{
 const f=await fixture();try{
  const {host,s,actions}=f;let clicks=0;host.prepare=async()=>s;
  f.states[0]={status:'ready',authenticated:true,socketConnected:true};
  s.page.evaluate=async fn=>fn===inspectVoiceToken?{...matchingToken,liveTokenMatches:false}:f.states[0];
  s.page.locator=selector=>({isVisible:async()=>selector==='#searchCompanyBtn',click:async()=>clicks++});
  await assert.rejects(host.start(0),/token changed/);assert.equal(clicks,0);assert.deepEqual(actions,[]);assert.equal(s.stopped,true);
  assert.equal(host.status().slots[0].callToken.before.liveTokenMatches,false);
 }finally{await f.done();}
});
test('Start records the same token after CAPTCHA without closing or retrying',async()=>{
 const f=await fixture();try{
  const {host,s}=f;let clicks=0;host.prepare=async()=>s;
  f.states[0]={status:'ready',authenticated:true,socketConnected:true};
  s.page.locator=selector=>({isVisible:async()=>selector==='#searchCompanyBtn',click:async()=>{clicks++;f.states[0]={status:'verification',detail:'Nekto requires verification.',connected:false};}});
  await assert.rejects(host.start(0),/verification/);
  const proof=host.status().slots[0].callToken;assert.equal(proof.before.liveTokenMatches,true);assert.equal(proof.after.liveTokenMatches,true);
  assert.equal(clicks,1);assert.equal(s.paused,true);assert.equal(s.stopped,undefined);
 }finally{await f.done();}
});
test('token inspection returns comparisons without exposing or rewriting credentials',()=>{
 const token='secret-fixture-credential',state={user:{authToken:token,tokenId:7},system:{isAuth:true,socketConnected:true,captchaRequired:true}};
 const context={document:{querySelectorAll:()=>[{__vue__:{$store:{state}}}]},localStorage:{getItem:()=>JSON.stringify({user:{authToken:token}})}};
 const result=runInNewContext('('+inspectVoiceToken.toString()+')("secret-fixture-credential")',context);
 assert.equal(result.liveTokenMatches,true);assert.equal(result.savedTokenMatches,true);assert.equal(result.captcha,true);assert.equal(JSON.stringify(result).includes(token),false);
 state.user.authToken='changed';assert.equal(runInNewContext('('+inspectVoiceToken.toString()+')("secret-fixture-credential")',context).liveTokenMatches,false);
});

test('clearing a native check cannot resume forwarding before authorization is confirmed',async()=>{
 const f=await fixture();try{
  f.states[0]={status:'verification',connected:false};await f.host.tick();
  f.states[0]={status:'connected',connected:true};
  f.s.page.evaluate=async fn=>fn===inspectVoiceToken?{...matchingToken,authenticated:false}:f.states[0];
  await f.host.tick();assert.equal(f.s.paused,true);assert.equal(f.s.connected,false);assert.equal(f.host.enabled,false);assert.equal(f.host.captures[0],null);
 }finally{await f.done();}
});
test('a registration frame carrying a different token stops the session despite a matching store',async()=>{
 const f=await fixture();try{
  f.s.wire.sentTokenMatches=false;f.host.requested=true;f.host.enabled=true;
  await f.host.tick();assert.equal(f.s.stopped,true);assert.match(f.s.error,/token changed/);assert.equal(f.host.enabled,false);assert.equal(f.routes.at(-1),false);
 }finally{await f.done();}
});

test('explicit storage reader returns the actual stored value without writing or using configured identity',()=>{
 let raw=JSON.stringify({user:{authToken:'actual-native-fixture'}}),reads=0;
 const context={location:{origin:'https://nekto-me.kz'},localStorage:{getItem:key=>{assert.equal(key,'storage_audio_v2');reads++;return raw;}}};
 const read=()=>runInNewContext('('+readVoiceStorageToken.toString()+')()',context);
 assert.equal(read().token,'actual-native-fixture');assert.equal(reads,1);
 raw=null;assert.equal(read().token,null);assert.equal(read().storageReadable,true);
 raw='{broken';assert.equal(read().storageReadable,false);assert.equal(read().token,null);
 context.location.origin='https://unrelated.test';assert.throws(read,/left Nekto/);
});
test('storage inspection uses the selected live page and rejects stale or closed sessions',async()=>{
 const f=await fixture();try{
  const {host,s}=f;let evaluated=0;
  s.page.evaluate=async fn=>{assert.equal(fn,readVoiceStorageToken);evaluated++;return {token:'actual-storage-fixture',storageReadable:true};};
  const r=await host.storageToken(0,s.epoch);assert.equal(r.token,'actual-storage-fixture');assert.notEqual(r.token,s.profileIdentity);assert.equal(r.slot,0);assert.equal(r.runId,s.profileIdentity);assert.equal(r.sessionId,s.epoch);assert.equal(evaluated,1);
  assert.equal(s.tokenInspection,undefined);assert.equal(host.attempts[0],null);
  await assert.rejects(host.storageToken(0,'stale'),/changed/);assert.equal(evaluated,1);
  s.page.evaluate=async()=>{host.slots[0]=null;return {token:'stale-fixture'};};
  await assert.rejects(host.storageToken(0,s.epoch),/changed/);assert.equal(host.ops.size,0);
  assert.deepEqual(await host.storageToken(0,s.epoch),{open:false,token:null});
 }finally{await f.done();}
});

test('read-only storage inspection works during preparation without releasing its operation lock',async()=>{
 const f=await fixture();try{
  const {host,s}=f;host.setup=true;host.ops.add(0);
  s.page.evaluate=async()=>({token:'before-search-fixture',storageReadable:true});
  assert.equal((await host.storageToken(0,s.epoch)).token,'before-search-fixture');assert.equal(host.ops.has(0),true);assert.equal(host.setup,true);
  host.setup=false;host.ops.delete(0);
  const old=s.epoch;s.page.evaluate=async()=>{s.epoch='reloaded';return {token:'old-document'};};
  await assert.rejects(host.storageToken(0,old),/changed/);
 }finally{f.host.setup=false;f.host.ops.clear();await f.done();}
});
test('native reload retains page and identity, mutes the bridge, and never invokes Start',async()=>{
 const f=await fixture();try{
  const {host,s,routes}=f;const original=s.epoch,identity=s.profileIdentity,page=s.page,other=host.slots[1];let reloads=0,starts=0;
  host.start=async()=>starts++;host.requested=true;host.enabled=true;s.prepared=true;s.paused=true;s.status='verification';
  s.page.reload=async()=>reloads++;
  host.prepare=async i=>{assert.equal(i,0);assert.equal(s.prepared,false);assert.equal(s.wire.registrationSent,false);return s;};
  await assert.rejects(host.reloadPage(0,'stale'),/changed/);assert.equal(reloads,0);
  const result=await host.reloadPage(0,original);
  assert.equal(result.operation,'authorization');assert.equal(reloads,1);assert.equal(starts,0);assert.equal(s.page,page);assert.equal(s.profileIdentity,identity);assert.equal(host.slots[1],other);
  assert.notEqual(s.epoch,original);assert.equal(s.stage,'authorized-no-call');assert.equal(host.requested,false);assert.equal(host.enabled,false);assert.equal(routes.at(-1),false);assert.equal(host.ops.size,0);
 }finally{await f.done();}
});

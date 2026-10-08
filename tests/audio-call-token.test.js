import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {AudioHost} from '../audio-host.js';
import {inspectVoiceToken} from '../voice-inspection.js';

const matchingToken={clientFound:true,storageReadable:true,savedTokenMatches:true,liveTokenMatches:true,authenticated:true,socketConnected:true,identityPresent:true,captcha:false,hcaptcha:false,restricted:false,registrationError:0};
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'call-token-')),routes=[];
 const states=[{status:'connected',connected:true},{status:'connected',connected:true}];
 const graph={process:true,routing:async value=>routes.push(value),close:async()=>{},capture:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{};return child;}};
 const host=new AudioHost({data:dir,graph});clearInterval(host.timer);await host.loaded;
 host.slots=[0,1].map(i=>({epoch:'fixture-'+i,page:{evaluate:async()=>states[i]},browser:{close:async()=>{}},connected:true}));
 const s=host.slots[0];s.profileIdentity='call-fixture-token';s.wire={sentTokenMatches:true,registrationSucceeded:true};
 s.page.evaluate=async fn=>fn===inspectVoiceToken?{...matchingToken}:states[0];
 return {host,s,routes,states,done:async()=>{await host.shutdown();await rm(dir,{recursive:true,force:true});}};
}
test('Start verifies the token before clicking instead of using a changed identity',async()=>{
 const f=await fixture();try{
  const {host,s}=f;let clicks=0;host.prepare=async()=>s;
  f.states[0]={status:'ready',authenticated:true,socketConnected:true};
  s.page.evaluate=async fn=>fn===inspectVoiceToken?{...matchingToken,liveTokenMatches:false}:f.states[0];
  s.page.locator=selector=>({isVisible:async()=>selector==='#searchCompanyBtn',click:async()=>clicks++});
  await assert.rejects(host.start(0),/token changed/);assert.equal(clicks,0);assert.equal(s.stopped,true);
  assert.equal(host.status().slots[0].callToken.before.liveTokenMatches,false);
 }finally{await f.done();}
});
test('Start preserves matching-token evidence when native CAPTCHA stops the call without retries',async()=>{
 const f=await fixture();try{
  const {host,s}=f;let clicks=0;host.prepare=async()=>s;
  f.states[0]={status:'ready',authenticated:true,socketConnected:true};
  s.page.locator=selector=>({isVisible:async()=>selector==='#searchCompanyBtn',click:async()=>{clicks++;f.states[0]={status:'verification',detail:'Nekto requires verification.',connected:false};}});
  await assert.rejects(host.start(0),/verification/);
  const proof=host.status().slots[0].callToken;assert.equal(proof.before.liveTokenMatches,true);assert.equal(proof.after.liveTokenMatches,true);
  assert.equal(clicks,1);assert.equal(s.stopped,true);assert.equal(host.requested,false);assert.equal(f.routes.at(-1),false);
 }finally{await f.done();}
});
test('a token change after Start stops the call instead of silently reconnecting',async()=>{
 const f=await fixture();try{
  const {host,s}=f;let clicks=0;host.prepare=async()=>s;
  f.states[0]={status:'ready',authenticated:true,socketConnected:true};
  s.page.evaluate=async fn=>fn===inspectVoiceToken?{...matchingToken,liveTokenMatches:clicks===0}:f.states[0];
  s.page.locator=selector=>({isVisible:async()=>selector==='#searchCompanyBtn',click:async()=>{clicks++;f.states[0]={status:'searching',connected:false};}});
  await assert.rejects(host.start(0),/token changed/);
  assert.equal(clicks,1);assert.equal(s.stopped,true);assert.equal(host.status().slots[0].callToken.after.liveTokenMatches,false);assert.equal(host.enabled,false);
 }finally{await f.done();}
});
test('token inspection returns comparisons without exposing or rewriting credentials',()=>{
 const token='secret-fixture-credential',state={user:{authToken:token,tokenId:7},system:{isAuth:true,socketConnected:true,captchaRequired:true}};
 const context={document:{querySelectorAll:()=>[{__vue__:{$store:{state}}}]},localStorage:{getItem:()=>JSON.stringify({user:{authToken:token}})}};
 const result=runInNewContext('('+inspectVoiceToken.toString()+')("secret-fixture-credential")',context);
 assert.equal(result.liveTokenMatches,true);assert.equal(result.savedTokenMatches,true);assert.equal(result.captcha,true);assert.equal(JSON.stringify(result).includes(token),false);
 state.user.authToken='changed';assert.equal(runInNewContext('('+inspectVoiceToken.toString()+')("secret-fixture-credential")',context).liveTokenMatches,false);
});
test('a registration frame carrying a different token stops the session despite a matching store',async()=>{
 const f=await fixture();try{
  f.s.wire.sentTokenMatches=false;f.host.requested=true;f.host.enabled=true;
  await f.host.tick();assert.equal(f.s.stopped,true);assert.match(f.s.error,/token changed/);assert.equal(f.host.enabled,false);assert.equal(f.routes.at(-1),false);
 }finally{await f.done();}
});

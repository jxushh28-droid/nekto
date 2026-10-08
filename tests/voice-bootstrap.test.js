import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {primeVoiceStorage,applyVoiceStorageToken} from '../voice-bootstrap.js';

function run(saved, options = {}) {
  let value=saved,writes=0,denied=!!options.denied,retries=0;
  const listeners=new Map(),timers=new Map();let nextTimer=0;
  const document={readyState:'loading',addEventListener(event,fn){listeners.set(event,fn);retries++;},removeEventListener(event,fn){if(listeners.get(event)===fn)listeners.delete(event);}};
  const window={};window.top=options.frame?{}:window;
  const context={window,location:{origin:options.origin||'https://nekto-me.kz',pathname:options.path||'/audiochat'},
    document,setInterval(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);},
    localStorage:{getItem(){if(denied)throw Error('denied');return value;},setItem(key,next){assert.equal(key,'storage_audio_v2');writes++;value=next;}},token:'fixture-token'};
  runInNewContext('('+primeVoiceStorage.toString()+')(token)',context);
  return {get value(){return value;},get writes(){return writes;},get status(){return window.__voiceTokenBootstrap;},get retries(){return retries;},get pending(){return listeners.size+timers.size;},ready({allow=true,state='loading'}={}){denied=!allow;document.readyState=state;listeners.get('readystatechange')?.();},poll(count=1){for(let n=0;n<count;n++)for(const fn of [...timers.values()])fn();}};
}
test('extension startup preserves audio preferences and other stored sections',()=>{
 const original={user:{authToken:'old',volume:37,messengerKey:'fixture-key',searchParams:{topic:'talk'}},chat:{lastStartDialogTime:123},ad:{fsShows:[12]}};
 const result=run(JSON.stringify(original));assert.deepEqual(JSON.parse(result.value),{...original,user:{...original.user,authToken:'fixture-token'}});assert.equal(result.status.ok,true);assert.equal(result.writes,1);assert.equal(result.retries,0);
});
test('extension matching-token fast path never rewrites settings',()=>{
 const saved=JSON.stringify({user:{authToken:'fixture-token',volume:12}}),result=run(saved);assert.equal(result.writes,0);assert.equal(result.value,saved);assert.equal(result.status.ok,true);
});
test('extension creates storage from empty or null saved state',()=>{for(const saved of [null,'null']){const result=run(saved);assert.equal(result.status.ok,true);assert.equal(JSON.parse(result.value).user.authToken,'fixture-token');}});
test('bootstrap retry success clears every pending handler and timer',()=>{
 const result=run(null,{denied:true});assert.equal(result.status.ok,false);assert.equal(result.pending,3);result.ready();assert.equal(result.status.ok,true);assert.equal(result.status.phase,'readystatechange:loading');assert.equal(result.status.reason,'extension-storage-retry');assert.equal(result.writes,1);assert.equal(result.pending,0);result.poll(60);result.ready();assert.equal(result.writes,1);
});
test('malformed storage is a terminal failure without repeated writes or leaked contents',()=>{
 const result=run('old-private-fixture-token');assert.equal(result.status.ok,false);assert.equal(result.retries,0);assert.equal(result.pending,0);assert.equal(result.writes,0);assert.equal(JSON.stringify(result.status).includes('old-private'),false);
});
test('array storage is rejected before serialization could drop the token',()=>{
 for(const saved of ['[]','{"user":[]}']){
  const result=run(saved);assert.equal(result.writes,0);assert.equal(result.status.ok,false);assert.equal(result.status.reason,'extension-storage-invalid');assert.equal(result.retries,0);assert.equal(JSON.stringify(result.status).includes('fixture-token'),false);
 }
});
test('denied storage stops after sixty polls and releases all callbacks',()=>{
 const result=run(null,{denied:true});result.poll(60);assert.equal(result.status.ok,false);assert.equal(result.status.phase,'poll-exhausted');assert.equal(result.pending,0);assert.equal(result.writes,0);
});
test('fallback never writes a token after document startup completes',()=>{
 const result=run(null,{denied:true});result.ready({state:'interactive'});assert.equal(result.status.ok,false);assert.equal(result.status.reason,'extension-storage-not-ready-before-startup');assert.equal(result.pending,0);assert.equal(result.writes,0);
});
test('extension scope includes Nekto paths and same-origin subframes but excludes unrelated origins',()=>{
 assert.equal(run(null,{path:'/chat/'}).status.ok,true);assert.equal(run(null,{frame:true}).status.ok,true);
 const result=run(null,{origin:'https://unrelated.test'});assert.equal(result.writes,0);assert.equal(result.status,undefined);assert.equal(result.retries,0);
});
import {voiceStorageState,voiceStorageMatches} from '../voice-storage-state.js';
test('context storage imports audio credentials once while preserving unrelated settings',()=>{
 const previous={cookies:[],origins:[{origin:'https://nekto-me.kz',localStorage:[{name:'storage_audio_v2',value:JSON.stringify({user:{authToken:'old',volume:37},chat:{duration:2}})},{name:'unrelated',value:'preserved'}]},{origin:'https://other.test',localStorage:[{name:'storage_audio_v2',value:'untouched'}]}]};
 const result=voiceStorageState('fixture-token',previous);
 assert.equal(voiceStorageMatches(result,'fixture-token'),true);assert.equal(voiceStorageMatches(previous,'fixture-token'),false);
 const saved=JSON.parse(result.origins[0].localStorage[0].value);assert.equal(saved.user.volume,37);assert.equal(saved.chat.duration,2);assert.equal(result.origins[0].localStorage[1].value,'preserved');assert.equal(result.origins[1].localStorage[0].value,'untouched');
});

test('operator console storage writer works in the loaded page and preserves other fields',()=>{
 let value=JSON.stringify({user:{authToken:'old',volume:37},chat:{preference:'preserved'}}),writes=0;
 const context={location:{origin:'https://nekto-me.kz'},document:{addEventListener(){}},localStorage:{getItem:()=>value,setItem:(key,next)=>{assert.equal(key,'storage_audio_v2');writes++;value=next;}}};
 const run=()=>runInNewContext('('+applyVoiceStorageToken.toString()+')("console-fixture-token")',context);
 assert.equal(run().ok,true);assert.equal(writes,1);assert.equal(JSON.parse(value).user.volume,37);assert.equal(JSON.parse(value).chat.preference,'preserved');
 assert.equal(run().changed,false);assert.equal(writes,1);assert.equal(JSON.stringify(run()).includes('console-fixture-token'),false);
 context.location.origin='https://unrelated.test';assert.equal(run().ok,false);assert.equal(writes,1);
});

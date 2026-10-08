import {test} from 'node:test';
import assert from 'node:assert/strict';
import {YapVideoHost,yapPreferences} from '../yap-video-host.js';

test('Yap receives only its selected native setup preference before page startup',()=>{
 for(const gender of ['male','female'])assert.deepEqual(yapPreferences(gender),{cookies:[],origins:[{origin:'https://yap.chat',localStorage:[{name:'uhmingle_selected_gender',value:gender}]}]});
 for(const gender of ['',null,'all','adult'])assert.throws(()=>yapPreferences(gender),/valid gender/);
});
test('Yap preserves its native identity and cookies when applying the selected gender',()=>{
 const original={cookies:[{name:'native',value:'private-cookie'}],origins:[{origin:'https://yap.chat',localStorage:[{name:'yapchat_user_id',value:'private-identity'},{name:'uhmingle_selected_gender',value:'male'}]}]};
 const state=yapPreferences('female',original);
 assert.equal(state.origins[0].localStorage[0].value,'private-identity');assert.equal(state.origins[0].localStorage[1].value,'female');assert.deepEqual(state.cookies,original.cookies);assert.equal(original.origins[0].localStorage[1].value,'male');
});

function fixture(state={mediaReady:true,connected:false,searching:false}){
 const calls=[];
 const host=new YapVideoHost({data:'/unused-yap',getBrowser:async()=>{throw Error('not used');}});clearInterval(host.timer);
 const control={filter(){return this;},first(){return this;},waitFor:async()=>calls.push('ready'),isVisible:async()=>true,click:async()=>{calls.push('start');state.searching=true;}};
 const landing={isVisible:async()=>true,click:async()=>calls.push('landing')};
 const page={url:()=> 'https://yap.chat/video',frames:()=>[page],waitForFunction:async()=>{},evaluate:async()=>state,getByRole:(role,{name})=>{assert.equal(role,'button');return name.source.includes('Random')?landing:control;}};
 const slot={page,context:{close:async()=>calls.push('close')},cache:[],cacheBytes:0,connected:false};host.slots[0]=slot;
 return {host,page,calls,slot};
}
test('Yap starts native normal video without any imported tokens',async()=>{
 const f=fixture();try{await f.host.start(0);assert.deepEqual(f.calls,['landing','ready','start']);assert.deepEqual(f.host.sessions,[null,null]);assert.equal(f.host.status().requiresSession,false);assert.equal(f.slot.searchRequested,true);}finally{await f.host.shutdown();}
});
test('Yap setup timeout prevents Start and reports the native readiness phase',async()=>{
 const f=fixture();
 f.page.waitForFunction=async fn=>{if(fn.toString().includes('nativeClientFound'))throw Object.assign(Error('fixture timeout'),{name:'TimeoutError'});};
 try{await assert.rejects(f.host.start(0),/camera, microphone and socket setup/);assert.deepEqual(f.calls,['landing','ready']);assert.equal(f.slot.failureStage,'wait-native-ready');}finally{await f.host.shutdown();}
});
test('a native search that starts during setup never receives an additional Start',async()=>{
 const state={mediaReady:true,connected:false,searching:false},f=fixture(state);
 f.page.waitForFunction=async fn=>{if(fn.toString().includes('nativeClientFound'))state.searching=true;};
 try{await f.host.start(0);assert.deepEqual(f.calls,['landing','ready']);assert.equal(f.slot.status,'searching');}finally{await f.host.shutdown();}
});
test('Yap keeps a bounded disconnect checkpoint after the browser closes',async()=>{
 const state={mediaReady:true,connected:false,ended:true,nativeStatus:'stopped',nativeSocketConnected:true,nativeMatchKind:'live',roomId:'private-room',messages:['private-message']},f=fixture(state);
 f.slot.selfGender='male';f.slot.hadLiveMedia=true;
 try{await f.host.tick();assert.equal(f.host.slots[0],null);const status=f.host.status().slots[0];assert.equal(status.status,'ended');assert.equal(status.lastAttempt.hadLiveMedia,true);assert.equal(status.lastAttempt.nativeStatus,'stopped');assert.doesNotMatch(JSON.stringify(status),/private-room|private-message/);assert.equal((await f.host.inspect()).slots[0].lastAttempt.ended,true);}finally{await f.host.shutdown();}
});
test('Yap verification and native errors prevent all Start clicks',async()=>{
 for(const state of [{mediaReady:true,verification:true},{mediaReady:true,login:true},{mediaReady:true,genderRequired:true},{mediaReady:true,nativeError:'Yap has restricted this session.'}]){
  const f=fixture(state);try{await assert.rejects(f.host.start(0),/^Error: Yap/);assert.deepEqual(f.calls,[]);}finally{await f.host.shutdown();}
 }
});
test('changing Yap gender requires closing the existing session first',async()=>{
 const f=fixture();f.slot.selfGender='male';try{await assert.rejects(f.host.start(0,{selfGender:'female'}),/Disconnect this side/);assert.deepEqual(f.calls,[]);}finally{await f.host.shutdown();}
});
test('already searching or connected Yap never receives another Start',async()=>{
 for(const state of [{mediaReady:true,searching:true},{mediaReady:true,connected:true}]){const f=fixture(state);try{await f.host.start(0);assert.deepEqual(f.calls,[]);}finally{await f.host.shutdown();}}
});
test('Yap accepts only its main video client frame, never OmeTV',async()=>{
 const f=fixture();try{f.page.frames=()=>[{url:()=> 'https://ometv.chat/embed/index.html'},{url:()=> 'https://yap.chat/other'},f.page];assert.equal(f.host.frame(f.slot),f.page);}finally{await f.host.shutdown();}
});

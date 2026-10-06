import {test} from 'node:test';
import assert from 'node:assert/strict';
import {YapVideoHost} from '../yap-video-host.js';

function fixture(state={mediaReady:true,connected:false,searching:false}){
 const calls=[];
 const host=new YapVideoHost({data:'/unused-yap',getBrowser:async()=>{throw Error('not used');}});clearInterval(host.timer);
 const control={filter(){return this;},first(){return this;},waitFor:async()=>calls.push('ready'),isVisible:async()=>true,click:async()=>calls.push('start')};
 const landing={isVisible:async()=>true,click:async()=>calls.push('landing')};
 const page={url:()=> 'https://yap.chat/video',frames:()=>[page],waitForFunction:async()=>{},evaluate:async()=>state,getByRole:(role,{name})=>{assert.equal(role,'button');return typeof name==='string'?landing:control;}};
 const slot={page,context:{close:async()=>calls.push('close')},cache:[],cacheBytes:0,connected:false};host.slots[0]=slot;
 return {host,page,calls,slot};
}
test('Yap starts native normal video without any imported tokens',async()=>{
 const f=fixture();try{await f.host.start(0);assert.deepEqual(f.calls,['landing','ready','start']);assert.deepEqual(f.host.sessions,[null,null]);assert.equal(f.host.status().requiresSession,false);assert.equal(f.slot.searchRequested,true);}finally{await f.host.shutdown();}
});
test('Yap verification and native errors prevent all Start clicks',async()=>{
 for(const state of [{mediaReady:true,verification:true},{mediaReady:true,nativeError:'Yap has restricted this session.'}]){
  const f=fixture(state);try{await assert.rejects(f.host.start(0),/^Error: Yap/);assert.deepEqual(f.calls,[]);}finally{await f.host.shutdown();}
 }
});
test('already searching or connected Yap never receives another Start',async()=>{
 for(const state of [{mediaReady:true,searching:true},{mediaReady:true,connected:true}]){const f=fixture(state);try{await f.host.start(0);assert.deepEqual(f.calls,[]);}finally{await f.host.shutdown();}}
});
test('Yap accepts only its main video client frame, never OmeTV',async()=>{
 const f=fixture();try{f.page.frames=()=>[{url:()=> 'https://ometv.chat/embed/index.html'},{url:()=> 'https://yap.chat/other'},f.page];assert.equal(f.host.frame(f.slot),f.page);}finally{await f.host.shutdown();}
});

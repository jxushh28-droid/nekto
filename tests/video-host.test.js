import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {VideoHost} from '../video-host.js';
function fixture(){const calls=[[],[]];const frames=[0,1].map(i=>({url:()=> 'https://ometv.chat/embed/index.html',evaluate:async(fn,arg)=>{calls[i].push({fn:fn.toString(),arg});return {connected:true,mediaReady:true};},getByText:()=>({click:async()=>calls[i].push({start:true})}),locator:()=>({click:async()=>calls[i].push({start:true}),fill:async text=>calls[i].push({text}),press:async key=>calls[i].push({key})})}));const host=new VideoHost({getBrowser:async()=>{},data:'/fixture'});host.slots=frames.map((frame,i)=>({page:{frames:()=>[frame],frameLocator:()=>frame},context:{close:async()=>calls[i].push({closed:true})},status:'connected',connected:true,cache:[],cacheBytes:0,remember:false,savedAt:Date.now()}));return {host,calls};}
test('video routing requires both connected participants and explicit consent',async()=>{const f=fixture();try{await assert.rejects(f.host.toggle(true,false),/Confirm/);assert.equal(f.host.enabled,false);f.host.slots[1].connected=false;await assert.rejects(f.host.toggle(true,true),/Connect both/);f.host.slots[1].connected=true;await f.host.toggle(true,true);assert.equal(f.host.enabled,true);}finally{await f.host.shutdown();}});
test('media forwards only with enabled routing, and old-generation segments are dropped',async()=>{const f=fixture();try{const slot=f.host.slots[0];await f.host.segment(0,slot,{generation:'one',data:'YQ=='});assert.equal(f.calls[1].length,0);f.host.enabled=true;await f.host.segment(0,slot,{generation:'two',data:'Yg=='});assert.equal(f.calls[1].length,1);await f.host.segment(0,slot,{generation:'one',data:'YQ=='});assert.equal(f.calls[1].length,1);assert.equal(slot.cache.length,1);assert.equal(slot.cache[0].generation,'two');}finally{await f.host.shutdown();}});
test('private video text uses only the selected side',async()=>{const f=fixture();try{await f.host.send(0,'original message');assert.ok(f.calls[0].some(c=>c.text==='original message'));assert.equal(f.calls[1].length,0);}finally{await f.host.shutdown();}});
test('closing one video session disables forwarding and clears the other incoming stream',async()=>{const f=fixture();f.host.enabled=true;await f.host.close(0);assert.equal(f.host.slots[0],null);assert.ok(f.host.slots[1]);assert.equal(f.host.enabled,false);assert.ok(f.calls[1].some(c=>c.fn?.includes('clearIncoming')));await f.host.shutdown();});
test('stream subscriptions replay initial headers and clean up on disconnect',async()=>{const f=fixture(),res=new EventEmitter(),writes=[];res.writeHead=()=>{};res.write=text=>{writes.push(text);return true;};res.end=()=>res.emit('close');try{f.host.slots[0].cache=[{generation:'one',data:'YQ=='}];f.host.subscribe(0,res);assert.ok(writes.some(t=>t.includes('YQ==')));assert.equal(f.host.clients[0].size,1);res.emit('close');assert.equal(f.host.clients[0].size,0);}finally{await f.host.shutdown();}});
test('OmeTV profile is applied exactly twice before Start and is reused without reloading',async()=>{
 const f=fixture(),sequence=[];
 try{await f.host.sessionsLoaded;f.host.sessions[0]={token:'fixture-token',SnDataStr:'signed-data',SnHmac:'signature'};
 const frame=f.host.frame(f.host.slots[0]);frame.evaluate=async()=>({mediaReady:true,login:false,verification:false,connected:false});frame.locator=()=>({click:async()=>sequence.push('start')});f.host.slots[0].page.evaluate=async(fn,session)=>{assert.equal(session.SnDataStr,'signed-data');assert.ok(fn.toString().includes('postMessage'));sequence.push('apply');};
 await f.host.start(0);assert.deepEqual(sequence,['apply','apply','start']);await f.host.start(0);assert.deepEqual(sequence,['apply','apply','start','start']);
 }finally{await f.host.shutdown();}
});
test('existing site verification stops session preparation before any apply or Start',async()=>{
 const f=fixture(),sequence=[];
 try{await f.host.sessionsLoaded;f.host.sessions[0]={token:'fixture-token',SnDataStr:'signed-data',SnHmac:'signature'};
 const frame=f.host.frame(f.host.slots[0]);frame.evaluate=async()=>({mediaReady:true,verification:true,connected:false});frame.getByText=()=>({click:async()=>sequence.push('start')});f.host.slots[0].page.evaluate=async()=>sequence.push('apply');await assert.rejects(f.host.start(0),/requires verification/);assert.deepEqual(sequence,[]);assert.equal(f.host.slots[0].preparedToken,null);
 }finally{await f.host.shutdown();}
});

test('frame replacement during both applies uses the new frame without extra authorization',async()=>{
 const f=fixture(),sequence=[];
 try{
  await f.host.sessionsLoaded;f.host.sessions[0]={token:'fixture-token',SnDataStr:'signed-data',SnHmac:'signature'};
  let active=0;
  const frames=[0,1,2].map(index=>({url:()=> 'https://ometv.chat/embed/index.html',isDetached:()=>index!==active,evaluate:async()=>{
   if(index!==active)throw Error('Frame was detached');
   return {mediaReady:true,login:false,verification:false,connected:false};
  }}));
  f.host.slots[0].page.frames=()=>[frames[active]];
  f.host.slots[0].page.evaluate=async()=>{sequence.push('apply');active++;};
  f.host.slots[0].page.frameLocator=()=>({locator:()=>({click:async()=>sequence.push('start-'+active)})});
  await f.host.start(0);assert.deepEqual(sequence,['apply','apply','start-2']);
 }finally{await f.host.shutdown();}
});
test('a detach race while reading status is retried on the replacement frame',async()=>{
 const f=fixture();try{
  let changed=false;
  const old={url:()=> 'https://ometv.chat/embed/index.html',evaluate:async()=>{changed=true;throw Error('frame.evaluate: Frame was detached');}};
  const fresh={url:old.url,evaluate:async()=>({mediaReady:true,login:false})};
  f.host.slots[0].page.frames=()=>[changed?fresh:old];
  const result=await f.host.currentClient(f.host.slots[0],1000);assert.equal(result.frame,fresh);
 }finally{await f.host.shutdown();}
});
test('unconfirmed searches become retryable instead of remaining searching forever',async()=>{const f=fixture();try{const slot=f.host.slots[0];slot.searchRequested=true;slot.searchAt=Date.now()-20000;f.host.frame(slot).evaluate=async()=>({connected:false,mediaReady:true,searching:false});await f.host.tick();assert.equal(slot.status,'waiting');assert.match(slot.error,/retry/);f.host.frame(slot).evaluate=async()=>({connected:true,mediaReady:true});await f.host.tick();assert.equal(slot.status,'connected');assert.equal(slot.searchRequested,false);assert.equal(slot.error,'');}finally{await f.host.shutdown();}});
test('native errors replace the search state without exposing stored sessions',async()=>{const f=fixture();try{await f.host.sessionsLoaded;f.host.sessions[0]={token:'private-token',SnDataStr:'private-data',SnHmac:'private-signature'};f.host.slots[0].searchRequested=true;f.host.frame(f.host.slots[0]).evaluate=async()=>({connected:false,mediaReady:true,nativeError:'OmeTV could not access the hosted camera.'});await f.host.tick();assert.equal(f.host.slots[0].status,'error');assert.equal(f.host.slots[0].searchRequested,false);assert.equal(JSON.stringify(f.host.status()).includes('private-token'),false);}finally{await f.host.shutdown();}});

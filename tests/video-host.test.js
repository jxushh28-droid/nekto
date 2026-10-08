import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {VideoHost} from '../video-host.js';
function fixture(){const calls=[[],[]];const frames=[0,1].map(i=>({url:()=> 'https://ometv.chat/embed/index.html',evaluate:async(fn,arg)=>{calls[i].push({fn:fn.toString(),arg});return {connected:true,mediaReady:true};},getByText:()=>({click:async()=>calls[i].push({start:true})}),locator:()=>({click:async()=>calls[i].push({start:true}),fill:async text=>calls[i].push({text}),press:async key=>calls[i].push({key})})}));const host=new VideoHost({getBrowser:async()=>{},data:'/fixture'});host.slots=frames.map((frame,i)=>({page:{frames:()=>[frame],frameLocator:()=>frame},context:{close:async()=>calls[i].push({closed:true})},status:'connected',connected:true,cache:[],cacheBytes:0,remember:false,savedAt:Date.now()}));return {host,calls};}
test('video routing requires both connected participants and explicit consent',async()=>{const f=fixture();try{await assert.rejects(f.host.toggle(true,false),/Confirm/);assert.equal(f.host.enabled,false);f.host.slots[1].connected=false;await assert.rejects(f.host.toggle(true,true),/Connect both/);f.host.slots[1].connected=true;await f.host.toggle(true,true);assert.equal(f.host.enabled,true);}finally{await f.host.shutdown();}});
test('media forwards only with enabled routing, and old-generation segments are dropped',async()=>{const f=fixture();try{const slot=f.host.slots[0];await f.host.segment(0,slot,{generation:'one',data:'YQ=='});assert.equal(f.calls[1].length,0);f.host.enabled=true;await f.host.segment(0,slot,{generation:'two',data:'Yg=='});assert.equal(f.calls[1].length,1);await f.host.segment(0,slot,{generation:'one',data:'YQ=='});assert.equal(f.calls[1].length,1);assert.equal(slot.cache.length,1);assert.equal(slot.cache[0].generation,'two');}finally{await f.host.shutdown();}});
test('private video text uses only the selected side',async()=>{const f=fixture();try{await f.host.send(0,'original message');assert.ok(f.calls[0].some(c=>c.text==='original message'));assert.equal(f.calls[1].length,0);}finally{await f.host.shutdown();}});
test('closing one video session disables forwarding and clears the other incoming stream',async()=>{const f=fixture();f.host.enabled=true;await f.host.close(0);assert.equal(f.host.slots[0],null);assert.ok(f.host.slots[1]);assert.equal(f.host.enabled,false);assert.ok(f.calls[1].some(c=>c.fn?.includes('clearIncoming')));await f.host.shutdown();});
test('stream subscriptions replay initial headers and clean up on disconnect',async()=>{const f=fixture(),res=new EventEmitter(),writes=[];res.writeHead=()=>{};res.write=text=>{writes.push(text);return true;};res.end=()=>res.emit('close');try{f.host.slots[0].cache=[{generation:'one',data:'YQ=='}];f.host.subscribe(0,res);assert.ok(writes.some(t=>t.includes('YQ==')));assert.equal(f.host.clients[0].size,1);res.emit('close');assert.equal(f.host.clients[0].size,0);}finally{await f.host.shutdown();}});
test('OmeTV profile is saved twice but authorizes once before Start and is reused without reloading',async()=>{
 const f=fixture(),sequence=[];
 try{await f.host.sessionsLoaded;f.host.sessions[0]={token:'fixture-token',SnDataStr:'signed-data',SnHmac:'signature'};
 const frame=f.host.frame(f.host.slots[0]);frame.evaluate=async()=>({mediaReady:true,login:false,verification:false,connected:false});frame.locator=()=>({click:async()=>sequence.push('start')});f.host.slots[0].page.evaluate=async(fn,session)=>{assert.equal(session.SnDataStr,'signed-data');assert.ok(fn.toString().includes('postMessage'));assert.equal((fn.toString().match(/localStorage.setItem/g)||[]).length,2);sequence.push('apply');};
 await f.host.start(0);assert.deepEqual(sequence,['apply','start']);await f.host.start(0);assert.deepEqual(sequence,['apply','start','start']);
 }finally{await f.host.shutdown();}
});
test('existing site verification stops session preparation before any apply or Start',async()=>{
 const f=fixture(),sequence=[];
 try{await f.host.sessionsLoaded;f.host.sessions[0]={token:'fixture-token',SnDataStr:'signed-data',SnHmac:'signature'};
 const frame=f.host.frame(f.host.slots[0]);frame.evaluate=async()=>({mediaReady:true,verification:true,connected:false});frame.getByText=()=>({click:async()=>sequence.push('start')});f.host.slots[0].page.evaluate=async()=>sequence.push('apply');await assert.rejects(f.host.start(0),/requires verification/);assert.deepEqual(sequence,[]);assert.equal(f.host.slots[0].preparedToken,null);
 }finally{await f.host.shutdown();}
});

test('frame replacement during authorization uses the new frame without authorizing again',async()=>{
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
  await f.host.start(0);assert.deepEqual(sequence,['apply','start-1']);
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
test('validating saved profiles never starts matching',async()=>{const f=fixture();try{await f.host.sessionsLoaded;f.host.sessions=[0,1].map(i=>({token:'fixture-'+i,SnDataStr:'data',SnHmac:'hmac'}));for(let i=0;i<2;i++){f.host.slots[i].preparedToken='fixture-'+i;f.host.frame(f.host.slots[i]).evaluate=async()=>({mediaReady:true,connected:false,nativeError:''});}const result=await f.host.validateSessions();assert.equal(result.ok,true);assert.equal(f.calls.flat().some(c=>c.start),false);assert.equal(f.host.sessionSetup,false);}finally{await f.host.shutdown();}});
test('crashed slots are skipped by polling and rejected by the live client reader',async()=>{const f=fixture();try{const slot=f.host.slots[0];slot.crashed=true;slot.status='error';slot.connected=false;await f.host.tick();assert.equal(slot.status,'error');await assert.rejects(f.host.currentClient(slot),/renderer crashed/);}finally{await f.host.shutdown();}});
test('a renderer crash during status evaluation cannot be overwritten by a stale result',async()=>{const f=fixture();try{const slot=f.host.slots[0];f.host.frame(slot).evaluate=async()=>{slot.crashed=true;slot.connected=false;slot.status='error';return {connected:true,mediaReady:true};};await f.host.tick();assert.equal(slot.status,'error');assert.equal(slot.connected,false);}finally{await f.host.shutdown();}});
test('a delayed video status cannot close a newly opened replacement',async()=>{
 const f=fixture();try{const old=f.host.slots[0];let resolve;f.host.frame(old).evaluate=()=>new Promise(r=>resolve=r);const polling=f.host.tick();let closed=0;const replacement={...old,context:{close:async()=>closed++},connected:false};f.host.slots[0]=replacement;resolve({ended:true,connected:false});await polling;assert.equal(f.host.slots[0],replacement);assert.equal(closed,0);}finally{await f.host.shutdown();}
});
test('validation rechecks the first side after the second side loads',async()=>{const f=fixture();try{f.host.prepareSession=async i=>{if(i===1)f.host.slots[0].crashed=true;};f.host.frame(f.host.slots[0]).evaluate=async()=>({connected:false,mediaReady:true});const result=await f.host.validateSessions();assert.equal(result.ok,false);assert.equal(result.results[0].ok,false);assert.match(result.results[0].error,/renderer crashed/);}finally{await f.host.shutdown();}});
test('validation rejects a native duplicate-window notice that arrives after the other side loads',async()=>{const f=fixture();try{let both=false;f.host.prepareSession=async i=>{if(i===1)both=true;};f.host.frame(f.host.slots[0]).evaluate=async()=>({mediaReady:true,nativeError:both?'OmeTV requires a separate active session for each side.':''});const result=await f.host.validateSessions();assert.equal(result.ok,false);assert.match(result.results[0].error,/separate active session/);}finally{await f.host.shutdown();}});
test('a profile already authorized by page bootstrap is saved twice without another authorization',async()=>{const f=fixture(),calls=[];try{await f.host.sessionsLoaded;f.host.sessions[0]={token:'already-active',SnDataStr:'data',SnHmac:'signature'};f.host.frame(f.host.slots[0]).evaluate=async()=>({mediaReady:true,nativeTokenMatches:true,login:false,nativeError:''});f.host.slots[0].page.evaluate=async fn=>{calls.push(fn.toString());};await f.host.prepareSession(0);assert.equal(calls.length,1);assert.equal((calls[0].match(/localStorage.setItem/g)||[]).length,2);assert.equal(calls[0].includes('postMessage'),false);assert.equal(f.host.slots[0].bootstrapConfirmed,true);}finally{await f.host.shutdown();}});

test('a stalled browser read respects the client deadline',async()=>{const f=fixture();try{await f.host.sessionsLoaded;f.host.frame(f.host.slots[0]).evaluate=()=>new Promise(()=>{});await assert.rejects(f.host.currentClient(f.host.slots[0],30),/client did not respond/);}finally{f.host.frame(f.host.slots[0]).evaluate=async()=>({});await f.host.shutdown();}});

test('a native restriction is returned unchanged without apply or Start',async()=>{const f=fixture(),calls=[];try{await f.host.sessionsLoaded;f.host.sessions[0]={token:'fixture-token',SnDataStr:'signed-data',SnHmac:'signature'};f.host.frame(f.host.slots[0]).evaluate=async()=>({mediaReady:true,nativeError:'OmeTV has restricted this session.'});f.host.slots[0].page.evaluate=async()=>calls.push('apply');await assert.rejects(f.host.start(0),/^Error: OmeTV has restricted this session\.$/);assert.deepEqual(calls,[]);assert.equal(f.host.slots[0].preparedToken,null);}finally{await f.host.shutdown();}});

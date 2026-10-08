import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {voiceStorageState,voiceStorageMatches} from '../voice-storage-state.js';
import {primeVoiceStorage} from '../voice-bootstrap.js';
const base='https://dashboard-fixture.test';
test('Connect both applies typed tokens and fills only empty fields from saved tokens',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext(),submissions=[];let saved=['saved-fixture-A','saved-fixture-B'];
  const status={enabled:false,setup:false,configured:[true,true],slots:[0,1].map(i=>({label:i?'B':'A',open:false,status:'closed',connected:false,busy:false,error:''}))};
  await context.route(base+'/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.startsWith('/api/')){
    if(route.request().method()==='POST'){submissions.push({path,data:route.request().postDataJSON()});if(path.endsWith('/tokens'))saved=submissions.at(-1).data.tokens;return route.fulfill({json:{ok:true,results:[{slot:0,ok:true},{slot:1,ok:true}]}});}
    return route.fulfill({json:path.endsWith('/tokens')?{tokens:saved}:status});
   }
   const file=path==='/audio'?'audio.html':path.slice(1);return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../public/'+file,import.meta.url),'utf8')});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>document.querySelector('#tokenA').value==='saved-fixture-A');
  await page.locator('#tokenA').fill('typed-fixture-A');await page.locator('#tokenB').fill('typed-fixture-B');
  await page.locator('#connectBoth').click();await page.waitForFunction(()=>document.querySelector('#tokenResult').textContent.includes('B: поиск запущен'));
  assert.deepEqual(submissions,[{path:'/api/audio/tokens',data:{tokens:['typed-fixture-A','typed-fixture-B'],consent:false}}]);
  await page.locator('#tokenA').fill('second-fixture-A');await page.locator('#tokenB').fill('');
  const applied=page.waitForResponse(response=>response.url().endsWith('/api/audio/tokens')&&response.request().method()==='POST');
  await page.locator('#connectBoth').click();await applied;await page.waitForFunction(()=>!document.querySelector('#connectBoth').disabled);
  assert.deepEqual(submissions[1],{path:'/api/audio/tokens',data:{tokens:['second-fixture-A','typed-fixture-B'],consent:false}});
 }finally{await browser.close();}
});
test('audio token exists before the first page script and settings survive reload',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext({storageState:voiceStorageState('old',{cookies:[],origins:[{origin:'https://nekto-me.kz',localStorage:[{name:'storage_audio_v2',value:JSON.stringify({user:{authToken:'old',volume:37},chat:{lastStartDialogTime:123}})}]}]})});
  await context.addInitScript(primeVoiceStorage,'fixture-token');
  // All requests are fulfilled locally; no Nekto traffic or real call is made.
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<script>window.firstScriptStorage=JSON.parse(localStorage.getItem("storage_audio_v2"));</script>'}));
  const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
  for(let n=0;n<2;n++){
   const state=await page.evaluate(()=>({first:window.firstScriptStorage}));
   assert.deepEqual(state.first,{user:{authToken:'fixture-token',volume:37},chat:{lastStartDialogTime:123}});
   assert.equal(voiceStorageMatches(await context.storageState(),'fixture-token'),true);
   if(n===0)await page.reload();
  }
 }finally{await browser.close();}
});
test('extension startup reapplies the configured token before scripts on each document load',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext();
  await context.addInitScript(primeVoiceStorage,'fixture-original-token');
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<script>window.loadedToken=JSON.parse(localStorage.getItem("storage_audio_v2")).user.authToken;</script>'}));
  const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
  assert.equal(await page.evaluate(()=>window.loadedToken),'fixture-original-token');
  await page.evaluate(()=>localStorage.setItem('storage_audio_v2',JSON.stringify({user:{authToken:'fixture-native-replacement'}})));
  await page.reload();assert.equal(await page.evaluate(()=>window.loadedToken),'fixture-original-token');
 }finally{await browser.close();}
});
test('extension document-start scope seeds same-origin frames and leaves other origins untouched',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext();await context.addInitScript(primeVoiceStorage,'fixture-token');
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());const frames=url.pathname==='/audiochat'?'<iframe src="https://nekto-me.kz/frame"></iframe><iframe src="https://unrelated.test/frame"></iframe>':'';
   return route.fulfill({contentType:'text/html',body:'<script>window.firstToken=JSON.parse(localStorage.getItem("storage_audio_v2")||"{}").user?.authToken||null;</script>'+frames});
  });
  const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
  const frames=page.frames();assert.equal(frames.length,3);
  for(const frame of frames)assert.equal(await frame.evaluate(()=>window.firstToken),new URL(frame.url()).origin==='https://nekto-me.kz'?'fixture-token':null);
 }finally{await browser.close();}
});
for(const mode of ['text','audio'])test(mode+' tokens remain visible after failed Apply and restore after reload',async()=>{
 const browser=await chromium.launch({headless:true});try{const context=await browser.newContext();let saved=['a'.repeat(64),'b'.repeat(64)];const status=mode==='audio'?{enabled:false,requested:false,setup:false,configured:[true,true],slots:[0,1].map(i=>({label:i?'B':'A',open:false,status:'closed',connected:false,busy:false,error:'',level:i?0:70,db:i?-60:-18}))}:{enabled:true,tokenSetup:false,slots:[0,1].map(i=>({label:i?'B':'A',open:false,status:'closed',connected:false,busy:false,opening:false,epoch:null,messages:[]}))};
 await context.route(base+'/**',async route=>{const url=new URL(route.request().url());let body,type='application/json';if(url.pathname.startsWith('/api/')){if(url.pathname.endsWith('/tokens')){if(route.request().method()==='POST'){saved=JSON.parse(route.request().postData()).tokens;body=JSON.stringify({ok:false,results:[{slot:0,ok:false,error:'Fixture verification required'},{slot:1,ok:false,error:'Fixture verification required'}]});}else body=JSON.stringify({tokens:saved});}else body=JSON.stringify(status);}else{const path=url.pathname==='/'?'index.html':url.pathname==='/audio'?'audio.html':url.pathname.slice(1);body=await readFile(new URL('../public/'+path,import.meta.url),'utf8');type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';}await route.fulfill({body,contentType:type});});
 const page=await context.newPage();await page.goto(base+(mode==='audio'?'/audio':'/'));await page.waitForFunction(()=>document.querySelector('#tokenA').value.length===64);assert.equal(await page.locator('#tokenA').inputValue(),saved[0]);const replacement=['c'.repeat(64),'d'.repeat(64)];await page.locator('#tokenA').fill(replacement[0]);await page.locator('#tokenB').fill(replacement[1]);await page.locator(mode==='audio'?'#applyBoth':'#applyTokens').click();await page.waitForFunction(()=>document.querySelector('#tokenResult').textContent.includes('Fixture verification'));assert.equal(await page.locator('#tokenA').inputValue(),replacement[0]);assert.equal(await page.locator('#tokenB').inputValue(),replacement[1]);await page.reload();await page.waitForFunction(()=>document.querySelector('#tokenA').value.startsWith('cccc'));assert.equal(await page.locator('#tokenB').inputValue(),replacement[1]);if(mode==='audio'){const meter=page.getByRole('meter',{name:'Уровень звука A'});assert.equal(await meter.getAttribute('aria-valuenow'),'70');assert.equal(await page.locator('#card0 .meterValue').textContent(),'-18 dBFS');assert.equal(await page.getByRole('meter',{name:'Уровень звука B'}).getAttribute('aria-valuenow'),'0');}
 }finally{await browser.close();}
});

test('single-side audio test accepts one token, never submits B, and retains A after failure and reload',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext();let saved=[null,null];const submissions=[];
  const status={enabled:false,requested:false,setup:false,configured:[false,false],slots:[0,1].map(i=>({label:i?'B':'A',open:false,status:'closed',connected:false,busy:false,error:'',level:0,db:-60}))};
  await context.route(base+'/**',async route=>{
   const url=new URL(route.request().url());let body,type='application/json';
   if(url.pathname.startsWith('/api/')){
    if(route.request().method()==='POST'){
     submissions.push({path:url.pathname,data:JSON.parse(route.request().postData())});
     assert.ok(['/api/audio/0/token','/api/audio/0/check'].includes(url.pathname));saved[0]=submissions.at(-1).data.token;
     body=JSON.stringify(url.pathname.endsWith('/check')?{ok:true,operation:'authorization',results:[{slot:0,ok:true}]}:{ok:false,results:[{slot:0,ok:false,error:'Fixture verification required'}]});
    }else body=JSON.stringify(url.pathname.endsWith('/tokens')?{tokens:saved}:status);
   }else{
    const path=url.pathname==='/audio'?'audio.html':url.pathname.slice(1);body=await readFile(new URL('../public/'+path,import.meta.url),'utf8');type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';
   }
   await route.fulfill({body,contentType:type});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>!document.querySelector('#hub').hidden);
  await page.locator('#tokenA').fill('single-fixture-token');assert.equal(await page.locator('#tokenB').inputValue(),'');
  await page.locator('#applyTokens').click();await page.waitForFunction(()=>document.querySelector('#tokenResult').textContent.includes('Fixture verification'));
  assert.deepEqual(submissions,[{path:'/api/audio/0/token',data:{token:'single-fixture-token'}}]);
  assert.equal(await page.locator('#tokenA').inputValue(),'single-fixture-token');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#tokenA').value==='single-fixture-token');
  assert.equal(await page.locator('#tokenB').inputValue(),'');assert.equal(submissions.length,1);
  await page.locator('#checkTokenA').click();await page.waitForFunction(()=>document.querySelector('#tokenResult').textContent.includes('токен подтверждён, звонок не начат'));
  assert.deepEqual(submissions[1],{path:'/api/audio/0/check',data:{token:'single-fixture-token'}});assert.equal(submissions.length,2);
 }finally{await browser.close();}
});
test('card Connect applies the token typed in the field, and reconnects with the saved token when the field is empty',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext();let saved=[null,null];const submissions=[];
  const status={enabled:false,requested:false,setup:false,configured:[false,false],slots:[0,1].map(i=>({label:i?'B':'A',open:false,status:'closed',connected:false,busy:false,error:'',level:0,db:-60}))};
  await context.route(base+'/**',async route=>{
   const url=new URL(route.request().url());let body,type='application/json';
   if(url.pathname.startsWith('/api/')){
    if(route.request().method()==='POST'){
     submissions.push({path:url.pathname,data:JSON.parse(route.request().postData()||'{}')});
     if(url.pathname.endsWith('/token'))saved[Number(url.pathname.split('/')[3])]=submissions.at(-1).data.token;
     body=JSON.stringify({ok:true,operation:url.pathname.endsWith('/token')?'call':undefined,results:[{slot:Number(url.pathname.split('/')[3]),ok:true}]});
    }else body=JSON.stringify(url.pathname.endsWith('/tokens')?{tokens:saved}:status);
   }else{
    const path=url.pathname==='/audio'?'audio.html':url.pathname.slice(1);body=await readFile(new URL('../public/'+path,import.meta.url),'utf8');type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';
   }
   await route.fulfill({body,contentType:type});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>!document.querySelector('#hub').hidden);
  // Field holds a token for side A: pressing Connect must apply exactly that token.
  await page.locator('#tokenA').fill('typed-connect-token');
  await page.locator('#card0 .connect').click();await page.waitForFunction(()=>document.querySelector('#tokenResult').textContent.includes('поиск запущен'));
  assert.deepEqual(submissions,[{path:'/api/audio/0/token',data:{token:'typed-connect-token'}}]);
  // Side B field is empty: Connect reconnects with the saved token, sending no credential.
  assert.equal(await page.locator('#tokenB').inputValue(),'');
  await page.locator('#card1 .connect').click();await page.waitForFunction(()=>/\bB:/.test(document.querySelector('#tokenResult').textContent));
  assert.deepEqual(submissions[1],{path:'/api/audio/1/start',data:{}});assert.equal(submissions.length,2);
 }finally{await browser.close();}
});

test('audio panel shows the native screen and keeps the final failure image visible',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext();const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwWhAPAAI5ATKtB7p3AAAAAElFTkSuQmCC','base64');let stopped=false,requests=0;
  await context.route(base+'/**',async route=>{
   const url=new URL(route.request().url());let body,type='application/json';
   if(url.pathname.endsWith('/screen')){requests++;return route.fulfill({body:image,contentType:'image/png',headers:{'X-Screen-Time':String(Date.now())}});}
   if(url.pathname.endsWith('/tokens'))body=JSON.stringify({tokens:[null,null]});
   else if(url.pathname.endsWith('/status'))body=JSON.stringify({enabled:false,setup:false,configured:[true,false],slots:[{open:!stopped,closable:true,stopped,screenAvailable:true,attemptId:'fixture-A',status:stopped?'verification':'ready',busy:false,connected:false,level:0,db:-60,error:''},{open:false,status:'closed',busy:false,connected:false,level:0,db:-60}]});
   else {const path=url.pathname==='/audio'?'audio.html':url.pathname.slice(1);body=await readFile(new URL('../public/'+path,import.meta.url),'utf8');type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';}
   await route.fulfill({body,contentType:type});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>document.querySelector('#card0 .screenImage').naturalWidth===1);
  assert.equal(await page.locator('#card0 .screenImage').isVisible(),true);assert.equal(await page.locator('#card1 .screenImage').isVisible(),false);
  stopped=true;await page.waitForFunction(()=>document.querySelector('#card0 .screenHint').textContent.includes('Последний экран'));
  assert.equal(await page.locator('#card0 .screenImage').isVisible(),true);assert.ok(requests>=2);
 }finally{await browser.close();}
});

test('audio browser tools send normalized clicks, text and keys only for the displayed session',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext(),submissions=[];
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwWhAPAAI5ATKtB7p3AAAAAElFTkSuQmCC','base64');
  let epoch='current-screen',screenEpoch=epoch;
  await context.route(base+'/**',async route=>{
   const url=new URL(route.request().url());let body,type='application/json';
   if(url.pathname.endsWith('/screen'))return route.fulfill({body:image,contentType:'image/png',headers:{'X-Screen-Time':String(Date.now()),'X-Screen-Epoch':screenEpoch}});
   if(url.pathname.endsWith('/stream'))return route.fulfill({body:': fixture\n\n',contentType:'text/event-stream'});
   if(url.pathname.endsWith('/input')){submissions.push(JSON.parse(route.request().postData()));body=JSON.stringify({ok:true});}
   else if(url.pathname.endsWith('/tokens'))body=JSON.stringify({tokens:[null,null]});
   else if(url.pathname.endsWith('/status'))body=JSON.stringify({enabled:false,setup:false,configured:[true,false],slots:[{open:true,interactive:true,paused:true,screenAvailable:true,attemptId:epoch,status:'verification',busy:false,connected:false,error:'',callToken:{before:{liveTokenMatches:true,savedTokenMatches:true},after:{liveTokenMatches:true,savedTokenMatches:true}}},{open:false,status:'closed',busy:false,connected:false,error:''}]});
   else if(url.pathname.endsWith('/inspect'))body=JSON.stringify({open:true,attempt:{tokenInspection:{liveTokenMatches:true,savedTokenMatches:true}}});
   else{const path=url.pathname==='/audio'?'audio.html':url.pathname.slice(1);body=await readFile(new URL('../public/'+path,import.meta.url),'utf8');type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';}
   await route.fulfill({body,contentType:type});
  });
  const page=await context.newPage();await page.goto(base+'/audio');
  await page.waitForFunction(()=>document.querySelector('#card0 .screenImage').naturalWidth===1);
  await page.locator('#card0 .devTools summary').click();await page.locator('#card0 .controlToggle').click();
  await page.locator('#card0 .screenImage').click();
  await page.waitForFunction(()=>!document.querySelector('#card0 .typeText').disabled);
  assert.equal(submissions[0].epoch,epoch);assert.equal(submissions[0].action,'click');assert.ok(Math.abs(submissions[0].x-.5)<.01);assert.ok(Math.abs(submissions[0].y-.5)<.01);
  await page.locator('#card0 .nativeText').fill('fixture typing');await page.locator('#card0 .typeText').click();
  await page.waitForFunction(()=>!document.querySelector('#card0 .pressKey').disabled);
  await page.locator('#card0 .nativeKey').selectOption('Enter');await page.locator('#card0 .pressKey').click();
  await page.waitForFunction(()=>!document.querySelector('#card0 .inspect').disabled);
  assert.deepEqual(submissions[1],{epoch,action:'text',text:'fixture typing'});assert.deepEqual(submissions[2],{epoch,action:'key',key:'Enter'});
  assert.match(await page.locator('#card0 .callTokenProof').textContent(),/После Start: совпадает/);
  await page.locator('#card0 .inspect').click();await page.waitForFunction(()=>document.querySelector('#card0 .diagnostics').textContent.includes('liveTokenMatches'));
  epoch='replacement-screen';screenEpoch='old-screen';
  await page.waitForTimeout(2200);
  await page.locator('#card0 .screenImage').click();await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('Экран обновляется'));
  assert.equal(submissions.length,3);
 }finally{await browser.close();}
});

test('localStorage token panel shows raw browser value, compares current input, and clears replaced sessions',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext(),reads=[];let epoch='storage-run-A',open=true,release=null,delay=false;
  await context.route(base+'/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/storage')){
    reads.push({path,data:route.request().postDataJSON()});const browserEpoch=epoch;
    if(delay)await new Promise(resolve=>release=resolve);
    return route.fulfill({headers:{'X-Audio-Epoch':browserEpoch},json:{open:true,slot:0,runId:'operator-token-alias',sessionId:'operator-token-alias',at:Date.now(),token:'actual-native-token',storageReadable:true}});
   }
   if(path.endsWith('/screen'))return route.fulfill({status:204});
   if(path.endsWith('/tokens'))return route.fulfill({json:{tokens:['configured-token',null]}});
   if(path.endsWith('/status'))return route.fulfill({json:{enabled:false,setup:false,configured:[true,false],slots:[{open,attemptId:epoch,status:'verification',busy:false},{open:false,status:'closed',busy:false}]}});
   const file=path==='/audio'?'audio.html':path.slice(1);return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../public/'+file,import.meta.url),'utf8')});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>document.querySelector('#tokenA').value==='configured-token');
  assert.equal(await page.locator('#card1 .readStorage').isDisabled(),true);
  await page.locator('#card0 .readStorage').click();await page.waitForFunction(()=>document.querySelector('#card0 .storageToken').value==='actual-native-token');
  assert.equal(await page.locator('#card0 .storageToken').getAttribute('readonly'),'');assert.match(await page.locator('#card0 .storageMatch').textContent(),/НЕ совпадает/);
  assert.deepEqual(reads,[{path:'/api/audio/0/storage',data:{epoch:'storage-run-A'}}]);
  await page.locator('#tokenA').fill('actual-native-token');assert.match(await page.locator('#card0 .storageMatch').textContent(),/^Совпадает/);
  assert.equal(await page.locator('#card0 .fieldToken').inputValue(),'actual-native-token');
  delay=true;await page.locator('#card0 .readStorage').click();await page.waitForFunction(()=>document.querySelector('#card0 .readStorage').disabled);
  epoch='replacement-run';await page.waitForTimeout(1200);release();
  await page.waitForFunction(()=>!document.querySelector('#card0 .readStorage').disabled);assert.equal(await page.locator('#card0 .storageToken').inputValue(),'');
  open=false;await page.waitForFunction(()=>document.querySelector('#card0 .storageMatch').textContent.includes('Откройте браузер без поиска'));
  assert.equal(await page.locator('#card0 .readStorage').isDisabled(),true);
 }finally{await browser.close();}
});

test('storage is visible while startup is busy and native reload does not submit Start',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext(),posts=[];let epoch='before-search',busy=true,open=true;
  await context.route(base+'/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/screen'))return route.fulfill({status:204});
   if(path.endsWith('/storage')){posts.push({path,data:route.request().postDataJSON()});return route.fulfill({headers:{'X-Audio-Epoch':epoch},json:{open:true,slot:0,runId:'before-search-token',sessionId:'before-search-token',token:'before-search-token',storageReadable:true,at:Date.now()}});}
   if(path.endsWith('/reload')){posts.push({path,data:route.request().postDataJSON()});epoch='after-reload';return route.fulfill({json:{ok:true,operation:'authorization',results:[{slot:0,ok:true}]}});}
   if(path.endsWith('/tokens'))return route.fulfill({json:{tokens:['before-search-token',null]}});
   if(path.endsWith('/status'))return route.fulfill({json:{enabled:false,setup:false,configured:[true,false],slots:[{open,busy,storageAvailable:true,attemptId:epoch,status:'loading'},{open:false,busy:false,status:'closed'}]}});
   const file=path==='/audio'?'audio.html':path.slice(1);return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../public/'+file,import.meta.url),'utf8')});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>document.querySelector('#card0 .storageToken').value==='before-search-token');
  assert.match(await page.locator('#card0 .storageMatch').textContent(),/^Совпадает/);
  assert.equal(await page.locator('#card0 .readStorage').isDisabled(),false);assert.equal(await page.locator('#card0 .reloadNative').isDisabled(),true);
  busy=false;await page.waitForFunction(()=>!document.querySelector('#card0 .reloadNative').disabled);
  await page.locator('#card0 .reloadNative').click();await page.waitForFunction(()=>document.querySelector('#tokenResult').textContent.includes('звонок не начат'));
  await page.waitForFunction(()=>document.querySelector('#card0 .storageToken').value==='before-search-token');
  assert.deepEqual(posts.find(x=>x.path.endsWith('/reload')),{path:'/api/audio/0/reload',data:{epoch:'before-search'}});
  assert.ok(posts.every(x=>/\/(storage|reload)$/.test(x.path)));assert.equal(await page.locator('#tokenA').inputValue(),'before-search-token');
  assert.equal(await page.locator('#reloadDashboard').isVisible(),true);
 }finally{await browser.close();}
});

test('native console submits pasted code to the selected browser and renders output as text',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext(),submissions=[];const epochs=['console-A','console-B'];
  await context.route(base+'/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/screen'))return route.fulfill({status:204});
   if(path.endsWith('/console')){
    const slot=Number(path.split('/')[3]);submissions.push({slot,data:route.request().postDataJSON()});
    return route.fulfill({headers:{'X-Audio-Epoch':epochs[slot]},json:{ok:true,slot,pageURL:'https://nekto-me.kz/audiochat',at:Date.now(),value:'actual-console-token-'+slot,logs:[{type:'log',text:'<img src=x onerror=alert(1)>'}]}});
   }
   if(path.endsWith('/tokens'))return route.fulfill({json:{tokens:['different-input-A','different-input-B']}});
   if(path.endsWith('/status'))return route.fulfill({json:{enabled:false,setup:false,configured:[true,true],slots:epochs.map(epoch=>({open:true,busy:false,attemptId:epoch,status:'verification',paused:true}))}});
   const file=path==='/audio'?'audio.html':path.slice(1);return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../public/'+file,import.meta.url),'utf8')});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>document.querySelector('#tokenB').value==='different-input-B');
  await page.locator('#card1 .nativeConsole summary').click();
  const code="JSON.parse(localStorage.getItem('storage_audio_v2')).user.authToken";
  await page.locator('#card1 .consoleCode').fill(code);await page.locator('#card1 .consoleRun').click();
  await page.waitForFunction(()=>document.querySelector('#card1 .consoleOutput').textContent.includes('actual-console-token-1'));
  assert.deepEqual(submissions,[{slot:1,data:{epoch:'console-B',code}}]);assert.match(await page.locator('#card1 .consolePage').textContent(),/Браузер B.*https:\/\/nekto-me.kz\/audiochat/);
  assert.equal(await page.locator('#card1 .consoleOutput img').count(),0);assert.equal(await page.locator('#tokenB').inputValue(),'different-input-B');
  assert.equal(await page.locator('#card0 .consoleOutput').textContent(),'');
 }finally{await browser.close();}
});

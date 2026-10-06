import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {voiceStorageState,voiceStorageMatches} from '../voice-storage-state.js';
import {primeVoiceStorage} from '../voice-bootstrap.js';
const base='https://dashboard-fixture.test';
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
     assert.equal(url.pathname,'/api/audio/0/token');saved[0]=submissions.at(-1).data.token;
     body=JSON.stringify({ok:false,results:[{slot:0,ok:false,error:'Fixture verification required'}]});
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

import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {primeVoiceStorage} from '../voice-bootstrap.js';
const base='https://dashboard-fixture.test';
test('audio token exists before the first page script and settings survive reload',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext({storageState:{cookies:[],origins:[{origin:'https://nekto-me.kz',localStorage:[{name:'storage_audio_v2',value:JSON.stringify({user:{authToken:'old',volume:37},chat:{lastStartDialogTime:123}})}]}]}});
  await context.addInitScript(primeVoiceStorage,'fixture-token');
  // All requests are fulfilled locally; no Nekto traffic or real call is made.
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<script>window.firstScriptStorage=JSON.parse(localStorage.getItem("storage_audio_v2"));</script>'}));
  const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
  for(let n=0;n<2;n++){
   const state=await page.evaluate(()=>({first:window.firstScriptStorage,bootstrap:window.__voiceTokenBootstrap}));
   assert.deepEqual(state.first,{user:{authToken:'fixture-token',volume:37},chat:{lastStartDialogTime:123}});
   assert.equal(state.bootstrap.ok,true);
   if(n===0)await page.reload();
  }
 }finally{await browser.close();}
});
for(const mode of ['text','audio'])test(mode+' tokens remain visible after failed Apply and restore after reload',async()=>{
 const browser=await chromium.launch({headless:true});try{const context=await browser.newContext();let saved=['a'.repeat(64),'b'.repeat(64)];const status=mode==='audio'?{enabled:false,requested:false,setup:false,configured:[true,true],slots:[0,1].map(i=>({label:i?'B':'A',open:false,status:'closed',connected:false,busy:false,error:'',level:i?0:70,db:i?-60:-18}))}:{enabled:true,tokenSetup:false,slots:[0,1].map(i=>({label:i?'B':'A',open:false,status:'closed',connected:false,busy:false,opening:false,epoch:null,messages:[]}))};
 await context.route(base+'/**',async route=>{const url=new URL(route.request().url());let body,type='application/json';if(url.pathname.startsWith('/api/')){if(url.pathname.endsWith('/tokens')){if(route.request().method()==='POST'){saved=JSON.parse(route.request().postData()).tokens;body=JSON.stringify({ok:false,results:[{slot:0,ok:false,error:'Fixture verification required'},{slot:1,ok:false,error:'Fixture verification required'}]});}else body=JSON.stringify({tokens:saved});}else body=JSON.stringify(status);}else{const path=url.pathname==='/'?'index.html':url.pathname==='/audio'?'audio.html':url.pathname.slice(1);body=await readFile(new URL('../public/'+path,import.meta.url),'utf8');type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';}await route.fulfill({body,contentType:type});});
 const page=await context.newPage();await page.goto(base+(mode==='audio'?'/audio':'/'));await page.waitForFunction(()=>document.querySelector('#tokenA').value.length===64);assert.equal(await page.locator('#tokenA').inputValue(),saved[0]);const replacement=['c'.repeat(64),'d'.repeat(64)];await page.locator('#tokenA').fill(replacement[0]);await page.locator('#tokenB').fill(replacement[1]);await page.locator('#applyTokens').click();await page.waitForFunction(()=>document.querySelector('#tokenResult').textContent.includes('Fixture verification'));assert.equal(await page.locator('#tokenA').inputValue(),replacement[0]);assert.equal(await page.locator('#tokenB').inputValue(),replacement[1]);await page.reload();await page.waitForFunction(()=>document.querySelector('#tokenA').value.startsWith('cccc'));assert.equal(await page.locator('#tokenB').inputValue(),replacement[1]);if(mode==='audio'){const meter=page.getByRole('meter',{name:'Уровень звука A'});assert.equal(await meter.getAttribute('aria-valuenow'),'70');assert.equal(await page.locator('#card0 .meterValue').textContent(),'-18 dBFS');assert.equal(await page.getByRole('meter',{name:'Уровень звука B'}).getAttribute('aria-valuenow'),'0');}
 }finally{await browser.close();}
});

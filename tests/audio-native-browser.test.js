import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {AudioHost} from '../audio-host.js';
import {primeVoiceStorage} from '../voice-bootstrap.js';

test('real Chromium input reaches the native field and completes a check in the same token session',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-browser-')),browser=await chromium.launch({headless:true});
 const host=new AudioHost({data:dir,graph:{process:false,close:async()=>{}}});clearInterval(host.timer);await host.loaded;
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  await context.addInitScript(primeVoiceStorage,'native-browser-fixture-token');
  await context.addInitScript({content:await readFile(new URL('../browser/audio-runtime.js',import.meta.url),'utf8')});
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><div id="app"></div><input id="nativeField" style="position:absolute;left:100px;top:100px;width:200px;height:40px"><button id="complete" style="position:absolute;left:100px;top:180px;width:200px;height:40px">Complete fixture check</button><button id="searchCompanyBtn">Start</button><script>
   const state={system:{isAuth:true,socketConnected:true,captchaRequired:true},user:{authToken:JSON.parse(localStorage.getItem('storage_audio_v2')).user.authToken,tokenId:123},chat:{}};
   document.getElementById('app').__vue__={$store:{state}};
   document.getElementById('complete').onclick=()=>{if(document.getElementById('nativeField').value==='fixture answer')state.system.captchaRequired=false;};
  </script>`}));
  const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
  const s=host.slots[0]={browser,context,page,epoch:'native-browser-fixture',profileIdentity:'native-browser-fixture-token',wire:{sentTokenMatches:true,registrationSucceeded:true},status:'verification',connected:false};
  await host.tick();assert.equal(s.paused,true);assert.equal(browser.isConnected(),true);
  let box=await page.locator('#nativeField').boundingBox();
  await host.input(0,{epoch:s.epoch,action:'click',x:(box.x+box.width/2)/1920,y:(box.y+box.height/2)/1080});
  await host.input(0,{epoch:s.epoch,action:'text',text:'fixture answer'});
  assert.equal(await page.locator('#nativeField').inputValue(),'fixture answer');
  await host.input(0,{epoch:s.epoch,action:'key',key:'Control+A'});
  await host.input(0,{epoch:s.epoch,action:'key',key:'ArrowRight'});
  box=await page.locator('#complete').boundingBox();
  await host.input(0,{epoch:s.epoch,action:'click',x:(box.x+box.width/2)/1920,y:(box.y+box.height/2)/1080});
  await host.tick();assert.equal(s.paused,false);assert.equal(s.status,'ready');assert.equal(s.prepared,true);assert.equal(host.requested,false);
  assert.equal(s.tokenInspection.liveTokenMatches,true);assert.equal(s.tokenInspection.savedTokenMatches,true);
  assert.equal(browser.isConnected(),true);assert.equal(host.slots[0],s);
  await assert.rejects(host.input(0,{epoch:'old-browser',action:'text',text:'wrong session'}),/screen changed/);
  assert.equal(await page.locator('#nativeField').inputValue(),'fixture answer');
 }finally{await host.shutdown();await browser.close();await rm(dir,{recursive:true,force:true});}
});

test('storage inspection reads different actual values from isolated Chromium sides',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'storage-browser-')),browser=await chromium.launch({headless:true});
 const host=new AudioHost({data:dir,graph:{process:false,close:async()=>{}}});clearInterval(host.timer);await host.loaded;
 try{
  for(let i=0;i<2;i++){
   const context=await browser.newContext();await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body>Storage fixture</body>'}));
   const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');
   await page.evaluate(token=>localStorage.setItem('storage_audio_v2',JSON.stringify({user:{authToken:token}})),'actual-browser-'+i);
   host.slots[i]={browser:{close:async()=>{}},context,page,epoch:'run-'+i,profileIdentity:'different-configured-'+i};
  }
  for(let i=0;i<2;i++){
   const result=await host.storageToken(i,'run-'+i);assert.equal(result.token,'actual-browser-'+i);assert.equal(result.runId,'different-configured-'+i);assert.equal(result.sessionId,'different-configured-'+i);assert.equal(result.browserEpoch,'run-'+i);assert.equal(JSON.stringify(result).includes('run-'+i),false);
   assert.equal(await host.slots[i].page.evaluate(()=>JSON.parse(localStorage.getItem('storage_audio_v2')).user.authToken),result.token);
  }
 }finally{await host.shutdown();await browser.close();await rm(dir,{recursive:true,force:true});}
});

test('native reload uses the same Chromium context and preserves storage before any search',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reload-browser-')),browser=await chromium.launch({headless:true});
 const host=new AudioHost({data:dir,graph:{process:false,close:async()=>{}}});clearInterval(host.timer);await host.loaded;
 try{
  const context=await browser.newContext();await context.addInitScript(primeVoiceStorage,'reload-fixture-token');
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><script>window.firstToken=JSON.parse(localStorage.getItem("storage_audio_v2")).user.authToken;</script><body>Reload fixture</body>'}));
  const page=await context.newPage();await page.goto('https://nekto-me.kz/audiochat');await page.evaluate(()=>localStorage.setItem('fixture-settings','preserved'));
  const s=host.slots[0]={browser,context,page,epoch:'before-reload',profileIdentity:'reload-fixture-token',prepared:true};
  host.prepare=async()=>{assert.equal(s.bootstrap.ok,true);assert.equal(s.bootstrap.phase,'document-start');s.prepared=true;s.status='ready';return s;};
  const r=await host.reloadPage(0,s.epoch);assert.equal(r.operation,'authorization');assert.equal(host.slots[0].page,page);assert.equal(host.slots[0].context,context);
  assert.equal(await page.evaluate(()=>window.firstToken),'reload-fixture-token');assert.equal(await page.evaluate(()=>localStorage.getItem('fixture-settings')),'preserved');
  assert.equal((await host.storageToken(0,s.epoch)).token,'reload-fixture-token');assert.equal(s.stage,'authorized-no-call');assert.equal(context.pages().length,1);
 }finally{await host.shutdown();await browser.close();await rm(dir,{recursive:true,force:true});}
});

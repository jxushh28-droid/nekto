import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {AudioHost} from '../audio-host.js';

// All pages and requests are local fixtures, never real Nekto sessions.
test('manual screen input drives a real native page without an automatic Start',async()=>{
 const browser=await chromium.launch({headless:true}),dir=await mkdtemp(join(tmpdir(),'audio-control-'));
 const graph={process:false,close:async()=>{}};const host=new AudioHost({data:dir,graph});clearInterval(host.timer);await host.loaded;
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{height:3000px}</style><button id="start" onclick="window.starts++">Start</button><input id="message"><script>window.starts=0;window.enter=0;document.querySelector("input").onkeydown=e=>{if(e.key==="Enter")window.enter++};</script>'}));
  const page=await context.newPage();await page.goto('https://control-native.test/');
  host.slots[0]={page,browser:{close:async()=>{}},manual:true,epoch:'fixture-native'};
  const send=input=>host.control(0,{attemptId:'fixture-native',...input});
  assert.equal(await page.evaluate(()=>window.starts),0);
  for(const selector of ['#start','#message']){const r=await page.locator(selector).boundingBox();await send({type:'click',x:(r.x+r.width/2)/1920,y:(r.y+r.height/2)/1080});}
  await send({type:'text',text:'Привет'});await send({type:'key',key:'Enter'});
  assert.equal(await page.evaluate(()=>window.starts),1);assert.equal(await page.locator('#message').inputValue(),'Привет');assert.equal(await page.evaluate(()=>window.enter),1);
  await send({type:'wheel',x:.8,y:.8,deltaY:400});await page.waitForFunction(()=>window.scrollY>0);
 }finally{await host.shutdown();await browser.close();await rm(dir,{recursive:true,force:true});}
});

test('audio dashboard opens manual mode, sends scaled input and enters real fullscreen',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),base='https://control-dashboard.test';
  const fixture=await context.newPage();await fixture.setContent('<body style="margin:0;background:#13251b;color:white"><h1>Native page fixture</h1></body>');const image=await fixture.screenshot({type:'png'});await fixture.close();
  const controls=[],opens=[];let manual=false;
  const status=()=>({enabled:false,setup:false,configured:[manual,false],slots:[{open:manual,manual,interactive:manual,closable:manual,attemptId:manual?'fixture-A':null,status:manual?'ready':'closed',busy:false,connected:false,screenAvailable:manual,level:0,db:-60,error:''},{open:false,status:'closed',busy:false,connected:false,level:0,db:-60}]});
  await context.route(base+'/**',async route=>{
   const request=route.request(),url=new URL(request.url());let body,type='application/json';
   if(url.pathname.endsWith('/screen'))return route.fulfill({body:image,contentType:'image/png',headers:{'X-Screen-Attempt':'fixture-A','X-Screen-Time':String(Date.now())}});
   if(url.pathname.endsWith('/manual')){opens.push(JSON.parse(request.postData()));manual=true;body=JSON.stringify({ok:true,operation:'manual',results:[{slot:0,ok:true}]});}
   else if(url.pathname.endsWith('/control')){controls.push(JSON.parse(request.postData()));body='{"ok":true}';}
   else if(url.pathname.endsWith('/status'))body=JSON.stringify(status());
   else if(url.pathname.endsWith('/tokens'))body=JSON.stringify({tokens:['fixture-token',null]});
   else{const path=url.pathname==='/audio'?'audio.html':url.pathname.slice(1);body=await readFile(new URL('../public/'+path,import.meta.url),'utf8');type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';}
   await route.fulfill({body,contentType:type});
  });
  const page=await context.newPage();await page.goto(base+'/audio');await page.waitForFunction(()=>document.querySelector('#tokenA').value==='fixture-token');
  await page.locator('#manualTokenA').click();await page.waitForFunction(()=>document.querySelector('#card0 .screenImage').naturalWidth>0&&document.querySelector('#card0 .screenControl').getAttribute('aria-pressed')==='true');
  assert.deepEqual(opens,[{token:'fixture-token'}]);assert.equal(await page.locator('#card0 .connect').isDisabled(),true);
  await page.locator('#card0 .screenFullscreen').click();await page.waitForFunction(()=>document.fullscreenElement===document.querySelector('#card0 .nativeScreen'));
  const box=await page.locator('#card0 .screenImage').boundingBox();assert.ok(box.height<900&&box.width<=1280);
  await page.mouse.click(box.x+box.width*.25,box.y+box.height*.75);
  await page.waitForFunction(()=>document.querySelector('#error').textContent==='' );
  await page.locator('#card0 .screenText').fill('Привет');await page.locator('#card0 .screenType').click();await page.locator('#card0 .screenEnter').click();
  await page.waitForTimeout(300);
  assert.equal(controls[0].attemptId,'fixture-A');assert.equal(controls[0].type,'click');assert.ok(Math.abs(controls[0].x-.25)<.005&&Math.abs(controls[0].y-.75)<.005);
  assert.ok(controls.some(x=>x.type==='text'&&x.text==='Привет'));assert.ok(controls.some(x=>x.type==='key'&&x.key==='Enter'));
  await page.locator('#card0 .screenStage').focus();await page.keyboard.press('a');await page.waitForTimeout(200);assert.ok(controls.some(x=>x.type==='text'&&x.text==='a'));
  await page.locator('#card0 .screenControl').click();const before=controls.length;await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);await page.waitForTimeout(200);assert.equal(controls.length,before);
  await page.locator('#card0 .screenFullscreen').click();await page.waitForFunction(()=>document.fullscreenElement===null);
 }finally{await browser.close();}
});

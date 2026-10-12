import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {ProviderVideoHost} from '../provider-video-host.js';

for(const provider of ['umingle','chatruletka'])test(provider+' uses its native Start and isolated session without changing unrelated pages',async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']}),data=await mkdtemp(join(tmpdir(),'provider-browser-'));
 const original=browser.newContext.bind(browser);
 browser.newContext=async options=>{
  const context=await original(options);
  await context.route('**/*',route=>{
   const origin=new URL(route.request().url()).origin;
   if(origin==='https://unrelated.test')return route.fulfill({contentType:'text/html',body:'<p>Unrelated page</p>'});
   const controls=provider==='umingle'
    ?'<video id="myVideo" autoplay muted></video><video id="otherVideo" autoplay muted></video><div id="info"></div><button class="skipButton" id="start">Start <span>Esc</span></button><textarea class="messageInput"></textarea>'
    :'<video id="local-video" autoplay muted></video><video id="remote-video" autoplay muted></video><div class="btn btn-main" id="start"><span data-tr="start" style="pointer-events:none">Start</span></div><input id="chat-text"><div id="notice"></div>';
   const script=`<script>window.starts=0;navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(async stream=>{const local=document.querySelector('video');local.srcObject=stream;await local.play();});document.getElementById('start').onclick=()=>{window.starts++;${provider==='umingle'?"document.getElementById('info').textContent='Searching…';":"document.getElementById('notice').innerHTML='<span data-tr=searching>Searching…</span>';"}};</script>`;
   return route.fulfill({contentType:'text/html',body:controls+script});
  });
  return context;
 };
 const host=new ProviderVideoHost({data,getBrowser:async()=>browser});clearInterval(host.timer);
 try{
  await host.selectProvider(provider);await host.start(0);await host.start(0);await host.start(1);
  assert.notEqual(host.slots[0].context,host.slots[1].context);
  for(const slot of host.slots){assert.equal(await slot.page.evaluate(()=>window.starts),1);assert.equal(slot.status,'searching');}
  const unrelated=await host.slots[0].context.newPage();await unrelated.goto('https://unrelated.test/');
  assert.deepEqual(await unrelated.evaluate(()=>({runtime:!!window.__videoHost,config:!!window.__videoHostConfig,nativeMicrophone:navigator.mediaDevices.getUserMedia.toString().includes('[native code]')})),{runtime:false,config:false,nativeMicrophone:true});await unrelated.close();
  // Generated tracks exercise connection and consent without contacting users.
  for(let i=0;i<2;i++)await host.slots[i].page.evaluate(async i=>window.__videoHost.fixture(i?'#0000ff':'#ff0000',i?660:440),i);
  await host.tick();assert.equal(host.slots.every(slot=>slot.connected),true);assert.equal(host.enabled,false);
  await host.toggle(true,true);assert.equal(host.enabled,true);
  await host.slots[0].page.evaluate(provider=>{if(provider==='umingle')document.getElementById('info').textContent='VPN Detected';else document.getElementById('notice').innerHTML='<span data-tr="youre-banned">You are banned</span>';},provider);
  await host.tick();assert.equal(host.enabled,false);assert.equal(host.slots[0].connected,false);assert.equal(await host.slots[0].page.evaluate(()=>window.starts),1);
 }finally{await host.shutdown();await browser.close();await rm(data,{recursive:true,force:true});}
});

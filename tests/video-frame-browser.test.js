import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {VideoHost} from '../video-host.js';
test('real Chromium follows replaced OmeTV fixture iframe after each session application',async()=>{
 const data=await mkdtemp(join(tmpdir(),'video-frame-')),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const host=new VideoHost({data,getBrowser:async()=>({newContext:async options=>{
  const context=await browser.newContext(options);
  await context.route('https://ometv.chat/**',async route=>{
   const embed=new URL(route.request().url()).pathname==='/embed/index.html';
   const html=embed?`<!doctype html><body><video id="local-video"></video><input id="chat-text"><button id="start">Start</button><script>
    window.__videoHost={status:()=>({mediaReady:true,login:false,verification:false,connected:false})};
    window.addEventListener('message',e=>{if(e.data?.source==='sn')parent.postMessage({replace:true},'https://ometv.chat')});
    document.getElementById('start').onclick=()=>parent.postMessage({started:true},'https://ometv.chat');
   </script>`:`<!doctype html><body><iframe id="videochat" src="/embed/index.html"></iframe><script>
    window.fixtureApplies=0;window.fixtureStarted=0;
    window.addEventListener('message',e=>{
     if(e.data?.replace){window.fixtureApplies++;const old=document.getElementById('videochat');const fresh=document.createElement('iframe');fresh.id='videochat';fresh.src='/embed/index.html';old.replaceWith(fresh);}
     if(e.data?.started)window.fixtureStarted++;
    });
   </script>`;
   await route.fulfill({contentType:'text/html',body:html});
  });
  return context;
 }})});
 try{
  await host.sessionsLoaded;host.sessions[0]={token:'fixture-token',SnDataStr:'fixture-signed-data',SnHmac:'fixture-signature'};
  await host.start(0);
  await host.slots[0].page.waitForFunction(()=>window.fixtureStarted===1,{},{timeout:5000});
  const result=await host.slots[0].page.evaluate(()=>({applications:window.fixtureApplies,starts:window.fixtureStarted}));
  assert.deepEqual(result,{applications:2,starts:1});
 }finally{await host.shutdown();await browser.close();await rm(data,{recursive:true,force:true});}
});

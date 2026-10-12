import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBrowserIp} from '../browser-ip.js';
import {AudioHost} from '../audio-host.js';
import {chromium} from 'playwright';

function contextFixture({ip='203.0.113.10',ok=true,fail=false,hold}={}){
 let pages=0,closed=0;
 return {context:{async newPage(){pages++;return {async goto(url,options){
  assert.equal(url,'https://api64.ipify.org?format=json');assert.equal(options.timeout,10000);
  if(hold)await hold;if(fail)throw Error('network unavailable');
  return {ok:()=>ok,text:async()=>JSON.stringify({ip})};
 },async close(){closed++;}};}},get pages(){return pages;},get closed(){return closed;}};
}
function hostFixture(context){
 // The lookup needs the existing browser only, without preparing or starting calls.
 const host=Object.create(AudioHost.prototype);
 Object.assign(host,{slots:[{context,epoch:'a',connected:true,status:'connected'},null],ipRequests:new WeakMap(),ops:new Set(),setup:false,clients:[new Set(),new Set()],screens:[null,null],attempts:[null,null]});
 return host;
}
test('browser IP lookup accepts IPv4/IPv6 and closes its temporary tab even on failure',async()=>{
 for(const ip of ['203.0.113.10','2001:db8::1']){const f=contextFixture({ip});assert.equal(await readBrowserIp(f.context),ip);assert.equal(f.closed,1);}
 for(const options of [{ip:'<script>bad</script>'},{ok:false},{fail:true}]){const f=contextFixture(options);await assert.rejects(readBrowserIp(f.context));assert.equal(f.closed,1);}
});
test('audio IP check uses the selected browser and keeps call state and polling available',async()=>{
 const a=contextFixture(),b=contextFixture({ip:'203.0.113.11'}),host=hostFixture(a.context);
 host.slots[1]={context:b.context,epoch:'b',connected:true,status:'connected'};
 const original=host.slots[1];const result=await host.checkIp(1,'b');
 assert.equal(result.ip,'203.0.113.11');assert.equal(result.epoch,'b');assert.equal(a.pages,0);assert.equal(b.pages,1);
 assert.equal(host.slots[1],original);assert.equal(original.connected,true);assert.equal(original.status,'connected');assert.equal(host.ops.size,0);
 assert.equal(host.status().slots[1].browserIp.ip,result.ip);assert.equal(host.status().slots[0].browserIp,null);
});
test('simultaneous checks share a request and stale results cannot reach a new browser',async()=>{
 let release;const hold=new Promise(r=>release=r),f=contextFixture({hold}),host=hostFixture(f.context),old=host.slots[0];
 const first=host.checkIp(0,'a'),second=host.checkIp(0,'a');
 await assert.rejects(host.checkIp(0,'stale'),/session changed/);
 assert.equal(f.pages,1);assert.equal(host.ops.size,0);
 host.slots[0]={context:f.context,epoch:'new'};release();
 const results=await Promise.allSettled([first,second]);assert.ok(results.every(x=>x.status==='rejected'&&/session changed/.test(x.reason.message)));
 assert.equal(old.browserIp,undefined);assert.equal(host.slots[0].browserIp,undefined);assert.equal(f.closed,1);
});
test('closed/busy browsers do not make requests, and failed checks never retain an old address',async()=>{
 const f=contextFixture({fail:true}),host=hostFixture(f.context);
 await assert.rejects(host.checkIp(1,'b'),/browser is closed/);
 host.ops.add(0);await assert.rejects(host.checkIp(0,'a'),/busy/);host.ops.delete(0);assert.equal(f.pages,0);
 host.slots[0].browserIp={ip:'203.0.113.9',epoch:'a'};
 await assert.rejects(host.checkIp(0,'a'),/could not be checked/);assert.equal(host.status().slots[0].browserIp.ip,null);assert.equal(host.slots[0].connected,true);
 host.slots[0].epoch='reloaded';assert.equal(host.status().slots[0].browserIp,null);
});
test('Chromium checks the same context and leaves both native chat tabs untouched',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const ip of ['203.0.113.10','2001:db8::1']){
   const context=await browser.newContext();
   await context.route('https://nekto-me.kz/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Native chat fixture</h1>'}));
   await context.route('https://api64.ipify.org/**',route=>route.fulfill({json:{ip}}));
   const native=await context.newPage();await native.goto('https://nekto-me.kz/audiochat#/');
   assert.equal(await readBrowserIp(context),ip);
   assert.deepEqual(context.pages(),[native]);assert.equal(native.url(),'https://nekto-me.kz/audiochat#/');
   await context.close();
  }
 }finally{await browser.close();}
});

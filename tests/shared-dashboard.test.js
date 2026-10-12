import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import {parseHTML} from 'linkedom';
async function fixture(){
  const {window,document}=parseHTML(await readFile(new URL('../public/index.html',import.meta.url),'utf8')),requests=[];
  const status={enabled:true,slots:[0,1].map(i=>({label:i?'B':'A',epoch:i?'b':'a',connected:true,open:true,status:'connected',messages:[]}))};
  let rejectSend=false,release;
  const fetch=async(path,request)=>{requests.push({path,request});if(path==='/api/send'&&release)await new Promise(r=>release(r));return {ok:!(path==='/api/send'&&rejectSend),status:200,json:async()=>path==='/api/status'?status:path==='/api/tokens'?{tokens:['','']}:path==='/api/send'&&rejectSend?{error:'The conversation changed.'}:{ok:true}};};
  const context={window,document,fetch,setInterval:()=>0,JSON,Date,Map,Set};vm.runInNewContext(await readFile(new URL('../public/app.js',import.meta.url),'utf8'),context);
  await new Promise(r=>setImmediate(r));return {document,status,requests,context,refresh:()=>vm.runInNewContext('refresh()',context),reject:()=>rejectSend=true,delay:fn=>release=fn};
}
test('shared feed deduplicates a broadcast, preserves eye identity and renders text without HTML',async()=>{
  const f=await fixture();for(let i=0;i<2;i++)f.status.slots[i].messages=[{id:1,kind:'incoming',text:'<img src=x onerror=alert(1)>',time:1+i},{id:2,broadcastId:'both',kind:'private',text:'Привет обоим',delivery:'sent',time:3},{id:3,kind:'relay',text:'already shown',time:4}];await f.refresh();
  assert.equal(f.document.querySelectorAll('.sharedFeed .messageRow').length,3);assert.equal(f.document.querySelectorAll('.sharedFeed .own').length,1);assert.equal(f.document.querySelectorAll('.sharedFeed .messageEye').length,2);assert.equal(f.document.querySelector('.own .meta').textContent,'Вы → A + B');assert.equal(f.document.querySelectorAll('.sharedFeed img[src="x"]').length,0);assert.equal(f.document.querySelectorAll('#hub textarea').length,1);
});
test('Enter sends one shared request with both conversation epochs; IME and Shift+Enter do not send',async()=>{
  const f=await fixture(),editor=f.document.getElementById('message'),form=f.document.getElementById('compose');form.requestSubmit=()=>form.onsubmit({preventDefault(){}});editor.value='one message';let prevented=0;
  editor.onkeydown({key:'Enter',shiftKey:true,preventDefault(){prevented++;}});editor.onkeydown({key:'Enter',isComposing:true,preventDefault(){prevented++;}});assert.equal(prevented,0);
  editor.onkeydown({key:'Enter',preventDefault(){prevented++;}});await new Promise(r=>setImmediate(r));const send=f.requests.filter(r=>r.path==='/api/send');assert.equal(send.length,1);assert.deepEqual(JSON.parse(send[0].request.body),{text:'one message',epochs:['a','b']});assert.equal(editor.value,'');
});
test('a failed broadcast preserves the draft and prevents double submission while waiting',async()=>{
  const f=await fixture(),editor=f.document.getElementById('message'),form=f.document.getElementById('compose');editor.focus=()=>{};editor.value='keep this';f.reject();let release;f.delay(r=>release=r);
  const first=form.onsubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));await form.onsubmit({preventDefault(){}});assert.equal(f.requests.filter(r=>r.path==='/api/send').length,1);release();await first;assert.equal(editor.value,'keep this');assert.equal(f.document.getElementById('error').textContent,'The conversation changed.');
});

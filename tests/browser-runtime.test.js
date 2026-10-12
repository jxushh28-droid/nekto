import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {parseHTML} from 'linkedom';import {Relay} from '../relay.js';
import {startConversation} from '../connection.js';
const source=await readFile(new URL('../browser/adapter.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../browser/runtime.js',import.meta.url),'utf8');
function fixture(){
 const {window,document}=parseHTML('<html><body><section id="conversation"></section><div class="emojionearea-editor" contenteditable="true" aria-disabled="true"></div><button id="sendMessageBtn">Отправить</button></body></html>');
 window.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&this.style.display!=='none'?[{}]:[];};
 const ctx={window:{},document,crypto:{randomUUID:()=>Math.random().toString(36)},location:{hash:'#/conversation'},CSS:{escape:s=>s},Event:window.Event,KeyboardEvent:window.Event,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,WeakMap,WeakSet,setTimeout,clearTimeout,queueMicrotask};vm.createContext(ctx);vm.runInContext(source,ctx);
 const editor=document.querySelector('.emojionearea-editor'),sent=[];
 document.getElementById('sendMessageBtn').addEventListener('click',()=>{sent.push(editor.textContent);const bubble=document.createElement('div');bubble.className='mess_block self';const text=document.createElement('div');text.className='window_chat_dialog_text';text.textContent=editor.textContent;bubble.append(text);document.getElementById('conversation').append(bubble);editor.textContent='';});
 return {document,evaluate:fn=>vm.runInContext('('+fn.toString()+')()',ctx),setHash:hash=>ctx.location.hash=hash,host:ctx.window.__textHost,sent,button:document.getElementById('sendMessageBtn'),connect(){editor.setAttribute('aria-disabled','false');},incoming(value){const bubble=document.createElement('div');bubble.className='mess_block';const text=document.createElement('div');text.className='window_chat_dialog_text';text.textContent=value;bubble.append(text);document.getElementById('conversation').append(bubble);return text;},editor};
}
test('first message at connection is forwarded and outgoing bubbles never loop',async()=>{const a=fixture(),b=fixture(),relay=new Relay();relay.toggle(true);relay.update(0,a.host.poll());relay.update(1,b.host.poll());a.connect();b.connect();a.incoming('first message');const sa=a.host.poll(),sb=b.host.poll();assert.equal(sa.messages.length,1);relay.update(0,sa);relay.update(1,sb);relay.incoming(0,sa.messages[0].text);const delivery=relay.members[1].queue.shift();assert.equal(await b.host.send(delivery.text,delivery.targetEpoch),'submitted');assert.deepEqual(b.sent,['first message']);assert.equal(b.host.poll().messages.length,0);b.incoming('reply');const reply=b.host.poll();relay.incoming(1,reply.messages[0].text);const back=relay.members[0].queue.shift();assert.equal(await a.host.send(back.text,back.targetEpoch),'submitted');assert.deepEqual(a.sent,['reply']);assert.equal(a.host.poll().messages.length,0);});
test('private operator message stays on its selected side',async()=>{const a=fixture(),b=fixture(),relay=new Relay();relay.toggle(true);a.host.poll();b.host.poll();a.connect();b.connect();relay.update(0,a.host.poll());relay.update(1,b.host.poll());relay.enqueue(0,{text:'private message',kind:'private'});assert.equal(relay.members[1].queue.length,0);const item=relay.members[0].queue.shift();assert.equal(await a.host.send(item.text,item.targetEpoch),'submitted');assert.deepEqual(a.sent,['private message']);assert.equal(a.host.poll().messages.length,0);assert.deepEqual(b.sent,[]);});
test('drafts are preserved and stale conversations are rejected',async()=>{const a=fixture();a.host.poll();a.connect();const s=a.host.poll();a.editor.textContent='draft';assert.equal(await a.host.send('relay',s.epoch),'draft');assert.equal(a.editor.textContent,'draft');a.editor.textContent='';a.editor.setAttribute('aria-disabled','true');a.host.poll();a.connect();a.host.poll();assert.equal(await a.host.send('old',s.epoch),'changed');assert.deepEqual(a.sent,[]);});

test('disabled empty Send button is enabled by editor synchronization before sending',async()=>{const a=fixture();a.host.poll();a.connect();const state=a.host.poll();a.button.disabled=true;a.editor.addEventListener('keyup',()=>setTimeout(()=>a.button.disabled=false,120));assert.equal(await a.host.send('message',state.epoch),'submitted');assert.deepEqual(a.sent,['message']);});

test('inactive CAPTCHA container does not block a verified Vuex client',()=>{const a=fixture();a.document.body.__vue__={$store:{state:{system:{captchaRequired:false,hcaptchaRequired:false,isAuth:true}}}};const mask=a.document.createElement('div');mask.id='mask_hcap';a.document.body.append(mask);a.host.poll();a.connect();const state=a.host.poll();assert.equal(state.status,'connected');assert.equal(state.verification.known,true);assert.equal(state.verification.hcaptcha,false);});
test('actual site verification flags stop forwarding even without visible challenge text',()=>{const a=fixture();a.document.body.__vue__={$store:{state:{system:{captchaRequired:false,hcaptchaRequired:true,isAuth:true}}}};a.connect();const state=a.host.poll();assert.equal(state.status,'verification');assert.equal(state.connected,false);assert.equal(state.verification.hcaptcha,true);});
test('transparent CAPTCHA placeholder is ignored by DOM fallback',()=>{const a=fixture();const mask=a.document.createElement('div');mask.id='mask_hcap';mask.style.opacity='0';a.document.body.append(mask);a.host.poll();a.connect();assert.equal(a.host.poll().status,'connected');});
test('visible challenge still blocks when live site flags are unavailable',()=>{const a=fixture();const mask=a.document.createElement('div');mask.id='mask_hcap';a.document.body.append(mask);a.connect();assert.equal(a.host.poll().status,'verification');});
function nativeFixture(){
 const f=fixture(),listeners=new Set(),sent=[];
 const store={state:{system:{isAuth:true,socketConnected:true,captchaRequired:false,hcaptchaRequired:false},user:{tokenModel:{id:7}},chat:{anonDialog:null}},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
 const notify=()=>{for(const fn of [...listeners])fn({type:'chat/addMessage'});};
 f.document.body.__vue__={$store:store,$socketActions:{anonMessage(id,message,randomId){sent.push({id,message});queueMicrotask(()=>{store.state.chat.anonDialog.messages.push({id:100,randomId:String(randomId),senderId:7,message});notify();});}}};
 return {...f,store,nativeSent:sent,dialog(id,messages=[]){store.state.chat.anonDialog={id,messages,close:null};notify();},message(m){store.state.chat.anonDialog.messages.push(m);notify();}};
}
test('Vue conversation works without a DOM composer and preserves exact messages',async()=>{
 const f=nativeFixture();f.editor.remove();f.button.remove();f.host.poll();f.dialog(10,[{id:1,randomId:'one',senderId:8,message:'  original\ntext  '}]);
 const state=f.host.poll();assert.equal(state.connected,true);assert.equal(state.messages[0].text,'  original\ntext  ');
 assert.equal(await f.host.send('private',state.epoch),'confirmed');assert.deepEqual(f.nativeSent,[{id:10,message:'private'}]);assert.equal(f.host.poll().messages.length,0);
 f.message({id:2,randomId:'one',senderId:8,message:'  original\ntext  '});assert.equal(f.host.poll().messages.length,0);
 f.message({id:3,senderId:'7',message:'own echo'});assert.equal(f.host.poll().messages.length,0);
 f.dialog(11);assert.notEqual(f.host.poll().epoch,state.epoch);assert.equal(await f.host.send('stale',state.epoch),'changed');
});
test('actual verification or closed native dialog prevents sending',async()=>{const f=nativeFixture();f.host.poll();f.dialog(10);const s=f.host.poll();f.store.state.system.captchaRequired=true;assert.equal(f.host.poll().connected,false);assert.equal(await f.host.send('blocked',s.epoch),'changed');assert.equal(f.nativeSent.length,0);f.store.state.system.captchaRequired=false;f.store.state.chat.anonDialog.close=1;assert.equal(f.host.poll().status,'ended');});
test('a submitted native message without a server acknowledgement is never confirmed or retried',async()=>{const f=nativeFixture();f.host.poll();f.dialog(10);const state=f.host.poll();let calls=0;f.document.body.__vue__.$socketActions.anonMessage=()=>{calls++;};assert.equal(await f.host.send('original',state.epoch),'unconfirmed');assert.equal(calls,1);});
test('a closed Vue dialog is ended even when the start button remains visible',()=>{const f=nativeFixture();f.host.poll();f.dialog(10);f.host.poll();const start=f.document.createElement('button');start.id='searchCompanyBtn';f.document.body.append(start);f.store.state.chat.anonDialog.close=1;const state=f.host.poll();assert.equal(state.ended,true);assert.equal(state.status,'ended');});

for(const resumesSearch of [true,false])test('text Connect accepts the rules popup and confirms search (native continuation '+resumesSearch+')',async()=>{
 const f=fixture();let starts=0,accepts=0;
 const start=f.document.createElement('button');start.id='searchCompanyBtn';f.document.body.append(start);
 start.addEventListener('click',()=>{
  starts++;
  if(accepts){f.setHash('#/searching');return;}
  const popup=f.document.createElement('div');popup.className='swal2-popup';
  popup.innerHTML='<h2 class="swal2-title">Правила чата "Общение"</h2><p>Запрещено: Рассылать спам, рекламу</p><button class="close">×</button><button class="swal2-confirm">Я принимаю правила</button>';
  popup.querySelector('.swal2-confirm').addEventListener('click',()=>{accepts++;popup.remove();if(resumesSearch)f.setHash('#/searching');});f.document.body.append(popup);
 });
 const page={evaluate:async fn=>f.evaluate(fn),locator(selector){const el=f.document.querySelector(selector);return {isVisible:async()=>!!el?.isConnected,isEnabled:async()=>!el?.disabled,click:async()=>el.click()};}};
 const state=await startConversation(page,{wait:async()=>{}});
 assert.equal(state.status,'searching');assert.equal(accepts,1);assert.equal(starts,resumesSearch?1:2);
});
test('rules acceptance leaves unrelated dialogs and other chat topics untouched',()=>{
 const f=fixture();let clicks=0;
 for(const title of ['Ошибка подключения','Проверка CAPTCHA','Правила чата "18+"']){
  const popup=f.document.createElement('div');popup.className='swal2-popup';popup.innerHTML='<h2></h2><button class="swal2-confirm">Принять</button>';
  popup.querySelector('h2').textContent=title;popup.querySelector('button').addEventListener('click',()=>clicks++);f.document.body.append(popup);
  assert.equal(f.host.acceptRules(),false);popup.remove();
 }
 assert.equal(clicks,0);
});
test('rules acceptance waits for enabled consent and clicks it only once',()=>{
 const f=fixture(),popup=f.document.createElement('div');let clicks=0;
 popup.className='modal';popup.innerHTML='<h4 class="modal-title">Правила чата «Общение»</h4><button>Я согласен с правилами</button>';f.document.body.append(popup);
 const button=popup.querySelector('button');button.disabled=true;button.addEventListener('click',()=>clicks++);
 assert.equal(f.host.acceptRules(),false);button.disabled=false;
 assert.equal(f.host.acceptRules(),true);assert.equal(f.host.acceptRules(),false);assert.equal(clicks,1);
});

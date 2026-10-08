const $=id=>document.getElementById(id),feeds=[null,null],nodes=[new Set(),new Set()],volume=[1,1],enabled=[false,false],schedule=[0,0];let context=null,polling=false,pending=false,restored=false,snapshot=null;
const screenURLs=[null,null],screenPending=[false,false],screenTimes=[0,0];
const screenEpochs=[null,null],screenControl=[false,false];
const statuses={closed:'Не подключён',loading:'Подключаемся…',ready:'Готов',searching:'Ищем собеседника…',connected:'Собеседник подключён',ended:'Собеседник отключился',verification:'Сайт требует проверку',blocked:'Сайт отказал в подключении',attention:'Сайт требует действие',error:'Ошибка'};
async function api(path,data){const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await r.json();if(!r.ok){if(r.status===401){$('login').hidden=false;$('hub').hidden=true;}throw Error(result.error||'Ошибка запроса');}return result;}
function fail(e){$('error').textContent=e.message;}
function stop(i){feeds[i]?.close();feeds[i]=null;for(const n of nodes[i]){try{n.stop();}catch{}}nodes[i].clear();schedule[i]=0;}
function attach(i){if(!enabled[i]||!snapshot?.slots[i]?.open||feeds[i])return;const feed=feeds[i]=new EventSource('/api/audio/'+i+'/stream');feed.onmessage=e=>{if(!enabled[i]||!context||context.state!=='running')return;try{const p=JSON.parse(e.data),raw=atob(p.data),length=Math.floor(raw.length/2),buffer=context.createBuffer(1,length,p.rate),samples=buffer.getChannelData(0);for(let n=0;n<length;n++){let v=raw.charCodeAt(n*2)|(raw.charCodeAt(n*2+1)<<8);if(v>32767)v-=65536;samples[n]=v/32768*volume[i];}const now=context.currentTime;if(schedule[i]<now||schedule[i]>now+.4)schedule[i]=now+.08;const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);nodes[i].add(source);source.onended=()=>nodes[i].delete(source);source.start(schedule[i]);schedule[i]+=buffer.duration;}catch{}};feed.addEventListener('closed',()=>{enabled[i]=false;stop(i);const button=$('card'+i).querySelector('.listen');button.textContent='Слушать '+(i?'B':'A');button.setAttribute('aria-pressed','false');});}
async function refreshScreen(i,x){
 const card=$('card'+i),img=card.querySelector('.screenImage'),hint=card.querySelector('.screenHint');
 if(!x.open&&!x.screenAvailable){img.hidden=true;img.removeAttribute('src');if(screenURLs[i])URL.revokeObjectURL(screenURLs[i]);screenURLs[i]=null;screenEpochs[i]=null;screenTimes[i]=0;hint.textContent='Экран появится после открытия сеанса.';return;}
 if(screenPending[i]||Date.now()-screenTimes[i]<2000)return;
 screenPending[i]=true;screenTimes[i]=Date.now();const epoch=x.attemptId;
 try{
  const r=await fetch('/api/audio/'+i+'/screen',{cache:'no-store'});
  if(r.status===204)return;
  if(!r.ok||!r.headers.get('Content-Type')?.startsWith('image/'))return;
  const blob=await r.blob();if(snapshot?.slots[i]?.attemptId!==epoch)return;
  const previous=screenURLs[i],next=URL.createObjectURL(blob);screenURLs[i]=next;
  screenEpochs[i]=null;
  img.onload=()=>{if(previous)URL.revokeObjectURL(previous);if(screenURLs[i]===next){screenEpochs[i]=r.headers.get('X-Screen-Epoch')||epoch;if(snapshot?.slots[i])updateDevTools(i,snapshot.slots[i]);}};img.src=next;img.hidden=false;
  const at=Number(r.headers.get('X-Screen-Time'));hint.textContent=(x.stopped?'Последний экран перед остановкой':x.paused?'Сеанс сохранён. Завершите проверку на этом экране.':'Экран текущего браузера')+(at?' · '+new Date(at).toLocaleTimeString('ru-RU'):'');
 }catch{hint.textContent='Не удалось получить экран браузера.';}finally{screenPending[i]=false;}
}
const storageSnapshots=[null,null],storagePending=[false,false],storageReadTimes=[0,0];
function updateStorageView(i){
 const card=$('card'+i),x=snapshot?.slots[i],value=storageSnapshots[i];
 if(value&&(!x?.open||value.runId!==x.attemptId))storageSnapshots[i]=null;
 const current=storageSnapshots[i],typed=$('token'+(i?'B':'A')).value.trim();
 card.querySelector('.readStorage').disabled=storagePending[i]||!x?.open||x.storageAvailable===false;
 card.querySelector('.openWithoutSearch').disabled=pending||x?.busy;
 card.querySelector('.reloadNative').disabled=pending||x?.busy||!x?.open;
 card.querySelector('.storageToken').value=current?.token??'';
 card.querySelector('.fieldToken').value=typed;
 const message=card.querySelector('.storageMatch');
 message.textContent=!x?.open?'Откройте браузер без поиска, чтобы увидеть localStorage.':!current?'Нажмите кнопку, чтобы прочитать текущий браузер.':!current.storageReadable?'Не удалось прочитать storage_audio_v2.':current.token===null?'В localStorage нет user.authToken.':!typed?'Введите токен в поле '+(i?'B':'A')+' для сравнения.':current.token===typed?'Совпадает с токеном в поле '+(i?'B':'A')+'.':'НЕ совпадает с токеном в поле '+(i?'B':'A')+'.';
 if(x?.storageAvailable&&!current&&!storagePending[i]&&Date.now()-storageReadTimes[i]>2000)void readStorage(i);
 if(current)message.textContent+=' Снимок браузера '+(i?'B':'A')+' · '+new Date(current.at).toLocaleTimeString('ru-RU')+'. Обновите после Start.';
}
function installStorageView(i){
 const card=$('card'+i);
 card.querySelector('.tokenProof').insertAdjacentHTML('afterend','<section class="storageView"><button class="openWithoutSearch" type="button">Открыть браузер без поиска</button> <button class="reloadNative" type="button">Перезагрузить Nekto</button> <button class="readStorage" type="button">Показать authToken из localStorage</button><p class="help">Текущий браузер Nekto '+(i?'B':'A')+' · storage_audio_v2 → user.authToken</p><label>authToken из браузера<input class="storageToken" readonly autocomplete="off" spellcheck="false"></label><label>Токен из поля '+(i?'B':'A')+'<input class="fieldToken" readonly autocomplete="off" spellcheck="false"></label><p class="storageMatch" role="status"></p></section>');
 $('token'+(i?'B':'A')).addEventListener('input',()=>updateStorageView(i));
 card.querySelector('.openWithoutSearch').onclick=()=>singleTest(i,true);
 card.querySelector('.reloadNative').onclick=()=>{const epoch=snapshot?.slots[i]?.attemptId;if(epoch){storageSnapshots[i]=null;storageReadTimes[i]=0;void run('audio/'+i+'/reload',{epoch});}};
 card.querySelector('.readStorage').onclick=()=>void readStorage(i);
}
async function readStorage(i){
 if(storagePending[i])return;
 const epoch=snapshot?.slots[i]?.attemptId;if(!epoch||!snapshot.slots[i].open)return;
 storagePending[i]=true;storageReadTimes[i]=Date.now();storageSnapshots[i]=null;updateStorageView(i);
 try{
  const result=await api('audio/'+i+'/storage',{epoch});
  if(snapshot?.slots[i]?.attemptId===epoch&&result.open&&result.runId===epoch&&result.slot===i)storageSnapshots[i]=result;
 }catch(e){if(!snapshot?.slots[i]?.busy)fail(e);}finally{storagePending[i]=false;updateStorageView(i);}
}

function updateDevTools(i,x){
 const card=$('card'+i),allowed=!!x.interactive&&!pending&&screenEpochs[i]===x.attemptId;
 const toggle=card.querySelector('.controlToggle');toggle.disabled=!allowed;toggle.setAttribute('aria-pressed',String(screenControl[i]));
 card.querySelector('.screenImage').classList.toggle('controlled',allowed&&screenControl[i]);
 for(const element of card.querySelectorAll('.nativeControls input,.nativeControls button,.nativeControls select'))element.disabled=!allowed||!screenControl[i];
 card.querySelector('.inspect').disabled=pending||x.busy;
 const before=x.callToken?.before,after=x.callToken?.after,current=x.tokenInspection;
 const proof=check=>!check?'ещё не проверен':check.savedTokenMatches&&check.liveTokenMatches?'совпадает':check.clientFound?'не совпадает':'клиент не найден';
 card.querySelector('.callTokenProof').textContent='Токен перед Start: '+proof(before)+'. После Start: '+proof(after)+'. Сейчас: '+proof(current)+'.';
 if(x.paused||!x.open){enabled[i]=false;stop(i);}
}
async function nativeInput(i,data){
 const x=snapshot?.slots[i],epoch=screenEpochs[i];
 if(pending||!screenControl[i]||!x?.interactive)return;
 if(!epoch||epoch!==x.attemptId){fail(Error('Экран обновляется. Дождитесь текущего изображения.'));return;}
 screenTimes[i]=0;await run('audio/'+i+'/input',{epoch,...data});
}
function installDevTools(i){
 const card=$('card'+i),screen=card.querySelector('.nativeScreen'),img=card.querySelector('.screenImage');
 screen.insertAdjacentHTML('beforeend','<details class="devTools"><summary>Инструменты браузера · клики и ввод</summary><p class="help">Управление этим же сеансом Nekto. Нажмите на поле на экране, затем вводите текст здесь. Tab и Enter работают при фокусе на изображении. Проверка выполняется вами на странице Nekto.</p><button class="controlToggle" type="button" aria-pressed="false">Управлять экраном</button><div class="nativeControls"><label>Текст для выбранного поля<input class="nativeText" maxlength="2000" autocomplete="off"></label><button class="typeText" type="button">Ввести текст</button><label>Клавиша<select class="nativeKey"><option>Tab</option><option>Shift+Tab</option><option>Enter</option><option>Space</option><option>Backspace</option><option>Delete</option><option>Escape</option><option>ArrowUp</option><option>ArrowDown</option><option>ArrowLeft</option><option>ArrowRight</option><option>Home</option><option>End</option><option>Control+A</option></select></label><button class="pressKey" type="button">Нажать</button><button class="scrollUp" type="button">Прокрутить вверх</button><button class="scrollDown" type="button">Прокрутить вниз</button></div><p class="callTokenProof"></p><button class="inspect" type="button">Проверить токен и сеанс</button><pre class="diagnostics"></pre></details>');
 img.tabIndex=0;img.setAttribute('aria-label','Экран Nekto '+(i?'B':'A')+' — клики и клавиатура при включённом управлении');
 card.querySelector('.controlToggle').onclick=()=>{screenControl[i]=!screenControl[i];updateDevTools(i,snapshot.slots[i]);};
 img.onclick=e=>{const box=img.getBoundingClientRect();if(!box.width||!box.height)return;img.focus({preventScroll:true});void nativeInput(i,{action:'click',x:(e.clientX-box.left)/box.width,y:(e.clientY-box.top)/box.height});};
 img.onkeydown=e=>{
  if(!screenControl[i]||!snapshot?.slots[i]?.interactive)return;
  const key=e.key===' '?'Space':e.key==='Tab'&&e.shiftKey?'Shift+Tab':(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'?'Control+A':e.key;
  const allowed=['Tab','Shift+Tab','Enter','Space','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Control+A'];
  if(allowed.includes(key)){e.preventDefault();if(!e.repeat)void nativeInput(i,{action:'key',key});}
  else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!e.repeat)void nativeInput(i,{action:'text',text:e.key});}
 };
 card.querySelector('.typeText').onclick=async()=>{const field=card.querySelector('.nativeText'),text=field.value;if(text)await nativeInput(i,{action:'text',text});};
 card.querySelector('.pressKey').onclick=()=>void nativeInput(i,{action:'key',key:card.querySelector('.nativeKey').value});
 card.querySelector('.scrollUp').onclick=()=>void nativeInput(i,{action:'scroll',deltaY:-600});
 card.querySelector('.scrollDown').onclick=()=>void nativeInput(i,{action:'scroll',deltaY:600});
 card.querySelector('.inspect').onclick=async()=>{pending=true;try{const r=await api('audio/'+i+'/inspect',{});card.querySelector('.diagnostics').textContent=JSON.stringify(r.attempt,null,2);}catch(e){fail(e);}finally{pending=false;await refresh();}};
}
async function refresh(){if(polling)return;polling=true;try{const s=await api('audio/status');snapshot=s;$('login').hidden=true;$('hub').hidden=false;if(!restored){const saved=await api('audio/tokens');for(let i=0;i<2;i++)if(!$('token'+(i?'B':'A')).value)$('token'+(i?'B':'A')).value=saved.tokens[i]||'';restored=true;}$('bridge').textContent=s.enabled?'A ↔ B · звук передаётся':'Ожидаем два подключения';$('bridge').className=s.enabled?'active':'';for(const id of ['applyTokens','applyTokenB','applyBoth','checkTokenA','checkTokenB'])$(id).disabled=pending||s.setup||s.slots.some(x=>x.busy);updateConnectBoth();for(let i=0;i<2;i++){const x=s.slots[i],card=$('card'+i);card.querySelector('.state').textContent=statuses[x.status]||x.status;card.querySelector('.issue').textContent=x.error||'';const wire=x.wire||x.lastAttempt?.wire;const applied=x.appliedToken||x.lastAttempt?.appliedToken;card.querySelector('.tokenProof').textContent=(applied?'Загружен токен '+(i?'B':'A')+': '+applied+'. ':'')+(wire?.sentTokenMatches&&wire.registrationSucceeded?'Токен отправлен и принят Nekto.':wire?.registrationSent&&wire.sentTokenMatches===false?'Nekto получил другой токен — звонок не начат.':'');const meter=card.querySelector('.voiceMeter');meter.setAttribute('aria-valuenow',String(x.level||0));meter.querySelector('.meterFill').style.width=(x.level||0)+'%';meter.classList.toggle('speaking',x.connected&&x.db>-45);card.querySelector('.meterValue').textContent=x.level?x.db+' dBFS':'Тишина';card.querySelector('.connect').disabled=pending||x.busy||x.stopped||x.connected||x.status==='searching';card.querySelector('.close').disabled=pending||x.busy||!(x.closable??x.open);updateDevTools(i,x);updateStorageView(i);if(x.open&&!x.paused)attach(i);else stop(i);void refreshScreen(i,x);}}catch(e){if(!$('hub').hidden)fail(e);}finally{polling=false;}}
async function run(path,data={}){pending=true;try{$('error').textContent='';const r=await api(path,data);if(r.results)$('tokenResult').textContent=r.results.map(x=>(x.slot?'B':'A')+': '+(x.ok?(r.operation==='authorization'?'токен подтверждён, звонок не начат':'поиск запущен'):x.error)).join(' · ');}catch(e){fail(e);}finally{pending=false;await refresh();}}
for(let i=0;i<2;i++){const card=document.createElement('article');card.className='chat';card.id='card'+i;card.innerHTML='<div class="chatHeader"><div><h2>Аудио '+(i?'B':'A')+'</h2><div class="state">Не подключён</div></div><div><button class="connect">Подключить</button> <button class="close">Отключить</button></div></div><div class="audioControls"><span class="speaker" aria-hidden="true">◉</span><label>Громкость <span class="number">100%</span><input class="volume" type="range" min="0" max="100" value="100" aria-label="Громкость '+(i?'B':'A')+'"></label><button class="listen" aria-pressed="false">Слушать '+(i?'B':'A')+'</button></div><div class="voiceLevel"><span>Уровень звука <span class="meterValue">Тишина</span></span><div class="voiceMeter" role="meter" aria-label="Уровень звука '+(i?'B':'A')+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="meterFill"></div></div></div><p class="issue"></p><p class="tokenProof"></p><section class="nativeScreen"><h3>Экран Nekto '+(i?'B':'A')+'</h3><img class="screenImage" alt="Страница Nekto сеанса '+(i?'B':'A')+'" hidden><p class="screenHint">Экран появится после открытия сеанса.</p></section>';$('cards').append(card);card.querySelector('.connect').onclick=()=>{const token=$('token'+(i?'B':'A')).value.trim();run('audio/'+i+(token?'/token':'/start'),token?{token}:{});};card.querySelector('.close').onclick=()=>run('audio/'+i+'/close');card.querySelector('.volume').oninput=e=>{volume[i]=Number(e.target.value)/100;card.querySelector('.number').textContent=e.target.value+'%';};card.querySelector('.listen').onclick=async e=>{try{context||=new AudioContext();await context.resume();enabled[i]=!enabled[i];e.target.textContent=enabled[i]?'Не слушать '+(i?'B':'A'):'Слушать '+(i?'B':'A');e.target.setAttribute('aria-pressed',String(enabled[i]));if(enabled[i])attach(i);else stop(i);}catch(e){fail(e);}};}
for(let i=0;i<2;i++){installDevTools(i);installStorageView(i);}
$('reloadDashboard').onclick=()=>location.reload();
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';await refresh();}catch(e){fail(e);}};
function singleTest(i,check=false){const token=$('token'+(i?'B':'A')).value.trim();if(!token){fail(Error('Введите токен '+(i?'B':'A')));return;}run('audio/'+i+(check?'/check':'/token'),{token});}
$('tokenForm').onsubmit=e=>{e.preventDefault();singleTest(0);};
$('applyTokenB').onclick=()=>singleTest(1);
$('checkTokenA').onclick=()=>singleTest(0,true);$('checkTokenB').onclick=()=>singleTest(1,true);
$('applyBoth').onclick=()=>run('audio/tokens',{tokens:[$('tokenA').value.trim(),$('tokenB').value.trim()],consent:$('consent').checked});
function updateConnectBoth(){const s=snapshot;const ready=[0,1].every(i=>$('token'+(i?'B':'A')).value.trim()||s?.configured[i]);$('connectBoth').disabled=pending||!s||s.setup||s.slots.some(x=>x.busy)||!ready||s.slots.every(x=>x.connected);}
for(const id of ['tokenA','tokenB'])$(id).addEventListener('input',updateConnectBoth);
$('connectBoth').onclick=async()=>{if(pending)return;pending=true;updateConnectBoth();const tokens=[$('tokenA').value.trim(),$('tokenB').value.trim()];try{if(!tokens.every(Boolean)){const saved=await api('audio/tokens');for(let i=0;i<2;i++)tokens[i]||=saved.tokens[i];}await run('audio/tokens',{tokens,consent:$('consent').checked});}catch(e){pending=false;fail(e);await refresh();}};$('consent').onchange=()=>run('audio/consent',{consent:$('consent').checked});setInterval(()=>{if(!document.hidden)void refresh();},1000);void refresh();

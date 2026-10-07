const $=id=>document.getElementById(id),feeds=[null,null],nodes=[new Set(),new Set()],volume=[1,1],enabled=[false,false],schedule=[0,0];let context=null,polling=false,pending=false,restored=false,snapshot=null;
const screenURLs=[null,null],screenPending=[false,false],screenTimes=[0,0],screenEpochs=[null,null],controlEnabled=[false,false],inputQueues=[Promise.resolve(),Promise.resolve()],queuedInputs=[0,0];
const statuses={closed:'Не подключён',loading:'Подключаемся…',ready:'Готов',searching:'Ищем собеседника…',connected:'Собеседник подключён',ended:'Собеседник отключился',verification:'Сайт требует проверку',blocked:'Сайт отказал в подключении',attention:'Сайт требует действие',error:'Ошибка'};
function updateScreenControls(i,x){
 const card=$('card'+i),active=controlEnabled[i]&&x.interactive===true;
 if(!x.open||!x.manual)controlEnabled[i]=false;
 const toggle=card.querySelector('.screenControl');toggle.disabled=!x.interactive;toggle.setAttribute('aria-pressed',String(active));toggle.textContent=active?'Управление включено':'Управлять';
 card.querySelector('.screenStage').classList.toggle('controllable',active);
 for(const selector of ['.screenText','.screenType','.screenEnter','.screenTab','.screenBackspace'])card.querySelector(selector).disabled=!active;
 card.querySelector('.screenFullscreen').disabled=!x.open&&!x.screenAvailable;
}
function sendScreenInput(i,event){
 const x=snapshot?.slots[i],attemptId=screenEpochs[i];
 if(!controlEnabled[i]||!x?.interactive||!attemptId||attemptId!==x.attemptId)return;
 if(queuedInputs[i]>=30){fail(Error('Подождите: экран обрабатывает ввод.'));return;}
 queuedInputs[i]++;
 inputQueues[i]=inputQueues[i].catch(()=>{}).then(async()=>{
  if(!controlEnabled[i]||snapshot?.slots[i]?.attemptId!==attemptId)return;
  await api('audio/'+i+'/control',{attemptId,...event});
  screenTimes[i]=0;void refreshScreen(i,snapshot.slots[i]);
 }).catch(fail).finally(()=>queuedInputs[i]--);
}
function bindScreenControls(i,card){
 const native=card.querySelector('.nativeScreen'),stage=card.querySelector('.screenStage'),image=card.querySelector('.screenImage'),text=card.querySelector('.screenText');
 const active=()=>controlEnabled[i]&&snapshot?.slots[i]?.interactive;
 const point=e=>{const r=image.getBoundingClientRect();return r.width&&r.height?{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}:null;};
 card.querySelector('.screenControl').onclick=()=>{controlEnabled[i]=!controlEnabled[i];updateScreenControls(i,snapshot.slots[i]);if(controlEnabled[i])stage.focus();};
 card.querySelector('.screenFullscreen').onclick=async()=>{try{if(document.fullscreenElement===native)await document.exitFullscreen();else await native.requestFullscreen();stage.focus();}catch{fail(Error('Браузер не разрешил полноэкранный режим.'));}};
 document.addEventListener('fullscreenchange',()=>{card.querySelector('.screenFullscreen').textContent=document.fullscreenElement===native?'Выйти из полного экрана':'На весь экран';});
 image.onclick=e=>{if(!active())return;stage.focus();const p=point(e);if(p)sendScreenInput(i,{type:'click',...p});};
 let wheelTimer=null,wheelDelta=0,wheelPoint=null;
 image.addEventListener('wheel',e=>{if(!active())return;e.preventDefault();wheelPoint=point(e);wheelDelta=Math.max(-1600,Math.min(1600,wheelDelta+e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?600:1)));if(!wheelTimer)wheelTimer=setTimeout(()=>{if(wheelPoint)sendScreenInput(i,{type:'wheel',...wheelPoint,deltaY:wheelDelta});wheelTimer=null;wheelDelta=0;},80);},{passive:false});
 stage.addEventListener('keydown',e=>{
  if(!active()||e.isComposing||e.key==='Escape')return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v')return;
  if(e.altKey)return;
  let key=e.key;
  if(e.ctrlKey||e.metaKey){if(!['a','ArrowLeft','ArrowRight','Home','End'].includes(key))return;key='Control+'+key;}
  else if(key==='Tab'&&e.shiftKey)key='Shift+Tab';
  else if(key.length===1){e.preventDefault();sendScreenInput(i,{type:'text',text:key});return;}
  else if(!['Enter','Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(key))return;
  e.preventDefault();sendScreenInput(i,{type:'key',key});
 });
 stage.addEventListener('paste',e=>{if(!active())return;e.preventDefault();const value=e.clipboardData?.getData('text/plain');if(value)sendScreenInput(i,{type:'text',text:value.slice(0,2000)});});
 const type=()=>{if(text.value){sendScreenInput(i,{type:'text',text:text.value});text.value='';}};
 card.querySelector('.screenType').onclick=type;text.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();type();}};
 for(const [selector,key] of [['.screenEnter','Enter'],['.screenTab','Tab'],['.screenBackspace','Backspace']])card.querySelector(selector).onclick=()=>sendScreenInput(i,{type:'key',key});
}
async function api(path,data){const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await r.json();if(!r.ok){if(r.status===401){$('login').hidden=false;$('hub').hidden=true;}throw Error(result.error||'Ошибка запроса');}return result;}
function fail(e){$('error').textContent=e.message;}
function stop(i){feeds[i]?.close();feeds[i]=null;for(const n of nodes[i]){try{n.stop();}catch{}}nodes[i].clear();schedule[i]=0;}
function attach(i){if(!enabled[i]||!snapshot?.slots[i]?.open||feeds[i])return;const feed=feeds[i]=new EventSource('/api/audio/'+i+'/stream');feed.onmessage=e=>{if(!enabled[i]||!context||context.state!=='running')return;try{const p=JSON.parse(e.data),raw=atob(p.data),length=Math.floor(raw.length/2),buffer=context.createBuffer(1,length,p.rate),samples=buffer.getChannelData(0);for(let n=0;n<length;n++){let v=raw.charCodeAt(n*2)|(raw.charCodeAt(n*2+1)<<8);if(v>32767)v-=65536;samples[n]=v/32768*volume[i];}const now=context.currentTime;if(schedule[i]<now||schedule[i]>now+.4)schedule[i]=now+.08;const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);nodes[i].add(source);source.onended=()=>nodes[i].delete(source);source.start(schedule[i]);schedule[i]+=buffer.duration;}catch{}};feed.addEventListener('closed',()=>{enabled[i]=false;stop(i);const button=$('card'+i).querySelector('.listen');button.textContent='Слушать '+(i?'B':'A');button.setAttribute('aria-pressed','false');});}
async function refreshScreen(i,x){
 const card=$('card'+i),img=card.querySelector('.screenImage'),hint=card.querySelector('.screenHint');
 if(!x.open&&!x.screenAvailable){img.hidden=true;img.removeAttribute('src');if(screenURLs[i])URL.revokeObjectURL(screenURLs[i]);screenURLs[i]=null;screenTimes[i]=0;screenEpochs[i]=null;hint.textContent='Экран появится после открытия сеанса.';return;}
 if(screenPending[i]||Date.now()-screenTimes[i]<(controlEnabled[i]?500:2000))return;
 screenPending[i]=true;screenTimes[i]=Date.now();const epoch=x.attemptId;
 try{
  const r=await fetch('/api/audio/'+i+'/screen',{cache:'no-store'});
  if(r.status===204)return;
  if(!r.ok||!r.headers.get('Content-Type')?.startsWith('image/'))return;
  const responseEpoch=r.headers.get('X-Screen-Attempt')||epoch;const blob=await r.blob();if(snapshot?.slots[i]?.attemptId!==epoch||responseEpoch!==epoch)return;
  const previous=screenURLs[i],next=URL.createObjectURL(blob);screenURLs[i]=next;
  img.onload=()=>{screenEpochs[i]=epoch;if(previous)URL.revokeObjectURL(previous);};img.src=next;img.hidden=false;
  const at=Number(r.headers.get('X-Screen-Time'));hint.textContent=(x.stopped?'Последний экран перед остановкой':(x.manual?'Экран браузера · ручной режим':'Экран браузера · только просмотр'))+(at?' · '+new Date(at).toLocaleTimeString('ru-RU'):'');
 }catch{hint.textContent='Не удалось получить экран браузера.';}finally{screenPending[i]=false;}
}
async function refresh(){if(polling)return;polling=true;try{const s=await api('audio/status');snapshot=s;$('login').hidden=true;$('hub').hidden=false;if(!restored){const saved=await api('audio/tokens');for(let i=0;i<2;i++)if(!$('token'+(i?'B':'A')).value)$('token'+(i?'B':'A')).value=saved.tokens[i]||'';restored=true;}$('bridge').textContent=s.enabled?'A ↔ B · звук передаётся':'Ожидаем два подключения';$('bridge').className=s.enabled?'active':'';for(const id of ['applyTokens','applyTokenB','applyBoth','checkTokenA','checkTokenB','manualTokenA','manualTokenB'])$(id).disabled=pending||s.setup||s.slots.some(x=>x.busy);$('connectBoth').disabled=pending||s.setup||s.slots.some(x=>x.busy)||!s.configured.every(Boolean)||s.slots.some(x=>x.manual)||s.slots.every(x=>x.connected);for(let i=0;i<2;i++){const x=s.slots[i],card=$('card'+i);card.querySelector('.state').textContent=statuses[x.status]||x.status;card.querySelector('.issue').textContent=x.error||'';const meter=card.querySelector('.voiceMeter');meter.setAttribute('aria-valuenow',String(x.level||0));meter.querySelector('.meterFill').style.width=(x.level||0)+'%';meter.classList.toggle('speaking',x.connected&&x.db>-45);card.querySelector('.meterValue').textContent=x.level?x.db+' dBFS':'Тишина';card.querySelector('.connect').disabled=pending||x.busy||x.stopped||x.manual||x.connected||x.status==='searching';card.querySelector('.close').disabled=pending||x.busy||!(x.closable??x.open);if(x.open)attach(i);else stop(i);updateScreenControls(i,x);void refreshScreen(i,x);}}catch(e){if(!$('hub').hidden)fail(e);}finally{polling=false;}}
async function run(path,data={}){pending=true;try{$('error').textContent='';const r=await api(path,data);if(r.operation==='manual'&&r.ok){for(const x of r.results)controlEnabled[x.slot]=true;}if(r.results)$('tokenResult').textContent=r.results.map(x=>(x.slot?'B':'A')+': '+(x.ok?(r.operation==='manual'?'открыт ручной режим — нажмите Start на экране':r.operation==='authorization'?'токен подтверждён, звонок не начат':'поиск запущен'):x.error)).join(' · ');}catch(e){fail(e);}finally{pending=false;await refresh();}}
for(let i=0;i<2;i++){const card=document.createElement('article');card.className='chat';card.id='card'+i;card.innerHTML='<div class="chatHeader"><div><h2>Аудио '+(i?'B':'A')+'</h2><div class="state">Не подключён</div></div><div><button class="connect">Подключить</button> <button class="close">Отключить</button></div></div><div class="audioControls"><span class="speaker" aria-hidden="true">◉</span><label>Громкость <span class="number">100%</span><input class="volume" type="range" min="0" max="100" value="100" aria-label="Громкость '+(i?'B':'A')+'"></label><button class="listen" aria-pressed="false">Слушать '+(i?'B':'A')+'</button></div><div class="voiceLevel"><span>Уровень звука <span class="meterValue">Тишина</span></span><div class="voiceMeter" role="meter" aria-label="Уровень звука '+(i?'B':'A')+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="meterFill"></div></div></div><p class="issue"></p><section class="nativeScreen"><div class="screenToolbar"><h3>Экран Nekto '+(i?'B':'A')+'</h3><button class="screenControl" type="button" aria-pressed="false">Управлять</button><button class="screenFullscreen" type="button">На весь экран</button></div><div class="screenStage" tabindex="0" aria-label="Управление страницей Nekto '+(i?'B':'A')+'"><img class="screenImage" alt="Страница Nekto сеанса '+(i?'B':'A')+'" draggable="false" hidden></div><div class="screenTyping"><input class="screenText" type="text" autocomplete="off" maxlength="2000" placeholder="Текст в выбранное поле Nekto" aria-label="Текст для Nekto"><button class="screenType" type="button">Ввести</button><button class="screenEnter" type="button">Enter</button><button class="screenTab" type="button">Tab</button><button class="screenBackspace" type="button">⌫</button></div><p class="screenHint">Экран появится после открытия сеанса.</p></section>';$('cards').append(card);bindScreenControls(i,card);card.querySelector('.connect').onclick=()=>run('audio/'+i+'/start');card.querySelector('.close').onclick=()=>run('audio/'+i+'/close');card.querySelector('.volume').oninput=e=>{volume[i]=Number(e.target.value)/100;card.querySelector('.number').textContent=e.target.value+'%';};card.querySelector('.listen').onclick=async e=>{try{context||=new AudioContext();await context.resume();enabled[i]=!enabled[i];e.target.textContent=enabled[i]?'Не слушать '+(i?'B':'A'):'Слушать '+(i?'B':'A');e.target.setAttribute('aria-pressed',String(enabled[i]));if(enabled[i])attach(i);else stop(i);}catch(e){fail(e);}};}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';await refresh();}catch(e){fail(e);}};
function singleTest(i,check=false,manual=false){const token=$('token'+(i?'B':'A')).value.trim();if(!token){fail(Error('Введите токен '+(i?'B':'A')));return;}run('audio/'+i+(manual?'/manual':check?'/check':'/token'),{token});}
$('tokenForm').onsubmit=e=>{e.preventDefault();singleTest(0);};
$('applyTokenB').onclick=()=>singleTest(1);
$('manualTokenA').onclick=()=>singleTest(0,false,true);$('manualTokenB').onclick=()=>singleTest(1,false,true);
$('checkTokenA').onclick=()=>singleTest(0,true);$('checkTokenB').onclick=()=>singleTest(1,true);
$('applyBoth').onclick=()=>run('audio/tokens',{tokens:[$('tokenA').value.trim(),$('tokenB').value.trim()],consent:$('consent').checked});
$('connectBoth').onclick=()=>run('audio/connect',{consent:$('consent').checked});$('consent').onchange=()=>run('audio/consent',{consent:$('consent').checked});setInterval(()=>{if(!document.hidden)void refresh();},1000);void refresh();

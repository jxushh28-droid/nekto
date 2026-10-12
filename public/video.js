const $=id=>document.getElementById(id),players=[],feeds=[],pending=new Set(),screenUrls=[null,null],screenEpochs=[null,null],screenPending=[false,false],screenTimes=[0,0];
let current=null,polling=false,restoredProvider=null;
const names={closed:'Не подключён',ended:'Участник отключился',loading:'Загружаем…',starting:'Запускаем поиск…',login:'Нужен вход на сайте',ready:'Готов к поиску',searching:'Ищем участника…',connected:'На связи',verification:'Сайт требует проверку',attention:'Сайт ожидает ответ',error:'Подключение не удалось'};
async function api(path,body){const res=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(res.status===401){$('login').hidden=false;$('videoHub').hidden=true;}const result=await res.json();if(!res.ok)throw Error(result.error||'Ошибка запроса');return result;}
function fail(e){$('error').textContent=e.message;}
function attach(i,open){if(open&&!feeds[i]){const feed=feeds[i]=new EventSource('/api/video/'+i+'/stream');feed.onmessage=e=>{if(feeds[i]!==feed)return;try{players[i].push(JSON.parse(e.data));}catch{}};feed.addEventListener('closed',()=>{feed.close();if(feeds[i]!==feed)return;feeds[i]=null;players[i].dispose();});}else if(!open&&feeds[i]){feeds[i].close();feeds[i]=null;players[i].dispose();}}
async function screen(i){
  const slot=current?.slots[i],details=$('videoCard'+i).querySelector('.nativeVideo');if(!slot?.open||!details.open||screenPending[i]||Date.now()-screenTimes[i]<1500)return;
  screenPending[i]=true;screenTimes[i]=Date.now();try{const res=await fetch('/api/video/'+i+'/screen');if(!res.ok||res.status===204)return;
    const epoch=res.headers.get('X-Video-Epoch'),blob=await res.blob();if(current?.slots[i]?.epoch!==epoch)return;
    const img=details.querySelector('img'),old=screenUrls[i],url=URL.createObjectURL(blob);screenUrls[i]=url;screenEpochs[i]=null;
    img.onload=()=>{if(old)URL.revokeObjectURL(old);if(screenUrls[i]===url)screenEpochs[i]=epoch;};img.src=url;img.hidden=false;
  }catch{fail(Error('Не удалось обновить экран сайта.'));}finally{screenPending[i]=false;}
}
async function refresh(){if(polling)return;polling=true;try{
  current=await api('video/status');$('login').hidden=true;$('videoHub').hidden=false;
  if(restoredProvider!==current.provider){const saved=await api('video/sessions');for(let i=0;i<2;i++)$('session'+(i?'B':'A')).value=saved.sessions[i]?JSON.stringify(saved.sessions[i]):'';restoredProvider=current.provider;}
  $('provider').value=current.provider;$('provider').disabled=current.slots.some(s=>s.open)||pending.size>0||current.sessionSetup;
  const paired=current.slots.every(s=>s.connected),busy=pending.size>0||current.sessionSetup||current.slots.some(s=>s.busy);
  for(const id of ['applySessions','validateSessions'])$(id).disabled=busy;
  $('consent').disabled=!paired;if(!paired)$('consent').checked=false;
  $('bridgeToggle').disabled=busy||!paired||(!$('consent').checked&&!current.enabled);$('bridgeToggle').textContent=current.enabled?'Выключить мост':'Соединить участников';
  $('bridgeStatus').textContent=current.enabled?'A ↔ B · видео и звук передаются':'Видео мост выключен';$('bridgeStatus').className=current.enabled?'active':'';
  for(let i=0;i<2;i++){
    const s=current.slots[i],card=$('videoCard'+i),slotBusy=s.busy||pending.has(i)||pending.has('setup')||current.sessionSetup;
    card.querySelector('.state').textContent=names[s.status]||s.status;card.querySelector('.state').className='state'+(s.connected?' connected':'');
    card.querySelector('.issue').textContent=s.error||(s.receiverFailed?'Видеопоток прервался. Переподключите этот сеанс.':'');
    card.querySelector('.start').disabled=slotBusy||s.connected||['searching','starting','verification','login','attention'].includes(s.status);
    card.querySelector('.close').disabled=slotBusy||!s.open;
    card.querySelector('.compose textarea').disabled=!s.connected||!s.canSend;card.querySelector('.compose button').disabled=!s.connected||!s.canSend;
    for(const control of card.querySelectorAll('.nativeVideo input,.nativeVideo button'))control.disabled=slotBusy||!s.open;
    if(!s.open){screenEpochs[i]=null;card.querySelector('.nativeImage').hidden=true;}attach(i,s.open);void screen(i);
  }
}catch(e){if(!$('videoHub').hidden)fail(e);}finally{polling=false;}}
async function operate(i,op,body={}){if(pending.has(i)||pending.has('setup'))return;pending.add(i);try{$('error').textContent='';await api('video/'+i+'/'+op,body);}catch(e){fail(e);}finally{pending.delete(i);await refresh();}}
for(let i=0;i<2;i++){
  const card=document.createElement('article');card.id='videoCard'+i;card.className='chat';
  card.innerHTML='<div class="chatHeader"><img class="eye" src="'+(i?'/eye-b.jpg':'/eye-a.png')+'" alt=""><div><h2>Участник '+(i?'B':'A')+'</h2><div class="state">Не подключён</div></div></div><video class="videoPanel" id="video'+i+'" autoplay playsinline muted></video><div class="videoActions"><button class="sound" aria-pressed="false">Включить звук</button><button class="start connect">Поиск</button><button class="close">Отключить</button></div><p class="issue"></p><form class="compose"><label class="srOnly">Сообщение участнику '+(i?'B':'A')+'</label><textarea placeholder="Сообщение участнику '+(i?'B':'A')+'…" maxlength="1000" disabled></textarea><button type="submit" disabled>Отправить</button></form><details class="nativeVideo"><summary>Экран сайта и управление</summary><p class="videoHint">Для входа или ответа на запрос сайта откройте этот экран. Кликните поле и введите текст ниже. Проверки сайта выполняются вами.</p><img class="nativeImage" alt="Экран сайта участника '+(i?'B':'A')+'" hidden tabindex="0"><div class="nativeActions"><input class="nativeText" aria-label="Текст для выбранного поля сайта '+(i?'B':'A')+'" placeholder="Текст в выбранное поле" maxlength="2000" autocomplete="off"><button class="nativeType" type="button">Ввести</button><button class="nativeEnter" type="button">Enter</button><button class="nativeTab" type="button">Tab</button></div></details>';
  $('videoCards').append(card);players[i]=new VideoStreamPlayer($('video'+i));
  card.querySelector('.sound').onclick=e=>{const video=$('video'+i);video.muted=!video.muted;e.currentTarget.textContent=video.muted?'Включить звук':'Выключить звук';e.currentTarget.setAttribute('aria-pressed',String(!video.muted));video.play().catch(()=>{});};
  card.querySelector('.start').onclick=()=>operate(i,'start');card.querySelector('.close').onclick=()=>operate(i,'close');
  const form=card.querySelector('.compose'),editor=form.querySelector('textarea');let sending=false;
  form.onsubmit=async e=>{e.preventDefault();const text=editor.value;if(sending||!text.trim())return;sending=true;try{await api('video/'+i+'/send',{text});if(editor.value===text)editor.value='';}catch(e){fail(e);}finally{sending=false;}};
  editor.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}};
  const native=card.querySelector('.nativeVideo'),img=native.querySelector('img');native.ontoggle=()=>void screen(i);
  const input=async data=>{const slot=current?.slots[i];if(!slot?.epoch||slot.epoch!==screenEpochs[i]){fail(Error('Дождитесь обновлённого экрана сайта.'));return;}await operate(i,'input',{epoch:slot.epoch,...data});screenTimes[i]=0;void screen(i);};
  img.onclick=e=>{const rect=img.getBoundingClientRect();void input({action:'click',x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height});};
  img.onkeydown=e=>{if(['Enter','Tab','Escape','Space'].includes(e.code)){e.preventDefault();void input({action:'key',key:e.code});}};
  card.querySelector('.nativeType').onclick=()=>{const text=card.querySelector('.nativeText').value;if(text)void input({action:'text',text});};
  card.querySelector('.nativeEnter').onclick=()=>void input({action:'key',key:'Enter'});card.querySelector('.nativeTab').onclick=()=>void input({action:'key',key:'Tab'});
}
async function setup(path,body){if(pending.size)return;pending.add('setup');try{$('error').textContent='';const result=await api('video/'+path,body);if(result.results)$('sessionResult').textContent=result.results.map(r=>(r.slot?'B':'A')+': '+(r.ok?'готово':r.error)).join(' · ');}catch(e){fail(e);}finally{pending.delete('setup');await refresh();}}
$('provider').onchange=()=>setup('provider',{provider:$('provider').value});
$('sessionsForm').onsubmit=e=>{e.preventDefault();void setup('sessions',{sessions:[$('sessionA').value.trim(),$('sessionB').value.trim()]});};
$('validateSessions').onclick=()=>setup('validate',{});
$('bridgeToggle').onclick=async()=>{try{await api('video/toggle',{enabled:!current?.enabled,consent:$('consent').checked});await refresh();}catch(e){fail(e);}};$('consent').onchange=refresh;
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';$('error').textContent='';await refresh();}catch(e){fail(e);}};
setInterval(()=>{if(!document.hidden)refresh();},1000);refresh();

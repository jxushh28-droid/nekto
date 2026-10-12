const $=id=>document.getElementById(id);
let snapshot=null,polling=false,tokensRestored=false,sending=false;
const pending=new Set(),history=new Map(),lastStates=[null,null];
const statuses={closed:'Не подключён',loading:'Подключаемся…',ready:'Готов к поиску',searching:'Ищем собеседника…',connected:'На связи',ended:'Собеседник отключился',verification:'Требуется проверка',blocked:'Подключение ограничено'};
async function api(path,body){
  const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json();if(!r.ok){if(r.status===401){$('login').hidden=false;$('hub').hidden=true;}throw Error(data.error||'Ошибка запроса');}return data;
}
function failure(e){$('error').textContent=e.message;}
function rememberMessages(slots){
  slots.forEach((m,i)=>{
    for(const item of m.messages||[]){
      // Forwarded stranger messages already appear under their original eye.
      if(item.kind!=='incoming'&&item.kind!=='private')continue;
      const own=item.kind==='private',key=own&&item.broadcastId?'both:'+item.broadcastId:i+':'+m.epoch+':'+item.id;
      let row=history.get(key);if(!row){row={key,text:item.text,time:item.time,own,side:i,deliveries:{}};history.set(key,row);}
      row.deliveries[i]=item.delivery||'sent';
    }
    if(lastStates[i]?.connected&&(!m.connected||lastStates[i].epoch!==m.epoch)){
      for(const row of history.values())if(row.own&&row.deliveries[i]==='queued')row.deliveries[i]='failed';
      const key='ended:'+i+':'+lastStates[i].epoch;history.set(key,{key,system:true,text:'Собеседник '+(i?'B':'A')+' отключился',time:Date.now()});
    }
    lastStates[i]={connected:m.connected,epoch:m.epoch};
  });
  while(history.size>300)history.delete(history.keys().next().value);
}
function renderMessages(){
  const list=$('messages'),rows=[...history.values()].sort((a,b)=>(a.time||0)-(b.time||0)),key=JSON.stringify(rows);
  if(list.dataset.key===key)return;list.dataset.key=key;if(!rows.length)return;
  const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;list.replaceChildren();
  for(const item of rows){
    const row=document.createElement('div');row.className=item.system?'systemMessage':'messageRow'+(item.own?' own':'');
    if(item.system){row.textContent=item.text;list.append(row);continue;}
    if(!item.own){const eye=document.createElement('img');eye.className='eye messageEye';eye.src=item.side?'/eye-a.png':'/eye-b.jpg';eye.alt='Собеседник '+(item.side?'B':'A');row.append(eye);}
    const bubble=document.createElement('div');bubble.className='bubble'+(Object.values(item.deliveries).includes('failed')?' failed':'');
    const text=document.createElement('div');text.className='messageText';text.textContent=item.text;bubble.append(text);
    const meta=document.createElement('div');meta.className='meta';
    if(item.own){meta.textContent='Вы → '+(Object.keys(item.deliveries).length===2?'A + B':item.side?'B':'A');for(const [i,delivery] of Object.entries(item.deliveries)){if(delivery!=='sent')meta.textContent+=' · '+(Number(i)?'B':'A')+': '+(delivery==='failed'?'не отправлено':'отправляется');}}
    else meta.textContent=item.side?'B':'A';
    if(item.own)bubble.append(meta);else bubble.setAttribute('aria-label','Сообщение собеседника '+(item.side?'B':'A'));row.append(bubble);list.append(row);
  }
  if(bottom)list.scrollTop=list.scrollHeight;
}
function renderControls(){
  if(!snapshot)return;const s=snapshot,paired=s.slots.every(m=>m.connected),busy=s.tokenSetup||pending.size>0||s.slots.some(m=>m.busy);
  $('applyTokens').disabled=busy;$('connectBoth').disabled=busy||paired;
  $('bridge').className=paired?'active':'';$('bridge').textContent=paired?'A ↔ B · оба на связи':'Ожидаем двух собеседников';
  $('message').disabled=!paired||!s.enabled;$('send').disabled=!paired||!s.enabled||sending;
  s.slots.forEach((m,i)=>{const card=$('card'+i),slotBusy=busy||m.opening;
    card.querySelector('.state').textContent=statuses[m.status]||m.status;card.classList.toggle('isConnected',!!m.connected);
    card.querySelector('.issue').textContent=m.detail||m.error||'';
    card.querySelector('.connect').disabled=slotBusy||m.status==='loading'||m.status==='searching'||m.connected;
    card.querySelector('.close').disabled=slotBusy||!m.open;
  });
}
async function refresh(){if(polling)return;polling=true;try{
  const s=await api('status');snapshot=s;
  if(!tokensRestored){const saved=await api('tokens');for(let i=0;i<2;i++){const input=$('token'+(i?'B':'A'));if(!input.value)input.value=saved.tokens[i]||'';}tokensRestored=true;}
  $('login').hidden=true;$('hub').hidden=false;renderControls();rememberMessages(s.slots);renderMessages();
}catch(e){if(!$('hub').hidden)failure(e);}finally{polling=false;}}
async function connect(i){if(pending.has(i)||pending.has('tokens'))return;pending.add(i);renderControls();try{$('error').textContent='';await api('slot/'+i+'/connect',{});}catch(e){failure(e);}finally{pending.delete(i);await refresh();}}
for(let i=0;i<2;i++){
  const card=document.createElement('article');card.className='participant';card.id='card'+i;
  card.innerHTML='<img class="eye" src="'+(i?'/eye-a.png':'/eye-b.jpg')+'" alt=""><div class="participantInfo"><strong>Собеседник '+(i?'B':'A')+'</strong><span class="state">Не подключён</span><p class="issue"></p></div><div class="participantActions"><button class="connect">Поиск</button><button class="close" disabled aria-label="Отключить собеседника '+(i?'B':'A')+'">×</button></div>';
  $('cards').append(card);card.querySelector('.connect').onclick=()=>connect(i);
  card.querySelector('.close').onclick=async()=>{if(pending.size)return;pending.add(i);renderControls();try{await api('slot/'+i+'/close',{});}catch(e){failure(e);}finally{pending.delete(i);await refresh();}};
}
$('compose').onsubmit=async e=>{e.preventDefault();const editor=$('message'),text=editor.value;if(sending||!text.trim()||!snapshot?.slots.every(m=>m.connected))return;
  sending=true;renderControls();$('error').textContent='';try{await api('send',{text,epochs:snapshot.slots.map(m=>m.epoch)});if(editor.value===text)editor.value='';await refresh();}catch(err){failure(err);}finally{sending=false;renderControls();editor.focus();}
};
$('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('compose').requestSubmit();}};
$('connectBoth').onclick=async()=>{await Promise.all([connect(0),connect(1)]);};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';$('error').textContent='';await refresh();}catch(err){failure(err);}};
$('tokenForm').onsubmit=async e=>{e.preventDefault();pending.add('tokens');renderControls();$('tokenResult').textContent='Сохраняем токены и подключаем…';try{const r=await api('tokens',{tokens:[$('tokenA').value.trim(),$('tokenB').value.trim()]});$('tokenResult').textContent=r.results.map(x=>['A','B'][x.slot]+': '+(x.ok?'поиск запущен':x.error)).join(' · ');if(r.ok)$('tokens').open=false;}catch(err){failure(err);}finally{pending.delete('tokens');await refresh();}};
setInterval(()=>{if(!document.hidden)refresh();},1000);refresh();

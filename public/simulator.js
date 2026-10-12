const $=id=>document.getElementById(id);
let timer=null,steps=0,planned=0;
async function api(path,data){
 const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Ошибка запроса');return result;
}
async function signIn(){try{await api('status');$('login').hidden=true;$('simulatorHub').hidden=false;}catch{$('login').hidden=false;$('simulatorHub').hidden=true;}}
function stop(){clearInterval(timer);timer=null;$('simulationStart').disabled=false;$('simulationStop').disabled=true;}
function clear(){stop();steps=0;planned=0;$('simulationLog').replaceChildren();$('simulationSummary').textContent='';}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';$('error').textContent='';await signIn();}catch(err){$('error').textContent=err.message;}};
$('simulationForm').onsubmit=e=>{
 e.preventDefault();if(timer)return;
 const digits=$('simulationPhone').value.replace(/\D/g,''),count=Number($('simulationCount').value),channel=$('simulationChannel').value;
 if(!/^([78])\d{10}$/.test(digits)||!Number.isInteger(count)||count<1||count>30){$('error').textContent='Введите номер +7 и от 1 до 30 шагов.';return;}
 clear();$('error').textContent='';planned=count;
 const phone='+7 '+digits.slice(-10,-7)+' '+digits.slice(-7,-4)+' '+digits.slice(-4,-2)+' '+digits.slice(-2);
 $('simulationStart').disabled=true;$('simulationStop').disabled=false;
 const advance=()=>{
  steps++;const kind=channel==='both'?(steps%2?'sms':'call'):channel;
  const row=document.createElement('li');row.textContent=steps+'. '+(kind==='call'?'Звонок':'SMS')+' · '+phone+' · локальная симуляция';$('simulationLog').append(row);
  $('simulationSummary').textContent='Смоделировано '+steps+' / '+planned+'. Отправлено SMS и звонков: 0.';
  if(steps>=planned)stop();
 };
 timer=setInterval(advance,500);
};
$('simulationStop').onclick=()=>{stop();$('simulationSummary').textContent='Симуляция остановлена. Отправлено SMS и звонков: 0.';};
$('simulationClear').onclick=clear;
window.addEventListener('pagehide',stop);
void signIn();

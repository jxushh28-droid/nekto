function installSiteControls() {
  if(window.__neonSiteControls)return;
  const bridge=window.__neonAudio;
  // Presentation only: do not click cookie consent, call controls, or verification.
  function compact(){
    if(!['nekto-me.kz','nekto.me'].includes(location.hostname)||document.getElementById('neon-compact-style'))return;
    const root=document.head||document.documentElement;
    if(!root)return; // Browser initialization runs before <html> exists.
    const style=document.createElement('style');style.id='neon-compact-style';
    style.textContent=`
      .navbar, #cookiesConsent, .cookies-consent, #app_android, #app_ios,
      .advBox, [id^="yandex_rtb_"], [id^="ya_adv_"], [id^="adfox_"],
      .fs_wrapper_outer, #tabs_t_chats, .footer, footer, .neon-site-extra {display:none!important}
      html,body {background:#050907!important;color:#cad6ce!important;margin:0!important;padding:0!important;min-width:0!important}
      .chat_container,.outer-container {width:100%!important;max-width:720px!important;margin:0 auto!important;padding:8px 14px!important}
      #audio-chat-container {margin:0 auto!important;max-width:680px!important}
      #audio-chat-container > .title, #audio-chat-container h1 {display:none!important}
      .audio-chat,.centerToSearchBlock,.chat-step.idle {margin-top:0!important;padding-top:8px!important}
      #searchCompanyBtn {background:#00d985!important;color:#03180e!important;border-color:#00d985!important;box-shadow:none!important}
      .chat_container > h1,.chat_container > .title {display:none!important}
    `;
    root.append(style);
  }
  function tidyExtras(){
    if(!['nekto-me.kz','nekto.me'].includes(location.hostname))return;
    const safe=element=>element&&!['BODY','HTML'].includes(element.tagName)&&!element.querySelector('button,input,select,iframe,#audio-chat-container');
    const hide=element=>{if(safe(element))element.classList.add('neon-site-extra');};
    for(const heading of document.querySelectorAll('h1,h2,h3'))if(/^Голосовой чат(?: рулетка)?$/.test(heading.textContent.trim())){hide(safe(heading.parentElement)?heading.parentElement:heading);}
    for(const link of document.querySelectorAll('a[href*="play.google.com"],a[href*="chatruletka-web@nekto.me"],#devel')){
      let region=link;
      for(let n=0;n<3&&safe(region.parentElement);n++){
        const text=region.parentElement.textContent;
        if(text.length>1200)break;
        region=region.parentElement;
        if(/Добро пожаловать|Присоединяйтесь|©/.test(text))break;
      }
      hide(region);
    }
    for(const element of document.querySelectorAll('p,small,span'))if(/^от Nekto\.me$|^Присоединяйтесь!?$/.test(element.textContent.trim()))hide(element);
  }
  compact();tidyExtras();document.addEventListener('DOMContentLoaded',()=>{compact();tidyExtras();},{once:true});
  const observer=new MutationObserver(()=>{compact();tidyExtras();});
  // Document exists during preload; documentElement may still be null.
  observer.observe(document,{childList:true,subtree:true});
  let config={autoSearch:false,muteEffects:true},lastClick=-Infinity,lastReport='',attempts=0,wasInCall=false,blocked=false;
  const effectMuted=new WeakMap();
  const incoming=stream=>stream?.getAudioTracks?.().some(track=>window.__neonIncomingTracks?.has(track));
  function report(mode,message){const key=mode+message;if(lastReport===key)return;lastReport=key;bridge.automation?.({mode,message});}
  function visible(element){return element && (element.checkVisibility?element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):element.getClientRects().length>0);}
  function pulse(){
    for(const element of document.querySelectorAll('audio,video')){if(incoming(element.srcObject))element.muted=true;else if(!element.srcObject){if(config.muteEffects){if(!effectMuted.has(element))effectMuted.set(element,element.muted);element.muted=true;}else if(effectMuted.has(element)){element.muted=effectMuted.get(element);effectMuted.delete(element);}}}
    if(!config.autoSearch){report('off','Automatic search off');return;}
    if(!['nekto-me.kz','nekto.me'].includes(location.hostname)){report('unsupported','Automatic search is available on Nekto’s audio page.');return;}
    if(window.__neonBridge?.hasPeers?.()||[...document.querySelectorAll('.callScreen__cancelCallBtn')].some(visible)){attempts=0;wasInCall=true;report('in-call','Waiting for the current call to end');return;}
    if(wasInCall){wasInCall=false;attempts=0;lastClick=Date.now();}
    const challenge=[...document.querySelectorAll('iframe[title*="challenge"],iframe[src*="hcaptcha"],[role="dialog"],dialog[open],.modal.show,.swal2-container')].some(visible);
    const text=document.body?.innerText||'';
    if(blocked||/access (?:is )?(?:denied|blocked|restricted)|too many (?:requests|calls)|temporarily blocked|доступ[^\n]{0,60}(?:ограничен|заблокирован)|(?:вы|ваш аккаунт)[^\n]{0,40}заблокирован|слишком (?:много|часто)|попробуйте (?:позже|через)/i.test(text)){blocked=true;report('blocked','Website refused access. Automatic search stopped; check its message.');return;}
    if(challenge || /verify you are human|checking your browser|подтвердите,? что вы (?:не робот|человек)|проверьте,? что вы не робот/i.test(text)){report('paused','Complete the website’s verification manually.');return;}
    const label=/^(?:Начать поиск собеседника|Начать(?: новый)? разговор|Новый разговор|Искать(?: нового)? собеседника|Start(?: a new)? conversation|New conversation|Search again|Әңгіме(?:ні)? бастау|Жаңа әңгіме(?:ні)? бастау|Сөйлесуді бастау|Жаңа сөйлесу)$/i;
    const candidates=[...document.querySelectorAll('#searchCompanyBtn,.callScreen__findBtn,button,[role="button"]')];
    const button=candidates.find(element=>visible(element)&&!element.disabled&&element.getAttribute('aria-disabled')!=='true'&&!element.classList.contains('disabled')&&label.test((element.textContent||'').trim()));
    if(!button){report('waiting','Waiting for Nekto’s search button or your setup choices');return;}
    if(Date.now()-lastClick<10000){report('searching','Search requested; waiting for the website');return;}
    if(attempts>=1){report('paused','Search was already requested. Start manually if the website did not continue.');return;}
    attempts++;lastClick=Date.now();button.click();report('searching','Looking for a new conversation');
  }
  bridge.receiveSettings?.(settings=>{if(!!settings.autoSearch!==config.autoSearch){attempts=0;blocked=false;}config={autoSearch:!!settings.autoSearch,muteEffects:settings.muteEffects!==false};pulse();});
  window.__neonSiteControls={pulse};
  document.addEventListener('click',event=>{if(event.isTrusted&&event.target?.closest?.('.callScreen__cancelCallBtn'))config.autoSearch=false;if(event.isTrusted&&event.target?.closest?.('#searchCompanyBtn,.callScreen__findBtn'))attempts=0;},true);
  document.addEventListener('play',pulse,true);
  setInterval(pulse,1500);
}
module.exports={installSiteControls};

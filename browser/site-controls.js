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
    const check=window.__inspectNektoSite?.();
    if(!check){report('waiting','Waiting for site readiness checks');return;}
    if(blocked||check.status==='blocked'){blocked=true;report('blocked',check.message);return;}
    if(check.status!=='search-ready'){report(check.status,check.message);return;}
    if(Date.now()-lastClick<10000){report('searching','Search requested; waiting for the website');return;}
    if(attempts>=1){report('paused','Search was already requested. Start manually if the website did not continue.');return;}
    const requested=window.__inspectNektoSite({click:true});if(requested.status==='search-ready'){attempts++;lastClick=Date.now();}report(requested.status,requested.message);
  }
  bridge.receiveSettings?.(settings=>{if(!!settings.autoSearch!==config.autoSearch){attempts=0;blocked=false;}config={autoSearch:!!settings.autoSearch,muteEffects:settings.muteEffects!==false};pulse();});
  window.__neonSiteControls={pulse};
  document.addEventListener('click',event=>{if(event.isTrusted&&event.target?.closest?.('.callScreen__cancelCallBtn'))config.autoSearch=false;if(event.isTrusted&&event.target?.closest?.('#searchCompanyBtn,.callScreen__findBtn'))attempts=0;},true);
  document.addEventListener('play',pulse,true);
  setInterval(pulse,1500);
}
module.exports={installSiteControls};

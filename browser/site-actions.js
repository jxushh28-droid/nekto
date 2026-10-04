// Executed in the page. Report evidence rather than calling every missing button a CAPTCHA.
function inspectSite(options={}) {
 const visible=e=>e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):e.getClientRects().length>0;
 const text=document.body?.innerText||'',tidy=s=>String(s||'').replace(/\s+/g,' ').trim();
 const controls=[...document.querySelectorAll('button,[role="button"],input[type="submit"],#searchCompanyBtn,.callScreen__findBtn')].filter(visible);
 const buttons=controls.map(e=>tidy(e.textContent||e.value||e.getAttribute('aria-label'))).filter(Boolean).slice(0,12);
 const refusal=/access (?:denied|blocked)|доступ[^\n]{0,60}(?:ограничен|заблокирован)|слишком (?:много|часто)|попробуйте (?:позже|через)/i;
 if(refusal.test(text))return {status:'blocked',message:'Nekto displays an access refusal. Search stopped.',buttons};
 const challenge=[...document.querySelectorAll('iframe[src*="hcaptcha"],iframe[title*="challenge"],iframe[title*="reCAPTCHA"]')].some(visible)||/verify you are human|checking your browser|подтвердите,? что вы (?:не робот|человек)|проверьте,? что вы не робот/i.test(text);
 if(challenge)return {status:'verification',message:'The page displays a human-verification challenge.',buttons};
 if(window.__neonBridge?.hasPeers?.())return {status:'in-call',message:'Already in a call',buttons};
 const store=[document.getElementById('app'),document.body,...document.querySelectorAll('*')].map(e=>e?.__vue__?.$store?.state).find(Boolean);
 if(store?.user?.isSearching)return {status:'searching',message:'Nekto is already searching',buttons};
 const labels=/^(Начать поиск собеседника|Начать(?: новый)? разговор|Новый разговор|Искать(?: нового)? собеседника|Start(?: a new)? conversation|New conversation|Start search|Search again|Әңгіме(?:ні)? бастау|Жаңа әңгіме(?:ні)? бастау|Сөйлесуді бастау|Жаңа сөйлесу|Әңгімелесуді бастау)$/i;
 const button=controls.find(e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&(e.matches('#searchCompanyBtn,.callScreen__findBtn')||labels.test(tidy(e.textContent||e.value))));
 if(button){if(options.click)button.click();return {status:'search-ready',message:options.click?'Search requested':'Search control ready',buttons};}
 const modal=[...document.querySelectorAll('[role="dialog"],dialog[open],.modal.show,.swal2-container')].find(visible);
 if(modal)return {status:'setup',message:'Nekto displays a setup dialog. This is not evidence of a CAPTCHA.',buttons};
 if(document.readyState!=='complete'||!store&&buttons.length===0||/^(?:Жүктелуде|Загрузка|Loading)\.{0,3}$/i.test(tidy(text)))return {status:'loading',message:'Waiting for the Nekto application to finish loading',buttons};
 return {status:'setup',message:'The loaded page has no enabled search control. Visible controls: '+(buttons.join(' / ')||'none'),buttons};
}
function sessionStatus(expectedToken){
 const store=[document.getElementById('app'),document.body,...document.querySelectorAll('*')].map(e=>e?.__vue__?.$store?.state).find(Boolean);
 let saved;try{saved=JSON.parse(localStorage.getItem('storage_audio_v2'));}catch{}
 return {storeFound:!!store,storageMatches:!!expectedToken&&saved?.user?.authToken===expectedToken,tokenMatches:!!expectedToken&&store?.user?.authToken===expectedToken,tokenPresent:!!store?.user?.authToken};
}
module.exports={inspectSite,sessionStatus};

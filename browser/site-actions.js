// Executed in the page. Report evidence rather than calling every missing button a CAPTCHA.
function inspectSite(options={}) {
 const visible=e=>e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):e.getClientRects().length>0;
 const text=document.body?.innerText||'',tidy=s=>String(s||'').replace(/\s+/g,' ').trim();
 const controls=[...document.querySelectorAll('button,[role="button"],input[type="submit"],#searchCompanyBtn,.callScreen__findBtn')].filter(visible);
 const buttons=controls.map(e=>tidy(e.textContent||e.value||e.getAttribute('aria-label'))).filter(Boolean).slice(0,12);
 // Only direct refusal statements, not rules describing possible restrictions.
 const refusal=/^(?:access (?:is )?(?:denied|blocked|restricted)|(?:your (?:account|access)|you) (?:is|are|has been|have been) (?:blocked|restricted)|доступ(?: к [^.!?]{1,40})? (?:временно )?(?:ограничен|заблокирован|запрещ[её]н)|(?:ваш аккаунт|вы) (?:временно )?заблокирован|слишком (?:много запросов|частые запросы)|too many (?:requests|calls))(?:[.!?:\s]|$)/i;
 const messages=[...document.querySelectorAll('[role="alert"],[role="dialog"],dialog[open],.modal.show,.swal2-container')].filter(visible);
 const lines=source=>String(source||'').split(/\n+/).map(tidy).filter(Boolean);
 const evidence=messages.flatMap(e=>lines(e.innerText)).find(s=>refusal.test(s))||lines(text).find(s=>refusal.test(s));
 if(evidence)return {status:'blocked',message:'Nekto refused access: '+evidence.slice(0,400),evidence:evidence.slice(0,400),buttons};
 const temporary=messages.flatMap(e=>lines(e.innerText)).find(s=>/попробуйте (?:позже|через)|try again later/i.test(s));
 if(temporary)return {status:'temporary-error',message:'Nekto reports a temporary error: '+temporary.slice(0,400),buttons};
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

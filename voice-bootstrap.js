// Same idempotent storage write used by the operator's console snippet.
// Runs in the selected existing page immediately before its Start click.
export function applyVoiceStorageToken(token){
 if(location.origin!=='https://nekto-me.kz'||typeof token!=='string'||!token)return {ok:false,changed:false,savedTokenMatches:false};
 const KEY='storage_audio_v2';let changed=false;
 const write=()=>{
  try{
   const saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{};
   if(saved?.user?.authToken===token)return true;
   if(typeof saved!=='object'||Array.isArray(saved)||saved.user!=null&&(typeof saved.user!=='object'||Array.isArray(saved.user)))return false;
   saved.user=saved.user||{};saved.user.authToken=token;
   localStorage.setItem(KEY,JSON.stringify(saved));changed=true;
   return JSON.parse(localStorage.getItem(KEY)||'{}')?.user?.authToken===token;
  }catch{return false;}
 };
 const ok=write();
 if(!ok)document.addEventListener('readystatechange',write,{once:true});
 return {ok,changed,savedTokenMatches:ok};
}

// Context storage is seeded before the first page. Reload must observe the
// latest explicit write rather than restore a token captured at browser creation.
export function observeVoiceStorage() {
 if(location.origin!=='https://nekto-me.kz')return;
 let ok=false;
 try{const token=JSON.parse(localStorage.getItem('storage_audio_v2')||'{}')?.user?.authToken;ok=typeof token==='string'&&!!token;}catch{}
 window.__voiceTokenBootstrap={ok,reason:ok?'context-storage-before-page':'context-storage-unavailable',phase:'document-start'};
}

// The context already contains the token before page creation. This also
// supports document-start initialization when used independently.
export function primeVoiceStorage(token) {
  if (location.origin !== 'https://nekto-me.kz') return;
  const KEY = 'storage_audio_v2';
  let poll = null, polls = 0;
  const cleanup = () => {
    if (poll !== null) clearInterval(poll);
    poll = null;
    document.removeEventListener('readystatechange', onReady);
    document.removeEventListener('DOMContentLoaded', onDCL);
  };
  const apply = phase => {
    let ok = false, reason, retryable = false;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
      if (typeof saved !== 'object' || Array.isArray(saved) ||
          saved.user != null && (typeof saved.user !== 'object' || Array.isArray(saved.user))) {
        reason = 'extension-storage-invalid';
      } else {
        if (saved.user?.authToken !== token) {
          saved.user = saved.user || {};
          saved.user.authToken = token;
          localStorage.setItem(KEY, JSON.stringify(saved));
        }
        ok = JSON.parse(localStorage.getItem(KEY) || '{}')?.user?.authToken === token;
        reason = ok ? phase === 'document-start' ? 'extension-document-start' : 'extension-storage-retry' : 'extension-storage-mismatch';
      }
    } catch (e) {
      reason = 'extension-storage-write-failed';
      retryable = e?.name !== 'SyntaxError' && e?.name !== 'TypeError';
    }
    window.__voiceTokenBootstrap = { ok, reason, phase };
    return { ok, retryable };
  };
  const retry = phase => {
    // Never switch identity once the document has finished loading.
    if (document.readyState !== 'loading') {
      cleanup();
      window.__voiceTokenBootstrap = { ok: false, reason: 'extension-storage-not-ready-before-startup', phase };
      return;
    }
    const result = apply(phase);
    if (result.ok || !result.retryable) cleanup();
  };
  const onReady = () => retry('readystatechange:' + document.readyState);
  const onDCL = () => retry('DOMContentLoaded');
  const first = apply('document-start');
  if (first.ok || !first.retryable) return;
  document.addEventListener('readystatechange', onReady);
  document.addEventListener('DOMContentLoaded', onDCL, { once: true });
  poll = setInterval(() => {
    retry('poll:' + (++polls));
    if (poll !== null && polls >= 60) {
      cleanup();
      window.__voiceTokenBootstrap = { ok: false, reason: 'extension-storage-timeout', phase: 'poll-exhausted' };
    }
  }, 50);
}

// Keep the operator's token pinned for the life of the page, the way an
// always-on content script would: whenever anything replaces it, re-write the
// token back into both localStorage and the live client store so browser A
// never drifts off the configured token. Runs from document-start onward.
export function pinVoiceToken(token) {
  if (location.origin !== 'https://nekto-me.kz') return;
  if (typeof token !== 'string' || !token) return;
  const KEY = 'storage_audio_v2';
  const apply = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
      if (saved && typeof saved === 'object' && !Array.isArray(saved) && saved.user?.authToken !== token) {
        saved.user = saved.user || {};
        saved.user.authToken = token;
        localStorage.setItem(KEY, JSON.stringify(saved));
      }
    } catch {}
    try {
      for (const el of document.querySelectorAll('*')) {
        const state = el.__vue__?.$store?.state;
        if (state?.user && state.system && state.user.authToken !== token) state.user.authToken = token;
      }
    } catch {}
  };
  apply();
  setInterval(apply, 250);
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

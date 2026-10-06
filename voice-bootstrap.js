// Self-contained: Playwright serializes this function into each new document.
export function primeVoiceStorage(token) {
  if (location.origin !== 'https://nekto-me.kz' ||
      !location.pathname.startsWith('/audiochat') || window.top !== window) return;

  const key = 'storage_audio_v2';
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}') || {};
    if (typeof saved !== 'object' || Array.isArray(saved))
      throw Error('invalid-storage');
    if (saved.user != null && (typeof saved.user !== 'object' || Array.isArray(saved.user)))
      throw Error('invalid-user-storage');
    if (saved.user?.authToken !== token) {
      saved.user = {...saved.user, authToken: token};
      localStorage.setItem(key, JSON.stringify(saved));
    }
    const matches = JSON.parse(localStorage.getItem(key))?.user?.authToken === token;
    window.__voiceTokenBootstrap = {ok: matches, reason: matches ? 'saved-before-startup' : 'storage-mismatch'};
  } catch {
    window.__voiceTokenBootstrap = {ok: false, reason: 'storage-unavailable-or-invalid'};
  }
}

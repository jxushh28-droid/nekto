// Matches the uploaded extension on HTTPS Nekto documents and subframes.
// The token is supplied per context, rather than embedded in a source file.
export function primeVoiceStorage(token) {
  if (location.origin !== 'https://nekto-me.kz') return;
  const TOKEN = token;
  const KEY = 'storage_audio_v2';
  const write = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
      if (saved?.user?.authToken === TOKEN) return true;
      saved.user = saved.user || {};
      saved.user.authToken = TOKEN;
      localStorage.setItem(KEY, JSON.stringify(saved));
      return true;
    } catch { return false; }
  };
  const apply = () => {
    const ok = write();
    window.__voiceTokenBootstrap = { ok, reason: ok ? 'extension-document-start' : 'extension-storage-write-failed' };
    return ok;
  };
  if (!apply()) document.addEventListener('readystatechange', apply, { once: true });
}

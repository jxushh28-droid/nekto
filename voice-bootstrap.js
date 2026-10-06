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
    const wrote = write();
    let matches = false;
    if (wrote) {
      try { matches = JSON.parse(localStorage.getItem(KEY) || '{}')?.user?.authToken === TOKEN; }
      catch {}
    }
    window.__voiceTokenBootstrap = { ok: wrote && matches, reason: !wrote ? 'extension-storage-write-failed' : matches ? 'extension-document-start' : 'extension-storage-mismatch' };
    return wrote;
  };
  if (!apply()) document.addEventListener('readystatechange', apply, { once: true });
}

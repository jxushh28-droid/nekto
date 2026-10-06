export function primeVoiceStorage(token) {
  const fail = (reason) => {
    window.__voiceTokenBootstrap = { ok: false, reason };
  };

  if (location.origin !== 'https://nekto-me.kz' ||
      !location.pathname.startsWith('/audiochat')) {
    return fail(`origin-mismatch:${location.origin}${location.pathname}`);
  }

  const key = 'storage_audio_v2';
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    return fail(`localStorage-read:${e?.message || e}`);
  }

  let saved;
  try {
    saved = JSON.parse(raw || '{}');
  } catch {
    return fail('json-parse:invalid-json');
  }

  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
    return fail('invalid-storage-shape');
  }

  if (saved.user != null && (typeof saved.user !== 'object' || Array.isArray(saved.user))) {
    return fail('invalid-user-shape');
  }

  if (saved.user?.authToken !== token) {
    saved.user = { ...(saved.user || {}), authToken: token };
    try {
      localStorage.setItem(key, JSON.stringify(saved));
    } catch (e) {
      return fail(`localStorage-write:${e?.message || e}`);
    }
  }

  let matches;
  try {
    matches = JSON.parse(localStorage.getItem(key))?.user?.authToken === token;
  } catch {
    return fail('verify-read:failed');
  }

  window.__voiceTokenBootstrap = matches
    ? { ok: true, reason: 'saved-before-startup' }
    : { ok: false, reason: 'storage-mismatch' };
}

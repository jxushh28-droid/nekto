// voice-bootstrap.js — hardened primeVoiceStorage
// Closes the iframe timing gap and the pre-localStorage-ready race.

export function primeVoiceStorage(token) {
  if (location.origin !== 'https://nekto-me.kz') return;

  const TOKEN = token;
  const KEY   = 'storage_audio_v2';

  // ── 1. Write helper ───────────────────────────────────────────────────────
  const write = () => {
    try {
      const raw    = localStorage.getItem(KEY);
      const saved  = raw ? JSON.parse(raw) : {};
      const actual = saved?.user?.authToken;
      if (actual === TOKEN) return 'already-present';
      saved.user            = saved.user || {};
      saved.user.authToken  = TOKEN;
      localStorage.setItem(KEY, JSON.stringify(saved));
      return 'wrote';
    } catch (e) {
      return 'failed:' + String(e?.name || e);
    }
  };

  // ── 2. Verify helper ─────────────────────────────────────────────────────
  const verify = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}')?.user?.authToken === TOKEN;
    } catch { return false; }
  };

  // ── 3. Apply + stamp window.__voiceTokenBootstrap ────────────────────────
  const apply = (phase) => {
    const result  = write();
    const ok      = result === 'wrote' || result === 'already-present';
    const matches = ok && verify();

    const reason = !ok
      ? 'extension-storage-write-failed:' + result
      : matches
        ? 'extension-document-start'
        : 'extension-storage-mismatch';

    window.__voiceTokenBootstrap = { ok: ok && matches, reason, phase };
    return ok && matches;
  };

  // ── 4. Immediate attempt (document_start equivalent) ─────────────────────
  if (apply('document-start')) return;

  // ── 5. Fallback — retry on readystatechange ───────────────────────────────
  // Covers the case where localStorage isn't accessible yet at injection time.
  const onReady = () => {
    if (apply('readystatechange:' + document.readyState)) {
      document.removeEventListener('readystatechange', onReady);
    }
  };
  document.addEventListener('readystatechange', onReady);

  // ── 6. Hard fallback — retry on DOMContentLoaded ─────────────────────────
  // Catches stubborn cases where readystatechange still fires too early.
  const onDCL = () => apply('DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', onDCL, { once: true });

  // ── 7. Nuclear fallback — polling loop (max 3s, 50ms interval) ───────────
  // For edge cases where neither event fires before the Vue client reads
  // localStorage. Clears itself once written or timed out.
  let polls = 0;
  const MAX  = 60; // 60 × 50ms = 3 000ms
  const poll = setInterval(() => {
    polls++;
    if (apply('poll:' + polls) || polls >= MAX) {
      clearInterval(poll);
      document.removeEventListener('readystatechange', onReady);
      document.removeEventListener('DOMContentLoaded', onDCL);
      if (polls >= MAX && !verify()) {
        window.__voiceTokenBootstrap = {
          ok:     false,
          reason: 'extension-storage-timeout-after-' + MAX + '-polls',
          phase:  'poll-exhausted'
        };
      }
    }
  }, 50);
}

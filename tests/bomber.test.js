import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKzPhone,
  substitutePhone,
  uaFingerprint,
  loadBomberConfig,
  fireEndpoint,
  runBomberJob,
  getJob,
  stopJob,
  snapshotJob,
  KZ_MOBILE_PREFIXES,
} from '../bomber.js';

test('normalizeKzPhone accepts 10-digit national form', () => {
  const f = normalizeKzPhone('7001234567');
  assert.equal(f.e164, '+77001234567');
  assert.equal(f.local8, '87001234567');
  assert.equal(f.national, '7001234567');
  assert.equal(f.prefix, '700');
  assert.ok(f.valid);
  assert.equal(f.error, null);
});

test('normalizeKzPhone strips leading 7 or 8 from 11-digit', () => {
  assert.equal(normalizeKzPhone('77001234567').e164, '+77001234567');
  assert.equal(normalizeKzPhone('87001234567').e164, '+77001234567');
});

test('normalizeKzPhone rejects wrong length', () => {
  const f = normalizeKzPhone('12345');
  assert.equal(f.e164, null);
  assert.ok(/10 national digits/.test(f.error));
});

test('normalizeKzPhone rejects non-mobile prefix without force', () => {
  const f = normalizeKzPhone('6001234567');
  assert.equal(f.valid, false);
  assert.match(f.error, /not in KZ mobile set/);
});

test('normalizeKzPhone bypasses prefix check with ! suffix', () => {
  const f = normalizeKzPhone('6001234567!');
  assert.equal(f.valid, true);
  assert.equal(f.forced, true);
  assert.equal(f.e164, '+76001234567');
});

test('normalizeKzPhone bypasses prefix check with force:true', () => {
  const f = normalizeKzPhone('6001234567', { force: true });
  assert.equal(f.valid, true);
  assert.equal(f.forced, true);
});

test('substitutePhone replaces all tokens', () => {
  const f = normalizeKzPhone('7001234567');
  const out = substitutePhone(
    'url?p={phone}&n={phone_national}&d={phone_display}&p8={phone_8}&r={phone_raw}&px={phone_prefix}',
    f,
  );
  assert.equal(
    out,
    'url?p=+77001234567&n=7001234567&d=+7 (700) 123-45-67&p8=87001234567&r=77001234567&px=700',
  );
});

test('substitutePhone handles empty template', () => {
  assert.equal(substitutePhone('', normalizeKzPhone('7001234567')), '');
  assert.equal(substitutePhone(null, normalizeKzPhone('7001234567')), '');
});

test('uaFingerprint reads Chrome major version', () => {
  const fp = uaFingerprint('Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36');
  assert.match(fp.secChUa, /v="154"/);
  assert.equal(fp.mobile, '?0');
  assert.equal(fp.platform, '"Windows"');
});

test('uaFingerprint detects mobile', () => {
  const fp = uaFingerprint('Android Chrome/154.0.0.0 Mobile Safari');
  assert.equal(fp.mobile, '?1');
  assert.equal(fp.platform, '"Android"');
});

test('uaFingerprint returns null secChUa for Firefox', () => {
  const fp = uaFingerprint('Mozilla/5.0 Firefox/126.0');
  assert.equal(fp.secChUa, null);
});

test('KZ_MOBILE_PREFIXES contains known prefixes', () => {
  for (const p of ['700', '707', '747', '771', '778']) {
    assert.ok(KZ_MOBILE_PREFIXES.has(p), `missing ${p}`);
  }
});

test('loadBomberConfig returns normalized endpoints', async () => {
  const cfg = await loadBomberConfig();
  assert.ok(Array.isArray(cfg.endpoints));
  assert.ok(cfg.endpoints.length > 0);
  for (const e of cfg.endpoints) {
    assert.ok(e.name);
    assert.ok(['POST', 'GET', 'PUT', 'PATCH', 'HEAD', 'DELETE'].includes(e.method));
    assert.ok(['sms', 'voice', 'call'].includes(e.channel));
  }
  assert.equal(typeof cfg.threads, 'number');
  assert.equal(typeof cfg.smsPerMinute, 'number');
  assert.ok(cfg.userAgents.length >= 3);
});

test('fireEndpoint short-circuits in simulation mode', async () => {
  const forms = normalizeKzPhone('7001234567');
  const ep = { name: 'sim', channel: 'sms', method: 'POST', url: 'https://example.invalid', body: '', headers: {}, contentType: 'application/json', preRequest: null, variants: null };
  const r = await fireEndpoint(ep, forms, { simulation: true, userAgents: ['x'], timeoutSec: 1 }, null, null);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.snippet, 'simulated');
});

test('runBomberJob rejects bad count', async () => {
  await assert.rejects(() => runBomberJob('7001234567', 0, 'sms', true), /count must be 1\.\.1000/);
  await assert.rejects(() => runBomberJob('7001234567', 1001, 'sms', true), /count must be 1\.\.1000/);
  await assert.rejects(() => runBomberJob('7001234567', 1.5, 'sms', true), /count must be 1\.\.1000/);
});

test('runBomberJob rejects invalid phone', async () => {
  await assert.rejects(() => runBomberJob('garbage', 1, 'sms', true), /10 national digits/);
});

test('runBomberJob rejects non-mobile prefix without force', async () => {
  await assert.rejects(() => runBomberJob('6001234567', 1, 'sms', true), /not in KZ mobile set/);
});

test('runBomberJob accepts non-mobile prefix with ! suffix', async () => {
  const r = await runBomberJob('6001234567!', 1, 'sms', true);
  assert.equal(r.phone, '+76001234567');
  stopJob(r.id);
});

test('runBomberJob accepts non-mobile prefix with force:true', async () => {
  const r = await runBomberJob('6001234567', 1, 'sms', true, null, { force: true });
  assert.equal(r.phone, '+76001234567');
  stopJob(r.id);
});

test('runBomberJob runs in simulation and reports sent count', async () => {
  const r = await runBomberJob('7001234567', 3, 'sms', true);
  assert.ok(r.id);
  assert.equal(r.total, 3);
  // give the loop a few ticks to complete 3 simulated sends
  for (let i = 0; i < 40; i++) {
    const j = getJob(r.id);
    if (j && j.done) break;
    await new Promise(res => setTimeout(res, 100));
  }
  const j = getJob(r.id);
  assert.ok(j);
  assert.equal(j.done, true);
  assert.equal(j.sent + j.failed, 3);
  assert.ok(j.sent >= 1);
});

test('snapshotJob supports since cursor', async () => {
  const r = await runBomberJob('7001234567', 2, 'sms', true);
  for (let i = 0; i < 40; i++) {
    const j = getJob(r.id);
    if (j && j.done) break;
    await new Promise(res => setTimeout(res, 100));
  }
  const j = getJob(r.id);
  const full = snapshotJob(j);
  assert.ok(full.events.length >= 2);
  assert.ok(full.cursor > 0);
  const delta = snapshotJob(j, { since: full.cursor });
  assert.equal(delta.events.length, 0);
  const partial = snapshotJob(j, { since: full.cursor - 1 });
  assert.equal(partial.events.length, 1);
});

test('stopJob returns false for unknown id', () => {
  assert.equal(stopJob('nonexistent999'), false);
});

test('stopJob returns true for known id', async () => {
  const r = await runBomberJob('7001234567', 50, 'sms', true);
  assert.equal(stopJob(r.id), true);
  const j = getJob(r.id);
  assert.equal(j.stopRequested, true);
});

test('runBomberJob rejects unknown channel gracefully (treated as both)', async () => {
  const r = await runBomberJob('7001234567', 1, 'nonsense', true);
  assert.ok(r.id);
  stopJob(r.id);
});

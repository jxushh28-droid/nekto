import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {primeVoiceStorage} from '../voice-bootstrap.js';

function run(saved, options = {}) {
  let value = saved, writes = 0;
  const window = {}; window.top = options.frame ? {} : window;
  const context = {
    window,
    location: {origin: options.origin || 'https://nekto-me.kz', pathname: '/audiochat'},
    localStorage: {
      getItem() {if (options.denied) throw Error('denied'); return value;},
      setItem(key, next) {assert.equal(key, 'storage_audio_v2'); writes++; value = next;}
    },
    token: 'fixture-token'
  };
  runInNewContext('(' + primeVoiceStorage.toString() + ')(token)', context);
  return {value, writes, status: window.__voiceTokenBootstrap};
}

test('startup token write preserves audio preferences and other stored sections', () => {
  const original = {user: {authToken: 'old', volume: 37, messengerKey: 'fixture-key', searchParams: {topic: 'talk'}}, chat: {lastStartDialogTime: 123}, ad: {fsShows: [12]}};
  const result = run(JSON.stringify(original));
  assert.deepEqual(JSON.parse(result.value), {...original, user: {...original.user, authToken: 'fixture-token'}});
  assert.equal(result.status.ok, true);
  assert.equal(result.writes, 1);
});

test('matching token is verified without rewriting settings', () => {
  const saved = JSON.stringify({user: {authToken: 'fixture-token', volume: 12}});
  const result = run(saved);
  assert.equal(result.writes, 0);
  assert.equal(result.value, saved);
  assert.equal(result.status.ok, true);
});

test('empty storage creates the audio token; invalid or inaccessible storage reports failure', () => {
  assert.equal(run(null).status.ok, true);
  for (const value of ['{bad', '[]', '{"user":[]}']) {
    const result = run(value);
    assert.equal(result.writes, 0);
    assert.equal(result.status.ok, false);
  }
  assert.equal(run(null, {denied: true}).status.ok, false);
});

test('unrelated origins are not written and report the explicit mismatch', () => {
  const result = run(null, {origin: 'https://unrelated.test'});
  assert.equal(result.writes, 0);
  assert.equal(result.status.ok, false);
  assert.equal(result.status.reason, 'origin-mismatch:https://unrelated.test/audiochat');
});

test('matching-origin subframes retain the edited bootstrap behavior', () => {
  const result = run(null, {frame: true});
  assert.equal(result.writes, 1);
  assert.equal(result.status.ok, true);
});

test('malformed storage reports the parse stage without exposing stored values', () => {
  const result = run('old-private-fixture-token');
  assert.equal(result.status.ok, false);
  assert.match(result.status.reason, /^json-parse:/);
  assert.equal(JSON.stringify(result.status).includes('old-private-fixture-token'), false);
});

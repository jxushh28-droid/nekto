# Verification — v0.3.0

- 20 automated tests pass: audio mix minus each caller’s own feed, one/two caller lifecycle, mute behavior, bounded queues, real Opus and Discord raw resource pacing, control ownership and isolated token storage.
- Two Chromium WebAudio graphs pass cross-caller plus human feed checks in worklet and compatible fallback modes. Peer connection states are simulated; these are not live RTP tests.
- The actual new browser adapter passes an intercepted site fixture: separate token hydration before page scripts, site-store equality, microphone permission granted, search click, refusal stop, screenshot and independent close.
- The cloud Chromium build reports NotSupportedError for native getUserMedia capture, with or without the fake-file flag. The adapter test allows that limitation only with explicit ALLOW_UNSUPPORTED_CAPTURE=1. Without that flag capture failure fails the test.
- Startup now selects local Chrome/Edge/Chromium before any browser download. Five additional tests cover Windows per-user Chrome, Edge fallback, existing bundled Chromium, explicit channel choices and custom paths. The setup command was also run with an existing executable and skipped downloading. Windows native capture and live sites were not tested here.
- No live Discord token or Nekto credentials were supplied. No ban resolution or live call success is claimed.
- Electron has been removed from the source, dependency lock and startup scripts. No fingerprint spoofing or ban bypass is included.

Reproduce:

```sh
npm ci
npm run install-browser
npm test
node tests/browser-adapter.cjs
node tests/chromium-routing.cjs
FORCE_FALLBACK=1 node tests/chromium-routing.cjs
```

CHROMIUM_EXECUTABLE can select an installed browser for diagnostics. Never package your .env or data folder.

Caller-only disconnect regression verifies that the Discord connection, active mixer and player are preserved while both Nekto sessions close. Railway build/runtime and actual site readiness are checked separately after deployment.

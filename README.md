# Nekto Pair

A black and green web dashboard for two text, audio or video sessions. The app has no Discord integration.

## Text

Two native sessions run at `https://nekto-me.kz/chat/`. One combined feed identifies each stranger with an eye avatar. Forwarded messages appear once, under their original sender. A single composer sends your unchanged message to **both** connected strangers. Enter sends; Shift+Enter adds a newline; IME composition does not submit.

The server validates both current conversation IDs and queue capacities before queuing either copy. A changed conversation rejects the request and keeps the draft. Each copy has its own delivery status. Queues are bounded to 40 messages, expire after 30 seconds and deliver at least 1.1 seconds apart. Old conversation messages cannot reach a new stranger. The visible feed keeps a bounded history during this dashboard visit and shows disconnect notices.

## Audio

The audio page uses native call state and call controls migrated from `jxushh28-droid/nekto-audio`, without its Discord code. Enter voice-session authTokens from `storage_audio_v2.user.authToken`. Tokens are saved before the native page loads; the client's own authorization must succeed. The first search waits **one second**. Later searches reuse the same browser without that delay.

An active call and the visible finished-call screen take precedence over Nekto's stale `isSearching` flag. **Поиск** preserves a current partner; **Следующий** explicitly ends the call, answers a recognized ordinary End confirmation and starts one new search. After a stranger leaves, the finished browser stays open for the next search. Verification and unfamiliar prompts remain available through the native screen in the advanced disclosure. There are no CAPTCHA reload loops or automatic verification answers.

Two separate private PulseAudio virtual microphones carry the opposite participants' incoming audio only after bridge consent. The dashboard never requests your device microphone. Routes are silent before consent, and both directions mute on disconnect or a stopped session. A new conversation requires new bridge consent.

The blue and dark eye outlines light green from each side's incoming PCM audio. They work with local listening off, ignore old session packets and clear on silence/disconnect. Site sound effects can also activate them. Local volume controls affect only your preview.

## Video

Choose **Umingle** or **Chatruletka**. The active dashboard has no Yap.Chat option. Both providers can establish separate anonymous native sessions; no imported token is required.

The matching optional A/B fields accept **browser-session JSON** in Playwright `storageState` format (`cookies` and `origins`) for the selected provider. They do not invent a common provider authToken format. Session pairs and restored profiles are kept separately for Umingle and Chatruletka. Wrong-origin imports and imported verification/restriction state are rejected. Empty fields use independent native anonymous profiles.

The adapters use Umingle's native `button.skipButton`, `textarea.messageInput`, `#myVideo` and `#otherVideo`, and Chatruletka's native `[data-tr="start"]`, `#chat-text`, `#local-video` and `#remote-video`. Startup clicks one available Start control after native media is ready. The native screen supports manual setup or site prompts. The incoming video/audio bridge is enabled only for two connected participants with consent; disconnects and provider restrictions disable it.

Umingle rejected the development cloud browser as a VPN/proxy connection. Live matching has not been verified from that browser. Native provider acceptance and availability still determine whether a hosted session connects.

## Run and deploy

Use the Dockerfile for matching Playwright Chromium, PulseAudio and FFmpeg versions. Set `DASHBOARD_PASSWORD` to a private value of at least 16 characters. `PORT` defaults to 3000. `TEXT_DATA_DIR` defaults to `/data/text-host`; attach a persistent volume at `/data` to retain session settings. Railway uses `/health`.

The dashboard requires authentication for its APIs, checks POST origins, keeps private session files off the public routes, and omits message contents and full session credentials from operation logs. Close other browser modes before opening audio.

For development, run `npm ci`, install Playwright Chromium and the audio system dependencies, then `npm start` with the environment variables set. `npm test` runs the unit and offline browser fixtures. The Docker build runs all tests and then removes development packages. GitHub Actions builds that same image. Generated media fixtures validate routing without contacting Nekto or other users.

`public/eye-a.png` and `public/eye-b.jpg` are the two original images supplied by the user. CSS displays them as circular avatars; the source images are unchanged.

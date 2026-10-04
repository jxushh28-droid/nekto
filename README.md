# Nekto Discord bridge — Node bot, no Electron

Controls run in Discord. Node runs two separate background Chromium contexts for Nekto's website and WebRTC. There is no Electron dependency, local app window, Voicemeeter, or direct undocumented Nekto API implementation. This still uses a browser engine; it is not browser-free.

## Windows setup

1. Install Node.js 24.17 or newer from https://nodejs.org.
2. Extract this ZIP into a writable folder. Run START-BOT.cmd. On the first run it opens `.env`; save your settings and run it again. Dependencies install once. Startup uses your installed Chrome first, then Edge, then any matching Playwright Chromium already installed. It skips browser downloads when one is available; otherwise it downloads Chromium with a 120-second connection timeout.
3. In the Discord developer portal, create a bot and invite it with `bot` and `applications.commands` scopes. Allow View Channel, Send Messages, Embed Links, Attach Files, Connect and Speak. Enable Developer Mode in Discord to copy your server ID and your user ID. No privileged intents are needed.
4. Set `.env`:

```dotenv
DISCORD_TOKEN=your_bot_token
GUILD_ID=your_server_id
OWNER_ID=your_user_id
RELAY_ALL_MEMBERS=true
NEKTO_AUTH_TOKEN_1=your_existing_first_nekto_token
NEKTO_AUTH_TOKEN_2=your_existing_second_nekto_token
```

Use your existing valid session tokens. Blank Nekto values let the site create its normal session. Each token goes into that caller's `storage_audio_v2.user.authToken` before the site loads. This is the storage key used by the site's current JavaScript. Tokens are not substituted into arbitrary WebSocket messages. Restart the bot after editing `.env`. An expired or blocked token can still be rejected by Nekto.

5. Join a server voice channel, run `/nekto`, then press **Поиск 1**, **Поиск 2**, or **Поиск всех**. Disconnect either caller individually or both. Muting Discord voices silences the humans' feed to Nekto; it does not stop the two strangers hearing each other.
6. To inspect site setup or a rejection, use `/nekto-page caller:1` (or 2). The response is private. Use `/nekto-click caller:1 x:... y:...` to click a position in its 1100 × 800 screenshot; it returns an updated screenshot. Use this for site choices, consent or manual verification, then press Search again. Coordinates start at the top left. There is no desktop browser to open.

The silence input lets Chromium grant Nekto native microphone permission without capturing the PC microphone. Once a call connects, the audio bridge replaces its outgoing track with the Discord voices plus the other caller. Incoming stranger audio is mixed into Discord, with each stranger's own feed excluded from their outgoing mix.

## Browser download timeout — v0.2.1

Replace the program files with this version, keeping your existing `.env` and `data/` folder, then run START-BOT.cmd. It no longer insists on downloading Chrome for Testing before it can start. Browser detection checks the common Windows machine-wide and per-user installation paths.

Optional `.env` settings:

```dotenv
BROWSER_CHANNEL=auto
CHROMIUM_EXECUTABLE=
```

Use `BROWSER_CHANNEL=chrome`, `msedge` or `chromium` to choose explicitly. For a portable or unusual installation, set `CHROMIUM_EXECUTABLE` to its full executable path, such as `C:\Program Files\Google\Chrome\Application\chrome.exe` (no quotes needed). An explicit missing path or browser produces an error rather than quietly switching. Setup, doctor and the actual bot use the same selection code.

The background process uses bot-managed isolated contexts and does not open your normal personal Chrome profile. Choosing a locally installed browser fixes the download dependency, not Nekto server refusals.

## Railway deployment

The repository includes a Dockerfile that installs Debian Chromium directly, so no runtime Chrome-for-Testing download is required. Railway builds it from the repository root. Set the Discord and Nekto settings as service variables; do not commit an `.env` file. Run exactly one replica, with sleep disabled. Mount a persistent volume at `/data`, and set `NEKTO_DATA_DIR=/data`. The `/health` endpoint checks Discord gateway readiness on the Railway-provided `PORT`.

`NEKTO_PRELOAD=true` inspects callers with configured tokens after Discord login. It logs whether the token reached the site store and whether the page has an enabled search control; it does not initiate a stranger call. A blank second token remains supported for a normal site-issued session.

**Отключить всех** now closes both Nekto caller sessions and disables auto search while the bot remains in Discord voice. The search handler waits for page readiness, recognizes known controls by their selector as well as translated labels, and distinguishes loading, setup, searching, a real challenge and an access refusal. A token alone does not prove the site completed initialization or that its server accepted the session.

## Blocking and diagnostics

Removing Electron does not prove that an access block is fixed. The site can reject a token, network, browser environment or an unsupported integration. Inspect its actual message with `/nekto-page`; do not repeatedly retry a refused session. No fingerprint defenders, identity randomization, challenge bypass or token rotation are included. Auto search is off initially and stops when the page shows a refusal or verification.

`npm run doctor` checks installed dependencies, Chromium, Opus and DAVE. `npm test` checks mixing, permissions/ownership logic and token persistence. `npm run setup-browser` (also `npm run install-browser`) selects an installed browser and downloads Chromium only if none is available. On Linux a host may also need `npx playwright install --with-deps chromium` and outbound Discord voice UDP access.

`data/session-0.json` and `data/session-1.json` preserve separate site cookies/storage across disconnects and restarts. Treat them and `.env` as credentials; never share them or include them in a support ZIP. Sessions are saved when callers close; a forced process kill can lose the latest state. A configured token is applied when its context is opened, not continually forced over site-issued updates.

## Validation limits

Local tests exercise audio processing, real Discord raw/Opus encoding, two Chromium audio graphs and isolated token hydration. They do not prove live Nekto permission, server acceptance, live Discord voice reception or end-to-end WebRTC calls. No live credentials were supplied. Discord voice reception has no stable public protocol guarantee. Test on your Windows PC with a consenting caller before relying on it.

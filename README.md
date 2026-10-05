# Nekto Text Hub

Hosted, phone-friendly dashboard replacing the previous Discord voice bot. Two isolated Chromium browser contexts connect to https://nekto-me.kz/chat/. Open sessions, select Screen, complete verification and start each text conversation manually, then enable forwarding.

Incoming messages are forwarded unchanged to the other connected session, in both directions. No greetings, prefixes, suffixes, or other automatic messages are sent. Pausing drops queued messages. Conversation changes invalidate old deliveries; queues cap at 40 items, expire after 30 seconds, and sends are spaced by 1.1 seconds. Existing drafts are preserved. Conversation contents are not written to application logs.

## Deployment
Dockerfile includes Playwright's matching Chromium binaries. Set a private `DASHBOARD_PASSWORD` of at least 16 characters, `PORT` (Railway supplies this), and optionally `TEXT_DATA_DIR=/data/text-host`. Attach a volume at /data for session cookies and local storage. Existing voice-session data remains untouched. The old Discord token and voice settings are unused.

Start: `npm install && DASHBOARD_PASSWORD=your-private-long-password npm start`. Tests: `npm test`.

The panel runs in Android Chrome; this is a hosted web app, not an APK. Only the selected screen is streamed as periodic JPEG images. Click the remote screen to focus a field, use the text box to type, and Enter to confirm. Scroll controls support long pages and verification dialogs.

Hosting does not bypass access blocks or CAPTCHA. Nekto can reject a datacenter address or automated browser, and site layout changes can require adapter updates. CAPTCHA is completed by the operator. Runtime health is distinct from successfully connecting to live Nekto conversations.

Source history preserves the previous voice bot; a backup branch also points to its last commit.

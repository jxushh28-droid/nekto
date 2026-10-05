# Nekto Text Hub

A hosted, phone-friendly dashboard with two native conversation panels. Click Connect for A and B, or Connect both, to start the site's searches automatically. Each panel shows that stranger's messages and what was sent to them. Forwarding starts automatically when both strangers are connected. There are no screenshots or remote browser controls.

Incoming messages are forwarded unchanged to the other connected session. No greetings, labels, prefixes, suffixes, or extra automatic messages are sent. Each panel's message box sends only to that panel's stranger; operator messages are not copied to the other side. Enter sends and Shift+Enter inserts a newline. Conversation history is held in memory and cleared when that conversation changes.

Two isolated Chromium contexts run the text client at https://nekto-me.kz/chat/. Conversation changes invalidate old deliveries, queues cap at 40 messages and expire after 30 seconds, and sends are spaced by 1.1 seconds. Incoming bubbles are tracked separately from outgoing bubbles to prevent loops. The sender waits for the client editor to synchronize before clicking Send, then checks that the input clears. Existing drafts are preserved. Chat text is not written to application logs.

## Deployment

The Dockerfile includes Playwright's matching Chromium binaries. Set a private `DASHBOARD_PASSWORD` of at least 16 characters and optionally `TEXT_DATA_DIR=/data/text-host`. Railway supplies `PORT`. Attach a volume at /data for session cookies and local storage. The previous voice bot's settings are unused; its source remains in Git history and a backup branch.

Run `npm install`, then `DASHBOARD_PASSWORD=your-private-long-password npm start`. Run `npm test` for adapter, bidirectional forwarding, private-message isolation, stale-conversation, and token-storage tests. The dashboard works in Android Chrome as a hosted web app.

## Existing session tokens

The optional token form accepts two distinct authTokens from your own Nekto sessions. Applying them replaces current sessions, imports supported authToken fields into separate saved browser storage, and starts both searches automatically. Tokens are submitted in authenticated request bodies, cleared from the form, and omitted from logs and status responses. Saved fields are preserved. After the text client loads, the app commits `user/setAuthToken` to its running Vuex store and calls its existing `authorize()` method. It waits for `user/socket_auth.successToken` and checks that the supplied token remains in both live state and `storage_v2`. Token replacement or timeout stops that connection and reports an error. Session storage persists on the server volume.

A token import does not prove the site accepted the token or guarantee that verification is skipped. If Nekto requires CAPTCHA or blocks the hosting address, the panel reports that status. This dashboard cannot complete that verification. Live matching depends on the site's acceptance and availability; passing the application tests does not establish a live stranger connection.

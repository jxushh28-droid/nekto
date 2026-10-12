// Share the original nekto-audio readiness and native registration observer.
// These functions are self-contained so Playwright can run them in the page.
export {
  audioClientReady as voiceReady,
  confirmAudioToken as confirmVoiceSession,
} from './audio-call/live-session.js';

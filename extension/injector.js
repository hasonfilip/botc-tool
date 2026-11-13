// Relay between page-bridge.js (registered in the manifest as a MAIN-world
// content script, so the WebSocket hook is installed synchronously before any
// page script runs) and the background service worker.
// Like the bridge, it loads on every botc.app page so it's already there when
// the app routes into /play without a page load.

const safePost = (msg) => {
  try { chrome.runtime.sendMessage(msg); } catch { /* extension reloaded, ignore */ }
};

// Listen for messages from page-bridge.js and relay to background
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'botc-bridge') return;
  safePost({ type: 'BOTC_UPDATE', payload: event.data.payload });
});

// Listen for background requests and relay them verbatim to page-bridge.js —
// the bridge dispatches on `type` and reads whatever fields the command carries.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.type !== 'string') return;
  window.postMessage({ source: 'botc-bridge-cmd', ...message }, '*');
  sendResponse({ ok: true });
});

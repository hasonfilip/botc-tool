// Relay between page-bridge.js (registered in the manifest as a MAIN-world
// content script, so the WebSocket hook is installed synchronously before any
// page script runs) and the background service worker.

const safePost = (msg) => {
  try { chrome.runtime.sendMessage(msg); } catch { /* extension reloaded, ignore */ }
};

// Listen for messages from page-bridge.js and relay to background
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'botc-bridge') return;
  safePost({ type: 'BOTC_UPDATE', payload: event.data.payload });
});

// Listen for background requests to force a state push
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FORCE_UPDATE') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'FORCE_UPDATE' }, '*');
    sendResponse({ ok: true });
  }
});

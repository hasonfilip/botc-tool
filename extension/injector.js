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

// Listen for background requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FORCE_UPDATE') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'FORCE_UPDATE' }, '*');
    sendResponse({ ok: true });
  }
  if (message.type === 'SEND_SIGNAL') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'SEND_SIGNAL', userIds: message.userIds, message: message.message }, '*');
    sendResponse({ ok: true });
  }
  if (message.type === 'SET_TIMER') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'SET_TIMER', title: message.title, duration: message.duration, isPausedDuringVotes: message.isPausedDuringVotes, paused: message.paused }, '*');
    sendResponse({ ok: true });
  }
  if (message.type === 'END_GAME') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'END_GAME', isEvilWin: message.isEvilWin }, '*');
    sendResponse({ ok: true });
  }
  if (message.type === 'GONG') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'GONG' }, '*');
    sendResponse({ ok: true });
  }
  if (message.type === 'ADD_SEAT' || message.type === 'SHUFFLE_SEATS' || message.type === 'REMOVE_EMPTY_SEATS') {
    window.postMessage({ source: 'botc-bridge-cmd', type: message.type, order: message.order, indices: message.indices }, '*');
    sendResponse({ ok: true });
  }
  if (message.type === 'BECOME_STORYTELLER' || message.type === 'STEP_DOWN_STORYTELLER') {
    window.postMessage({ source: 'botc-bridge-cmd', type: message.type }, '*');
    sendResponse({ ok: true });
  }
  if (message.type === 'LOAD_CUSTOM_SCRIPT') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'LOAD_CUSTOM_SCRIPT', author: message.author, name: message.name, roles: message.roles }, '*');
    sendResponse({ ok: true });
  }
});

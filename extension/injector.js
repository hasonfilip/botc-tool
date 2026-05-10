// Injector: runs at document_start in the page context via a script tag,
// so it can hook WebSocket before botc.app opens its connection.

const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-bridge.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

const safePost = (msg) => {
  try { chrome.runtime.sendMessage(msg); } catch { /* extension reloaded, ignore */ }
};

// Listen for messages from page-bridge.js and relay to background
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'botc-bridge') return;
  safePost({ type: 'BOTC_UPDATE', payload: event.data.payload });
});

// Listen for background requests to force a state push
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FORCE_UPDATE') {
    window.postMessage({ source: 'botc-bridge-cmd', type: 'FORCE_UPDATE' }, '*');
  }
});

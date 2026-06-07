# BOTC Tool

A browser extension companion panel for [Blood on the Clocktower Online](https://botc.app).

Opens a live tab showing players, roles, game timeline, nominations, and conversation logs.

<img width="2488" height="1261" alt="image" src="https://github.com/user-attachments/assets/4b71b8ae-327b-4b6c-83fe-0f61128d29e1" />


## Features

- **Notes grid** — per-player per-phase cells with role chips: ability inputs, predefined tags, and claimed roles, each with an importance level; supports a player timeline drawer (click a player to see their full game history)
- **Player table** — seat, name, pronouns, role, and status tags; highlight toggle per player or all at once
- **Timeline** — phase blocks (Night/Day) with deaths, exiles, ghost votes, and (spoiler-hidden) game result
- **Nominations log** — who nominated who, vote count, and individual voters; tracks hands raised in real time
- **Conversation log** — private, public, and night channel visits with duration and participants
- **Text messages** — captured direct messages
- **Connection indicator** — seconds since last signal, with a warning and reload prompt if the connection goes stale
- **Live WS events** — raw WebSocket stream for debugging

## Installation

The extension is not on any store. Load it as an unpacked extension:

### Chrome / Vivaldi / Edge / Brave

1. Download or clone this repo
2. Go to `chrome://extensions` (or `vivaldi:extensions`, `edge://extensions`, etc.)
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` folder inside this repo
6. Click the extension icon in the toolbar to open the companion panel
7. If the botc.app tab was already open, reload it — the companion will show a prompt if no data is detected

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside the `extension/` folder (e.g. `manifest.json`)
4. Click the extension icon to open the companion panel, then reload the botc.app tab if prompted

> Firefox temporary add-ons are removed on browser restart. For a persistent install, the extension would need to be signed by Mozilla.

## Updating

If you loaded the extension as unpacked:

1. Pull the latest changes (`git pull`)
2. Go to your extensions page and click the refresh icon on the BOTC Tool card
3. Reload the botc.app tab

## How it works

The extension injects a script into the botc.app page that hooks the WebSocket connection and watches localStorage and DOM changes. All data is relayed to a background service worker, which processes it and pushes updates to the companion panel tab.

### Architecture

```
botc.app page
  └─ page-bridge.js   (page context — hooks WebSocket, watches localStorage & DOM)
       │ window.postMessage
  └─ injector.js      (content script — relays messages to background)
       │ chrome.runtime.sendMessage
  └─ background.js    (service worker — deduplicates events, maintains state)
       │ chrome.runtime.sendMessage
  └─ companion/       (panel tab — renders everything the user sees)
```

Role data and ability chip specs are bundled locally in `data/` — no network requests are made to any external server. No data leaves your browser.

## Permissions used

| Permission | Why |
|---|---|
| `storage` | Persists game state across service worker restarts |
| `tabs` | Opens and communicates with the companion panel tab |
| `scripting` | Re-injects the page hook after extension reloads |
| `https://botc.app/*` | Reads game state from the botc.app page |

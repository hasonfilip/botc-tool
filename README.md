# BOTC Tool

A browser extension companion panel for [Blood on the Clocktower Online](https://botc.app).

It opens a separate tab next to your botc.app game. As a player it gives you a notes grid and a live record of everything that happened; as a storyteller it also lets you run the game from the panel: signals, nominations, the vote clock, timers, seating and scripts.

<img width="2500" height="1242" alt="image" src="https://github.com/user-attachments/assets/3278f7cf-66e9-4adf-b7ab-afb0b795a8d6" />

## Features

The header shows the session, current phase, player and alive counts, the script, the storytellers, and a connection indicator (seconds since the last signal, with a reload prompt if the connection goes stale). The **Storyteller / Player** switch picks which view you get; it follows your storyteller status in botc.app, and **Become Storyteller** takes or gives up the role from the panel.

### For everyone

- **Notes grid** — one cell per player per phase, holding role chips: ability inputs tailored to each character, predefined tags, and claimed roles, each with an importance level. Click a player to open a drawer with their full game history.
- **Timeline** — Night/Day blocks with deaths, exiles and ghost votes, and the game result hidden behind a spoiler. Day and night can be merged into one block in settings.
- **Nominations** — who nominated whom, the vote count and the individual voters, with hands tracked live.
- **Conversations** — private, public and night channel visits with duration and participants, filterable by player.
- **Messages** — captured direct messages, sharing the same player filter.
- **Session preview** — the *Sessions* button in the header looks up any other session (and keeps a list of the ones you save), showing its phase, script, storyteller, players and spectators without joining it, refreshed while the list is open. *Join* sends your botc.app tab to a running session.
- **Logs** — the raw WebSocket stream, for debugging.

### For storytellers

- **Signals** — build a message from phrases, roles and players, send it to selected players or everyone, attach a live grimoire snapshot, save presets, and browse the signal history.
- **Player circle** — the live grimoire by seat. Set roles and alignment, nominate, mark or unmark for execution, and manage seats: swap, shuffle, rotate, add, remove empty.
- **Nomination alerts** — warnings while you pick the nominator and nominee for things that need resolving on the spot (Virgin, Witch, Golem, Devil's Advocate, Tea Lady, Sailor, Fool).
- **Vote clock** — choose the nomination type (regular, nominee focus, accusation & defense), set the votes needed to execute and the tick speed, then run the count: countdown, start, pause, reset, mark, close. *Clock tools* take over the hand: step it seat by seat, point it anywhere, end the count early, or use a pattern (speed up, slow down, stutter, wobble). Secret votes and the Big Wig's defense attorney are offered when the relevant character is in play.
- **Phase and timer** — next phase, gong, join voice, a titled countdown timer with presets and pause-during-votes, and Good wins / Evil wins.
- **Night order** — the script's characters in wake order for the first night and other nights, with the players holding them. For Trouble Brewing characters the signal to send is drafted for you from the game state and the player's reply. (WIP)
- **Script library** — point it at a folder of script JSON files (or upload a single one) and search by name, author or role. Filter by Base 3, single-Demon, label and difficulty, sort by name or difficulty, and load a script into the game. Difficulty is an estimate computed from per-character ratings.
- **Clear** — clears the grimoire.

## Installation

The extension is not on any store. Load it as an unpacked extension:

### Chrome / Vivaldi / Edge / Brave

1. Download or clone this repo
2. Go to `chrome://extensions` (or `vivaldi:extensions`, `edge://extensions`, etc.)
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` folder inside this repo
6. Click the extension icon in the toolbar to open the companion panel
7. If the botc.app tab was already open, the extension connects to it automatically — game state works right away, but live events (nominations, chats, messages) need a one-time reload of the botc.app tab (the companion shows a notice when this applies)

Requires Chrome/Chromium 111+.

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside the `extension/` folder (e.g. `manifest.json`)
4. Click the extension icon to open the companion panel, then reload the botc.app tab if prompted

Requires Firefox 128+.

> Firefox temporary add-ons are removed on browser restart. For a persistent install, the extension would need to be signed by Mozilla.

> Firefox has no local folder picker API, so the script library can't remember your folder there — you choose it again each time you want to rescan.

## Updating

If you loaded the extension as unpacked:

1. Pull the latest changes (`git pull`)
2. Go to your extensions page and click the refresh icon on the BOTC Tool card
3. Reload the botc.app tab

## How it works

The extension injects a script into the botc.app page that hooks the WebSocket connection, watches localStorage and the DOM, and reads the page's Vuex store. Everything is relayed to a background service worker, which processes it and pushes updates to the companion tab.

Storyteller actions travel the other way. The companion sends a command, the background relays it to the botc.app tab, and the page script commits the same store mutation that botc.app's own UI would. The extension never writes WebSocket frames itself.

Only one botc.app tab feeds the companion at a time. If you have several `/play` tabs open, the first one is used until it closes.

### Architecture

```
botc.app page
  └─ page-bridge.js   (MAIN-world content script — hooks WebSocket before the
       ▲│               page connects, watches localStorage & DOM, runs
       ││               commands against the Vuex store)
       ││ window.postMessage
  └─ injector.js      (content script — relays both directions)
       ▲│ chrome.runtime messaging
  └─ background.js    (service worker — deduplicates events, maintains state,
       ▲│               allowlists commands)
       ││ chrome.runtime messaging
  └─ companion/       (panel tab — renders everything the user sees)
```

### Repo layout

| Path | What it is |
|---|---|
| `extension/` | The extension itself — the folder you load |
| `extension/data/` | Bundled data: roles and icons, ability chip specs, night order, night signal drafts, nomination alerts, difficulty ratings |
| `night-order-*.txt` | Source lists that `extension/data/nightOrder.js` was generated from |
| `jinxes.json` | Jinx data, not used by the extension yet |

## Privacy

Game data stays in your browser. Game state is kept in session storage and cleared when the browser closes; your settings, presets and script folder are kept in the companion's local storage and IndexedDB.

The companion page loads its fonts from Google Fonts, and a custom script can point to character icons hosted elsewhere. Those are the only requests made to anything other than botc.app. Roles, icons and all other data are bundled in `extension/data/`.

## Permissions used

| Permission | Why |
|---|---|
| `storage` | Persists game state across service worker restarts |
| `tabs` | Opens and communicates with the companion panel tab |
| `scripting` | Re-injects the page hook after extension reloads |
| `https://botc.app/*` | Reads game state from the botc.app page and sends storyteller commands to it |

## Disclaimer

BOTC Tool is unofficial, community-created content. It is not made, endorsed or supported by The Pandemonium Institute, and it is free and non-commercial.

Blood on the Clocktower, its characters, ability text and artwork are trademarks and copyright of Steven Medway and The Pandemonium Institute. The character data and icons bundled here are theirs, included under the [Community Created Content Policy](https://bloodontheclocktower.com/pages/community-created-content-policy).

The tool is a companion to the official app at [botc.app](https://botc.app), not a replacement for it: it does nothing without a game running there.

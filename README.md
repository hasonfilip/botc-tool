# BOTC Tool

A browser extension companion panel for [Blood on the Clocktower Online](https://botc.app).

It opens a separate tab next to your botc.app game. As a player it gives you a notes grid and a live record of everything that happened; as a storyteller it also lets you run the game from the panel: signals, nominations, the vote clock, timers, seating and scripts.

<img width="2500" height="1242" alt="image" src="https://github.com/user-attachments/assets/3278f7cf-66e9-4adf-b7ab-afb0b795a8d6" />

## Features

The header shows the session, phase, player and alive counts, script, storytellers and connection state. The **Storyteller / Player** switch follows your role in botc.app; **Become Storyteller** takes or gives it up from the panel.

### For everyone

- **Notes grid** — a cell per player per phase for role chips: ability inputs, tags and claims. Notes about a role whose player you don't know yet go in a role-notes table and move over once you assign it. Deaths, executions and revivals are added automatically. Click a player for their full history.
- **Nominations** — who nominated whom, the votes and the voters, tracked live.
- **Conversations** and **Messages** — channel visits and direct messages, filterable by player.
- **Sessions** — look up other sessions without joining them, save a list, and join one.
- **Logs** — the raw WebSocket stream, for debugging.

### For storytellers

- **Signals** — build a message from phrases, roles and players and send it to some or all players, optionally with a grimoire snapshot. Presets and history; a recipient's night step is offered as a suggestion.
- **Player circle** — the live grimoire by seat: roles, alignment, nominating, marking for execution, and seat management (swap, shuffle, rotate, add, remove).
- **Nomination alerts** — while you pick the nominator and nominee, flags what needs resolving on the spot (Virgin, Witch, Golem, Saint, Goblin, Riot, Pacifist, …), noting when the ability may be drunk/poisoned or a misregistration is your call. Seats that can't nominate or be nominated again today are dimmed.
- **Shut up and listen** — an empty seat that nominates itself under nominee focus, so only the storyteller has the floor. Click again to undo.
- **Vote clock** — nomination type, votes needed and speed, then run the count. Clock tools let you step, point or pattern the hand. Secret votes and the Big Wig's attorney appear when those characters are in play.
- **Phase and timer** — next phase, gong, voice, a countdown timer with presets, and Good wins / Evil wins.
- **Night order** — at night it replaces the timer: tonight's wake order as steps, one per role holder, driven by `data/nightActions.js`. Steps prompt the player, read their reply, suggest answers for info roles, and sync with grimoire reminder tokens both ways. They warn when info must or may be false (droisoned holders, Vortox, a Recluse or Spy involved) and flag invalid picks. Nothing is sent or placed without a click.
- **Script library** — load script JSONs from a folder or file, search, filter, sort by estimated difficulty, and load one into the game.

## Installation

The extension is not on any store. Load it as an unpacked extension:

### Chrome / Vivaldi / Edge / Brave

1. Download or clone this repo
2. Go to `chrome://extensions` (or `vivaldi:extensions`, `edge://extensions`, etc.)
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` folder inside this repo
6. Click the extension icon in the toolbar to open the companion panel
7. An already open botc.app tab connects automatically; only the raw WebSocket log needs a reload

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
| `extension/data/` | Bundled data: roles and icons, ability chip specs, night order, night-sheet instructions, night actions, night step hints, nomination alerts, difficulty ratings |
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

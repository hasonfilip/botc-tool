# BOTC Tool

A browser extension companion panel for [Blood on the Clocktower Online](https://botc.app).

It opens a separate tab next to your botc.app game. As a player it gives you a notes grid and a live record of everything that happened; as a storyteller it also lets you run the game from the panel: signals, nominations, the vote clock, timers, seating and scripts.

<img width="2500" height="1242" alt="image" src="https://github.com/user-attachments/assets/3278f7cf-66e9-4adf-b7ab-afb0b795a8d6" />

## Features

The header shows the session, current phase, player and alive counts, the script, the storytellers, and a connection indicator (botc.app's own connection state and ping, and a notice when the botc.app tab is closed, asleep or needs a reload). The **Storyteller / Player** switch picks which view you get; it follows your storyteller status in botc.app, and **Become Storyteller** takes or gives up the role from the panel.

### For everyone

- **Notes grid** — one cell per player per phase, holding role chips: ability inputs tailored to each character, predefined tags, and claimed roles, each with an importance level. Click a player to open a drawer with their full game history. Information about a role whose player you don't know yet goes into a separate role-notes table above the grid (added with "+ role notes"), with the same phase columns; a row can also carry a label you type yourself. Once you learn who it is, assign the row and its notes move to that player. Chips can be dragged between cells and removed with the × that appears on hover. Deaths, executions, exiles and revivals are added as chips automatically, and *highlight deaths* tints those cells so the game's course reads at a glance.
- **Nominations** — who nominated whom, the vote count and the individual voters, with hands tracked live.
- **Conversations** — private, public and night channel visits with duration and participants, filterable by player.
- **Messages** — captured direct messages, sharing the same player filter.
- **Session preview** — the *Sessions* button in the header looks up any other session (and keeps a list of the ones you save), showing its phase, script, storyteller, players and spectators without joining it, refreshed while the list is open. *Join* sends your botc.app tab to a running session.
- **Logs** — the raw WebSocket stream, for debugging.

### For storytellers

- **Signals** — build a message from phrases, roles and players, send it to selected players or everyone, attach a live grimoire snapshot, save presets, and browse the signal history. With one recipient and an empty message, their night-order step for tonight is offered as a one-click suggestion (the prompt, and the answer with grimoire reminders worked in); after *This player is*, players carrying the recipient's role reminders come first.
- **Player circle** — the live grimoire by seat. Set roles and alignment, nominate, mark or unmark for execution, and manage seats: swap, shuffle, rotate, add, remove empty.
- **Nomination alerts** — warnings while you pick the nominator and nominee for things that need resolving on the spot (Virgin, Witch, Golem, Devil's Advocate, Tea Lady, Sailor, Fool).
- **Shut up and listen** — adds an empty seat that nominates itself under nominee focus, so nobody but the storyteller has the floor; an open nomination is closed first. Click again to scrap the nomination, restore the nomination type and remove the seat. Not available at 20 seats.
- **Vote clock** — choose the nomination type (regular, nominee focus, accusation & defense), set the votes needed to execute and the tick speed, then run the count: countdown, start, pause, reset, mark, close. *Clock tools* take over the hand: step it seat by seat, point it anywhere, end the count early, or use a pattern (speed up, slow down, stutter, wobble). Secret votes and the Big Wig's defense attorney are offered when the relevant character is in play.
- **Phase and timer** — next phase, gong, join voice, a titled countdown timer with presets and pause-during-votes, and Good wins / Evil wins.
- **Night order** — during a night it takes the timer's place in the right column (*Timer* / *Night order* in the Phase header switches between them for that night; the count beside the night skips dead holders who no longer wake and once-per-game abilities already used): tonight's wake order as steps, one per role holder (plus Minion info / Demon info on the first night with 7+ players). Each role's step follows `data/nightActions.js`: whether it opens with *Make a choice!*, *Use your ability?* (a "no" reply passes; once-per-game abilities show as used afterwards), just sends info (e.g. the grimoire for the Spy) or doesn't wake at all; which of its notes-grid chip inputs are the player's pick (filled from their reply), what they're told (what *Send* sends) or your note (never sent, e.g. the Undertaker's executed player); conditional wakes ("only if the Ravenkeeper died tonight"); and one-click follow-ups to other players (the Cerenovus target, the Demon for the King or Marionette, …). Steps also follow what you do in botc.app: a prompt or answer sent from the app moves the step along, and grimoire reminder tokens work both ways — the Washerwoman's *Townsfolk*/*Wrong*, the Poisoner's *Poisoned*, the Monk's *Safe* and so on pre-fill the step's inputs as suggestions to confirm (for picks, only ones placed during the night — reminders can be misplaced or forgotten, so only a player's reply finishes a step by itself), and finishing a step yourself (Send / Done) places them in the app on the chosen players. It never sends anything or touches the grimoire without a click — free-form signals and unusual games just show up as replies on the steps. Info roles' two players go out in random order. The latest picks win if a player sends more than one reply, and a pick that changes after the step was finished updates the notes and is flagged (in red if you'd already sent an answer for the old one). New messages from a player after their step is finished (or since you last opened it) show on the step's row: a small 👍 for an acknowledgement, the message itself for anything else. Gained abilities get their own steps at that character's place, marked *via …*: the Philosopher's, Apprentice's and Alchemist's character (from their step), the Boffin's ability for the Demon, the Cannibal's (shown in a *Check* box above the order — pre-filled from the last execution or their Lunch reminder, changeable there), and the Plague Doctor's Minion ability as a Storyteller step that wakes no one. A player shown with the token of the character whose ability they have plus an *Is the …* reminder (Philosopher, Alchemist, Cannibal, Drunk, Marionette…) wakes as the token's character but counts as who they really are for teams, info and warnings. A first-night-only ability gained later (e.g. a Cannibal or Philosopher with the Washerwoman's) wakes once, the first night they have it, next to the other info roles. Picks are checked against the ability (alive / dead players, not yourself, not a Traveller, two different players, not the same as last night): a reply that breaks one is flagged and won't finish the step, with a one-click *No + Make a choice!* reply. A finished step writes the ability chip into the holder's cell for the night, plus a Droisoned chip on the target for poison/drunk abilities. Suggested answers (dashed until you send or change them) for Empath, Chef, Fortune Teller, Undertaker, Ravenkeeper, Grandmother, Harlot, Washerwoman/Librarian/Investigator (from the reminders), Town Crier and Flowergirl (from today's nominations and votes), Oracle, Clockmaker, Shugenja, Village Idiot, Seamstress, Sage, Choirboy and Dreamer; a step warns (⚠ on the row, details when open) when its info must be false (Vortox, for Townsfolk) or its ability may not work / info may be false: drunk or poisoned reminders on the holder from any source (Sailor, Innkeeper, Philosopher, Courtier, the drunk Village Idiot, Minstrel, Poisoner, Pukka, No Dashii, Widow, …), a Drunk/Marionette/Lunatic reminder, or a droison in the notes grid — and a Barista's Sober & Healthy is noted; it also flags a Recluse or Spy among the players the info follows from (the player's own picks, the executed player, the Empath's neighbours, everyone for Chef/Clockmaker/Oracle/Town Crier/Flowergirl/Shugenja), since they may misregister — not players you choose to show yourself. Hovering a role name (marked ⓘ) or a marker shows the official night-sheet instruction. A Savant or Fisherman in play is listed at the end under *Coming day*.
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
7. If the botc.app tab was already open, the extension connects to it automatically — game state, nominations, chats and messages are read from botc.app's store and work right away; only the raw WebSocket log needs a reload of the botc.app tab

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

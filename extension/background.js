// Service worker: relays game state from content script to companion tab.
// Uses chrome.storage.session to survive MV3 service worker restarts.

let companionTabId = null;

// The single botc.app tab whose bridge feeds game state. With several /play
// tabs open, merging their payloads corrupts state (phantom death diffs,
// flip-flopping game detection) and fanning commands out executes them once
// per tab — so one tab is adopted and the rest are ignored until it closes.
let activeBridgeTabId = null;

async function isActiveBridgeTab(tabId) {
  if (tabId == null || tabId === activeBridgeTabId) return true;
  if (activeBridgeTabId === null) { activeBridgeTabId = tabId; return true; }
  try {
    // A tab that has left /play (back to the lobby, another site) no longer
    // runs a game — holding on to it would shut out the tab that does.
    const active = await chrome.tabs.get(activeBridgeTabId);
    if (isPlayUrl(active.url)) return false;
  } catch { /* closed */ }
  activeBridgeTabId = tabId;
  return true;
}

const isPlayUrl = (url) => typeof url === 'string' && url.startsWith('https://botc.app/play');

async function resolveCompanionTabId() {
  if (companionTabId !== null) {
    try { await chrome.tabs.get(companionTabId); return companionTabId; } catch { companionTabId = null; }
  }
  const url = chrome.runtime.getURL('companion/index.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) { companionTabId = tabs[0].id; return companionTabId; }
  return null;
}

async function sendToCompanion(msg) {
  const tabId = await resolveCompanionTabId();
  if (tabId !== null) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

const store = {
  async get() {
    const data = await chrome.storage.session.get(['latestState', 'timeline', 'wsEvents', 'processedIds', 'nameMap', 'currentGameId', 'nominations', 'pendingNomination', 'chatSessions', 'cellTokens', 'materializedStatus', 'playerMeta', 'textMessages', 'channelPresence']);
    return {
      latestState: data.latestState ?? null,
      timeline: data.timeline ?? [],
      wsEvents: data.wsEvents ?? [],
      processedIds: new Set(data.processedIds ?? []),
      nameMap: data.nameMap ?? {},
      currentGameId: data.currentGameId ?? null,
      nominations: data.nominations ?? [],
      pendingNomination: data.pendingNomination ?? null,
      chatSessions: data.chatSessions ?? [],
      cellTokens: data.cellTokens ?? {},
      materializedStatus: data.materializedStatus ?? [],
      playerMeta: data.playerMeta ?? {},
      textMessages: data.textMessages ?? [],
      channelPresence: data.channelPresence ?? {},
    };
  },
  async set(patch) {
    await chrome.storage.session.set(patch);
  },
};

// All storage-mutating handlers run through one promise chain — concurrent
// read-modify-write cycles on chrome.storage.session would lose updates.
let _chain = Promise.resolve();
function enqueue(fn) {
  const next = _chain.then(fn);
  _chain = next.catch(e => console.error('botc-tool:', e));
  return next;
}

// ── Bridge connectivity ───────────────────────────────────────────────────

// Ping the content script in a botc.app tab; if it's missing (tab was open
// before the extension loaded), inject the scripts programmatically. A
// late-injected WebSocket hook can't capture an already-open socket, but only
// the raw WS log depends on it: state, nominations, chats and messages all
// come from the store, which can be subscribed to at any time.
async function ensureBridge(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'FORCE_UPDATE' });
    return 'alive';
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-bridge.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['injector.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'FORCE_UPDATE' });
      return 'injected';
    } catch {
      return 'failed';
    }
  }
}

async function connectToTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://botc.app/play*' });
  if (tabs.length === 0) return 'no-tab';
  const results = await Promise.all(tabs.map(ensureBridge));
  if (results.includes('alive')) return 'alive';
  if (results.includes('injected')) return 'injected';
  return 'failed';
}

// A tab the browser has frozen or discarded never answers, so nothing waits
// on one for long.
const TIMED_OUT = Symbol('timed-out');
const within = (ms, promise) => Promise.race([promise, new Promise(r => setTimeout(() => r(TIMED_OUT), ms))]);

// The companion's periodic liveness check. PING goes through the injector to
// the page bridge, which answers with a CONN payload (relayed to the companion
// like any other bridge message) — so 'alive' here only means the injector
// took the message; the CONN arriving is what proves the bridge itself.
// → 'no-tab' | 'asleep' | 'alive' | 'injected' | 'failed'
async function checkConnection() {
  const tabs = await chrome.tabs.query({ url: 'https://botc.app/play*' });
  if (tabs.length === 0) return 'no-tab';
  const tab = tabs.find(t => t.id === activeBridgeTabId) ?? tabs[0];
  if (tab.discarded || tab.frozen) return 'asleep';
  try {
    const res = await within(3500, chrome.tabs.sendMessage(tab.id, { type: 'PING' }));
    return res === TIMED_OUT ? 'asleep' : 'alive';
  } catch {
    // No injector in the tab (it was open before the extension loaded).
    const res = await within(5000, ensureBridge(tab));
    if (res === TIMED_OUT) return 'asleep';
    if (res !== 'failed') chrome.tabs.sendMessage(tab.id, { type: 'PING' }).catch(() => {});
    return res;
  }
}

// ── WS frame parsing & dedup ──────────────────────────────────────────────

function parseSocketIO(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^\d+(?:\/[^,]+,)?(\[.*)/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// In-memory dedup: server sends each WS message 4x. Survives only as long as
// the service worker, but duplicate bursts arrive within milliseconds.
function isDup(map, key, windowMs = 1500) {
  const now = Date.now();
  if (now - (map.get(key) ?? 0) < windowMs) return true;
  map.set(key, now);
  if (map.size > 500) {
    for (const [k, t] of map) if (now - t > windowMs) map.delete(k);
  }
  return false;
}

const _nomDedupMap = new Map();
const _msgDedupMap = new Map();
const _chanDedupMap = new Map();

// ── Nomination processing ─────────────────────────────────────────────────

// Votes an execution needs, the way botc.app's vote overlay works it out:
// `highscore` is the most votes any nomination got today, and it has to be
// beaten, not tied — unless that's still under a majority of the living. A
// traveller's exile always takes a majority of everyone.
function votesNeeded(players, nomineeSeat, highscore) {
  const nominee = players.find(p => p.seat === nomineeSeat);
  if (nominee?.team === 'traveller') return Math.ceil(players.length / 2);
  const alive = players.filter(p => !p.isDead).length;
  return Math.max(Math.ceil(alive / 2), (highscore ?? 0) + 1);
}

async function handleNominationFrame(eventName, eventData, ts) {
  if (isDup(_nomDedupMap, eventName + JSON.stringify(eventData))) return;

  const { nominations, pendingNomination, latestState } = await store.get();

  if (eventName === 'nomination') {
    if (Array.isArray(eventData.nomination)) {
      const [nominatorSeat, nomineeSeat] = eventData.nomination;
      // `highscore` on the entry is the votes needed, not the app's raw value.
      const highscore = votesNeeded(latestState?.players ?? [], nomineeSeat, eventData.highscore);
      // Snapshot seat→name now: seats get shuffled/rotated later, so resolving
      // them against the then-current player list would rewrite history.
      const seatNames = {};
      for (const p of latestState?.players ?? []) {
        if (p.name != null) seatNames[p.seat] = p.name;
      }
      // The store's vote clock may have opened this one already (it sees the
      // same nomination, and can beat the frame here).
      if (pendingNomination && pendingNomination.nominatorSeat === nominatorSeat && pendingNomination.nomineeSeat === nomineeSeat) return;
      const entry = { ts, nominatorSeat, nomineeSeat, seatNames, highscore, handState: {}, yesSeats: [] };
      await store.set({ pendingNomination: entry });
      // The companion needs the open nomination too, not just closed ones: it
      // counts toward the per-day nominate-once limits the moment it's made.
      await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations, pendingNomination: entry });
    } else if (eventData.nomination === false && pendingNomination) {
      await store.set({ nominations: [...nominations, pendingNomination], pendingNomination: null });
      await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations: [...nominations, pendingNomination], pendingNomination: null });
    }
    return;
  }

  if (!pendingNomination) return;

  // The storyteller edited the number mid-nomination (pen icon or companion).
  if (eventName === 'voteHighscore' && typeof eventData === 'number') {
    const entry = { ...pendingNomination, highscore: votesNeeded(latestState?.players ?? [], pendingNomination.nomineeSeat, eventData) };
    await store.set({ pendingNomination: entry });
    await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations, pendingNomination: entry });
    return;
  }

  // lock [L] / lock [L, vote] — the clock hand. L > 1 locks the seat L − 1
  // places clockwise of the nominee (the nominee last, at L = seats + 1) and
  // carries the vote the storyteller's client held for it at that moment.
  // That value is what the app counts, whatever `vote` frames said or say later.
  if (eventName === 'lock' && Array.isArray(eventData) && typeof eventData[0] === 'number') {
    const [locked, value] = eventData;
    const seatCount = latestState?.players?.length ?? 0;
    const entry = { ...pendingNomination, locked };
    if (locked > 1 && seatCount > 0 && (value === 0 || value === 1)) {
      const seat = (pendingNomination.nomineeSeat + locked - 1) % seatCount;
      entry.handState = { ...pendingNomination.handState, [seat]: value };
    }
    await store.set({ pendingNomination: entry });
    await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations, pendingNomination: entry });
    return;
  }

  if (eventName === 'vote' && Array.isArray(eventData)) {
    // vote [seat, 0|1] — track live hand state; seat indices here are real seat numbers
    const [seat, value] = eventData;
    // The hand has already passed this seat: its vote is locked in, and a late
    // hand change (the frame still arrives) doesn't count.
    const seatCount = latestState?.players?.length ?? 0;
    if (seatCount > 0 && typeof pendingNomination.locked === 'number') {
      const offset = (((seat - pendingNomination.nomineeSeat) % seatCount) + seatCount) % seatCount;
      if (pendingNomination.locked >= (offset || seatCount) + 1) return;
    }
    // A real toggle (up→down→up) must not be eaten by the duplicate window
    _nomDedupMap.delete('vote' + JSON.stringify([seat, value ? 0 : 1]));
    const handState = { ...pendingNomination.handState, [seat]: value };
    const entry = { ...pendingNomination, handState };
    await store.set({ pendingNomination: entry });
    await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations, pendingNomination: entry });
    return;
  }

  if (eventName === 'voteInProgress' && Array.isArray(eventData)) {
    let entry;
    if (eventData[0] === false) {
      // Counting ended — snapshot who has hand up as the final yes votes
      const yesSeats = Object.entries(pendingNomination.handState)
        .filter(([, v]) => v === 1)
        .map(([s]) => Number(s));
      entry = { ...pendingNomination, yesSeats, voting: false, counted: true };
    } else {
      entry = { ...pendingNomination, voting: true, counted: false };
    }
    await store.set({ pendingNomination: entry });
    await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations, pendingNomination: entry });
  }
}

// The app's own vote state, posted by the page bridge on every vote mutation.
// It does two jobs. It opens, advances and closes the nomination entry on its
// own, so the log doesn't depend on WS frames (they're missed whenever the hook
// didn't catch the socket; when frames do arrive, both paths agree and the
// second to land is a no-op). And its tally overrides the hands rebuilt from
// frames, which drop votes: our own vote as a player is never echoed back, and
// frames get lost to the dedup window or a reconnect.
const REOPEN_WINDOW_MS = 10000;

async function handleVoteClock(clock) {
  if (!clock) return;
  let { nominations, pendingNomination, latestState } = await store.get();
  const open = Array.isArray(clock.nomination) && clock.nomination.length >= 2 ? clock.nomination : null;
  const isOpen = (n) => !!n && !!open && n.nominatorSeat === open[0] && n.nomineeSeat === open[1];
  const before = pendingNomination;
  const countBefore = nominations.length;

  // Closed, or replaced by another nomination. An empty store before the
  // session is live (page load, reconnect) is not a close.
  if (pendingNomination && !isOpen(pendingNomination) && (open || clock.connected)) {
    nominations = [...nominations, { ...pendingNomination, closedTs: Date.now() }];
    pendingNomination = null;
  }

  if (open && !pendingNomination) {
    const last = nominations[nominations.length - 1];
    if (isOpen(last) && last.closedTs && Date.now() - last.closedTs < REOPEN_WINDOW_MS) {
      // Same nomination back within seconds: the store was resyncing (it's
      // briefly empty while a gamestate is applied), not a new nomination.
      const { closedTs, ...entry } = last;
      nominations = nominations.slice(0, -1);
      pendingNomination = entry;
    } else {
      const [nominatorSeat, nomineeSeat] = open;
      const seatNames = {};
      for (const p of latestState?.players ?? []) {
        if (p.name != null) seatNames[p.seat] = p.name;
      }
      pendingNomination = {
        ts: Date.now(), nominatorSeat, nomineeSeat, seatNames,
        highscore: votesNeeded(latestState?.players ?? [], nomineeSeat, clock.highscore),
        handState: {}, yesSeats: [],
      };
    }
  }

  // Only while the store actually shows this nomination — an empty store has
  // no hands, and would wipe the ones recorded.
  if (isOpen(pendingNomination)) {
    let entry = pendingNomination;
    const handsUp = (e) => Object.entries(e.handState ?? {})
      .filter(([, v]) => v === 1).map(([s]) => Number(s)).sort((a, b) => a - b);

    if (typeof clock.locked === 'number' && clock.locked !== entry.locked) entry = { ...entry, locked: clock.locked };

    // A secret vote hides other hands from players — the store knows less than the frames.
    if (!clock.isHidden && Array.isArray(clock.yesSeats)) {
      const yes = [...clock.yesSeats].sort((a, b) => a - b);
      const current = handsUp(entry);
      if (yes.length !== current.length || yes.some((s, i) => s !== current[i])) {
        entry = { ...entry, handState: Object.fromEntries(yes.map(s => [s, 1])) };
      }
    }

    // Count started / ended — what the voteInProgress frame says.
    if (clock.isInProgress && !entry.voting) entry = { ...entry, voting: true, counted: false };
    else if (!clock.isInProgress && entry.voting) entry = { ...entry, voting: false, counted: true, yesSeats: handsUp(entry) };

    // Once counted, the final yes votes follow the app's tally too.
    if (entry.counted && !clock.isInProgress && !clock.isHidden) {
      const yes = handsUp(entry);
      const final = entry.yesSeats ?? [];
      if (yes.length !== final.length || yes.some(s => !final.includes(s))) entry = { ...entry, yesSeats: yes };
    }
    pendingNomination = entry;
  }

  if (pendingNomination === before && nominations.length === countBefore) return;
  await store.set({ nominations, pendingNomination });
  await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations, pendingNomination });
}

// ── Text messages ─────────────────────────────────────────────────────────

async function handleTextMessage(senderId, recipientId, message, length, ts) {
  const { nameMap, textMessages, latestState } = await store.get();
  // Normalize the 'me' sentinel to the real user ID so a server echo of our
  // own message dedups against the locally-recorded send
  const myId = latestState?.myUserId ? String(latestState.myUserId) : null;
  if (senderId === 'me' && myId) senderId = myId;
  const key = `${senderId}|${recipientId}|${message ?? length}`;
  if (isDup(_msgDedupMap, key)) return;
  const senderName = nameMap[String(senderId)] ?? String(senderId);
  const recipientName = recipientId ? (nameMap[String(recipientId)] ?? String(recipientId)) : null;
  const entry = { ts, senderId: String(senderId), senderName, recipientId: recipientId || null, recipientName, message: message ?? null, length: length ?? null };
  const updated = [...textMessages, entry];
  await store.set({ textMessages: updated });
  await sendToCompanion({ type: 'TEXT_MESSAGES_UPDATE', textMessages: updated });
}

// ── Channel / chat tracking ───────────────────────────────────────────────
// channelPresence (persisted): channelId → { start, participants: {userId: joinTs}, allParticipants: [userId] }

async function saveSession(channelId, start, end, participants) {
  if (participants.length < 2) return;
  const type = channelId.startsWith('public') ? 'public'
             : channelId.startsWith('night')  ? 'night' : 'private';
  const { chatSessions } = await store.get();
  const session = { ts: start, end, channel: channelId, type, participants };
  const updated = [...chatSessions, session];
  await store.set({ chatSessions: updated });
  await sendToCompanion({ type: 'CHAT_SESSIONS_UPDATE', sessions: updated });
}

async function handleChannelChange(userId, newChannel, ts) {
  const { latestState, channelPresence } = await store.get();
  // Normalize 'me' to the real user ID so the server echoing our own
  // channelChange doesn't track us twice
  const myId = latestState?.myUserId ? String(latestState.myUserId) : null;
  if (userId === 'me' && myId) userId = myId;
  if (isDup(_chanDedupMap, `${userId}|${newChannel}`)) return;
  // Already there: the second source reporting the same move, or the app
  // re-listing who is where after a voice reconnect.
  if (newChannel && channelPresence[newChannel] && userId in channelPresence[newChannel].participants) return;

  // Leave old channel
  for (const [ch, info] of Object.entries(channelPresence)) {
    if (userId in info.participants) {
      const joinTs = info.participants[userId];
      delete info.participants[userId];

      if (ch.startsWith('night-')) {
        // Log each player's individual night visit (storyteller stays, so don't close channel)
        const others = Object.keys(info.participants);
        await saveSession(ch, joinTs, ts, [userId, ...others]);
      } else if (Object.keys(info.participants).length === 0) {
        await saveSession(ch, info.start, ts, info.allParticipants);
        delete channelPresence[ch];
      }
      break;
    }
  }

  // Join new channel
  if (newChannel) {
    if (!channelPresence[newChannel]) {
      channelPresence[newChannel] = { start: ts, participants: {}, allParticipants: [] };
    }
    channelPresence[newChannel].participants[userId] = ts;
    if (!channelPresence[newChannel].allParticipants.includes(userId)) {
      channelPresence[newChannel].allParticipants.push(userId);
    }
  }

  await store.set({ channelPresence });
}

// Events the page bridge read from botc.app's store rather than off the wire.
// They feed the same handlers as the WS frames; those dedup the two sources.
async function handleStoreEvent(payload) {
  const d = payload.data ?? {};
  if (payload.name === 'channelChange' && d.userId) {
    await handleChannelChange(String(d.userId), d.channel ?? '', Date.now());
  } else if (payload.name === 'textMessage' && d.message !== undefined) {
    await handleTextMessage(d.senderId ?? 'unknown', d.recipientId ?? '', d.message, null, Date.now());
  } else if (payload.name === 'textMessageIndicator' && d.recipientId) {
    await handleTextMessage(d.senderId ?? 'unknown', d.recipientId, null, d.length ?? null, Date.now());
  }
}

// ── Timeline ──────────────────────────────────────────────────────────────

function phaseLabel(phase) {
  const isNight = phase % 2 === 1;
  const round = Math.ceil(phase / 2);
  return isNight ? `Night ${round}` : `Day ${round}`;
}

function eventsFromHistory(history, nameMap, processedIds) {
  const events = [];
  for (const entry of history) {
    if (processedIds.has(entry.id)) continue;
    processedIds.add(entry.id);
    if (entry.type === 'start') {
      events.push({ ts: entry.time, type: 'start', label: 'Game started' });
    } else if (entry.type === 'phase') {
      events.push({ ts: entry.time, type: 'phase', label: phaseLabel(entry.data) });
    } else if (entry.type === 'death') {
      const pid = String(entry.data?.id ?? entry.data);
      // dom-death marker is shared with diffDeaths: whichever source records a
      // death first wins, the other is skipped
      const domKey = `dom-death-${pid}`;
      if (!processedIds.has(domKey)) {
        processedIds.add(domKey);
        events.push({ ts: entry.time, type: 'death', playerId: pid, name: nameMap[pid] ?? null });
      }
    } else if (entry.type === 'revive') {
      const pid = String(entry.data?.id ?? entry.data);
      processedIds.delete(`dom-death-${pid}`);
      events.push({ ts: entry.time, type: 'revive', playerId: pid, name: nameMap[pid] ?? null });
    } else if (entry.type === 'vote') {
      const pid = String(entry.data?.id ?? entry.data);
      events.push({ ts: entry.time, type: 'ghostvote', playerId: pid, name: nameMap[pid] ?? null });
    } else if (entry.type === 'end') {
      const isEvilWin = entry.data?.isEvilWin;
      events.push({ ts: entry.time, type: 'end', label: isEvilWin ? 'Evil wins' : 'Good wins', isEvilWin });
      if (entry.data?.players) {
        events.push({ ts: entry.time, type: 'roles_revealed', roles: entry.data.players });
      }
    }
  }
  return events;
}

function diffDeaths(prevPlayers, nextPlayers, processedIds, nameMap) {
  const events = [];
  if (!prevPlayers || !nextPlayers) return events;
  for (const np of nextPlayers) {
    if (!np.isDead) continue;
    const pp = prevPlayers.find(p => p.id === np.id);
    if (pp && !pp.isDead) {
      const key = `dom-death-${np.id}`;
      if (!processedIds.has(key)) {
        processedIds.add(key);
        events.push({ ts: Date.now(), type: 'death', playerId: np.id, name: np.name ?? nameMap[np.id] ?? null });
      }
    }
  }
  return events;
}

async function pushStateToCompanion() {
  const tabId = await resolveCompanionTabId();
  if (tabId === null) return;
  const { latestState, timeline, wsEvents, nominations, pendingNomination, chatSessions, nameMap, cellTokens, materializedStatus, playerMeta, textMessages } = await store.get();
  chrome.tabs.sendMessage(tabId, {
    type: 'FULL_REFRESH',
    state: latestState,
    timeline,
    wsEvents,
    nominations,
    pendingNomination,
    chatSessions,
    nameMap,
    cellTokens,
    materializedStatus,
    playerMeta,
    textMessages,
  }).catch(() => {});
}

// ── Message handlers ──────────────────────────────────────────────────────

async function handleStatePayload(payload) {
  const { latestState, timeline, processedIds, nameMap, currentGameId } = await store.get();

  // Update nameMap with any newly named players
  for (const p of payload.data.players ?? []) {
    if (p.id && p.name) nameMap[p.id] = p.name;
  }

  // Map 'me' sentinel to the local user's actual ID so channel sessions resolve correctly
  if (payload.data.myUserId) {
    for (const p of payload.data.players ?? []) {
      if (p.id === payload.data.myUserId && p.name) {
        nameMap['me'] = p.name;
        break;
      }
    }
  }

  // Spectator names scraped from the users panel (only present when panel is open)
  for (const s of payload.data.spectators ?? []) {
    if (s.id && s.name) nameMap[String(s.id)] = s.name;
  }

  // Match storyteller IDs (localStorage) to names (DOM) by position
  const storytellers = payload.data.storytellers ?? [];
  const storytellerNames = payload.data.storytellerNames ?? [];
  for (let i = 0; i < Math.min(storytellers.length, storytellerNames.length); i++) {
    if (storytellers[i].id) nameMap[String(storytellers[i].id)] = storytellerNames[i];
  }

  // Detect new game: start entry ID changed → reset timeline
  const history = payload.data.history ?? [];
  const startEntry = history.find(h => h.type === 'start');
  const isNewGame = startEntry && startEntry.id !== currentGameId;
  if (isNewGame) {
    timeline.length = 0;
    processedIds.clear();
    await store.set({ currentGameId: startEntry.id, nominations: [], pendingNomination: null, chatSessions: [], cellTokens: {}, materializedStatus: [], playerMeta: {}, textMessages: [], channelPresence: {} });
  }

  const historyEvents = eventsFromHistory(history, nameMap, processedIds);
  const domEvents = diffDeaths(latestState?.players, payload.data.players, processedIds, nameMap);
  const newEvents = [...historyEvents, ...domEvents];

  const merged = [...timeline, ...newEvents].sort((a, b) => a.ts - b.ts);
  const seen = new Set();
  const newTimeline = merged.filter(ev => {
    const key = `${ev.ts}|${ev.type}|${ev.playerId ?? ''}|${ev.label ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await store.set({
    latestState: payload.data,
    timeline: newTimeline,
    processedIds: [...processedIds],
    nameMap,
  });

  if (isNewGame) {
    // FULL_REFRESH makes an open companion drop its in-memory copies of the
    // old game — otherwise it keeps rendering them and writes them back into
    // the freshly cleared store on its next materialize/save pass.
    await pushStateToCompanion();
    return;
  }

  await sendToCompanion({ type: 'BOTC_UPDATE', payload, nameMap });
  if (newEvents.length > 0) await sendToCompanion({ type: 'TIMELINE_EVENTS', events: newEvents });
}

async function handleWsPayload(payload) {
  const frame = parseSocketIO(payload.data);
  if (frame && typeof frame[0] === 'string') {
    if (payload.type === 'WS_RECV') {
      // Covers both player and storyteller perspectives: ["vote",[seat,value]] / ["vote",[seat,value],userId]
      await handleNominationFrame(frame[0], frame[1], Date.now());
      if (frame[0] === 'channelChange' && frame[1] && typeof frame[1] === 'object') {
        await handleChannelChange(String(frame[1].userId), frame[1].channel ?? '', Date.now());
      }
      // ["textMessage", {message, recipientId}, senderUserId] — public messages (plaintext)
      if (frame[0] === 'textMessage' && frame[1]?.message !== undefined) {
        await handleTextMessage(frame[2] ?? 'unknown', frame[1].recipientId ?? '', frame[1].message, null, Date.now());
      }
      // ["textMessageIndicator", {recipientId, length}, senderUserId] — private messages (no plaintext)
      if (frame[0] === 'textMessageIndicator' && frame[1]?.recipientId) {
        await handleTextMessage(frame[2] ?? 'unknown', frame[1].recipientId, null, frame[1].length ?? null, Date.now());
      }
    } else if (payload.type === 'WS_SEND') {
      if (frame[0] === 'channelChange' && typeof frame[1] === 'string') {
        await handleChannelChange('me', frame[1], Date.now());
      }
      // Storyteller sends all events wrapped as ["message",eventName,eventData]
      if (frame[0] === 'message' && typeof frame[1] === 'string') {
        await handleNominationFrame(frame[1], frame[2], Date.now());
      }
      // User sending a text message: ["textMessage", {message, recipientId}]
      if (frame[0] === 'textMessage' && frame[1]?.message !== undefined) {
        await handleTextMessage('me', frame[1].recipientId ?? '', frame[1].message, null, Date.now());
      }
      // User sending a private message: ["textMessageIndicator", {recipientId, length}]
      if (frame[0] === 'textMessageIndicator' && frame[1]?.recipientId) {
        await handleTextMessage('me', frame[1].recipientId, null, frame[1].length ?? null, Date.now());
      }
    }
  }

  const { wsEvents } = await store.get();
  const updated = [...wsEvents, { ...payload, ts: Date.now() }];
  if (updated.length > 100) updated.shift();
  await store.set({ wsEvents: updated });
  await sendToCompanion({ type: 'BOTC_UPDATE', payload });
}

chrome.action.onClicked.addListener(async () => {
  if (companionTabId !== null) {
    try {
      await chrome.tabs.get(companionTabId);
      chrome.tabs.update(companionTabId, { active: true });
      await pushStateToCompanion();
      return;
    } catch {
      companionTabId = null;
    }
  }
  const companion = await chrome.tabs.create({ url: chrome.runtime.getURL('companion/index.html') });
  companionTabId = companion.id;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === companionTabId) companionTabId = null;
  if (tabId === activeBridgeTabId) activeBridgeTabId = null;
});

// Pick up botc.app tabs that were already open when the extension was
// (re)loaded — content scripts are only auto-injected into new page loads.
chrome.runtime.onInstalled.addListener(() => { connectToTabs(); });
chrome.runtime.onStartup.addListener(() => { connectToTabs(); });

// Storyteller commands relayed verbatim to the active botc.app tab's bridge.
const COMPANION_COMMANDS = new Set([
  'SEND_SIGNAL', 'SET_TIMER', 'PAUSE_TIMER', 'VOTE_DRIVE', 'SET_HIGHSCORE', 'END_GAME', 'GONG',
  'ADD_SEAT', 'SHUFFLE_SEATS', 'REMOVE_EMPTY_SEATS',
  'BECOME_STORYTELLER', 'STEP_DOWN_STORYTELLER', 'LOAD_CUSTOM_SCRIPT',
  'NEXT_PHASE', 'NOMINATE', 'REMOVE_SEAT', 'CLEAR_GRIMOIRE', 'SET_PLAYER_PROPERTY',
  'JOIN_CHANNEL',
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Restore companionTabId if service worker restarted
  if (sender.tab?.url?.includes(chrome.runtime.getURL('companion'))) {
    companionTabId = sender.tab.id;
  }
  if (message.type === 'BOTC_UPDATE') {
    const payload = message.payload;
    const senderTabId = sender.tab?.id ?? null;
    enqueue(async () => {
      if (!(await isActiveBridgeTab(senderTabId))) return;
      if (payload.type === 'STATE') return handleStatePayload(payload);
      if (payload.type === 'WS_RECV' || payload.type === 'WS_SEND') return handleWsPayload(payload);
      if (payload.type === 'STORE_EVENT') return handleStoreEvent(payload);
      if (payload.type === 'VOTE_CLOCK') await handleVoteClock(payload.data);
      await sendToCompanion({ type: 'BOTC_UPDATE', payload });
    });
    return;
  }

  if (message.type === 'SAVE_TOKENS') {
    enqueue(async () => {
      const { cellTokens } = await store.get();
      const key = `${message.player}|${message.phase}`;
      const updated = { ...cellTokens, [key]: message.tokens };
      await store.set({ cellTokens: updated });
    });
    return;
  }

  if (message.type === 'CLEAR_TOKENS') {
    enqueue(() => store.set({ cellTokens: {}, playerMeta: {} }));
    return;
  }

  if (message.type === 'SAVE_MATERIALIZED_STATUS') {
    enqueue(() => store.set({ materializedStatus: message.keys ?? [] }));
    return;
  }

  if (message.type === 'SAVE_PLAYER_META') {
    enqueue(async () => {
      const { playerMeta } = await store.get();
      const updated = { ...playerMeta, [message.name]: message.meta };
      await store.set({ playerMeta: updated });
    });
    return;
  }

  if (COMPANION_COMMANDS.has(message.type)) {
    (async () => {
      // Send to the single active bridge tab only — every /play tab executes
      // the command independently, so fanning out duplicates it (two signals,
      // two added seats, two shuffles).
      const tabs = await chrome.tabs.query({ url: 'https://botc.app/play*' });
      const target = tabs.find(t => t.id === activeBridgeTabId) ?? tabs[0];
      if (target) chrome.tabs.sendMessage(target.id, message).catch(() => {});
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Session preview's Join: take the botc.app tab that's already open to the
  // session instead of piling up tabs; open one only if there is none.
  if (message.type === 'JOIN_SESSION') {
    (async () => {
      const url = `https://botc.app/join/${encodeURIComponent(String(message.session ?? ''))}`;
      const tabs = await chrome.tabs.query({ url: 'https://botc.app/*' });
      const target = tabs.find(t => t.id === activeBridgeTabId) ?? tabs[0];
      if (target) {
        await chrome.tabs.update(target.id, { url, active: true });
        if (target.windowId != null) chrome.windows?.update(target.windowId, { focused: true }).catch(() => {});
      } else {
        await chrome.tabs.create({ url });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'CHECK_CONNECTION') {
    (async () => {
      let result;
      try { result = await checkConnection(); } catch { result = 'failed'; }
      sendResponse({ result });
    })();
    return true;
  }

  if (message.type === 'GET_STATE') {
    (async () => {
      const { latestState, timeline, wsEvents, nominations, pendingNomination, chatSessions, nameMap, cellTokens, materializedStatus, playerMeta, textMessages } = await store.get();
      sendResponse({ state: latestState, timeline, wsEvents, nominations, pendingNomination, chatSessions, nameMap, cellTokens, materializedStatus, playerMeta, textMessages });
      // Ask open botc.app tabs for a fresh push, injecting the bridge if missing
      const result = await connectToTabs();
      if (result === 'failed') await sendToCompanion({ type: 'NEEDS_RELOAD' });
    })();
    return true;
  }
});

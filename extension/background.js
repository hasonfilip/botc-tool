// Service worker: relays game state from content script to companion tab.
// Uses chrome.storage.session to survive MV3 service worker restarts.

let companionTabId = null;

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
// before the extension loaded), inject the scripts programmatically. Note a
// late-injected WebSocket hook can't capture an already-open socket, so live
// WS events still need a tab reload — but state scraping works immediately.
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

async function handleNominationFrame(eventName, eventData, ts) {
  if (isDup(_nomDedupMap, eventName + JSON.stringify(eventData))) return;

  const { nominations, pendingNomination, latestState } = await store.get();

  if (eventName === 'nomination') {
    if (Array.isArray(eventData.nomination)) {
      const [nominatorSeat, nomineeSeat] = eventData.nomination;
      const alive = (latestState?.players ?? []).filter(p => !p.isDead).length;
      const highscore = Math.max(eventData.highscore ?? 0, Math.ceil(alive / 2));
      const entry = { ts, nominatorSeat, nomineeSeat, highscore, handState: {}, yesSeats: [] };
      await store.set({ pendingNomination: entry });
    } else if (eventData.nomination === false && pendingNomination) {
      await store.set({ nominations: [...nominations, pendingNomination], pendingNomination: null });
      await sendToCompanion({ type: 'NOMINATIONS_UPDATE', nominations: [...nominations, pendingNomination] });
    }
    return;
  }

  if (!pendingNomination) return;

  if (eventName === 'vote' && Array.isArray(eventData)) {
    // vote [seat, 0|1] — track live hand state; seat indices here are real seat numbers
    const [seat, value] = eventData;
    // A real toggle (up→down→up) must not be eaten by the duplicate window
    _nomDedupMap.delete('vote' + JSON.stringify([seat, value ? 0 : 1]));
    const handState = { ...pendingNomination.handState, [seat]: value };
    await store.set({ pendingNomination: { ...pendingNomination, handState } });
    return;
  }

  if (eventName === 'voteInProgress' && eventData[0] === false) {
    // Counting ended — snapshot who has hand up as the final yes votes
    const yesSeats = Object.entries(pendingNomination.handState)
      .filter(([, v]) => v === 1)
      .map(([s]) => Number(s));
    await store.set({ pendingNomination: { ...pendingNomination, yesSeats } });
  }
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
  const { latestState, timeline, wsEvents, nominations, chatSessions, nameMap, cellTokens, materializedStatus, playerMeta, textMessages } = await store.get();
  chrome.tabs.sendMessage(tabId, {
    type: 'FULL_REFRESH',
    state: latestState,
    timeline,
    wsEvents,
    nominations,
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
  if (startEntry && startEntry.id !== currentGameId) {
    timeline.length = 0;
    processedIds.clear();
    await store.set({ currentGameId: startEntry.id, nominations: [], pendingNomination: null, chatSessions: [], cellTokens: {}, materializedStatus: [], textMessages: [], channelPresence: {} });
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
});

// Pick up botc.app tabs that were already open when the extension was
// (re)loaded — content scripts are only auto-injected into new page loads.
chrome.runtime.onInstalled.addListener(() => { connectToTabs(); });
chrome.runtime.onStartup.addListener(() => { connectToTabs(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Restore companionTabId if service worker restarted
  if (sender.tab?.url?.includes(chrome.runtime.getURL('companion'))) {
    companionTabId = sender.tab.id;
  }
  if (message.type === 'BOTC_UPDATE') {
    const payload = message.payload;
    if (payload.type === 'STATE') {
      enqueue(() => handleStatePayload(payload));
      return;
    }
    if (payload.type === 'WS_RECV' || payload.type === 'WS_SEND') {
      enqueue(() => handleWsPayload(payload));
      return;
    }
    sendToCompanion({ type: 'BOTC_UPDATE', payload });
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
    enqueue(() => store.set({ cellTokens: {} }));
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

  if (message.type === 'RECONNECT') {
    (async () => {
      sendResponse({ result: await connectToTabs() });
    })();
    return true;
  }

  if (message.type === 'GET_STATE') {
    (async () => {
      const { latestState, timeline, wsEvents, nominations, chatSessions, nameMap, cellTokens, materializedStatus, playerMeta, textMessages } = await store.get();
      sendResponse({ state: latestState, timeline, wsEvents, nominations, chatSessions, nameMap, cellTokens, materializedStatus, playerMeta, textMessages });
      // Ask open botc.app tabs for a fresh push, injecting the bridge if missing
      const result = await connectToTabs();
      if (result === 'injected') await sendToCompanion({ type: 'PARTIAL_CONNECT' });
      else if (result === 'failed') await sendToCompanion({ type: 'NEEDS_RELOAD' });
    })();
    return true;
  }
});

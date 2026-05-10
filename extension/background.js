// Service worker: relays game state from content script to companion tab.
// Uses chrome.storage.session to survive MV3 service worker restarts.

let companionTabId = null;

const store = {
  async get() {
    const data = await chrome.storage.session.get(['latestState', 'timeline', 'wsEvents', 'processedIds', 'nameMap', 'currentGameId', 'nominations', 'pendingNomination', 'chatSessions', 'cellTokens']);
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
    };
  },
  async set(patch) {
    await chrome.storage.session.set(patch);
  },
};

// ── Nomination processing ─────────────────────────────────────────────────

function parseSocketIO(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^\d+(?:\/[^,]+,)?(\[.*)/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// In-memory dedup: server sends each WS message 4x
let _lastNomKey = '';
let _lastNomTs = 0;
function isDupNomEvent(key) {
  const now = Date.now();
  if (key === _lastNomKey && now - _lastNomTs < 1500) return true;
  _lastNomKey = key;
  _lastNomTs = now;
  return false;
}

async function handleNominationFrame(eventName, eventData, ts) {
  if (isDupNomEvent(eventName + JSON.stringify(eventData))) return;

  const { nominations, pendingNomination } = await store.get();

  if (eventName === 'nomination') {
    if (Array.isArray(eventData.nomination)) {
      const [nominatorSeat, nomineeSeat] = eventData.nomination;
      const { latestState } = await store.get();
      const alive = (latestState?.players ?? []).filter(p => !p.isDead).length;
      const highscore = Math.max(eventData.highscore, Math.ceil(alive / 2));
      const entry = { ts, nominatorSeat, nomineeSeat, highscore, handState: {}, yesSeats: [] };
      await store.set({ pendingNomination: entry });
    } else if (eventData.nomination === false && pendingNomination) {
      await store.set({ nominations: [...nominations, pendingNomination], pendingNomination: null });
      if (companionTabId !== null) {
        chrome.tabs.sendMessage(companionTabId, { type: 'NOMINATIONS_UPDATE', nominations: [...nominations, pendingNomination] }).catch(() => {});
      }
    }
    return;
  }

  if (!pendingNomination) return;

  if (eventName === 'vote' && Array.isArray(eventData)) {
    // vote [seat, 0|1] — track live hand state; seat indices here are real seat numbers
    const [seat, value] = eventData;
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

// ── Channel / chat tracking ───────────────────────────────────────────────

// channelId → { start, participants: Map<userId,joinTs>, allParticipants: Set<userId> }
const channelPresence = {};

// Per-user dedup: server sends channelChange 4× per event
const _chanDedupMap = new Map();
function isDupChannelEvent(userId, channel) {
  const key = `${userId}|${channel}`;
  const now = Date.now();
  if (now - (_chanDedupMap.get(key) ?? 0) < 1500) return true;
  _chanDedupMap.set(key, now);
  return false;
}

async function saveSession(channelId, start, end, participants) {
  if (participants.length < 2) return;
  const type = channelId.startsWith('public') ? 'public'
             : channelId.startsWith('night')  ? 'night' : 'private';
  const { chatSessions } = await store.get();
  const session = { ts: start, end, channel: channelId, type, participants };
  const updated = [...chatSessions, session];
  await store.set({ chatSessions: updated });
  if (companionTabId !== null) {
    chrome.tabs.sendMessage(companionTabId, { type: 'CHAT_SESSIONS_UPDATE', sessions: updated }).catch(() => {});
  }
}

async function handleChannelChange(userId, newChannel, ts) {
  if (isDupChannelEvent(userId, newChannel)) return;

  // Leave old channel
  for (const [ch, info] of Object.entries(channelPresence)) {
    if (info.participants.has(userId)) {
      const joinTs = info.participants.get(userId);
      info.participants.delete(userId);

      if (ch.startsWith('night-')) {
        // Log each player's individual night visit (storyteller stays, so don't close channel)
        const others = [...info.participants.keys()];
        await saveSession(ch, joinTs, ts, [userId, ...others]);
      } else if (info.participants.size === 0) {
        await saveSession(ch, info.start, ts, [...info.allParticipants]);
        delete channelPresence[ch];
      }
      break;
    }
  }

  // Join new channel
  if (newChannel) {
    if (!channelPresence[newChannel]) {
      channelPresence[newChannel] = { start: ts, participants: new Map(), allParticipants: new Set() };
    }
    channelPresence[newChannel].participants.set(userId, ts);
    channelPresence[newChannel].allParticipants.add(userId);
  }
}

function phaseLabel(phase, historyUpTo) {
  const isNight = phase % 2 === 1;
  const round = Math.ceil(phase / 2);
  return isNight ? `Night ${round}` : `Day ${round}`;
}

function eventsFromHistory(history, nameMap, processedIds) {
  const events = [];
  history.forEach((entry, i) => {
    if (processedIds.has(entry.id)) return;
    processedIds.add(entry.id);
    const historyUpTo = history.slice(0, i + 1);
    if (entry.type === 'start') {
      events.push({ ts: entry.time, type: 'start', label: 'Game started' });
    } else if (entry.type === 'phase') {
      events.push({ ts: entry.time, type: 'phase', label: phaseLabel(entry.data, historyUpTo) });
    } else if (entry.type === 'death') {
      const pid = String(entry.data?.id ?? entry.data);
      events.push({ ts: entry.time, type: 'death', playerId: pid, name: nameMap[pid] ?? null });
    } else if (entry.type === 'revive') {
      const pid = String(entry.data?.id ?? entry.data);
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
  });
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
  if (companionTabId === null) return;
  const { latestState, timeline, wsEvents, nominations, chatSessions, nameMap, cellTokens } = await store.get();
  chrome.tabs.sendMessage(companionTabId, {
    type: 'FULL_REFRESH',
    state: latestState,
    timeline,
    wsEvents,
    nominations,
    chatSessions,
    nameMap,
    cellTokens,
  }).catch(() => {});
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BOTC_UPDATE') {
    const payload = message.payload;

    if (payload.type === 'STATE') {
      (async () => {
        const { latestState, timeline, wsEvents, processedIds, nameMap, currentGameId } = await store.get();

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
          await store.set({ currentGameId: startEntry.id, nominations: [], pendingNomination: null, chatSessions: [], cellTokens: {} });
        }

        // History-based deaths mark their player IDs so DOM diff won't duplicate them
        const historyEvents = eventsFromHistory(history, nameMap, processedIds);
        for (const ev of historyEvents) {
          if (ev.type === 'death') {
            processedIds.add(`dom-death-${ev.playerId}`);
          }
        }
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

        if (companionTabId !== null) {
          chrome.tabs.sendMessage(companionTabId, { type: 'BOTC_UPDATE', payload }).catch(() => {});
          if (newEvents.length > 0) {
            chrome.tabs.sendMessage(companionTabId, { type: 'TIMELINE_EVENTS', events: newEvents }).catch(() => {});
          }
        }
      })();
      return;
    }

    if (payload.type === 'WS_RECV' || payload.type === 'WS_SEND') {
      (async () => {
        // Parse frames from WS_RECV and WS_SEND
        const frame = parseSocketIO(payload.data);
        if (frame && typeof frame[0] === 'string') {
          if (payload.type === 'WS_RECV') {
            await handleNominationFrame(frame[0], frame[1], Date.now());
            if (frame[0] === 'channelChange' && frame[1] && typeof frame[1] === 'object') {
              await handleChannelChange(String(frame[1].userId), frame[1].channel ?? '', Date.now());
            }
          } else if (payload.type === 'WS_SEND') {
            if (frame[0] === 'channelChange' && typeof frame[1] === 'string') {
              await handleChannelChange('me', frame[1], Date.now());
            }
            // User's own vote is sent as ["message","vote",[seat,value]]
            if (frame[0] === 'message' && frame[1] === 'vote' && Array.isArray(frame[2])) {
              await handleNominationFrame('vote', frame[2], Date.now());
            }
          }
        }

        const { wsEvents } = await store.get();
        const updated = [...wsEvents, { ...payload, ts: Date.now() }];
        if (updated.length > 100) updated.shift();
        await store.set({ wsEvents: updated });
        if (companionTabId !== null) {
          chrome.tabs.sendMessage(companionTabId, { type: 'BOTC_UPDATE', payload }).catch(() => {});
        }
      })();
      return;
    }

    if (companionTabId !== null) {
      chrome.tabs.sendMessage(companionTabId, { type: 'BOTC_UPDATE', payload }).catch(() => {});
    }
    return;
  }

  if (message.type === 'SAVE_TOKENS') {
    (async () => {
      const { cellTokens } = await store.get();
      const key = `${message.player}|${message.phase}`;
      const updated = { ...cellTokens, [key]: message.tokens };
      await store.set({ cellTokens: updated });
    })();
    return;
  }

  if (message.type === 'GET_STATE') {
    (async () => {
      const { latestState, timeline, wsEvents, nominations, chatSessions, nameMap, cellTokens } = await store.get();
      sendResponse({ state: latestState, timeline, wsEvents, nominations, chatSessions, nameMap, cellTokens });
      // Re-inject relay into any open botc.app tabs (handles extension reload case)
      const tabs = await chrome.tabs.query({ url: 'https://botc.app/play*' });
      for (const tab of tabs) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Avoid duplicate listeners
              if (window.__botcRelayActive) {
                window.postMessage({ source: 'botc-bridge-cmd', type: 'FORCE_UPDATE' }, '*');
                return;
              }
              window.__botcRelayActive = true;
              window.addEventListener('message', (event) => {
                if (event.source !== window || event.data?.source !== 'botc-bridge') return;
                try { chrome.runtime.sendMessage({ type: 'BOTC_UPDATE', payload: event.data.payload }); } catch {}
              });
              window.postMessage({ source: 'botc-bridge-cmd', type: 'FORCE_UPDATE' }, '*');
            },
          });
        } catch {}
      }
    })();
    return true;
  }
});

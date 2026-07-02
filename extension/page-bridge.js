// Registered in the manifest as a MAIN-world content script at document_start,
// so it runs in the page context before any page script — guaranteeing the
// WebSocket hook is in place before botc.app opens its connection.
// Watches localStorage, scrapes DOM, and posts structured state to
// injector.js via window.postMessage.

(function () {
  'use strict';

  if (window.__botcBridgeActive) return;
  window.__botcBridgeActive = true;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const post = (payload) => window.postMessage({ source: 'botc-bridge', payload }, '*');

  const getMyUserId = () => {
    try { return JSON.parse(atob(localStorage.getItem('token').split('.')[1])).id ?? null; }
    catch { return null; }
  };

  // Only the keys buildState uses — this runs on every (debounced) DOM
  // mutation, so parsing the whole store would be wasted work
  const STORAGE_KEYS = ['game', 'players', 'roles', 'storytellers', 'edition', 'bluffs', 'reminders', 'timer', 'session', 'token'];

  const readStorage = () => {
    const raw = {};
    for (const key of STORAGE_KEYS) {
      const val = localStorage.getItem(key);
      if (val === null) continue;
      try { raw[key] = JSON.parse(val); }
      catch { raw[key] = val; }
    }
    return raw;
  };

  // Returns [{name, pronouns}] for players in seat order (grimoire, #center only)
  const scrapeNameplates = () => {
    return [...document.querySelectorAll('#center .nameplate')]
      .map(el => ({
        name: el.querySelector('.name')?.innerText?.trim() ?? null,
        pronouns: el.querySelector('.pronouns')?.innerText?.trim() ?? null,
      }))
      .filter(el => el.name);
  };

  const scrapeStorytellersFromDOM = () => {
    return [...document.querySelectorAll('#left .nameplate .name')]
      .map(el => el.innerText.trim())
      .filter(Boolean);
  };

  // Returns [{id, name}] for spectators/observers visible in the users panel
  const scrapeSpectators = () => {
    return [...document.querySelectorAll('li.spectator')]
      .map(el => {
        const idCls = [...el.classList].find(c => c.startsWith('id-'));
        const id = idCls ? idCls.replace('id-', '') : null;
        const name = el.querySelector('.name')?.textContent?.trim() ?? null;
        return id && name ? { id, name } : null;
      })
      .filter(Boolean);
  };

  // Returns [{id, name, team}] from the script sheet in the DOM
  const scrapeScriptRoles = () => {
    return [...document.querySelectorAll('li[class*="team-"][class*="role-"]')]
      .map(el => {
        const cls = [...el.classList];
        const roleId = (cls.find(c => c.startsWith('role-')) ?? '').replace('role-', '');
        const team = (cls.find(c => c.startsWith('team-')) ?? '').replace('team-', '');
        const name = el.querySelector('.name')?.title?.trim() ?? null;
        const iconStyle = el.querySelector('.icon')?.style?.backgroundImage ?? '';
        const iconUrl = iconStyle.match(/url\("?([^"')]+)"?\)/)?.[1] ?? null;
        return roleId && name ? { id: roleId, name, team, iconUrl } : null;
      })
      .filter(Boolean);
  };

  // Returns [{alignment, roleId, team, isDead}] in seat order from .player elements
  const scrapePlayerTokens = () => {
    return [...document.querySelectorAll('#center .player:not(.player-avatar)')]
      .map(el => {
        const classes = el.className.split(' ');
        const alignment = classes.includes('alignment-g') ? 'good'
                        : classes.includes('alignment-e') ? 'evil' : '';
        const isDead = classes.includes('dead');

        const token = el.querySelector('.token');
        const tokenClasses = token ? token.className.split(' ') : [];
        const roleId = (tokenClasses.find(c => c.startsWith('role-')) ?? '').replace('role-', '');
        const team = (tokenClasses.find(c => c.startsWith('team-')) ?? '').replace('team-', '');

        return { alignment, roleId, team, isDead };
      });
  };

  const buildState = () => {
    const storage = readStorage();
    const nameplates = scrapeNameplates();
    const tokens = scrapePlayerTokens();

    // Nameplates are authoritative — extra .player elements appear when the token picker is open
    const playerCount = Math.min(tokens.length, nameplates.length);

    // First playerCount nameplates are players (in seat order); rest are storytellers
    const playerNames = nameplates.slice(0, playerCount);
    const storytellerNames = scrapeStorytellersFromDOM();

    // Build a lookup map from role id → role name
    const roleMap = {};
    for (const role of (storage.roles ?? [])) {
      if (role.id) roleMap[role.id] = role.name ?? role.id;
    }

    // Fallback ID list from game.history start entry (always present, has all player IDs)
    const historyIds = (storage.game?.history ?? [])
      .find(h => h.type === 'start')?.data?.players?.map(p => p.id) ?? [];

    const myUserId = getMyUserId();

    // Script roles: prefer the DOM script sheet (has icon URLs), but it only
    // exists while the script panel is rendered — fall back to localStorage
    // so role pickers keep working when the panel is closed. The companion
    // resolves missing icons from its bundled data by role id.
    const scrapedRoles = scrapeScriptRoles();
    const storageRoles = (storage.roles ?? [])
      .map(r => typeof r === 'string'
        ? { id: r, name: null, team: '', iconUrl: null }
        : (r?.id ? { id: r.id, name: r.name ?? null, team: r.team ?? '', iconUrl: r.image ?? null } : null))
      .filter(Boolean);

    return {
      myUserId,
      phase: storage.game?.phase ?? null,
      isRunning: storage.game?.isRunning ?? false,
      history: storage.game?.history ?? [],
      players: tokens.slice(0, playerCount).map((token, i) => {
        // Pair by array/DOM index, not by the stored .seat field — that field goes stale
        // after movePlayers/removePlayers reorders the array (the array position IS the
        // current seat; .seat is a leftover value that doesn't get updated on reorder).
        const stored = (storage.players ?? [])[i] ?? { seat: i };
        const id = stored.id ?? historyIds[i] ?? null;
        const roleId = token.roleId || stored.role?.id || '';
        return {
          ...stored,
          id,
          seat: i,
          name: playerNames[i]?.name ?? null,
          pronouns: playerNames[i]?.pronouns ?? null,
          roleId,
          roleName: roleMap[roleId] ?? null,
          team: token.team || '',
          isDead: token.isDead || false,
        };
      }),
      storytellers: storage.storytellers ?? [],
      storytellerNames,
      spectators: scrapeSpectators(),
      roles: scrapedRoles.length ? scrapedRoles : storageRoles,
      edition: storage.edition ?? null,
      bluffs: storage.bluffs ?? [],
      reminders: storage.reminders ?? [],
      timer: storage.timer ?? null,
      session: storage.session ?? null,
    };
  };

  // ── Initial state — wait for grimoire to render ───────────────────────────

  const sendState = () => post({ type: 'STATE', data: buildState() });

  const waitForGrimoire = () => {
    const poll = () => {
      if (document.querySelectorAll('#center .nameplate').length > 0) {
        sendState();
      } else {
        setTimeout(poll, 500);
      }
    };
    poll();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForGrimoire);
  } else {
    waitForGrimoire();
  }

  // ── Watch localStorage ────────────────────────────────────────────────────

  let debounceTimer = null;
  const debouncedSend = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendState, 150);
  };

  const _setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    _setItem(key, value);
    debouncedSend();
  };

  // ── Watch DOM for name changes (MutationObserver) ─────────────────────────

  const observer = new MutationObserver(() => debouncedSend());
  const startObserver = () => {
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  // ── Handle commands from injector ────────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'botc-bridge-cmd') return;
    if (event.data?.type === 'FORCE_UPDATE') { sendState(); return; }
    if (event.data?.type === 'SEND_SIGNAL') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        if (store) store.commit('session/addSignal', { userIds: event.data.userIds, message: event.data.message, isInbound: false });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'SET_TIMER') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        // Store expects an absolute expiration timestamp, not a relative duration —
        // 0 is the sentinel for "no timer running" (produces a negative duration on the wire).
        const expiration = event.data.duration > 0 ? Date.now() + event.data.duration : 0;
        if (store) store.commit('session/setTimer', {
          expiration,
          title: event.data.title,
          isPausedDuringVotes: event.data.isPausedDuringVotes,
          paused: event.data.paused,
        });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'END_GAME') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        if (store) store.commit('game/endGame', event.data.isEvilWin);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'GONG') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        if (store) store.dispatch('session/triggerHook', { name: 'attention-gong', delay: 1000 });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'ADD_SEAT') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        if (store) store.dispatch('players/addPlayer');
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'SHUFFLE_SEATS') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        if (store) store.dispatch('players/movePlayers', event.data.order);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'REMOVE_EMPTY_SEATS') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        // Computed fresh from the real store state (id === null marks a vacant seat) rather
        // than our scraped/derived state, which can drift and misidentify a filled seat as empty.
        const indices = (store?.state?.players?.players ?? [])
          .map((p, i) => (p.id === null ? i : null))
          .filter(i => i !== null);
        if (store && indices.length) store.dispatch('players/removePlayers', indices);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'BECOME_STORYTELLER') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        const myUserId = getMyUserId();
        if (store && myUserId) store.commit('players/addStoryteller', { id: myUserId });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'STEP_DOWN_STORYTELLER') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        const myUserId = getMyUserId();
        if (store && myUserId) store.commit('players/removeStoryteller', { id: myUserId });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'LOAD_CUSTOM_SCRIPT') {
      try {
        const store = document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;
        if (!store) return;
        store.dispatch('players/clearRoles', { clearNPCs: true });
        store.commit('setCustomRoles', event.data.roles);
        store.commit('setEdition', { edition: { author: event.data.author, name: event.data.name, isOfficial: false, id: 'custom' }, theme: 0 });
      } catch { /* page not ready or store unavailable */ }
    }
  });

  // ── Hook WebSocket ────────────────────────────────────────────────────────

  const _WS = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new _WS(url, protocols) : new _WS(url);

    post({ type: 'WS_OPEN', url });

    const _send = ws.send.bind(ws);
    ws.send = function (data) {
      let parsed;
      try { parsed = JSON.parse(data); } catch { parsed = data; }
      post({ type: 'WS_SEND', url, data: parsed });
      return _send(data);
    };

    ws.addEventListener('message', (event) => {
      let parsed;
      try { parsed = JSON.parse(event.data); } catch { parsed = event.data; }
      post({ type: 'WS_RECV', url, data: parsed });
      debouncedSend();
    });

    ws.addEventListener('close', () => post({ type: 'WS_CLOSE', url }));

    return ws;
  };

  Object.assign(window.WebSocket, _WS);
  window.WebSocket.prototype = _WS.prototype;

})();

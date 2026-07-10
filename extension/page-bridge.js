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

  const getStore = () => document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;

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

  // Returns [{name, pronouns}] for players in seat order (grimoire, #center only).
  // Nameless plates are kept as placeholders — buildState pairs names to seat
  // tokens by index, so dropping one would shift every later player's name up
  // a seat. An empty name is normalized to null and resolved downstream.
  const scrapeNameplates = () => {
    return [...document.querySelectorAll('#center .nameplate')]
      .map(el => ({
        name: el.querySelector('.name')?.innerText?.trim() || null,
        pronouns: el.querySelector('.pronouns')?.innerText?.trim() || null,
      }));
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
    // localStorage's 'players' entry never reflects alignment edits (it's null there
    // even right after a confirmed store commit) — read it from the live store instead.
    const storePlayers = getStore()?.state?.players?.players ?? [];

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
        // Read straight from the live store, not the DOM-scraped token class or
        // localStorage: the grimoire always draws minion/demon tokens evil-red
        // regardless of their actual alignment field (so the DOM class is not a
        // reliable "unset" signal for them), and localStorage's mirror of this
        // field never updates at all. An unset field is genuinely unset — it must
        // not fall back to the DOM's team-implied color, or a cleared alignment on
        // an evil-team seat would immediately re-read back as "evil" from the DOM.
        const rawAlignment = storePlayers[i]?.alignment;
        const alignment = rawAlignment === 'g' ? 'good' : rawAlignment === 'e' ? 'evil' : '';
        return {
          ...stored,
          id,
          seat: i,
          name: playerNames[i]?.name ?? null,
          pronouns: playerNames[i]?.pronouns ?? null,
          roleId,
          roleName: roleMap[roleId] ?? null,
          team: token.team || '',
          alignment,
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
      // Signal history lives only in the live Vuex store (session.signals), never
      // persisted to localStorage — keyed by recipient id, "storyteller" mirrors
      // outbound-only signals while each specific user id holds the full two-way
      // conversation with them (both sent and received).
      // JSON round-trip strips the Vue reactive Proxy wrapper — postMessage's
      // structured clone can't serialize that directly (DataCloneError).
      signals: JSON.parse(JSON.stringify(getStore()?.state?.session?.signals ?? {})),
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

  // ── Watch the store for signal history ──────────────────────────────────
  // session.signals lives only in memory (never written to localStorage), so
  // the localStorage/DOM watchers above never see it change — subscribe to the
  // specific mutations directly so new sent/received signals show up promptly.
  const waitForStoreSubscribe = () => {
    const store = getStore();
    if (!store) { setTimeout(waitForStoreSubscribe, 500); return; }
    store.subscribe((mutation) => {
      if (mutation.type === 'session/addSignal' || mutation.type === 'session/clearSignals') debouncedSend();
    });
  };
  waitForStoreSubscribe();

  const _setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    _setItem(key, value);
    debouncedSend();
  };

  // ── Watch DOM for name changes (MutationObserver) ─────────────────────────

  const observer = new MutationObserver(() => debouncedSend());
  const startObserver = () => {
    // Class changes matter too: alignment rings, death shrouds, and role tokens
    // are toggled via classes without adding/removing nodes, and not all of
    // them are mirrored to localStorage where the setItem hook would catch them.
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
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
        const store = getStore();
        if (store) store.commit('session/addSignal', { userIds: event.data.userIds, message: event.data.message, isInbound: false });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'SET_TIMER') {
      try {
        const store = getStore();
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
        const store = getStore();
        if (store) store.commit('game/endGame', event.data.isEvilWin);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'GONG') {
      try {
        const store = getStore();
        if (store) store.dispatch('session/triggerHook', { name: 'attention-gong', delay: 1000 });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'NEXT_PHASE') {
      try {
        // The real action already guards against accidental double-clicks (a
        // quick second click reverts instead of advancing) — dispatch it as-is
        // rather than re-implementing that logic ourselves.
        const store = getStore();
        if (store) store.dispatch('game/togglePhase');
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'ADD_SEAT') {
      try {
        const store = getStore();
        if (store) store.dispatch('players/addPlayer');
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'SHUFFLE_SEATS') {
      try {
        const store = getStore();
        if (store) store.dispatch('players/movePlayers', event.data.order);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'NOMINATE') {
      try {
        const store = getStore();
        if (store) store.dispatch('vote/nominatePlayer', [event.data.nominatorSeat, event.data.nomineeSeat]);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'SET_PLAYER_PROPERTY') {
      try {
        const store = getStore();
        const player = store?.state?.players?.players?.[event.data.seat];
        if (!store || !player) return;
        // Role edits arrive as a roleId — resolve to the full role object. The
        // current script's role list (localStorage 'roles') is the source that
        // actually covers homebrew/custom roles (rolesAvailable is just the
        // official catalog, ~156 entries, and never has custom script roles);
        // fall back to rolesAvailable for anything not found there. An
        // unresolved/cleared id commits an empty object, mirroring clearRoles' output.
        const value = event.data.property === 'role'
          ? ((JSON.parse(localStorage.getItem('roles') || '[]').find(r => r?.id === event.data.roleId))
              ?? store.state.rolesAvailable?.get(event.data.roleId)
              ?? {})
          : event.data.value;
        store.commit('players/updatePlayer', { player, property: event.data.property, value });
        // Alignment edits on minion/demon seats don't touch the DOM or localStorage
        // (the grimoire never recolors them), so none of the passive watchers below
        // would otherwise notice this changed — force a refresh explicitly.
        debouncedSend();
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'CLEAR_GRIMOIRE') {
      try {
        const store = getStore();
        // Dispatched with no payload — mirrors what the real "Clear Grimoire" menu
        // item does; the app's own action cascades roles/history/signals internally.
        if (store) store.dispatch('players/clearRoles');
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'REMOVE_SEAT') {
      try {
        const store = getStore();
        // Same action REMOVE_EMPTY_SEATS uses below, just targeting one arbitrary seat.
        if (store) store.dispatch('players/removePlayers', [event.data.seat]);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'REMOVE_EMPTY_SEATS') {
      try {
        const store = getStore();
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
        const store = getStore();
        const myUserId = getMyUserId();
        if (store && myUserId) store.commit('players/addStoryteller', { id: myUserId });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'STEP_DOWN_STORYTELLER') {
      try {
        const store = getStore();
        const myUserId = getMyUserId();
        if (store && myUserId) store.commit('players/removeStoryteller', { id: myUserId });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'LOAD_CUSTOM_SCRIPT') {
      try {
        const store = getStore();
        if (!store) return;
        // Order matches the real upload flow: roles committed first, then
        // clearRoles — reversed, clearRoles would wipe the just-set roles.
        store.commit('setCustomRoles', event.data.roles);
        store.dispatch('players/clearRoles', { clearNPCs: true });
        const edition = { author: event.data.author, name: event.data.name, isOfficial: false, id: 'custom' };
        if (event.data.background) edition.background = event.data.background;
        if (event.data.logo) edition.logo = event.data.logo;
        if (event.data.almanac) edition.almanac = event.data.almanac;
        if (event.data.bootlegger) edition.bootlegger = event.data.bootlegger;
        store.commit('setEdition', { edition, theme: event.data.background ? 1 : 0 });
        // Fabled/homebrew "loric" reference roles (Bootlegger, Sentinel, Djinn, etc.)
        // are listed in the script's role array as bare ids with no data — the real
        // upload flow resolves them against store.state.npcs (a bundled catalog
        // distinct from rolesAvailable) and additionally commits them as NPCs, which
        // is what actually populates the grimoire's reference-card panel.
        const npcs = (event.data.roles ?? [])
          .map(r => store.state.npcs?.get(r.id))
          .filter(Boolean);
        if (npcs.length) store.commit('players/setNPC', { npc: npcs });
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

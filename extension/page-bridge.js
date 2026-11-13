// Registered in the manifest as a MAIN-world content script at document_start,
// so it runs in the page context before any page script — guaranteeing the
// WebSocket hook is in place before botc.app opens its connection.
// It has to load on every botc.app page, not just /play: the site is one
// single-page app, so going from the lobby (/) or a /join link into a game is a
// client-side route change that never loads /play as a page. And socket.io
// keeps the WebSocket constructor it found when its module loaded, so a hook
// installed any later than that never sees a socket — not even a new one.
// Watches localStorage, scrapes DOM, and posts structured state to
// injector.js via window.postMessage.

(function () {
  'use strict';

  if (window.__botcBridgeActive) return;
  window.__botcBridgeActive = true;

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Only the grimoire page is a game; in the lobby the bridge just waits.
  const onPlayPage = () => location.pathname.startsWith('/play');

  const post = (payload) => {
    if (!onPlayPage()) return;
    window.postMessage({ source: 'botc-bridge', payload }, '*');
  };

  const getMyUserId = () => {
    try { return JSON.parse(atob(localStorage.getItem('token').split('.')[1])).id ?? null; }
    catch { return null; }
  };

  const getStore = () => document.querySelector('#main')?.__vue_app__?.config?.globalProperties?.$store;

  // Matches the shape seen in a real "grimoire" signal token's wire payload:
  // { players: [{role, reminders:[{id,name,role,flags}]}], storytellers: [...], bluffs: [...] }
  // Role fields are plain id strings on the wire even though the live store
  // sometimes holds a full role object — normalize both cases the same way.
  // Built fresh from the live store (not the companion's own thinner scraped
  // state) so reminder ids/flags come through accurately, and copied into
  // plain objects/arrays since store values are reactive Proxies that can't
  // be sent through postMessage/chrome.runtime messaging as-is.
  const roleIdOf = (r) => (typeof r === 'string' ? r : r?.id) ?? null;
  const mapReminders = (reminders) => (Array.isArray(reminders) ? reminders : []).map(rem => ({
    id: rem?.id ?? null,
    name: rem?.name ?? null,
    role: roleIdOf(rem?.role),
    flags: Array.isArray(rem?.flags) ? [...rem.flags] : [],
  }));
  const buildGrimoireSnapshot = (store) => {
    const mapToken = (p) => ({ role: roleIdOf(p?.role), reminders: mapReminders(p?.reminders) });
    return {
      players: (store.state.players?.players ?? []).map(mapToken),
      storytellers: (store.state.players?.storytellers ?? []).map(mapToken),
      bluffs: (store.state.bluffs ?? []).map(roleIdOf).filter(Boolean),
    };
  };

  // Only the keys buildState uses — this runs on every (debounced) DOM
  // mutation, so parsing the whole store would be wasted work
  const STORAGE_KEYS = ['game', 'players', 'roles', 'storytellers', 'edition', 'bluffs', 'reminders', 'timer', 'session', 'token'];

  // Where botc.app's vote clock is, straight from the store. `locked` is the
  // hand: -1 during the start countdown, 0 before the first tick (and after a
  // reset), then L puts the hand on seat (nominee + L - 1) % players; past the
  // player count the count is done. The storyteller's client ticks it every
  // `speed` ms and broadcasts each tick, so every client's store follows it.
  // `paused` is only knowable on the storyteller's own client.
  // The role that allows a secret vote, if one's in play — botc.app only offers
  // the toggle then (any seat, storyteller token or fabled/loric with a
  // 'hidden' vote special).
  const secretVoteRoleName = () => {
    const ps = getStore()?.state?.players;
    if (!ps) return null;
    const holders = [...(ps.players ?? []), ...(ps.storytellers ?? []), ...(ps.npcs ?? []).map(role => ({ role }))];
    const hit = holders.find(h => h?.role?.special?.some?.(x => x.type === 'vote' && x.name === 'hidden'));
    return hit?.role?.name ?? null;
  };

  const voteClockOf = () => {
    const v = getStore()?.state?.vote;
    if (!v) return null;
    // The driver loses the clock whenever something else owns the timer: the
    // app's own Pause→resume, Stop, a closed nomination.
    if (drive.active && v.voteTimer !== drive.timerId && v.voteTimer !== 'paused') drive.active = false;
    return {
      nomination: Array.isArray(v.nomination) ? [...v.nomination] : false,
      // A closed nomination only means something while the session is live —
      // before the gamestate lands (page load, reconnect) the store is just empty.
      connected: !!getStore()?.state?.session?.isConnected,
      locked: v.locked,
      speed: v.speed,
      isInProgress: !!v.isInProgress,
      paused: v.voteTimer === 'paused',
      // Most votes any nomination got today (0 after each phase change). What
      // players see as needed is max(majority, highscore + 1) — tie at it.
      highscore: v.highscore ?? 0,
      // For the Mark button: botc.app hides it for a traveller, blocks it during
      // a count or a secret vote, and turns it into "Remove mark" when the result
      // ties a player who's already marked.
      isHidden: !!v.isHidden,
      tally: (v.votes ?? []).reduce((sum, x) => sum + (x || 0), 0),
      // Seats with a hand up, straight from the app's own tally — the truth the
      // nomination history is reconciled against (WS frames alone miss votes).
      yesSeats: (v.votes ?? []).flatMap((x, seat) => (x ? [seat] : [])),
      markedSeat: (getStore()?.state?.players?.players ?? []).findIndex(pl => pl?.status?.includes('marked')),
      nomineeIsTraveller: Array.isArray(v.nomination)
        && getStore()?.state?.players?.players?.[v.nomination[1]]?.role?.team === 'traveller',
      // regular | focus | phases | bigwig — audio modes for the nomination.
      // Phases runs locked -3 (accusation) → -2 (defense) → 0 (open chat).
      nominationType: v.nominationType ?? 'regular',
      selectedPlayer: v.selectedPlayer ?? -1, // Big Wig's defense attorney
      bigwigInPlay: (getStore()?.state?.players?.npcs ?? []).some(r => r?.id === 'bigwig'),
      secretVoteRole: secretVoteRoleName(),
      // While we're not driving, the app's own speed is the truth (it may have
      // been changed in botc.app's settings).
      drive: { active: drive.active, pattern: drive.pattern, speed: drive.active ? drive.speed : v.speed },
    };
  };

  // ── Vote clock driver ──
  // The app's clock is just the storyteller's client committing vote/lockVote
  // on a timer kept in vote.voteTimer; each commit goes out as a `lock` frame
  // and every client draws the hand from it. Driving it ourselves = putting
  // our own timer there and committing whatever `locked` we like, whenever we
  // like. Our timer lives in vote.voteTimer too, so the app's Stop, Pause and
  // nomination-close all cancel it exactly as they would their own.
  const DRIVE_MIN_MS = 250;
  const DRIVE_MAX_MS = 5000;
  // baseSpeed: the speed before Speed up / Slow down started drifting it.
  const drive = { active: false, pattern: 'steady', speed: null, baseSpeed: null, timerId: null };
  const clampMs = (ms) => Math.round(Math.min(DRIVE_MAX_MS, Math.max(DRIVE_MIN_MS, ms)));
  const seatCount = (store) => store.state.players?.players?.length ?? 0;
  const postClock = () => post({ type: 'VOTE_CLOCK', data: voteClockOf() });

  // Non-internal commit: the app's socket layer turns it into a `lock` frame,
  // locking that seat's vote with its modifiers (ghost vote spent, Banshee…).
  const lockTo = (store, locked) => store.commit('vote/lockVote', locked);

  // Speed only reaches players inside the voteInProgress frame, and it sets
  // how long their hand takes to swing — re-send it so animations keep pace.
  const broadcastSpeed = (store, ms) => {
    store.commit('vote/setVotingSpeed', ms);
    if (store.state.vote.isInProgress) store.commit('vote/toggleVoteInProgress', true);
  };

  const driveSchedule = (store, delay) => {
    const id = setTimeout(driveTick, delay);
    drive.timerId = id;
    store.commit('vote/setVoteTimer', id); // clears whatever timer was there
  };

  const nextDelay = (store) => {
    switch (drive.pattern) {
      case 'accelerate':
        drive.speed = clampMs(drive.speed * 0.85);
        broadcastSpeed(store, drive.speed);
        return drive.speed;
      case 'decelerate':
        drive.speed = clampMs(drive.speed * 1.18);
        broadcastSpeed(store, drive.speed);
        return drive.speed;
      case 'stutter':
        // Random gaps, but the swing itself stays at the set speed.
        return clampMs(DRIVE_MIN_MS + Math.random() * 2750);
      default:
        return drive.speed;
    }
  };

  function driveTick() {
    const store = getStore();
    const v = store?.state?.vote;
    if (!v?.nomination || !v.isInProgress || v.voteTimer !== drive.timerId) {
      drive.active = false;
      postClock();
      return;
    }
    const n = seatCount(store);
    const locked = Math.max(v.locked, 0);
    // Wobble: now and then the hand slips back a seat, unlocking it again.
    const next = drive.pattern === 'wobble' && locked > 1 && Math.random() < 0.3 ? locked - 1 : locked + 1;
    lockTo(store, next);
    if (next > n) { driveEnd(store); return; }
    driveSchedule(store, nextDelay(store));
  }

  // Same ending as the app's own clock: locked past the seat count (that's
  // what makes the result count), timer cleared, vote no longer in progress.
  const driveEnd = (store) => {
    drive.active = false;
    if (drive.baseSpeed) { drive.speed = drive.baseSpeed; store.commit('vote/setVotingSpeed', drive.speed); }
    drive.baseSpeed = null;
    store.commit('vote/setVoteTimer');
    store.commit('vote/toggleVoteInProgress', false);
    postClock();
  };

  // A manual move while driving pushes the next automatic tick back a full
  // beat, so it doesn't land straight on top of the move.
  const afterManualMove = (store) => {
    if (drive.active && store.state.vote.voteTimer !== 'paused') driveSchedule(store, drive.speed);
    postClock();
  };

  // The app's Close: logs the vote (only once it was counted) and clears the
  // nomination for everyone.
  const closeNomination = (store) => {
    drive.active = false;
    store.commit('vote/setVoteTimer');
    store.dispatch('vote/addLogEntry');
    store.commit('vote/nomination');
  };

  const handleVoteDrive = (msg) => {
    const store = getStore();
    const v = store?.state?.vote;
    if (msg.action === 'type' && v) {
      // The app's nomination-type toggle: not mid-count, not while the Big Wig
      // forces its own type. Switching with a nomination open moves it into or
      // out of the accusation stage, as the app does.
      const npcs = store.state.players?.npcs ?? [];
      if (v.locked > 0 || v.isInProgress || npcs.some(r => r?.id === 'bigwig')) return;
      if (!['regular', 'focus', 'phases'].includes(msg.value)) return;
      store.commit('vote/setNominationType', msg.value);
      if (v.nomination) {
        if (msg.value === 'phases' && v.locked === 0) store.commit('vote/lockVote', -3);
        else if (msg.value !== 'phases' && v.locked < -1) store.commit('vote/lockVote', 0);
      }
      postClock();
      return;
    }
    // Not driving: start from whatever speed the app has now.
    if (v && !drive.active) drive.speed = v.speed;
    if (msg.action === 'speed' && v && !v.nomination) {
      // Like botc.app's settings slider: a speed for the next vote, set with no
      // nomination open. It reaches players with the next voteInProgress frame.
      drive.speed = clampMs(Number(msg.ms) || drive.speed);
      drive.baseSpeed = null;
      store.commit('vote/setVotingSpeed', drive.speed);
      postClock();
      return;
    }
    if (!v?.nomination) return;
    const n = seatCount(store);
    if (!n) return;
    switch (msg.action) {
      case 'start':
      case 'countdown': {
        if (v.isInProgress) return; // already running: patterns and speed take over instead
        if (msg.pattern) drive.pattern = msg.pattern;
        drive.active = true;
        drive.baseSpeed ??= drive.speed;
        if (!v.isInProgress) {
          // Same openings as the app's Start (hand on the nominee, a beat, go)
          // and Countdown (locked -1 plays the 3-2-1 for everyone, 4s, go).
          const countdown = msg.action === 'countdown';
          lockTo(store, countdown ? -1 : 0);
          store.commit('vote/setVotingSpeed', drive.speed);
          store.commit('vote/toggleVoteInProgress', true);
          driveSchedule(store, countdown ? 4000 : 1000);
        }
        break;
      }
      case 'pattern':
        drive.pattern = msg.pattern;
        drive.baseSpeed ??= drive.speed;
        if (v.isInProgress && !drive.active) { drive.active = true; driveSchedule(store, drive.speed); }
        break;
      case 'speed':
        drive.speed = clampMs(Number(msg.ms) || drive.speed);
        drive.baseSpeed = drive.speed; // a deliberate pick becomes the new baseline
        broadcastSpeed(store, drive.speed);
        // Mid-count, the app's own interval would keep its old rate while
        // players' hands animate at the new one — so a speed change takes over.
        if (v.isInProgress && v.voteTimer !== 'paused') {
          drive.active = true;
          driveSchedule(store, drive.speed);
        }
        break;
      case 'pause':
        if (v.isInProgress && v.voteTimer !== 'paused') store.commit('vote/setVoteTimer', 'paused');
        break;
      case 'resume':
        if (v.isInProgress && v.voteTimer === 'paused') { drive.active = true; driveSchedule(store, drive.speed); }
        break;
      case 'step': {
        if (!v.isInProgress) return;
        const locked = Math.min(n, Math.max(1, Math.max(v.locked, 0) + (msg.delta < 0 ? -1 : 1)));
        lockTo(store, locked);
        afterManualMove(store);
        break;
      }
      case 'point': {
        if (!v.isInProgress) return;
        // The hand sits on nominee + locked; the nominee itself is the last stop.
        const nominee = v.nomination[1];
        const locked = ((Number(msg.seat) - nominee) % n + n) % n || n;
        lockTo(store, locked);
        afterManualMove(store);
        break;
      }
      case 'finish':
        if (!v.isInProgress) return;
        lockTo(store, n + 1);
        driveEnd(store);
        break;
      case 'reset':
        // The app's Reset: clock off, hand home, count over.
        drive.active = false;
        store.commit('vote/setVoteTimer');
        lockTo(store, 0);
        store.commit('vote/setSelectedPlayer', -1);
        store.commit('vote/toggleVoteInProgress', false);
        if (drive.baseSpeed) { drive.speed = drive.baseSpeed; store.commit('vote/setVotingSpeed', drive.speed); }
        drive.baseSpeed = null;
        break;
      case 'mark':
        // The app's Mark: refused mid-count or on a secret vote; marks (or, on a
        // tie with the marked player, unmarks) and always closes the nomination.
        if (v.isHidden || v.isInProgress) return;
        if (store.state.players.players[v.nomination[1]]?.role?.team !== 'traveller') {
          store.dispatch('vote/setMarkedPlayer');
        }
        closeNomination(store);
        break;
      case 'close':
        closeNomination(store);
        break;
      case 'next-phase':
        // Accusation & defense: accusation (-3) → defense (-2) → open chat (0).
        if (v.locked === -3) store.commit('vote/lockVote', -2);
        else if (v.locked === -2) store.commit('vote/lockVote', 0);
        break;
      case 'secret':
        if (v.isInProgress || v.locked > 0) return;
        store.commit('vote/toggleIsHidden', !v.isHidden);
        break;
      case 'attorney': {
        // Big Wig's defense attorney; -1 clears it.
        const seat = Number(msg.seat);
        store.commit('vote/setSelectedPlayer', Number.isInteger(seat) && seat >= 0 && seat < n ? seat : -1);
        break;
      }
      case 'release': {
        // Hand the clock back to the app's own steady tick at the current speed.
        drive.active = false;
        if (v.isInProgress && v.voteTimer !== 'paused') {
          store.commit('vote/setVoteTimer', setInterval(() => {
            const s = getStore();
            if (!s?.state?.vote?.nomination) return;
            s.commit('vote/lockVote');
            if (s.state.vote.locked > seatCount(s)) {
              s.commit('vote/setVoteTimer');
              s.commit('vote/toggleVoteInProgress', false);
            }
          }, v.speed));
        }
        break;
      }
    }
    postClock();
  };

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
        // Some custom roles carry image as [goodUrl, evilUrl] instead of a single string.
        : (r?.id ? { id: r.id, name: r.name ?? null, team: r.team ?? '', iconUrl: (Array.isArray(r.image) ? r.image[0] : r.image) ?? null } : null))
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
          // Shallow copy — storePlayers[i].status is a live Vue reactive Proxy(Array),
          // which throws a DataCloneError if passed straight into postMessage.
          status: Array.isArray(storePlayers[i]?.status) ? [...storePlayers[i].status] : [],
          // Reminder tokens on this seat, from the live store — localStorage's
          // mirror of them is unreliable. Nomination alerts read these to tell a
          // spent ability from a live one ('No Ability' on the Virgin, etc).
          reminders: mapReminders(storePlayers[i]?.reminders),
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
      // Live store first — the localStorage mirror can lag behind a pause/resume.
      voteClock: voteClockOf(),
      timer: (() => {
        const t = getStore()?.state?.session?.timer;
        return t ? JSON.parse(JSON.stringify(t)) : (storage.timer ?? null);
      })(),
      session: storage.session ?? null,
      // Signal history lives only in the live Vuex store (session.signals), never
      // persisted to localStorage — keyed by recipient id, "storyteller" mirrors
      // outbound-only signals while each specific user id holds the full two-way
      // conversation with them (both sent and received).
      // JSON round-trip strips the Vue reactive Proxy wrapper — postMessage's
      // structured clone can't serialize that directly (DataCloneError).
      signals: JSON.parse(JSON.stringify(getStore()?.state?.session?.signals ?? {})),
      // Voice channel we are currently in ('' when not in a call) — live store only,
      // never persisted. Drives the companion's join/leave button state.
      chatChannel: getStore()?.state?.chat?.channel ?? '',
    };
  };

  // ── Initial state — wait for grimoire to render ───────────────────────────

  const sendState = () => { if (onPlayPage()) post({ type: 'STATE', data: buildState() }); };

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
  const VOTE_CLOCK_MUTATIONS = new Set([
    'vote/lockVote', 'vote/toggleVoteInProgress', 'vote/setVoteTimer',
    'vote/setVotingSpeed', 'vote/nomination', 'vote/setNomination',
    'vote/setHighscore', 'vote/setNominationType', 'vote/setSelectedPlayer',
    'vote/toggleIsHidden',
  ]);
  // ── Connection status ─────────────────────────────────────────────────────
  // botc.app's own view of its session socket, straight from the store — the
  // companion's connection indicator. Counting WebSocket frames instead says
  // nothing in a quiet lobby (the app pings once a minute) and nothing at all
  // while socket.io is still on its HTTP long-polling transport.
  // `ping` is the app's last round trip in ms: -1 never measured, 0 disconnected.
  let hookedSockets = 0;
  const connOf = () => {
    const s = getStore()?.state?.session;
    return {
      attached: !!s,
      connected: !!s?.isConnected,
      reconnecting: !!s?.isReconnecting,
      ping: typeof s?.ping === 'number' ? s.ping : -1,
      sessionId: s?.sessionId || '',
      // Whether the WebSocket hook caught any socket. False with a live session
      // means the bridge got here after the app's code had loaded.
      wsHooked: hookedSockets > 0,
    };
  };
  const postConn = () => post({ type: 'CONN', data: connOf() });
  const CONN_MUTATIONS = new Set([
    'session/toggleConnected', 'session/toggleReconnecting', 'session/setPing', 'session/setSessionId',
  ]);

  const waitForStoreSubscribe = () => {
    const store = getStore();
    if (!store) { setTimeout(waitForStoreSubscribe, 500); return; }
    postConn();
    store.subscribe((mutation) => {
      if (CONN_MUTATIONS.has(mutation.type)) postConn();
      // Vote clock ticks go out on their own, undebounced — a full state
      // rebuild per tick would be wasted work and lag the hand.
      if (VOTE_CLOCK_MUTATIONS.has(mutation.type) || mutation.type.startsWith('vote/')) post({ type: 'VOTE_CLOCK', data: voteClockOf() });
      // Voice channels and text messages, as the app itself applied them. Same
      // events the WebSocket hook reads off the wire, but these don't depend on
      // the hook having caught the socket (or on the socket being a WebSocket at
      // all); the background dedups the two sources against each other.
      if (mutation.type === 'chat/setUserChannel' && mutation.payload?.userId != null) {
        post({ type: 'STORE_EVENT', name: 'channelChange', data: { userId: String(mutation.payload.userId), channel: mutation.payload.value || '' } });
      }
      if (mutation.type === 'chat/addTextMessageIndicator' && mutation.payload?.senderId != null && mutation.payload?.recipientId) {
        const { senderId, recipientId, length } = mutation.payload;
        post({ type: 'STORE_EVENT', name: 'textMessageIndicator', data: { senderId: String(senderId), recipientId: String(recipientId), length: length ?? null } });
      }
      if (mutation.type === 'session/addSignal' || mutation.type === 'session/clearSignals' || mutation.type.startsWith('session/') && /timer/i.test(mutation.type)) debouncedSend();
    });
  };
  waitForStoreSubscribe();

  // Text messages are read from the action, not the addTextMessage mutation:
  // the mutation rewrites the text into sanitized HTML, the action still has
  // it as typed (and as it travels on the wire). No senderId = sent by us.
  const waitForActionSubscribe = () => {
    const store = getStore();
    if (!store) { setTimeout(waitForActionSubscribe, 500); return; }
    store.subscribeAction((action, state) => {
      if (action.type !== 'chat/textMessage') return;
      const { message, recipientId, senderId, isSystem } = action.payload ?? {};
      if (isSystem || typeof message !== 'string' || !message || !state.session?.sessionId) return;
      post({ type: 'STORE_EVENT', name: 'textMessage', data: {
        senderId: senderId == null ? 'me' : String(senderId),
        recipientId: recipientId ? String(recipientId) : '',
        message: message.substring(0, 250),
      } });
    });
  };
  waitForActionSubscribe();

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
  // Every command and the store call behind it is documented in docs/botc-app-commands.md
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'botc-bridge-cmd') return;
    if (event.data?.type === 'FORCE_UPDATE') { sendState(); return; }
    // Liveness check from the background: the answer proves this bridge (not
    // just the injector) is alive, and carries the app's connection state.
    if (event.data?.type === 'PING') { postConn(); return; }
    if (event.data?.type === 'SEND_SIGNAL') {
      try {
        const store = getStore();
        if (!store) return;
        const message = (event.data.message ?? []).map(t =>
          t?.id === 'grimoire' ? { id: 'grimoire', data: buildGrimoireSnapshot(store) } : t);
        store.commit('session/addSignal', { userIds: event.data.userIds, message, isInbound: false });
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'JOIN_CHANNEL') {
      try {
        const store = getStore();
        // The app has no join action — a store plugin watches this mutation and
        // does both halves (emits channelChange on the socket and opens the
        // local audio connection), so committing it is the whole join. '' leaves.
        if (store) store.commit('chat/setChannel', event.data.channel ?? '');
        debouncedSend();
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
        debouncedSend();
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'SET_HIGHSCORE') {
      try {
        // Same commit as the pen icon on the vote overlay; works with no
        // nomination open too, and a new nomination keeps it.
        const value = Math.max(0, Math.round(Number(event.data.value) || 0));
        getStore()?.commit('vote/setHighscore', value);
      } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'VOTE_DRIVE') {
      try { handleVoteDrive(event.data); } catch { /* page not ready or store unavailable */ }
    }
    if (event.data?.type === 'PAUSE_TIMER') {
      try {
        const store = getStore();
        const timer = store?.state?.session?.timer;
        if (timer?.expiration) {
          const { expiration, title, isPausedDuringVotes, paused } = timer;
          const now = Date.now();
          // Same shape botc.app uses for its pause-during-votes: `paused` is the
          // moment the pause began, and resuming pushes expiration out by the
          // time spent paused. A plain setTimer commit broadcasts it to everyone.
          if (event.data.pause && !paused && expiration > now) {
            store.commit('session/setTimer', { expiration, title, isPausedDuringVotes, paused: now });
          } else if (!event.data.pause && paused) {
            store.commit('session/setTimer', { expiration: expiration + (now - paused), title, isPausedDuringVotes, paused: 0 });
          }
          debouncedSend();
        }
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

    hookedSockets++;
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

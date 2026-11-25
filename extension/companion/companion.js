'use strict';

// ── Chrome shim (allows opening index.html directly in browser for dummy mode) ──
if (typeof chrome === 'undefined' || !chrome.runtime) {
  window.chrome = {
    runtime: {
      sendMessage: () => {},
      onMessage: { addListener: () => {} },
    },
  };
}

// Full sorted timeline kept locally so we can re-render intervals
let fullTimeline = [];
let currentState = null;
let allNominations = [];
// The nomination currently on the floor, before its closing frame lands. Kept
// apart from allNominations so it can't reach the vote maths half-built — the
// per-day nominate-once limits count it, and the log shows it as a live entry.
let pendingNomination = null;
let allChatSessions = [];
let allTextMessages = [];
let nameMap = {};
let showNightChats = false;
let highlightStatus = true; // notes grid: tint cells where someone died / was executed / revived
let mergePhases = true; // notes grid: one column per round (Night N + Day N) instead of per phase
let openPlayerTimelineName = null;
let cellTokens = {};
let playerActionMode = null; // null | 'nominate' | 'swap' | 'mark' | 'point' | 'attorney'
let playerActionPickedSeat = null; // first seat picked during 'swap'/'nominate' mode
let hoveredSeat = null; // seat under the cursor, for the nomination hand preview
let materializedStatus = new Set(); // event keys already turned into a status chip — never recreate, even after edit/delete
let playerMeta = {}; // { name: { roleId, roleName, roleTeam, roleIconUrl, alignment } }
let lastNotesKey = '';
let notesFixedColWidths = null; // { player, role, align } in px — re-measured when names/roles/rows change, never shrunk
let notesFixedKey = null;       // what the widths above were measured for
let pinnedPlayers = new Set();
let stMessage = [];
let stRecipientIds = new Set();
let viewRole = 'player'; // 'storyteller' | 'player' — snaps to amIStoryteller() whenever it changes; manual toggle overrides until then
let detectedRole = null; // last amIStoryteller() result seen, null until the first state with a known user id

// Chips that tint their own cell. Default label is editable per chip.
const CELL_COLORS = {
  good:      { label: 'Good ping', title: 'Good ping (blue)' },
  evil:      { label: 'Evil ping', title: 'Evil ping (red)' },
  droisoned: { label: 'Droisoned', title: 'Drunk or poisoned (sick green)' },
};

// Roles that can cause a droison (cause drunkenness/poison, or are themselves a
// drunk/malfunctioning role). Used to limit the Droisoned chip's source dropdown.
const DROISON_SOURCE_ROLES = new Set([
  // poison / drunk causers
  'poisoner', 'pukka', 'nodashii', 'vigormortis', 'lleech', 'widow',
  'sailor', 'courtier', 'innkeeper', 'minstrel', 'philosopher', 'puzzlemaster',
  'sweetheart', 'vortox',
  // self-drunk / malfunctioning by nature
  'drunk', 'goon', 'lunatic', 'marionette', 'hermit',
]);

const phaseLabel = (phase) => phase % 2 === 1 ? `Night ${Math.ceil(phase / 2)}` : `Day ${Math.ceil(phase / 2)}`;

// Inline stroke icons for markup built in JS (the static ones live in index.html).
const _svg = (size, body, extra = '') =>
  `<svg class="btn-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const ICON_SVG = {
  stepDown: _svg(15, '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>'),
  storyteller: _svg(15, '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"></path>'),
  skull: _svg(10, '<path d="M12 3a8 8 0 0 0-5 14.2V21h10v-3.8A8 8 0 0 0 12 3z"></path><path d="M9 12h.01M15 12h.01"></path>', ' stroke-width="2.6"'),
  revive: _svg(10, '<path d="M12 5v14M5 12h14"></path>', ' stroke-width="3"'),
  hand: _svg(11, '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path>', ' stroke-width="2.2"'),
  markSkull: _svg(30, '<path d="M12 3a8 8 0 0 0-5 14.2V21h10v-3.8A8 8 0 0 0 12 3z"></path><circle cx="9" cy="12" r="1.6" fill="currentColor"></circle><circle cx="15" cy="12" r="1.6" fill="currentColor"></circle><path d="M10 21v-2M14 21v-2"></path>', ' stroke-width="1.8"'),
  ghostVote: _svg(10, '<circle cx="12" cy="12" r="6" fill="currentColor"></circle>'),
  ghostVoteSpent: _svg(10, '<circle cx="12" cy="12" r="7"></circle><path d="M7 17 17 7"></path>', ' stroke-width="2.4"'),
  // Log and notes glyphs (timeline, nominations, conversations, messages).
  logSkull: _svg(12, '<path d="M12 3a8 8 0 0 0-5 14.2V21h10v-3.8A8 8 0 0 0 12 3z"></path><path d="M9 12h.01M15 12h.01M10 21v-2M14 21v-2"></path>'),
  logGhost: _svg(12, '<path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"></path><path d="M9 10h.01M15 10h.01"></path>'),
  logRevive: _svg(12, '<path d="M12 5v14M5 12h14"></path>', ' stroke-width="2.6"'),
  logExile: _svg(12, '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>'),
  logLock: _svg(12, '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>'),
  logPublic: _svg(12, '<path d="m3 11 18-5v12L3 14z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path>'),
  logClock: _svg(12, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>'),
  logEye: _svg(11, '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle>'),
  logAxe: _svg(12, '<path d="m14 12-8.5 8.5a2.12 2.12 0 0 1-3-3L11 9"></path><path d="M15 13 9 7l4-4 6 6h3a8 8 0 0 1-7 7z"></path>'),
  logShield: _svg(12, '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>'),
  logNominate: _svg(12, '<path d="M11 5 6 9H2v6h4l5 4z"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>'),
  logHand: _svg(12, '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path>'),
  logChat: _svg(12, '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'),
  logMoon: _svg(12, '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>'),
  logMail: _svg(12, '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>'),
  logWarn: _svg(12, '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4M12 17h.01"></path>'),
  thumbUp: _svg(13, '<path d="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"></path>'),
  thumbDown: _svg(13, '<path d="M17 14V3M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-7A2 2 0 0 1 6.5 3H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z"></path>'),
  droplet: _svg(13, '<path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z"></path>'),
  trash: _svg(14, '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"></path>'),
  pin: _svg(11, '<path d="M12 17v5M9 10.8V4h6v6.8l2.5 3.2v2h-11v-2z"></path>'),
};

// Status-tag chips are saved with an emoji in their data; draw the matching
// line icon instead, falling back to whatever was stored for unknown ids.
function tagChipIcon(chip) {
  if (chip.name === 'Exiled') return ICON_SVG.logExile;
  return { dead: ICON_SVG.logSkull, executed: ICON_SVG.logAxe, revived: ICON_SVG.logRevive, survived: ICON_SVG.logShield }[chip.id]
    ?? esc(chip.icon ?? '');
}
// Cell-colour chips saved before the emoji were dropped from the default labels.
const cellColorLabel = (label) => String(label ?? '').replace(/^(?:👍|👎|🍺)\s*/u, '');

// "THE FIRST / Day" in the middle of the grimoire circle.
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const phaseOrdinal = (phase) => {
  const n = Math.ceil(phase / 2);
  return ORDINALS[n - 1] ?? `${n}th`;
};
const dn = (name) => {
  const chars = [...(name ?? '')]; // code points, so truncation can't split an emoji
  return chars.length > 20 ? chars.slice(0, 20).join('') + '…' : (name ?? '');
};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Bundled data from extension/data/ scripts (guarded in case scripts fail to load)
const _roles = () => (typeof BOTC_ROLES !== 'undefined' ? BOTC_ROLES : []);
const _specs = () => (typeof BOTC_CHIP_SPECS !== 'undefined' ? BOTC_CHIP_SPECS : {});
// Custom-script role ids (e.g. localized scripts: 'washerwomancz') mapped to
// canonical ids so spec/icon lookups keep working — populated by enrichRoles
const _roleAliases = {};
// Role IDs may have a 'traveller_' prefix in some contexts — strip it for spec/icon lookups
const _normalizeId = (id) => {
  const base = id?.replace(/^traveller_/, '') ?? id;
  return _roleAliases[base] ?? base;
};

// Longest trailing chunk a localized id may add to a canonical one ('cz', 'pt').
// Two, because that's what a language tag is — every extra character allowed
// here is another real homebrew name that gets mistaken for a canonical role
// plus a suffix (at 3, 'baroness' resolves to Baron).
const LOCALE_SUFFIX_MAX = 2;

function registerRoleAlias(r) {
  const id = (r.id ?? '').replace(/^traveller_/, '');
  if (!id || _roleAliases[id] || _roles().some(x => x.id === id)) return;
  // Official wiki icon URL is the most reliable hint: Icon_fortune_teller.png → fortuneteller
  const m = (typeof r.iconUrl === 'string' ? r.iconUrl : '').match(/Icon_([a-z0-9_]+)\./i);
  const guess = m ? m[1].toLowerCase().replace(/_/g, '') : null;
  if (guess && _roles().some(x => x.id === guess)) { _roleAliases[id] = guess; return; }
  // Fallback: longest canonical id the custom id starts with (washerwomancz → washerwoman).
  // The leftover must be language-tag sized — without that cap any homebrew whose
  // id merely happens to start with a canonical one gets swallowed by it
  // (powdermonkey → po, hermitcrab → hermit).
  let best = null;
  for (const x of _roles()) {
    if (id.startsWith(x.id) && id.length - x.id.length <= LOCALE_SUFFIX_MAX && (!best || x.id.length > best.length)) best = x.id;
  }
  if (best) _roleAliases[id] = best;
}
// Base URL for local icons — set by ICONS_BASE global from each page, or derived from chrome.runtime
const _iconBase = () => {
  if (typeof ICONS_BASE !== 'undefined') return ICONS_BASE;
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL('');
  return '../extension/';
};
const _iconUrl = (role) => {
  if (!role) return null;
  const path = role.iconPath ?? _roles().find(r => r.id === _normalizeId(role.id))?.iconPath;
  return path ? _iconBase() + path : (role.iconUrl ?? null);
};


// Single safe path to the background: chrome.runtime is absent on the dev
// harness page and goes away when the extension reloads under an open
// companion tab — neither may throw, and lastError must always be consumed.
function sendBg(msg, callback) {
  try {
    chrome.runtime.sendMessage(msg, (response) => {
      void chrome.runtime?.lastError;
      callback?.(response);
    });
  } catch { /* dummy mode / extension reloaded */ }
}

// ── Render ────────────────────────────────────────────────────────────────

function playerName(playerId) {
  const p = currentState?.players?.find(p => p.id === String(playerId));
  return p?.name ?? playerId;
}

// Roles arriving via the localStorage fallback may lack name/team — fill
// them in from the bundled role data by id
function enrichRoles(roles) {
  return (roles ?? []).map(r => {
    registerRoleAlias(r);
    if (r.name && r.team) return r;
    const b = _roles().find(x => x.id === _normalizeId(r.id));
    return { ...r, name: r.name ?? b?.name ?? r.id, team: r.team || b?.team || '' };
  });
}

// Sync grimoire roles & alignments into playerMeta. The grimoire always wins
// where it has a value, so changing a role in the app changes it in the notes
// table. Synced values are marked (roleAuto/alignAuto) so that clearing them in
// the grimoire clears them here too — manual assignments (popover, alignment
// cycle) only stick for players the grimoire says nothing about.
// A player's key in the notes table and playerMeta.
const notesNameOf = (p) => p.name ?? `Seat ${p.seat + 1}`;

function syncPlayerMetaFromGrimoire() {
  for (const player of currentState?.players ?? []) {
    const name = notesNameOf(player);
    let meta = playerMeta[name];

    if (player.roleId) {
      const roleObj = (currentState.roles ?? []).find(r => r.id === player.roleId);
      playerMeta[name] = {
        ...(meta ?? {}),
        roleId: player.roleId,
        roleName: player.roleName || roleObj?.name || player.roleId,
        roleTeam: player.team || roleObj?.team || '',
        roleIconUrl: _iconUrl(roleObj),
        roleAuto: true,
      };
    } else if (!player.roleId && meta?.roleId && meta.roleAuto) {
      playerMeta[name] = { ...meta, roleId: '', roleName: '', roleTeam: '', roleIconUrl: null, roleAuto: false };
    }

    meta = playerMeta[name];
    const alignment = player.alignment || '';
    if (alignment) {
      playerMeta[name] = { ...(meta ?? {}), alignment, alignAuto: true };
    } else if (!alignment && meta?.alignment && meta.alignAuto) {
      playerMeta[name] = { ...meta, alignment: '', alignAuto: false };
    }
  }
}

function renderState(state) {
  if (!state) return;
  currentState = { ...state, roles: enrichRoles(state.roles) };
  if (state.voteClock !== undefined) voteClock = state.voteClock;
  syncPlayerMetaFromGrimoire();
  document.getElementById('no-data-banner')?.remove();

  if (state.myUserId) {
    const detected = amIStoryteller() ? 'storyteller' : 'player';
    if (detected !== detectedRole) {
      detectedRole = detected;
      if (viewRole !== detected) {
        viewRole = detected;
        syncRoleSwitch();
        applyViewRole();
      }
    }
  }

  // Nominations are a daytime thing: going into night switches Nominate off.
  if (state.phase && state.phase % 2 === 1 && playerActionMode === 'nominate') {
    playerActionMode = null;
    playerActionPickedSeat = null;
    nominationSent = null;
    document.getElementById('players-nominate-btn')?.classList.remove('toggle-btn-active');
  }
  const phase = state.phase ? phaseLabel(state.phase) : '—';
  const phaseBadge = document.getElementById('phase-badge');
  phaseBadge.textContent = phase;
  phaseBadge.className = 'badge ' + (state.phase % 2 === 1 ? 'night' : 'day');

  document.getElementById('session-id').textContent = state.session ? `· ${state.session}` : '';
  const gameEnded = (state.history ?? []).some(h => h.type === 'end');
  document.getElementById('screenshot-btn')?.style.setProperty('display', gameEnded ? '' : 'none');

  const stNames = state.storytellerNames ?? [];
  const stEl = document.getElementById('header-storytellers');
  if (stEl) {
    stEl.innerHTML = stNames.length
      ? stNames.map(n => `<span class="chat-st header-st" data-player="${esc(n)}">${esc(dn(n))}</span>`).join('<span class="header-st-sep">, </span>')
      : '';
  }

  const alive = state.players.filter(p => !p.isDead).length;
  document.getElementById('stat-players').textContent = `${state.players.length} players`;
  document.getElementById('stat-alive').textContent = `${alive} alive`;
  document.getElementById('stat-edition').textContent = state.edition?.edition?.name ?? '';

  applyHighlights(); applyPinnedHighlights();
  renderSignalPlayers();
  refreshSignalHistoryPanel();
  renderTimerPresets();
  renderSignalPresets();
  renderPlayers();
  renderNightOrder();
  updateStRoleBtn();
  updateShowNightBtn();
  chatFilter.render();
  messageFilter.render();
  updateVoiceBtn();
  updateTimerStatus();
}

// A channel of our own, so nobody else is ever routed into it — the id only has
// to be unique on the chat server, it isn't one of the app's own night-/private-
// prefixed names. Players can still be pulled in with a normal whisper request.
function soloChannelId() {
  const myId = currentState?.myUserId;
  return myId ? `private-solo-${myId}` : null;
}

function updateVoiceBtn() {
  const btn = document.getElementById('voice-btn');
  if (!btn) return;
  const inCall = !!currentState?.chatChannel;
  document.getElementById('voice-btn-label').textContent = inCall ? 'Leave Voice' : 'Join Voice';
  btn.classList.toggle('toggle-btn-active', inCall);
  btn.disabled = !inCall && !soloChannelId();
}

function updateStRoleBtn() {
  const btn = document.getElementById('st-role-btn');
  if (!btn) return;
  const isSt = amIStoryteller();
  btn.innerHTML = isSt
    ? `${ICON_SVG.stepDown} Step Down`
    : `${ICON_SVG.storyteller} Become Storyteller`;
  btn.classList.toggle('header-btn-danger', isSt);
}

// Night chats are only visible to the storyteller in the real game — hide the
// toggle (and force it back off) for anyone else, rather than just relying on
// amIStoryteller() being checked once at load.
function updateShowNightBtn() {
  const btn = document.getElementById('toggle-night');
  if (!btn) return;
  const isSt = amIStoryteller();
  btn.style.display = isSt ? '' : 'none';
  if (!isSt && showNightChats) {
    showNightChats = false;
    btn.textContent = 'show night';
    btn.classList.remove('toggle-btn-active');
    renderChats();
  }
}

// ── Timeline ──────────────────────────────────────────────────────────────

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function patchTimelineNames() {
  if (!currentState?.players) return;
  const map = {};
  for (const p of currentState.players) if (p.id && p.name) map[p.id] = p.name;
  let changed = false;
  for (const ev of fullTimeline) {
    if (ev.playerId && !ev.name && map[ev.playerId]) {
      ev.name = map[ev.playerId];
      changed = true;
    }
  }
  return changed;
}

function tlKey(ev) {
  return `${ev.ts}|${ev.type}|${ev.playerId ?? ''}|${ev.label ?? ''}`;
}

function addTimelineEvents(events) {
  const existing = new Set(fullTimeline.map(tlKey));
  for (const ev of events) {
    if (ev.type === 'roles_revealed') continue;
    if (!existing.has(tlKey(ev))) {
      fullTimeline.push(ev);
      existing.add(tlKey(ev));
    }
  }
  fullTimeline.sort((a, b) => a.ts - b.ts);
  patchTimelineNames();
  materializeStatusChips();
  renderNotesGrid();
  renderNightOrder(); // executions (Cannibal, Undertaker) come from the history
}

function bindPhaseSeparators(list, collapsedPhases = new Set()) {
  list.querySelectorAll('.nom-day-sep').forEach(sep => {
    if (collapsedPhases.has(sep.textContent)) {
      sep.classList.add('collapsed');
      let el = sep.nextElementSibling;
      while (el && !el.classList.contains('nom-day-sep')) {
        el.style.display = 'none';
        el = el.nextElementSibling;
      }
    }
    sep.addEventListener('click', () => {
      sep.classList.toggle('collapsed');
      let el = sep.nextElementSibling;
      while (el && !el.classList.contains('nom-day-sep')) {
        el.style.display = sep.classList.contains('collapsed') ? 'none' : '';
        el = el.nextElementSibling;
      }
    });
  });
}

// ── Nominations ───────────────────────────────────────────────────────────

function nominationAt(ts) {
  // Find the nomination whose vote was closest before (or at) the given ts
  let best = null;
  for (const nom of allNominations) {
    if (nom.ts <= ts) best = nom;
    else break;
  }
  return best;
}

// botc.app assigns a literal "Seat N" name to a player when they join without a
// nickname, but never updates that string if seats get shuffled/rotated afterward —
// so a stored "Seat 3" can mean a player now actually sitting in seat 1. Treat that
// pattern as a placeholder and always recompute it from the player's current seat.
const isDefaultSeatName = (name) => typeof name === 'string' && /^seat \d+$/i.test(name.trim());
const displayName = (p, seat) => (p?.name && !isDefaultSeatName(p.name)) ? p.name : `Seat ${(seat ?? p?.seat ?? -1) + 1}`;

function seatName(seat) {
  if (!currentState?.players) return `Seat ${seat + 1}`;
  const p = currentState.players.find(p => p.seat === seat);
  return displayName(p, seat);
}

// Seat name for a historical nomination: prefer the seat→name snapshot taken
// when the nomination happened — resolving against the current player list
// would rewrite history after a seat shuffle/rotation. Falls back to the live
// mapping for records saved before snapshots existed (and for default
// "Seat N" placeholder names, which the snapshot can't disambiguate either).
function nomSeatName(nom, seat) {
  const snap = nom.seatNames?.[seat];
  return (snap && !isDefaultSeatName(snap)) ? snap : seatName(seat);
}

// The seat `name` occupied at the time of a nomination, per its snapshot;
// falls back to the player's current seat for pre-snapshot records.
function nomSeatOf(nom, name) {
  if (nom.seatNames) {
    for (const [seat, n] of Object.entries(nom.seatNames)) {
      if (n === name) return Number(seat);
    }
  }
  return currentState?.players?.find(p => p.name === name)?.seat ?? -1;
}

function gamePhaseAt(ts) {
  let label = null;
  for (const ev of fullTimeline) {
    if (ev.ts > ts) break;
    if (ev.type === 'start') label = 'Game started';
    else if (ev.type === 'phase') label = ev.label;
  }
  return label ?? 'Unknown';
}

// Phase column a death/revive belongs to in the notes grid. Mirrors the
// timeline grouping rule: a death announced in the first 2 minutes of a Day is
// really a night death, so it maps to the preceding phase (the Night).
function phaseForStatusEvent(ev) {
  let curLabel = null, curStart = null, prevLabel = null;
  for (const e of fullTimeline) {
    if (e.ts > ev.ts) break;
    if (e.type === 'start') { prevLabel = curLabel; curLabel = 'Game started'; curStart = e.ts; }
    else if (e.type === 'phase') { prevLabel = curLabel; curLabel = e.label; curStart = e.ts; }
  }
  if (curLabel === null) return null;
  const isEarlyDay = curLabel.startsWith('Day') && (ev.ts - curStart) < 120000;
  return (isEarlyDay && prevLabel) ? prevLabel : curLabel;
}

// A death within the last minute of a day — i.e. just before the next Night
// begins — is treated as a day execution rather than a plain death.
function isExecutionDeath(ev) {
  for (const e of fullTimeline) {
    if (e.type === 'phase' && e.ts > ev.ts) {
      return e.label.startsWith('Night') && (e.ts - ev.ts) < 60000;
    }
  }
  return false;
}

// Did this player spend their ghost vote on this nomination? The ghostvote
// event isn't tied to a nomination, so it's matched by time (within 2 min).
const spentGhostVoteOn = (nom, name) =>
  fullTimeline.some(ev => ev.type === 'ghostvote' && ev.name === name && Math.abs(ev.ts - nom.ts) < 120000);

function renderNominations() {
  const list = document.getElementById('nominations-log');
  const savedTop = list.scrollTop;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const collapsedPhases = new Set([...list.querySelectorAll('.nom-day-sep.collapsed')].map(el => el.textContent));
  list.innerHTML = '';

  let lastDay = null;
  const entries = pendingNomination ? [...allNominations, pendingNomination] : allNominations;
  for (const nom of entries) {
    const isLive = nom === pendingNomination;
    const day = gamePhaseAt(nom.ts);
    if (day !== lastDay) {
      const sep = document.createElement('li');
      sep.className = 'nom-day-sep';
      sep.textContent = day;
      list.appendChild(sep);
      lastDay = day;
    }

    const nominator = nomSeatName(nom, nom.nominatorSeat);
    const nominee = nomSeatName(nom, nom.nomineeSeat);
    // Live: who has a hand up right now; once counted, the final snapshot.
    const yesSeats = isLive && !nom.counted
      ? Object.entries(nom.handState ?? {}).filter(([, v]) => v === 1).map(([s]) => Number(s))
      : (nom.yesSeats ?? []);
    const yesNames = yesSeats.map(s => nomSeatName(nom, s));
    const yesCount = yesNames.length;
    const needed = nom.highscore ?? '?';

    const isGhostVoter = (name) => spentGhostVoteOn(nom, name);

    const executed = typeof needed === 'number' && yesCount >= needed;
    const li = document.createElement('li');
    li.className = `nom-entry${executed ? ' nom-executed' : ''}${isLive ? ' nom-live' : ''}`;
    const liveLabel = !isLive ? '' : nom.counted ? 'Counted' : nom.voting ? 'Voting…' : 'Open';
    const votersLabel = isLive && !nom.counted
      ? (yesNames.length > 0 ? 'Hands up' : 'No hands up')
      : (yesNames.length > 0 ? 'Voted' : 'No votes');
    li.innerHTML = `
      <div class="nom-header">
        <span class="nom-nominator role-name ${playerTeamByName(nominator)}" data-player="${esc(nominator)}">${esc(dn(nominator))}</span>
        <span class="nom-arrow">→</span>
        <span class="nom-nominee role-name ${playerTeamByName(nominee)}" data-player="${esc(nominee)}">${esc(dn(nominee))}</span>
        <span class="nom-meta">
          ${liveLabel ? `<span class="nom-live-badge">${liveLabel}</span>` : ''}
          <span class="nom-count ${executed ? 'nom-execute' : ''}">${yesCount}/${needed}</span>
          <span class="nom-time">${fmt(nom.ts)}</span>
        </span>
      </div>
      <div class="nom-voters${yesNames.length === 0 ? ' nom-none' : ''}">
        <span class="nom-voters-label">${votersLabel}</span>
        ${yesNames.length > 0 ? yesNames.map(n => `${isGhostVoter(n) ? `<span title="Ghost vote">${ICON_SVG.logGhost}</span>` : ''}<span class="role-name ${playerTeamByName(n)}" data-player="${esc(n)}">${esc(dn(n))}</span>`).join('<span class="nom-voter-sep">,</span> ') : ''}
      </div>
    `;
    list.appendChild(li);
  }
  bindPhaseSeparators(list, collapsedPhases);
  list.scrollTop = atBottom ? list.scrollHeight : savedTop;
  applyHighlights(); applyPinnedHighlights();
}

// ── Chats ─────────────────────────────────────────────────────────────────

function playerTeamByName(name) {
  // Grimoire team first; notes (alignment, then assigned role) colour the
  // players the grimoire says nothing about.
  const p = currentState?.players?.find(p => p.name === name);
  if (p?.team) return p.team;
  return metaTeam(playerMeta[name]);
}

// The team a notes row is coloured as: a set alignment beats the assigned
// role's team (evil → demon colours, good → townsfolk).
function metaTeam(meta = {}) {
  return meta.alignment === 'evil' ? 'demon'
       : meta.alignment === 'good' ? 'townsfolk'
       : meta.roleTeam ?? '';
}

function isStoryteller(userId) {
  if (userId === 'me') return false;
  return !!(currentState?.storytellers?.find(s => String(s.id) === String(userId)));
}

function amIStoryteller() {
  return isStoryteller(currentState?.myUserId);
}

function resolveParticipant(userId) {
  const myId = currentState?.myUserId;
  if (userId === 'me' || (myId && userId === myId)) {
    const me = currentState?.players?.find(p => p.id === myId);
    return me?.name ?? nameMap[String(myId)] ?? 'You';
  }
  const p = currentState?.players?.find(p => p.id === String(userId));
  if (p?.name) return p.name;
  if (nameMap[String(userId)]) return nameMap[String(userId)];
  const stIdx = (currentState?.storytellers ?? []).findIndex(s => String(s.id) === String(userId));
  if (stIdx !== -1) {
    const stName = (currentState?.storytellerNames ?? [])[stIdx];
    if (stName) return stName;
  }
  return userId;
}

function isObserver(userId) {
  if (!userId || userId === 'me') return false;
  const id = String(userId);
  if (currentState?.players?.some(p => String(p.id) === id)) return false;
  if (currentState?.storytellers?.some(s => String(s.id) === id)) return false;
  return true;
}

function formatParticipant(userId) {
  const name = resolveParticipant(userId);
  if (isStoryteller(userId)) return `<span class="chat-st" data-player="${esc(name)}">${esc(dn(name))}</span>`;
  if (isObserver(userId)) return `<span class="observer-name"><span class="observer-eye" title="Spectator">${ICON_SVG.logEye}</span>${esc(dn(name))}</span>`;
  const team = playerTeamByName(name);
  return `<span class="role-name ${team}" data-player="${esc(name)}">${esc(dn(name))}</span>`;
}

// Player chip filter for a log section: a header button shows/hides the chip
// row, a header "clear" appears while anything is picked. Empty pick = show
// everything; otherwise an entry matches if any picked player is in it. The
// row is rebuilt only when the roster or selection changes, since renderState
// calls render() on every state push. Picked names stay listed even if they
// drop out of currentState.players, so a reconnect with an empty roster
// doesn't silently wipe the filter.
function createPlayerFilter({ barId, toggleId, clearId, onChange }) {
  const picked = new Set();
  let shown = false;
  let lastKey = null;
  const bar = document.getElementById(barId);
  const toggleBtn = document.getElementById(toggleId);
  const clearBtn = document.getElementById(clearId);

  function render() {
    // A class, not style.display: collapsing/expanding the section resets every
    // child's inline display, which would re-show a hidden bar.
    bar.classList.toggle('player-filter-hidden', !shown);
    toggleBtn.classList.toggle('toggle-btn-active', shown);
    clearBtn.style.display = picked.size ? '' : 'none';
    clearBtn.textContent = `✕ clear ${picked.size}`;
    // Storytellers take part in conversations too, so they get chips after the
    // players — under the same name the entries show them with.
    const sts = currentState?.storytellers ?? [];
    const stNames = new Set((sts.length ? sts.map(st => { const n = resolveParticipant(st.id); return n === st.id ? null : n; }) : (currentState?.storytellerNames ?? []))
      .filter(n => typeof n === 'string' && n)); // an unresolved storyteller is still a bare id — no chip until named
    const names = [...new Set([...(currentState?.players ?? []).map(p => p.name).filter(Boolean), ...stNames, ...picked])];
    const key = JSON.stringify([names.map(n => [n, dn(n), stNames.has(n)]), [...picked]]);
    if (key === lastKey) return;
    lastKey = key;
    bar.innerHTML = names.map(n =>
      `<button class="player-filter-chip${stNames.has(n) ? ' player-filter-st' : ''}${picked.has(n) ? ' active' : ''}" data-filter-player="${esc(n)}"${stNames.has(n) ? ' title="Storyteller"' : ''}>${esc(dn(n))}</button>`
    ).join('');
  }

  bar.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter-player]');
    if (!chip) return;
    const name = chip.dataset.filterPlayer;
    if (picked.has(name)) picked.delete(name);
    else picked.add(name);
    onChange();
  });
  toggleBtn.addEventListener('click', () => { shown = !shown; render(); });
  clearBtn.addEventListener('click', () => { picked.clear(); onChange(); });

  return {
    render,
    get active() { return picked.size > 0; },
    matches: (names) => !picked.size || names.some(n => picked.has(n)),
  };
}

const chatFilter = createPlayerFilter({
  barId: 'chats-filter', toggleId: 'toggle-chat-filter', clearId: 'clear-chat-filter',
  onChange: () => renderChats(),
});
const messageFilter = createPlayerFilter({
  barId: 'messages-filter', toggleId: 'toggle-msg-filter', clearId: 'clear-msg-filter',
  onChange: () => renderMessages(),
});

function renderChats() {
  chatFilter.render();
  const list = document.getElementById('chats-log');
  const savedTop = list.scrollTop;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const collapsedPhases = new Set([...list.querySelectorAll('.nom-day-sep.collapsed')].map(el => el.textContent));
  list.innerHTML = '';

  let lastPhase = null;
  const sessions = allChatSessions.filter(s => (showNightChats || s.type !== 'night') && chatFilter.matches(s.participants.map(resolveParticipant)));
  if (!sessions.length && chatFilter.active) {
    list.innerHTML = '<li class="player-filter-empty">No conversations with the picked players</li>';
  }
  for (const session of sessions) {
    const phase = gamePhaseAt(session.ts);
    if (phase !== lastPhase) {
      const sep = document.createElement('li');
      sep.className = 'nom-day-sep';
      sep.textContent = phase;
      list.appendChild(sep);
      lastPhase = phase;
    }

    const sortedParticipants = [...session.participants].sort((a, b) => {
      const rank = id => isStoryteller(id) ? 1 : isObserver(id) ? 2 : 0;
      return rank(a) - rank(b);
    });
    const names = sortedParticipants.map(formatParticipant);
    const dur = duration(session.end - session.ts);
    const typeLabel = session.type === 'public' ? 'public' : session.type === 'night' ? 'night' : 'private';

    const li = document.createElement('li');
    li.className = `chat-entry chat-${session.type}`;
    li.innerHTML = `
      <div class="chat-header">
        <span class="chat-type" title="${typeLabel}">${typeLabel}</span>
        <span class="chat-participants">${names.join('<span class="chat-sep">, </span>')}</span>
        <span class="chat-time">${fmt(session.ts)} – ${fmt(session.end)} · ${dur}</span>
      </div>
    `;
    list.appendChild(li);
  }
  bindPhaseSeparators(list, collapsedPhases);
  list.scrollTop = atBottom ? list.scrollHeight : savedTop;
  applyHighlights(); applyPinnedHighlights();
}

// ── Text messages ────────────────────────────────────────────────────────

function renderMessages() {
  messageFilter.render();
  const list = document.getElementById('messages-log');
  const savedTop = list.scrollTop;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const collapsedPhases = new Set([...list.querySelectorAll('.nom-day-sep.collapsed')].map(el => el.textContent));
  list.innerHTML = '';
  let lastPhase = null;
  const messages = allTextMessages.filter(m =>
    messageFilter.matches([m.senderId, m.recipientId].filter(Boolean).map(resolveParticipant)));
  if (!messages.length && messageFilter.active) {
    list.innerHTML = '<li class="player-filter-empty">No messages with the picked players</li>';
  }
  for (const msg of messages) {
    const phase = gamePhaseAt(msg.ts);
    if (phase !== lastPhase) {
      const sep = document.createElement('li');
      sep.className = 'nom-day-sep';
      sep.textContent = phase;
      list.appendChild(sep);
      lastPhase = phase;
    }
    const isPrivate = !!msg.recipientId;
    const li = document.createElement('li');
    li.className = `msg-entry${isPrivate ? ' msg-private' : ' msg-public'}`;
    const senderSpan = formatParticipant(msg.senderId);
    const recipientSpan = msg.recipientId ? formatParticipant(msg.recipientId) : null;
    const bodyHtml = msg.message !== null
      ? `<div class="msg-body">${esc(msg.message)}</div>`
      : `<div class="msg-body msg-private-hint">${msg.length ? `${msg.length} chars` : 'private message'}</div>`;
    li.innerHTML = `
      <div class="msg-header">
        <span class="msg-badge ${isPrivate ? 'msg-badge-private' : 'msg-badge-public'}" title="${isPrivate ? 'Private' : 'Public'}">${isPrivate ? ICON_SVG.logLock : ICON_SVG.logPublic}</span>
        <span class="msg-parties">${senderSpan}${recipientSpan ? `<span class="msg-arrow">→</span>${recipientSpan}` : ''}</span>
        <span class="msg-time">${fmt(msg.ts)}</span>
      </div>
      ${bodyHtml}
    `;
    list.appendChild(li);
  }
  bindPhaseSeparators(list, collapsedPhases);
  list.scrollTop = atBottom ? list.scrollHeight : savedTop;
  applyHighlights(); applyPinnedHighlights();
}

// ── Player timeline panel ────────────────────────────────────────────────

function buildPlayerEvents(name) {
  const events = [];
  const myId = currentState?.myUserId;

  // Deaths, revives, ghost votes from timeline
  for (const ev of fullTimeline) {
    if (ev.type === 'death' && ev.name === name) events.push({ ts: ev.ts, type: 'death', label: 'Died' });
    else if (ev.type === 'revive' && ev.name === name) events.push({ ts: ev.ts, type: 'revive', label: 'Revived' });
    else if (ev.type === 'ghostvote' && ev.name === name) {
      const nom = nominationAt(ev.ts);
      const target = nom ? ` on ${esc(nomSeatName(nom, nom.nomineeSeat))}` : '';
      events.push({ ts: ev.ts, type: 'ghostvote', label: `Used ghost vote${target}` });
    }
  }

  // Nominations
  for (const nom of allNominations) {
    const playerSeat = nomSeatOf(nom, name);
    const nominator = nomSeatName(nom, nom.nominatorSeat);
    const nominee = nomSeatName(nom, nom.nomineeSeat);
    const yesSeats = new Set(nom.yesSeats);
    const trackedSeats = new Set(Object.keys(nom.handState ?? {}).map(Number));
    const needed = nom.highscore ?? '?';
    const count = `${nom.yesSeats.length}/${needed}`;
    const raisedHand = yesSeats.has(playerSeat);
    const wasTracked = trackedSeats.has(playerSeat);
    const usedGhostVote = raisedHand && spentGhostVoteOn(nom, name);
    const ghostSuffix = usedGhostVote ? ` ${ICON_SVG.logGhost}` : '';

    const isNominator = nominator === name;
    const isNominee = nominee === name;

    if (isNominator) {
      events.push({ ts: nom.ts, type: 'nom-made', label: `Nominated ${esc(dn(nominee))} (${count})` });
      if (wasTracked) {
        events.push({ ts: nom.ts, type: raisedHand ? 'voted-yes' : 'voted-no', label: raisedHand ? `Voted yes as nominator${ghostSuffix}` : 'Did not vote as nominator' });
      }
    } else if (isNominee) {
      events.push({ ts: nom.ts, type: 'nom-received', label: `Nominated by ${esc(dn(nominator))} (${count})` });
      // Only when the vote was tracked — an untracked seat means the vote is
      // unknown (frames missed), not that the nominee declined to vote.
      if (wasTracked) {
        events.push(raisedHand
          ? { ts: nom.ts, type: 'voted-yes', label: `Voted for own execution${ghostSuffix}` }
          : { ts: nom.ts, type: 'voted-no', label: 'Did not vote for own execution' });
      }
    } else if (wasTracked) {
      events.push({ ts: nom.ts, type: raisedHand ? 'voted-yes' : 'voted-no', label: `${raisedHand ? `Voted yes${ghostSuffix}` : 'Did not vote'} on ${esc(dn(nominator))} → ${esc(dn(nominee))} (${count})` });
    }
  }

  // Conversations
  for (const session of allChatSessions) {
    if (session.type === 'night' && !showNightChats) continue;
    const inSession = session.participants.some(uid => resolveParticipant(uid) === name);
    if (!inSession) continue;
    const others = session.participants
      .filter(uid => resolveParticipant(uid) !== name)
      .sort((a, b) => {
        const rank = id => isStoryteller(id) ? 1 : isObserver(id) ? 2 : 0;
        return rank(a) - rank(b);
      })
      .map(uid => formatParticipant(uid))
      .join(', ');
    const dur = duration(session.end - session.ts);
    const type = session.type === 'public' ? 'public' : session.type === 'night' ? 'night' : 'private';
    events.push({ ts: session.ts, type: `chat-${session.type}`, label: `${type[0].toUpperCase() + type.slice(1)} chat with ${others || 'nobody'} · ${dur}` });
  }

  // Messages
  for (const msg of allTextMessages) {
    const isPrivate = !!msg.recipientId;
    const badge = isPrivate ? ICON_SVG.logLock : ICON_SVG.logPublic;
    if (msg.senderName === name) {
      const to = msg.recipientId ? formatParticipant(msg.recipientId) : '<span class="ptl-msg-public">public</span>';
      const body = msg.message ? `<span class="ptl-msg-body">${esc(msg.message)}</span>` : `<span class="ptl-msg-body">${msg.length ?? '?'} chars</span>`;
      events.push({ ts: msg.ts, type: 'msg-sent', label: `${badge} → ${to} ${body}` });
    } else if (msg.recipientName === name) {
      const from = formatParticipant(msg.senderId);
      const body = msg.message ? `<span class="ptl-msg-body">${esc(msg.message)}</span>` : `<span class="ptl-msg-body">${msg.length ?? '?'} chars</span>`;
      events.push({ ts: msg.ts, type: 'msg-received', label: `${badge} ${from} ${body}` });
    }
  }

  events.sort((a, b) => a.ts - b.ts);
  return events;
}

function refreshPlayerTimeline() {
  if (openPlayerTimelineName) openPlayerTimeline(openPlayerTimelineName);
}

function openPlayerTimeline(name) {
  openPlayerTimelineName = name;
  const panel = document.getElementById('player-timeline-panel');
  const overlay = document.getElementById('player-timeline-overlay');
  document.getElementById('ptl-name').textContent = dn(name);

  const events = buildPlayerEvents(name);
  const list = document.getElementById('ptl-list');
  list.innerHTML = '';

  const typeIcon = {
    'death': ICON_SVG.logSkull, 'revive': ICON_SVG.logRevive, 'ghostvote': ICON_SVG.logGhost,
    'nom-made': ICON_SVG.logNominate, 'nom-received': ICON_SVG.logNominate,
    'voted-yes': ICON_SVG.logHand, 'voted-no': ICON_SVG.logHand,
    'chat-public': ICON_SVG.logChat, 'chat-private': ICON_SVG.logLock, 'chat-night': ICON_SVG.logMoon,
    'msg-sent': ICON_SVG.logMail, 'msg-received': ICON_SVG.logMail,
  };

  let lastPhase = null;
  for (const ev of events) {
    const phase = gamePhaseAt(ev.ts);
    if (phase !== lastPhase) {
      const sep = document.createElement('li');
      sep.className = 'nom-day-sep';
      sep.textContent = phase;
      list.appendChild(sep);
      lastPhase = phase;
    }
    const li = document.createElement('li');
    li.className = `ptl-event ptl-${ev.type}`;
    li.innerHTML = `<span class="ptl-icon">${typeIcon[ev.type] ?? '·'}</span><span class="ptl-time">${fmt(ev.ts)}</span><span class="ptl-label">${ev.label}</span>`;
    list.appendChild(li);
  }

  if (events.length === 0) {
    const li = document.createElement('li');
    li.className = 'ptl-empty';
    li.textContent = 'No events recorded for this player.';
    list.appendChild(li);
  }

  bindPhaseSeparators(list);
  overlay.classList.add('open');
  panel.classList.add('open');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  applyHighlights(); applyPinnedHighlights();
}

function closePlayerTimeline() {
  openPlayerTimelineName = null;
  document.getElementById('player-timeline-panel').classList.remove('open');
  const overlay = document.getElementById('player-timeline-overlay');
  overlay.classList.remove('visible');
  // Reopened before the fade ended: leave the new one alone.
  overlay.addEventListener('transitionend', () => { if (openPlayerTimelineName === null) overlay.classList.remove('open'); }, { once: true });
}
document.getElementById('ptl-close').addEventListener('click', closePlayerTimeline);
document.getElementById('player-timeline-overlay').addEventListener('click', closePlayerTimeline);

// ── Notes grid ───────────────────────────────────────────────────────────

// Things you hear about a role without knowing who holds it don't belong in the
// player grid. They get a table of their own above it — one row per role, or
// per label you type yourself — sharing the grid's phase columns. Rows store
// their chips in cellTokens exactly like a player would, under an owner key no
// player name can take: '@role:<roleId>' or '@note:<id>' (free-text label, kept
// in `labels`). The row list itself lives in playerMeta under NOTE_ROWS_KEY, so
// it is saved, restored and reset together with the notes.
const NOTE_ROWS_KEY = '@noteRows';
const extraNoteRows = () => playerMeta[NOTE_ROWS_KEY]?.rows ?? [];
const noteRowLabel = (owner) => playerMeta[NOTE_ROWS_KEY]?.labels?.[owner] ?? 'General';
const rowRoleId = (owner) => (typeof owner === 'string' && owner.startsWith('@role:')) ? owner.slice(6) : null;
const noteRowRole = (owner) => {
  const id = rowRoleId(owner);
  if (!id) return null;
  return (currentState?.roles ?? []).find(r => r.id === id)
    ?? _roles().find(r => r.id === _normalizeId(id))
    ?? { id, name: id, team: '' };
};

function saveExtraNoteRows(rows, labels = playerMeta[NOTE_ROWS_KEY]?.labels ?? {}) {
  labels = Object.fromEntries(Object.entries(labels).filter(([owner]) => rows.includes(owner)));
  playerMeta[NOTE_ROWS_KEY] = { rows, labels };
  sendBg({ type: 'SAVE_PLAYER_META', name: NOTE_ROWS_KEY, meta: playerMeta[NOTE_ROWS_KEY] });
  lastNotesKey = null;
  renderNotesGrid();
}

const noteRowPhases = (owner) => Object.keys(cellTokens)
  .filter(k => k.startsWith(`${owner}|`))
  .map(k => k.slice(owner.length + 1));

// `value` is a role-row owner key, or { custom: 'label' } for a free-text row.
function addExtraNoteRow(value) {
  let owner = value;
  if (value?.custom) {
    owner = `@note:${Date.now().toString(36)}`;
    saveExtraNoteRows([...extraNoteRows(), owner], { ...(playerMeta[NOTE_ROWS_KEY]?.labels ?? {}), [owner]: value.custom });
  } else if (!extraNoteRows().includes(owner)) {
    saveExtraNoteRows([...extraNoteRows(), owner]);
  }
  // Straight into the newest column: a row is added because there's something to write down.
  const cells = document.querySelectorAll(`.notes-scroll td.notes-cell[data-player="${CSS.escape(owner)}"]`);
  const cell = cells[cells.length - 1];
  if (cell) openPopover(owner, cell.dataset.phase, cell, null);
}

function removeExtraNoteRow(owner) {
  const phases = noteRowPhases(owner).filter(ph => (cellTokens[`${owner}|${ph}`] ?? []).length);
  if (phases.length && !confirm('Remove this row and its notes?')) return;
  for (const ph of phases) { cellTokens[`${owner}|${ph}`] = []; saveTokens(owner, ph); }
  saveExtraNoteRows(extraNoteRows().filter(o => o !== owner));
}

// "So that's who the Empath is": hand everything noted on a role row over to a
// player, phase by phase, and set that player's role unless the grimoire has
// already filled it in.
function assignNoteRowToPlayer(owner, player) {
  for (const ph of noteRowPhases(owner)) {
    const chips = (cellTokens[`${owner}|${ph}`] ?? []).filter(c => !(c.type === 'cellcolor' && c.auto));
    if (chips.length) {
      cellTokens[`${player}|${ph}`] = [...(cellTokens[`${player}|${ph}`] ?? []), ...chips];
      saveTokens(player, ph);
    }
    cellTokens[`${owner}|${ph}`] = [];
    saveTokens(owner, ph);
  }
  const role = noteRowRole(owner);
  const meta = playerMeta[player] ?? {};
  if (role && !(meta.roleId && meta.roleAuto)) {
    playerMeta[player] = { ...meta, roleId: role.id, roleName: role.name, roleTeam: role.team ?? '', roleIconUrl: _iconUrl(role), roleAuto: false };
    savePlayerMeta(player);
    refreshPageColors();
  }
  saveExtraNoteRows(extraNoteRows().filter(o => o !== owner));
}

// Places a popover under its anchor, or above it when it doesn't fit below
// (and there's more room above), clamped to the viewport edges.
function placePopover(pop, anchorEl, gap = 2) {
  const rect = anchorEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const below = spaceBelow > pop.offsetHeight + 8 || spaceBelow > rect.top;
  pop.style.top = below
    ? `${rect.bottom + window.scrollY + gap}px`
    : `${Math.max(window.scrollY + 4, rect.top + window.scrollY - pop.offsetHeight - gap)}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8))}px`;
}

// The one searchable list popover behind every picker (notes rows, roles,
// signal tokens): type to filter, arrows to move, Enter to pick, Escape or an
// outside click to close. Clicking the anchor again closes it.
// items: [{ label, value, cls?, iconUrl?, sub?, subCls?, prefix?, search? }]
//   iconUrl present but empty → a blank icon slot, so names stay aligned;
//   prefix is trusted HTML before the icon; search is extra filter text.
// opts: placeholder, allowCustom (typed text can be picked: onPick({ custom })),
//   activeValue (highlighted), clearLabel + onClear (a button under the list).
let _listPicker = null;
let _listPickerAnchor = null;
let _listPickerClosedOnAnchor = false;

function closeListPicker() {
  if (!_listPicker || _listPicker.style.display === 'none') return;
  _listPicker.style.display = 'none';
  _listPickerAnchor?.setAttribute('aria-expanded', 'false');
}

function openListPicker(anchorEl, items, onPick, opts = {}) {
  const { placeholder = 'Search…', allowCustom = false, activeValue, clearLabel, onClear } = opts;
  if (!_listPicker) {
    _listPicker = document.createElement('div');
    _listPicker.id = 'list-picker';
    _listPicker.className = 'mrp-popover';
    _listPicker.innerHTML = '<input class="mrp-search" type="text" /><div class="mrp-list" role="listbox"></div><button class="mrp-clear"></button>';
    document.body.appendChild(_listPicker);
    const search = _listPicker.querySelector('.mrp-search');
    const list = _listPicker.querySelector('.mrp-list');
    const pick = (el) => {
      if (el?.dataset.custom) {
        const text = search.value.trim();
        closeListPicker();
        if (text) _listPicker._onPick({ custom: text });
        return;
      }
      const item = _listPicker._items[Number(el?.dataset.i)];
      if (!item) return;
      closeListPicker();
      _listPicker._onPick(item.value);
    };
    _listPicker._render = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = _listPicker._items.map((it, i) => {
        if (q && !`${it.label} ${it.search ?? ''}`.toLowerCase().includes(q)) return '';
        const icon = it.iconUrl ? `<img class="tp-role-icon" src="${esc(it.iconUrl)}" alt="" />`
          : 'iconUrl' in it ? '<span class="mrp-icon-blank"></span>' : '';
        const sub = it.sub ? `<span class="mrp-sub ${it.subCls ?? ''}">${esc(it.sub)}</span>` : '';
        const active = it.value === _listPicker._activeValue ? ' active' : '';
        return `<div class="mrp-item ${it.cls ?? ''}${active}" data-i="${i}" role="option" tabindex="-1">${it.prefix ?? ''}${icon}<span class="mrp-name">${esc(it.label)}</span>${sub}</div>`;
      }).join('');
      // Listed after the matches, so Enter still takes the first role that fits.
      if (_listPicker._allowCustom && q) {
        list.innerHTML += `<div class="mrp-item" data-custom="1" tabindex="-1"><span class="mrp-name">“${esc(search.value.trim())}”</span><span class="mrp-sub">own label</span></div>`;
      }
      if (!list.innerHTML) list.innerHTML = '<div class="mrp-empty">Nothing matches.</div>';
    };
    search.addEventListener('input', _listPicker._render);
    // mousedown, not click: picking mustn't blur the search box first.
    list.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.mrp-item');
      if (el) { e.preventDefault(); pick(el); }
    });
    _listPicker.querySelector('.mrp-clear').addEventListener('mousedown', (e) => {
      e.preventDefault();
      const onClearFn = _listPicker._onClear;
      closeListPicker();
      onClearFn?.();
    });
    _listPicker.addEventListener('keydown', (e) => {
      const els = [...list.querySelectorAll('.mrp-item')];
      const idx = els.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (els[idx + 1] ?? els[els.length - 1])?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (idx > 0) els[idx - 1].focus(); else search.focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(idx >= 0 ? els[idx] : els[0]); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeListPicker(); }
    });
    document.addEventListener('mousedown', (e) => {
      _listPickerClosedOnAnchor = false;
      if (_listPicker.style.display === 'flex' && !_listPicker.contains(e.target)) {
        _listPickerClosedOnAnchor = !!_listPickerAnchor?.contains(e.target);
        closeListPicker();
      }
    });
  }
  const pop = _listPicker;
  // This press already closed the picker on its own anchor: that's the toggle-off.
  if (_listPickerClosedOnAnchor && anchorEl === _listPickerAnchor) { _listPickerClosedOnAnchor = false; return; }
  closeListPicker();
  _listPickerAnchor = anchorEl;
  anchorEl.setAttribute('aria-expanded', 'true');
  pop._items = items;
  pop._onPick = onPick;
  pop._allowCustom = allowCustom;
  pop._activeValue = activeValue;
  pop._onClear = onClear;
  const clearBtn = pop.querySelector('.mrp-clear');
  clearBtn.hidden = !clearLabel;
  clearBtn.textContent = clearLabel ?? '';
  const search = pop.querySelector('.mrp-search');
  search.value = '';
  search.placeholder = placeholder;
  pop._render();
  pop.style.display = 'flex';
  placePopover(pop, anchorEl);
  pop.querySelector('.mrp-item.active')?.scrollIntoView({ block: 'nearest' });
  search.focus();
}

// Role items for a picker: the script's roles with their icon and team colour.
const roleListItems = () => (currentState?.roles ?? []).map(r => ({
  label: r.name ?? r.id, value: r.id, cls: `role-name ${r.team ?? ''}`, iconUrl: _iconUrl(r) ?? '',
}));

function openAddNoteRowPicker(anchorEl) {
  const have = new Set(extraNoteRows());
  const pool = currentState?.roles?.length ? currentState.roles : _roles();
  const items = pool.filter(r => !have.has(`@role:${r.id}`))
    .map(r => ({ label: r.name ?? r.id, cls: `role-name ${r.team ?? ''}`, iconUrl: _iconUrl(r), value: `@role:${r.id}` }));
  openListPicker(anchorEl, items, addExtraNoteRow, { placeholder: 'Pick a role or type your own label…', allowCustom: true });
}

function openAssignNoteRowPicker(owner, anchorEl) {
  const roleId = rowRoleId(owner);
  const players = (currentState?.players ?? []).map(p => {
    const name = notesNameOf(p);
    const meta = playerMeta[name] ?? {};
    return { label: name, sub: meta.roleName ?? '', value: name, match: !!roleId && meta.roleId === roleId };
  });
  players.sort((a, b) => b.match - a.match); // whoever already carries this role comes first
  openListPicker(anchorEl, players, (name) => assignNoteRowToPlayer(owner, name), { placeholder: 'Who is it?' });
}

function getPhaseColumns() {
  const phases = [];
  const seen = new Set();
  for (const ev of fullTimeline) {
    if (ev.type === 'phase' && ev.label && !seen.has(ev.label)) {
      seen.add(ev.label);
      phases.push(ev.label);
    }
  }
  return phases;
}

// Notes-grid columns. Normally one per phase; when mergePhases is on, Night N
// and Day N collapse into a single "round" column. Each column carries the list
// of underlying phases it shows, plus the phase a freshly added chip lands in.
function getNotesColumns() {
  const phases = getPhaseColumns();
  if (!mergePhases) {
    return phases.map(p => ({
      key: p,
      label: p,
      phases: [p],
      cls: p.startsWith('Night') ? 'notes-night' : 'notes-day',
      addPhase: p,
    }));
  }
  const groups = [];
  const byNum = new Map();
  for (const p of phases) {
    const num = (p.match(/(\d+)\s*$/) ?? [, p])[1];
    if (!byNum.has(num)) {
      const g = { key: `r${num}`, label: `N/D ${num}`, phases: [], cls: 'notes-merged', addPhase: null };
      byNum.set(num, g);
      groups.push(g);
    }
    byNum.get(num).phases.push(p);
  }
  // New chips default to the Day of the round (where most notes go), else its
  // only/last phase.
  for (const g of groups) g.addPhase = g.phases.find(p => p.startsWith('Day')) ?? g.phases[g.phases.length - 1];
  return groups;
}

function columnForPhase(phase) {
  return getNotesColumns().find(c => c.phases.includes(phase)) ?? null;
}

function abilityValBadges(chip) {
  const inputs = chip.inputs ?? {};
  const spec = _specs()[_normalizeId(chip.roleId)];
  const badges = [];
  const pushBadge = (cls, text) => badges.push(`<span class="ab-val ${cls}">${esc(String(text))}</span>`);

  if (spec) {
    spec.inputs.forEach((inputSpec, idx) => {
      const v = inputs[`i${idx}`];
      if (v === null || v === undefined || v === '') return;
      if (inputSpec.type === 'player' || inputSpec.type === 'player?') {
        badges.push(`<span class="ab-val ab-val-player" data-player="${esc(String(v))}">${esc(String(v))}</span>`);
      } else if (inputSpec.type === 'role') {
        const r = (currentState?.roles ?? []).find(x => x.id === v) ?? _roles().find(x => x.id === v);
        const team = r?.team ?? '';
        badges.push(`<span class="ab-val ab-val-role role-name ${team}">${esc(r ? r.name : String(v))}</span>`);
      } else if (inputSpec.type === 'yn' || inputSpec.type === 'options' || inputSpec.type === 'alignment' || inputSpec.type === 'direction') {
        pushBadge('ab-val-option', typeof v === 'boolean' ? (v ? 'yes' : 'no') : v);
      } else if (inputSpec.type === 'number') {
        pushBadge('ab-val-number', v);
      } else {
        pushBadge('ab-val-text', v);
      }
    });
  } else {
    // fallback for chips with no spec
    Object.values(inputs).forEach(v => {
      if (v === null || v === undefined || v === '') return;
      if (typeof v === 'boolean') { pushBadge('ab-val-option', v ? 'yes' : 'no'); return; }
      const r = (currentState?.roles ?? []).find(x => x.id === v) ?? _roles().find(x => x.id === v);
      pushBadge(r ? 'ab-val-role' : 'ab-val-text', r ? r.name : String(v));
    });
  }
  return badges.slice(0, 4).join('');
}

const CHIP_X_HTML = '<button type="button" class="chip-x" title="Remove" aria-label="Remove">×</button>';

// A chip plus its hover "×". Inherited droison copies aren't draggable: they
// follow their origin, so moving one would just be undone by the next pass.
function chipHtml(chip, player, phase, idx) {
  const html = chipBodyHtml(chip, player, phase, idx);
  return html && html.replace(/<\/span>$/, `${CHIP_X_HTML}</span>`);
}

function chipBodyHtml(chip, player, phase, idx) {
    const drag = chip.type === 'cellcolor' && chip.auto ? '' : ' draggable="true"';
    const attrs = `data-player="${esc(player)}" data-phase="${esc(phase)}" data-idx="${idx}"${drag}`;
    if (chip.type === 'role') {
      const icon = chip.iconUrl ? `<img class="tp-role-icon" src="${esc(chip.iconUrl)}" />` : '';
      return `<span class="token-chip role-chip role-name ${chip.team ?? ''}" ${attrs}>${icon}${esc(chip.name)}</span>`;
    }
    if (chip.type === 'tag') {
      const content = chip.icon ? `${tagChipIcon(chip)} ${esc(chip.name ?? chip.label ?? '')}` : esc(chip.label ?? '');
      return `<span class="token-chip tag-chip" ${attrs}>${content}</span>`;
    }
    if (chip.type === 'note') {
      if (!chip.text) return ''; // being typed — pruned when the popover closes
      return `<span class="token-chip note-chip" ${attrs}>${esc(chip.text)}</span>`;
    }
    if (chip.type === 'cellcolor') {
      let sourceHtml = '';
      if (chip.source) {
        if (chip.id === 'droisoned') {
          const r = (currentState?.roles ?? []).find(x => x.id === chip.source) ?? _roles().find(x => x.id === chip.source);
          const url = _iconUrl({ id: chip.source, iconUrl: r?.iconUrl });
          const ic = url ? `<img class="tp-role-icon" src="${esc(url)}" />` : '';
          sourceHtml = `<span class="cc-source role-name ${r?.team ?? ''}">${ic}${esc(r?.name ?? chip.source)}</span>`;
        } else {
          sourceHtml = `<span class="cc-source" data-player="${esc(chip.source)}">${esc(chip.source)}</span>`;
        }
      }
      const inherited = chip.auto ? ' cc-inherited' : '';
      return `<span class="token-chip cellcolor-chip cc-${esc(chip.id)}${inherited}" ${attrs}>${esc(cellColorLabel(chip.label))}${sourceHtml}</span>`;
    }
    if (chip.type === 'ability') {
      const resolvedUrl = _iconUrl({ id: chip.roleId, iconUrl: chip.iconUrl });
      const icon = resolvedUrl ? `<img class="tp-role-icon" src="${esc(resolvedUrl)}" />` : '';
      const badges = abilityValBadges(chip);
      return `<span class="token-chip ability-chip role-name ${chip.roleTeam ?? ''}" title="${esc(chip.roleName)}" ${attrs}>${icon}${badges}</span>`;
    }
    if (chip.type === 'confirmed') {
      const resolvedUrl = _iconUrl({ id: chip.sourceRoleId, iconUrl: chip.iconUrl });
      const icon = resolvedUrl ? `<img class="tp-role-icon" src="${esc(resolvedUrl)}" />` : '';
      return `<span class="token-chip confirmed-chip" title="${esc(chip.label ?? '')}" ${attrs}>${icon}✓</span>`;
    }
    return '';
}

// Renders all chips for a cell spanning one or more phases (merged rounds), but
// shows at most one droison chip — preferring the user's own/origin over an
// inherited "from now on" copy — so a cell never shows the token twice.
function cellChipsHtml(player, phases) {
  const entries = [];
  for (const phase of phases) {
    (cellTokens[`${player}|${phase}`] ?? []).forEach((chip, idx) => entries.push({ chip, phase, idx }));
  }
  const isDroison = (c) => c.type === 'cellcolor' && c.id === 'droisoned';
  const droison = entries.filter(e => isDroison(e.chip));
  const keep = droison.length ? (droison.find(e => !e.chip.auto) ?? droison[0]) : null;
  return entries
    .filter(e => !isDroison(e.chip) || e === keep)
    .map(e => chipHtml(e.chip, player, e.phase, e.idx))
    .join('');
}

// Stable key for a timeline status event, independent of which phase column it
// lands in — used to remember which events have already been turned into a
// chip, so we don't recreate one after the user edits or deletes it.
const statusEventKey = (ev) => `${ev.type}|${ev.ts}|${ev.name ?? playerName(ev.playerId)}`;

// How a death should be labelled. Note this can change after the fact: a death
// only counts as an execution once we see a Night start within a minute of it,
// and that phase event doesn't exist yet at the moment the death happens.
function classifyDeath(player, phase, ev) {
  if (playerTeamByName(player) === 'traveller' && phase.startsWith('Day')) return { id: 'dead', icon: '👋', name: 'Exiled' };
  if (isExecutionDeath(ev)) return { id: 'executed', icon: '🪓', name: 'Executed' };
  return { id: 'dead', icon: '💀', name: 'Died' };
}

// When the timeline records a death/revive, drop a real, editable, persisted
// status chip into the right cell — exactly like clicking the Died / Revived button.
// The chip is created once and tagged `auto`. On later passes we re-classify our
// own untouched auto chip (e.g. Died → Executed once the following Night starts),
// but never recreate or override one the user has edited or deleted.
function materializeStatusChips() {
  if (!fullTimeline.length) return false;
  let touched = false;
  let keysChanged = false;
  for (const ev of fullTimeline) {
    if (ev.type !== 'death' && ev.type !== 'revive') continue;
    const player = ev.name ?? playerName(ev.playerId);
    const phase = phaseForStatusEvent(ev);
    if (!player || !phase) continue; // names/phases not resolved yet — retry next pass

    const key = statusEventKey(ev);
    const cellKey = `${player}|${phase}`;
    const existing = cellTokens[cellKey] ?? [];

    if (!materializedStatus.has(key)) {
      // First sighting: create the chip, unless the user already recorded a
      // matching status by hand.
      let chip = null;
      if (ev.type === 'death') {
        if (!existing.some(c => c.type === 'tag' && (c.id === 'dead' || c.id === 'executed'))) {
          chip = { type: 'tag', auto: true, ...classifyDeath(player, phase, ev) };
        }
      } else if (!existing.some(c => c.type === 'tag' && c.id === 'revived')) {
        chip = { type: 'tag', auto: true, id: 'revived', icon: '🌱', name: 'Revived' };
      }
      materializedStatus.add(key);
      keysChanged = true;
      if (chip) {
        cellTokens[cellKey] = [...existing, chip];
        saveTokens(player, phase);
        touched = true;
      }
    } else if (ev.type === 'death') {
      // Already created — but we may now know it was an execution. Upgrade our
      // own auto chip in place; leave a user-edited/removed one untouched.
      const want = classifyDeath(player, phase, ev);
      const idx = existing.findIndex(c => c.auto && c.type === 'tag' && (c.id === 'dead' || c.id === 'executed'));
      if (idx !== -1 && (existing[idx].id !== want.id || existing[idx].icon !== want.icon || existing[idx].name !== want.name)) {
        existing[idx] = { type: 'tag', auto: true, ...want };
        cellTokens[cellKey] = existing;
        saveTokens(player, phase);
        touched = true;
      }
    }
  }
  if (keysChanged) sendBg({ type: 'SAVE_MATERIALIZED_STATUS', keys: [...materializedStatus] });
  if (touched) lastNotesKey = null; // force the grid to rebuild even if isDead hasn't synced yet
  return touched;
}

// The cell tint reflects the last cellcolor chip among the column's phases.
function cellColorId(player, phases) {
  let id = null;
  for (const ph of phases) {
    for (const c of (cellTokens[`${player}|${ph}`] ?? [])) {
      if (c.type === 'cellcolor' && CELL_COLORS[c.id]) id = c.id;
    }
  }
  return id;
}

function applyCellColorClass(cell, player, phases) {
  Object.keys(CELL_COLORS).forEach(id => cell.classList.remove(`cc-cell-${id}`));
  const id = cellColorId(player, phases);
  if (id) cell.classList.add(`cc-cell-${id}`);
  STATUS_TAG_IDS.forEach(s => cell.classList.remove(`st-cell-${s}`));
  const st = statusTagId(player, phases);
  if (st) cell.classList.add(`st-cell-${st}`);
}

// Death / execution / revival status of a cell (the last such tag chip among
// the column's phases) — what the old Timeline panel used to list. Shown as a
// cell highlight when the "highlight deaths" toggle is on.
const STATUS_TAG_IDS = ['dead', 'executed', 'revived'];
function statusTagId(player, phases) {
  let id = null;
  for (const ph of phases) {
    for (const c of (cellTokens[`${player}|${ph}`] ?? [])) {
      if (c.type === 'tag' && STATUS_TAG_IDS.includes(c.id)) id = c.id;
    }
  }
  return id;
}

function refreshCellChips(player, phase) {
  const col = columnForPhase(phase);
  if (!col) return;
  const cell = document.querySelector(`.notes-scroll td.notes-cell[data-player="${CSS.escape(player)}"][data-col="${CSS.escape(col.key)}"]`);
  if (!cell) return;
  cell.querySelector('.cell-chips').innerHTML = cellChipsHtml(player, col.phases);
  applyCellColorClass(cell, player, col.phases);
}

function setChip(player, phase, chip, idx) {
  if (!cellTokens[`${player}|${phase}`]) cellTokens[`${player}|${phase}`] = [];
  if (idx !== null && idx !== undefined) {
    cellTokens[`${player}|${phase}`][idx] = chip;
  } else {
    cellTokens[`${player}|${phase}`].push(chip);
  }
  saveTokens(player, phase);
  refreshCellChips(player, phase);
}

function saveTokens(player, phase) {
  sendBg({ type: 'SAVE_TOKENS', player, phase, tokens: cellTokens[`${player}|${phase}`] ?? [] });
}

// Removes one chip. An ongoing ("from now on") droison spans later phases, so
// removing one has to reach them too: removing the original clears every
// inherited copy; removing an inherited copy ends the droison from that phase on.
function removeChip(player, phase, idx) {
  const key = `${player}|${phase}`;
  const chips = cellTokens[key] ?? [];
  if (idx < 0 || idx >= chips.length) return chips;
  const [removed] = chips.splice(idx, 1);
  cellTokens[key] = chips;
  saveTokens(player, phase);
  refreshCellChips(player, phase);

  if (removed?.type === 'cellcolor' && removed.id === 'droisoned' && (removed.auto || removed.fromNowOn)) {
    if (removed.auto) {
      const phases = getPhaseColumns();
      for (let i = phases.indexOf(phase) - 1; i >= 0; i--) {
        const origin = (cellTokens[`${player}|${phases[i]}`] ?? [])
          .find(c => c.type === 'cellcolor' && c.id === 'droisoned' && !c.auto && c.fromNowOn);
        if (origin) { origin.until = phase; saveTokens(player, phases[i]); break; }
      }
    }
    document.activeElement?.blur?.(); // the grid won't rebuild under a focused note input
    lastNotesKey = null;
    renderNotesGrid();
  }
  return chips;
}

// Moves a chip to another cell (drag & drop). Inside a merged round column the
// chip keeps its own phase; anywhere else it lands in the column's default one.
function moveChip(from, toPlayer, toCell) {
  const col = getNotesColumns().find(c => c.key === toCell.dataset.col);
  if (!col) return;
  const toPhase = col.phases.includes(from.phase) ? from.phase : col.addPhase;
  if (from.player === toPlayer && from.phase === toPhase) return;
  const src = cellTokens[`${from.player}|${from.phase}`] ?? [];
  const chip = src[from.idx];
  if (!chip) return;
  src.splice(from.idx, 1);
  saveTokens(from.player, from.phase);
  const { auto, until, ...moved } = chip; // a moved chip is the user's own from here on
  cellTokens[`${toPlayer}|${toPhase}`] = [...(cellTokens[`${toPlayer}|${toPhase}`] ?? []), moved];
  saveTokens(toPlayer, toPhase);
  lastNotesKey = null;
  renderNotesGrid();
}

// Single global popover
let _popover = null;
let _popoverAnchor = null; // the cell the popover hangs off
let _popoverTarget = null; // { player, phase, chipIdx } — chipIdx null = add mode

function getPopover() {
  if (_popover) return _popover;
  _popover = document.createElement('div');
  _popover.id = 'token-popover';
  _popover.innerHTML = `
    <textarea class="tp-note-input" rows="1" placeholder="Type a note…" spellcheck="false"></textarea>
    <div class="tp-main-row">
      <div class="tp-status-tags">
        <button class="tp-tag-btn" data-tag-id="dead"      data-tag-icon="💀" data-tag-name="Died"               title="Dead">${ICON_SVG.logSkull}</button>
        <button class="tp-tag-btn" data-tag-id="executed"  data-tag-icon="🪓" data-tag-name="Executed"           title="Executed">${ICON_SVG.logAxe}</button>
        <button class="tp-tag-btn" data-tag-id="revived"   data-tag-icon="🌱" data-tag-name="Revived"            title="Revived">${ICON_SVG.logRevive}</button>
        <button class="tp-tag-btn" data-tag-id="survived"  data-tag-icon="🛡️" data-tag-name="Survived"          title="Survived execution">${ICON_SVG.logShield}</button>
      </div>
      <div class="tp-color-tags">
        <button class="tp-color-btn cc-good"      data-color-id="good"      title="${CELL_COLORS.good.title}">${ICON_SVG.thumbUp}</button>
        <button class="tp-color-btn cc-evil"      data-color-id="evil"      title="${CELL_COLORS.evil.title}">${ICON_SVG.thumbDown}</button>
        <button class="tp-color-btn cc-droisoned" data-color-id="droisoned" title="${CELL_COLORS.droisoned.title}">${ICON_SVG.droplet}</button>
      </div>
      <button class="tp-x-btn" type="button" title="Remove / cancel" aria-label="Remove">${ICON_SVG.trash}</button>
    </div>
    <div class="tp-source-section" style="display:none">
      <span class="tp-source-label">source</span>
      <div class="tp-source-select"></div>
      <label class="tp-fromnow" style="display:none"><input type="checkbox" class="tp-fromnow-cb" /> from now on</label>
    </div>
    <div class="tp-ability-section" style="display:none">
      <div class="tp-ability-tabs"></div>
      <div class="tp-ability-form"></div>
    </div>
    <div class="tp-hint"><span><kbd>Enter</kbd> done</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span><span><kbd>Alt</kbd>+<kbd>←↑↓→</kbd> next cell</span><span><kbd>Esc</kbd> close</span></div>
  `;
  document.body.appendChild(_popover);

  const noteInput = _popover.querySelector('.tp-note-input');
  const xBtn = _popover.querySelector('.tp-x-btn');
  const abilityTabs = _popover.querySelector('.tp-ability-tabs');
  const abilityForm = _popover.querySelector('.tp-ability-form');
  const sourceSection = _popover.querySelector('.tp-source-section');
  const sourceSelectWrap = _popover.querySelector('.tp-source-select');
  const fromNowLabel = _popover.querySelector('.tp-fromnow');
  const fromNowCb = _popover.querySelector('.tp-fromnow-cb');

  let _activeAbilityRoleId = null;
  let _lockedAbilityRoleId = null;

  // ── Commit helper ───────────────────────────────────────────────────────────

  const commit = (chip) => {
    if (!_popoverTarget) return;
    const { player, phase, chipIdx } = _popoverTarget;
    setChip(player, phase, chip, chipIdx);
    const newIdx = chipIdx !== null ? chipIdx : (cellTokens[`${player}|${phase}`]?.length ?? 1) - 1;
    _popoverTarget = { player, phase, chipIdx: newIdx };
  };

  // Re-commit a colored-cell chip with edits applied; drops the `auto` flag so a
  // user-touched chip is no longer managed by droison propagation.
  const editCellColor = (cur, changes) => commit({
    type: 'cellcolor',
    id: cur.id,
    label: 'label' in changes ? changes.label : cur.label,
    source: 'source' in changes ? changes.source : cur.source,
    fromNowOn: 'fromNowOn' in changes ? changes.fromNowOn : cur.fromNowOn,
    // Where an ongoing droison was cut short (see the remove handler);
    // re-ticking "from now on" starts it running to the end again.
    until: 'fromNowOn' in changes ? undefined : cur.until,
  });

  // ── Note input ──────────────────────────────────────────────────────────────

  noteInput.addEventListener('input', () => {
    const val = noteInput.value.trim();
    const { player, phase, chipIdx } = _popoverTarget ?? {};
    const cur = (chipIdx !== null && chipIdx !== undefined) ? (cellTokens[`${player}|${phase}`] ?? [])[chipIdx] : null;
    if (cur?.type === 'cellcolor') {
      editCellColor(cur, { label: val }); // editing a colored cell's label, not a note
    } else if (val || cur?.type === 'note') {
      // An emptied note stays as a blank placeholder (keeping its position)
      // until the popover closes, which prunes it.
      commit({ type: 'note', text: val });
    }
    autoGrow();
    const q = val.toLowerCase();
    abilityTabs.querySelectorAll('.tp-ab-tab').forEach(btn => {
      btn.style.display = (!q || btn.title.toLowerCase().includes(q)) ? '' : 'none';
    });
  });

  // Enter confirms (the note is already saved live) and closes; Esc is handled
  // by the global handler below.
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); closePopover(); }
  });

  // The note box grows with its text, so long notes stay fully visible.
  const autoGrow = () => {
    noteInput.style.height = 'auto';
    noteInput.style.height = `${noteInput.scrollHeight + 2}px`;
    positionPopover();
  };
  _popover._autoGrow = autoGrow;

  // Alt+arrows: hop to the neighbouring cell without reaching for the mouse.
  _popover.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.key.startsWith('Arrow')) return;
    const cell = _popoverAnchor;
    if (!cell?.isConnected) return;
    e.preventDefault();
    let next = null;
    if (e.key === 'ArrowLeft') next = cell.previousElementSibling;
    else if (e.key === 'ArrowRight') next = cell.nextElementSibling;
    else {
      const ci = [...cell.parentElement.children].indexOf(cell);
      let row = cell.parentElement;
      do { row = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling; }
      while (row && !row.querySelector('.notes-cell'));
      next = row?.children[ci];
    }
    if (!next?.classList.contains('notes-cell')) return;
    closePopover();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    openPopover(next.dataset.player, next.dataset.phase, next, null);
  });

  // ── Cell-color buttons ───────────────────────────────────────────────────────
  // Tint the cell and add an editable label chip; keep the popover open so the
  // user can immediately overwrite the default label.
  _popover.querySelectorAll('.tp-color-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const id = btn.dataset.colorId;
      commit({ type: 'cellcolor', id, label: CELL_COLORS[id].label });
      showCellColorSource(id, null, false);
      noteInput.value = CELL_COLORS[id].label;
      noteInput.focus();
      noteInput.select();
    });
  });

  // "from now on": mark a droison as ongoing → propagate it to all later phases
  fromNowCb.addEventListener('change', () => {
    const { player, phase, chipIdx } = _popoverTarget ?? {};
    const cur = (chipIdx !== null && chipIdx !== undefined) ? (cellTokens[`${player}|${phase}`] ?? [])[chipIdx] : null;
    if (cur?.type !== 'cellcolor' || cur.id !== 'droisoned') return;
    editCellColor(cur, { fromNowOn: fromNowCb.checked || undefined });
    lastNotesKey = null;
    renderNotesGrid(); // rebuild so propagated copies appear in later columns
  });

  // ── Status tag buttons ──────────────────────────────────────────────────────

  _popover.querySelectorAll('.tp-tag-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      commit({ type: 'tag', id: btn.dataset.tagId, icon: btn.dataset.tagIcon, name: btn.dataset.tagName });
      closePopover();
    });
  });

  // ── Remove ──────────────────────────────────────────────────────────────────

  xBtn.addEventListener('click', () => {
    if (!_popoverTarget) return;
    const { player, phase, chipIdx } = _popoverTarget;
    if (chipIdx === null || chipIdx === undefined) { closePopover(); return; }
    const chips = removeChip(player, phase, chipIdx);

    // Keep editing: jump to the neighbouring chip — the one to the left, or the
    // next one to the right if the deleted chip was the leftmost.
    let nextIdx = null;
    if (chipIdx >= 1) nextIdx = chipIdx - 1;     // left neighbour
    else if (chips.length > 0) nextIdx = 0;      // right neighbour (shifted into place)

    const col = nextIdx !== null ? columnForPhase(phase) : null;
    const cell = col && document.querySelector(`.notes-scroll td.notes-cell[data-player="${CSS.escape(player)}"][data-col="${CSS.escape(col.key)}"]`);
    _popoverTarget = null; // the chip is gone — nothing left for closePopover to prune
    if (cell) openPopover(player, phase, cell, nextIdx);
    else closePopover();
  });

  document.addEventListener('mousedown', (e) => {
    if (_popover.style.display !== 'none' && !_popover.contains(e.target)) {
      closePopover();
      // A click elsewhere only dismisses — except on another notes cell, which
      // opens straight away so hopping between cells takes one click, not two.
      // The swallower lives only until this press ends, so a drag (no click)
      // can't leave it behind to eat some later, unrelated click.
      if (!e.target.closest?.('.notes-scroll .notes-cell')) {
        const swallow = ev => ev.stopPropagation();
        document.addEventListener('click', swallow, { capture: true, once: true });
        document.addEventListener('mouseup', () => {
          setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
        }, { capture: true, once: true });
      }
    }
  });

  // ── Ability chip section ────────────────────────────────────────────────────

  function buildHoverSelect(placeholder, items, currentVal, idx, itemClass) {
    // items: [{ value, label, cls? }]
    const wrap = document.createElement('div');
    wrap.className = 'tp-ab-hsel';

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.dataset.inputIdx = idx;
    hidden.value = currentVal ?? '';
    wrap.appendChild(hidden);

    const curItem = items.find(i => i.value === currentVal);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'tp-ab-hsel-trigger' + (curItem?.cls ? ` ${curItem.cls}` : '');
    trigger.textContent = (curItem && curItem.value !== '') ? curItem.label : placeholder;
    wrap.appendChild(trigger);

    const list = document.createElement('div');
    list.className = 'tp-ab-hsel-list';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'tp-ab-hsel-item' + (item.cls ? ` ${item.cls}` : '') + (item.value === currentVal ? ' active' : '');
      row.textContent = item.label;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        trigger.textContent = item.value !== '' ? item.label : placeholder;
        trigger.className = 'tp-ab-hsel-trigger' + (item.cls ? ` ${item.cls}` : '');
        hidden.value = item.value;
        list.classList.remove('open');
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      });
      list.appendChild(row);
    });
    wrap.appendChild(list);

    let closeTimer = null;
    let locked = false;
    let outsideHandler = null;

    const open = () => { clearTimeout(closeTimer); list.classList.add('open'); };
    const scheduleClose = () => { if (locked) return; closeTimer = setTimeout(() => list.classList.remove('open'), 120); };
    const unlock = () => {
      locked = false;
      list.classList.remove('open');
      trigger.classList.remove('locked');
      if (outsideHandler) { document.removeEventListener('mousedown', outsideHandler); outsideHandler = null; }
    };

    trigger.addEventListener('mouseenter', open);
    wrap.addEventListener('mouseleave', scheduleClose);
    list.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    trigger.addEventListener('click', () => {
      if (locked) { unlock(); return; }
      locked = true;
      trigger.classList.add('locked');
      open();
      outsideHandler = (e) => {
        if (!wrap.contains(e.target) && !list.contains(e.target)) unlock();
      };
      document.addEventListener('mousedown', outsideHandler);
    });

    return wrap;
  }

  // Optional "source" for a colored-cell chip: a player for good/evil pings,
  // an in-play role for droisoned. Reuses the ability hover-select widget.
  function buildSourceSelect(colorId, currentSource) {
    sourceSelectWrap.innerHTML = '';
    let items, placeholder;
    if (colorId === 'droisoned') {
      placeholder = 'source role';
      const pool = currentState?.roles?.length ? currentState.roles : _roles();
      items = [{ value: '', label: '(none)' }, ...pool
        .filter(r => DROISON_SOURCE_ROLES.has(_normalizeId(r.id)))
        .map(r => ({ value: r.id, label: r.name, cls: `role-name ${r.team ?? ''}` }))];
    } else {
      placeholder = 'source player';
      const players = currentState?.players?.map(p => p.name).filter(Boolean) ?? [];
      items = [{ value: '', label: '(none)' }, ...players.map(n => ({ value: n, label: n }))];
    }
    const sel = buildHoverSelect(placeholder, items, currentSource ?? '', 'src');
    const hidden = sel.querySelector('input[type="hidden"]');
    hidden.addEventListener('change', () => {
      const { player, phase, chipIdx } = _popoverTarget ?? {};
      const cur = (chipIdx !== null && chipIdx !== undefined) ? (cellTokens[`${player}|${phase}`] ?? [])[chipIdx] : null;
      if (cur?.type === 'cellcolor') {
        editCellColor(cur, { source: hidden.value || undefined });
        if (cur.id === 'droisoned' && cur.fromNowOn) { lastNotesKey = null; renderNotesGrid(); }
      }
    });
    sourceSelectWrap.appendChild(sel);
  }

  function showCellColorSource(colorId, currentSource, fromNowOn) {
    buildSourceSelect(colorId, currentSource);
    const isDroison = colorId === 'droisoned';
    fromNowLabel.style.display = isDroison ? '' : 'none';
    fromNowCb.checked = isDroison && !!fromNowOn;
    sourceSection.style.display = 'flex';
  }
  function hideCellColorSource() {
    sourceSection.style.display = 'none';
    sourceSelectWrap.innerHTML = '';
  }

  function buildPills(options, currentVal, idx) {
    // options: [{ value, label }]  — select on hover, commit immediately
    const wrap = document.createElement('div');
    wrap.className = 'tp-ab-opt-wrap';
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.dataset.inputIdx = idx;
    hidden.value = currentVal ?? '';
    wrap.appendChild(hidden);
    options.forEach(({ value, label: lbl }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tp-ab-opt-btn';
      btn.textContent = lbl;
      if (value === currentVal) btn.classList.add('active');
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        wrap.querySelectorAll('.tp-ab-opt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        hidden.value = value;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function buildAbilityInputEl(spec, idx, currentVal) {
    const { type, label, filter, min, max, yesLabel, noLabel } = spec;
    const players = currentState?.players?.map(p => p.name) ?? [];

    let el;
    if (type === 'player' || type === 'player?') {
      const items = players.map(n => ({ value: n, label: n }));
      el = buildHoverSelect(label, items, currentVal ?? '', idx);
    } else if (type === 'role') {
      const goodTeams = new Set(['townsfolk', 'outsider']);
      const evilTeams = new Set(['minion', 'demon']);
      const inPlay = currentState?.roles ?? [];
      const items = inPlay
        .filter(r => {
          if (filter === 'townsfolk' && r.team !== 'townsfolk') return false;
          if (filter === 'outsider' && r.team !== 'outsider') return false;
          if (filter === 'minion' && r.team !== 'minion') return false;
          if (filter === 'demon' && r.team !== 'demon') return false;
          if (filter === 'good' && !goodTeams.has(r.team)) return false;
          if (filter === 'evil' && !evilTeams.has(r.team)) return false;
          return true;
        })
        .map(r => ({ value: r.id, label: r.name, cls: `role-name ${r.team ?? ''}` }));
      el = buildHoverSelect(label, items, currentVal ?? '', idx);
    } else if (type === 'number') {
      const lo = min ?? 0;
      const hi = max ?? 99;
      if (hi - lo <= 10) {
        const wrap = document.createElement('div');
        wrap.className = 'tp-ab-num-wrap';
        const lbl2 = document.createElement('span');
        lbl2.className = 'tp-ab-num-label';
        lbl2.textContent = label;
        wrap.appendChild(lbl2);
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.dataset.inputIdx = idx;
        hidden.value = currentVal !== undefined ? String(currentVal) : '';
        wrap.appendChild(hidden);
        for (let v = lo; v <= hi; v++) {
          const nbtn = document.createElement('button');
          nbtn.type = 'button';
          nbtn.className = 'tp-ab-num-btn';
          nbtn.textContent = String(v);
          if (String(v) === String(currentVal)) nbtn.classList.add('active');
          nbtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            wrap.querySelectorAll('.tp-ab-num-btn').forEach(b => b.classList.remove('active'));
            nbtn.classList.add('active');
            hidden.value = String(v);
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
          });
          wrap.appendChild(nbtn);
        }
        el = wrap;
      } else {
        el = document.createElement('input');
        el.type = 'number';
        el.className = 'tp-ab-number';
        el.min = lo;
        el.max = hi;
        el.placeholder = label;
        if (currentVal !== undefined) el.value = currentVal;
      }
    } else if (type === 'yn') {
      const yLbl = yesLabel ?? 'yes';
      const nLbl = noLabel ?? 'no';
      // normalize old boolean storage
      const normVal = currentVal === true ? yLbl : currentVal === false ? nLbl : currentVal;
      el = buildPills([{ value: yLbl, label: yLbl }, { value: nLbl, label: nLbl }], normVal, idx);
    } else if (type === 'alignment') {
      el = buildPills(
        [{ value: 'good', label: 'good' }, { value: 'evil', label: 'evil' }, { value: 'neither', label: 'neither' }],
        currentVal, idx,
      );
    } else if (type === 'direction') {
      el = buildPills(
        [{ value: 'clockwise', label: 'clockwise' }, { value: 'anti-clockwise', label: 'anti-clockwise' }],
        currentVal === 'anti' ? 'anti-clockwise' : currentVal, idx,
      );
    } else if (type === 'options') {
      el = buildPills((spec.options ?? []).map(o => ({ value: o, label: o })), currentVal, idx);
    } else {
      el = document.createElement('input');
      el.type = 'text';
      el.className = 'tp-ab-text';
      el.placeholder = label;
      if (currentVal !== undefined) el.value = currentVal;
    }
    if (!el.querySelector?.('[data-input-idx]')) el.dataset.inputIdx = idx;
    return el;
  }

  function readAbilityInputs(roleId) {
    const spec = _specs()[_normalizeId(roleId)];
    if (!spec) return {};
    const inputs = {};
    abilityForm.querySelectorAll('[data-input-idx]').forEach(el => {
      const idx = Number(el.dataset.inputIdx);
      const inputSpec = spec.inputs[idx];
      if (!inputSpec) return;
      let val = el.value;
      if (inputSpec.type === 'number') val = val !== '' ? Number(val) : undefined;
      if (val !== undefined && val !== '') inputs[`i${idx}`] = val;
    });
    return inputs;
  }

  function resolveInPlayRole(roleId) {
    const normId = _normalizeId(roleId);
    return (currentState?.roles ?? []).find(r => _normalizeId(r.id) === normId)
      ?? (() => {
        const p = (currentState?.players ?? []).find(p => p.team === 'traveller' && _normalizeId(p.roleId) === normId);
        return p ? { id: p.roleId, name: p.roleName ?? p.roleId, team: 'traveller' } : null;
      })();
  }

  function commitAbility(roleId) {
    const inPlayRole = resolveInPlayRole(roleId);
    const botcRole = _roles().find(r => r.id === roleId);
    const role = inPlayRole ?? botcRole;
    if (!role) return;
    const inputs = readAbilityInputs(roleId);
    commit({
      type: 'ability',
      roleId: role.id,
      roleName: role.name,
      roleTeam: role.team ?? '',
      iconUrl: _iconUrl(role),
      inputs,
    });
  }

  function buildAbilityForm(roleId, existingInputs) {
    const spec = _specs()[_normalizeId(roleId)];
    abilityForm.innerHTML = '';
    if (!spec) return;
    spec.inputs.forEach((inputSpec, idx) => {
      const el = buildAbilityInputEl(inputSpec, idx, existingInputs?.[`i${idx}`]);
      el.addEventListener('change', () => commitAbility(roleId));
      el.addEventListener('input', () => commitAbility(roleId));
      abilityForm.appendChild(el);
    });
  }

  function buildAbilityTabs(existingAbilityRoleId, existingInputs) {
    const roles = currentState?.roles ?? [];
    // Travellers don't appear in the script list — pull them from players
    const seen = new Set(roles.map(r => r.id));
    const travellers = (currentState?.players ?? [])
      .filter(p => p.team === 'traveller' && p.roleId && !seen.has(p.roleId))
      .map(p => ({ id: p.roleId, name: p.roleName ?? p.roleId, team: 'traveller' }));
    const allRoles = [...roles, ...travellers];
    const specRoles = allRoles.filter(r => _specs()[_normalizeId(r.id)]);
    abilityTabs.innerHTML = '';
    abilityForm.innerHTML = '';
    _activeAbilityRoleId = null;
    _lockedAbilityRoleId = null;
    const section = _popover.querySelector('.tp-ability-section');
    if (!specRoles.length) { section.style.display = 'none'; return; }
    section.style.display = '';

    const makeBtn = (role) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tp-ab-tab role-name ${role.team ?? ''}`;
      btn.dataset.roleId = role.id;
      btn.title = role.name;
      const url = _iconUrl(role);
      if (url) {
        const img = document.createElement('img');
        img.className = 'tp-role-icon';
        img.src = url;
        btn.appendChild(img);
      } else {
        btn.textContent = (role.name ?? role.id ?? '?').slice(0, 3);
      }
      if (role.id === existingAbilityRoleId) {
        btn.classList.add('active', 'locked');
        _activeAbilityRoleId = role.id;
        _lockedAbilityRoleId = role.id;
        buildAbilityForm(role.id, existingInputs);
      }
      let _hoverTimer = null;
      btn.addEventListener('mouseenter', () => {
        if (_lockedAbilityRoleId) return;
        if (_activeAbilityRoleId === role.id) return;
        _hoverTimer = setTimeout(() => {
          if (_lockedAbilityRoleId) return;
          abilityTabs.querySelectorAll('.tp-ab-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _activeAbilityRoleId = role.id;
          buildAbilityForm(role.id, null);
        }, 200);
      });
      btn.addEventListener('mouseleave', () => clearTimeout(_hoverTimer));
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (_lockedAbilityRoleId === role.id) {
          // click locked tab → unlock and deselect
          btn.classList.remove('active', 'locked');
          _activeAbilityRoleId = null;
          _lockedAbilityRoleId = null;
          abilityForm.innerHTML = '';
        } else {
          // click any other tab → lock to it and commit immediately
          abilityTabs.querySelectorAll('.tp-ab-tab').forEach(b => b.classList.remove('active', 'locked'));
          btn.classList.add('active', 'locked');
          _activeAbilityRoleId = role.id;
          _lockedAbilityRoleId = role.id;
          buildAbilityForm(role.id, null);
          commitAbility(role.id);
        }
      });
      return btn;
    };

    specRoles.forEach(role => abilityTabs.appendChild(makeBtn(role)));
  }

  _popover._buildAbilityTabs = buildAbilityTabs;
  _popover._showCellColorSource = showCellColorSource;
  _popover._hideCellColorSource = hideCellColorSource;

  return _popover;
}

function closePopover() {
  if (_popover) {
    // Hiding doesn't drop focus right away, and a focused note box blocks grid rebuilds.
    if (_popover.contains(document.activeElement)) document.activeElement.blur();
    _popover.style.display = 'none';
  }
  const t = _popoverTarget;
  _popoverTarget = null;
  // Drop a note that was emptied while editing.
  if (t && t.chipIdx !== null && t.chipIdx !== undefined) {
    const chip = (cellTokens[`${t.player}|${t.phase}`] ?? [])[t.chipIdx];
    if (chip?.type === 'note' && !chip.text) removeChip(t.player, t.phase, t.chipIdx);
  }
}

function positionPopover() {
  const pop = _popover;
  const anchor = _popoverAnchor;
  if (!pop || pop.style.display === 'none' || !anchor?.isConnected) return;
  placePopover(pop, anchor);
}

function openPopover(player, phase, anchorEl, chipIdx = null) {
  const pop = getPopover();
  if (_popoverTarget) closePopover(); // prune whatever the previous target left behind
  _popoverTarget = { player, phase, chipIdx };
  _popoverAnchor = anchorEl;

  const chip = chipIdx !== null ? (cellTokens[`${player}|${phase}`] ?? [])[chipIdx] : null;
  const noteInput = pop.querySelector('.tp-note-input');

  // Pre-fill the input when editing a note chip or a colored-cell chip's label
  noteInput.value = chip?.type === 'note' ? chip.text
    : chip?.type === 'cellcolor' ? cellColorLabel(chip.label)
    : '';

  // Source picker only applies to colored-cell chips
  if (chip?.type === 'cellcolor') pop._showCellColorSource(chip.id, chip.source, chip.fromNowOn);
  else pop._hideCellColorSource();

  // Ability tabs — pre-select: editing chip > player's assigned role > none
  const existingAbilityRoleId = chip?.type === 'ability' ? chip.roleId
    : chip?.type === 'confirmed' ? chip.sourceRoleId
    : (rowRoleId(player) ?? playerMeta[player]?.roleId ?? null);
  pop.querySelector('.tp-ability-tabs').querySelectorAll('.tp-ab-tab').forEach(btn => { btn.style.display = ''; });
  try {
    pop._buildAbilityTabs(existingAbilityRoleId, chip?.type === 'ability' ? chip.inputs : null);
  } catch (e) {
    console.error('ability tabs error:', e);
  }

  pop.style.display = 'flex';
  pop._autoGrow(); // sizes the note box, then positions the popover
  noteInput.focus();
  noteInput.setSelectionRange(noteInput.value.length, noteInput.value.length);
}

function savePlayerMeta(name) {
  sendBg({ type: 'SAVE_PLAYER_META', name, meta: playerMeta[name] ?? {} });
  renderPlayers(); renderNightOrder(); // role assignments feed both role views
}

function metaNameColor(name) {
  const team = metaTeam(playerMeta[name]);
  if (team === 'demon' || team === 'minion') return 'var(--demon)';
  if (team === 'townsfolk') return 'var(--townsfolk)';
  if (team === 'outsider') return 'var(--outsider)';
  if (team === 'traveller') return 'var(--traveller)';
  return '';
}

function metaRowTint(name) {
  const team = metaTeam(playerMeta[name]);
  if (team === 'demon' || team === 'minion') return 'rgba(220,50,50,0.06)';
  if (team === 'townsfolk') return 'rgba(99,179,237,0.06)';
  if (team === 'outsider') return 'rgba(129,140,248,0.06)';
  if (team === 'traveller') return 'rgba(192,132,252,0.06)';
  return '';
}

// ── Player meta role picker — sets the Notes meta role, not the game's ──

function openRolePopover(name, anchorEl) {
  const setMetaRole = (role) => {
    playerMeta[name] = { ...(playerMeta[name] ?? {}), roleId: role?.id ?? '', roleName: role?.name ?? '', roleTeam: role?.team ?? '', roleIconUrl: role ? _iconUrl(role) : null, roleAuto: false };
    savePlayerMeta(name);
    refreshMetaCells(name, { recolorPage: true });
  };
  openListPicker(anchorEl, roleListItems(), (roleId) => {
    const role = (currentState?.roles ?? []).find(r => r.id === roleId);
    if (role) setMetaRole(role);
  }, { activeValue: playerMeta[name]?.roleId, clearLabel: 'clear role', onClear: () => setMetaRole(null) });
}

// ── Signal token pickers — add a {id:'role'} / {id:'player'} token ──

function pushSignalToken(token) {
  stMessage.push(token);
  renderSignalPreview();
  updateSignalSendBtn();
}

function openSignalRolePopover(anchorEl) {
  openListPicker(anchorEl, roleListItems(), (roleId) => pushSignalToken({ id: 'role', data: roleId }),
    { placeholder: 'Search roles…' });
}

// Players in seat order, with their seat number and (for the storyteller) role,
// so "Seat 4" and a real name are both findable.
function openSignalPlayerPopover(anchorEl) {
  const items = (currentState?.players ?? [])
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map(p => {
      const name = displayName(p, p.seat);
      const role = playerRoleInfo(p);
      return {
        label: dn(name), value: p.seat, cls: `mrp-player${p.isDead ? ' mrp-dead' : ''}`,
        prefix: `<span class="mrp-seat">${p.seat + 1}</span>`, iconUrl: role?.iconUrl ?? '',
        sub: role?.name, subCls: `role-name ${role?.team ?? ''}`,
        search: `${name} ${p.seat + 1} ${role?.name ?? ''}`,
      };
    });
  openListPicker(anchorEl, items, (seat) => pushSignalToken({ id: 'player', data: seat }),
    { placeholder: 'Search players…' });
}

// ── Player grimoire role picker — commits the role to the live game ──

function openGameRolePopover(seat, anchorEl) {
  const setRole = (roleId) => sendBg({ type: 'SET_PLAYER_PROPERTY', seat, property: 'role', roleId });
  openListPicker(anchorEl, roleListItems(), setRole, { clearLabel: 'clear role', onClear: () => setRole(null) });
}

function toggleAlignment(name) {
  const cycle = { '': 'good', 'good': 'evil', 'evil': '' };
  const cur = playerMeta[name]?.alignment ?? '';
  playerMeta[name] = { ...(playerMeta[name] ?? {}), alignment: cycle[cur], alignAuto: false };
  savePlayerMeta(name);
  refreshMetaCells(name);
  refreshPageColors();
}

function refreshPageColors() {
  renderNominations();
  renderChats();
  renderMessages();
}

function refreshMetaCells(name, { recolorPage = false } = {}) {
  if (recolorPage) refreshPageColors();
  const escaped = CSS.escape(name);
  const nameCell = document.querySelector(`#notes-table td.notes-player-name[data-player="${escaped}"]`);
  const roleCell = document.querySelector(`#notes-table td.notes-meta-role[data-player="${escaped}"]`);
  const alignCell = document.querySelector(`#notes-table td.notes-meta-align[data-player="${escaped}"]`);
  const row = nameCell?.closest('tr');
  if (!nameCell) return;
  const color = metaNameColor(name);
  const tint = metaRowTint(name);
  nameCell.style.color = color;
  nameCell.style.backgroundImage = tint ? `linear-gradient(${tint},${tint})` : '';
  if (row) row.style.background = tint;
  const meta = playerMeta[name] ?? {};
  if (roleCell) roleCell.innerHTML = metaRoleChipHtml(meta);
  if (alignCell) alignCell.innerHTML = metaAlignBadgeHtml(meta);
}

function metaRoleChipHtml(meta) {
  if (!meta.roleName) return '';
  const icon = meta.roleIconUrl ? `<img class="tp-role-icon" src="${esc(meta.roleIconUrl)}" />` : '';
  return `<span class="meta-role-chip role-name ${metaTeam(meta)}">${icon}${esc(meta.roleName)}</span>`;
}

function metaAlignBadgeHtml(meta) {
  const a = meta.alignment;
  if (a !== 'good' && a !== 'evil') return '';
  return `<span class="meta-align-badge meta-${a}">${a === 'good' ? 'G' : 'E'}</span>`;
}

function measureMaxRoleChipWidth() {
  const roles = currentState?.roles ?? [];
  if (!roles.length) return 0;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;';
  document.body.appendChild(wrap);
  let max = 0;
  for (const role of roles) {
    const chip = document.createElement('span');
    chip.className = 'meta-role-chip';
    if (_iconUrl(role)) {
      const img = document.createElement('img');
      img.className = 'tp-role-icon';
      img.style.cssText = 'width:14px;height:14px;';
      img.src = _iconUrl(role);
      chip.appendChild(img);
    }
    chip.appendChild(document.createTextNode(role.name ?? ''));
    wrap.appendChild(chip);
    max = Math.max(max, chip.offsetWidth);
    wrap.innerHTML = '';
  }
  document.body.removeChild(wrap);
  return max + 8; // 4px cell padding each side
}

// A droison marked "from now on" is stamped into every later phase as an auto
// copy that mirrors the origin (and re-mirrors as the origin is edited). Copies
// are recomputed from scratch each pass, so deleting/unchecking the origin or a
// new phase appearing is handled automatically. A user's own droison in a phase
// overrides the inherited copy there.
function propagateDroison() {
  const phases = getPhaseColumns();
  if (!phases.length || !currentState?.players?.length) return;
  const owners = [...currentState.players.map(notesNameOf), ...extraNoteRows()];
  for (const player of owners) {
    let active = null; // { label, source } carried forward from the latest origin
    for (const phase of phases) {
      const key = `${player}|${phase}`;
      const chips = cellTokens[key] ?? [];
      const userDroison = chips.find(c => c.type === 'cellcolor' && c.id === 'droisoned' && !c.auto);
      const autoIdx = chips.findIndex(c => c.type === 'cellcolor' && c.id === 'droisoned' && c.auto);

      if (userDroison?.fromNowOn) active = { label: userDroison.label, source: userDroison.source, until: userDroison.until };
      if (active && active.until === phase) active = null; // cut short here by the user

      const wantCopy = active && !userDroison; // inherit only where the user hasn't placed their own
      if (wantCopy) {
        const ex = autoIdx !== -1 ? chips[autoIdx] : null;
        if (!ex || ex.label !== active.label || ex.source !== active.source) {
          const copy = { type: 'cellcolor', id: 'droisoned', label: active.label, source: active.source, auto: true };
          if (autoIdx !== -1) chips[autoIdx] = copy; else chips.push(copy);
          cellTokens[key] = chips;
          saveTokens(player, phase);
        }
      } else if (autoIdx !== -1) {
        chips.splice(autoIdx, 1);
        cellTokens[key] = chips;
        saveTokens(player, phase);
      }
    }
  }
}

function renderNotesGrid() {
  if (!currentState?.players?.length) return;

  // Skip rebuild if popover note textarea is focused
  if (document.activeElement?.classList.contains('tp-note-input')) return;
  if (document.activeElement?.classList.contains('notes-label-input')) return;
  if (document.activeElement?.dataset?.player) return;

  const phases = getPhaseColumns();
  const cols = getNotesColumns();
  const players = currentState.players;

  const extraRows = extraNoteRows();
  const key = JSON.stringify([players.map(p => [p.name, p.team, p.isDead]), phases, mergePhases, extraRows]);
  if (key === lastNotesKey) return;
  lastNotesKey = key;

  propagateDroison(); // stamp/refresh inherited "from now on" droison copies

  const table = document.getElementById('notes-table');

  // The Player / Role / Align columns are sized to their content: whenever that
  // content can change (names, script roles) the grid is first laid
  // out automatically, measured, and rebuilt with those widths fixed — all
  // before the browser paints, so only the final layout is ever seen.
  const fixedKey = JSON.stringify([players.map(p => p.name), (currentState.roles ?? []).map(r => r.id)]);
  const measuring = !notesFixedColWidths || fixedKey !== notesFixedKey;
  const w = measuring ? null : notesFixedColWidths;
  const minPhaseWidth = 200;

  let html = '';
  if (w) {
    const fixedTotal = w.player + w.role + w.align;
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
    table.style.minWidth = (fixedTotal + cols.length * minPhaseWidth) + 'px';
    html += '<colgroup>';
    html += `<col style="width:${w.player}px">`;
    html += `<col style="width:${w.role}px">`;
    html += `<col style="width:${w.align}px">`;
    for (let i = 0; i < cols.length; i++) html += '<col>';
    html += '</colgroup>';
  } else {
    table.style.tableLayout = '';
    table.style.width = 'auto';
    table.style.minWidth = '';
  }

  html += '<thead><tr>';
  html += `<th class="notes-player-col">Player</th>`;
  html += `<th class="notes-meta-col">Role</th>`;
  html += `<th class="notes-meta-col notes-align-col">Align</th>`;
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const epoch = i % 2 === 0 ? ' epoch-start' : '';
    html += `<th class="notes-phase-col ${col.cls}${epoch}">${esc(col.label)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const player of players) {
    const name = notesNameOf(player);
    const isTraveller = player.team === 'traveller';

    const meta = playerMeta[name] ?? {};
    const color = metaNameColor(name);
    const tint = metaRowTint(name);
    const dead = player.isDead ? ' dead' : '';
    const usedGhostVote = player.isDead && fullTimeline.some(ev => ev.type === 'ghostvote' && ev.name === name);
    const statusIcons = measuring ? `<span class="pn-status-icon">${ICON_SVG.logSkull}</span><span class="pn-status-icon">${ICON_SVG.logGhost}</span>` : ((player.isDead ? `<span class="pn-status-icon pn-dead" title="Dead">${ICON_SVG.logSkull}</span>` : '')
                      + (usedGhostVote ? `<span class="pn-status-icon pn-voteless" title="Used ghost vote">${ICON_SVG.logGhost}</span>` : ''));
    const roleHtml = metaRoleChipHtml(meta);
    const alignHtml = metaAlignBadgeHtml(meta);
    const tintStyle = tint ? `background:${tint}` : '';
    const nameTintStyle = tint ? `background-image:linear-gradient(${tint},${tint})` : '';
    html += `<tr style="${tintStyle}">`;
    const pinned = pinnedPlayers.has(name);
    html += `<td class="notes-player-name${dead}" data-player="${esc(name)}" style="${color ? `color:${color};` : ''}${nameTintStyle}"><button class="pin-hl-btn${pinned ? ' pinned' : ''}" data-pin="${esc(name)}" title="Pin highlight" aria-label="Pin highlight">${ICON_SVG.pin}</button><span class="notes-player-name-text">${esc(dn(name))}</span>${statusIcons}</td>`;
    const roleLocked = isTraveller ? ' role-locked' : '';
    html += `<td class="notes-meta-cell notes-meta-role${roleLocked}" data-player="${esc(name)}">${roleHtml}</td>`;
    html += `<td class="notes-meta-cell notes-meta-align" data-player="${esc(name)}">${alignHtml}</td>`;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const epoch = i % 2 === 0 ? ' epoch-start' : '';
      const chips = cellChipsHtml(name, col.phases);
      const ccId = cellColorId(name, col.phases);
      const stId = statusTagId(name, col.phases);
      const ccClass = (ccId ? ` cc-cell-${ccId}` : '') + (stId ? ` st-cell-${stId}` : '');
      html += `<td class="notes-cell${epoch}${ccClass}" data-player="${esc(name)}" data-col="${esc(col.key)}" data-phase="${esc(col.addPhase)}">
        <div class="cell-chips">${chips}</div>
      </td>`;
    }
    html += '</tr>';
  }

  html += '</tbody>';
  table.innerHTML = html;
  initNotesTableEvents(table);
  if (!measuring) renderRoleNotesTable(cols, w, extraRows);

  if (measuring) {
    // Hidden (e.g. ST view on load) → everything measures 0. Wait until the
    // grid is shown; applyViewRole re-renders it then.
    const ths = table.querySelectorAll('thead tr th');
    if (table.offsetParent && ths.length >= 3) {
      const prev = notesFixedColWidths ?? { player: 0, role: 0, align: 0 };
      notesFixedColWidths = {
        player: Math.max(prev.player, Math.ceil(ths[0].getBoundingClientRect().width)),
        role: Math.max(prev.role, Math.ceil(ths[1].getBoundingClientRect().width), measureMaxRoleChipWidth()),
        align: Math.max(prev.align, Math.ceil(ths[2].getBoundingClientRect().width)),
      };
      notesFixedKey = fixedKey;
      lastNotesKey = null;
      renderNotesGrid();
      return;
    }
  }

  table.querySelectorAll('.notes-meta-role:not(.role-locked)').forEach(cell => {
    cell.addEventListener('click', () => openRolePopover(cell.dataset.player, cell));
  });

  table.querySelectorAll('.notes-meta-align').forEach(cell => {
    cell.addEventListener('click', () => toggleAlignment(cell.dataset.player));
  });

  table.querySelectorAll('.pin-hl-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.pin;
      if (pinnedPlayers.has(name)) pinnedPlayers.delete(name);
      else pinnedPlayers.add(name);
      btn.classList.toggle('pinned', pinnedPlayers.has(name));
      applyPinnedHighlights();
    });
  });


  table.querySelectorAll('.notes-cell').forEach(cell => cell.addEventListener('click', onNotesCellClick));

  applyHighlights(); applyPinnedHighlights();
}

// The role-notes table: same phase columns as the player grid, lined up with it
// (its single Role column is as wide as Player + Role + Align together), and
// hidden entirely while there are no rows.
function renderRoleNotesTable(cols, w, rows) {
  const table = document.getElementById('role-notes-table');
  table.style.display = rows.length ? '' : 'none';
  if (!rows.length) { table.innerHTML = ''; return; }
  const main = document.getElementById('notes-table');
  table.style.tableLayout = 'fixed';
  table.style.width = main.style.width;
  table.style.minWidth = main.style.minWidth;

  let html = `<colgroup><col style="width:${w.player + w.role + w.align}px">${'<col>'.repeat(cols.length)}</colgroup>`;
  html += '<thead><tr><th class="notes-player-col">Role / topic</th>';
  cols.forEach((col, i) => {
    html += `<th class="notes-phase-col ${col.cls}${i % 2 === 0 ? ' epoch-start' : ''}">${esc(col.label)}</th>`;
  });
  html += '</tr></thead><tbody>';
  for (const owner of rows) {
    const role = noteRowRole(owner);
    const o = esc(owner);
    const icon = role && _iconUrl(role) ? `<img class="tp-role-icon" src="${esc(_iconUrl(role))}" />` : '';
    const label = role
      ? `<span class="meta-role-chip role-name ${role.team ?? ''}">${icon}${esc(role.name)}</span>`
      : `<span class="notes-custom-label" title="Click to rename">${esc(noteRowLabel(owner))}</span>`;
    const assign = `<button type="button" class="notes-assign-btn" title="Found out who it is? Move these notes to that player">assign</button>`;
    html += `<tr><td class="notes-player-name notes-row-label" data-row="${o}"><div class="notes-row-label-inner">${label}<span class="notes-row-actions">${assign}<button type="button" class="notes-row-remove" title="Remove this row" aria-label="Remove this row">×</button></span></div></td>`;
    cols.forEach((col, i) => {
      const ccId = cellColorId(owner, col.phases);
      html += `<td class="notes-cell${i % 2 === 0 ? ' epoch-start' : ''}${ccId ? ` cc-cell-${ccId}` : ''}" data-player="${o}" data-col="${esc(col.key)}" data-phase="${esc(col.addPhase)}">
        <div class="cell-chips">${cellChipsHtml(owner, col.phases)}</div>
      </td>`;
    });
    html += '</tr>';
  }
  table.innerHTML = html + '</tbody>';
  initNotesTableEvents(table);
  table.querySelectorAll('.notes-cell').forEach(cell => cell.addEventListener('click', onNotesCellClick));
}

// Swap a free-text row label for an input: Enter / clicking away saves, Esc cancels.
function renameNoteRow(owner, labelEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'notes-label-input';
  input.value = noteRowLabel(owner);
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const text = input.value.trim();
    const meta = playerMeta[NOTE_ROWS_KEY] ?? {};
    input.blur();
    if (save && text) saveExtraNoteRows(meta.rows ?? [], { ...(meta.labels ?? {}), [owner]: text });
    else { lastNotesKey = null; renderNotesGrid(); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function onNotesCellClick(e) {
  const cell = e.currentTarget;
  const chip = e.target.closest('.token-chip[data-idx]');
  if (chip && e.target.closest('.chip-x')) {
    e.stopPropagation(); // the chip is about to leave the DOM — don't let the click read as a name click
    closePopover();
    removeChip(cell.dataset.player, chip.dataset.phase, Number(chip.dataset.idx));
  } else if (chip) {
    // Edit the chip in its own phase (a merged cell may mix Night & Day chips).
    openPopover(cell.dataset.player, chip.dataset.phase, cell, Number(chip.dataset.idx));
  } else {
    openPopover(cell.dataset.player, cell.dataset.phase, cell, null);
  }
}

// Listeners that live on the table itself (it survives every rebuild): the
// extra-row controls and dragging chips between cells.
let _dragChip = null;
function initNotesTableEvents(table) {
  if (table._eventsReady) return;
  table._eventsReady = true;

  table.addEventListener('click', (e) => {
    const assign = e.target.closest('.notes-assign-btn');
    if (assign) { openAssignNoteRowPicker(assign.closest('[data-row]').dataset.row, assign); return; }
    const custom = e.target.closest('.notes-custom-label');
    if (custom) { renameNoteRow(custom.closest('[data-row]').dataset.row, custom); return; }
    const remove = e.target.closest('.notes-row-remove');
    if (remove) removeExtraNoteRow(remove.closest('[data-row]').dataset.row);
  });

  const clearDrop = () => document.querySelectorAll('.notes-scroll .drop-target').forEach(c => c.classList.remove('drop-target'));
  table.addEventListener('dragstart', (e) => {
    const chip = e.target.closest?.('.token-chip[data-idx][draggable]');
    if (!chip) return;
    closePopover();
    _dragChip = { player: chip.dataset.player, phase: chip.dataset.phase, idx: Number(chip.dataset.idx) };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', chip.textContent ?? '');
  });
  table.addEventListener('dragover', (e) => {
    const cell = _dragChip && e.target.closest?.('.notes-cell');
    if (!cell) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!cell.classList.contains('drop-target')) { clearDrop(); cell.classList.add('drop-target'); }
  });
  table.addEventListener('drop', (e) => {
    const cell = _dragChip && e.target.closest?.('.notes-cell');
    if (!cell) return;
    e.preventDefault();
    const from = _dragChip;
    _dragChip = null;
    clearDrop();
    moveChip(from, cell.dataset.player, cell);
  });
  table.addEventListener('dragend', () => { _dragChip = null; clearDrop(); });
}

// ── ST Panel ──────────────────────────────────────────────────────────────

const SIGNAL_TOKEN_DEFS = [
  { id: 'you',        label: 'You are',                       cls: '' },
  { id: 'good',       label: 'good',                          cls: 'sig-chip-good' },
  { id: 'evil',       label: 'evil',                          cls: 'sig-chip-evil' },
  { id: 'yes',        label: 'yes',                           cls: 'sig-chip-yes' },
  { id: 'no',         label: 'no',                            cls: 'sig-chip-no' },
  { id: 'acknowledge',label: '👍',                            cls: '' },
  { id: 'ability',    label: 'Use your ability?',             cls: '' },
  { id: 'choice',     label: 'Make a choice!',                cls: '' },
  { id: 'bluffs',     label: 'Bluffs:',                       cls: '' },
  { id: 'demon',      label: 'Demon is',                      cls: 'sig-chip-evil' },
  { id: 'minions',    label: 'Minions are',                   cls: 'sig-chip-evil' },
  { id: 'claim',      label: 'This player is',                cls: '' },
  { id: 'selected',   label: 'This character selected you',   cls: '' },
  { id: 'zero',       label: '0',                             cls: 'sig-chip-num' },
  { id: 'one',        label: '1',                             cls: 'sig-chip-num' },
  { id: 'two',        label: '2',                             cls: 'sig-chip-num' },
  { id: 'three',      label: '3',                             cls: 'sig-chip-num' },
  { id: 'four',       label: '4',                             cls: 'sig-chip-num' },
  { id: 'five',       label: '5',                             cls: 'sig-chip-num' },
  { id: 'grimoire',   label: 'Grimoire Snapshot',             cls: '' },
  { id: 'neutral',    label: 'neutral',                       cls: '' },
  { id: 'clockwise',  label: 'clockwise',                     cls: '' },
  { id: 'anticlockwise', label: 'anticlockwise',              cls: '' },
  // Placeholders, filled in per recipient at send time (see expandOwnTokens) —
  // so one "You are …" can go to several players, each getting their own.
  { id: 'own-align',  label: 'their alignment',               cls: 'sig-chip-own' },
  { id: 'own-role',   label: 'their role',                    cls: 'sig-chip-role sig-chip-own' },
];

const OWN_TOKEN_IDS = new Set(['own-align', 'own-role']);

// The message as one recipient should get it: "their alignment"/"their role"
// become that player's actual alignment and role (dropped if unknown).
function expandOwnTokens(message, player) {
  return message.flatMap(t => {
    if (t.id === 'own-align') {
      const ge = player ? impliedAlignmentGE(player) : null;
      return ge ? [{ id: ge === 'e' ? 'evil' : 'good' }] : [];
    }
    if (t.id === 'own-role') {
      const role = scriptRoleId(player?.roleId);
      return role ? [{ id: 'role', data: role }] : [];
    }
    return [t];
  });
}

// Split into "self report" (You are evil, role X, Bluffs: ...) and "other
// player report" (This player is X, Demon is Y) — these two sets are rarely
// mixed in the same signal, so they get their own column each; everything
// else (yes/no/numbers/prompts) is general-purpose and sits below both.
const SIGNAL_TOKEN_COLUMNS = {
  left: ['you',  'selected', 'good', 'evil', 'bluffs'],
  right: ['claim', 'demon', 'minions'],
  center: ['ability', 'choice', 'yes', 'no', 'acknowledge', 'zero', 'one', 'two', 'three', 'four', 'five'],
};

function signalTokenDef(id) {
  return SIGNAL_TOKEN_DEFS.find(d => d.id === id);
}

function signalTokenLabel(token) {
  if (token.id === 'role') return currentState?.roles?.find(r => r.id === token.data)?.name ?? token.data;
  if (token.id === 'player') {
    const p = currentState?.players?.find(p => p.seat === token.data);
    return dn(displayName(p, token.data));
  }
  if (token.id === 'custom') return token.data;
  return signalTokenDef(token.id)?.label ?? token.id;
}

function signalTokenCls(token) {
  if (token.id === 'role')   return 'sig-chip sig-chip-role';
  if (token.id === 'player') return 'sig-chip sig-chip-player';
  if (token.id === 'custom') return 'sig-chip sig-chip-custom';
  const cls = signalTokenDef(token.id)?.cls ?? '';
  return ('sig-chip ' + cls).trim();
}

function renderSignalPreview() {
  const el = document.getElementById('signal-preview');
  if (!el) return;
  const clearBtn = document.getElementById('signal-clear-btn');
  if (clearBtn) clearBtn.hidden = !stMessage.length;
  if (!stMessage.length) {
    el.innerHTML = '<span class="sig-empty">Pick phrases below to build the message</span>';
  } else {
    el.innerHTML = stMessage.map((t, i) =>
      `<span class="${signalTokenCls(t)}">${esc(signalTokenLabel(t))}<button class="sig-chip-remove" data-idx="${i}" aria-label="Remove">×</button></span>`
    ).join('');
    el.querySelectorAll('.sig-chip-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        stMessage.splice(Number(btn.dataset.idx), 1);
        renderSignalPreview();
        updateSignalSendBtn();
      });
    });
  }
}

function updateSignalSendBtn() {
  const btn = document.getElementById('signal-send-btn');
  if (btn) btn.disabled = !stMessage.length || !stRecipientIds.size;
  renderSignalSuggestions();
}

// ── Signal suggestions — what usually follows the phrase just added ────────
// "You are" → the recipient's alignment and role, "Bluffs:" → the demon
// bluffs, "This player is" → a player, then their role, "Demon is" /
// "Minions are" → whoever holds those roles. Each suggestion appends one or
// more tokens, so the common message is a click or two.

// A grimoire/bluff role id, as the id this game's script uses (what role
// tokens carry) — null if it isn't on the script.
function scriptRoleId(id) {
  if (!id) return null;
  const roles = currentState?.roles ?? [];
  const norm = _normalizeId(id);
  return (roles.find(r => r.id === id) ?? roles.find(r => _normalizeId(r.id) === norm))?.id ?? null;
}

// Tonight's night-order steps for one player, as Signal suggestions.
function nightStepSuggestions(player) {
  const phase = currentState?.phase ?? 0;
  if (phase % 2 !== 1) return [];
  const prefix = `${stepGameKey()}|${Math.ceil(phase / 2)}|`;
  const out = [];
  for (const key of Object.keys(nightSteps)) {
    if (!key.startsWith(prefix)) continue;
    const c = nightStepCtx(key);
    if (!c || c.player.seat !== player.seat || c.step.stOnly) continue;
    const hint = NIGHT_INFO_NAMES[c.bundledId] ?? scriptRoleFor(c.bundledId).name;
    if (c.action.wake === 'choice' || c.action.wake === 'ability' || c.action.ask) {
      const ask = c.action.ask ? resolveTemplate(c.action.ask, c).tokens : [{ id: c.action.wake }];
      out.push({ label: ask.map(signalTokenLabel).join(' + '), hint, cls: 'night', tokens: ask });
    }
    const answer = stepAnswer(c, true);
    if (answer.tokens.length && !answer.missing) {
      out.push({ label: answer.tokens.map(signalTokenLabel).join(' · '), hint, cls: 'night', tokens: answer.tokens });
    }
  }
  return out;
}

function signalSuggestions() {
  const players = (currentState?.players ?? []).slice().sort((a, b) => a.seat - b.seat);
  const roleOf = (p) => scriptRoleId(p?.roleId);
  const roleName = (id) => currentState?.roles?.find(r => r.id === id)?.name ?? id;
  const teamOf = (p) => currentState?.roles?.find(r => r.id === roleOf(p))?.team ?? p.team ?? '';
  const playerName = (p) => dn(displayName(p, p.seat));
  const playerTok = (p) => ({ id: 'player', data: p.seat });
  const roleTok = (id) => ({ id: 'role', data: id });
  const recipient = stRecipientIds.size === 1
    ? players.find(p => String(p.id) === [...stRecipientIds][0])
    : null;

  // The last phrase in the message, and the players/roles added after it.
  let k = stMessage.length - 1;
  while (k >= 0 && (stMessage[k].id === 'player' || stMessage[k].id === 'role')) k--;
  const kw = stMessage[k]?.id;
  const tail = stMessage.slice(k + 1);
  const tailSeats = tail.filter(t => t.id === 'player').map(t => t.data);
  const tailRoles = tail.filter(t => t.id === 'role').map(t => t.data);
  const out = [];

  // Nothing written yet for one player: tonight's night-order step(s) for
  // them — the prompt, and the answer as the step has it (grimoire reminders,
  // their reply and suggestions already worked in).
  if (!stMessage.length && recipient) out.push(...nightStepSuggestions(recipient));

  if (kw === 'you' && !tail.length && stRecipientIds.size > 1) {
    out.push({ label: 'their alignment & role', cls: 'own', tokens: [{ id: 'own-align' }, { id: 'own-role' }] });
    out.push({ label: 'their alignment', cls: 'own', tokens: [{ id: 'own-align' }] });
    out.push({ label: 'their role', cls: 'own', tokens: [{ id: 'own-role' }] });
  } else if (kw === 'own-align' && stMessage[k - 1]?.id === 'you' && !tail.length) {
    out.push({ label: 'their role', cls: 'own', tokens: [{ id: 'own-role' }] });
  } else if (kw === 'you' && !tail.length && recipient) {
    const align = impliedAlignmentGE(recipient) === 'e' ? 'evil' : impliedAlignmentGE(recipient) === 'g' ? 'good' : null;
    const role = roleOf(recipient);
    if (align && role) out.push({ label: `${align} ${roleName(role)}`, cls: align, tokens: [{ id: align }, roleTok(role)] });
    if (align) out.push({ label: align, cls: align, tokens: [{ id: align }] });
    if (role) out.push({ label: roleName(role), cls: 'role', tokens: [roleTok(role)] });
  } else if ((kw === 'good' || kw === 'evil') && stMessage[k - 1]?.id === 'you' && !tail.length && recipient) {
    const role = roleOf(recipient);
    if (role) out.push({ label: roleName(role), cls: 'role', tokens: [roleTok(role)] });
  } else if (kw === 'bluffs') {
    const bluffs = [...new Set((currentState?.bluffs ?? [])
      .map(b => scriptRoleId(typeof b === 'string' ? b : b?.id)).filter(Boolean))]
      .filter(id => !tailRoles.includes(id));
    if (bluffs.length > 1) out.push({ label: bluffs.map(roleName).join(', '), cls: 'role', tokens: bluffs.map(roleTok) });
    bluffs.forEach(id => out.push({ label: roleName(id), cls: 'role', tokens: [roleTok(id)] }));
  } else if (kw === 'demon' || kw === 'minions') {
    const team = kw === 'demon' ? 'demon' : 'minion';
    const holders = players.filter(p => teamOf(p) === team && !tailSeats.includes(p.seat));
    if (holders.length > 1) out.push({ label: holders.map(playerName).join(', '), cls: 'evil', tokens: holders.map(playerTok) });
    holders.forEach(p => out.push({ label: playerName(p), cls: 'player', tokens: [playerTok(p)] }));
  } else if (kw === 'claim') {
    // "This player is" X [and Y] — then the role of one of them.
    if (!tailRoles.length) {
      tailSeats.forEach(seat => {
        const p = players.find(x => x.seat === seat);
        const role = roleOf(p);
        if (role) out.push({ label: roleName(role), hint: playerName(p), cls: 'role', tokens: [roleTok(role)] });
      });
    }
    if (tailSeats.length < 2 && !tailRoles.length) {
      // Players carrying the recipient's role reminders (e.g. the
      // Washerwoman's Townsfolk / Wrong) first, labelled with the reminder.
      const recipRole = recipient && bundledRoleOf(recipient);
      const reminderOf = (p) => recipRole && (p.reminders ?? []).find(r => _normalizeId(r.role ?? '') === recipRole && !(r.flags ?? []).includes('flipped'))?.name;
      players
        .filter(p => !tailSeats.includes(p.seat) && p !== recipient)
        .sort((a, b) => (reminderOf(a) ? 0 : 1) - (reminderOf(b) ? 0 : 1))
        .forEach(p => out.push({ label: playerName(p), hint: reminderOf(p) || undefined, cls: 'player', dead: p.isDead, tokens: [playerTok(p)] }));
    }
  }
  return out;
}

function renderSignalSuggestions() {
  const el = document.getElementById('signal-suggest');
  if (!el) return;
  const items = signalSuggestions();
  el.hidden = !items.length;
  el.innerHTML = items.map((s, i) =>
    `<button type="button" class="sig-suggest-btn sig-suggest-${s.cls}${s.dead ? ' sig-suggest-dead' : ''}" data-i="${i}">`
    + `${esc(s.label)}${s.hint ? `<span class="sig-suggest-hint">${esc(s.hint)}</span>` : ''}</button>`
  ).join('');
  el.querySelectorAll('.sig-suggest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stMessage.push(...items[Number(btn.dataset.i)].tokens.map(t => ({ ...t })));
      renderSignalPreview();
      updateSignalSendBtn();
    });
  });
}

// Signals aren't normally sent during the day, but if one is, attribute it to
// the preceding night (same round) rather than giving Day its own group.
function signalNightGroup(ts) {
  const label = gamePhaseAt(ts);
  return label.startsWith('Day ') ? 'Night ' + label.slice(4) : label;
}

function getPlayerSignalEntries(userId) {
  const list = currentState?.signals?.[userId] ?? [];
  return [...list].sort((a, b) => a.timestamp - b.timestamp);
}

// Entries are expected time-ordered — consecutive same-night entries form
// contiguous chunks, so no separate sort is needed here.
function groupSignalEntriesByNight(entries) {
  const nightGroups = [];
  for (const e of entries) {
    const night = signalNightGroup(e.timestamp);
    const last = nightGroups[nightGroups.length - 1];
    if (last && last.night === night) last.entries.push(e);
    else nightGroups.push({ night, entries: [e] });
  }
  return nightGroups;
}

function renderSignalNightGroupsHtml(nightGroups) {
  return nightGroups.map(ng => {
    const rows = ng.entries.map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const dir = e.isInbound ? '←' : '→';
      const tokens = (e.message ?? []).map(t => `<span class="${signalTokenCls(t)}">${esc(signalTokenLabel(t))}</span>`).join('');
      return `<li class="sig-log-row${e.isInbound ? ' sig-log-inbound' : ''}">
        <span class="sig-log-time">${time}</span>
        <span class="sig-log-dir">${dir}</span>
        <span class="sig-log-tokens">${tokens}</span>
      </li>`;
    }).join('');
    return `<div class="sig-log-night">
      <div class="sig-log-night-label">${esc(ng.night)}</div>
      <ul class="sig-log-rows">${rows}</ul>
    </div>`;
  }).join('');
}

// ── Signal history popover (night order rows: one player, one night) ────────

let _sigPop = null;

function getSignalPopover() {
  if (_sigPop) return _sigPop;
  _sigPop = document.createElement('div');
  _sigPop.id = 'signal-popover';
  document.body.appendChild(_sigPop);
  document.addEventListener('mousedown', (e) => {
    if (_sigPop.style.display !== 'none' && !_sigPop.contains(e.target) && !e.target.closest('.sig-hist-holder')) {
      _sigPop.style.display = 'none';
    }
  });
  return _sigPop;
}

function closeSignalPopover() {
  if (_sigPop) _sigPop.style.display = 'none';
}

// night: a "Night N" label.
function openSignalPopover(userId, anchorEl, night) {
  const pop = getSignalPopover();
  const entries = getPlayerSignalEntries(userId).filter(e => signalNightGroup(e.timestamp) === night);
  const title = `${dn(resolveParticipant(userId))} — ${night}`;
  const body = entries.length
    ? renderSignalNightGroupsHtml([{ night, entries }])
    : '<div class="sig-log-empty">No signals</div>';
  pop.innerHTML = `<div class="sig-pop-title">${esc(title)}</div><div class="sig-pop-body">${body}</div>`;
  pop.style.display = 'block';
  placePopover(pop, anchorEl, 4);
}

// ── Signal history sidebar (whole history — can get long, so it gets the same
// slide-out side panel treatment as the player event timeline), all players.

// session.signals is keyed by recipient — "storyteller" mirrors outbound-only
// signals (a convenience subset), while each real user id holds the full
// two-way conversation with that player. Skip the mirror key to avoid
// double-counting the same signal.
function buildAllPlayersSignalHtml() {
  const signals = currentState?.signals ?? {};
  const byPlayer = Object.keys(signals)
    .filter(userId => userId !== 'storyteller')
    .map(userId => ({ userId, name: resolveParticipant(userId), entries: getPlayerSignalEntries(userId) }))
    .filter(g => g.entries.length)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!byPlayer.length) return '<div class="sig-log-empty">No signals yet</div>';

  return byPlayer.map(g => `<div class="sig-log-group">
    <div class="sig-log-player">${esc(dn(g.name))}</div>
    ${renderSignalNightGroupsHtml(groupSignalEntriesByNight(g.entries))}
  </div>`).join('');
}

let signalHistoryOpen = false;
function openSignalHistoryPanel() {
  signalHistoryOpen = true;
  const panel = document.getElementById('signal-history-panel');
  const overlay = document.getElementById('signal-history-overlay');
  document.getElementById('sighist-name').textContent = 'Signal History';
  document.getElementById('sighist-body').innerHTML = buildAllPlayersSignalHtml();
  overlay.classList.add('open');
  panel.classList.add('open');
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeSignalHistoryPanel() {
  signalHistoryOpen = false;
  document.getElementById('signal-history-panel').classList.remove('open');
  const overlay = document.getElementById('signal-history-overlay');
  overlay.classList.remove('visible');
  // Reopened before the fade ended: leave the new one alone.
  overlay.addEventListener('transitionend', () => { if (!signalHistoryOpen) overlay.classList.remove('open'); }, { once: true });
}

function refreshSignalHistoryPanel() {
  if (signalHistoryOpen) openSignalHistoryPanel();
}

document.getElementById('sighist-close').addEventListener('click', closeSignalHistoryPanel);
document.getElementById('signal-history-overlay').addEventListener('click', closeSignalHistoryPanel);

// ── Interactions ──
// Pick one or two characters and read how they interact: official jinxes,
// how-to-run notes and researched rulings, all bundled in data/interactions.js.
// One character picked lists everything recorded for it, grouped by partner.
const _interactions = () => (typeof BOTC_INTERACTIONS !== 'undefined' ? BOTC_INTERACTIONS : []);
const IX_KIND_ORDER = { jinx: 0, notes: 1, web: 2 };
const IX_KIND_LABEL = { jinx: 'Jinx', notes: 'How to run', web: 'Ruling' };
const IX_SOURCE_LABELS = [
  [/wiki\.bloodontheclocktower\.com\/Djinn/, 'Djinn jinx list'],
  [/wiki\.bloodontheclocktower\.com/, 'Official wiki'],
  [/docs\.google\.com\/document\/d\/17hcUxGqjGP0nlxNdPS9eM696lu0GUI84TENcT15Tr6U/, 'TPI how-to-run archive'],
  [/bakerybytheclocktower/, 'Bakery by the Clocktower'],
  [/bloodontheclocktower\.com\/blogs/, 'TPI blog'],
  [/reddit\.com/, 'Reddit'],
  [/discord\.com\/channels\/569683781800296501\/806885179389640757/, '#experimental-how-to-run'],
  [/discord\.com/, 'Discord'],
  [/boardgamegeek\.com/, 'BoardGameGeek'],
];
const ixPicked = [null, null];
let interactionsOpen = false;

const ixRole = (id) => _roles().find(r => r.id === id);
const ixRoleName = (id) => ixRole(id)?.name ?? id;

function ixEntriesFor(a, b) {
  return _interactions()
    .filter(e => (e.a === a && (!b || e.b === b)) || (e.b === a && (!b || e.a === b)))
    .sort((x, y) => (IX_KIND_ORDER[x.kind] ?? 9) - (IX_KIND_ORDER[y.kind] ?? 9));
}

function ixSourceHtml(e) {
  const src = e.source ?? '';
  if (/^https?:\/\//.test(src)) {
    const label = IX_SOURCE_LABELS.find(([re]) => re.test(src))?.[1]
      ?? src.replace(/^https?:\/\/(www\.)?([^/]+).*/, '$2');
    return `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer" title="${esc(src)}">${esc(label)}</a>`;
  }
  return esc(src);
}

function ixEntryHtml(e) {
  const official = e.official ? '<span class="ix-official">official</span>' : '';
  const year = e.date ? ` · ${esc(String(e.date).slice(0, 4))}` : '';
  const author = e.author ? `<span class="ix-author">${esc(e.author)}${e.staff ? ' (TPI)' : ''}${year}</span>` : '';
  return `<div class="ix-entry ix-${esc(e.kind)}">
    <div class="ix-entry-head"><span class="ix-kind">${esc(e.derived ? 'Derived' : IX_KIND_LABEL[e.kind] ?? e.kind)}</span>${official}${author}<span class="ix-source">${ixSourceHtml(e)}</span></div>
    <div class="ix-text">${esc(e.text)}</div>
  </div>`;
}

function ixRoleHeadHtml(id) {
  const r = ixRole(id);
  const icon = _iconUrl(r);
  return `<span class="ix-role role-name ${esc(r?.team ?? '')}">${icon ? `<img class="tp-role-icon" src="${esc(icon)}" alt="" />` : ''}${esc(ixRoleName(id))}</span>`;
}

function renderInteractions() {
  document.querySelectorAll('#ix-pickers .ix-slot').forEach(btn => {
    const id = ixPicked[Number(btn.dataset.slot)];
    btn.innerHTML = id ? ixRoleHeadHtml(id) : '<span class="ix-placeholder">Pick a character</span>';
  });
  const body = document.getElementById('ix-body');
  const [a, b] = ixPicked.filter(Boolean).length === 1 ? [ixPicked.find(Boolean), null] : ixPicked;
  if (!a) {
    body.innerHTML = `<div class="ix-empty">Pick two characters to see how they interact, or one to list everything recorded for it.</div>`;
    return;
  }
  const abilities = [a, b].filter(Boolean).map(id => {
    const r = ixRole(id);
    return r?.ability ? `<div class="ix-ability"><b>${esc(r.name)}:</b> ${esc(r.ability)}</div>` : '';
  }).join('');
  if (b) {
    const entries = ixEntriesFor(a, b);
    body.innerHTML = abilities + (entries.length
      ? entries.map(ixEntryHtml).join('')
      : `<div class="ix-empty">Nothing recorded between ${esc(ixRoleName(a))} and ${esc(ixRoleName(b))}. Their abilities work as written.</div>`);
    return;
  }
  // One character: everything recorded for it, grouped by partner.
  const byPartner = new Map();
  for (const e of ixEntriesFor(a)) {
    const other = e.a === a ? e.b : e.a;
    if (!byPartner.has(other)) byPartner.set(other, []);
    byPartner.get(other).push(e);
  }
  const groups = [...byPartner.entries()].sort((x, y) => {
    const jx = x[1].some(e => e.kind === 'jinx'), jy = y[1].some(e => e.kind === 'jinx');
    return (jy - jx) || ixRoleName(x[0]).localeCompare(ixRoleName(y[0]));
  });
  body.innerHTML = abilities + (groups.length
    ? `<div class="ix-count">${groups.length} character${groups.length === 1 ? '' : 's'} with recorded interactions</div>` +
      groups.map(([other, list]) => `<div class="ix-group">
        <button type="button" class="ix-partner" data-id="${esc(other)}" title="Show only this pair">${ixRoleHeadHtml(other)}${list.some(e => e.kind === 'jinx') ? '<span class="ix-jinx-dot">jinx</span>' : ''}</button>
        ${list.map(ixEntryHtml).join('')}
      </div>`).join('')
    : `<div class="ix-empty">Nothing recorded for ${esc(ixRoleName(a))}.</div>`);
}

function openInteractionsPicker(slot, anchorEl) {
  const counts = {};
  for (const e of _interactions()) { counts[e.a] = (counts[e.a] ?? 0) + 1; counts[e.b] = (counts[e.b] ?? 0) + 1; }
  const items = _roles().map(r => ({
    label: r.name, value: r.id, cls: `role-name ${r.team ?? ''}`, iconUrl: _iconUrl(r) ?? '',
    sub: counts[r.id] ? String(counts[r.id]) : '',
  }));
  openListPicker(anchorEl, items, (id) => { ixPicked[slot] = id; renderInteractions(); }, {
    placeholder: 'Search characters…',
    activeValue: ixPicked[slot],
    clearLabel: ixPicked[slot] ? 'Clear' : undefined,
    onClear: () => { ixPicked[slot] = null; renderInteractions(); },
  });
}

function openInteractionsPanel() {
  interactionsOpen = true;
  const overlay = document.getElementById('interactions-overlay');
  renderInteractions();
  overlay.classList.add('open');
  document.getElementById('interactions-panel').classList.add('open');
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeInteractionsPanel() {
  interactionsOpen = false;
  closeListPicker();
  document.getElementById('interactions-panel').classList.remove('open');
  const overlay = document.getElementById('interactions-overlay');
  overlay.classList.remove('visible');
  overlay.addEventListener('transitionend', () => { if (!interactionsOpen) overlay.classList.remove('open'); }, { once: true });
}

document.getElementById('interactions-btn').addEventListener('click', openInteractionsPanel);
document.getElementById('ix-close').addEventListener('click', closeInteractionsPanel);
document.getElementById('interactions-overlay').addEventListener('click', closeInteractionsPanel);
document.querySelectorAll('#ix-pickers .ix-slot').forEach(btn =>
  btn.addEventListener('click', () => openInteractionsPicker(Number(btn.dataset.slot), btn)));
document.getElementById('ix-swap').addEventListener('click', () => { ixPicked.reverse(); renderInteractions(); });
document.getElementById('ix-body').addEventListener('click', (e) => {
  const partner = e.target.closest('.ix-partner');
  if (!partner) return;
  const a = ixPicked.find(Boolean);
  ixPicked[0] = a; ixPicked[1] = partner.dataset.id;
  renderInteractions();
});

function renderSignalPlayers() {
  const list = document.getElementById('signal-player-list');
  if (!list || !currentState) return;

  const players = (currentState.players ?? []).filter(p => p.id);

  list.innerHTML = players.map(p => {
    const name = esc(dn(displayName(p)));
    const checked = stRecipientIds.has(String(p.id)) ? 'checked' : '';
    return `<label class="sig-player-row sig-chip-toggle"><input type="checkbox" data-id="${esc(String(p.id))}" ${checked} />${name}</label>`;
  }).join('');

  list.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) stRecipientIds.add(cb.dataset.id);
      else stRecipientIds.delete(cb.dataset.id);
      const allCheck = document.getElementById('signal-all-check');
      if (allCheck) allCheck.checked = players.length > 0 && stRecipientIds.size === players.length;
      updateSignalSendBtn();
    });
  });



  updateSignalSendBtn();
}

const TIMER_PRESETS = [
  { label: 'Day ends', title: 'Day ends', minutes: 0, seconds: 10, pause: true },
  { label: 'Private conversations', title: 'Private conversations', pause: null, dynamic: 'halfAlive' },
];
let customTimerPresets = []; // [{ id, label, title, minutes, seconds, pause }] — user-saved, persisted in settings
let customSignalPresets = []; // [{ id, message: [{id, data?}, ...] }] — user-saved, persisted in settings

function renderSignalPresets() {
  const wrap = document.getElementById('signal-presets');
  if (!wrap) return;

  // Labeled by its own contents (recomputed live via signalTokenLabel, not a
  // name typed at save time) — so it stays accurate if a referenced role or
  // player's display name changes later, and there's nothing to type/name.
  wrap.innerHTML = customSignalPresets.map((preset, i) => {
    const label = preset.message.map(signalTokenLabel).join(' · ') || '(empty)';
    return `<button type="button" class="timer-preset-btn" data-i="${i}" title="${esc(label)}">${esc(label)}<span class="timer-preset-remove" data-i="${i}">✕</span></button>`;
  }).join('');
  // Nothing saved yet: hide the whole group rather than show an empty state.
  const group = document.getElementById('signal-presets-group');
  if (group) group.hidden = customSignalPresets.length === 0;

  wrap.querySelectorAll('.timer-preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.timer-preset-remove')) return;
      const preset = customSignalPresets[Number(btn.dataset.i)];
      stMessage = preset.message.map(t => ({ ...t }));
      renderSignalPreview();
      updateSignalSendBtn();
    });
  });
  wrap.querySelectorAll('.timer-preset-remove').forEach(x => {
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      customSignalPresets = customSignalPresets.filter((_, i) => i !== Number(x.dataset.i));
      saveSettings();
      renderSignalPresets();
    });
  });
}

function sendSetTimer({ title, minutes, seconds, isPausedDuringVotes }) {
  const duration = (minutes * 60 + seconds) * 1000;
  if (duration <= 0) return;
  timerTrack = { title: title || '', total: duration, startedAt: Date.now() };
  sendBg({ type: 'SET_TIMER', title, duration, isPausedDuringVotes, paused: 0 });
}

// The store only knows when the timer ends, not how long it was. Remember the
// length when we start one; for a timer started elsewhere, the most remaining
// time we've seen stands in for it. Drives the progress bar.
let timerTrack = null; // { title, total, startedAt }

// botc.app's timer: `paused` is 0 while running, or the timestamp the pause
// began. The app only counts it as paused while that's before expiration.
function isTimerPaused(timer) {
  const paused = Number(timer?.paused) || 0;
  return paused > 0 && paused < timer.expiration;
}

const TIMER_DONE_LINGER_MS = 5000;

// Remaining ms of the app's timer, or null when none is running (or it ended
// more than a moment ago).
function timerRemaining(timer) {
  if (!timer?.expiration) return null;
  const now = isTimerPaused(timer) ? Number(timer.paused) : Date.now();
  // botc.app never clears an expired timer from its store — its own widget just
  // stops drawing it 5s after the end. Same here, or "Time's up" stays forever.
  if (now - timer.expiration > TIMER_DONE_LINGER_MS) return null;
  return Math.max(0, timer.expiration - now);
}

function formatMs(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function updateTimerStatus() {
  const el = document.getElementById('timer-status');
  if (!el) return;
  const timer = currentState?.timer;
  const remaining = timerRemaining(timer);
  const startLabel = document.querySelector('#timer-set-btn .timer-start-label');
  if (remaining === null) {
    el.hidden = true;
    if (startLabel) startLabel.textContent = 'Start';
    // Keep a just-started timer's length until the store reports it back.
    if (timerTrack && Date.now() - timerTrack.startedAt > 3000) timerTrack = null;
    return;
  }
  const isPaused = isTimerPaused(timer);
  const isDone = remaining === 0;
  const title = timer.title || '';
  const fresh = timerTrack && Date.now() - timerTrack.startedAt < 3000;
  if (!timerTrack || (!fresh && timerTrack.title !== title) || remaining > timerTrack.total) {
    timerTrack = { title, total: remaining, startedAt: timerTrack?.startedAt ?? 0 };
  }

  el.hidden = false;
  el.classList.toggle('timer-status-done', isDone);
  el.classList.toggle('timer-status-paused', isPaused && !isDone);
  el.querySelector('.timer-status-title').textContent = title || 'Timer';
  el.querySelector('.timer-status-state').textContent = isDone ? 'Time’s up' : isPaused ? 'Paused' : 'Running';
  el.querySelector('.timer-status-left').textContent = formatMs(remaining);
  el.querySelector('.timer-status-bar span').style.transform =
    `scaleX(${timerTrack.total > 0 ? Math.min(1, remaining / timerTrack.total) : 0})`;
  el.querySelector('.timer-clear-label').textContent = isDone ? 'Clear' : 'Stop';
  const pauseBtn = document.getElementById('timer-pause-btn');
  pauseBtn.hidden = isDone;
  if (pauseBtn.dataset.paused !== (isPaused ? '1' : '')) {
    pauseBtn.dataset.paused = isPaused ? '1' : '';
    pauseBtn.querySelector('.timer-pause-label').textContent = isPaused ? 'Resume' : 'Pause';
    pauseBtn.querySelector('.timer-pause-icon').innerHTML = isPaused
      ? '<path d="M7 4v16l13-8z"></path>'
      : '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';
  }
  if (startLabel) startLabel.textContent = 'Start new';
}
setInterval(updateTimerStatus, 250);

function renderTimerPresets() {
  const wrap = document.getElementById('timer-presets');
  if (!wrap) return;
  const alive = (currentState?.players ?? []).filter(p => !p.isDead).length;

  const builtin = TIMER_PRESETS.map(preset => {
    if (preset.dynamic === 'halfAlive') {
      const totalSeconds = Math.round((alive / 2) * 60);
      return { ...preset, minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
    }
    return preset;
  });
  const all = [...builtin.map(p => ({ ...p, custom: false })), ...customTimerPresets.map(p => ({ ...p, custom: true }))];

  wrap.innerHTML = all.map((preset, i) =>
    `<button type="button" class="timer-preset-btn" data-i="${i}">${esc(preset.label)} <span class="timer-preset-time">${preset.minutes}:${String(preset.seconds).padStart(2, '0')}</span>${preset.custom ? '<span class="timer-preset-remove" data-i="' + i + '">✕</span>' : ''}</button>`
  ).join('');

  const applyPreset = (preset) => {
    sendSetTimer({ title: preset.title, minutes: preset.minutes, seconds: preset.seconds, isPausedDuringVotes: preset.pause ?? document.getElementById('timer-pause-votes').checked });
  };

  wrap.querySelectorAll('.timer-preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.timer-preset-remove')) return;
      applyPreset(all[Number(btn.dataset.i)]);
    });
  });
  wrap.querySelectorAll('.timer-preset-remove').forEach(x => {
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      const preset = all[Number(x.dataset.i)];
      customTimerPresets = customTimerPresets.filter(p => p.id !== preset.id);
      saveSettings();
      renderTimerPresets();
    });
  });
}

function initSignalPanel() {
  // Build the three token columns (left/right/center — see SIGNAL_TOKEN_COLUMNS)
  for (const [col, ids] of Object.entries(SIGNAL_TOKEN_COLUMNS)) {
    const el = document.getElementById(`sig-col-${col}`);
    if (!el) continue;
    el.innerHTML = ids.map(id => {
      const def = signalTokenDef(id);
      return `<button class="sig-token-btn sig-token-${id}" data-id="${esc(id)}">${esc(def?.label ?? id)}</button>`;
    }).join('');
    el.querySelectorAll('.sig-token-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        stMessage.push({ id: btn.dataset.id });
        renderSignalPreview();
        updateSignalSendBtn();
      });
    });
  }

  document.getElementById('signal-role-btn')?.addEventListener('click', (e) => {
    openSignalRolePopover(e.currentTarget);
  });

  document.getElementById('signal-player-btn')?.addEventListener('click', (e) => {
    openSignalPlayerPopover(e.currentTarget);
  });

  const addCustomSignalToken = () => {
    const input = document.getElementById('signal-custom-input');
    if (!input || !input.value.trim()) return;
    stMessage.push({ id: 'custom', data: input.value.trim() });
    input.value = '';
    renderSignalPreview();
    updateSignalSendBtn();
  };

  document.getElementById('signal-custom-input')?.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    addCustomSignalToken();
  });

  document.getElementById('signal-custom-add-btn')?.addEventListener('click', addCustomSignalToken);

  document.getElementById('signal-grimoire-btn')?.addEventListener('click', () => {
    // Filled in with a live snapshot by page-bridge right before sending —
    // the companion page's own scraped state isn't detailed enough (no
    // per-reminder ids/flags), so this stays a placeholder until send time.
    if (stMessage.some(t => t.id === 'grimoire')) return;
    stMessage.push({ id: 'grimoire' });
    renderSignalPreview();
    updateSignalSendBtn();
  });

  document.getElementById('signal-clear-btn')?.addEventListener('click', () => {
    stMessage = [];
    renderSignalPreview();
    updateSignalSendBtn();
  });

  document.getElementById('signal-all-check')?.addEventListener('change', function() {
    const players = (currentState?.players ?? []).filter(p => p.id);
    stRecipientIds = new Set(this.checked ? players.map(p => String(p.id)) : []);
    renderSignalPlayers();
  });

  document.getElementById('signal-send-btn')?.addEventListener('click', () => {
    // Catch text left in the custom-token field that never got added as a chip —
    // sending should use it rather than silently dropping it.
    addCustomSignalToken();
    if (!stMessage.length || !stRecipientIds.size) return;
    const userIds = [...stRecipientIds];
    if (stMessage.some(t => OWN_TOKEN_IDS.has(t.id))) {
      // Personalized: one signal per recipient, each with their own alignment/role.
      for (const uid of userIds) {
        const player = (currentState?.players ?? []).find(p => String(p.id) === uid);
        const message = expandOwnTokens(stMessage, player);
        if (message.length) sendBg({ type: 'SEND_SIGNAL', userIds: [uid], message });
      }
    } else {
      sendBg({ type: 'SEND_SIGNAL', userIds, message: stMessage });
    }
    stMessage = [];
    renderSignalPreview();
    updateSignalSendBtn();
  });

  document.getElementById('signal-history-open-btn')?.addEventListener('click', () => openSignalHistoryPanel());

  document.getElementById('signal-save-preset-btn')?.addEventListener('click', () => {
    if (!stMessage.length) return;
    customSignalPresets.push({ id: `${Date.now()}-${Math.random()}`, message: stMessage.map(t => ({ ...t })) });
    saveSettings();
    renderSignalPresets();
  });

  // Read like a clock: 1:00, not 1:0.
  const secondsInput = document.getElementById('timer-seconds');
  secondsInput?.addEventListener('change', () => {
    const v = Math.min(59, Math.max(0, parseInt(secondsInput.value, 10) || 0));
    secondsInput.value = String(v).padStart(2, '0');
  });

  document.getElementById('timer-set-btn')?.addEventListener('click', () => {
    sendSetTimer({
      title: document.getElementById('timer-title').value.trim(),
      minutes: parseInt(document.getElementById('timer-minutes').value, 10) || 0,
      seconds: parseInt(document.getElementById('timer-seconds').value, 10) || 0,
      isPausedDuringVotes: document.getElementById('timer-pause-votes').checked,
    });
  });

  document.getElementById('timer-pause-btn')?.addEventListener('click', (e) => {
    sendBg({ type: 'PAUSE_TIMER', pause: !e.currentTarget.dataset.paused });
  });

  document.getElementById('timer-clear-btn')?.addEventListener('click', () => {
    const isPausedDuringVotes = document.getElementById('timer-pause-votes').checked;
    sendBg({ type: 'SET_TIMER', title: '', duration: 0, isPausedDuringVotes, paused: 0 });
  });

  document.getElementById('timer-save-preset-btn')?.addEventListener('click', () => {
    const title = document.getElementById('timer-title').value.trim();
    const minutes = parseInt(document.getElementById('timer-minutes').value, 10) || 0;
    const seconds = parseInt(document.getElementById('timer-seconds').value, 10) || 0;
    const pause = document.getElementById('timer-pause-votes').checked;
    if (!title || minutes * 60 + seconds <= 0) return;
    customTimerPresets.push({ id: `${Date.now()}-${Math.random()}`, label: title, title, minutes, seconds, pause });
    saveSettings();
    renderTimerPresets();
  });

  const sendEndGame = (isEvilWin) => {
    if (!confirm(`End the game with ${isEvilWin ? 'Evil' : 'Good'} winning?`)) return;
    sendBg({ type: 'END_GAME', isEvilWin });
  };
  document.getElementById('endgame-good-btn')?.addEventListener('click', () => sendEndGame(false));
  document.getElementById('endgame-evil-btn')?.addEventListener('click', () => sendEndGame(true));

  document.getElementById('gong-btn')?.addEventListener('click', () => {
    sendBg({ type: 'GONG' });
  });

  document.getElementById('voice-btn')?.addEventListener('click', () => {
    // Leaving whatever channel we're in takes priority — if a player whispered us
    // into a night channel, this button is the hang-up for that too.
    const channel = currentState?.chatChannel ? '' : soloChannelId();
    if (channel === null) return;
    sendBg({ type: 'JOIN_CHANNEL', channel });
    // Optimistic: the store push that confirms the change only lands on the next
    // WS frame, which can be a second or two out on an idle table.
    currentState = { ...currentState, chatChannel: channel };
    updateVoiceBtn();
  });

  document.getElementById('next-phase-btn')?.addEventListener('click', () => {
    sendBg({ type: 'NEXT_PHASE' });
  });

  const sendSeatOrder = (order) => {
    sendBg({ type: 'SHUFFLE_SEATS', order });
  };

  const shuffleSeats = () => {
    const n = (currentState?.players ?? []).length;
    if (n < 2) return;
    const order = [...Array(n).keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    sendSeatOrder(order);
  };
  document.getElementById('players-shuffle-btn')?.addEventListener('click', shuffleSeats);

  // movePlayers takes order[newSeat] = oldSeat, and seats run clockwise from the
  // top, so clockwise means everyone takes the seat after theirs (checked in a game).
  document.getElementById('players-rotate-cw-btn')?.addEventListener('click', () => {
    const n = (currentState?.players ?? []).length;
    if (n < 2) return;
    sendSeatOrder(Array.from({ length: n }, (_, j) => (j - 1 + n) % n));
  });

  document.getElementById('players-rotate-ccw-btn')?.addEventListener('click', () => {
    const n = (currentState?.players ?? []).length;
    if (n < 2) return;
    sendSeatOrder(Array.from({ length: n }, (_, j) => (j + 1) % n));
  });

  const removeEmptySeats = () => {
    if (!confirm('Remove all empty seats?')) return;
    sendBg({ type: 'REMOVE_EMPTY_SEATS' });
  };
  document.getElementById('players-remove-empty-btn')?.addEventListener('click', removeEmptySeats);
  document.getElementById('players-shut-up-btn')?.addEventListener('click', () => sendBg({ type: 'SHUT_UP' }));

  document.getElementById('players-nominate-btn')?.addEventListener('click', () => setPlayerActionMode('nominate'));
  document.getElementById('players-swap-btn')?.addEventListener('click', () => setPlayerActionMode('swap'));
  // "Execute" on the between-nominations card ends the day: the marked player
  // (if any) loses the mark and dies, then the game moves on to the night.
  document.getElementById('ns-execute')?.addEventListener('click', (e) => {
    // NEXT_PHASE reverts on a fast second click — don't let a double-click undo it.
    const btn = e.currentTarget;
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    setTimeout(() => { delete btn.dataset.busy; }, 1500);
    const marked = (currentState?.players ?? []).find(pl => (pl.status ?? []).includes('marked'));
    if (marked) {
      const value = [...new Set([...marked.status.filter(t => t !== 'marked'), 'dead'])];
      sendBg({ type: 'SET_PLAYER_PROPERTY', seat: marked.seat, property: 'status', value });
    }
    sendBg({ type: 'NEXT_PHASE' });
  });
  document.getElementById('players-mark-btn')?.addEventListener('click', () => setPlayerActionMode('mark'));
  document.getElementById('players-unmark-btn')?.addEventListener('click', () => {
    const marked = (currentState?.players ?? []).find(pl => (pl.status ?? []).includes('marked'));
    if (!marked) return;
    const value = marked.status.filter(s => s !== 'marked');
    sendBg({ type: 'SET_PLAYER_PROPERTY', seat: marked.seat, property: 'status', value });
  });
  document.getElementById('screenshot-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    // captureVisibleTab needs <all_urls> (botc.app host access isn't enough);
    // it's optional so the extension only holds it once the user agrees. The
    // request must run inside the click; when already granted it resolves at once.
    let granted = false;
    try { granted = await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch { /* dummy mode */ }
    if (!granted) { alert('Screenshot needs permission to capture the botc.app tab.'); return; }
    btn.disabled = true;
    sendBg({ type: 'TAKE_SCREENSHOT' }, (res) => {
      btn.disabled = false;
      if (!res?.dataUrl) { alert(`Screenshot failed: ${res?.error ?? 'no response from the extension (reload it?)'}`); return; }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
      const session = currentState?.session ? `${currentState.session}-` : '';
      const a = document.createElement('a');
      a.href = res.dataUrl;
      a.download = `botc-${session}${stamp}.png`;
      a.click();
    });
  });
  document.getElementById('clear-grimoire-btn')?.addEventListener('click', () => {
    if (!confirm('Clear the grimoire? This removes all roles, reminders, and status from every player.')) return;
    sendBg({ type: 'CLEAR_GRIMOIRE' });
  });
  initAddSeatFloatButton();

  // One-off script file: picking it is the confirmation, so it loads straight away.
  const scriptFileInput = document.getElementById('script-file-input');
  document.getElementById('script-file-btn')?.addEventListener('click', () => {
    scriptFileInput.value = '';   // re-picking the same file must still fire `change`
    scriptFileInput.click();
  });
  scriptFileInput?.addEventListener('change', async () => {
    const file = scriptFileInput.files?.[0];
    if (!file) return;
    try {
      const script = parseScriptJson(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
      sendLoadScript(script);
    } catch {
      alert('Could not parse this file as a script (expected the script-tool JSON export format).');
    }
  });

  // The scroll icon in the header opens the library directly.
  const scriptLibOverlay = document.getElementById('script-library-overlay');
  document.getElementById('script-btn')?.addEventListener('click', () => {
    scriptLibOverlay.style.display = '';
  });
  document.getElementById('script-library-close')?.addEventListener('click', () => {
    scriptLibOverlay.style.display = 'none';
  });
  document.getElementById('script-library-backdrop')?.addEventListener('click', () => {
    scriptLibOverlay.style.display = 'none';
  });

}

function parseScriptJson(json, fallbackName) {
  if (!Array.isArray(json)) throw new Error('not an array');
  const meta = json.find(r => r === '_meta' || r?.id === '_meta') || {};
  const roles = json
    .filter(r => r !== '_meta' && r?.id !== '_meta')
    .map(r => (typeof r === 'string' ? { id: r } : r));
  return {
    author: meta.author ?? '',
    // An empty or whitespace-only name is as useless as a missing one.
    name: (typeof meta.name === 'string' && meta.name.trim()) || fallbackName,
    roles,
    background: meta.background ?? null,
    logo: meta.logo ?? null,
    almanac: meta.almanac ?? null,
    bootlegger: meta.bootlegger ?? null,
  };
}

function sendLoadScript(script) {
  sendBg({
    type: 'LOAD_CUSTOM_SCRIPT',
    author: script.author,
    name: script.name,
    roles: script.roles,
    background: script.background,
    logo: script.logo,
    almanac: script.almanac,
    bootlegger: script.bootlegger,
  });
}

// ── Script Library ──────────────────────────────────────────────────────────
// Classifies a script role entry's team WITHOUT touching the shared _roleAliases
// cache (registerRoleAlias/enrichRoles) — that cache is meant for the live game
// session, and scanning a whole library through it would pollute it with
// one-off mappings. Falls back to 'unclassified' rather than guessing wrong.
function classifyScriptRoleTeam(entry) {
  const id = typeof entry === 'string' ? entry : entry?.id;
  const explicitName = typeof entry === 'object' ? entry?.name : null;
  const explicitTeam = typeof entry === 'object' ? entry?.team : null;
  if (!id) return { team: '', name: explicitName ?? '?', id: null };

  // Find the canonical bundled role this entry resolves to, if any — done even
  // when the script already supplies its own team/name (e.g. fanggucz has both
  // an explicit team AND resolves to the canonical 'fanggu' for icon purposes).
  const cleanId = id.replace(/^traveller_/, '').toLowerCase();
  let canonical = _roles().find(x => x.id === cleanId);

  if (!canonical && cleanId.includes('_')) {
    canonical = _roles().find(x => x.id === cleanId.replace(/_/g, ''));
  }

  if (!canonical) {
    // Wiki-style icon filename: Icon_fortune_teller.png → fortuneteller
    const iconMatch = (typeof entry?.iconUrl === 'string' ? entry.iconUrl : '').match(/Icon_([a-z0-9_]+)\./i);
    if (iconMatch) {
      const guess = iconMatch[1].toLowerCase().replace(/_/g, '');
      canonical = _roles().find(x => x.id === guess);
    }
  }

  if (!canonical) {
    // botc.app asset filename embedded in an `image` array (seen in fully-translated
    // scripts where id/name bear no resemblance to English): .../washerwoman_g-HASH.webp
    const images = Array.isArray(entry?.image) ? entry.image : [];
    for (const url of images) {
      const m = String(url).match(/\/([a-z0-9]+)_[ge](?:-|\.)/i);
      if (m) { canonical = _roles().find(x => x.id === m[1].toLowerCase()); if (canonical) break; }
    }
  }

  if (!canonical) {
    // Fallback: longest canonical id the custom id starts with (fanggucz → fanggu),
    // capped like registerRoleAlias so homebrew (hermitcrab) isn't swallowed.
    for (const x of _roles()) {
      if (cleanId.startsWith(x.id) && cleanId.length - x.id.length <= LOCALE_SUFFIX_MAX
          && (!canonical || x.id.length > canonical.id.length)) canonical = x;
    }
  }

  return {
    team: explicitTeam || canonical?.team || '',
    name: explicitName ?? canonical?.name ?? id,
    id: canonical?.id ?? null,
    // Kept separate from `name` (which purposely prefers the script's own,
    // possibly-translated name for display) — search needs the resolved
    // canonical English name too, or a translated script's roles never match.
    canonicalName: canonical?.name ?? null,
    edition: canonical?.edition ?? null,
    // Homebrew often borrows an official id prefix or icon (`foolunatic` →
    // Fool) but names its own set here, which is the only tell it isn't the
    // official character. Base-3 detection needs it.
    declaredEdition: typeof entry === 'object' && entry?.edition ? String(entry.edition) : null,
  };
}

// ── Script library directory handle ─────────────────────────────────────────
// The FileSystemDirectoryHandle is not string-serializable, so it can't go
// through the localStorage-based settings like everything else here. It lives
// in IndexedDB instead — see data/companionDb.js, which owns the schema and
// the single versioned opener.
const saveDirHandle = (handle) => CompanionDb.saveDirHandle(handle);
const loadDirHandle = () => CompanionDb.loadDirHandle();

// ── Scanning ─────────────────────────────────────────────────────────────────
// Firefox implements only the Origin Private File System half of the File
// System API and deliberately omits the local-disk pickers, so
// showDirectoryPicker is undefined there. Two collectors below feed one shared
// entry builder: the handle-based walk (Chromium, keeps a resumable handle) and
// a <input webkitdirectory> FileList walk (Firefox, no persistent handle).
const hasDirectoryPicker = () => typeof window.showDirectoryPicker === 'function';

// Turns one script's JSON into the shape the library UI renders. Shared by both
// collectors so the two platforms can never drift apart.
function buildScriptEntry(json, fileName, category) {
  const parsed = parseScriptJson(json, fileName.replace(/\.json$/i, ''));
  const rolesByTeam = {};
  const roleSearchTerms = new Set();
  for (const r of parsed.roles) {
    const { team, name: roleName, id: roleId, canonicalName, edition, declaredEdition } = classifyScriptRoleTeam(r);
    // Fabled and Loric are both non-player special roles — merge into one "NPCs" bucket
    const key = (team === 'fabled' || team === 'loric') ? 'NPCs' : (team || 'unclassified');
    (rolesByTeam[key] ??= []).push({ name: roleName, id: roleId, edition, declaredEdition });
    // Search by the script's own (possibly translated) name AND the
    // resolved canonical id/English name, so "washerwoman" finds a
    // Czech script's "Pradlena" too.
    if (roleName) roleSearchTerms.add(roleName.toLowerCase());
    if (canonicalName) roleSearchTerms.add(canonicalName.toLowerCase());
    if (roleId) roleSearchTerms.add(roleId.toLowerCase());
  }
  const roleNames = Object.values(rolesByTeam).flat().map(r => r.name).filter(Boolean);
  return { ...parsed, category: category ?? 'Uncategorized', rolesByTeam, roleNames, roleSearchTerms: [...roleSearchTerms] };
}

async function scanScriptDir(dirHandle, category = null) {
  const results = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      results.push(...await scanScriptDir(handle, category ? `${category}/${name}` : name));
    } else if (name.toLowerCase().endsWith('.json')) {
      try {
        const file = await handle.getFile();
        results.push(buildScriptEntry(JSON.parse(await file.text()), name, category));
      } catch { /* not a valid script file — skip it silently, library scan shouldn't halt on one bad file */ }
    }
  }
  return results;
}

// Firefox path. `webkitRelativePath` is "<pickedFolder>/<subdirs…>/<file>";
// the picked folder's own name is dropped so categories match the handle walk,
// which starts numbering them from the first level *inside* the chosen folder.
async function scanScriptFileList(fileList) {
  const results = [];
  for (const file of fileList) {
    if (!file.name.toLowerCase().endsWith('.json')) continue;
    const segments = (file.webkitRelativePath || file.name).split('/');
    const category = segments.slice(1, -1).join('/') || null;
    try {
      results.push(buildScriptEntry(JSON.parse(await file.text()), file.name, category));
    } catch { /* not a valid script file — skip it silently */ }
  }
  return results;
}

// Script-declared edition values that are consistent with a role being the
// official character it resolved to. 'OfficialCustoms' is the script tool's
// label for an official character with custom (e.g. translated) text. Anything
// else (`lmr`, `HSoM`, …) names a homebrew set that merely borrowed an official
// id prefix or icon, like `foolunatic` → Fool.
const OFFICIAL_DECLARED_EDITIONS = new Set(['tb', 'bmr', 'snv', 'carousel', 'fabled', 'loric', 'officialcustoms']);
const isOfficialRole = (r) => !!r.edition
  && (!r.declaredEdition || OFFICIAL_DECLARED_EDITIONS.has(r.declaredEdition.toLowerCase()));

// Travellers and NPCs (Fabled/Loric) don't count toward Base 3 or complexity.
const NON_PLAYER_TEAMS = new Set(['traveller', 'traveler', 'NPCs']);
const playerRoles = (rolesByTeam) => Object.entries(rolesByTeam)
  .filter(([team]) => !NON_PLAYER_TEAMS.has(team))
  .flatMap(([, roles]) => roles);

// Base 3 = every Townsfolk/Outsider/Minion/Demon is an official TB, BMR or S&V character.
const BASE3_EDITIONS = new Set(['tb', 'bmr', 'snv']);
function isBase3Script(rolesByTeam) {
  const roles = playerRoles(rolesByTeam);
  return roles.length > 0 && roles.every(r => isOfficialRole(r) && BASE3_EDITIONS.has(r.edition));
}

// Estimated player difficulty from data/complexity.js facts, 1–5.
//
// Measures what a typical *game* on the script holds, not how big the script
// is — TPI rates an 11-character teensy (Laissez un Faire) among its hardest.
// Each character is weighted by how likely it is to be in play: its depth +
// chaos count when it is, and its presence counts by how *uncertain* that is —
// a lone Demon is known to be in play, so its threat by presence is mostly
// priced in; with four Demons on the script each has to be played around.
// The per-player average is mapped linearly onto 1–5, fitted against TPI's
// published Player Complexity scores (No Greater Joy 1.5, Over the River 3,
// Hide & Seek 3, One In One Out 3, A Grimm Chorus 3.5, Lunar Eclipse 3.5,
// Laissez un Faire 4.5, The Passage of Time 4.5) plus TB ≈ 1.75, BMR ≈ 3 and
// S&V ≈ 3.25; typical error against those is ±0.45.
// Returns null when too few characters are rated (mostly-homebrew scripts).
const COMPLEXITY_MIN_COVERAGE = 0.6;
// Typical number of each team in play, for a full game and for teensyville.
const EXPECTED_IN_PLAY = { townsfolk: 6, outsider: 1, minion: 1.5, demon: 1 };
const EXPECTED_IN_PLAY_TEENSY = { townsfolk: 3.5, outsider: 0.6, minion: 1, demon: 1 };
const TEENSY_MAX_CHARACTERS = 14;
const PRESENCE_WEIGHT = 0.25;
// Presence still counts somewhat when a character is surely in play.
const PRESENCE_FLOOR = 0.3;
const COMPLEXITY_FIT = { intercept: -1.649, slope: 1.885 };
function scriptComplexity(rolesByTeam) {
  const teams = Object.entries(rolesByTeam).filter(([team]) => !NON_PLAYER_TEAMS.has(team));
  const total = teams.reduce((n, [, roles]) => n + roles.length, 0);
  const expected = total <= TEENSY_MAX_CHARACTERS ? EXPECTED_IN_PLAY_TEENSY : EXPECTED_IN_PLAY;
  let rated = 0, inPlay = 0, load = 0;
  for (const [team, roles] of teams) {
    const pInPlay = Math.min(1, (expected[team] ?? 1) / roles.length);
    const presenceWeight = PRESENCE_FLOOR + (1 - PRESENCE_FLOOR) * (1 - pInPlay);
    for (const r of roles) {
      const facts = isOfficialRole(r) ? ROLE_COMPLEXITY[r.id] : null;
      if (!facts) continue;
      const [, depth, chaos, presence] = facts;
      rated++;
      inPlay += pInPlay;
      load += pInPlay * (depth + chaos) + PRESENCE_WEIGHT * presenceWeight * presence;
    }
  }
  if (!rated || rated / total < COMPLEXITY_MIN_COVERAGE) return null;
  const score = COMPLEXITY_FIT.intercept + COMPLEXITY_FIT.slope * (load / inPlay);
  return { score: Math.min(5, Math.max(1, score)), rated, total };
}

// Difficulty filter range, on TPI's scale (1.5 beginner, 3 intermediate,
// 4.5 hard): TB and simple teensies sit below 2.5, BMR around 3, S&V right at
// 3.5, Laissez un Faire / Passage of Time / Lunar Eclipse above.
const DIFFICULTY_MIN = 1;
const DIFFICULTY_MAX = 5;

// Short green→red bar tag.
function complexityTagHtml(c) {
  const t = (c.score - 1) / 4;
  const partial = c.rated < c.total ? ` (${c.rated}/${c.total} characters rated)` : '';
  return `<span class="script-lib-tag script-lib-cx" title="Difficulty ${c.score.toFixed(1)} / 5${esc(partial)}">`
    + `<span class="script-lib-cx-bar"><span style="width:${Math.max(Math.round(t * 100), 6)}%;background:hsl(${Math.round(120 - t * 120)},70%,50%)"></span></span></span>`;
}

// Library scripts are keyed by name + author rather than file path, so a
// favourite survives moving the file between category folders (and the
// Firefox cache, which never kept paths).
const scriptLabelKey = (s) => `${s.name}\n${s.author ?? ''}`;

// ── Favourites ───────────────────────────────────────────────────────────────
// A single star per script. Stored as an array of scriptLabelKey()s. Seeded
// once from the old 'fun' label (the retired script-labels store), which was
// the favourite before it got its own storage.
const SCRIPT_FAVOURITES_KEY = 'botc-companion-script-favourites';
let scriptFavourites = (() => {
  try {
    const raw = localStorage.getItem(SCRIPT_FAVOURITES_KEY);
    if (raw != null) return new Set(JSON.parse(raw) || []);
  } catch { /* fall through to migration */ }
  try {
    const labels = JSON.parse(localStorage.getItem('botc-companion-script-labels') || '{}') || {};
    return new Set(Object.keys(labels).filter(k => labels[k]?.includes?.('fun')));
  } catch { return new Set(); }
})();
const isScriptFavourite = (s) => scriptFavourites.has(scriptLabelKey(s));
function toggleScriptFavourite(s) {
  const key = scriptLabelKey(s);
  if (scriptFavourites.has(key)) scriptFavourites.delete(key); else scriptFavourites.add(key);
  try { localStorage.setItem(SCRIPT_FAVOURITES_KEY, JSON.stringify([...scriptFavourites])); } catch { /* ignore */ }
  return scriptFavourites.has(key);
}

// ── Exact role filter ────────────────────────────────────────────────────────
// Plain search matches substrings, so "Imp" also finds every script with an
// "Impostor" or an "Imp"-something in its name. A picked role chip instead
// matches the role itself. Keyed by the resolved canonical id, so a
// translated script's "Pradlena" counts as the Washerwoman; roles that resolve
// to nothing official are keyed by their own name.
const scriptRoleKey = (r) => r.id ? r.id : `custom:${(r.name ?? '').toLowerCase()}`;
const scriptRoleKeys = (s) => new Set(Object.values(s.rolesByTeam).flat().map(scriptRoleKey));

// key → { key, name, id, terms, count } over the whole library.
function buildScriptRoleIndex(scripts) {
  const index = new Map();
  for (const s of scripts) {
    const seen = new Set();
    for (const r of Object.values(s.rolesByTeam).flat()) {
      const key = scriptRoleKey(r);
      let entry = index.get(key);
      if (!entry) {
        const canonical = r.id ? _roles().find(x => x.id === r.id) : null;
        entry = { key, id: r.id, name: canonical?.name ?? r.name ?? '?', terms: new Set(), count: 0 };
        if (canonical) entry.terms.add(canonical.name.toLowerCase());
        index.set(key, entry);
      }
      if (r.name) entry.terms.add(r.name.toLowerCase());
      if (!seen.has(key)) { seen.add(key); entry.count++; }
    }
  }
  return index;
}

// Exact name first, then name prefix, then a word starting with the query,
// then any substring; ties go to the role on more scripts.
function suggestScriptRoles(index, q, exclude) {
  const rank = (term) => term === q ? 0 : term.startsWith(q) ? 1 : term.split(/[\s\-']+/).some(w => w.startsWith(q)) ? 2 : term.includes(q) ? 3 : 9;
  return [...index.values()]
    .filter(e => !exclude.has(e.key))
    .map(e => ({ e, r: Math.min(...[...e.terms].map(rank)) }))
    .filter(x => x.r < 9)
    .sort((a, b) => a.r - b.r || b.e.count - a.e.count || a.e.name.localeCompare(b.e.name))
    .slice(0, 8)
    .map(x => x.e);
}

// ── UI ────────────────────────────────────────────────────────────────────────
const SCRIPT_LIB_CACHE_KEY = 'scriptLibrary';
let scriptLibrary = [];
let collapsedScriptCategories = new Set();

function initScriptLibrary() {
  const pickBtn = document.getElementById('script-lib-pick-btn');
  const resumeBtn = document.getElementById('script-lib-resume-btn');
  const rescanBtn = document.getElementById('script-lib-rescan-btn');
  const dirInput = document.getElementById('script-lib-dir-input');
  const statusEl = document.getElementById('script-lib-status');
  const filtersEl = document.getElementById('script-library-filters');
  const searchInput = document.getElementById('script-lib-search');
  const resultsEl = document.getElementById('script-library-results');
  const jumpEl = document.getElementById('script-lib-jump');

  let currentDirHandle = null;

  const setStatus = (text) => { statusEl.textContent = text; };

  // scan() → the parsed library; onDone runs after it's shown.
  async function runLibraryScan(scan, failMsg, onDone) {
    setStatus('Scanning…');
    try {
      scriptLibrary = await scan();
      filtersEl.style.display = '';
      rescanBtn.style.display = '';
      setStatus(`${scriptLibrary.length} scripts`);
      renderResults();
      await onDone?.();
    } catch (e) {
      setStatus(failMsg);
      console.error('botc-tool: script folder scan failed', e);
    }
  }

  const runScan = (dirHandle) => runLibraryScan(() => scanScriptDir(dirHandle),
    'Scan failed — folder may have been moved or access revoked.');

  // Chromium: pick a handle we can keep and re-walk later.
  async function pickDirectoryHandle() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (e) {
      // Only a genuine cancel is silent — anything else used to be swallowed
      // here too, which is why a failing picker looked like a dead button.
      if (e?.name !== 'AbortError') {
        setStatus('Could not open the folder picker.');
        console.error('botc-tool: showDirectoryPicker failed', e);
      }
      return;
    }
    currentDirHandle = handle;
    await saveDirHandle(handle);
    resumeBtn.style.display = 'none';
    await runScan(handle);
  }

  // Firefox: no picker API and no persistent handle, so the folder is read
  // through a webkitdirectory input and the parsed result is cached instead.
  function pickDirectoryInput() {
    dirInput.value = '';   // re-picking the same folder must still fire `change`
    dirInput.click();
  }

  const pickDirectory = () => hasDirectoryPicker() ? pickDirectoryHandle() : pickDirectoryInput();

  dirInput?.addEventListener('change', async () => {
    const files = [...(dirInput.files ?? [])];
    if (files.length === 0) return;
    // Cached so it survives a companion reload; Firefox can't re-read the folder unattended.
    await runLibraryScan(() => scanScriptFileList(files), 'Scan failed — could not read that folder.',
      () => CompanionDb.setCached(SCRIPT_LIB_CACHE_KEY, scriptLibrary));
  });

  pickBtn?.addEventListener('click', pickDirectory);
  // Without a handle there is nothing to re-walk, so a rescan means re-picking.
  rescanBtn?.addEventListener('click', () => {
    if (currentDirHandle) runScan(currentDirHandle);
    else pickDirectory();
  });

  resumeBtn?.addEventListener('click', async () => {
    if (!currentDirHandle) return;
    try {
      const perm = await currentDirHandle.requestPermission({ mode: 'read' });
      if (perm === 'granted') {
        resumeBtn.style.display = 'none';
        await runScan(currentDirHandle);
      } else {
        setStatus('Access denied — pick the folder again.');
      }
    } catch {
      setStatus('Could not resume access — pick the folder again.');
    }
  });

  function renderResults() {
    const q = (searchInput.value ?? '').trim().toLowerCase();
    const filtered = scriptLibrary.map(s => ({
      ...s,
      base3: isBase3Script(s.rolesByTeam),
      cx: scriptComplexity(s.rolesByTeam),
    })).filter(s => {
      if (base3Only && !s.base3) return false;
      if (oneDemonOnly && s.rolesByTeam.demon?.length !== 1) return false;
      if (favouritesOnly && !isScriptFavourite(s)) return false;
      if (roleFilter.size) {
        const keys = scriptRoleKeys(s);
        for (const key of roleFilter.keys()) if (!keys.has(key)) return false;
      }
      // Unrated scripts can't be placed in a bucket, so any difficulty filter hides them.
      if (difficultyFiltered() && !(s.cx && s.cx.score >= difficultyRange.lo - 1e-9 && s.cx.score <= difficultyRange.hi + 1e-9)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q)
        || s.author.toLowerCase().includes(q)
        || (s.roleSearchTerms ?? s.roleNames).some(n => n.toLowerCase().includes(q));
    });

    const byCategory = {};
    for (const s of filtered) (byCategory[s.category] ??= []).push(s);
    // Unrated scripts sort after rated ones in either difficulty direction.
    const byName = (a, b) => a.name.localeCompare(b.name);
    const byDifficulty = (dir) => (a, b) => (!a.cx - !b.cx) || (a.cx && dir * (a.cx.score - b.cx.score)) || byName(a, b);
    const compare = sortMode === 'easiest' ? byDifficulty(1) : sortMode === 'hardest' ? byDifficulty(-1) : byName;
    for (const cat of Object.keys(byCategory)) byCategory[cat].sort(compare);

    resultsEl.innerHTML = Object.keys(byCategory).sort().map(cat => {
      const items = byCategory[cat].map((s, i) => {
        const rolesHtml = Object.entries(s.rolesByTeam).map(([t, roles]) => {
          const chips = roles.map(r => {
            const url = r.id ? _iconUrl({ id: r.id }) : null;
            const icon = url ? `<img class="tp-role-icon" src="${esc(url)}" />` : '';
            return `<span class="script-role-chip">${icon}${esc(r.name)}</span>`;
          }).join('');
          return `<div class="script-lib-role-team"><span class="script-team-label">${esc(t)}</span>${chips}</div>`;
        }).join('');
        return `<div class="script-lib-entry">
          <div class="script-lib-row" data-cat="${esc(cat)}" data-idx="${i}">
            <span class="script-lib-expand">▸</span>
            <span class="script-lib-name">${esc(s.name)}</span>
            <span class="script-lib-author" title="${esc(s.author)}">${esc(s.author)}</span>
            ${s.base3 ? '<span class="script-lib-tag" title="Only Trouble Brewing, Bad Moon Rising and Sects &amp; Violets characters">Base 3</span>' : ''}
            ${s.cx ? complexityTagHtml(s.cx) : ''}
            <span class="script-lib-role-count">${s.roleNames.length} roles</span>
            <button type="button" class="script-lib-apply" data-cat="${esc(cat)}" data-idx="${i}">Apply</button>
            ${(() => {
              const fav = isScriptFavourite(s);
              return `<button type="button" class="script-lib-fav-btn${fav ? ' active' : ''}" data-cat="${esc(cat)}" data-idx="${i}" aria-pressed="${fav}" aria-label="Favourite" title="Favourite">★</button>`;
            })()}
          </div>
          <div class="script-lib-roles" style="display:none">${rolesHtml}</div>
        </div>`;
      }).join('');
      const isCollapsed = collapsedScriptCategories.has(cat);
      return `<div class="script-lib-category${isCollapsed ? ' collapsed' : ''}">
        <div class="script-lib-cat-header" data-cat="${esc(cat)}"><span class="script-lib-cat-chevron">▾</span>${esc(cat)} (${byCategory[cat].length})</div>
        <div class="script-lib-cat-items">${items}</div>
      </div>`;
    }).join('') || '<div class="script-lib-empty">No scripts match.</div>';

    resultsEl.querySelectorAll('.script-lib-cat-header').forEach(header => {
      header.addEventListener('click', () => {
        const catEl = header.closest('.script-lib-category');
        setCategoryCollapsed(catEl, !catEl.classList.contains('collapsed'));
      });
    });

    renderJumpBar(Object.keys(byCategory).sort(), byCategory);

    resultsEl.querySelectorAll('.script-lib-row').forEach(row => {
      row.addEventListener('click', () => {
        const rolesEl = row.closest('.script-lib-entry').querySelector('.script-lib-roles');
        const chevron = row.querySelector('.script-lib-expand');
        const open = rolesEl.style.display !== 'none';
        rolesEl.style.display = open ? 'none' : '';
        chevron.textContent = open ? '▸' : '▾';
      });
    });

    resultsEl.querySelectorAll('.script-lib-fav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const script = byCategory[btn.dataset.cat][Number(btn.dataset.idx)];
        const on = toggleScriptFavourite(script);
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    });

    resultsEl.querySelectorAll('.script-lib-apply').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const script = byCategory[btn.dataset.cat][Number(btn.dataset.idx)];
        sendLoadScript(script);
      });
    });
  }

  function setCategoryCollapsed(catEl, collapsed) {
    catEl.classList.toggle('collapsed', collapsed);
    const cat = catEl.querySelector('.script-lib-cat-header').dataset.cat;
    if (collapsed) collapsedScriptCategories.add(cat); else collapsedScriptCategories.delete(cat);
  }

  // Bookmark tabs down the panel's right edge, one per folder, so a big
  // library is a click away from any folder instead of a long scroll.
  // Jumping opens the folder if it was collapsed.
  function renderJumpBar(cats, byCategory) {
    if (!jumpEl) return;
    if (cats.length < 2) { jumpEl.innerHTML = ''; return; }
    const allCollapsed = cats.every(c => collapsedScriptCategories.has(c));
    jumpEl.innerHTML = `<button type="button" class="script-lib-jump-btn script-lib-jump-all" title="${allCollapsed ? 'Expand' : 'Collapse'} all folders">${allCollapsed ? 'Expand all' : 'Collapse all'}</button>`
      + cats.map(cat =>
        `<button type="button" class="script-lib-jump-btn" data-cat="${esc(cat)}" title="${esc(cat)}"><span class="script-lib-jump-name">${esc(cat)}</span><span class="script-lib-jump-count">${byCategory[cat].length}</span></button>`
      ).join('');

    jumpEl.querySelectorAll('.script-lib-jump-btn[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const header = [...resultsEl.querySelectorAll('.script-lib-cat-header')].find(h => h.dataset.cat === btn.dataset.cat);
        if (!header) return;
        const catEl = header.closest('.script-lib-category');
        setCategoryCollapsed(catEl, false);
        resultsEl.scrollTop += catEl.getBoundingClientRect().top - resultsEl.getBoundingClientRect().top;
      });
    });
    jumpEl.querySelector('.script-lib-jump-all')?.addEventListener('click', () => {
      resultsEl.querySelectorAll('.script-lib-category').forEach(catEl => setCategoryCollapsed(catEl, !allCollapsed));
      resultsEl.scrollTop = 0;
      renderJumpBar(cats, byCategory);
    });
    markCurrentJump();
  }

  // Highlights the bookmark of the folder at the top of the list.
  function markCurrentJump() {
    if (!jumpEl) return;
    const top = resultsEl.getBoundingClientRect().top + 1;
    let current = null;
    for (const h of resultsEl.querySelectorAll('.script-lib-cat-header')) {
      if (h.closest('.script-lib-category').getBoundingClientRect().top <= top) current = h.dataset.cat;
      else break;
    }
    current ??= resultsEl.querySelector('.script-lib-cat-header')?.dataset.cat;
    jumpEl.querySelectorAll('.script-lib-jump-btn[data-cat]').forEach(b => b.classList.toggle('current', b.dataset.cat === current));
  }
  resultsEl?.addEventListener('scroll', markCurrentJump, { passive: true });

  // The tabs start level with the list rather than at a fixed offset, so they
  // follow the toolbar and filters as those wrap or the panel opens.
  function alignJumpBar() {
    const frame = jumpEl?.parentElement;
    if (!frame || !resultsEl.offsetParent) return;
    jumpEl.style.top = `${Math.round(resultsEl.getBoundingClientRect().top - frame.getBoundingClientRect().top)}px`;
  }
  if (jumpEl && window.ResizeObserver) {
    const ro = new ResizeObserver(alignJumpBar);
    ro.observe(document.getElementById('script-library-panel'));
    ro.observe(resultsEl);
  }

  // Picked roles, key → index entry; a script must have every one of them.
  const roleFilter = new Map();
  const suggestEl = document.getElementById('script-lib-role-suggest');
  const roleChipsEl = document.getElementById('script-lib-role-chips');
  let roleIndex = null, roleIndexFor = null;
  let suggestions = [], suggestActive = 0;
  const getRoleIndex = () => {
    if (roleIndexFor !== scriptLibrary) { roleIndex = buildScriptRoleIndex(scriptLibrary); roleIndexFor = scriptLibrary; }
    return roleIndex;
  };
  const roleIconHtml = (e) => {
    const url = e.id ? _iconUrl({ id: e.id }) : null;
    return url ? `<img class="tp-role-icon" src="${esc(url)}" />` : '';
  };

  const searchClearBtn = document.getElementById('script-lib-search-clear');
  const syncSearchClear = () => { if (searchClearBtn) searchClearBtn.hidden = !searchInput.value && !roleFilter.size; };
  // Clears the typed text and every picked role in one go.
  function clearSearch() {
    searchInput.value = '';
    roleFilter.clear();
    suggestEl.hidden = true;
    renderRoleChips();
    renderResults();
    searchInput.focus();
  }
  searchClearBtn?.addEventListener('mousedown', (ev) => ev.preventDefault());
  searchClearBtn?.addEventListener('click', clearSearch);

  function renderRoleChips() {
    syncSearchClear();
    searchInput.placeholder = roleFilter.size ? 'add a role, or search…' : 'search name, author, or role…';
    roleChipsEl.innerHTML = [...roleFilter.values()].map(e =>
      `<span class="script-lib-role-filter">${roleIconHtml(e)}${esc(e.name)}<button type="button" data-key="${esc(e.key)}" aria-label="Remove ${esc(e.name)}" title="Remove">✕</button></span>`).join('');
    roleChipsEl.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      roleFilter.delete(btn.dataset.key);
      renderRoleChips();
      renderResults();
      searchInput.focus();
    }));
  }
  // The chips live inside the search box, so a click anywhere on it types.
  searchInput?.parentElement.addEventListener('mousedown', (ev) => {
    if (ev.target === ev.currentTarget || ev.target === roleChipsEl) { ev.preventDefault(); searchInput.focus(); }
  });

  function renderSuggestions() {
    const q = (searchInput.value ?? '').trim().toLowerCase();
    // One letter matches half the roles; wait for a second.
    suggestions = q.length >= 2 ? suggestScriptRoles(getRoleIndex(), q, roleFilter).slice(0, 5) : [];
    suggestActive = 0;
    suggestEl.hidden = !suggestions.length;
    // An inline row, not a dropdown: a dropdown covered the very scripts the
    // name search had just found.
    suggestEl.innerHTML = '<span class="script-lib-role-hint" title="Pick a role to show only scripts with exactly that role (Enter picks the highlighted one)">Role:</span>'
      + suggestions.map((e, i) =>
        `<button type="button" class="script-lib-role-option${i === 0 ? ' active' : ''}" role="option" data-i="${i}" title="Only scripts with ${esc(e.name)}">${roleIconHtml(e)}<span class="script-lib-role-option-name">${esc(e.name)}</span><span class="script-lib-role-option-count">${e.count}</span></button>`).join('');
    suggestEl.querySelectorAll('.script-lib-role-option').forEach(opt => {
      // mousedown, not click: the input's blur would hide the list first.
      opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickSuggestion(Number(opt.dataset.i)); });
    });
  }

  function setSuggestActive(i) {
    suggestActive = (i + suggestions.length) % suggestions.length;
    suggestEl.querySelectorAll('.script-lib-role-option').forEach((o, j) => o.classList.toggle('active', j === suggestActive));
  }

  function pickSuggestion(i) {
    const e = suggestions[i];
    if (!e) return;
    roleFilter.set(e.key, e);
    searchInput.value = '';
    suggestEl.hidden = true;
    renderRoleChips();
    renderResults();
  }

  searchInput?.addEventListener('input', () => { syncSearchClear(); renderSuggestions(); renderResults(); });
  searchInput?.addEventListener('focus', renderSuggestions);
  searchInput?.addEventListener('keydown', (ev) => {
    const open = !suggestEl.hidden && suggestions.length;
    if (ev.key === 'ArrowDown' && open) { ev.preventDefault(); setSuggestActive(suggestActive + 1); }
    else if (ev.key === 'ArrowUp' && open) { ev.preventDefault(); setSuggestActive(suggestActive - 1); }
    else if (ev.key === 'Enter' && open) { ev.preventDefault(); pickSuggestion(suggestActive); }
    else if (ev.key === 'Escape' && open) { ev.preventDefault(); ev.stopPropagation(); suggestEl.hidden = true; }
    else if (ev.key === 'Escape' && (searchInput.value || roleFilter.size)) { ev.preventDefault(); ev.stopPropagation(); clearSearch(); }
    else if (ev.key === 'Backspace' && !searchInput.value && roleFilter.size) {
      roleFilter.delete([...roleFilter.keys()].pop());
      renderRoleChips();
      renderResults();
    }
  });

  // Base 3 is a plain on/off; difficulty is a two-thumb range (full range =
  // no difficulty filtering).
  let base3Only = false;
  let sortMode = 'name';
  const sortBtns = document.querySelectorAll('.script-lib-sort-btn');
  sortBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sortMode = btn.dataset.sort;
      sortBtns.forEach(b => b.classList.toggle('toggle-btn-active', b === btn));
      renderResults();
    });
  });
  // The full range means no filtering, so unrated scripts still show.
  const difficultyRange = { lo: DIFFICULTY_MIN, hi: DIFFICULTY_MAX };
  const difficultyFiltered = () => difficultyRange.lo > DIFFICULTY_MIN || difficultyRange.hi < DIFFICULTY_MAX;
  const base3Btn = document.getElementById('script-lib-base3-btn');
  base3Btn?.addEventListener('click', () => {
    base3Only = !base3Only;
    base3Btn.classList.toggle('toggle-btn-active', base3Only);
    renderResults();
  });
  let oneDemonOnly = false;
  const oneDemonBtn = document.getElementById('script-lib-one-demon-btn');
  oneDemonBtn?.addEventListener('click', () => {
    oneDemonOnly = !oneDemonOnly;
    oneDemonBtn.classList.toggle('toggle-btn-active', oneDemonOnly);
    renderResults();
  });
  let favouritesOnly = false;
  const favouritesBtn = document.getElementById('script-lib-fav-filter-btn');
  favouritesBtn?.addEventListener('click', () => {
    favouritesOnly = !favouritesOnly;
    favouritesBtn.classList.toggle('toggle-btn-active', favouritesOnly);
    renderResults();
  });
  // Two range inputs stacked on one track; each thumb stops at the other.
  const diffRangeEl = document.getElementById('script-lib-diff-range');
  const diffLo = document.getElementById('script-lib-diff-lo');
  const diffHi = document.getElementById('script-lib-diff-hi');
  const diffValueEl = document.getElementById('script-lib-diff-value');
  function syncDifficulty(moved) {
    let lo = Number(diffLo.value), hi = Number(diffHi.value);
    if (lo > hi) {
      if (moved === diffLo) { lo = hi; diffLo.value = lo; } else { hi = lo; diffHi.value = hi; }
    }
    difficultyRange.lo = lo;
    difficultyRange.hi = hi;
    const pct = (v) => `${((v - DIFFICULTY_MIN) / (DIFFICULTY_MAX - DIFFICULTY_MIN)) * 100}%`;
    diffRangeEl.style.setProperty('--lo', pct(lo));
    diffRangeEl.style.setProperty('--hi', pct(hi));
    diffValueEl.textContent = difficultyFiltered() ? `${lo.toFixed(1)}–${hi.toFixed(1)}` : 'Any';
    diffRangeEl.classList.toggle('active', difficultyFiltered());
  }
  [diffLo, diffHi].forEach(input => input?.addEventListener('input', () => { syncDifficulty(input); renderResults(); }));
  // Pointer handling is ours, not the inputs': a press anywhere on the slider
  // grabs whichever thumb is closer, jumps it there and drags it. The inputs
  // stay for keyboard use.
  const diffValueAt = (clientX) => {
    const r = diffRangeEl.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left - 7) / (r.width - 14)));
    return Math.round((DIFFICULTY_MIN + t * (DIFFICULTY_MAX - DIFFICULTY_MIN)) * 10) / 10;
  };
  diffRangeEl?.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const v = diffValueAt(ev.clientX);
    const lo = Number(diffLo.value), hi = Number(diffHi.value);
    // Thumbs on top of each other: the direction of the press decides.
    const thumb = lo === hi ? (v < lo ? diffLo : diffHi)
      : Math.abs(v - lo) <= Math.abs(v - hi) ? diffLo : diffHi;
    thumb.focus();
    const move = (x) => {
      const next = diffValueAt(x);
      if (Number(thumb.value) === next) return;
      thumb.value = next;
      syncDifficulty(thumb);
      renderResults();
    };
    move(ev.clientX);
    diffRangeEl.setPointerCapture(ev.pointerId);
    diffRangeEl.classList.add('dragging');
    const onMove = (e) => move(e.clientX);
    const onUp = () => {
      diffRangeEl.classList.remove('dragging');
      diffRangeEl.removeEventListener('pointermove', onMove);
      diffRangeEl.removeEventListener('pointerup', onUp);
      diffRangeEl.removeEventListener('pointercancel', onUp);
    };
    diffRangeEl.addEventListener('pointermove', onMove);
    diffRangeEl.addEventListener('pointerup', onUp);
    diffRangeEl.addEventListener('pointercancel', onUp);
  });
  // Double-click resets to the full range.
  diffRangeEl?.addEventListener('dblclick', () => {
    diffLo.value = DIFFICULTY_MIN; diffHi.value = DIFFICULTY_MAX;
    syncDifficulty(null);
    renderResults();
  });
  if (diffRangeEl) syncDifficulty(null);

  (async () => {
    try {
      if (!hasDirectoryPicker()) {
        // Firefox: replay the last scan. The folder can't be reopened without
        // the user picking it again, so Rescan re-prompts.
        const cached = await CompanionDb.getCached(SCRIPT_LIB_CACHE_KEY);
        if (!cached?.length) return;
        scriptLibrary = cached;
        filtersEl.style.display = '';
        rescanBtn.style.display = '';
        setStatus(`${cached.length} scripts (cached)`);
        renderResults();
        return;
      }
      const handle = await loadDirHandle();
      if (!handle) return;
      currentDirHandle = handle;
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        await runScan(handle);
      } else {
        setStatus('Script folder remembered — resume access to rescan.');
        resumeBtn.style.display = '';
      }
    } catch { /* no stored handle or cache — user can pick fresh */ }
  })();
}

// ── WS heartbeat ──────────────────────────────────────────────────────────

// Two questions, answered separately. Is our bridge alive in the botc.app tab?
// — the background pings it every CONN_CHECK_MS and the bridge answers with a
// CONN payload. Is botc.app itself connected? — that CONN carries the app's own
// session state from its store. Frame traffic says neither: a quiet lobby is
// silent for up to a minute with everything healthy.
const CONN_CHECK_MS = 10000;
const CONN_STALE_MS = 3 * CONN_CHECK_MS + 2000; // three pings in a row unanswered
let conn = null;             // last CONN payload from the page bridge
let lastConnTs = Date.now(); // when it arrived (page load until the first one)
let bridgeCheck = null;      // last CHECK_CONNECTION result

function applyConn(data) {
  conn = data;
  lastConnTs = Date.now();
  renderConnStatus();
}

function connStatus() {
  if (bridgeCheck === 'no-tab') return { level: 'warn', text: 'botc.app is not open' };
  if (bridgeCheck === 'asleep') return { level: 'warn', text: 'botc.app tab is asleep — switch to it' };
  if (bridgeCheck === 'failed') return { level: 'bad', text: 'not attached — reload the botc.app tab' };
  if (Date.now() - lastConnTs > CONN_STALE_MS) return { level: 'bad', text: 'bridge not responding — reload the botc.app tab' };
  if (!conn) return { level: '', text: 'connecting…' };
  if (!conn.attached) return { level: 'warn', text: 'waiting for botc.app to load' };
  if (conn.reconnecting) return { level: 'warn', text: 'botc.app is reconnecting…' };
  if (!conn.connected) return { level: '', text: 'no live session' };
  // Game state, nominations, chats and messages come from the store and still
  // work; only the raw frame log is blind until the tab is reloaded.
  if (conn.wsHooked === false) return { level: 'warn', text: 'connected · no WS log until the botc.app tab is reloaded' };
  return { level: 'ok', text: conn.ping > 0 ? `connected · ${conn.ping} ms` : 'connected' };
}

function renderConnStatus() {
  const el = document.getElementById('ws-heartbeat');
  const textEl = document.getElementById('ws-heartbeat-timer');
  if (!el || !textEl) return;
  // Opened straight from disk (dummy mode): there is no extension to talk to.
  if (!chrome.runtime?.id) { textEl.textContent = ''; return; }
  const { level, text } = connStatus();
  textEl.textContent = text;
  el.dataset.level = level;
}

function checkConnection() {
  sendBg({ type: 'CHECK_CONNECTION' }, (response) => {
    const result = response?.result ?? null;
    const wasUp = bridgeCheck === 'alive' || bridgeCheck === 'injected';
    const isUp = result === 'alive' || result === 'injected';
    // Coming back from no tab / asleep: give the bridge a fresh window to
    // answer rather than judging it by a CONN from before the gap.
    if (isUp && !wasUp) { conn = null; lastConnTs = Date.now(); }
    bridgeCheck = result;
    renderConnStatus();
  });
}

checkConnection();
setInterval(checkConnection, CONN_CHECK_MS);
setInterval(renderConnStatus, 1000);

// ── WS log ────────────────────────────────────────────────────────────────

function appendWsEvent(payload) {
  const list = document.getElementById('ws-log');
  const li = document.createElement('li');
  li.className = payload.type === 'WS_RECV' ? 'recv' : 'send';
  const dir = payload.type === 'WS_RECV' ? '←' : '→';
  const body = typeof payload.data === 'object'
    ? JSON.stringify(payload.data, null, 2)
    : String(payload.data);
  const time = new Date(payload.ts ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  li.textContent = `${time} ${dir} ${body}`;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.appendChild(li);
  if (atBottom) list.scrollTop = list.scrollHeight;
}

// ── Player list ───────────────────────────────────────────────────────────
// Seat / player / role table. This is the storyteller's own management tool
// for the live grimoire, so it always reflects ground truth (the actual token
// on the actual seat) — unlike the Notes grid and the timeline/chat name
// coloring, it must NOT be affected by the "source of truth" (grimoire/notes)
// setting. Otherwise a seat swap correctly moves the grimoire token while the
// Players panel keeps showing the stale notes-cached role for that seat.

// Every bundled role icon ships both a "_g" (good) and "_e" (evil) token
// variant, so the art itself can flip with alignment — not just the token
// ring color. A no-op for anything that isn't one of our own "_g"/"_e"-suffixed
// bundled icons (e.g. a custom script's externally-hosted iconUrl).
function alignedIconUrl(url, ge) {
  if (!url) return url;
  if (ge === 'e') return url.replace(/_g\.(\w+)$/, '_e.$1');
  if (ge === 'g') return url.replace(/_e\.(\w+)$/, '_g.$1');
  return url;
}

function playerRoleInfo(p) {
  const roleId = p.roleId || '';
  if (!roleId) return null;
  const role = _roles().find(r => r.id === _normalizeId(roleId));
  const team = role?.team ?? p.team ?? '';
  const iconUrl = role ? _iconUrl(role) : null;
  return {
    name: role?.name ?? p.roleName ?? roleId,
    team,
    iconUrl: alignedIconUrl(iconUrl, impliedAlignmentGE(p)),
  };
}

// Good/evil as 'g'/'e', falling back to the team-implied default for townsfolk/
// outsider/minion/demon (they're always one or the other) — only travellers can
// genuinely have no alignment at all.
function impliedAlignmentGE(p) {
  if (p.alignment === 'good') return 'g';
  if (p.alignment === 'evil') return 'e';
  if (p.team === 'minion' || p.team === 'demon') return 'e';
  if (p.team === 'townsfolk' || p.team === 'outsider') return 'g';
  return null;
}

// Per-day nomination limits (by name, not seat, so they stay correct across a
// mid-day seat swap): each player may nominate once and be nominated once —
// except nominating a traveller doesn't use up the nominator's own nomination
// for the day, since travellers are nominated separately from the main pool.
// A dead Banshee killed by the Demon may nominate twice, the Butcher again once
// someone has died today (any death, not only an execution: these are only
// hints, so they err on the side of allowing), and with a Bishop in play only
// the storyteller nominates, so nobody runs out.
function nominationLimitsToday() {
  const nominatedNames = new Set();
  const usedNominatorNames = new Set();
  const nominationsBy = {};
  // "Today" comes from the timeline — the same source the nominations below are
  // bucketed against — rather than from phaseLabel(currentState.phase). Those
  // two disagree whenever a storyteller doesn't work the day/night toggle: the
  // phase sticks at 0 with no phase events recorded, so this side said 'Day 0'
  // while every nomination said 'Game started' and none of them counted. (Phase
  // 0 also read as falsy, which bailed out before any of that even mattered.)
  // Deriving both sides identically degrades gracefully instead: with no phases
  // tracked at all, the whole game is one bucket.
  const currentDay = gamePhaseAt(Date.now());
  for (const nom of pendingNomination ? [...allNominations, pendingNomination] : allNominations) {
    if (gamePhaseAt(nom.ts) !== currentDay) continue;
    const nominatorName = nomSeatName(nom, nom.nominatorSeat);
    const nomineeName = nomSeatName(nom, nom.nomineeSeat);
    nominatedNames.add(nomineeName);
    const nomineeTeam = currentState?.players?.find(p => displayName(p, p.seat) === nomineeName)?.team;
    if (nomineeTeam !== 'traveller') nominationsBy[nominatorName] = (nominationsBy[nominatorName] ?? 0) + 1;
  }
  if (!abilityHolder('bishop')) {
    const players = currentState?.players ?? [];
    const diedToday = fullTimeline.some(e => e.type === 'death' && phaseForStatusEvent(e) === currentDay);
    for (const [name, count] of Object.entries(nominationsBy)) {
      const p = players.find(pl => displayName(pl, pl.seat) === name);
      const ability = abilityOf(p);
      const allowed = (ability === 'banshee' && p.isDead && hasReminder(p, 'banshee', 'Has Ability'))
        || (ability === 'butcher' && !p.isDead && diedToday) ? 2 : 1;
      if (count >= allowed) usedNominatorNames.add(name);
    }
  }
  return { nominatedNames, usedNominatorNames };
}

// Seat geometry, shared by the seat layout and the nomination hand overlay so
// the two can't drift apart. Seat 1 (index 0) sits at the top of the circle and
// the rest run clockwise, matching a physical grimoire.
const SEAT_R = 42;        // seat centres, in the 0-100 coordinate space
const HAND_R = 33;        // vote hand / nominator tail — stops short of the seat tokens
const HAND_R_NOMINEE = 27; // shorter, so a self-nomination shows both ends
const seatAngle = (idx, n) => (idx / (n || 1)) * 2 * Math.PI - Math.PI / 2;
const seatPos = (idx, n, r) => {
  const a = seatAngle(idx, n);
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
};

// A tapered clock hand pointing along +x from the hub at (50,50), with a short
// counterweight tail. It's rotated into place with a CSS transform, so moving
// between seats sweeps the hand around the dial instead of redrawing it.
function nomHandPath(r) {
  const tipBase = 50 + r - 4, tip = 50 + r + 3;
  return `M45 49.35 L50 48.9 L${tipBase} 49.5 L${tipBase} 47.5 L${tip} 50`
    + ` L${tipBase} 52.5 L${tipBase} 50.5 L50 51.1 L45 50.65 Z`;
}

// The two nomination hands read as one arrow through the hub: a thin dashed
// tail coming in from the nominator (dashes run towards the hub, starting at
// a dot beside their seat) and a heavy arrow going out to the nominee. Only
// the nominee's end has an arrowhead, so the direction can't be read backwards.
function nomTailMarkup(r) {
  return `<line class="nom-tail-line" x1="${50 + r}" y1="50" x2="50" y2="50" />`
    + `<circle class="nom-tail-dot" cx="${50 + r + 1}" cy="50" r="1.7" />`;
}
function nomArrowPath(r) {
  const tipBase = 50 + r - 4, tip = 50 + r + 4;
  return `M50 48.7 L${tipBase} 49.1 L${tipBase} 46.4 L${tip} 50`
    + ` L${tipBase} 53.6 L${tipBase} 50.9 L50 51.3 Z`;
}

const _nomAlerts = () => (typeof BOTC_NOM_ALERTS !== 'undefined' ? BOTC_NOM_ALERTS : []);

// Ghost vote already spent. Like death, this is a token in the status array
// rather than a field of its own.
const isVoteless = (p) => (p?.status ?? []).includes('voteless');

// Reminder tokens are per-seat and come from the live store via page-bridge.
// Matched on role + name, the pair the grimoire actually uses as an identity —
// the numeric token id is stable per token but says nothing on its own.
//
// A flipped token is one the storyteller turned face down to mark the ability as
// droisoned, so it doesn't count — in either direction. A flipped 'Cursed' means
// the Witch's curse won't kill. (The Virgin's 'No Ability' is backed by the
// nomination history, so a flipped one doesn't bring her ability back.)
// isLiveReminder (night steps) does the matching, so aliased and traveller_
// role ids resolve the same way in both places.
const hasReminder = (p, roleId, name) => (p?.reminders ?? []).some(r => isLiveReminder(r, roleId, name));

// Alerts for the nomination being assembled. nominee is null until it's picked,
// so 'nominee'/'pair' rules simply don't fire yet. Every timing comes back
// (a.when); callers pick what they show where.
function nominationAlerts(nominatorSeat, nomineeSeat) {
  const ctx = nomAlertCtx(nomAlertPlayer(nominatorSeat), nomAlertPlayer(nomineeSeat));
  if (!ctx.nominator && !ctx.nominee) return [];
  return runNomAlerts(ctx, r => r.side !== 'none');
}

// What happens if this player is executed (or dies): the 'execution' and
// 'death' rules, with the nominator of their latest nomination today, if any.
function executionAlerts(seat) {
  const nominee = nomAlertPlayer(seat);
  if (!nominee) return [];
  const today = gamePhaseAt(Date.now());
  const nom = allNominations.filter(n => gamePhaseAt(n.ts) === today && n.nomineeSeat === seat).pop();
  const ctx = nomAlertCtx(nomAlertPlayer(nom?.nominatorSeat), nominee);
  return runNomAlerts(ctx, r => r.when === 'execution' || r.when === 'death');
}

// What happens if nobody is executed today.
const noExecutionAlerts = () => runNomAlerts(nomAlertCtx(null, null), r => r.when === 'no-execution');

// Players who died today, by day, and what their death sets off — until the
// storyteller dismisses it. A death in the first 2 minutes of a day is the
// night's (same rule as the notes).
const dismissedDeathAlerts = new Set();
function deathAlertsToday() {
  const today = gamePhaseAt(Date.now());
  if (!/^Day \d+$/.test(today)) return [];
  const players = currentState?.players ?? [];
  const seen = new Set(), out = [];
  for (const ev of [...fullTimeline].reverse()) {
    if (ev.type !== 'death' || phaseForStatusEvent(ev) !== today) continue;
    const p = players.find(pl => pl.id && String(pl.id) === String(ev.playerId)) ?? players.find(pl => pl.name && pl.name === ev.name);
    if (!p || !p.isDead || seen.has(p.seat)) continue;
    seen.add(p.seat);
    const ctx = nomAlertCtx(null, nomAlertPlayer(p.seat));
    for (const a of runNomAlerts(ctx, r => r.when === 'death')) {
      const key = `${today}|${p.id ?? p.name}|${a.id}`;
      if (!dismissedDeathAlerts.has(key)) out.push({ ...a, key, who: dn(displayName(p, p.seat)) });
    }
  }
  return out;
}

function nomAlertPlayer(seat) {
  if (seat === null || seat === undefined) return null;
  const p = (currentState?.players ?? []).find(pl => pl.seat === seat);
  return p ? { ...p, label: dn(displayName(p, p.seat)) } : null;
}

function nomAlertCtx(nominator, nominee) {
  const players = currentState?.players ?? [];
  const nameOf = (p) => displayName(p, p.seat);
  const dayMatch = /^Day (\d+)$/.exec(gamePhaseAt(Date.now()));
  const alive = players.filter(p => !p.isDead).length;
  return {
    nominator, nominee,
    rem: hasReminder,
    ability: abilityOf,
    team: teamOfPlayer,
    good: (p) => { const ge = p ? impliedAlignmentGE(p) : null; return ge === 'g' ? true : ge === 'e' ? false : null; },
    misreg: (p) => (p ? misregistration(p) : null),
    holder: (id) => abilityHolder(id),
    alive,
    aliveBefore: alive + (nominee?.isDead ? 1 : 0),
    day: dayMatch ? Number(dayMatch[1]) : null,
    timesNominated: (p) => allNominations.filter(n => nomSeatName(n, n.nomineeSeat) === nameOf(p)).length,
    timesNominating: (p) => allNominations.filter(n => nomSeatName(n, n.nominatorSeat) === nameOf(p)).length,
  };
}

function runNomAlerts(ctx, keep) {
  const nameOf = (p) => displayName(p, p.seat);
  const out = [];
  for (const rule of _nomAlerts()) {
    if (!keep(rule)) continue;
    if (rule.side === 'nominator' && !ctx.nominator) continue;
    if (rule.side === 'nominee' && !ctx.nominee) continue;
    if (rule.side === 'pair' && !(ctx.nominator && ctx.nominee)) continue;
    let hit, label, holder;
    try {
      hit = rule.test(ctx);
      if (!hit) continue;
      label = typeof rule.label === 'function' ? rule.label(ctx) : rule.label;
      holder = rule.holder?.(ctx) ?? null;
    } catch { continue; }
    const notes = typeof hit === 'string' ? [hit] : [];
    // The ability may not work: say so rather than hide the alert — the
    // reminder may be stale, and the storyteller has the final say.
    const droison = droisonReasons(holder);
    if (droison.length) notes.push('drunk/poisoned?');
    out.push({
      id: rule.id, when: rule.when ?? 'now', level: rule.level, role: rule.role, label,
      note: notes.join(' · '),
      noteTitle: droison.length ? `${dn(nameOf(holder))}: ${droison.join(', ')}` : '',
    });
  }
  return out;
}

// The role id of the ability a player has: their token, unless the token is
// what a Drunk / Marionette / Lunatic thinks they are ("Is the Drunk").
function abilityOf(p) {
  if (!p) return null;
  const token = bundledRoleOf(p), truth = trueRoleOf(p);
  return truth && VIA_IS.has(truth) && truth !== token ? truth : token;
}

// The living player who has this ability, or null — abilities of the dead
// don't count, apart from the Banshee's, handled in the nomination limits.
const abilityHolder = (id) => (currentState?.players ?? []).find(p => !p.isDead && abilityOf(p) === id) ?? null;

// ── Next-nomination setup in the middle of the wheel ──
// While Nominate is on and nothing is happening yet (no open nomination, no
// nominator picked, no alerts), the empty centre holds the nomination type and
// the clock speed. The real controls are moved in and back out, so their own
// handlers and syncing keep working unchanged.
const _nomSetupHomes = {};
function moveNomSetupControl(key, el, into) {
  if (!el) return;
  if (!_nomSetupHomes[key]) _nomSetupHomes[key] = { parent: el.parentNode, next: el.nextSibling };
  if (into) {
    const slot = document.querySelector(`#nom-setup [data-slot="${key}"]`);
    if (slot && el.parentNode !== slot) slot.appendChild(el);
  } else {
    const home = _nomSetupHomes[key];
    if (el.parentNode !== home.parent) home.parent.insertBefore(el, home.next);
  }
}

function updateNomSetup() {
  const panel = document.getElementById('nom-setup');
  if (!panel) return;
  const active = amIStoryteller() && !!voteClock
    && playerActionMode === 'nominate' && !pendingNomination && !awaitingNomination()
    && playerActionPickedSeat === null;
  panel.hidden = !active;
  document.getElementById('player-table')?.classList.toggle('nom-setup-open', active);
  moveNomSetupControl('type', document.getElementById('vt-type'), active);
  moveNomSetupControl('speed', document.querySelector('.vd-speed'), active);
  // Type and speed only matter around nominating: out of the bar when
  // Nominate is off.
  document.getElementById('vote-target')?.classList.toggle('vt-hide-setup', playerActionMode !== 'nominate');
  if (!active) return;
  const exec = document.getElementById('ns-execute');
  if (exec) {
    const marked = (currentState?.players ?? []).find(pl => (pl.status ?? []).includes('marked'));
    exec.textContent = marked ? `Execute ${dn(marked.name)}` : 'No execution · go to night';
    // Going to night without an execution can end the game (Mayor, Vortox).
    const noExec = marked ? [] : noExecutionAlerts();
    const warn = document.getElementById('ns-noexec');
    if (warn) {
      warn.hidden = !noExec.length;
      warn.textContent = noExec.map(a => `${_roles().find(r => r.id === a.role)?.name ?? a.role}: ${a.label}`).join(' · ');
    }
    exec.title = marked
      ? 'Remove the mark, kill them and move on to the night'
      : 'Nobody is marked: move on to the night without an execution';
    exec.classList.toggle('is-execute', !!marked);
  }
  // The clock panel isn't up to sync the slider, so do it here.
  const slider = document.getElementById('vd-speed');
  if (slider && document.activeElement !== slider) slider.value = voteClock?.drive?.speed ?? voteClock?.speed ?? 1000;
  const val = document.getElementById('vd-speed-val');
  if (val && slider) val.textContent = `${(Number(slider.value) / 1000).toFixed(2)}s`;
}

// The alerts of the nomination on the floor, as they were when it was made:
// they stay up through the vote, and the storyteller acting on them (placing
// the Virgin's No Ability, the Witch's victim dying) mustn't make them vanish.
let openNomAlerts = null; // { key, alerts }

// The open nomination — or the one just sent, until botc.app confirms it —
// with its frozen alerts, or null.
function openNominationAlerts() {
  const open = !isPickingNomination() && (pendingNomination ?? (awaitingNomination() ? nominationSent : null));
  if (!open) { openNomAlerts = null; return null; }
  const key = `${open.nominatorSeat}|${open.nomineeSeat}`;
  if (openNomAlerts?.key !== key) openNomAlerts = { key, alerts: nominationAlerts(open.nominatorSeat, open.nomineeSeat) };
  return openNomAlerts.alerts;
}

function nomAlertChipHtml(a, extraClass = '', dismissKey = null) {
  // Icon comes from the bundled role art by id — the role whose ability is
  // firing, which is not necessarily a role anyone at the table can see (the
  // Witch's curse shows the Witch, on the cursed player's own nomination).
  const icon = _iconUrl({ id: a.role });
  const roleName = _roles().find(r => r.id === a.role)?.name ?? a.role;
  return `<div class="nom-alert nom-alert-${a.level}${extraClass}" title="${esc(roleName)}">`
    + (icon ? `<img class="nom-alert-icon" src="${esc(icon)}" alt="${esc(roleName)}" />` : '')
    + `<span class="nom-alert-label">${esc(a.label)}</span>`
    + (a.note ? `<span class="nom-alert-note"${a.noteTitle ? ` title="${esc(a.noteTitle)}"` : ''}>${esc(a.note)}</span>` : '')
    + (dismissKey ? `<button class="nom-alert-dismiss" data-dismiss-alert="${esc(dismissKey)}" title="Dismiss" aria-label="Dismiss">×</button>` : '')
    + `</div>`;
}

const isNowAlert = (a) => a.when === 'now';
const isExecAlert = (a) => a.when === 'execution' || a.when === 'death';

function dayAlertRowHtml(a, dismissKey = null) {
  const icon = _iconUrl({ id: a.role });
  const roleName = _roles().find(r => r.id === a.role)?.name ?? a.role;
  return `<div class="da-row da-${a.level}">`
    + (icon ? `<img class="da-icon" src="${esc(icon)}" alt="" title="${esc(roleName)}" />` : `<span class="da-icon"></span>`)
    // The label carries its own subject; the icon says whose ability it is.
    + `<span class="da-text" title="${esc(roleName)}">${a.who ? `<b>${esc(a.who)}</b>: ` : ''}${esc(a.label)}`
    + (a.note ? ` <span class="da-note"${a.noteTitle ? ` title="${esc(a.noteTitle)}"` : ''}>${esc(a.note)}</span>` : '')
    + `</span>`
    + (dismissKey ? `<button class="nom-alert-dismiss" data-dismiss-alert="${esc(dismissKey)}" title="Dismiss" aria-label="Dismiss">×</button>` : '')
    + `</div>`;
}

// The "Today" panel beside the circle: everything the storyteller has to
// keep in mind by day, up all day rather than only while a nomination is open.
// Rewritten only when it changes, so nothing flickers on unrelated updates.
let _lastDayNom = null;
function renderDayAlerts(nom = _lastDayNom) {
  _lastDayNom = nom;
  const box = document.getElementById('day-alerts');
  if (!box) return;
  const phase = currentState?.phase ?? 0;
  const show = amIStoryteller() && phase > 0 && phase % 2 === 0;
  const sections = [];
  if (show) {
    if (nom) {
      const who = (seat) => (seat === null || seat === undefined) ? '…' : esc(nomAlertPlayer(seat)?.label ?? '?');
      const now = nom.alerts.filter(isNowAlert), exec = nom.alerts.filter(isExecAlert);
      sections.push(`<div class="da-section da-nom${nom.preview ? ' is-preview' : ''}">`
        + `<div class="da-title">${nom.preview ? 'Nominating' : 'Nomination'} <span class="da-pair">${who(nom.nominatorSeat)} → ${who(nom.nomineeSeat)}</span></div>`
        + (now.length ? now.map(a => nomAlertChipHtml(a, ' is-static')).join('') : '')
        + (exec.length ? `<div class="da-sub">If executed</div>` + exec.map(a => dayAlertRowHtml({ ...a, who: '' })).join('') : '')
        + (!now.length && !exec.length ? `<div class="da-empty">Nothing to resolve</div>` : '')
        + `</div>`);
    }
    const deaths = deathAlertsToday();
    if (deaths.length) {
      sections.push(`<div class="da-section"><div class="da-title">Died today</div>`
        + deaths.map(a => dayAlertRowHtml(a, a.key)).join('') + `</div>`);
    }
    // Only once someone is marked: what executing them sets off.
    const marked = (currentState?.players ?? []).find(pl => (pl.status ?? []).includes('marked'));
    const end = marked ? executionAlerts(marked.seat) : [];
    if (end.length) {
      sections.push(`<div class="da-section"><div class="da-title">If ${esc(dn(displayName(marked, marked.seat)))} is executed</div>`
        + end.map(a => dayAlertRowHtml({ ...a, who: '' })).join('') + `</div>`);
    }
  }
  const html = sections.join('');
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  box.hidden = !sections.length;
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dismiss-alert]');
  if (!btn) return;
  dismissedDeathAlerts.add(btn.dataset.dismissAlert);
  renderDayAlerts();
});

function renderNomAlerts() {
  const picking = isPickingNomination();
  let nom = null;
  if (picking) {
    // The hovered seat stands in for the seat about to be picked, so the reminder
    // shows before the click rather than after the nomination is already in.
    const [a, b] = playerActionPickedSeat === null ? [hoveredSeat, null] : [playerActionPickedSeat, hoveredSeat];
    if (a !== null && a !== undefined) nom = { nominatorSeat: a, nomineeSeat: b, alerts: nominationAlerts(a, b), preview: true };
  } else {
    const open = pendingNomination ?? (awaitingNomination() ? nominationSent : null);
    const alerts = openNominationAlerts();
    if (open && alerts) nom = { nominatorSeat: open.nominatorSeat, nomineeSeat: open.nomineeSeat, alerts };
  }
  renderDayAlerts(nom);
  const phase = document.getElementById('circle-phase');
  if (phase) phase.hidden = !!pendingNomination;
  updateNomSetup();
}

// The nomination that's open right now, reduced to what the wheel shows:
// whose hands are up (live while voting, the final snapshot once counted)
// and how that compares with what an execution needs.
function liveNominationState() {
  const nom = pendingNomination;
  if (!nom) return null;
  const handSeats = nom.counted
    ? (nom.yesSeats ?? [])
    : Object.entries(nom.handState ?? {}).filter(([, v]) => v === 1).map(([s]) => Number(s));
  const needed = typeof nom.highscore === 'number' ? nom.highscore : null;
  const yes = handSeats.length;
  return {
    nominatorSeat: nom.nominatorSeat,
    nomineeSeat: nom.nomineeSeat,
    nominator: nomSeatName(nom, nom.nominatorSeat),
    nominee: nomSeatName(nom, nom.nomineeSeat),
    hands: new Set(handSeats),
    yes,
    needed,
    enough: needed !== null && yes >= needed,
    voting: !!nom.voting,
    counted: !!nom.counted,
  };
}

// Centre of the wheel while a nomination is open: who's on the block, the
// running count against the threshold, one pip per vote needed.
let _lastNomYes = null;
function circleNominationHtml(live) {
  if (!live) { _lastNomYes = null; return ''; }
  const state = live.counted ? 'counted' : live.voting ? 'voting' : 'open';
  const stateLabel = live.counted ? 'Vote counted' : live.voting ? 'Voting' : 'Nominated';
  const needed = live.needed;
  let verdict = '';
  if (needed !== null) {
    if (live.counted) verdict = live.enough ? 'On the block' : 'Not enough votes';
    else if (live.enough) verdict = 'Enough to execute';
    else verdict = `${needed - live.yes} more to execute`;
  }
  const pipCount = needed !== null ? Math.max(needed, live.yes) : 0;
  const pips = pipCount && pipCount <= 20
    ? `<span class="cn-pips">${Array.from({ length: pipCount }, (_, i) =>
        `<span class="cn-pip${i < live.yes ? ' on' : ''}${i >= (needed ?? 0) ? ' extra' : ''}"></span>`).join('')}</span>`
    : '';
  // Pop the count only when it actually changed, not on every unrelated redraw.
  const bump = _lastNomYes !== null && _lastNomYes !== live.yes;
  _lastNomYes = live.yes;
  return `<div id="circle-nom" class="is-${state}${live.enough ? ' is-enough' : ''}${bump ? ' cn-bump' : ''}">`
    + `<span class="cn-state">${stateLabel}</span>`
    + `<span class="cn-pair"><span class="cn-nominator">${esc(dn(live.nominator))}</span>`
    + `<span class="cn-arrow">→</span><span class="cn-nominee">${esc(dn(live.nominee))}</span></span>`
    + `<span class="cn-count"><span class="cn-yes">${live.yes}</span><span class="cn-of">/ ${needed ?? '?'}</span></span>`
    + pips
    + (verdict ? `<span class="cn-verdict">${verdict}</span>` : '')
    + `</div>`;
}

// Phase readout parked in the middle of the circle: what part of the game it
// is, and how many votes an execution needs right now.
function circlePhaseHtml(players) {
  const phase = currentState?.phase;
  if (!phase) return '';
  const isNight = phase % 2 === 1;
  const alive = players.filter(p => !p.isDead).length;
  const needed = votesToExecute();
  return `<div id="circle-phase" class="${isNight ? 'is-night' : 'is-day'}"${pendingNomination ? ' hidden' : ''}>`
    + `<span class="cp-ordinal">The ${phaseOrdinal(phase)}</span>`
    + `<span class="cp-phase">${isNight ? 'Night' : 'Day'}</span>`
    + `<span class="cp-stats">${alive} alive · ${needed} ${needed === 1 ? 'vote' : 'votes'} to execute</span>`
    + `</div>`;
}

// Last rotation of each hand in degrees, kept across hides and across the
// innerHTML rebuild in renderPlayers, so a hand always sweeps from where it was.
const nomHandDeg = { nominator: null, nominee: null, vote: null };

// Rotate one hand to point at a seat index (null hides it). Takes the short
// way round the dial; snaps without a sweep the first time it appears.
function placeNomHand(svg, key, target, n) {
  const g = svg.querySelector(`.nom-hand-${key}`);
  if (!g) return;
  const show = !!target && target.idx >= 0;
  g.classList.toggle('is-hidden', !show);
  if (!show) return;
  g.classList.toggle('is-preview', !!target.preview);
  let deg = seatAngle(target.idx, n) * 180 / Math.PI;
  const prev = nomHandDeg[key];
  const snapTo = (d) => {
    g.style.transition = 'none';
    g.style.transform = `rotate(${d}deg)`;
    g.getBoundingClientRect();
    g.style.transition = '';
  };
  if (prev === null) {
    snapTo(deg);
  } else {
    // A full lap is allowed for the vote hand (it goes all the way round);
    // the others take the short way.
    if (target.forward) {
      while (deg < prev - 0.01) deg += 360;
      if (deg - prev > 359.99) deg -= 360;
    } else {
      deg = prev + ((((deg - prev) % 360) + 540) % 360) - 180;
    }
    if (g.style.transform === '') snapTo(prev);
    g.style.transform = `rotate(${deg}deg)`;
  }
  nomHandDeg[key] = deg;
}

// ── Vote clock ──
// botc.app's own clock position, pushed by the bridge on every tick (see
// voteClockOf in page-bridge.js). Countdowns, speed changes, pauses and resets
// all come through as changes to `locked`, so nothing here has to guess.
let voteClock = null; // { nomination, locked, speed, isInProgress, paused }
let lastVoteStep = 0;

// How far round the clock is: 0 before it starts, 1..n as it reaches each seat
// after the nominee (n = back on the nominee). botc.app draws its hand on
// nominee + locked, so the step is `locked` itself.
function voteClockStep(nom, n) {
  const locked = voteClock?.locked;
  if (typeof locked !== 'number') return nom?.counted ? n : 0;
  return Math.max(0, Math.min(n, locked));
}

// How many seats after the nominee are locked in: the app locks everything
// strictly behind its hand, and past the last seat the nominee too.
function voteLockedArc(nom, n) {
  const locked = voteClock?.locked;
  if (typeof locked !== 'number') return voteClockStep(nom, n);
  return Math.max(0, locked);
}

function isVoteRunning(nom) {
  return voteClock ? voteClock.isInProgress && !!voteClock.nomination : !!nom?.voting;
}

// Moves the vote hand and marks which seats the clock has already counted.
// Cheap DOM updates only, so it can run on a short interval while voting.
function updateVoteClock() {
  const svg = document.getElementById('nom-hands');
  const table = document.getElementById('player-table');
  if (!svg || !table) return;
  const players = currentState?.players ?? [];
  const n = players.length;
  const nom = pendingNomination;
  const running = !!nom && isVoteRunning(nom) && !isPickingNomination();
  table.classList.toggle('vote-running', running);
  if (!running) {
    table.classList.remove('vote-countdown', 'vote-paused');
    placeNomHand(svg, 'vote', null, n);
    nomHandDeg.vote = null;
    lastVoteStep = 0;
    table.querySelectorAll('.player-seat.vote-passed').forEach(el => el.classList.remove('vote-passed'));
    updateVoteDrive();
    return;
  }
  const nomineeIdx = players.findIndex(pl => pl.seat === nom.nomineeSeat);
  if (nomineeIdx < 0) return;
  const step = voteClockStep(nom, n);
  // A reset sends the hand back to the start: snap there rather than sweeping
  // forward a whole lap.
  if (step < lastVoteStep) nomHandDeg.vote = null;
  lastVoteStep = step;
  const countdown = voteClock?.locked === -1;
  const paused = !!voteClock?.paused;
  table.classList.toggle('vote-countdown', countdown);
  table.classList.toggle('vote-paused', paused);
  // The centre card's state line follows the clock between full re-renders.
  const stateEl = table.querySelector('#circle-nom .cn-state');
  if (stateEl) stateEl.textContent = countdown ? 'Get ready' : paused ? 'Vote paused'
    : voteClock?.drive?.active ? 'Voting · you drive' : 'Voting';
  placeNomHand(svg, 'vote', { idx: (nomineeIdx + step) % n, forward: true }, n);
  // Seats strictly behind the hand have been counted.
  const arc = voteLockedArc(nom, n);
  players.forEach((pl, idx) => {
    const offset = (idx - nomineeIdx + n) % n || n; // nominee counts last
    table.querySelector(`.player-seat[data-seat="${pl.seat}"]`)
      ?.classList.toggle('vote-passed', offset < arc);
  });
  updateVoteDrive();
}

// ── Vote clock controls (storyteller) ──
// Drives botc.app's clock from here — see the driver in page-bridge.js. Only
// the hand's position is shared with players, so everything here shows up on
// their screens as the hand moving.
const VOTE_PATTERN_LABELS = { steady: 'Steady', accelerate: 'Speeding up', decelerate: 'Slowing down', stutter: 'Stutter', wobble: 'Wobble' };

// Whether the extra clock tools panel is open; remembered between sessions.
// They're just for fun, so they stay folded away unless asked for.
const CLOCK_TOOLS_KEY = 'botc.clockToolsOpen';
let clockToolsOpen = false;
try { clockToolsOpen = localStorage.getItem(CLOCK_TOOLS_KEY) === '1'; } catch { /* ignore */ }
document.getElementById('vd-tools-toggle')?.addEventListener('click', () => {
  clockToolsOpen = !clockToolsOpen;
  try { localStorage.setItem(CLOCK_TOOLS_KEY, clockToolsOpen ? '1' : '0'); } catch { /* ignore */ }
  updateVoteDrive();
});

function sendVoteDrive(action, extra = {}) {
  sendBg({ type: 'VOTE_DRIVE', action, ...extra });
}

function updateVoteDrive() {
  updateVoteTarget();
  updateNomSetup();
  const el = document.getElementById('vote-drive');
  if (!el) return;
  const vc = voteClock;
  const show = !!vc?.nomination && amIStoryteller();
  // Everyday controls sit in the middle of the wheel; the extra clock tools
  // (stepping, pointing, speed, patterns) only when asked for.
  const core = document.getElementById('vd-core');
  if (core) { core.hidden = !show; placeVdCore(); }
  // The extra clock tools take the place of the seat actions (swap, add
  // seat…) under the circle while a nomination is open: nothing covered.
  el.hidden = !show;
  const seatActions = document.getElementById('players-seat-actions');
  if (seatActions) seatActions.hidden = show;
  if (!show) {
    // Seat-picking modes that only make sense with a nomination open.
    if (playerActionMode === 'point' || playerActionMode === 'attorney') setPlayerActionMode(playerActionMode); // toggles off
    return;
  }
  const n = currentState?.players?.length ?? 0;
  const inProgress = !!vc.isInProgress;
  const driving = !!vc.drive?.active;
  // Open while they're driving the hand, so its status and Hand back stay in reach.
  const toolsOpen = clockToolsOpen || driving;
  document.getElementById('vd-tools-body').hidden = !toolsOpen;
  const toolsToggle = document.getElementById('vd-tools-toggle');
  toolsToggle.setAttribute('aria-expanded', String(toolsOpen));
  toolsToggle.disabled = driving;
  toolsToggle.querySelector('.vd-tools-caret').textContent = toolsOpen ? '▾' : '▸';
  const counted = !inProgress && vc.locked > n;
  const pattern = vc.drive?.pattern ?? 'steady';

  // Pre-vote stages botc.app runs before the clock can start.
  const type = vc.nominationType ?? 'regular';
  const phaseStage = !inProgress && type === 'phases' && vc.locked < -1; // -3 accusation, -2 defense
  const needsAttorney = !inProgress && type === 'bigwig' && (vc.selectedPlayer ?? -1) < 0;
  const hasAttorney = type === 'bigwig' && (vc.selectedPlayer ?? -1) >= 0;
  const [nominatorIdx, nomineeIdx] = vc.nomination;
  const stage = document.getElementById('vd-stage');
  const nextPhase = document.getElementById('vd-next-phase');
  stage.hidden = !(phaseStage || (type === 'bigwig' && !inProgress));
  nextPhase.hidden = !phaseStage;
  document.getElementById('vd-attorney').hidden = !needsAttorney;
  document.getElementById('vd-attorney').classList.toggle('toggle-btn-active', playerActionMode === 'attorney');
  document.getElementById('vd-attorney-clear').hidden = !hasAttorney;
  document.getElementById('vd-stage-text').textContent =
    phaseStage ? (vc.locked === -3 ? `Accusation: ${dn(seatName(nominatorIdx))}` : `Defense: ${dn(seatName(nomineeIdx))}`)
    : needsAttorney ? 'Choose a defense attorney'
    : hasAttorney ? `Defense attorney: ${dn(seatName(vc.selectedPlayer))}`
    : '';
  nextPhase.textContent = vc.locked === -3 ? 'Go to Defense' : 'Open Chat';
  if (playerActionMode === 'attorney' && !needsAttorney) setPlayerActionMode('attorney'); // toggles off

  // Secret vote: only offered when a role allowing it is in play.
  const secret = document.getElementById('vd-secret');
  secret.hidden = !vc.secretVoteRole || !!vc.nomineeIsTraveller;
  document.getElementById('vd-secret-label').textContent = `${vc.secretVoteRole ?? ''}: Secret vote`;
  const secretInput = document.getElementById('vd-secret-input');
  secretInput.checked = !!vc.isHidden;
  secretInput.disabled = inProgress || vc.locked > 0;

  document.getElementById('vd-status').textContent =
    counted ? 'Counted'
    : !inProgress ? 'Not started'
    : vc.locked === -1 ? 'Countdown'
    : vc.paused ? 'Paused'
    : driving ? `You're driving · ${VOTE_PATTERN_LABELS[pattern] ?? pattern}`
    : 'botc.app is driving';
  el.classList.toggle('is-driving', inProgress && driving && !vc.paused);

  // Same split as botc.app's overlay: Countdown/Start(Restart) before a count,
  // Pause/Reset during one; plus our own driving controls while it runs.
  // The app swaps Countdown/Start out while a pre-vote stage is pending.
  const preVoteBlocked = phaseStage || needsAttorney;
  document.getElementById('vd-countdown').hidden = inProgress || preVoteBlocked;
  const start = document.getElementById('vd-start');
  start.hidden = inProgress || preVoteBlocked;
  start.querySelector('.vd-start-label').textContent = vc.locked > 0 ? 'Restart' : 'Start';
  start.classList.toggle('is-restart', vc.locked > 0);

  const pause = document.getElementById('vd-pause');
  pause.hidden = !inProgress;
  pause.disabled = vc.locked < 1; // nothing to pause during the countdown
  pause.dataset.paused = vc.paused ? '1' : '';
  pause.querySelector('.vd-pause-label').textContent = vc.paused ? 'Resume' : 'Pause';

  for (const id of ['vd-reset', 'vd-back', 'vd-fwd', 'vd-point', 'vd-finish']) {
    document.getElementById(id).hidden = !inProgress;
  }

  const mark = document.getElementById('vd-mark');
  // Mark is for after the count; during it the middle shows Pause/Reset/Close.
  mark.hidden = !!vc.nomineeIsTraveller || inProgress;
  mark.disabled = inProgress || !!vc.isHidden;
  const unmark = counted && vc.tally > 0 && vc.tally === vc.highscore && vc.markedSeat >= 0;
  mark.querySelector('.vd-mark-label').textContent = unmark ? 'Remove mark' : 'Mark';
  mark.title = vc.isHidden ? 'Secret vote: close it instead, then mark by hand'
    : inProgress ? 'Available once the count is over'
    : unmark ? 'Ties the marked player: removes the mark and closes the nomination'
    : 'Mark the nominee for execution and close the nomination';
  document.getElementById('vd-point').classList.toggle('toggle-btn-active', playerActionMode === 'point');
  document.getElementById('player-table')?.classList.toggle('picking-point', playerActionMode === 'point' || playerActionMode === 'attorney');
  if (!inProgress && playerActionMode === 'point') setPlayerActionMode('point');
  document.getElementById('vd-release').hidden = !driving;

  document.querySelectorAll('#vd-patterns [data-pattern]').forEach(b =>
    b.classList.toggle('toggle-btn-active', b.dataset.pattern === pattern));
}

function wireVoteDrive() {
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  on('vd-countdown', () => sendVoteDrive('countdown'));
  on('vd-start', () => sendVoteDrive('start'));
  on('vd-reset', () => sendVoteDrive('reset'));
  on('vd-mark', () => sendVoteDrive('mark'));
  on('vd-close', () => sendVoteDrive('close'));
  on('vd-next-phase', () => sendVoteDrive('next-phase'));
  on('vd-attorney', () => setPlayerActionMode('attorney'));
  on('vd-attorney-clear', () => sendVoteDrive('attorney', { seat: -1 }));
  document.getElementById('vd-secret-input')?.addEventListener('change', () => sendVoteDrive('secret'));
  on('vd-pause', (e) => sendVoteDrive(e.currentTarget.dataset.paused ? 'resume' : 'pause'));
  on('vd-back', () => sendVoteDrive('step', { delta: -1 }));
  on('vd-fwd', () => sendVoteDrive('step', { delta: 1 }));
  on('vd-point', () => setPlayerActionMode('point'));
  on('vd-finish', () => sendVoteDrive('finish'));
  on('vd-release', () => sendVoteDrive('release'));
  const slider = document.getElementById('vd-speed');
  slider?.addEventListener('input', () => {
    document.getElementById('vd-speed-val').textContent = `${(Number(slider.value) / 1000).toFixed(2)}s`;
  });
  // Committed on release, not every pixel of the drag: each change is a frame
  // to every player.
  slider?.addEventListener('change', () => sendVoteDrive('speed', { ms: Number(slider.value) }));
  document.getElementById('vd-patterns')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pattern]');
    if (btn) sendVoteDrive('pattern', { pattern: btn.dataset.pattern });
  });
}
wireVoteDrive();

// ── Votes to execute (storyteller) ──
// botc.app keeps `highscore`, the most votes any nomination got today; the
// number players see is max(majority, highscore + 1). We edit it as "votes to
// execute" and store K − 1, or 0 when K is just the majority (so it keeps
// following the majority if someone dies).
function majorityNow() {
  const alive = (currentState?.players ?? []).filter(p => !p.isDead).length;
  return Math.ceil(alive / 2);
}

function votesToExecute() {
  return Math.max(majorityNow(), (voteClock?.highscore ?? 0) + 1);
}

function setVotesToExecute(k) {
  const m = majorityNow();
  sendBg({ type: 'SET_HIGHSCORE', value: k > m ? k - 1 : 0 });
}

function updateVoteTarget() {
  const el = document.getElementById('vote-target');
  if (!el) return;
  const show = !!voteClock && amIStoryteller() && (currentState?.players?.length ?? 0) > 0;
  el.hidden = !show;
  if (!show) return;
  // Vote speed: settable any time, like botc.app's settings slider.
  const slider = document.getElementById('vd-speed');
  const speed = voteClock.drive?.speed ?? voteClock.speed ?? 1000;
  if (document.activeElement !== slider) slider.value = speed;
  document.getElementById('vd-speed-val').textContent = `${(Number(slider.value) / 1000).toFixed(2)}s`;

  // Nomination type: locked during a count and while the Big Wig forces its own.
  const typeSel = document.getElementById('vt-type');
  const type = voteClock.nominationType ?? 'regular';
  if (document.activeElement !== typeSel) typeSel.value = type;
  typeSel.querySelector('option[value="bigwig"]').hidden = type !== 'bigwig';
  typeSel.disabled = !!voteClock.bigwigInPlay || !!voteClock.isInProgress || voteClock.locked > 0;
  typeSel.title = voteClock.bigwigInPlay ? 'The Big Wig is in play: every nomination uses its rules'
    : typeSel.disabled ? 'Can’t change during a count' : 'Who may talk during a nomination';
  const m = majorityNow();
  const h = voteClock.highscore ?? 0;
  const k = votesToExecute();
  document.getElementById('vt-value').textContent = k;
  document.getElementById('vt-note').textContent = h >= m ? `tie at ${h}` : 'majority';
  document.getElementById('vt-minus').disabled = k <= m;
  document.getElementById('vt-reset').hidden = h === 0;
}

// Shut up and listen: on while the bridge holds its seat; can start over an
// open nomination (not mid-count) with a free seat (botc.app caps at 20) and
// the type free to change.
function updateShutUpButton() {
  const btn = document.getElementById('players-shut-up-btn');
  if (!btn) return;
  const on = !!voteClock?.shutUp;
  btn.classList.toggle('toggle-btn-active', on);
  const why = !voteClock ? 'Not connected to botc.app'
    : on ? ''
    : (currentState?.players?.length ?? 0) >= 20 ? 'All 20 seats are taken'
    : voteClock.isInProgress || (voteClock.nomination && voteClock.locked > 0 && voteClock.locked <= (currentState?.players?.length ?? 0)) ? 'A vote is being counted'
    : voteClock.bigwigInPlay ? 'The Big Wig is in play: the nomination type can’t change'
    : '';
  btn.disabled = !!why;
  btn.title = why || (on ? 'Scrap the nomination, restore the nomination type and remove the seat'
    : 'Add an empty seat that nominates itself under nominee focus, so nobody has the floor. Click again to scrap it and put things back');
}

function wireVoteTarget() {
  document.getElementById('vt-minus')?.addEventListener('click', () => setVotesToExecute(votesToExecute() - 1));
  document.getElementById('vt-plus')?.addEventListener('click', () => setVotesToExecute(votesToExecute() + 1));
  document.getElementById('vt-reset')?.addEventListener('click', () => sendBg({ type: 'SET_HIGHSCORE', value: 0 }));
  document.getElementById('vt-type')?.addEventListener('change', (e) => sendVoteDrive('type', { value: e.target.value }));
}
wireVoteTarget();

function renderNomHands() {
  const svg = document.getElementById('nom-hands');
  if (!svg) return;
  const players = currentState?.players ?? [];
  const n = players.length;
  const idxOf = (seat) => players.findIndex(pl => pl.seat === seat);

  if (!svg.querySelector('.nom-hand')) {
    svg.innerHTML = `<g class="nom-hand nom-hand-nominee is-hidden"><path d="${nomArrowPath(HAND_R_NOMINEE)}" /></g>`
      + `<g class="nom-hand nom-hand-nominator is-hidden">${nomTailMarkup(HAND_R)}</g>`
      + `<g class="nom-hand nom-hand-vote is-hidden"><path d="${nomHandPath(HAND_R + 3)}" /></g>`
      + '<circle class="nom-hand-hub is-hidden" cx="50" cy="50" r="2.4" />';
  }

  // Which seat each hand points at, and whether it's placed or only a preview.
  let nominator = null, nominee = null;
  if (isPickingNomination()) {
    if (playerActionPickedSeat !== null) {
      nominator = { idx: idxOf(playerActionPickedSeat), preview: false };
      // Not skipped when it equals the picked seat: that's a self-nomination, and
      // the shorter nominee hand stays visible inside the nominator's.
      if (hoveredSeat !== null) nominee = { idx: idxOf(hoveredSeat), preview: true };
    } else if (hoveredSeat !== null) {
      nominator = { idx: idxOf(hoveredSeat), preview: true };
    }
  } else if (pendingNomination || awaitingNomination()) {
    // A nomination is open (or just sent): the hands hold on the two players.
    const nom = pendingNomination ?? nominationSent;
    nominator = { idx: idxOf(nom.nominatorSeat), preview: false };
    nominee = { idx: idxOf(nom.nomineeSeat), preview: false };
  }

  placeNomHand(svg, 'nominator', nominator, n);
  placeNomHand(svg, 'nominee', nominee, n);
  svg.querySelector('.nom-hand-hub').classList.toggle('is-hidden', !nominator && !nominee);

  // Seat rings follow the same state: who's picked, who the next click would pick.
  const table = document.getElementById('player-table');
  const picking = isPickingNomination();
  table?.classList.toggle('picking-nominator', picking && playerActionPickedSeat === null);
  table?.classList.toggle('picking-nominee', picking && playerActionPickedSeat !== null);
  table?.classList.toggle('nom-live', !!pendingNomination && !picking);
  updateVoteClock();
}

function renderPlayers() {
  updateShutUpButton();
  const table = document.getElementById('player-table');
  if (!table) return;
  const players = currentState?.players ?? [];
  const n = players.length;
  // Seats sit on a ring at 42% radius (see cx/cy below); as more seats are
  // added, the straight-line gap between adjacent seats' centers (the chord)
  // shrinks even though the circle's on-screen size doesn't, so labels start
  // overlapping neighboring tokens. Grow the circle's diameter so that chord
  // stays >= a fixed pixel budget, keeping label spacing roughly constant
  // regardless of player count (still bounded by the container's own width).
  const minChordPx = 100;
  const neededDiameter = n > 1 ? minChordPx / (0.84 * Math.sin(Math.PI / n)) : 420;
  table.style.maxWidth = `${Math.round(Math.max(600, Math.min(1100, neededDiameter)))}px`;
  // Only computed while actively picking a nominator/nominee — cheap to build
  // (walks allNominations once), but pointless otherwise.
  const nomLimits = isPickingNomination() ? nominationLimitsToday() : null;
  // Locked out while a seat-pick mode is running: pointer-events:none in CSS
  // means a stray click lands on the seat and picks it, the same as clicking any
  // other part of the seat, instead of killing someone by accident.
  const badgeLock = playerActionMode ? ' seat-badge-locked' : '';
  const badgeDisabled = playerActionMode ? ' disabled' : '';
  const liveNom = liveNominationState();
  const seats = players.map((p, idx) => {
    const name = displayName(p, p.seat);
    const role = playerRoleInfo(p);
    const tokenFill = role?.iconUrl ? ` style="background-image:url('${esc(role.iconUrl)}')"` : '';
    const tokenLabel = !role?.iconUrl ? esc((role?.name ?? '?').slice(0, 1)) : '';
    const ge = impliedAlignmentGE(p);
    const alignClass = ge === 'g' ? 'align-dot-good' : ge === 'e' ? 'align-dot-evil' : 'align-dot-none';
    // Alignment (good/evil), when set (or team-implied), overrides the role-team
    // color — it's the ST-controllable axis, and can diverge from the role's team.
    // The token icon itself also flips good/evil art (see alignedIconUrl); this
    // recolors the ring/label to match as a second, redundant visual cue. Falls
    // back to p.team directly (not playerTeamByName, which honors the notes/
    // grimoire source-of-truth toggle) — this panel always shows ground truth.
    const nameColorClass = ge === 'g' ? 'townsfolk' : ge === 'e' ? 'demon' : (p.team || '');
    const tokenColorClass = role ? nameColorClass : 'token-empty';
    // Nominate mode: before a nominator is picked, flag whoever has already
    // used their nomination today; after, flag whoever has already been
    // nominated today. Visual only — clicking still works either way, since
    // the storyteller may have a legitimate reason to override (corrections,
    // house rules, a missed exception).
    const nomIneligible = nomLimits && (playerActionPickedSeat === null
      ? nomLimits.usedNominatorNames.has(name)
      : nomLimits.nominatedNames.has(name));
    const seatClasses = [
      'player-seat',
      p.isDead ? 'dead' : '',
      playerActionMode ? 'pa-selectable' : '',
      playerActionMode && playerActionPickedSeat === p.seat ? 'pa-picked' : '',
      nomIneligible ? 'pa-ineligible' : '',
      liveNom && p.seat === liveNom.nominatorSeat ? 'nom-live-nominator' : '',
      liveNom && p.seat === liveNom.nomineeSeat ? 'nom-live-nominee' : '',
      liveNom?.hands.has(p.seat) ? 'nom-hand-up' : '',
      (p.status ?? []).includes('marked') ? 'is-marked' : '',
    ].filter(Boolean).join(' ');
    const pos = seatPos(idx, n, SEAT_R);
    const cx = pos.x.toFixed(2);
    const cy = pos.y.toFixed(2);
    const nomIneligibleTitle = nomIneligible
      ? (playerActionPickedSeat === null ? 'Already nominated someone today' : 'Already nominated today')
      : '';
    return `<div class="${seatClasses}" data-seat="${p.seat}" style="left:${cx}%;top:${cy}%"${nomIneligibleTitle ? ` title="${esc(nomIneligibleTitle)}"` : ''}>
      <div class="seat-token-wrap">
        ${(p.status ?? []).includes('marked') ? `<span class="seat-mark-skull" title="Marked">${ICON_SVG.markSkull}</span>` : ''}
        ${liveNom?.hands.has(p.seat) ? `<span class="seat-hand-badge" title="${liveNom.counted ? 'Voted yes' : 'Hand up'}">${ICON_SVG.hand}</span>` : ''}
        <span class="seat-num-badge">${p.seat + 1}</span>
        <button class="player-role-btn seat-token ${tokenColorClass}" data-seat="${p.seat}" title="${role ? esc(role.name) : 'Set role'}"${tokenFill}>${tokenLabel}</button>
        <button class="align-cycle-btn seat-align-badge ${alignClass}" data-seat="${p.seat}" title="Cycle alignment"></button>
        <button class="seat-remove-x-btn seat-remove-badge" data-seat="${p.seat}" data-occupied="${p.id ? '1' : ''}" title="Remove seat">✕</button>
        <button class="seat-life-btn seat-life-badge${badgeLock}" data-seat="${p.seat}" data-kill="${p.isDead ? '' : '1'}"${badgeDisabled} title="${p.isDead ? 'Revive' : 'Kill'}" aria-label="${p.isDead ? 'Revive' : 'Kill'}">${p.isDead ? ICON_SVG.revive : ICON_SVG.skull}</button>
        ${p.isDead ? `<button class="seat-vote-btn seat-vote-badge${isVoteless(p) ? ' vote-spent' : ''}${badgeLock}" data-seat="${p.seat}" data-spend="${isVoteless(p) ? '' : '1'}"${badgeDisabled} title="${isVoteless(p) ? 'Ghost vote spent — click to return it' : 'Ghost vote available — click to spend it'}" aria-label="${isVoteless(p) ? 'Return ghost vote' : 'Remove ghost vote'}">${isVoteless(p) ? ICON_SVG.ghostVoteSpent : ICON_SVG.ghostVote}</button>` : ''}
      </div>
      <div class="seat-name-row">
        <span class="player-name role-name ${nameColorClass}" data-player="${esc(name)}">${esc(dn(name))}</span>
      </div>
      ${role ? `<div class="seat-role-label ${tokenColorClass}">${esc(role.name)}</div>` : ''}
    </div>`;
  }).join('');
  // Hands first so the seats paint over them; pointer-events:none in CSS keeps
  // them out of the way of seat clicks. Absolutely positioned inside the circle,
  // so showing them can't shift the layout around them.
  // The hands SVG is created once and never leaves the page: a rebuild only
  // replaces what follows it. Recreating it — or even detaching and re-adding
  // it — replays the hand sweep on every state update: flicker.
  let hands = table.querySelector(':scope > #nom-hands');
  if (!hands) {
    table.innerHTML = `<svg id="nom-hands" viewBox="0 0 100 100" aria-hidden="true"></svg>`;
    hands = table.querySelector('#nom-hands');
  }
  for (const el of [...table.children]) if (el !== hands) el.remove();
  hands.insertAdjacentHTML('afterend', circlePhaseHtml(players) + circleNominationHtml(liveNom) + seats);

  // Only one player can be marked (mid-nomination) at a time, but Mark stays
  // enabled even when someone already has it — picking a new seat just moves
  // the mark there instead of requiring a manual remove first.
  const markedPlayer = players.find(pl => (pl.status ?? []).includes('marked'));
  document.getElementById('players-mark-btn')?.classList.toggle('toggle-btn-active', playerActionMode === 'mark');
  const unmarkBtn = document.getElementById('players-unmark-btn');
  if (unmarkBtn) unmarkBtn.disabled = !markedPlayer;

  // While a pick mode (nominate/swap/mark) is active, the whole seat should be
  // clickable as a single unit — clicking an inner button (role, alignment,
  // remove-seat) picks the seat instead of running that button's own action,
  // which would otherwise fire first via bubbling.
  table.querySelectorAll('.align-cycle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const seat = Number(btn.dataset.seat);
      if (playerActionMode) { handlePlayerActionPick(seat); return; }
      const player = players.find(pl => pl.seat === seat);
      const cur = impliedAlignmentGE(player ?? {});
      // Travellers can be truly unset (3-state cycle); every other team is always
      // one or the other, so just flip between the two.
      const value = player?.team === 'traveller'
        ? (cur === null ? 'g' : cur === 'g' ? 'e' : null)
        : (cur === 'g' ? 'e' : 'g');
      sendBg({ type: 'SET_PLAYER_PROPERTY', seat, property: 'alignment', value });
    });
  });
  table.querySelectorAll('.player-role-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (playerActionMode) { handlePlayerActionPick(Number(btn.dataset.seat)); return; }
      openGameRolePopover(Number(btn.dataset.seat), btn);
    });
  });
  table.querySelectorAll('.seat-remove-x-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const seat = Number(btn.dataset.seat);
      if (playerActionMode) { handlePlayerActionPick(seat); return; }
      if (btn.dataset.occupied && !confirm(`Remove seat ${seat + 1} — a player is sitting there. Continue?`)) return;
      sendBg({ type: 'REMOVE_SEAT', seat });
    });
  });
  table.querySelectorAll('.seat-life-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (playerActionMode) return;
      const seat = Number(btn.dataset.seat);
      const player = players.find(pl => pl.seat === seat);
      // Death lives in the status array, not a boolean — same channel the Mark
      // button uses. Filtering/merging rather than replacing keeps any other
      // token on the seat ('marked') intact.
      const status = player?.status ?? [];
      const value = btn.dataset.kill
        ? [...new Set([...status, 'dead'])]
        // Reviving drops 'voteless' too: a living player votes normally, and the
        // vote badge only exists on dead seats — left behind, that token would be
        // unreachable from here.
        : status.filter(t => t !== 'dead' && t !== 'voteless');
      sendBg({ type: 'SET_PLAYER_PROPERTY', seat, property: 'status', value });
    });
  });
  table.querySelectorAll('.seat-vote-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (playerActionMode) return;
      const seat = Number(btn.dataset.seat);
      const status = players.find(pl => pl.seat === seat)?.status ?? [];
      const value = btn.dataset.spend
        ? [...new Set([...status, 'voteless'])]
        : status.filter(t => t !== 'voteless');
      sendBg({ type: 'SET_PLAYER_PROPERTY', seat, property: 'status', value });
    });
  });
  // `table` is a persistent container (only its innerHTML is replaced above),
  // so this delegated listener is wired once and reused across re-renders.
  if (!table.dataset.pickListenerWired) {
    table.dataset.pickListenerWired = '1';
    table.addEventListener('click', (e) => {
      if (!playerActionMode) return;
      const seatEl = e.target.closest('.player-seat[data-seat]');
      if (!seatEl) return;
      // Marked for the document-level handlers further up the bubble path: this
      // click has been spent on a seat pick. The mark travels with the event
      // instead of being read back off playerActionMode, because completing a
      // pick clears that mode — so by the time the click reaches document, the
      // "are we picking?" answer would already be stale. Not stopPropagation():
      // the popup closers on document still want to see this click.
      e.botcSeatPick = true;
      handlePlayerActionPick(Number(seatEl.dataset.seat));
    });
    // Hover drives the hand preview. On the table rather than the seats, so it
    // survives the innerHTML rewrite every renderPlayers does.
    // Moving from one seat to the next crosses the gap between them. Letting
    // go of the hover there would drop the preview and alerts for a moment and
    // bring them back on the next seat — flicker. So a gap only clears the
    // hover if the cursor stays off the seats for a short while.
    let hoverClearTimer = null;
    const setHovered = (seat) => {
      clearTimeout(hoverClearTimer);
      hoverClearTimer = null;
      if (seat === hoveredSeat) return;
      hoveredSeat = seat;
      renderNomHands();
      renderNomAlerts();
    };
    const clearHoveredSoon = () => {
      if (hoveredSeat === null || hoverClearTimer) return;
      hoverClearTimer = setTimeout(() => setHovered(null), 150);
    };
    table.addEventListener('mouseover', (e) => {
      const seatEl = e.target.closest('.player-seat[data-seat]');
      if (seatEl) setHovered(Number(seatEl.dataset.seat));
      else clearHoveredSoon();
    });
    table.addEventListener('mouseleave', clearHoveredSoon);
  }
  renderNomHands();
  renderNomAlerts();
  placeVdCore();
  applyHighlights(); applyPinnedHighlights();
}

// The vote buttons hang just under the nomination card, whose height changes
// with its alerts.
function placeVdCore() {
  const core = document.getElementById('vd-core');
  const card = document.getElementById('circle-nom');
  const scroll = document.getElementById('player-table-scroll');
  if (!core || core.hidden || !card || card.hidden || !scroll) return;
  const top = card.getBoundingClientRect().bottom - scroll.getBoundingClientRect().top + scroll.scrollTop + 10;
  core.style.top = `${Math.round(top)}px`;
}

// Add-seat button "floats" pinned under the cursor after a click, so mashing
// it several times in a row (each click grows the table beneath it, which
// would otherwise shove the button away from the mouse) doesn't require
// re-aiming. Once the cursor leaves, it eases back to its natural spot.
function initAddSeatFloatButton() {
  const btn = document.getElementById('players-add-seat-btn');
  if (!btn) return;
  let spacer = null;
  let floating = false;
  let returning = false;

  function freezeInPlace() {
    if (floating || returning) return;
    const rect = btn.getBoundingClientRect();
    spacer = document.createElement('div');
    spacer.style.width = `${rect.width}px`;
    spacer.style.height = `${rect.height}px`;
    spacer.style.alignSelf = getComputedStyle(btn).alignSelf;
    spacer.style.marginTop = getComputedStyle(btn).marginTop;
    btn.insertAdjacentElement('afterend', spacer);
    btn.style.transition = 'none';
    btn.style.position = 'fixed';
    btn.style.margin = '0';
    btn.style.left = `${rect.left}px`;
    btn.style.top = `${rect.top}px`;
    btn.style.width = `${rect.width}px`;
    btn.style.zIndex = '50';
    floating = true;
  }

  function returnHome() {
    if (!floating || returning) return;
    returning = true;
    const homeRect = spacer.getBoundingClientRect();
    let fallbackTimer = null;
    const cleanup = () => {
      clearTimeout(fallbackTimer);
      btn.removeEventListener('transitionend', cleanup);
      btn.style.position = '';
      btn.style.left = '';
      btn.style.top = '';
      btn.style.width = '';
      btn.style.margin = '';
      btn.style.transition = '';
      btn.style.zIndex = '';
      spacer?.remove();
      spacer = null;
      floating = false;
      returning = false;
    };
    requestAnimationFrame(() => {
      btn.style.transition = 'left 0.6s ease, top 0.6s ease';
      btn.style.left = `${homeRect.left}px`;
      btn.style.top = `${homeRect.top}px`;
    });
    btn.addEventListener('transitionend', cleanup);
    // If the button was already at its home position (e.g. the seat-add round
    // trip hadn't reflowed the layout yet), left/top never change, so
    // transitionend never fires — without this, cleanup would never run and
    // the button would get stuck "floating" forever, ignoring further clicks.
    fallbackTimer = setTimeout(cleanup, 700);
  }

  btn.addEventListener('click', () => {
    sendBg({ type: 'ADD_SEAT' });
    freezeInPlace();
  });
  btn.addEventListener('mouseleave', () => {
    if (floating) returnHome();
  });
}

function setPlayerActionMode(mode) {
  playerActionMode = playerActionMode === mode ? null : mode;
  playerActionPickedSeat = null;
  document.getElementById('players-nominate-btn')?.classList.toggle('toggle-btn-active', playerActionMode === 'nominate');
  document.getElementById('players-swap-btn')?.classList.toggle('toggle-btn-active', playerActionMode === 'swap');
  renderPlayers();
}

// Nominate mode stays on between nominations, but while one is open the wheel
// shows that nomination (hands, count, vote clock) — picking only takes over
// again once the storyteller actually starts a new pick.
function isPickingNomination() {
  return playerActionMode === 'nominate'
    && ((!pendingNomination && !awaitingNomination()) || playerActionPickedSeat !== null);
}

// A nomination we just sent, until botc.app confirms it (or 3s pass). In that
// gap the hands hold on the two seats instead of dropping back to the picking
// preview and swinging round, only to swing back when the nomination lands.
let nominationSent = null; // { nominatorSeat, nomineeSeat, at }
function awaitingNomination() {
  return !!nominationSent && !pendingNomination && Date.now() - nominationSent.at < 3000;
}

function handlePlayerActionPick(seat) {
  if (playerActionMode === 'point') {
    // Stays on, so the hand can be thrown around seat after seat.
    sendVoteDrive('point', { seat });
    return;
  }
  if (playerActionMode === 'attorney') {
    sendVoteDrive('attorney', { seat });
    setPlayerActionMode('attorney'); // toggles off
    return;
  }
  if (playerActionMode === 'nominate') {
    if (playerActionPickedSeat === null) {
      playerActionPickedSeat = seat; // nominator (can equal the nominee for a self-nomination)
      renderPlayers();
      return;
    }
    sendBg({ type: 'NOMINATE', nominatorSeat: playerActionPickedSeat, nomineeSeat: seat });
    nominationSent = { nominatorSeat: playerActionPickedSeat, nomineeSeat: seat, at: Date.now() };
    // If the app never confirms, fall back to picking once the hold runs out.
    setTimeout(() => { if (nominationSent && !pendingNomination) { nominationSent = null; renderPlayers(); } }, 3100);
    // Stay in nominate mode so the next nomination can be picked straight away;
    // the button click toggles it off.
    playerActionPickedSeat = null;
    renderPlayers();
    return;
  }
  if (playerActionMode === 'swap') {
    if (playerActionPickedSeat === null) {
      playerActionPickedSeat = seat;
      renderPlayers();
      return;
    }
    if (playerActionPickedSeat === seat) {
      setPlayerActionMode('swap'); // toggles off
      return;
    }
    const n = (currentState?.players ?? []).length;
    const order = [...Array(n).keys()];
    [order[playerActionPickedSeat], order[seat]] = [order[seat], order[playerActionPickedSeat]];
    sendBg({ type: 'SHUFFLE_SEATS', order });
    setPlayerActionMode('swap'); // toggles off
    return;
  }
  if (playerActionMode === 'mark') {
    const prevMarked = (currentState?.players ?? []).find(pl => pl.seat !== seat && (pl.status ?? []).includes('marked'));
    if (prevMarked) {
      sendBg({ type: 'SET_PLAYER_PROPERTY', seat: prevMarked.seat, property: 'status', value: prevMarked.status.filter(s => s !== 'marked') });
    }
    const player = (currentState?.players ?? []).find(pl => pl.seat === seat);
    const value = [...new Set([...(player?.status ?? []), 'marked'])];
    sendBg({ type: 'SET_PLAYER_PROPERTY', seat, property: 'status', value });
    setPlayerActionMode('mark'); // toggles off
  }
}

// ── Night order steps ─────────────────────────────────────────────────────
// Tonight's wake order as a list of steps, one per role holder. How a step
// works comes from data/nightActions.js (how the role wakes, which chip
// inputs are the player's pick / what they're told / your note, follow-up
// messages to other players), on top of the role's chip spec (chipSpecs.js):
//   Ask    → "Make a choice!" / "Use your ability?" (both always on offer —
//            players answer however they like)
//   reply  → their picks fill the pick inputs; "no" to their ability = pass
//   Send   → sends what they learn, Done → finishes without sending
//   notify → one-click messages to other players (target, Demon, Minions)
// Finishing a step writes the ability chip into the holder's cell for this
// night (and a Droisoned chip on the target for poison/drunk roles). A step
// fully answered by the reply finishes by itself.
// Order data: data/nightOrder.js; instructions: data/nightReminders.js;
// suggested answers: data/nightStepHints.js.

const _nightOrder = () => (typeof BOTC_NIGHT_ORDER !== 'undefined' ? BOTC_NIGHT_ORDER : { firstNight: [], otherNight: [] });
const _nightReminders = () => (typeof BOTC_NIGHT_REMINDERS !== 'undefined' ? BOTC_NIGHT_REMINDERS : {});
const _nightStepHints = () => (typeof BOTC_NIGHT_STEP_HINTS !== 'undefined' ? BOTC_NIGHT_STEP_HINTS : {});

// Player inputs whose target becomes drunk/poisoned by the ability.
// (Not the Sailor's target: you decide whether the Sailor or the target is drunk.)
const DROISON_TARGET_LABEL = /^(poisoned|drunk player|host)$/i;
const NUMBER_TOKEN_IDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
// Instructions for the fixed night-sheet markers (roles' own come from
// data/nightReminders.js).
const NIGHT_MARKER_REMINDERS = {
  'Dusk': 'Check that all eyes are closed. Some Travellers & Fabled act.',
  'Minion Info': 'If there are 7 or more players, wake all Minions. Show the *THIS IS THE DEMON* token and point to the Demon. Show the *THESE ARE YOUR MINIONS* token and point to the other Minions.',
  'Demon Info & Bluffs': 'If there are 7 or more players, wake the Demon. Show the *THESE ARE YOUR MINIONS* token and point to all Minions. Show the *THESE CHARACTERS ARE NOT IN PLAY* token and 3 good characters not in play.',
  'Dawn': 'Wait a few seconds, then call for eyes open.',
};

// Our own wording where the official sheet's doesn't fit how the step is used.
const NIGHT_REMINDER_OVERRIDES = {
  // Listed at the start of the night, though the change may happen anywhere in it.
  cacklejack: { other: "If the Cacklejack didn't choose a player today, wake them to choose now. Any other player may change character at any point this night: wake them & show the *YOU ARE* info token & their new character token." },
};

// The night sheet instruction for a role (or marker) tonight, as raw text.
function nightReminderText(bundledId, night) {
  const r = NIGHT_REMINDER_OVERRIDES[bundledId] ?? _nightReminders()[bundledId];
  return (night === 1 ? r?.first : r?.other) ?? '';
}

// *TOKEN* → a token badge, :reminder: → a "place reminder" badge.
function nightReminderHtml(text) {
  return esc(text)
    .replace(/\*([^*]+)\*/g, '<span class="nstep-tok">$1</span>')
    .replace(/:reminder:/g, '<span class="nstep-tok nstep-tok-rem" title="Place the reminder token">◉ reminder</span>');
}

// Hovering a role name (or a marker) in the night order shows its night-sheet
// instruction in a floating tip — kept out of the list itself, since the
// storyteller usually knows it by heart.
const nightTipEl = document.createElement('div');
nightTipEl.id = 'nstep-tip';
nightTipEl.hidden = true;
document.body.appendChild(nightTipEl);
function showNightTip(anchor) {
  nightTipEl.innerHTML = nightReminderHtml(anchor.dataset.tip);
  nightTipEl.hidden = false;
  const a = anchor.getBoundingClientRect();
  const w = nightTipEl.offsetWidth, h = nightTipEl.offsetHeight;
  // Prefer the left of the anchor (the list sits at the right edge), else below.
  let left = a.left - w - 10, top = a.top - 4;
  if (left < 8) { left = Math.max(8, Math.min(a.left, innerWidth - w - 8)); top = a.bottom + 6; }
  top = Math.max(8, Math.min(top, innerHeight - h - 8));
  nightTipEl.style.left = `${left}px`;
  nightTipEl.style.top = `${top}px`;
}

// Day abilities whose holder comes to the storyteller for information — listed
// under the night as a reminder to have it ready.
const DAY_INFO_REMINDERS = {
  savant: 'visits for 2 facts each day',
  fisherman: 'may visit once for advice',
};

// stepKey (`${session}@${game start}|${night}|${roleId}|${holder notes name}`) →
// { inputs: {i0: …}, src: {i0: 'reply'|'manual'|'hint'}, done, askedAt,
//   passed, used, notified: {idx: true} }
let nightSteps = {};
let nightStepExpanded = null; // stepKey the storyteller opened by hand (null → the active step)
const NIGHT_STEPS_KEY = 'botc-companion-night-steps';

function loadNightSteps() {
  try {
    const s = JSON.parse(localStorage.getItem(NIGHT_STEPS_KEY) || '{}');
    if (s && typeof s.steps === 'object') nightSteps = s.steps;
  } catch { /* ignore */ }
}

// Steps belong to one game: a botc.app session (the room) hosts game after
// game, with the same night numbers and often the same players, so the key
// also carries the game's start time from botc.app's history.
function gameStartTs() {
  let ts = null;
  for (const e of fullTimeline) if (e.type === 'start') ts = e.ts;
  return ts;
}
const stepGameKey = () => `${currentState?.session ?? ''}@${gameStartTs() ?? ''}`;

// Only the current game's steps are kept — pruned once its start is known
// (the first render after a reload comes before the history does).
function saveNightSteps() {
  const prefix = `${stepGameKey()}|`;
  if (gameStartTs() !== null) for (const k of Object.keys(nightSteps)) if (!k.startsWith(prefix)) delete nightSteps[k];
  try { localStorage.setItem(NIGHT_STEPS_KEY, JSON.stringify({ steps: nightSteps })); } catch { /* ignore */ }
}


// A player's character (their grimoire token) as a bundled id. The night order
// reads only botc.app's own state — never the notes table.
function bundledRoleOf(p) {
  return p?.roleId ? _normalizeId(p.roleId) : null;
}

// Who a player really is. A Philosopher, Alchemist, Cannibal, … is often
// shown with the token of the character whose ability they have plus an
// "Is the Philosopher" style reminder (likewise "Is the Drunk"); the
// reminder's character is who they are. Team, info about them and the like
// go by this; waking goes by their token (bundledRoleOf).
function trueRoleOf(p) {
  const r = (p?.reminders ?? []).find(r => /^is the /i.test(r.name ?? '') && !(r.flags ?? []).includes('flipped'));
  return r ? _normalizeId(r.role ?? '') : bundledRoleOf(p);
}
const VIA_IS = new Set(['drunk', 'marionette', 'lunatic']); // "is the Drunk", not "via"

// normalized role id → [{ player, via }] — players who wake as that character:
// by their token (via = who they really are, when that's someone else), and by
// who they really are (their own character's steps, e.g. the Alchemist's).
function playersByRoleId() {
  const map = {};
  for (const p of currentState?.players ?? []) {
    const token = bundledRoleOf(p), truth = trueRoleOf(p);
    if (token) (map[token] ??= []).push({ player: p, via: truth && truth !== token ? truth : null });
    if (truth && truth !== token) (map[truth] ??= []).push({ player: p, via: null });
  }
  return map;
}

// The script's own role object for a bundled id (ids can differ in casing/format).
function scriptRoleFor(bundledId) {
  return (currentState?.roles ?? []).find(r => _normalizeId(r.id) === bundledId)
    ?? _roles().find(r => r.id === bundledId) ?? { id: bundledId, name: bundledId };
}

function teamOfPlayer(p) {
  const id = trueRoleOf(p);
  return (id && scriptRoleFor(id).team) || p.team || '';
}
// The script's role ids plus seated Travellers' (they aren't on the script sheet).
function inPlayRoleIds() {
  const ids = new Set((currentState?.roles ?? []).map(r => _normalizeId(r.id)));
  for (const p of currentState?.players ?? []) if (teamOfPlayer(p) === 'traveller' && p.roleId) ids.add(bundledRoleOf(p));
  return ids;
}
const playersOfTeam = (team) => (currentState?.players ?? []).filter(p => teamOfPlayer(p) === team);

// Did one of tonight's steps poison / make drunk this player (the Poisoner's,
// Widow's, … pick)? Returns that character's name, or null.
function droisonedBySteps(player, night) {
  const prefix = `${stepGameKey()}|${night}|`;
  for (const [k, st] of Object.entries(nightSteps)) {
    if (!k.startsWith(prefix)) continue;
    const id = k.split('|')[2];
    const spec = _specs()[id];
    const action = nightActionFor(id, night);
    const hit = (spec?.inputs ?? []).some((s, i) => (s.type === 'player' || s.type === 'player?') && DROISON_TARGET_LABEL.test(s.label)
      && fieldUse(action, i) === 'pick' && st.inputs?.[`i${i}`] === notesNameOf(player));
    if (hit) return scriptRoleFor(id).name ?? id;
  }
  return null;
}

// Who was executed during Day d, from botc.app's own history: a day death
// shortly before the next Night begins (the same rule the notes use).
function executedOnDay(d) {
  if (d < 1) return null;
  const start = fullTimeline.find(e => e.type === 'phase' && e.label === `Day ${d}`)?.ts;
  if (start == null) return null;
  const end = fullTimeline.find(e => e.type === 'phase' && e.ts > start)?.ts ?? Infinity;
  const ev = fullTimeline.filter(e => e.type === 'death' && e.ts >= start && e.ts < end && isExecutionDeath(e)).pop();
  const players = currentState?.players ?? [];
  return ev ? (players.find(p => p.id && String(p.id) === String(ev.playerId)) ?? players.find(p => p.name && p.name === ev.name) ?? null) : null;
}

// ── Night actions (data/nightActions.js) ──

const _nightActions = () => (typeof BOTC_NIGHT_ACTIONS !== 'undefined' ? BOTC_NIGHT_ACTIONS : {});

// The first-night info steps, shown under their night-sheet markers.
const NIGHT_INFO_STEPS = { 'Minion Info': 'minioninfo', 'Demon Info & Bluffs': 'demoninfo' };
const NIGHT_INFO_NAMES = { minioninfo: 'Minion info', demoninfo: 'Demon info' };

// A role's action for this night (first/other overrides merged in). Roles
// without an entry get a plain step.
function nightActionFor(bundledId, night) {
  const base = _nightActions()[bundledId];
  if (!base) return { wake: 'info', plain: true };
  return { ...base, ...((night === 1 ? base.first : base.other) ?? {}) };
}
const fieldUse = (action, i) => action.fields?.[`i${i}`] ?? 'note';
const ASK_LABELS = { choice: 'Make a choice!', ability: 'Use your ability?' };

const isRequiredInput = (spec) => spec.type !== 'player?' && spec.type !== 'text';
const playerByNotesName = (n) => (currentState?.players ?? []).find(p => notesNameOf(p) === n) ?? null;

// Inbound signal tokens from the holder for this step: everything after our
// Ask if we sent one (so an earlier exchange doesn't bleed in), else whatever
// they sent tonight. botc.app stamps entries with this machine's clock on
// arrival, so comparing against askedAt is safe.
function stepReplyTokens(player, night, askedAt) {
  if (!player.id) return [];
  return getPlayerSignalEntries(player.id)
    .filter(en => en.isInbound && (askedAt ? en.timestamp >= askedAt : signalNightGroup(en.timestamp) === `Night ${night}`))
    .flatMap(en => en.message ?? [])
    .filter(t => t.id !== 'seen');
}

// ── Steps run from botc.app ──
// The storyteller may prompt, answer or wake other players straight from
// botc.app instead of the step's buttons. botc.app keeps every signal (sent
// from here or from the app) in the same store, so steps read their progress
// from there: a prompt counts as Ask, a message shaped like the step's answer
// finishes it, one shaped like a follow-up marks that follow-up sent.

const PROMPT_IDS = new Set(['choice', 'ability']);

// Signals sent to a player tonight, oldest first ('seen' receipts dropped).
function outboundTonight(player, night) {
  if (!player?.id) return [];
  return getPlayerSignalEntries(player.id)
    .filter(en => !en.isInbound && signalNightGroup(en.timestamp) === `Night ${night}`)
    .map(en => ({ ts: en.timestamp, tokens: (en.message ?? []).filter(t => t.id !== 'seen') }));
}
// ("No + Make a choice!" after an invalid pick counts as asking again.)
const isPromptMessage = (tokens) => tokens.some(t => PROMPT_IDS.has(t.id)) && tokens.every(t => PROMPT_IDS.has(t.id) || t.id === 'grimoire' || t.id === 'no' || t.id === 'custom');

// When the step was last opened: our Ask, or a prompt sent from botc.app.
function stepAskedAt(c) {
  const fromApp = outboundTonight(c.player, c.night).filter(m => isPromptMessage(m.tokens)).pop()?.ts ?? 0;
  return Math.max(c.step.askedAt ?? 0, fromApp) || null;
}

// Could this token fill this template slot?
function slotAccepts(slot, t, c) {
  if (LITERAL_TOKENS.has(slot)) return t.id === slot;
  if (slot === 'self' || slot.startsWith('role:') || slot === 'bluffRoles' || slot.startsWith('inPlay:') || slot.endsWith('.role')) return t.id === 'role';
  if (['holder', 'demonPlayers', 'minionPlayers', 'otherMinions'].includes(slot)) return t.id === 'player';
  if (slot === 'recipientRole') return t.id === 'role';
  if (slot.startsWith('custom:')) return t.id === 'custom';
  const m = slot.match(/^i(\d+)$/);
  const s = m && c.spec?.inputs?.[m[1]];
  if (!s) return false;
  if (s.type === 'player' || s.type === 'player?') return t.id === 'player';
  if (s.type === 'role') return t.id === 'role';
  if (s.type === 'number') return NUMBER_TOKEN_IDS.includes(t.id) || t.id === 'custom';
  if (s.type === 'yn') return t.id === 'yes' || t.id === 'no' || t.id === 'custom';
  if (s.type === 'alignment') return ['good', 'evil', 'neutral'].includes(t.id);
  if (s.type === 'direction') return t.id === 'clockwise' || t.id === 'anticlockwise';
  return t.id === 'custom';
}

// A message matches a template when it has the template's fixed phrases and
// every token fits somewhere in it.
function messageFits(tokens, tpl, c) {
  if (!tokens.length || !tpl?.length) return false;
  if (!tpl.filter(x => LITERAL_TOKENS.has(x)).every(l => tokens.some(t => t.id === l))) return false;
  return tokens.every(t => tpl.some(x => slotAccepts(x, t, c)));
}

// The ability counts as used once any of its 'pick' inputs is filled in.
function stepUsedAbility(c) {
  return (c.spec?.inputs ?? []).some((_, i) => fieldUse(c.action, i) === 'pick' && (c.step.inputs[`i${i}`] ?? '') !== '');
}

function answerTemplate(c) {
  return c.action.tell ?? (c.spec?.inputs ?? []).map((_, i) => fieldUse(c.action, i) === 'tell' ? `i${i}` : null).filter(Boolean);
}

// A token as the input value it stands for.
function tokenToInputValue(t) {
  if (t.id === 'player') { const p = (currentState?.players ?? []).find(pl => pl.seat === t.data); return p ? notesNameOf(p) : undefined; }
  if (t.id === 'role' || t.id === 'custom') return t.data;
  if (NUMBER_TOKEN_IDS.includes(t.id)) return NUMBER_TOKEN_IDS.indexOf(t.id);
  if (t.id === 'neutral') return 'neither';
  if (t.id === 'anticlockwise') return 'anti-clockwise';
  return t.id;
}

// Picks up an answer / follow-ups sent from botc.app. Returns true when the
// step changed.
function syncFromApp(c) {
  const { step } = c;
  let changed = false;
  // After a Reopen, only messages sent since count.
  const asked = Math.max(stepAskedAt(c) ?? 0, step.reopenedAt ?? 0);
  const tpl = answerTemplate(c);
  if (!step.done && tpl.length) {
    const sent = outboundTonight(c.player, c.night).filter(m => m.ts >= asked && !isPromptMessage(m.tokens) && messageFits(m.tokens, tpl, c)).pop();
    if (sent) {
      const left = [...sent.tokens];
      for (const slot of tpl) {
        const m = slot.match(/^i(\d+)$/);
        if (!m || step.src[slot] === 'manual') continue;
        const at = left.findIndex(t => slotAccepts(slot, t, c));
        if (at === -1) continue;
        const v = tokenToInputValue(left.splice(at, 1)[0]);
        if (v !== undefined) { step.inputs[slot] = v; step.src[slot] = 'sent'; }
      }
      step.done = true;
      step.answered = true;
      step.used = stepUsedAbility(c);
      changed = true;
    }
  }
  (c.action.notify ?? []).forEach((n, idx) => {
    if (step.notified[idx] || !notifyApplies(n, c)) return;
    if (notifyRecipients(n, c).some(p => outboundTonight(p, c.night).some(m => messageFits(m.tokens, n.tokens, c)))) {
      step.notified[idx] = true;
      changed = true;
    }
  });
  // A step that only wakes others is finished once they've all been woken.
  const applicable = (c.action.notify ?? []).map((n, idx) => [n, idx]).filter(([n]) => notifyApplies(n, c));
  if (!step.done && c.action.wake === 'none' && !tpl.length && applicable.length && applicable.every(([, idx]) => step.notified[idx])) {
    step.done = true;
    changed = true;
  }
  return changed;
}

// ── Grimoire reminders ──
// An action's `reminders` map ties its inputs to this role's reminder tokens
// in the botc.app grimoire, both ways: reminders placed there fill the inputs,
// and finishing a step places them on the chosen players.

const isLiveReminder = (r, bundledId, name) =>
  _normalizeId(r.role ?? '') === bundledId && r.name === name && !(r.flags ?? []).includes('flipped');
const reminderCarriers = (bundledId, name) =>
  (currentState?.players ?? []).filter(p => (p.reminders ?? []).some(r => isLiveReminder(r, bundledId, name)));

// reminder name → the inputs it marks, in order.
function remindersByName(action) {
  const by = {};
  for (const [k, name] of Object.entries(action.reminders ?? {})) (by[name] ??= []).push(k);
  return by;
}

// Who carries this step's pick reminders right now — taken when the step is
// first seen, so last night's leftovers aren't read as tonight's picks.
function reminderBaseline(c) {
  const out = [];
  for (const [name, fields] of Object.entries(remindersByName(c.action))) {
    if (!fields.some(k => fieldUse(c.action, Number(k.slice(1))) === 'pick')) continue;
    for (const p of reminderCarriers(c.bundledId, name)) out.push(`${name}|${notesNameOf(p)}`);
  }
  return out;
}

// Fills inputs from reminders placed in botc.app (never over a reply, an edit
// or what was sent), and follows them if they move or go away.
function fillFromReminders(c) {
  const { step, action, bundledId } = c;
  for (const [name, fields] of Object.entries(remindersByName(action))) {
    const taken = new Set(fields.map(k => step.src[k] !== 'grimoire' && step.src[k] !== 'hint' ? step.inputs[k] : null).filter(Boolean));
    let pool = reminderCarriers(bundledId, name).map(notesNameOf).filter(n => !taken.has(n));
    for (const k of fields) {
      if (['manual', 'reply', 'sent'].includes(step.src[k])) continue;
      const fresh = fieldUse(action, Number(k.slice(1))) !== 'pick'
        ? pool : pool.filter(n => !(step.baseline ?? []).includes(`${name}|${n}`));
      const n = fresh[0];
      if (n) { step.inputs[k] = n; step.src[k] = 'grimoire'; pool = pool.filter(x => x !== n); }
      else if (step.src[k] === 'grimoire') { delete step.inputs[k]; delete step.src[k]; }
    }
  }
}

// Places the step's reminders in botc.app on the players in its inputs,
// moving them off anyone else. A reminder none of whose inputs is filled is
// left alone.
function placeStepReminders(c) {
  const role = scriptRoleFor(c.bundledId).id;
  for (const [name, fields] of Object.entries(remindersByName(c.action))) {
    const want = fields.map(k => c.step.inputs[k]).filter(Boolean).map(playerByNotesName).filter(Boolean);
    if (!want.length) continue;
    const have = reminderCarriers(c.bundledId, name);
    const same = want.length === have.length && want.every(p => have.includes(p));
    if (!same) sendBg({ type: 'SYNC_REMINDER', role, name, seats: want.map(p => p.seat) });
  }
}

// Nominations made during Day N, with the players involved.
function nominationsOfDay(day) {
  if (day < 1) return [];
  const label = `Day ${day}`;
  const start = fullTimeline.find(e => e.type === 'phase' && e.label === label)?.ts;
  if (start == null) return [];
  const end = fullTimeline.find(e => e.type === 'phase' && e.ts > start)?.ts ?? Infinity;
  const players = currentState?.players ?? [];
  const at = (nom, seat) => players.find(p => displayName(p, p.seat) === nomSeatName(nom, seat)) ?? null;
  return allNominations.filter(n => n.ts >= start && n.ts < end).map(n => ({
    nominator: at(n, n.nominatorSeat),
    nominee: at(n, n.nomineeSeat),
    voters: (n.yesSeats ?? []).map(seat => at(n, seat)).filter(Boolean),
  }));
}

// Fills untouched pick inputs from the reply, then suggestions into the rest.
// Returns true when something changed.
function syncStepInputs(c) {
  const { step, spec, action, player, night, bundledId } = c;
  const before = JSON.stringify([step.inputs, step.src, step.passed]);
  const free = (i) => step.src[`i${i}`] !== 'manual';
  const set = (i, v, src) => { step.inputs[`i${i}`] = v; step.src[`i${i}`] = src; };

  // Replies since the step was opened (or reopened — the earlier reply was already used).
  const tokens = stepReplyTokens(player, night, Math.max(stepAskedAt(c) ?? 0, step.reopenedAt ?? 0) || null);
  // Latest picks win: a player may send one pick and then another, or send
  // two picks in separate messages — take the most recent ones they sent, as
  // many as the step has pick inputs of that kind.
  const pickCount = (types) => (spec?.inputs ?? []).filter((s, i) => fieldUse(action, i) === 'pick' && types.includes(s.type)).length;
  const lastN = (arr, n) => n > 0 ? arr.slice(-n) : [];
  const seats = lastN(tokens.filter(t => t.id === 'player').map(t => t.data), pickCount(['player', 'player?']));
  const roles = lastN(tokens.filter(t => t.id === 'role').map(t => t.data), pickCount(['role']));
  const yn = tokens.filter(t => t.id === 'yes' || t.id === 'no').pop()?.id;
  const num = tokens.map(t => NUMBER_TOKEN_IDS.indexOf(t.id)).filter(n => n !== -1).pop();
  const fromReplyBefore = Object.fromEntries(Object.entries(step.inputs).filter(([k]) => step.src[k] === 'reply'));
  (spec?.inputs ?? []).forEach((s, i) => {
    if (!free(i) || fieldUse(action, i) !== 'pick') return;
    if (s.type === 'player' || s.type === 'player?') {
      const seat = seats.shift();
      const p = seat != null ? (currentState?.players ?? []).find(pl => pl.seat === seat) : null;
      if (p) set(i, notesNameOf(p), 'reply');
    } else if (s.type === 'role' && roles.length) set(i, roles.shift(), 'reply');
    else if (s.type === 'yn' && yn && !s.yesLabel) set(i, yn, 'reply');
    else if (s.type === 'number' && num !== undefined) set(i, num, 'reply');
    else if (s.type === 'text' && tokens.some(t => t.id === 'custom')) set(i, tokens.filter(t => t.id === 'custom').map(t => t.data).join(' '), 'reply');
  });
  // "Use your ability?" answered no (and nothing picked) → they pass.
  step.passed = action.wake === 'ability' && yn === 'no' && !seats.length && !roles.length;
  // A pick changed after the step was finished: keep the new one, flag it.
  if (step.done) {
    const was = Object.entries(fromReplyBefore).filter(([k, v]) => step.src[k] === 'reply' && step.inputs[k] !== v);
    if (was.length) step.changed = { was: Object.fromEntries(was), answered: !!step.answered };
  }

  fillFromReminders(c);

  const hint = _nightStepHints()[bundledId];
  if (hint && spec) {
    const players = currentState?.players ?? [];
    const suggested = hint({
      holder: player, players, night,
      playerByName: playerByNotesName,
      alignmentOf: (p) => impliedAlignmentGE(p),
      roleOfName: (n) => { const p = playerByNotesName(n); const id = p && trueRoleOf(p); return id ? scriptRoleFor(id).id : null; },
      teamOf: teamOfPlayer,
      nameOf: notesNameOf,
      hasReminder,
      nominationsYesterday: () => nominationsOfDay(night - 1),
      executedYesterday: () => { const p = executedOnDay(night - 1); return p ? notesNameOf(p) : null; },
      lastExecuted: () => { for (let d = night - 1; d >= 1; d--) { const p = executedOnDay(d); if (p) return notesNameOf(p); } return null; },
      reminderCarrier: (roleId, name) => { const p = reminderCarriers(roleId, name)[0]; return p ? notesNameOf(p) : null; },
    }, step.inputs) ?? {};
    for (const [k, v] of Object.entries(suggested)) {
      if (['manual', 'reply', 'sent', 'grimoire'].includes(step.src[k]) || v === null || v === undefined) continue;
      step.inputs[k] = v; step.src[k] = 'hint';
    }
  }
  return JSON.stringify([step.inputs, step.src, step.passed]) !== before;
}

// One input value as signal tokens.
function inputToTokens(spec, v) {
  if (v === undefined || v === null || v === '') return [];
  if (spec.type === 'player' || spec.type === 'player?') {
    const p = playerByNotesName(v);
    return p ? [{ id: 'player', data: p.seat }] : [];
  }
  if (spec.type === 'role') return [{ id: 'role', data: v }];
  if (spec.type === 'number' && NUMBER_TOKEN_IDS[v]) return [{ id: NUMBER_TOKEN_IDS[v] }];
  if (spec.type === 'yn' && (v === 'yes' || v === 'no')) return [{ id: v }];
  if (spec.type === 'alignment') return [{ id: v === 'neither' ? 'neutral' : v }];
  if (spec.type === 'direction') return [{ id: v === 'anti-clockwise' ? 'anticlockwise' : 'clockwise' }];
  return [{ id: 'custom', data: String(v) }];
}

const LITERAL_TOKENS = new Set(['you', 'selected', 'claim', 'demon', 'minions', 'bluffs', 'good', 'evil', 'neutral',
  'yes', 'no', 'acknowledge', 'grimoire', 'choice', 'ability']);
const playerToken = (p) => ({ id: 'player', data: p.seat });
const magicians = () => (currentState?.players ?? []).filter(p => trueRoleOf(p) === 'magician');
const roleInPlay = (bundledId) => (currentState?.players ?? []).some(p => trueRoleOf(p) === bundledId);
const roleTokenOf = (p) => { const id = trueRoleOf(p); return id ? { id: 'role', data: scriptRoleFor(id).id } : null; };

// A token template (see data/nightActions.js) as signal tokens. `missing` is
// set when an input it needs hasn't been filled in yet.
function resolveTemplate(tpl, c) {
  const tokens = [];
  let missing = false;
  for (const item of tpl ?? []) {
    let m;
    if (LITERAL_TOKENS.has(item)) tokens.push({ id: item });
    else if (item.startsWith('custom:')) tokens.push({ id: 'custom', data: item.slice(7) });
    else if (item === 'recipientRole') {
      // Each recipient's own character; a placeholder until there is one.
      const t = c.recipient && roleTokenOf(c.recipient);
      if (t) tokens.push(t); else if (c.recipient) missing = true; else tokens.push({ id: 'own-role' });
    }
    else if (item === 'self') tokens.push({ id: 'role', data: scriptRoleFor(c.bundledId).id });
    else if (item === 'holder') tokens.push(playerToken(c.player));
    else if ((m = item.match(/^i(\d+)(\.role)?$/))) {
      const s = c.spec?.inputs?.[m[1]];
      const v = c.step.inputs[`i${m[1]}`];
      if (!s || v === undefined || v === '') { if (s && isRequiredInput(s)) missing = true; continue; }
      if (m[2]) {
        const t = playerByNotesName(v) && roleTokenOf(playerByNotesName(v));
        if (t) tokens.push(t); else missing = true;
      } else {
        const opt = c.action.optionTokens?.[`i${m[1]}`]?.[v];
        tokens.push(...(opt ? [{ id: opt }] : inputToTokens(s, v)));
      }
    }
    else if (item.startsWith('role:')) tokens.push({ id: 'role', data: scriptRoleFor(item.slice(5)).id });
    // Minion / Demon info: the Magician is shown as both; the Marionette
    // isn't shown to the other Minions (only the Demon knows them).
    else if (item === 'demonPlayers') tokens.push(...[...playersOfTeam('demon'), ...(c.bundledId === 'minioninfo' ? magicians() : [])].map(playerToken));
    else if (item === 'minionPlayers') tokens.push(...[...playersOfTeam('minion'), ...(c.bundledId === 'demoninfo' ? magicians() : [])].map(playerToken));
    else if (item === 'otherMinions') tokens.push(...playersOfTeam('minion').filter(p => trueRoleOf(p) !== 'marionette' && p.seat !== c.player.seat).map(playerToken));
    else if (item === 'bluffRoles') tokens.push(...(currentState?.bluffs ?? []).map(scriptRoleId).filter(Boolean).map(id => ({ id: 'role', data: id })));
    else if (item.startsWith('inPlay:')) {
      const ids = [...new Set(playersOfTeam(item.slice(7)).map(p => roleTokenOf(p)?.data).filter(Boolean))];
      tokens.push(...ids.map(id => ({ id: 'role', data: id })));
    }
  }
  return { tokens, missing };
}

// What Send sends: the action's `tell` template, else its tell inputs in
// order. With `shuffle`, the action's shuffled inputs swap places half the
// time (only when actually sending — the preview stays put).
function stepAnswer(c, shuffle = false) {
  if (c.action.zeroIf && !playersOfTeam(c.action.zeroIf).length) return { tokens: [{ id: 'zero' }], missing: false };
  let tpl = answerTemplate(c);
  const sh = c.action.shuffle;
  if (shuffle && sh?.length === 2 && Math.random() < 0.5) tpl = tpl.map(x => x === sh[0] ? sh[1] : x === sh[1] ? sh[0] : x);
  return resolveTemplate(tpl, c);
}

// Does a notify's `if` hold? (one condition or a list — see nightActions.js)
function notifyApplies(n, c) {
  const conds = n.if ? [].concat(n.if) : [];
  return conds.every(cond => {
    const [a, want] = cond.split(':');
    if (a === 'noReminder') return !(currentState?.players ?? []).some(p => (p.reminders ?? []).some(r => isLiveReminder(r, c.bundledId, want)));
    const v = c.step.inputs[a];
    if (want === 'yes') return v === 'yes';
    if (want === 'notInPlay') return !!v && !roleInPlay(_normalizeId(v));
    const p = playerByNotesName(v);
    return !!p && (teamOfPlayer(p) === want || trueRoleOf(p) === want);
  });
}

function notifyRecipients(n, c) {
  if (n.to === 'holder') return [c.player];
  if (n.to === 'demon') return playersOfTeam('demon');
  if (n.to === 'minions') return playersOfTeam('minion');
  if (n.to === 'evil') return [...playersOfTeam('minion'), ...playersOfTeam('demon')];
  if (n.to === 'neighbours') {
    const seated = [...(currentState?.players ?? [])].sort((a, b) => a.seat - b.seat);
    const i = seated.findIndex(p => p.seat === c.player.seat);
    return i === -1 || seated.length < 2 ? [] : [...new Set([seated[(i - 1 + seated.length) % seated.length], seated[(i + 1) % seated.length]])];
  }
  if (n.to.startsWith('reminder:')) return reminderCarriers(c.bundledId, n.to.slice(9));
  const p = playerByNotesName(c.step.inputs[n.to]);
  return p ? [p] : [];
}

// ── New replies ──
// Messages from the holder that arrived after the step was finished, or
// after the storyteller last had it open — shown on the step's row so
// nothing gets overlooked: a small 👍 for an acknowledgement, the message
// itself for anything else (questions, remarks, another pick).

const ACK_TEXT = /^\s*(ok(ay)?|k|got it|gotcha|thanks?( you)?|thx|ty|yes|yep|yeah|sure|understood|noted|👍|✅|✔️?)\s*[.!]*\s*$/i;
const isAckMessage = (tokens) => tokens.length > 0 && tokens.every(t =>
  t.id === 'acknowledge' || t.id === 'yes' || (t.id === 'custom' && ACK_TEXT.test(String(t.data ?? ''))));

function newReplies(c) {
  if (!c.player.id || c.step.stOnly) return [];
  const since = Math.max(c.step.seenAt ?? 0, c.step.done ? (c.step.doneAt ?? 0) : (stepAskedAt(c) ?? 0));
  if (!since) return [];
  return getPlayerSignalEntries(c.player.id)
    .filter(en => en.isInbound && en.timestamp > since && signalNightGroup(en.timestamp) === `Night ${c.night}`)
    .map(en => (en.message ?? []).filter(t => t.id !== 'seen'))
    .filter(tokens => tokens.length);
}

// The Po's charge: did their last finished step (an earlier night) choose no-one?
function lastChoiceWasNone(c) {
  for (let n = c.night - 1; n >= 1; n--) {
    const prev = nightSteps[`${stepGameKey()}|${n}|${c.bundledId}|${notesNameOf(c.player)}`];
    if (prev?.done) return !!prev.passed || prev.used === false;
  }
  return false;
}

// Picks that break the role's rules (`pick` in nightActions.js) — players do
// pick a player who died tonight, or themselves, or the same one twice.
function pickProblems(c) {
  const rules = c.action.pick ?? [];
  if (!rules.length) return [];
  const pickFields = (c.spec?.inputs ?? []).map((s, i) => [s, i])
    .filter(([s, i]) => fieldUse(c.action, i) === 'pick' && (s.type === 'player' || s.type === 'player?'));
  const picks = pickFields.map(([, i]) => playerByNotesName(c.step.inputs[`i${i}`])).filter(Boolean);
  const out = [];
  const named = (p) => dn(displayName(p, p.seat));
  for (const p of new Set(picks)) {
    if (rules.includes('alive') && p.isDead) out.push(`${named(p)} is dead — they must choose a living player`);
    if (rules.includes('dead') && !p.isDead) out.push(`${named(p)} is alive — they must choose a dead player`);
    if (rules.includes('notSelf') && p.seat === c.player.seat) out.push(`They chose themselves — not allowed`);
    if (rules.includes('notTraveller') && teamOfPlayer(p) === 'traveller') out.push(`${named(p)} is a Traveller — not allowed`);
  }
  if (rules.includes('distinct') && new Set(picks).size < picks.length) out.push('Same player chosen twice — they must choose different players');
  if (rules.includes('threeAfterNone')) {
    const three = lastChoiceWasNone(c);
    if (three && picks.length && picks.length < 3) out.push('Their last choice was no-one — they must choose 3 players');
    if (!three && picks.length > 1) out.push('They may only choose 1 player (3 only after choosing no-one)');
  }
  if (rules.includes('notLastNight')) {
    const prev = nightSteps[`${stepGameKey()}|${c.night - 1}|${c.bundledId}|${notesNameOf(c.player)}`];
    const last = new Set(pickFields.map(([, i]) => prev?.inputs?.[`i${i}`]).filter(Boolean));
    for (const p of new Set(picks)) if (last.has(notesNameOf(p))) out.push(`${named(p)} was chosen last night — they must choose someone else`);
  }
  return out;
}

// Was this once-per-game ability used on an earlier night?
function usedEarlier(c) {
  const prefix = `${stepGameKey()}|`;
  return Object.entries(nightSteps).some(([k, s]) => {
    if (!s.used || !k.startsWith(prefix)) return false;
    const [, n, id, ...name] = k.split('|');
    return Number(n) < c.night && id === c.bundledId && name.join('|') === notesNameOf(c.player);
  });
}

// Removes every chip a step wrote (it may have moved targets since).
function removeStepChips(key, phase) {
  for (const cellKey of Object.keys(cellTokens)) {
    if (!cellKey.endsWith(`|${phase}`)) continue;
    const chips = cellTokens[cellKey];
    if (!chips.some(ch => ch.nightStep === key)) continue;
    cellTokens[cellKey] = chips.filter(ch => ch.nightStep !== key);
    const player = cellKey.slice(0, -(phase.length + 1));
    saveTokens(player, phase);
    refreshCellChips(player, phase);
  }
}

// Writes (or rewrites) the step's chips into the notes grid.
function logNightStep(c) {
  const { key, step, spec, bundledId, player, night } = c;
  const phase = `Night ${night}`;
  removeStepChips(key, phase);
  if (!spec || !Object.values(step.inputs).some(v => v !== undefined && v !== '')) return; // nothing to record
  const role = scriptRoleFor(bundledId);
  setChip(notesNameOf(player), phase, {
    type: 'ability', roleId: role.id, roleName: role.name, roleTeam: role.team ?? '',
    iconUrl: _iconUrl(role), inputs: { ...step.inputs }, nightStep: key,
  });
  spec.inputs.forEach((s, i) => {
    const target = step.inputs[`i${i}`];
    if ((s.type === 'player' || s.type === 'player?') && target && DROISON_TARGET_LABEL.test(s.label)) {
      setChip(target, phase, { type: 'cellcolor', id: 'droisoned', label: CELL_COLORS.droisoned.label, source: role.id, nightStep: key });
    }
  });
}

function stepCtx(key, step, bundledId, player, night) {
  let action = nightActionFor(bundledId, night);
  // An ability the Storyteller holds (Plague Doctor): nobody wakes for it.
  if (step.stOnly) action = { ...action, wake: 'none', notify: [], dead: true };
  return { key, step, bundledId, player, night, spec: _specs()[bundledId] ?? null, action };
}

// Abilities players have on top of their own character, from what earlier
// steps recorded (an action's `grants`) — the Philosopher's, Apprentice's and
// Alchemist's character, the Boffin's ability for the Demon, the Plague
// Doctor's Minion ability for the Storyteller, the Cannibal's (its step,
// pre-filled from the last execution). All editable on those steps.
// [{ player, bundledId, via, stOnly }]
function gainedAbilities(night) {
  const prefix = `${stepGameKey()}|`;
  const latest = {};
  for (const [k, st] of Object.entries(nightSteps)) {
    if (!k.startsWith(prefix)) continue;
    const [, n, id, ...name] = k.split('|');
    const g = _nightActions()[id]?.grants;
    const v = g && st.inputs?.[g.from];
    if (!v || Number(n) > night) continue;
    const slot = `${id}|${name.join('|')}`;
    if (!latest[slot] || Number(n) >= latest[slot].n) latest[slot] = { n: Number(n), via: id, name: name.join('|'), role: _normalizeId(v), to: g.to ?? 'holder' };
  }
  const out = [];
  for (const g of Object.values(latest)) {
    const src = playerByNotesName(g.name);
    if (g.to === 'demon') playersOfTeam('demon').forEach(p => out.push({ player: p, bundledId: g.role, via: g.via }));
    else if (src) out.push({ player: src, bundledId: g.role, via: g.via, stOnly: g.to === 'storyteller' });
  }
  // Not when their token was already swapped to that character.
  return out.filter(x => bundledRoleOf(x.player) !== x.bundledId);
}

// Tonight's steps in wake order, with labels (Dusk, Minion info, …) between.
// Roles nobody holds are left out.
function buildNightSteps(night) {
  const session = stepGameKey();
  const entries = night === 1 ? _nightOrder().firstNight : _nightOrder().otherNight;
  const scriptIds = inPlayRoleIds();
  const byRole = playersByRoleId();
  const seated = (currentState?.players ?? []).filter(p => teamOfPlayer(p) !== 'traveller').length;
  const items = [];
  let changed = false;

  // Things to confirm rather than wake (an action's `confirm`, e.g. whose
  // ability the Cannibal has): kept like steps — suggested, editable — but
  // shown above the order, not in it. Filled before the gained abilities
  // are worked out, since they feed them.
  const confirms = [];
  if (night > 1) {
    for (const [id, a] of Object.entries(_nightActions())) {
      if (!a.confirm) continue;
      for (const p of (currentState?.players ?? []).filter(p => trueRoleOf(p) === id && !p.isDead)) {
        const key = `${session}|${night}|${id}|${notesNameOf(p)}`;
        const step = (nightSteps[key] ??= { inputs: {}, src: {}, done: false });
        step.notified ??= {};
        const c = stepCtx(key, step, id, p, night);
        if (syncStepInputs(c)) changed = true;
        confirms.push(c);
      }
    }
  }
  const gained = gainedAbilities(night);

  const addStep = (bundledId, player, gained = null) => {
    const key = `${session}|${night}|${bundledId}|${notesNameOf(player)}`;
    const isNew = !nightSteps[key];
    const step = (nightSteps[key] ??= { inputs: {}, src: {}, done: false });
    step.notified ??= {};
    if (gained) { step.via = gained.via; step.stOnly = !!gained.stOnly; }
    const c = stepCtx(key, step, bundledId, player, night);
    if (isNew) step.baseline = reminderBaseline(c);
    const wasDone = step.done;
    if (syncStepInputs(c) | syncFromApp(c)) {
      changed = true;
      if (step.done) logNightStep(c); // keep the logged chip current
    }
    if (!wasDone && step.done && nightStepExpanded === key) nightStepExpanded = null;
    if (step.done && !step.doneAt) { step.doneAt = Date.now(); changed = true; }
    // Finished by the reply alone: every pick filled, nothing to tell them and
    // nobody else to wake — or they declined their ability.
    const picks = (c.spec?.inputs ?? []).map((s, i) => [s, i]).filter(([, i]) => fieldUse(c.action, i) === 'pick');
    // Only a reply finishes a step by itself — reminders in the grimoire may be
    // misplaced or stale, so a pick read from them is a suggestion to confirm.
    // At least one pick has to come from a reply: with only optional picks (the
    // Zombuul's, which may not kill) "every required pick" is true with no
    // reply at all, and the step would finish the moment it's built.
    const fromReply = (i) => step.src[`i${i}`] === 'reply';
    const picked = picks.some(([, i]) => fromReply(i)) && picks.every(([s, i]) => !isRequiredInput(s) || fromReply(i));
    const nothingElse = !stepAnswer(c).tokens.length && !(c.action.notify ?? []).some(n => notifyApplies(n, c));
    if (!step.done && ((picked && nothingElse && !pickProblems(c).length) || step.passed)) {
      step.done = true;
      step.doneAt = Date.now();
      step.used = !step.passed;
      changed = true;
      // Notes only: the botc.app grimoire is only changed by the storyteller's
      // own clicks (Send / Done / editing a finished step), never on its own.
      logNightStep(c);
    }
    items.push(c);
  };

  // Abilities held "via" someone else: gained ones, and ones shown by token
  // with an "Is the …" reminder. One per player and character.
  const viaHolders = [];
  const seenVia = new Set();
  for (const g of [...gained, ...Object.entries(byRole).flatMap(([id, list]) => list.filter(h => h.via).map(h => ({ player: h.player, bundledId: id, via: h.via })))]) {
    const k = `${g.player.seat}|${g.bundledId}`;
    if (!seenVia.has(k)) { seenVia.add(k); viaHolders.push(g); }
  }
  // A first-night-only ability (Washerwoman, Chef, …) gained later wakes once,
  // the first night they have it, next to the other info roles (just before
  // the Empath) — it isn't in the other-nights order.
  const otherIds = new Set(_nightOrder().otherNight.filter(x => x.id).map(x => x.id));
  const firstIds = new Set(_nightOrder().firstNight.filter(x => x.id).map(x => x.id));
  const doneEarlier = (id, p) => Object.entries(nightSteps).some(([k, st]) => {
    const [sess, n, rid, ...nm] = k.split('|');
    return sess === session && Number(n) < night && rid === id && nm.join('|') === notesNameOf(p) && st.done;
  });
  let lateInfo = night > 1 ? viaHolders.filter(g => !otherIds.has(g.bundledId) && firstIds.has(g.bundledId) && !doneEarlier(g.bundledId, g.player)) : [];
  const addLateInfo = () => { for (const g of lateInfo) addStep(g.bundledId, g.player, g); lateInfo = []; };

  for (const e of entries) {
    if (e.label) {
      if (e.label === 'Dawn') addLateInfo(); // (if the order had no Empath)
      items.push({ label: e.label });
      // Minion / Demon info: 7+ players (Travellers don't count) unless the
      // Toymaker is in play; skipped altogether with a Poppy Grower or Tor.
      // The Marionette doesn't learn they're a Minion.
      const infoId = night === 1 && NIGHT_INFO_STEPS[e.label];
      const info = infoId && _nightActions()[infoId];
      const enough = seated >= (info?.minPlayers ?? 0) || roleInPlay('toymaker');
      if (info && enough && !roleInPlay('poppygrower') && !roleInPlay('tor')) {
        const holders = info.holders === 'demon' ? playersOfTeam('demon') : playersOfTeam('minion').filter(p => trueRoleOf(p) !== 'marionette');
        for (const p of holders) addStep(infoId, p);
      }
      continue;
    }
    if (e.id === 'empath') addLateInfo();
    const holders = scriptIds.has(e.id) ? (byRole[e.id] ?? []).filter(h => !h.via).map(h => h.player) : [];
    const extra = viaHolders.filter(g => g.bundledId === e.id);
    if (!holders.length && !extra.length) continue;
    for (const player of holders) addStep(e.id, player);
    for (const g of extra) addStep(e.id, g.player, g);
  }
  addLateInfo();
  if (changed) saveNightSteps();
  return { items, confirms };
}

function nightStepCtx(key) {
  const [, nightStr, bundledId, ...nameParts] = key.split('|');
  const player = playerByNotesName(nameParts.join('|'));
  const step = nightSteps[key];
  return player && step ? stepCtx(key, step, bundledId, player, Number(nightStr)) : null;
}

// Opens the step: "Make a choice!" / "Use your ability?" (or the action's own
// opening message for the primary ask).
function nightStepAsk(key, which) {
  const c = nightStepCtx(key);
  if (!c?.player.id) return;
  const message = which === 'reject' ? [{ id: 'no' }, { id: 'choice' }]
    : which === 'primary' && c.action.ask ? resolveTemplate(c.action.ask, c).tokens
    : [{ id: which === 'primary' ? (c.action.wake === 'ability' ? 'ability' : 'choice') : which }];
  sendBg({ type: 'SEND_SIGNAL', userIds: [c.player.id], message });
  // Inputs the earlier reply filled are cleared: a new answer is coming.
  for (const [k, src] of Object.entries(c.step.src)) if (src === 'reply') { delete c.step.inputs[k]; delete c.step.src[k]; }
  c.step.askedAt = Date.now();
  delete c.step.changed;
  saveNightSteps();
  renderNightOrder();
}

function nightStepNotify(key, idx) {
  const c = nightStepCtx(key);
  const n = c?.action.notify?.[idx];
  if (!n) return;
  const to = notifyRecipients(n, c).filter(p => p.id);
  if (!to.length) return;
  // A message with each recipient's own character goes out one by one.
  const perRecipient = n.tokens.includes('recipientRole');
  const batches = perRecipient ? to.map(p => [p]) : [to];
  const resolved = batches.map(group => ({ group, ...resolveTemplate(n.tokens, perRecipient ? { ...c, recipient: group[0] } : c) }));
  if (resolved.some(r => r.missing || !r.tokens.length)) return;
  for (const r of resolved) sendBg({ type: 'SEND_SIGNAL', userIds: r.group.map(p => p.id), message: r.tokens });
  c.step.notified[idx] = true;
  saveNightSteps();
  renderNightOrder();
}

function nightStepFinish(key, send) {
  const c = nightStepCtx(key);
  if (!c) return;
  if (send && c.player.id) {
    const { tokens, missing } = stepAnswer(c, true);
    if (!missing && tokens.length) { sendBg({ type: 'SEND_SIGNAL', userIds: [c.player.id], message: tokens }); c.step.answered = true; }
  }
  delete c.step.changed;
  placeStepReminders(c);
  c.step.done = true;
  c.step.doneAt = Date.now();
  c.step.used = stepUsedAbility(c);
  logNightStep(c);
  if (nightStepExpanded === key) nightStepExpanded = null;
  saveNightSteps();
  renderNightOrder();
}

function nightStepReopen(key) {
  const c = nightStepCtx(key);
  if (!c) return;
  c.step.done = false;
  delete c.step.doneAt;
  c.step.passed = false;
  c.step.reopenedAt = Date.now();
  delete c.step.changed;
  nightStepExpanded = key;
  saveNightSteps();
  renderNightOrder();
}

function nightStepSetInput(key, idx, value) {
  const c = nightStepCtx(key);
  if (!c) return;
  const k = `i${idx}`;
  if (value === '' || value === null || value === undefined) delete c.step.inputs[k];
  else c.step.inputs[k] = value;
  c.step.src[k] = 'manual';
  if (c.step.done) { logNightStep(c); placeStepReminders(c); }
  saveNightSteps();
  renderNightOrder();
}

// Seeds the Signal panel with a follow-up message and its recipients.
function nightStepNotifyCompose(key, idx) {
  const c = nightStepCtx(key);
  const n = c?.action.notify?.[idx];
  if (!n) return;
  const to = notifyRecipients(n, c).filter(p => p.id);
  stMessage = resolveTemplate(n.tokens, to.length === 1 ? { ...c, recipient: to[0] } : c).tokens;
  stRecipientIds = new Set(to.map(p => String(p.id)));
  renderSignalPreview();
  renderSignalPlayers();
  updateSignalSendBtn();
  renderNightOrder();
  document.getElementById('signal-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Seeds the Signal panel with this holder and whatever answer the step has.
function nightStepCompose(key) {
  const c = nightStepCtx(key);
  if (!c?.player.id) return;
  stMessage = stepAnswer(c).tokens;
  stRecipientIds = new Set([String(c.player.id)]);
  renderSignalPreview();
  renderSignalPlayers();
  updateSignalSendBtn();
  document.getElementById('signal-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// One compact control per chip input.
function nightStepInputHtml(key, s, i, step, use) {
  const v = step.inputs[`i${i}`];
  const src = step.src[`i${i}`];
  const srcCls = { reply: ' nstep-from-reply', hint: ' nstep-from-hint', grimoire: ' nstep-from-grimoire' }[src] ?? '';
  const title = [{ pick: 'Their choice', tell: 'Sent to them', note: 'Your note — not sent' }[use],
    { reply: 'from their reply', hint: 'suggested', sent: 'as sent from botc.app', grimoire: 'from the grimoire reminder' }[src] ?? ''].filter(Boolean).join(' · ');
  const attrs = `data-key="${esc(key)}" data-idx="${i}"`;
  const pills = (opts) => `<span class="nstep-pills${srcCls}" title="${title}">${opts.map(o =>
    `<button class="nstep-pill${String(o) === String(v) ? ' active' : ''}" ${attrs} data-value="${esc(String(o))}">${esc(String(o))}</button>`).join('')}</span>`;
  const select = (opts) => `<select class="nstep-input${srcCls}" title="${title}" ${attrs}>
      <option value="">${esc(s.label)}…</option>${opts.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  const label = `<span class="nstep-label">${esc(s.label)}</span>`;

  if (s.type === 'player' || s.type === 'player?') {
    return select((currentState?.players ?? []).map(p => ({ value: notesNameOf(p), label: dn(displayName(p, p.seat)) })));
  }
  if (s.type === 'role') {
    const teams = { good: ['townsfolk', 'outsider'], evil: ['minion', 'demon'] }[s.filter] ?? (s.filter ? [s.filter] : null);
    return select((currentState?.roles ?? []).filter(r => !teams || teams.includes(r.team)).map(r => ({ value: r.id, label: r.name ?? r.id })));
  }
  if (s.type === 'number') {
    const lo = s.min ?? 0, hi = s.max ?? 99;
    if (hi - lo <= 6) return `${label}${pills(Array.from({ length: hi - lo + 1 }, (_, n) => lo + n))}`;
    return `<input type="number" class="nstep-input nstep-num${srcCls}" placeholder="${esc(s.label)}" title="${title}" min="${lo}" max="${hi}" value="${v ?? ''}" ${attrs} />`;
  }
  if (s.type === 'yn') return `${label}${pills([s.yesLabel ?? 'yes', s.noLabel ?? 'no'])}`;
  if (s.type === 'alignment') return `${label}${pills(['good', 'evil', 'neither'])}`;
  if (s.type === 'direction') return pills(['clockwise', 'anti-clockwise']);
  if (s.type === 'options') return `${label}${pills(s.options ?? [])}`;
  return `<input type="text" class="nstep-input nstep-text${srcCls}" placeholder="${esc(s.label)}" title="${title}" value="${esc(v ?? '')}" ${attrs} />`;
}

// "Seat 3 · Imp · yes" — a finished step on one line.
function nightStepSummary(c) {
  if (c.step.passed) return 'passed';
  return (c.spec?.inputs ?? []).map((s, i) => {
    const v = c.step.inputs[`i${i}`];
    if (v === undefined || v === '') return null;
    if (s.type === 'player' || s.type === 'player?') return dn(v);
    if (s.type === 'role') return (currentState?.roles ?? []).find(r => r.id === v)?.name ?? v;
    return String(v);
  }).filter(Boolean).join(' · ');
}

const tokensHtml = (tokens) => tokens.map(t => `<span class="${signalTokenCls(t)}">${esc(signalTokenLabel(t))}</span>`).join('');

// ── Step warnings ──
// Why the holder's ability may not work / their info may or must be false,
// and players involved who may register as something else.

// Who may register as something else, and as what. Recluse/Spy by
// character; the Lycanthrope's Faux Paw player and Legion by reminder/role.
// The as* flags say what they may register as, for checks like the Virgin's.
function misregistration(p) {
  const id = trueRoleOf(p);
  if (id === 'recluse') return { role: 'Recluse', text: '(Recluse) may register as evil & as a Minion or Demon', demon: true, asEvil: true, asMinion: true, asDemon: true };
  if (id === 'spy') return { role: 'Spy', text: '(Spy) may register as good & as a Townsfolk or Outsider', demon: false, asGood: true, asTownsfolk: true };
  if (id === 'legion') return { role: 'Legion', text: '(Legion) registers as a Minion too', demon: false, asMinion: true };
  if ((p.reminders ?? []).some(r => isLiveReminder(r, 'lycanthrope', 'Faux Paw'))) return { role: 'Faux Paw', text: 'registers as evil (Faux Paw)', demon: false, asEvil: true };
  return null;
}

// Which players a role's info follows from, for misregistration warnings —
// only what the storyteller doesn't choose. demon: only registering as the
// Demon matters. Roles not listed: the player's own picks (if any).
const MISREG_SCOPE = {
  empath: { who: 'neighbours' },
  chef: { who: 'all' }, clockmaker: { who: 'all' }, shugenja: { who: 'all' },
  oracle: { who: 'dead' },
  towncrier: { who: 'nominators' },
  flowergirl: { who: 'voters', demon: true },
  fortuneteller: { who: 'picks', demon: true },
  undertaker: { who: 'fields', fields: ['i0'] },
  chambermaid: null,     // counts who woke — registration doesn't matter
};

const liveRemindersOn = (p) => (p?.reminders ?? []).filter(r => !(r.flags ?? []).includes('flipped'));
const reminderSourceName = (r) => scriptRoleFor(_normalizeId(r.role ?? '')).name ?? r.role;

// Nearest living player each way round the circle (the Empath's neighbours).
function livingNeighbours(player) {
  const seated = [...(currentState?.players ?? [])].sort((a, b) => a.seat - b.seat);
  const n = seated.length;
  const idx = seated.findIndex(p => p.seat === player.seat);
  if (idx === -1 || n < 2) return [];
  const step = (dir) => {
    for (let i = 1; i < n; i++) {
      const p = seated[((idx + dir * i) % n + n) % n];
      if (p.seat !== player.seat && !p.isDead) return p;
    }
    return null;
  };
  return [...new Set([step(-1), step(1)].filter(Boolean))];
}

const soberReminder = (p) => liveRemindersOn(p).find(r => /sober/i.test(r.name));

// Why this player's ability may not work right now, from the grimoire: drunk /
// poisoned reminders, abilities taken away, the Minstrel's and Xaan's effects.
// Empty when they have a sober & healthy reminder. Shared by the night steps
// and the nomination alerts.
function droisonReasons(player) {
  if (!player || soberReminder(player)) return [];
  const out = [];
  const rems = liveRemindersOn(player);
  const everyone = currentState?.players ?? [];
  // Drunk / poisoned reminders on them in the grimoire, whatever caused them.
  for (const r of rems.filter(r => /drunk|poison/i.test(r.name) && !/everyone/i.test(r.name))) {
    out.push(`${r.name} (${reminderSourceName(r)})`);
  }
  // Abilities taken away by someone else (the Preacher's "No Ability" on a Minion).
  for (const r of rems.filter(r => /no ability/i.test(r.name) && ![bundledRoleOf(player), trueRoleOf(player)].includes(_normalizeId(r.role ?? '')))) {
    out.push(`No ability (${reminderSourceName(r)})`);
  }
  // The Minstrel's "everyone is drunk" (Travellers excepted).
  const minstrel = everyone.flatMap(liveRemindersOn).find(r => /everyone is drunk/i.test(r.name));
  if (minstrel && teamOfPlayer(player) !== 'traveller' && trueRoleOf(player) !== 'minstrel') out.push(`${reminderSourceName(minstrel)}: everyone is drunk`);
  // The Xaan's night: all Townsfolk are poisoned.
  if (teamOfPlayer(player) === 'townsfolk' && everyone.some(p => (p.reminders ?? []).some(r => isLiveReminder(r, 'xaan', 'X')))) {
    out.push("Xaan's night: Townsfolk are poisoned");
  }
  // Might not be who they think they are.
  for (const r of rems.filter(r => ['drunk', 'marionette', 'lunatic'].includes(_normalizeId(r.role ?? '')) && !/drunk|poison/i.test(r.name))) {
    out.push(`${reminderSourceName(r)} reminder (${r.name})`);
  }
  return out;
}

// [{ level: 'must' | 'may' | 'note', text }]
function stepWarnings(c) {
  const { player, night, action, spec, step, bundledId } = c;
  if (step.stOnly) return [];
  const out = pickProblems(c).map(text => ({ level: 'must', text }));
  if ((action.pick ?? []).includes('threeAfterNone') && lastChoiceWasNone(c)) out.push({ level: 'note', text: 'Their last choice was no-one — they choose 3 players tonight' });
  if (step.changed) {
    const show = (k, v) => { const s = spec?.inputs?.[k.slice(1)]; return s?.type === 'role' ? (scriptRoleFor(_normalizeId(v)).name ?? v) : dn(String(v)); };
    const was = Object.entries(step.changed.was).map(([k, v]) => show(k, v)).join(' & ');
    const now = Object.keys(step.changed.was).map(k => step.inputs[k] !== undefined ? show(k, step.inputs[k]) : '—').join(' & ');
    out.push({ level: step.changed.answered ? 'must' : 'may',
      text: `They changed their pick: was ${was}, now ${now}${step.changed.answered ? ' — what you sent was for the old pick' : ''}` });
  }
  const tellsInfo = stepAnswer(c).tokens.length > 0;
  // "You are …" steps (Alchemist, Apprentice) are setup, not ability info.
  const abilityInfo = tellsInfo && (action.tell ?? [])[0] !== 'you';
  const effect = tellsInfo ? 'info may be false' : 'ability may not work';
  const everyone = currentState?.players ?? [];

  const sober = soberReminder(player);
  if (sober) {
    out.push({ level: 'note', text: `${sober.name} (${reminderSourceName(sober)}) — sober & healthy, gets true info` });
  } else {
    if (abilityInfo && teamOfPlayer(player) === 'townsfolk' && playersOfTeam('demon').some(p => trueRoleOf(p) === 'vortox')) {
      out.push({ level: 'must', text: 'Vortox in play — their info must be false' });
    }
    const reasons = droisonReasons(player);
    for (const why of reasons) out.push({ level: 'may', text: `${why} — ${effect}` });
    // Poisoned / made drunk by one of tonight's steps (not yet in the grimoire).
    const bySteps = !reasons.length && droisonedBySteps(player, night);
    if (bySteps) out.push({ level: 'may', text: `Chosen by the ${bySteps} tonight — ${effect}` });
  }

  // Players the info follows from who may register as something else — not
  // players you choose to show (showing a Spy as a Townsfolk is your choice).
  const scope = bundledId in MISREG_SCOPE ? MISREG_SCOPE[bundledId] : { who: 'picks' };
  if (tellsInfo && scope) {
    const fieldPlayers = (pred) => (spec?.inputs ?? []).map((s, i) =>
      (s.type === 'player' || s.type === 'player?') && pred(i) ? playerByNotesName(step.inputs[`i${i}`]) : null).filter(Boolean);
    const involved = scope.who === 'picks' ? fieldPlayers(i => fieldUse(action, i) === 'pick')
      : scope.who === 'fields' ? fieldPlayers(i => scope.fields.includes(`i${i}`))
      : scope.who === 'neighbours' ? livingNeighbours(player)
      : scope.who === 'all' ? everyone
      : scope.who === 'dead' ? everyone.filter(p => p.isDead)
      : scope.who === 'nominators' ? nominationsOfDay(night - 1).map(n => n.nominator).filter(Boolean)
      : scope.who === 'voters' ? nominationsOfDay(night - 1).flatMap(n => n.voters)
      : [];
    for (const p of new Set(involved)) {
      const m = p !== player && misregistration(p);
      if (m && (!scope.demon || m.demon)) out.push({ level: 'may', text: `${dn(displayName(p, p.seat))} ${m.text}` });
    }
  }
  // The Fortune Teller's Red Herring among their picks.
  if (bundledId === 'fortuneteller') {
    for (const k of ['i0', 'i1']) {
      const p = playerByNotesName(step.inputs[k]);
      if (p && (p.reminders ?? []).some(r => isLiveReminder(r, 'fortuneteller', 'Red Herring'))) out.push({ level: 'note', text: `${dn(displayName(p, p.seat))} is the Red Herring — registers as the Demon to them` });
    }
  }
  return out;
}

function nightStepBodyHtml(c) {
  const { key, step, spec, action, player, night } = c;
  const canSignal = !!player.id && !step.stOnly; // a Storyteller-held ability messages nobody
  const btn = (act, label, opts = {}) => `<button class="nstep-btn${opts.primary ? ' nstep-primary' : ''}" data-act="${act}" data-key="${esc(key)}"${opts.idx !== undefined ? ` data-idx="${opts.idx}"` : ''}${opts.title ? ` title="${esc(opts.title)}"` : ''}${opts.disabled ? ' disabled' : ''}>${label}</button>`;

  const when = action.when ? `<div class="nstep-when">Only if: ${esc(action.when)}</div>` : '';
  const warn = stepWarnings(c).map(w =>
    `<div class="nstep-warn nstep-warn-${w.level}">${w.level === 'note' ? '' : ICON_SVG.logWarn} ${esc(w.text)}</div>`).join('');
  const inputs = spec?.inputs?.some((s, i) => fieldUse(action, i) !== 'hide')
    ? `<div class="nstep-inputs">${spec.inputs.map((s, i) => fieldUse(action, i) === 'hide' ? '' : `<div class="nstep-field nstep-use-${fieldUse(action, i)}">${nightStepInputHtml(key, s, i, step, fieldUse(action, i))}</div>`).join('')}</div>` : '';

  // What they replied, as sent — even when it doesn't fit the inputs.
  const askedAt = stepAskedAt(c);
  const reply = stepReplyTokens(player, night, askedAt);
  const replyHtml = reply.length
    ? `<div class="nstep-reply"><span class="nstep-label">Reply</span>${tokensHtml(reply)}</div>`
    : askedAt && !step.done ? `<span class="nstep-waiting">${ICON_SVG.logClock} waiting for reply…</span>` : '';

  // Messages to other players this step causes.
  const notifies = (action.notify ?? []).map((n, idx) => {
    if (!notifyApplies(n, c)) return '';
    const { tokens, missing } = resolveTemplate(n.tokens, c);
    const to = notifyRecipients(n, c);
    const toLabel = to.length ? to.map(p => dn(displayName(p, p.seat))).join(', ') : { demon: 'the Demon', minions: 'the Minions', evil: 'evil players' }[n.to] ?? 'chosen player';
    const ready = !missing && tokens.length && to.some(p => p.id)
      && (!n.tokens.includes('recipientRole') || to.every(p => roleTokenOf(p)));
    const action2 = (canSignal || to.some(p => p.id) ? btn('notify-compose', 'Compose…', { idx, title: 'Open in the Signal panel to change it' }) : '')
      + (step.notified[idx] ? `<span class="nstep-sent">Sent</span>` : btn('notify', 'Send', { idx, disabled: !ready }));
    return `<div class="nstep-notify"><span class="nstep-label">→ ${esc(toLabel)}</span>${tokensHtml(tokens)}${missing ? '<span class="nstep-label">…</span>' : ''}${action2}</div>`;
  }).join('');

  const answer = stepAnswer(c);
  const asks = canSignal && (action.wake === 'choice' || action.wake === 'ability' || action.ask)
    ? [btn('ask', esc(action.ask ? resolveTemplate(action.ask, c).tokens.map(signalTokenLabel).join(' + ') : ASK_LABELS[action.wake]), { idx: 'primary', title: askedAt ? 'Send again' : 'Send to them' }),
       // A "may" ability: after a yes they may still need "Make a choice!".
       // (A "choose a player" role never gets "Use your ability?".)
       action.wake === 'ability' ? `<button class="nstep-btn nstep-btn-alt" data-act="ask" data-idx="choice" data-key="${esc(key)}" title="After a yes: ask for their pick">${ASK_LABELS.choice}</button>` : '']
    : [];
  // A pick that breaks the rules: tell them no and ask again.
  const reject = canSignal && !step.done && pickProblems(c).length
    ? btn('ask', 'No + Make a choice!', { primary: true, idx: 'reject', title: 'Reply “no”, then “Make a choice!” — and wait for their new pick' }) : '';
  const send = canSignal && answer.tokens.length && !step.done
    ? btn('send', 'Send', { primary: true, disabled: answer.missing, title: `Send ${answer.tokens.map(signalTokenLabel).join(' ')} and finish` }) : '';
  const buttons = [
    reject,
    ...asks,
    canSignal ? btn('compose', 'Compose…', { title: 'Open in the Signal panel' }) : '',
    send,
    step.done ? btn('reopen', 'Reopen') : btn('done', action.wake === 'none' || action.when ? 'Done / skip' : 'Done', { primary: !send && !reject, title: 'Finish without sending' }),
  ].join('');
  const preview = answer.tokens.length && !step.done ? `<div class="nstep-reply"><span class="nstep-label">Sends</span>${tokensHtml(answer.tokens)}${action.shuffle ? '<span class="nstep-label" title="The players go out in random order">⇄</span>' : ''}</div>` : '';
  // Which grimoire reminders finishing this step will place, so it's never a surprise.
  const places = step.done ? [] : Object.entries(remindersByName(action)).flatMap(([name, fields]) =>
    fields.map(k => step.inputs[k]).filter(Boolean).map(v => `${name} → ${dn(v)}`));
  const placesHtml = places.length ? `<div class="nstep-places" title="Send / Done puts these reminders in the botc.app grimoire (moving them off anyone else)">Places: ${esc(places.join(', '))}</div>` : '';
  return `<div class="nstep-body">${when}${warn}${inputs}${placesHtml}${replyHtml}${preview}${notifies}<div class="nstep-actions">${buttons}</div></div>`;
}

function renderNightStepsHtml(night) {
  buildNightSteps(night); // first pass fills the steps (a grant filled now, e.g. the Cannibal's, shows below)
  const { items, confirms } = buildNightSteps(night);
  // Once-per-game abilities already used don't wake.
  for (const it of items) if (it.key && it.action.once && !it.step.done && usedEarlier(it)) it.usedUp = true;
  // The active step: the first unfinished one whose holder is alive.
  const active = items.find(it => it.key && !it.step.done && !it.usedUp && (!it.player.isDead || it.action.dead))?.key ?? null;
  const open = nightStepExpanded && items.some(it => it.key === nightStepExpanded) ? nightStepExpanded : active;
  // Count only steps that will happen: not dead holders whose role doesn't act
  // when dead, nor once-per-game abilities already used.
  const steps = items.filter(it => it.key && (it.step.done || ((!it.player.isDead || it.action.dead) && !it.usedUp)));
  const doneCount = steps.filter(it => it.step.done).length;

  const rows = [];
  items.forEach((it, idx) => {
    if (!it.key) {
      // Skip a label with no steps under it.
      const next = items[idx + 1];
      if (!next || !next.key) return;
      const tip = NIGHT_MARKER_REMINDERS[it.label];
      rows.push(`<li class="norder-marker"${tip ? ` data-tip="${esc(tip)}"` : ''}>${esc(it.label)}</li>`);
      return;
    }
    const { key, step, bundledId, player, action } = it;
    const infoName = NIGHT_INFO_NAMES[bundledId];
    const role = infoName ? (bundledRoleOf(player) ? scriptRoleFor(bundledRoleOf(player)) : {}) : scriptRoleFor(bundledId);
    const url = role.id ? _iconUrl(role) : null;
    const icon = url ? `<img class="tp-role-icon" src="${esc(url)}" />` : '';
    const name = displayName(player, player.seat);
    const warnings = stepWarnings(it).filter(w => w.level !== 'note');
    const droisoned = warnings.length
      ? `<span class="nstep-droisoned${warnings.some(w => w.level === 'must') ? ' nstep-must' : ''}" title="${esc(warnings.map(w => w.text).join('\n'))}">${ICON_SVG.logWarn}</span>` : '';
    const holderAttrs = player.id ? ` data-uid="${esc(String(player.id))}" data-night="Night ${night}" title="Signals this night"` : '';
    const holder = step.stOnly ? `<span class="norder-holder nstep-st">Storyteller</span>` : `<span class="norder-holder${player.id ? ' sig-hist-holder' : ''}"${holderAttrs}><span class="role-name ${playerTeamByName(name)}${player.isDead ? ' norder-dead' : ''}" data-player="${esc(name)}">${player.isDead ? ICON_SVG.logSkull : ''}${esc(dn(name))}</span></span>`;
    const isOpen = key === open;
    const state = step.done ? 'done' : it.usedUp ? 'used' : key === active ? 'active' : 'pending';
    const mark = step.done ? '✓' : key === active ? '▶' : action.wake === 'none' ? '·' : '';
    const sub = step.done ? nightStepSummary(it) : it.usedUp ? 'ability already used' : '';
    const summary = sub ? `<span class="nstep-summary">${esc(sub)}</span>` : '';
    // New replies: seen once the step is open; otherwise flagged on the row.
    const fresh = newReplies(it);
    if (isOpen && fresh.length) { step.seenAt = Date.now(); saveNightSteps(); }
    const remarks = isOpen ? [] : fresh.filter(m => !isAckMessage(m));
    const acks = isOpen ? [] : fresh.filter(isAckMessage);
    const msgText = (m) => m.map(signalTokenLabel).join(' ');
    const replyBadge = remarks.length
      ? `<span class="nstep-new" title="${esc(remarks.map(msgText).join('\n'))}">💬${remarks.length > 1 ? remarks.length : ''}</span>`
      : acks.length ? `<span class="nstep-ack" title="Acknowledged: ${esc(acks.map(msgText).join(', '))}">👍</span>` : '';
    const replyLine = remarks.length ? `<span class="nstep-new-text">“${esc(msgText(remarks[remarks.length - 1]).slice(0, 80))}”</span>` : '';
    const reminder = infoName ? (NIGHT_MARKER_REMINDERS[Object.keys(NIGHT_INFO_STEPS).find(l => NIGHT_INFO_STEPS[l] === bundledId)] ?? '') : nightReminderText(bundledId, night);
    const title = infoName ?? role.name ?? bundledId;
    rows.push(`<li class="nstep nstep-${state}${action.wake === 'none' ? ' nstep-nowake' : ''}${isOpen ? ' nstep-open' : ''}${remarks.length ? ' nstep-has-new' : ''}">
        <div class="nstep-head" data-key="${esc(key)}">
          <span class="nstep-mark">${mark}</span>
          <span class="norder-role role-name ${infoName ? '' : role.team ?? ''}"${reminder ? ` data-tip="${esc(reminder)}"` : ''}>${icon}${esc(title)}${reminder ? '<span class="nstep-info" aria-hidden="true">i</span>' : ''}${step.via ? `<span class="nstep-via">${VIA_IS.has(step.via) ? 'is the' : 'via'} ${esc(scriptRoleFor(step.via).name ?? step.via)}</span>` : ''}</span>
          <span class="nstep-who">${replyBadge}${holder}${droisoned}</span>
          ${summary}${replyLine}
        </div>
        ${isOpen ? nightStepBodyHtml(it) : ''}
      </li>`);
  });

  // Day-info reminders (Savant, Fisherman) for whoever holds them.
  const scriptIds = inPlayRoleIds();
  const byRole = playersByRoleId();
  const reminders = Object.entries(DAY_INFO_REMINDERS).filter(([id]) => scriptIds.has(id)).flatMap(([id, note]) =>
    (byRole[id] ?? []).map(h => h.player).filter(p => !p.isDead).map(player => {
      const role = scriptRoleFor(id);
      const url = _iconUrl(role);
      const icon = url ? `<img class="tp-role-icon" src="${esc(url)}" />` : '';
      const name = displayName(player, player.seat);
      return `<li class="nstep nstep-reminder">
          <div class="nstep-head nstep-head-static">
            <span class="nstep-mark">☀</span>
            <span class="norder-role role-name ${role.team ?? ''}">${icon}${esc(role.name ?? id)}</span>
            <span class="nstep-who"><span class="role-name ${playerTeamByName(name)}" data-player="${esc(name)}">${esc(dn(name))}</span></span>
            <span class="nstep-summary">${esc(note)}</span>
          </div>
        </li>`;
    }));
  if (reminders.length) rows.push(`<li class="norder-marker">Coming day</li>`, ...reminders);

  // Things to check (rarely needed — a safety net): one quiet line each under
  // the order; "change" opens the field.
  const confirmHtml = confirms.map(c => {
    const role = scriptRoleFor(c.bundledId);
    const grantIdx = Number((c.action.grants?.from ?? 'i0').slice(1));
    const s = c.spec?.inputs?.[grantIdx];
    const v = c.step.inputs[`i${grantIdx}`];
    const gainedName = v ? (scriptRoleFor(_normalizeId(v)).name ?? v) : 'no ability';
    const open = nightConfirmOpen === c.key;
    const title = c.step.inputs.i0 && grantIdx !== 0 ? `Suggested from ${dn(c.step.inputs.i0)} (last execution / Lunch reminder)` : '';
    return `<div class="nstep-confirm-line" title="${esc(title)}">${esc(role.name ?? c.bundledId)} · ${esc(dn(displayName(c.player, c.player.seat)))} has ${esc(gainedName)}${v ? '’s ability' : ''}
      ${open && s ? nightStepInputHtml(c.key, s, grantIdx, c.step, 'note') : `<button class="link-btn link-btn-muted nstep-confirm-change" data-key="${esc(c.key)}">change</button>`}</div>`;
  }).join('');

  const titleEl = document.getElementById('night-order-title');
  if (titleEl) titleEl.textContent = `Night ${night}`;
  const countEl = document.getElementById('night-order-count');
  if (countEl) countEl.textContent = steps.length ? `${doneCount} / ${steps.length}` : '';
  return (rows.length
    ? `<ol class="norder-list">${rows.join('')}</ol>`
    : `<div class="nstep-empty">Nobody wakes tonight — assign roles in the circle to fill the order.</div>`) + confirmHtml;
}

let nightOrderRenderPending = false;
let nightConfirmOpen = null; // the "Check" line opened for changing
let nightShowTimer = false; // the storyteller flipped back to the Timer during a night…
let nightShowTimerPhase = 0; // …this one (the next night opens on the order again)
function renderNightOrder() {
  const listEl = document.getElementById('night-order-columns');
  if (!listEl) return;

  // Only shown while a night is running: it takes the Timer's place in the
  // right column (the timer is rarely used at night).
  const phase = currentState?.phase ?? 0;
  const isNight = phase % 2 === 1;
  // At night the order takes the Timer's place, but the Timer stays a click away.
  if (nightShowTimer && nightShowTimerPhase !== phase) nightShowTimer = false;
  const showOrder = isNight && !nightShowTimer;
  document.getElementById('night-order-section').hidden = !showOrder;
  document.querySelectorAll('.st-timer-block').forEach(el => { el.hidden = showOrder; });
  // Night order | Timer switch in the Phase header — only at night; by day
  // the Timer is all there is.
  const sw = document.getElementById('night-view-switch');
  if (sw) {
    sw.hidden = !isNight;
    sw.querySelectorAll('[data-view]').forEach(btn => {
      const on = (btn.dataset.view === 'timer') === nightShowTimer;
      btn.classList.toggle('toggle-btn-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }
  if (!showOrder) { listEl.innerHTML = ''; return; }

  // Don't rebuild under a focused dropdown or input: state updates arrive
  // every few seconds and would close an open dropdown / drop typing. The
  // skipped render runs once focus leaves (see the focusout listener).
  if (listEl.contains(document.activeElement) && document.activeElement.matches('input, select')) {
    nightOrderRenderPending = true;
    return;
  }
  nightOrderRenderPending = false;
  listEl.innerHTML = renderNightStepsHtml(Math.ceil(phase / 2));
  applyHighlights(); applyPinnedHighlights();
}

document.getElementById('night-order-columns').addEventListener('click', (e) => {
  const holder = e.target.closest('.sig-hist-holder');
  if (holder) {
    e.stopPropagation();
    openSignalPopover(holder.dataset.uid, holder, holder.dataset.night);
    return;
  }
  const change = e.target.closest('.nstep-confirm-change');
  if (change) { nightConfirmOpen = change.dataset.key; renderNightOrder(); return; }
  const pill = e.target.closest('.nstep-pill');
  if (pill) {
    const active = pill.classList.contains('active');
    const raw = pill.dataset.value;
    nightStepSetInput(pill.dataset.key, Number(pill.dataset.idx), active ? '' : (/^\d+$/.test(raw) ? Number(raw) : raw));
    return;
  }
  const btn = e.target.closest('.nstep-btn');
  if (btn) {
    const key = btn.dataset.key;
    if (btn.dataset.act === 'ask') nightStepAsk(key, btn.dataset.idx);
    else if (btn.dataset.act === 'notify') nightStepNotify(key, Number(btn.dataset.idx));
    else if (btn.dataset.act === 'notify-compose') nightStepNotifyCompose(key, Number(btn.dataset.idx));
    else if (btn.dataset.act === 'send') nightStepFinish(key, true);
    else if (btn.dataset.act === 'done') nightStepFinish(key, false);
    else if (btn.dataset.act === 'reopen') nightStepReopen(key);
    else if (btn.dataset.act === 'compose') nightStepCompose(key);
    return;
  }
  const head = e.target.closest('.nstep-head');
  if (head && head.dataset.key) {
    nightStepExpanded = nightStepExpanded === head.dataset.key ? null : head.dataset.key;
    renderNightOrder();
  }
});

document.getElementById('night-order-columns').addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t) showNightTip(t); else nightTipEl.hidden = true;
});
document.getElementById('night-order-columns').addEventListener('mouseleave', () => { nightTipEl.hidden = true; });

document.getElementById('night-view-switch').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  nightShowTimer = btn.dataset.view === 'timer';
  nightShowTimerPhase = currentState?.phase ?? 0;
  renderNightOrder();
});

document.getElementById('night-order-columns').addEventListener('focusout', () => {
  // Let focus settle (it may just move to another control in the list).
  setTimeout(() => { if (nightOrderRenderPending) renderNightOrder(); }, 0);
});

document.getElementById('night-order-columns').addEventListener('change', (e) => {
  const el = e.target.closest('.nstep-input');
  if (!el) return;
  const raw = el.value;
  const value = el.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
  el.blur();
  if (nightConfirmOpen === el.dataset.key) nightConfirmOpen = null;
  nightStepSetInput(el.dataset.key, Number(el.dataset.idx), value);
});

// ── Init ──────────────────────────────────────────────────────────────────

document.querySelectorAll('section:not(#ws-section) h2').forEach(h2 => {
  h2.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const section = h2.closest('section');
    const collapsing = !section.classList.contains('collapsed');
    section.classList.toggle('collapsed', collapsing);
    [...section.children].forEach(el => {
      if (el !== h2) el.style.display = collapsing ? 'none' : '';
    });
  });
});

document.getElementById('toggle-night').addEventListener('click', (e) => {
  showNightChats = !showNightChats;
  e.target.textContent = showNightChats ? 'hide night' : 'show night';
  e.target.classList.toggle('toggle-btn-active', showNightChats);
  renderChats();
});

document.getElementById('toggle-status-hl').addEventListener('click', () => {
  highlightStatus = !highlightStatus;
  saveSettings();
  syncStatusHighlight();
});

function syncStatusHighlight() {
  document.getElementById('notes-section').classList.toggle('hl-status', highlightStatus);
  document.getElementById('toggle-status-hl').classList.toggle('toggle-btn-active', highlightStatus);
}

document.getElementById('toggle-merge').addEventListener('click', () => {
  mergePhases = !mergePhases;
  saveSettings();
  syncMergeToggle();
  lastNotesKey = null;
  renderNotesGrid();
});

function syncMergeToggle() {
  document.getElementById('toggle-merge').classList.toggle('toggle-btn-active', mergePhases);
}

// ── Persisted UI settings (survive reloads) ─────────────────────────────────
const SETTINGS_KEY = 'botc-companion-settings';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof s.mergePhases === 'boolean') mergePhases = s.mergePhases;
    if (typeof s.highlightStatus === 'boolean') highlightStatus = s.highlightStatus;
    if (Array.isArray(s.customTimerPresets)) customTimerPresets = s.customTimerPresets;
    if (Array.isArray(s.customSignalPresets)) customSignalPresets = s.customSignalPresets;
  } catch { /* localStorage unavailable / corrupt — use defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mergePhases, highlightStatus, customTimerPresets, customSignalPresets }));
  } catch { /* ignore */ }
}

function applySettingsToUI() {
  syncMergeToggle();
  syncStatusHighlight();
  syncRoleSwitch();
  applyViewRole();
}

function syncRoleSwitch() {
  const rs = document.getElementById('role-switch');
  const isPlayer = viewRole === 'player';
  rs.classList.toggle('on', isPlayer);
  rs.setAttribute('aria-checked', String(isPlayer));
  document.getElementById('role-toggle').classList.toggle('ct-active', isPlayer);
}

// Storyteller vs player view — follows amIStoryteller() on startup and whenever you
// become / stop being storyteller; the manual toggle overrides it until the next change.
function applyViewRole() {
  const isStoryteller = viewRole === 'storyteller';
  document.getElementById('st-tools-section')?.style.setProperty('display', isStoryteller ? '' : 'none');
  document.getElementById('players-section')?.style.setProperty('display', isStoryteller ? '' : 'none');
  document.getElementById('script-wrap')?.style.setProperty('display', isStoryteller ? '' : 'none');
  document.getElementById('clear-grimoire-btn')?.style.setProperty('display', isStoryteller ? '' : 'none');
  document.getElementById('notes-section')?.style.setProperty('display', isStoryteller ? 'none' : '');
  if (!isStoryteller) { lastNotesKey = null; renderNotesGrid(); }
}

document.getElementById('role-switch').addEventListener('click', () => {
  viewRole = viewRole === 'storyteller' ? 'player' : 'storyteller';
  syncRoleSwitch();
  applyViewRole();
});
document.querySelectorAll('#role-toggle [data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (viewRole === btn.dataset.view) return;
    viewRole = btn.dataset.view;
    syncRoleSwitch();
    applyViewRole();
  });
});

loadSettings();
loadNightSteps();
applySettingsToUI();
initSignalPanel();
updateStRoleBtn();
renderTimerPresets();
renderSignalPresets();
initScriptLibrary();

// ── Session preview ─────────────────────────────────────────────────────────
// Shows who is in other botc.app sessions without joining them. botc.app puts a
// session's language, edition, phase, storytellers, players and spectators in
// the link-preview metadata of its /join/<name> page (what Discord shows when a
// link is pasted), so one plain GET of that page is all it takes.
const PREVIEW_KEY = 'botc-companion-preview-sessions';
const PREVIEW_REFRESH_MS = 30000;
let previewSessions = (() => {
  try {
    const list = JSON.parse(localStorage.getItem(PREVIEW_KEY) || '[]');
    return Array.isArray(list) ? list.filter(n => typeof n === 'string' && n) : [];
  } catch { return []; }
})();
const previewResults = new Map(); // name → { loading, info, error, at }
let previewChecked = null; // session open in the check overlay — saved or not
let previewTimer = null;

function savePreviewSessions() {
  try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(previewSessions)); } catch { /* ignore */ }
}

// Accepts a bare session name or any botc.app link to one (/join/x, /play/x, #x).
function previewSessionName(input) {
  let text = String(input ?? '').trim();
  if (/^https?:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { return ''; }
    if (!/(^|\.)botc\.app$/i.test(url.hostname)) return '';
    text = url.hash.length > 1 ? url.hash : url.pathname.split('/').filter(Boolean).pop() || '';
    try { text = decodeURIComponent(text); } catch { /* keep as typed */ }
  }
  return text.replace(/^#/, '').trim();
}

function parsePreviewDescription(desc) {
  const m = String(desc ?? '').replace(/\s+/g, ' ').trim().match(
    /^Chat language: (?<language>.*?) Edition: (?<edition>.*?) Phase: (?<phase>.*?) Storyteller\(s\):(?<storytellers>.*?) (?<seats>\d+) Player\(s\): (?<players>.*?)(?: \d+ Spectator\(s\): (?<spectators>.*?))? (?<join>You .*)$/
  );
  if (!m) return null; // generic site blurb — the session isn't running
  const names = (text) => (text || '').split(',').map(n => n.trim()).filter(Boolean);
  const players = [];
  let empty = 0;
  for (const entry of names(m.groups.players)) {
    // Each seat reads "<status> <name>"; unclaimed ones are named "Seat N".
    const space = entry.indexOf(' ');
    const name = space === -1 ? '' : entry.slice(space + 1);
    if (/^Seat \d+$/.test(name)) empty++;
    else players.push(entry);
  }
  return {
    language: m.groups.language,
    edition: m.groups.edition,
    phase: m.groups.phase,
    storytellers: names(m.groups.storytellers),
    seats: Number(m.groups.seats),
    players,
    empty,
    spectators: names(m.groups.spectators),
    join: m.groups.join,
  };
}

async function fetchPreview(name) {
  const res = await fetch(`https://botc.app/join/${encodeURIComponent(name)}`, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`botc.app answered ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  return parsePreviewDescription(doc.querySelector('meta[property="og:description"]')?.getAttribute('content'));
}

async function refreshPreview(name) {
  previewResults.set(name, { ...previewResults.get(name), loading: true });
  renderPreviewList();
  let result;
  try {
    result = { info: await fetchPreview(name), at: Date.now() };
  } catch (err) {
    result = { error: err?.message || 'request failed', at: Date.now() };
  }
  if (!previewSessions.includes(name) && previewChecked !== name) return; // removed while loading
  previewResults.set(name, result);
  renderPreviewList();
}

// Everything worth keeping fresh: the saved list plus the session being checked.
function previewNames() {
  return previewChecked && !previewSessions.includes(previewChecked) ? [previewChecked, ...previewSessions] : previewSessions;
}

function refreshAllPreviews() {
  previewNames().forEach(refreshPreview);
}

const PREVIEW_ICONS = {
  refresh: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"></path><path d="M21 3v5h-5"></path></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
};

// A seat reads "<status> <name>". The plain white circle is by far the most
// common status, and a row of them is just noise — draw it as a small dot and
// keep any other status emoji as it is.
function previewPlayerChip(entry) {
  const space = entry.indexOf(' ');
  const status = space === -1 ? '' : entry.slice(0, space);
  const name = space === -1 ? entry : entry.slice(space + 1);
  const mark = /^[⚪○◯]️?$/.test(status)
    ? '<span class="pv-dot"></span>'
    : status ? `<span class="pv-status">${esc(status)}</span>` : '';
  return `<span class="pv-chip">${mark}${esc(name)}</span>`;
}

function previewSection(label, count, bodyHtml) {
  return `<div class="pv-section">
    <div class="pv-label">${label}${count ? ` <span class="pv-count">${esc(count)}</span>` : ''}</div>
    ${bodyHtml}
  </div>`;
}

// inOverlay: the card shown alone in the check overlay — it offers Save, and
// its ✕ closes the overlay instead of removing the session from the list.
function renderPreviewCard(name, inOverlay = false) {
  const saved = previewSessions.includes(name);
  const r = previewResults.get(name) || { loading: true };
  const info = r.info;
  let body;
  if (r.error) body = `<div class="pv-note pv-error">Could not fetch: ${esc(r.error)}</div>`;
  else if (info) {
    const seats = `${info.players.length}/${info.seats}`;
    body = `<div class="pv-script">${esc(info.edition)}<span class="pv-sep">·</span>${esc(info.language)}</div>`
      + previewSection('Storyteller', '', `<div class="pv-names">${info.storytellers.length ? esc(info.storytellers.join(', ')) : '<span class="pv-none">none</span>'}</div>`)
      + previewSection('Players', seats, info.players.length
        ? `<div class="pv-chips">${info.players.map(previewPlayerChip).join('')}</div>`
        : '<div class="pv-names"><span class="pv-none">nobody seated</span></div>')
      + (info.spectators.length ? previewSection('Spectators', info.spectators.length, `<div class="pv-names pv-quiet">${esc(info.spectators.join(', '))}</div>`) : '')
      + `<div class="pv-note">${esc(info.join)}</div>`;
  } else if (r.at) body = '<div class="pv-note">Not running right now.</div>';
  else body = '<div class="pv-note">Loading…</div>';
  return `<div class="pv-card${r.loading ? ' pv-loading' : ''}" data-session="${esc(name)}">
    <div class="pv-head">
      <a class="pv-name" href="https://botc.app/join/${esc(encodeURIComponent(name))}" target="_blank" rel="noopener" title="Open in botc.app">${esc(name)}</a>
      ${info ? `<span class="pv-phase">${esc(info.phase)}</span>` : ''}
      <span class="pv-head-actions">
        ${!inOverlay || saved ? '' : '<button type="button" class="pv-text-btn" data-pv-action="save" title="Keep this session in the Sessions list">Save</button>'}
        ${info ? `<button type="button" class="pv-text-btn pv-join" data-pv-action="join" title="Take the botc.app tab to this session">Join</button>` : ''}
        <button type="button" class="pv-icon-btn" data-pv-action="refresh" title="Refresh" aria-label="Refresh ${esc(name)}">${PREVIEW_ICONS.refresh}</button>
        ${inOverlay
          ? `<button type="button" class="pv-icon-btn" data-pv-action="dismiss" title="Close" aria-label="Close">${PREVIEW_ICONS.close}</button>`
          : `<button type="button" class="pv-icon-btn" data-pv-action="remove" title="Remove from the list" aria-label="Remove ${esc(name)}">${PREVIEW_ICONS.close}</button>`}
      </span>
    </div>
    ${body}
  </div>`;
}

function renderPreviewList() {
  const list = document.getElementById('preview-list');
  if (!list) return;
  const overlay = document.getElementById('preview-overlay');
  overlay.style.display = previewChecked ? '' : 'none';
  document.getElementById('preview-check').innerHTML = previewChecked ? renderPreviewCard(previewChecked, true) : '';
  list.innerHTML = previewSessions.length
    ? previewSessions.map(name => renderPreviewCard(name)).join('')
    : '<div class="pv-empty">Check a session to see its phase, script, storyteller, players and spectators without joining it. Save the ones you want to keep an eye on.</div>';
}

// Sends the open botc.app tab to the session (the background opens one if there
// is none). That tab leaves whatever game it's in, so ask first if it's in one.
function joinPreviewSession(name) {
  const current = currentState?.session;
  if (current && current !== name && !confirm(`Leave "${current}" and join "${name}"?`)) return;
  if (!chrome.runtime.id) { // opened as a plain page, no extension behind it
    window.open(`https://botc.app/join/${encodeURIComponent(name)}`, '_blank', 'noopener');
    return;
  }
  sendBg({ type: 'JOIN_SESSION', session: name });
  closePreviewPopup();
}

// Closes the check overlay. A session that was only looked at leaves no trace.
function closePreviewCheck() {
  if (!previewChecked) return false;
  if (!previewSessions.includes(previewChecked)) previewResults.delete(previewChecked);
  previewChecked = null;
  renderPreviewList();
  return true;
}

function closePreviewPopup() {
  closePreviewCheck();
  const popup = document.getElementById('preview-popup');
  if (!popup?.classList.contains('open')) return;
  popup.classList.remove('open');
  const btn = document.getElementById('preview-btn');
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  clearInterval(previewTimer);
  previewTimer = null;
}

function openPreviewPopup() {
  const popup = document.getElementById('preview-popup');
  const btn = document.getElementById('preview-btn');
  popup.classList.add('open');
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  // Fixed-positioned under the button, right-aligned to it but kept on screen —
  // the header wraps, so the button can end up anywhere along the row.
  const rect = btn.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - popup.offsetWidth, window.innerWidth - popup.offsetWidth - 8));
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.left = `${left}px`;
  refreshAllPreviews();
  renderPreviewList();
  clearInterval(previewTimer);
  previewTimer = setInterval(refreshAllPreviews, PREVIEW_REFRESH_MS);
  document.getElementById('preview-input').focus();
}

(() => {
  const btn = document.getElementById('preview-btn');
  const popup = document.getElementById('preview-popup');
  const input = document.getElementById('preview-input');
  const overlay = document.getElementById('preview-overlay');
  if (!btn || !popup) return;

  btn.addEventListener('click', () => {
    if (popup.classList.contains('open')) closePreviewPopup();
    else openPreviewPopup();
  });
  document.addEventListener('click', (e) => {
    // A card re-renders on click (refresh/remove), detaching e.target — so test
    // the click's original path rather than popup.contains().
    const path = e.composedPath();
    if (path.includes(popup) || path.includes(btn) || path.includes(overlay)) return;
    closePreviewPopup();
  });
  window.addEventListener('resize', closePreviewPopup);

  document.getElementById('preview-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = previewSessionName(input.value);
    if (!name) { input.select(); return; }
    input.value = '';
    // Only a look: the session opens in its own overlay and reaches the saved
    // list only through the Save button there.
    previewChecked = name;
    refreshPreview(name);
  });

  document.getElementById('preview-overlay-backdrop').addEventListener('click', closePreviewCheck);

  const onCardClick = (e) => {
    const action = e.target.closest('[data-pv-action]')?.dataset.pvAction;
    const name = e.target.closest('.pv-card')?.dataset.session;
    if (!action || !name) return;
    if (action === 'refresh') refreshPreview(name);
    if (action === 'join') joinPreviewSession(name);
    if (action === 'dismiss') closePreviewCheck();
    if (action === 'save' && !previewSessions.includes(name)) {
      previewSessions.unshift(name);
      savePreviewSessions();
      if (!closePreviewCheck()) renderPreviewList(); // saving closes the overlay, back to the list
    }
    if (action === 'remove') {
      previewSessions = previewSessions.filter(n => n !== name);
      previewResults.delete(name);
      savePreviewSessions();
      renderPreviewList();
    }
  };
  document.getElementById('preview-list').addEventListener('click', onCardClick);
  document.getElementById('preview-check').addEventListener('click', onCardClick);
})();

document.getElementById('st-role-btn')?.addEventListener('click', () => {
  if (amIStoryteller()) {
    if (!confirm('Step down as storyteller?')) return;
    sendBg({ type: 'STEP_DOWN_STORYTELLER' });
  } else {
    sendBg({ type: 'BECOME_STORYTELLER' });
  }
});

// Esc closes whatever popover/menu is open
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const chip = document.getElementById('token-popover');
  if (chip && chip.style.display !== 'none') closePopover();
  closeListPicker();
  closeSignalPopover();
  if (signalHistoryOpen) closeSignalHistoryPanel();
  else if (interactionsOpen && !document.getElementById('list-picker')?.contains(e.target)) closeInteractionsPanel();
  if (!closePreviewCheck()) closePreviewPopup(); // overlay first, then the list under it
});

document.getElementById('ws-toggle').addEventListener('click', (e) => {
  if (e.target === document.getElementById('clear-ws')) return;
  const log = document.getElementById('ws-log');
  const chevron = document.querySelector('.ws-chevron');
  log.classList.toggle('visible');
  const open = log.classList.contains('visible');
  chevron.classList.toggle('open', open);
  if (open) log.scrollTop = log.scrollHeight;
});

document.getElementById('clear-ws').addEventListener('click', () => {
  document.getElementById('ws-log').innerHTML = '';
});

document.getElementById('add-note-row').addEventListener('click', (e) => openAddNoteRowPicker(e.currentTarget));

document.getElementById('clear-notes').addEventListener('click', () => {
  if (!confirm('Clear all notes?')) return;
  cellTokens = {};
  playerMeta = {};
  // Keep materializedStatus: cleared death/revive chips stay cleared instead of
  // being recreated from the timeline; only brand-new deaths will reappear.
  sendBg({ type: 'CLEAR_TOKENS' });
  lastNotesKey = null;
  renderNotesGrid();
  renderPlayers();
  renderNightOrder();
});



// ── Name highlight on hover ───────────────────────────────────────────────

let hoveredPlayer = null;

const applyPinnedHighlights = () => {
  document.querySelectorAll('[data-player]').forEach(el => {
    el.classList.toggle('player-pinned', pinnedPlayers.has(el.dataset.player));
  });
};

const applyHighlights = () => {
  if (hoveredPlayer === null) return;
  document.querySelectorAll('[data-player]').forEach(el => {
    el.classList.toggle('player-hl', el.dataset.player === hoveredPlayer);
  });
};

document.addEventListener('mouseover', e => {
  const entering = e.target.closest('[data-player]');
  const leaving = e.relatedTarget?.closest('[data-player]');
  if (entering === leaving) return;
  hoveredPlayer = entering?.dataset.player ?? null;
  applyHighlights(); applyPinnedHighlights();
});

document.addEventListener('mouseout', e => {
  const leaving = e.target.closest('[data-player]');
  const entering = e.relatedTarget?.closest('[data-player]');
  if (leaving && !entering) {
    hoveredPlayer = null;
    document.querySelectorAll('[data-player].player-hl').forEach(el => el.classList.remove('player-hl'));
  }
});

document.addEventListener('click', e => {
  if (e.target.closest('.notes-scroll') && !e.target.closest('.notes-player-name-text')) return;
  // A click already spent on a seat pick (nominate/swap/mark) means "pick this
  // one" and nothing else. The inner buttons stopPropagation to get that, but
  // the name span isn't a button — so without this, every pick made by clicking
  // a name also throws the detail panel open over it.
  if (e.botcSeatPick) return;
  const el = e.target.closest('[data-player]');
  if (el) openPlayerTimeline(el.dataset.player);
});

function showReloadPrompt() {
  setTimeout(() => {
    if (currentState) return;
    const banner = document.getElementById('no-data-banner') ?? (() => {
      const el = document.createElement('div');
      el.id = 'no-data-banner';
      document.body.insertBefore(el, document.querySelector('main'));
      return el;
    })();
    banner.innerHTML = 'The botc.app tab was open before the extension loaded. <strong>Please reload the botc.app tab</strong> to connect.';
    banner.style.display = '';
  }, 300);
}

// Unlike the no-data banner this one survives state pushes: the old bridge
// keeps sending them, it's just running outdated code.
function showStaleBridgeBanner() {
  if (document.getElementById('stale-bridge-banner')) return;
  const el = document.createElement('div');
  el.id = 'stale-bridge-banner';
  el.innerHTML = 'The extension was updated while botc.app was open. <strong>Please reload the botc.app tab</strong> to use the new version.';
  document.body.insertBefore(el, document.querySelector('main'));
}

sendBg({ type: 'GET_STATE' }, (response) => {
  if (!response) { showReloadPrompt(); return; }
  applyFullRefresh(response);
  const wsEvents = response.wsEvents ?? [];
  wsEvents.forEach(appendWsEvent);
});

function applyFullRefresh(response) {
  if (!response) return;
  fullTimeline = [];
  lastNotesKey = '';
  nameMap = response.nameMap ?? {};
  cellTokens = response.cellTokens ?? {};
  materializedStatus = new Set(response.materializedStatus ?? []);
  playerMeta = response.playerMeta ?? {};
  renderState(response.state);
  if (response.timeline?.length) addTimelineEvents(response.timeline);
  allNominations = response.nominations ?? [];
  pendingNomination = response.pendingNomination ?? null;
  renderNominations();
  allChatSessions = response.chatSessions ?? [];
  renderChats();
  allTextMessages = response.textMessages ?? [];
  renderMessages();
  renderNotesGrid();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FULL_REFRESH') {
    applyFullRefresh(message);
    return;
  }
  if (message.type === 'BOTC_UPDATE') {
    const payload = message.payload;
    if (payload.type === 'STATE') {
      let nameMapGrew = false;
      if (message.nameMap) {
        for (const [id, name] of Object.entries(message.nameMap)) {
          if (!nameMap[id]) nameMapGrew = true;
          nameMap[id] = name;
        }
      }
      renderState(payload.data); patchTimelineNames(); materializeStatusChips(); renderNotesGrid(); refreshPlayerTimeline();
      if (nameMapGrew) { renderNominations(); renderChats(); renderMessages(); refreshPlayerTimeline(); }
    }
    else if (payload.type === 'WS_RECV' || payload.type === 'WS_SEND') { appendWsEvent(payload); }
    else if (payload.type === 'CONN') { applyConn(payload.data); }
    else if (payload.type === 'VOTE_CLOCK') { voteClock = payload.data; updateVoteClock(); updateShutUpButton(); }
    else if (payload.type === 'STALE_BRIDGE') { showStaleBridgeBanner(); }
    return;
  }
  if (message.type === 'NEEDS_RELOAD') {
    showReloadPrompt();
    return;
  }
  if (message.type === 'TIMELINE_EVENTS') {
    addTimelineEvents(message.events ?? []);
    renderNotesGrid();
    refreshPlayerTimeline();
  }
  if (message.type === 'NOMINATIONS_UPDATE') {
    const prev = pendingNomination;
    allNominations = message.nominations ?? [];
    pendingNomination = message.pendingNomination ?? null;
    if (pendingNomination) nominationSent = null; // confirmed — the hold is over
    // A nomination made in botc.app itself switches Nominate on, so the next
    // one can be picked here. Not over another pick mode, and not for Shut up
    // and listen (an empty seat nominating itself).
    const nom = pendingNomination;
    const isNew = nom && !(prev && prev.nominatorSeat === nom.nominatorSeat && prev.nomineeSeat === nom.nomineeSeat);
    const isShutUp = nom && nom.nominatorSeat === nom.nomineeSeat && nom.seatNames?.[nom.nomineeSeat] == null;
    if (isNew && !isShutUp && playerActionMode === null) setPlayerActionMode('nominate');
    renderNominations();
    refreshPlayerTimeline();
    // Limit flags are baked into the seat markup, so they only pick up a new
    // nomination on a re-render
    renderPlayers();
  }
  if (message.type === 'CHAT_SESSIONS_UPDATE') {
    allChatSessions = message.sessions ?? [];
    renderChats();
    refreshPlayerTimeline();
  }
  if (message.type === 'TEXT_MESSAGES_UPDATE') {
    allTextMessages = message.textMessages ?? [];
    renderMessages();
    refreshPlayerTimeline();
  }
});

// Views are rebuilt with innerHTML on every state update, which restarts any
// looping CSS animation on the new elements (pulses, live dots) — a visible
// jump every few seconds. Pinning every infinite animation to the start of the
// document timeline keeps them in phase: a recreated element picks up where
// the old one was. One-shot animations aren't touched; elements that carry
// one have to survive the rebuild instead (see renderPlayers).
(function phaseLockLoopingAnimations() {
  let queued = false;
  const sync = () => {
    queued = false;
    for (const a of document.getAnimations()) {
      if (typeof CSSAnimation !== 'undefined' && !(a instanceof CSSAnimation)) continue;
      if (a.effect?.getTiming().iterations !== Infinity || a.startTime === 0 || a.playState !== 'running') continue;
      a.startTime = 0;
    }
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(sync); }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();


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
let revealedRoles = {}; // playerId → roleId, populated from end entry
let allNominations = [];
let allChatSessions = [];
let allTextMessages = [];
let nameMap = {};
let showNightChats = false;
let mergePhases = true; // notes grid: one column per round (Night N + Day N) instead of per phase
let colorSource = 'grimoire'; // 'grimoire' | 'notes'
let openPlayerTimelineName = null;
let cellTokens = {};
let materializedStatus = new Set(); // event keys already turned into a status chip — never recreate, even after edit/delete
let playerMeta = {}; // { name: { roleId, roleName, roleTeam, roleIconUrl, alignment } }
let lastNotesKey = '';
let notesFixedColWidths = null; // { player, role, align } in px — set once, never shrunk
let pinnedPlayers = new Set();

const PREDEFINED_TAGS = [
  { id: 'first-night-info',     label: 'first night' },
  { id: 'no-first-night-info',  label: 'isn\'t first night' },
  { id: 'wakes',                label: 'wakes at night' },
  { id: 'no-wake',              label: 'doesn\'t wake' },
  { id: 'outsider',             label: 'outsider' },
  { id: 'not-outsider',         label: 'not an outsider' },
];

// Chips that tint their own cell. Default label is editable per chip.
const CELL_COLORS = {
  good:      { label: '👍 Good ping', title: 'Good ping (blue)' },
  evil:      { label: '👎 Evil ping', title: 'Evil ping (red)' },
  droisoned: { label: '🍺 Droisoned', title: 'Drunk or poisoned (sick green)' },
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

function registerRoleAlias(r) {
  const id = (r.id ?? '').replace(/^traveller_/, '');
  if (!id || _roleAliases[id] || _roles().some(x => x.id === id)) return;
  // Official wiki icon URL is the most reliable hint: Icon_fortune_teller.png → fortuneteller
  const m = (r.iconUrl ?? '').match(/Icon_([a-z0-9_]+)\./i);
  const guess = m ? m[1].toLowerCase().replace(/_/g, '') : null;
  if (guess && _roles().some(x => x.id === guess)) { _roleAliases[id] = guess; return; }
  // Fallback: longest canonical id the custom id starts with (washerwomancz → washerwoman)
  let best = null;
  for (const x of _roles()) {
    if (id.startsWith(x.id) && (!best || x.id.length > best.length)) best = x.id;
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


// ── Render ────────────────────────────────────────────────────────────────

function playerName(playerId) {
  const p = currentState?.players?.find(p => p.id === String(playerId));
  return p?.name ?? playerId;
}

function roleNameFromId(roleId, state) {
  const role = state?.roles?.find(r => r.id === roleId);
  return role?.name ?? roleId;
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

function renderState(state) {
  if (!state) return;
  currentState = { ...state, roles: enrichRoles(state.roles) };
  document.getElementById('no-data-banner')?.remove();

  const phase = state.phase ? phaseLabel(state.phase) : '—';
  const phaseBadge = document.getElementById('phase-badge');
  phaseBadge.textContent = phase;
  phaseBadge.className = 'badge ' + (state.phase % 2 === 1 ? 'night' : 'day');

  document.getElementById('session-id').textContent = state.session ? `· ${state.session}` : '';

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

function renderTimeline() {
  const list = document.getElementById('timeline-log');
  const savedTop = list.scrollTop;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;

  // Save collapse/reveal state keyed by block label
  const collapsedBlocks = new Set();
  const revealedBlocks = new Set();
  list.querySelectorAll('.tl-block').forEach(el => {
    const label = el.querySelector('.tl-block-label')?.textContent;
    if (label && el.classList.contains('collapsed')) collapsedBlocks.add(label);
    if (el.querySelector('.tl-game-end.revealed')) revealedBlocks.add(label);
  });

  list.innerHTML = '';

  // Group events into phase blocks
  // Each block: { label, start, end (null if ongoing), deaths[] }
  const blocks = [];
  let current = null;

  for (const ev of fullTimeline) {
    if (ev.type === 'start') {
      current = { label: 'Game started', start: ev.ts, end: null, deaths: [] };
      blocks.push(current);
    } else if (ev.type === 'phase') {
      if (current) current.end = ev.ts;
      current = { label: ev.label, start: ev.ts, end: null, deaths: [] };
      blocks.push(current);
    } else if ((ev.type === 'death' || ev.type === 'ghostvote' || ev.type === 'revive') && current) {
      const isEarlyDay = current.label.startsWith('Day') && (ev.ts - current.start) < 120000;
      const target = isEarlyDay && blocks.length >= 2 ? blocks[blocks.length - 2] : current;
      target.deaths.push(isEarlyDay ? { ...ev, refStart: current.start } : ev);
    } else if (ev.type === 'end' && current) {
      current.end = ev.ts;
      current.end_event = ev;
    }
  }

  for (const block of blocks) {
    const isOngoing = block.end === null;
    const dur = block.end ? duration(block.end - block.start) : null;

    const li = document.createElement('li');
    li.className = `tl-block tl-${block.label === 'Game started' ? 'start' : block.label.startsWith('Night') ? 'night' : 'day'}`;

    const timeRange = isOngoing
      ? `${fmt(block.start)} – now`
      : `${fmt(block.start)} – ${fmt(block.end)}`;

    li.innerHTML = `
      <div class="tl-block-header">
        <span class="tl-block-label">${block.label}</span>
        <span class="tl-block-time">${timeRange}${dur ? ` · ${dur}` : ''}</span>
        <span class="tl-block-chevron">▾</span>
      </div>
      ${block.deaths.map(d => {
        const name = d.name ?? playerName(d.playerId);
        const team = playerTeamByName(name);
        const blockIsDay = block.label.startsWith('Day');
        const isExile = team === 'traveller' && blockIsDay && d.type === 'death';
        const icon = d.type === 'ghostvote' ? '👻' : d.type === 'revive' ? '🌱' : isExile ? '👋' : '💀';
        const ghostTarget = d.type === 'ghostvote' ? (() => { const n = nominationAt(d.ts); return n ? ` on ${esc(seatName(n.nomineeSeat))}` : ''; })() : '';
        const action = d.type === 'ghostvote' ? `ghost vote${ghostTarget}` : d.type === 'revive' ? 'revived' : isExile ? 'exiled' : 'died';
        const cls = d.type === 'revive' ? 'revive' : d.type === 'ghostvote' ? 'ghostvote' : '';
        const offsetStr = d.refStart ? '' : ` <span class="tl-death-time">+${duration(d.ts - block.start)}</span>`;
        return `<div class="tl-death ${cls}">${icon} <span class="${team ? `role-name ${team}` : ''}" data-player="${esc(name)}">${esc(dn(name))}</span> ${action}${offsetStr}</div>`;
      }).join('')}
      ${block.end_event ? `<div class="tl-game-end tl-${block.end_event.isEvilWin ? 'evil' : 'good'} spoiler"><span class="spoiler-hide">reveal result</span><span class="spoiler-show">${block.end_event.label}</span></div>` : ''}
    `;

    if (collapsedBlocks.has(block.label)) li.classList.add('collapsed');
    if (revealedBlocks.has(block.label)) li.querySelector('.tl-game-end')?.classList.add('revealed');

    li.querySelector('.tl-block-header').addEventListener('click', (e) => {
      e.stopPropagation();
      li.classList.toggle('collapsed');
    });
    list.appendChild(li);
  }

  list.querySelectorAll('.tl-game-end.spoiler').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('revealed'));
  });
  list.scrollTop = atBottom ? list.scrollHeight : savedTop;
  applyHighlights(); applyPinnedHighlights();
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
    if (ev.type === 'roles_revealed') {
      for (const p of ev.roles) revealedRoles[p.id] = p.role;
      continue;
    }
    if (!existing.has(tlKey(ev))) {
      fullTimeline.push(ev);
      existing.add(tlKey(ev));
    }
  }
  fullTimeline.sort((a, b) => a.ts - b.ts);
  patchTimelineNames();
  materializeStatusChips();
  renderTimeline();
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

function seatName(seat) {
  if (!currentState?.players) return `Seat ${seat + 1}`;
  const p = currentState.players.find(p => p.seat === seat);
  return p?.name ?? `Seat ${seat + 1}`;
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

function renderNominations() {
  const list = document.getElementById('nominations-log');
  const savedTop = list.scrollTop;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const collapsedPhases = new Set([...list.querySelectorAll('.nom-day-sep.collapsed')].map(el => el.textContent));
  list.innerHTML = '';

  let lastDay = null;
  for (const nom of allNominations) {
    const day = gamePhaseAt(nom.ts);
    if (day !== lastDay) {
      const sep = document.createElement('li');
      sep.className = 'nom-day-sep';
      sep.textContent = day;
      list.appendChild(sep);
      lastDay = day;
    }

    const nominator = seatName(nom.nominatorSeat);
    const nominee = seatName(nom.nomineeSeat);
    const yesNames = nom.yesSeats.map(s => seatName(s));
    const yesCount = yesNames.length;
    const needed = nom.highscore ?? '?';

    const isGhostVoter = (name) =>
      fullTimeline.some(ev => ev.type === 'ghostvote' && ev.name === name && Math.abs(ev.ts - nom.ts) < 120000);

    const executed = typeof needed === 'number' && yesCount >= needed;
    const li = document.createElement('li');
    li.className = `nom-entry${executed ? ' nom-executed' : ''}`;
    li.innerHTML = `
      <div class="nom-header">
        <span class="nom-nominator role-name ${playerTeamByName(nominator)}" data-player="${esc(nominator)}">${esc(dn(nominator))}</span>
        <span class="nom-arrow">→</span>
        <span class="nom-nominee role-name ${playerTeamByName(nominee)}" data-player="${esc(nominee)}">${esc(dn(nominee))}</span>
        <span class="nom-meta">
          <span class="nom-count ${executed ? 'nom-execute' : ''}">${yesCount}/${needed}</span>
          <span class="nom-time">${fmt(nom.ts)}</span>
        </span>
      </div>
      <div class="nom-voters${yesNames.length === 0 ? ' nom-none' : ''}">
        <span class="nom-voters-label">${yesNames.length > 0 ? 'Voted' : 'No votes'}</span>
        ${yesNames.length > 0 ? yesNames.map(n => `${isGhostVoter(n) ? '👻 ' : ''}<span class="role-name ${playerTeamByName(n)}" data-player="${esc(n)}">${esc(dn(n))}</span>`).join('<span class="nom-voter-sep">,</span> ') : ''}
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
  if (colorSource === 'notes') {
    const meta = playerMeta[name] ?? {};
    return meta.alignment === 'evil' ? 'demon'
         : meta.alignment === 'good' ? 'townsfolk'
         : meta.roleTeam ?? '';
  }
  const p = currentState?.players?.find(p => p.name === name);
  return p?.team ?? '';
}

function isStoryteller(userId) {
  if (userId === 'me') return false;
  return !!(currentState?.storytellers?.find(s => String(s.id) === String(userId)));
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
  if (isObserver(userId)) return `<span class="observer-name"><span class="observer-eye">👁</span>${esc(dn(name))}</span>`;
  const team = playerTeamByName(name);
  return `<span class="role-name ${team}" data-player="${esc(name)}">${esc(dn(name))}</span>`;
}

function renderChats() {
  const list = document.getElementById('chats-log');
  const savedTop = list.scrollTop;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const collapsedPhases = new Set([...list.querySelectorAll('.nom-day-sep.collapsed')].map(el => el.textContent));
  list.innerHTML = '';

  let lastPhase = null;
  const sessions = showNightChats ? allChatSessions : allChatSessions.filter(s => s.type !== 'night');
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
        <span class="chat-type">${typeLabel}</span>
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
  const list = document.getElementById('messages-log');
  const savedTop = list.scrollTop;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const collapsedPhases = new Set([...list.querySelectorAll('.nom-day-sep.collapsed')].map(el => el.textContent));
  list.innerHTML = '';
  let lastPhase = null;
  for (const msg of allTextMessages) {
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
        <span class="msg-badge ${isPrivate ? 'msg-badge-private' : 'msg-badge-public'}">${isPrivate ? '🔒' : '📢'}</span>
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
  const players = currentState?.players ?? [];
  const myId = currentState?.myUserId;

  // Deaths, revives, ghost votes from timeline
  for (const ev of fullTimeline) {
    if (ev.type === 'death' && ev.name === name) events.push({ ts: ev.ts, type: 'death', label: 'Died' });
    else if (ev.type === 'revive' && ev.name === name) events.push({ ts: ev.ts, type: 'revive', label: 'Revived' });
    else if (ev.type === 'ghostvote' && ev.name === name) {
      const nom = nominationAt(ev.ts);
      const target = nom ? ` on ${esc(seatName(nom.nomineeSeat))}` : '';
      events.push({ ts: ev.ts, type: 'ghostvote', label: `Used ghost vote${target}` });
    }
  }

  // Nominations
  const playerSeat = players.find(p => p.name === name)?.seat ?? -1;
  for (const nom of allNominations) {
    const nominator = seatName(nom.nominatorSeat);
    const nominee = seatName(nom.nomineeSeat);
    const yesSeats = new Set(nom.yesSeats);
    const trackedSeats = new Set(Object.keys(nom.handState ?? {}).map(Number));
    const needed = nom.highscore ?? '?';
    const count = `${nom.yesSeats.length}/${needed}`;
    const raisedHand = yesSeats.has(playerSeat);
    const wasTracked = trackedSeats.has(playerSeat);
    const usedGhostVote = raisedHand && fullTimeline.some(ev => ev.type === 'ghostvote' && ev.name === name && Math.abs(ev.ts - nom.ts) < 120000);
    const ghostSuffix = usedGhostVote ? ' 👻' : '';

    const isNominator = nominator === name;
    const isNominee = nominee === name;

    if (isNominator) {
      events.push({ ts: nom.ts, type: 'nom-made', label: `Nominated ${esc(dn(nominee))} (${count})` });
      if (wasTracked) {
        events.push({ ts: nom.ts, type: raisedHand ? 'voted-yes' : 'voted-no', label: raisedHand ? `Voted yes as nominator${ghostSuffix}` : 'Did not vote as nominator' });
      }
    } else if (isNominee) {
      events.push({ ts: nom.ts, type: 'nom-received', label: `Nominated by ${esc(dn(nominator))} (${count})` });
      const nomineeVoted = wasTracked ? raisedHand : null;
      if (nomineeVoted === true) {
        events.push({ ts: nom.ts, type: 'voted-yes', label: `Voted for own execution${ghostSuffix}` });
      } else {
        events.push({ ts: nom.ts, type: 'voted-no', label: 'Did not vote for own execution' });
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
    const badge = isPrivate ? '🔒' : '📢';
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
    'death': '💀', 'revive': '🌱', 'ghostvote': '👻',
    'nom-made': '⚖', 'nom-received': '⚖',
    'voted-yes': '✋', 'voted-no': '✋',
    'chat-public': '🗣', 'chat-private': '🔒', 'chat-night': '🌙',
    'msg-sent': '✉', 'msg-received': '✉',
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
  overlay.addEventListener('transitionend', () => overlay.classList.remove('open'), { once: true });
}
document.getElementById('ptl-close').addEventListener('click', closePlayerTimeline);
document.getElementById('player-timeline-overlay').addEventListener('click', closePlayerTimeline);

// ── Notes grid ───────────────────────────────────────────────────────────

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
      const g = { key: `r${num}`, label: `D/N ${num}`, phases: [], cls: 'notes-merged', addPhase: null };
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

function chipHtml(chip, player, phase, idx) {
    const attrs = `data-player="${esc(player)}" data-phase="${esc(phase)}" data-idx="${idx}"`;
    if (chip.type === 'role') {
      const icon = chip.iconUrl ? `<img class="tp-role-icon" src="${esc(chip.iconUrl)}" />` : '';
      return `<span class="token-chip role-chip role-name ${chip.team ?? ''}" ${attrs}>${icon}${esc(chip.name)}</span>`;
    }
    if (chip.type === 'tag') {
      const content = chip.icon ? `${chip.icon} ${esc(chip.name ?? chip.label ?? '')}` : esc(chip.label ?? '');
      return `<span class="token-chip tag-chip" ${attrs}>${content}</span>`;
    }
    if (chip.type === 'note') {
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
      return `<span class="token-chip cellcolor-chip cc-${esc(chip.id)}${inherited}" ${attrs}>${esc(chip.label ?? '')}${sourceHtml}</span>`;
    }
    if (chip.type === 'ability') {
      const resolvedUrl = _iconUrl({ id: chip.roleId, iconUrl: chip.iconUrl });
      const icon = resolvedUrl ? `<img class="tp-role-icon" src="${resolvedUrl}" />` : '';
      const badges = abilityValBadges(chip);
      return `<span class="token-chip ability-chip role-name ${chip.roleTeam ?? ''}" title="${esc(chip.roleName)}" ${attrs}>${icon}${badges}</span>`;
    }
    if (chip.type === 'confirmed') {
      const resolvedUrl = _iconUrl({ id: chip.sourceRoleId, iconUrl: chip.iconUrl });
      const icon = resolvedUrl ? `<img class="tp-role-icon" src="${resolvedUrl}" />` : '';
      return `<span class="token-chip confirmed-chip" title="${esc(chip.label ?? '')}" ${attrs}>${icon}✓</span>`;
    }
    return '';
}

function chipsHtml(player, phase) {
  const chips = cellTokens[`${player}|${phase}`] ?? [];
  return chips.map((chip, idx) => chipHtml(chip, player, phase, idx)).join('');
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
// status chip into the right cell — exactly like clicking the 💀/🌱 button.
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
  if (keysChanged) chrome.runtime.sendMessage({ type: 'SAVE_MATERIALIZED_STATUS', keys: [...materializedStatus] });
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
}

function refreshCellChips(player, phase) {
  const col = columnForPhase(phase);
  if (!col) return;
  const cell = document.querySelector(`#notes-table td.notes-cell[data-player="${CSS.escape(player)}"][data-col="${CSS.escape(col.key)}"]`);
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
  chrome.runtime.sendMessage({ type: 'SAVE_TOKENS', player, phase, tokens: cellTokens[`${player}|${phase}`] ?? [] });
}

// Single global popover
let _popover = null;
let _popoverTarget = null; // { player, phase, chipIdx } — chipIdx null = add mode

function getPopover() {
  if (_popover) return _popover;
  _popover = document.createElement('div');
  _popover.id = 'token-popover';
  _popover.innerHTML = `
    <div class="tp-main-row">
      <input type="text" class="tp-note-input" placeholder="note" />
      <div class="tp-status-tags">
        <button class="tp-tag-btn" data-tag-id="dead"      data-tag-icon="💀" data-tag-name="Died"               title="Dead">💀</button>
        <button class="tp-tag-btn" data-tag-id="executed"  data-tag-icon="🪓" data-tag-name="Executed"           title="Executed">🪓</button>
        <button class="tp-tag-btn" data-tag-id="revived"   data-tag-icon="🌱" data-tag-name="Revived"            title="Revived">🌱</button>
        <button class="tp-tag-btn" data-tag-id="survived"  data-tag-icon="🛡️" data-tag-name="Survived"          title="Survived execution">🛡️</button>
      </div>
      <div class="tp-color-tags">
        <button class="tp-color-btn cc-good"      data-color-id="good"      title="Good ping (blue)">👍</button>
        <button class="tp-color-btn cc-evil"      data-color-id="evil"      title="Evil ping (red)">👎</button>
        <button class="tp-color-btn cc-droisoned" data-color-id="droisoned" title="Drunk or poisoned (sick green)">🍺</button>
      </div>
      <button class="tp-x-btn" type="button" title="Remove / cancel">🗑</button>
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
  });

  // ── Note input ──────────────────────────────────────────────────────────────

  noteInput.addEventListener('input', () => {
    const val = noteInput.value.trim();
    const { player, phase, chipIdx } = _popoverTarget ?? {};
    const cur = (chipIdx !== null && chipIdx !== undefined) ? (cellTokens[`${player}|${phase}`] ?? [])[chipIdx] : null;
    if (cur?.type === 'cellcolor') {
      editCellColor(cur, { label: val }); // editing a colored cell's label, not a note
    } else if (val) {
      commit({ type: 'note', text: val });
    }
    const q = val.toLowerCase();
    abilityTabs.querySelectorAll('.tp-ab-tab').forEach(btn => {
      btn.style.display = (!q || btn.title.toLowerCase().includes(q)) ? '' : 'none';
    });
  });

  // Enter confirms (the note is already saved live) and closes; Esc is handled
  // by the global handler below.
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closePopover(); }
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
    const key = `${player}|${phase}`;
    const chips = cellTokens[key] ?? [];
    chips.splice(chipIdx, 1);
    cellTokens[key] = chips;
    saveTokens(player, phase);
    refreshCellChips(player, phase);

    // Keep editing: jump to the neighbouring chip — the one to the left, or the
    // next one to the right if the deleted chip was the leftmost.
    let nextIdx = null;
    if (chipIdx >= 1) nextIdx = chipIdx - 1;     // left neighbour
    else if (chips.length > 0) nextIdx = 0;      // right neighbour (shifted into place)

    const col = nextIdx !== null ? columnForPhase(phase) : null;
    const cell = col && document.querySelector(`#notes-table td.notes-cell[data-player="${CSS.escape(player)}"][data-col="${CSS.escape(col.key)}"]`);
    if (cell) openPopover(player, phase, cell, nextIdx);
    else closePopover();
  });

  document.addEventListener('mousedown', (e) => {
    if (_popover.style.display !== 'none' && !_popover.contains(e.target)) {
      closePopover();
      document.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true });
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
  if (_popover) _popover.style.display = 'none';
  _popoverTarget = null;
}

function openPopover(player, phase, anchorEl, chipIdx = null) {
  const pop = getPopover();
  _popoverTarget = { player, phase, chipIdx };

  const chip = chipIdx !== null ? (cellTokens[`${player}|${phase}`] ?? [])[chipIdx] : null;
  const noteInput = pop.querySelector('.tp-note-input');

  // Pre-fill the input when editing a note chip or a colored-cell chip's label
  noteInput.value = chip?.type === 'note' ? chip.text
    : chip?.type === 'cellcolor' ? (chip.label ?? '')
    : '';

  // Source picker only applies to colored-cell chips
  if (chip?.type === 'cellcolor') pop._showCellColorSource(chip.id, chip.source, chip.fromNowOn);
  else pop._hideCellColorSource();

  // Ability tabs — pre-select: editing chip > player's assigned role > none
  const existingAbilityRoleId = chip?.type === 'ability' ? chip.roleId
    : chip?.type === 'confirmed' ? chip.sourceRoleId
    : (playerMeta[player]?.roleId ?? null);
  pop.querySelector('.tp-ability-tabs').querySelectorAll('.tp-ab-tab').forEach(btn => { btn.style.display = ''; });
  try {
    pop._buildAbilityTabs(existingAbilityRoleId, chip?.type === 'ability' ? chip.inputs : null);
  } catch (e) {
    console.error('ability tabs error:', e);
  }

  // Position
  pop.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  pop.style.top = spaceBelow > 80
    ? `${rect.bottom + window.scrollY + 2}px`
    : `${rect.top + window.scrollY - pop.offsetHeight - 2}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8))}px`;
  noteInput.focus();
}

function savePlayerMeta(name) {
  chrome.runtime.sendMessage({ type: 'SAVE_PLAYER_META', name, meta: playerMeta[name] ?? {} });
}

function metaNameColor(name) {
  const meta = playerMeta[name] ?? {};
  if (meta.alignment === 'evil') return 'var(--demon)';
  if (meta.alignment === 'good') return 'var(--townsfolk)';
  if (meta.roleTeam === 'demon' || meta.roleTeam === 'minion') return 'var(--demon)';
  if (meta.roleTeam === 'townsfolk') return 'var(--townsfolk)';
  if (meta.roleTeam === 'outsider') return 'var(--outsider)';
  if (meta.roleTeam === 'traveller') return 'var(--traveller)';
  return '';
}

function metaRowTint(name) {
  const meta = playerMeta[name] ?? {};
  const team = meta.alignment === 'evil' ? 'demon'
             : meta.alignment === 'good' ? 'townsfolk'
             : meta.roleTeam ?? '';
  if (team === 'demon' || team === 'minion') return 'rgba(220,50,50,0.06)';
  if (team === 'townsfolk') return 'rgba(99,179,237,0.06)';
  if (team === 'outsider') return 'rgba(129,140,248,0.06)';
  if (team === 'traveller') return 'rgba(192,132,252,0.06)';
  return '';
}

// ── Player meta popover ───────────────────────────────────────────────────

let _rolePop = null;
let _roleTarget = null;

function getRolePopover() {
  if (_rolePop) return _rolePop;
  _rolePop = document.createElement('div');
  _rolePop.id = 'meta-role-popover';
  _rolePop.innerHTML = `
    <input class="mrp-search" type="text" placeholder="Search…" />
    <div class="mrp-list"></div>
    <button class="mrp-clear">clear role</button>
  `;
  document.body.appendChild(_rolePop);

  const search = _rolePop.querySelector('.mrp-search');
  const list = _rolePop.querySelector('.mrp-list');
  const clearBtn = _rolePop.querySelector('.mrp-clear');

  const closePopover = () => {
    _rolePop.style.display = 'none';
    _roleTarget = null;
  };

  const selectRole = (roleId) => {
    if (!_roleTarget) return;
    const role = (currentState?.roles ?? []).find(r => r.id === roleId);
    if (!role) return;
    playerMeta[_roleTarget] = { ...(playerMeta[_roleTarget] ?? {}), roleId: role.id, roleName: role.name, roleTeam: role.team ?? '', roleIconUrl: _iconUrl(role) };
    savePlayerMeta(_roleTarget);
    refreshMetaCells(_roleTarget, { recolorPage: true });
    closePopover();
  };

  const renderList = (filter) => {
    const roles = (currentState?.roles ?? []).filter(r =>
      !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
    list.innerHTML = roles.map(r => {
      const icon = _iconUrl(r) ? `<img class="tp-role-icon" src="${esc(_iconUrl(r))}" />` : '';
      const active = playerMeta[_roleTarget]?.roleId === r.id ? ' active' : '';
      return `<div class="mrp-item role-name ${r.team ?? ''}${active}" data-id="${esc(r.id)}" tabindex="-1">${icon}${esc(r.name)}</div>`;
    }).join('');
    list.querySelectorAll('.mrp-item').forEach(item => {
      item.addEventListener('mousedown', (e) => { e.preventDefault(); selectRole(item.dataset.id); });
    });
  };

  _rolePop._renderList = renderList;

  search.addEventListener('input', () => renderList(search.value));

  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.querySelector('.mrp-item')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = list.querySelector('.mrp-item');
      if (first) selectRole(first.dataset.id);
    } else if (e.key === 'Escape') {
      closePopover();
    }
  });

  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.mrp-item')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[idx + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) items[idx - 1].focus(); else search.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (idx >= 0) selectRole(items[idx].dataset.id);
    } else if (e.key === 'Escape') {
      closePopover();
    }
  });

  clearBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!_roleTarget) return;
    playerMeta[_roleTarget] = { ...(playerMeta[_roleTarget] ?? {}), roleId: '', roleName: '', roleTeam: '', roleIconUrl: null };
    savePlayerMeta(_roleTarget);
    refreshMetaCells(_roleTarget, { recolorPage: true });
    closePopover();
  });

  document.addEventListener('mousedown', (e) => {
    if (_rolePop.style.display !== 'none' && !_rolePop.contains(e.target) && !e.target.closest('.notes-meta-role')) {
      closePopover();
    }
  });
  return _rolePop;
}

function openRolePopover(name, anchorEl) {
  const pop = getRolePopover();
  _roleTarget = name;
  const search = pop.querySelector('.mrp-search');
  const list = pop.querySelector('.mrp-list');
  search.value = '';
  pop._renderList('');
  pop.style.display = 'flex';

  const rect = anchorEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  pop.style.top = spaceBelow > 200
    ? `${rect.bottom + window.scrollY + 2}px`
    : `${rect.top + window.scrollY - pop.offsetHeight - 2}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8))}px`;

  list.querySelector('.mrp-item.active')?.scrollIntoView({ block: 'nearest' });
  search.focus();
}

function toggleAlignment(name) {
  const cycle = { '': 'good', 'good': 'evil', 'evil': '' };
  const cur = playerMeta[name]?.alignment ?? '';
  playerMeta[name] = { ...(playerMeta[name] ?? {}), alignment: cycle[cur] };
  savePlayerMeta(name);
  refreshMetaCells(name);
  if (colorSource === 'notes') refreshPageColors();
}

function refreshPageColors() {
  renderTimeline();
  renderNominations();
  renderChats();
  renderMessages();
}

function refreshMetaCells(name, { recolorPage = false } = {}) {
  if (recolorPage && colorSource === 'notes') refreshPageColors();
  const escaped = CSS.escape(name);
  const nameCell = document.querySelector(`#notes-table td.notes-player-name[data-player="${escaped}"]`);
  const roleCell = document.querySelector(`#notes-table td.notes-meta-role[data-player="${escaped}"]`);
  const alignCell = document.querySelector(`#notes-table td.notes-meta-align[data-player="${escaped}"]`);
  const row = nameCell?.closest('tr');
  if (!nameCell) return;
  const color = metaNameColor(name);
  const tint = metaRowTint(name);
  nameCell.style.color = color;
  nameCell.style.background = tint;
  if (row) row.style.background = tint;
  const meta = playerMeta[name] ?? {};
  if (roleCell) {
    const icon = meta.roleIconUrl ? `<img class="tp-role-icon" src="${meta.roleIconUrl}" />` : '';
    const roleColorClass = meta.alignment === 'evil' ? 'demon'
                         : meta.alignment === 'good' ? 'townsfolk'
                         : meta.roleTeam ?? '';
    roleCell.innerHTML = meta.roleName
      ? `<span class="meta-role-chip role-name ${roleColorClass}">${icon}${esc(meta.roleName)}</span>`
      : '';
  }
  if (alignCell) {
    const alignLabel = { good: 'G', evil: 'E' };
    const alignClass = { good: 'meta-good', evil: 'meta-evil' };
    const a = meta.alignment ?? '';
    alignCell.innerHTML = a ? `<span class="meta-align-badge ${alignClass[a]}">${alignLabel[a]}</span>` : '';
  }
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
  for (const p of currentState.players) {
    const player = p.name ?? `Seat ${p.seat + 1}`;
    let active = null; // { label, source } carried forward from the latest origin
    for (const phase of phases) {
      const key = `${player}|${phase}`;
      const chips = cellTokens[key] ?? [];
      const userDroison = chips.find(c => c.type === 'cellcolor' && c.id === 'droisoned' && !c.auto);
      const autoIdx = chips.findIndex(c => c.type === 'cellcolor' && c.id === 'droisoned' && c.auto);

      if (userDroison?.fromNowOn) active = { label: userDroison.label, source: userDroison.source };

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
  if (document.activeElement?.dataset?.player) return;

  const phases = getPhaseColumns();
  const cols = getNotesColumns();
  const players = currentState.players;

  const key = JSON.stringify([players.map(p => [p.name, p.team, p.isDead]), phases, mergePhases]);
  if (key === lastNotesKey) return;
  lastNotesKey = key;

  propagateDroison(); // stamp/refresh inherited "from now on" droison copies

  const table = document.getElementById('notes-table');

  const phaseColWidth = 110;
  const w = notesFixedColWidths;
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
    const name = player.name ?? `Seat ${player.seat + 1}`;
    const isTraveller = player.team === 'traveller';

    // Sync role from grimoire: always in grimoire mode, only when empty in notes mode
    if (player.roleId && (colorSource === 'grimoire' || !playerMeta[name]?.roleId)) {
      const roleObj = (currentState.roles ?? []).find(r => r.id === player.roleId);
      playerMeta[name] = {
        ...(playerMeta[name] ?? {}),
        roleId: player.roleId,
        roleName: player.roleName || roleObj?.name || player.roleId,
        roleTeam: player.team || roleObj?.team || '',
        roleIconUrl: _iconUrl(roleObj),
      };
    }

    const meta = playerMeta[name] ?? {};
    const color = metaNameColor(name);
    const tint = metaRowTint(name);
    const dead = player.isDead ? ' dead' : '';
    const usedGhostVote = player.isDead && fullTimeline.some(ev => ev.type === 'ghostvote' && ev.name === name);
    const statusIcons = (player.isDead ? '<span class="pn-status-icon pn-dead" title="Dead">💀</span>' : '')
                      + (usedGhostVote ? '<span class="pn-status-icon pn-voteless" title="Used ghost vote">👻</span>' : '');
    const icon = meta.roleIconUrl ? `<img class="tp-role-icon" src="${meta.roleIconUrl}" />` : '';
    const roleColorClass = meta.alignment === 'evil' ? 'demon'
                         : meta.alignment === 'good' ? 'townsfolk'
                         : meta.roleTeam ?? '';
    const roleHtml = meta.roleName
      ? `<span class="meta-role-chip role-name ${roleColorClass}">${icon}${esc(meta.roleName)}</span>`
      : '';
    const alignLabel = { good: 'G', evil: 'E' };
    const alignClass = { good: 'meta-good', evil: 'meta-evil' };
    const a = meta.alignment ?? '';
    const alignHtml = a ? `<span class="meta-align-badge ${alignClass[a]}">${alignLabel[a]}</span>` : '';
    const tintStyle = tint ? `background:${tint}` : '';
    html += `<tr style="${tintStyle}">`;
    const pinned = pinnedPlayers.has(name);
    html += `<td class="notes-player-name${dead}" data-player="${esc(name)}" style="${color ? `color:${color};` : ''}${tintStyle}"><button class="pin-hl-btn${pinned ? ' pinned' : ''}" data-pin="${esc(name)}" title="Pin highlight">☀</button><span class="notes-player-name-text">${esc(dn(name))}</span>${statusIcons}</td>`;
    const roleLocked = isTraveller ? ' role-locked' : '';
    html += `<td class="notes-meta-cell notes-meta-role${roleLocked}" data-player="${esc(name)}">${roleHtml}</td>`;
    html += `<td class="notes-meta-cell notes-meta-align" data-player="${esc(name)}">${alignHtml}</td>`;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const epoch = i % 2 === 0 ? ' epoch-start' : '';
      const chips = cellChipsHtml(name, col.phases);
      const ccId = cellColorId(name, col.phases);
      const ccClass = ccId ? ` cc-cell-${ccId}` : '';
      html += `<td class="notes-cell${epoch}${ccClass}" data-player="${esc(name)}" data-col="${esc(col.key)}" data-phase="${esc(col.addPhase)}">
        <div class="cell-chips">${chips}</div>
      </td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  table.innerHTML = html;

  if (!w) {
    requestAnimationFrame(() => {
      const ths = table.querySelectorAll('thead tr th');
      if (ths.length < 3) return;
      notesFixedColWidths = {
        player: ths[0].offsetWidth,
        role: Math.max(ths[1].offsetWidth, measureMaxRoleChipWidth()),
        align: ths[2].offsetWidth,
      };
      lastNotesKey = null;
      renderNotesGrid();
    });
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


  table.querySelectorAll('.notes-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      const chip = e.target.closest('.token-chip[data-idx]');
      if (chip) {
        // Edit the chip in its own phase (a merged cell may mix Night & Day chips).
        openPopover(cell.dataset.player, chip.dataset.phase, cell, Number(chip.dataset.idx));
      } else {
        openPopover(cell.dataset.player, cell.dataset.phase, cell, null);
      }
    });
  });

  applyHighlights(); applyPinnedHighlights();
}

// ── WS heartbeat ──────────────────────────────────────────────────────────

let lastWsTs = Date.now(); // start counting from page load so timer is always visible
let lastReconnectTry = 0;

function touchWsHeartbeat() {
  lastWsTs = Date.now();
}

function tryReconnect() {
  try {
    chrome.runtime.sendMessage({ type: 'RECONNECT' }, () => void chrome.runtime?.lastError);
  } catch { /* dummy mode / extension reloaded */ }
}

(function tickHeartbeat() {
  if (lastWsTs !== null) {
    const secs = Math.floor((Date.now() - lastWsTs) / 1000);
    const el = document.getElementById('ws-heartbeat');
    const timerEl = document.getElementById('ws-heartbeat-timer');
    const msgEl = document.getElementById('ws-heartbeat-msg');
    if (el && timerEl && msgEl) {
      timerEl.textContent = `${secs}s since last signal`;
        if (secs >= 30) {
          msgEl.textContent = '— reload the botc.app tab';
          const t = Math.min((secs - 30) / 60, 1);
          const g = Math.round(200 * (1 - t));
          el.style.color = `rgb(255,${g},0)`;
          // Try to recover automatically before the user has to reload
          if (Date.now() - lastReconnectTry > 30000) {
            lastReconnectTry = Date.now();
            tryReconnect();
          }
        } else {
          msgEl.textContent = '';
          el.style.color = '';
        }
    }
  }
  setTimeout(tickHeartbeat, 1000);
})();

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

document.getElementById('color-source-toggle').addEventListener('click', () => {
  colorSource = colorSource === 'grimoire' ? 'notes' : 'grimoire';
  const isNotes = colorSource === 'notes';
  document.getElementById('ct-switch').setAttribute('aria-checked', String(isNotes));
  document.getElementById('color-source-toggle').classList.toggle('ct-active', isNotes);
  saveSettings();
  renderState(currentState);
  renderTimeline();
  renderNominations();
  renderChats();
  renderMessages();
});

document.getElementById('toggle-night').addEventListener('click', (e) => {
  showNightChats = !showNightChats;
  e.target.textContent = showNightChats ? 'hide night' : 'show night';
  e.target.classList.toggle('toggle-btn-active', showNightChats);
  renderChats();
});

document.getElementById('merge-switch').addEventListener('click', (e) => {
  mergePhases = !mergePhases;
  e.currentTarget.classList.toggle('on', mergePhases);
  e.currentTarget.setAttribute('aria-checked', String(mergePhases));
  saveSettings();
  lastNotesKey = null;
  renderNotesGrid();
});

// ── Persisted UI settings (survive reloads) ─────────────────────────────────
const SETTINGS_KEY = 'botc-companion-settings';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.colorSource === 'grimoire' || s.colorSource === 'notes') colorSource = s.colorSource;
    if (typeof s.mergePhases === 'boolean') mergePhases = s.mergePhases;
  } catch { /* localStorage unavailable / corrupt — use defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ colorSource, mergePhases }));
  } catch { /* ignore */ }
}

function applySettingsToUI() {
  const isNotes = colorSource === 'notes';
  document.getElementById('ct-switch').setAttribute('aria-checked', String(isNotes));
  document.getElementById('color-source-toggle').classList.toggle('ct-active', isNotes);
  const ms = document.getElementById('merge-switch');
  ms.classList.toggle('on', mergePhases);
  ms.setAttribute('aria-checked', String(mergePhases));
}

loadSettings();
applySettingsToUI();

// Settings popup (gear): toggle on click, close on outside click
(() => {
  const btn = document.getElementById('settings-btn');
  const popup = document.getElementById('settings-popup');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = popup.classList.toggle('open');
    btn.classList.toggle('open', open);
  });
  document.addEventListener('click', (e) => {
    if (!popup.classList.contains('open')) return;
    if (popup.contains(e.target) || e.target === btn) return;
    popup.classList.remove('open');
    btn.classList.remove('open');
  });
})();

// Esc closes whatever popover/menu is open
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const chip = document.getElementById('token-popover');
  if (chip && chip.style.display !== 'none') closePopover();
  const role = document.getElementById('meta-role-popover');
  if (role && role.style.display !== 'none') role.style.display = 'none';
  const settings = document.getElementById('settings-popup');
  if (settings?.classList.contains('open')) {
    settings.classList.remove('open');
    document.getElementById('settings-btn').classList.remove('open');
  }
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

document.getElementById('clear-notes').addEventListener('click', () => {
  if (!confirm('Clear all notes?')) return;
  cellTokens = {};
  playerMeta = {};
  // Keep materializedStatus: cleared death/revive chips stay cleared instead of
  // being recreated from the timeline; only brand-new deaths will reappear.
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'CLEAR_TOKENS' });
  }
  lastNotesKey = null;
  renderNotesGrid();
});

window.__botc = { get state() { return currentState; }, get timeline() { return fullTimeline; }, get roles() { return revealedRoles; } };


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
  if (e.target.closest('#notes-table') && !e.target.closest('.notes-player-name-text')) return;
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

// Shown when the bridge was injected into an already-open tab: game state
// flows, but the WebSocket hook missed the existing connection.
function showPartialBanner() {
  if (document.getElementById('partial-banner')) return;
  const el = document.createElement('div');
  el.id = 'partial-banner';
  el.innerHTML = 'Connected to an already-open botc.app tab — game state works, but live events (nominations, chats, messages) need a <strong>botc.app tab reload</strong>. <button id="partial-dismiss" type="button">dismiss</button>';
  document.body.insertBefore(el, document.querySelector('main'));
  el.querySelector('#partial-dismiss').addEventListener('click', () => el.remove());
}

chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (!response) { showReloadPrompt(); return; }
  applyFullRefresh(response);
  const wsEvents = response.wsEvents ?? [];
  wsEvents.forEach(appendWsEvent);
  if (wsEvents.length) touchWsHeartbeat();
});

function applyFullRefresh(response) {
  if (!response) return;
  fullTimeline = [];
  lastNotesKey = '';
  nameMap = response.nameMap ?? {};
  document.getElementById('timeline-log').innerHTML = '';
  cellTokens = response.cellTokens ?? {};
  materializedStatus = new Set(response.materializedStatus ?? []);
  playerMeta = response.playerMeta ?? {};
  renderState(response.state);
  if (response.timeline?.length) addTimelineEvents(response.timeline);
  allNominations = response.nominations ?? [];
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
      renderState(payload.data); patchTimelineNames(); materializeStatusChips(); renderTimeline(); renderNotesGrid(); refreshPlayerTimeline();
      if (nameMapGrew) { renderNominations(); renderChats(); renderMessages(); refreshPlayerTimeline(); }
    }
    else if (payload.type === 'WS_RECV' || payload.type === 'WS_SEND') { touchWsHeartbeat(); appendWsEvent(payload); }
    else if (payload.type === 'NEEDS_RELOAD') { showReloadPrompt(); }
    return;
  }
  if (message.type === 'NEEDS_RELOAD') {
    showReloadPrompt();
    return;
  }
  if (message.type === 'PARTIAL_CONNECT') {
    showPartialBanner();
    return;
  }
  if (message.type === 'TIMELINE_EVENTS') {
    addTimelineEvents(message.events ?? []);
    renderNotesGrid();
    refreshPlayerTimeline();
  }
  if (message.type === 'NOMINATIONS_UPDATE') {
    allNominations = message.nominations ?? [];
    renderNominations();
    refreshPlayerTimeline();
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

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
let colorSource = 'grimoire'; // 'grimoire' | 'notes'
let openPlayerTimelineName = null;
let lastPlayersJson = '';
let cellTokens = {};
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

const phaseLabel = (phase) => phase % 2 === 1 ? `Night ${Math.ceil(phase / 2)}` : `Day ${Math.ceil(phase / 2)}`;
const dn = (name) => name?.length > 20 ? name.slice(0, 20) + '…' : (name ?? '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');


// ── Render ────────────────────────────────────────────────────────────────

function playerName(playerId) {
  const p = currentState?.players?.find(p => p.id === String(playerId));
  return p?.name ?? playerId;
}

function roleNameFromId(roleId, state) {
  const role = state?.roles?.find(r => r.id === roleId);
  return role?.name ?? roleId;
}

function renderState(state) {
  if (!state) return;
  currentState = state;
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
      ? stNames.map(n => `<span class="chat-st header-st" data-player="${n}">${dn(n)}</span>`).join('<span class="header-st-sep">, </span>')
      : '';
  }

  const alive = state.players.filter(p => !p.isDead).length;
  document.getElementById('stat-players').textContent = `${state.players.length} players`;
  document.getElementById('stat-alive').textContent = `${alive} alive`;
  document.getElementById('stat-edition').textContent = state.edition?.edition?.name ?? '';

  const playersJson = JSON.stringify(state.players.map(p => [p.id, p.name, p.roleId, p.team, p.isDead, p.status, p.pronouns, revealedRoles[p.id]]));
  const tbody = document.getElementById('player-tbody');
  if (playersJson === lastPlayersJson) return;
  lastPlayersJson = playersJson;
  tbody.innerHTML = '';

  state.players.forEach((player) => {
    const isDead = player.isDead || player.status?.includes('dead');
    const tr = document.createElement('tr');
    if (isDead) tr.classList.add('dead');
    if (player.name) tr.dataset.player = player.name;

    const revealedRole = revealedRoles[player.id];
    const roleId = player.roleId || revealedRole || '';
    const roleName = player.roleName || (revealedRole ? roleNameFromId(revealedRole, currentState) : '') || roleId || '?';
    const team = player.team || '';

    tr.innerHTML = `
      <td class="seat">${player.seat + 1}</td>
      <td><div class="player-name" data-player="${player.name ?? player.id}">${dn(player.name ?? player.id)}</div><div class="player-pronouns">${dn(player.pronouns ?? '')}</div></td>
      <td class="role-name ${team}">${roleName}</td>
      <td class="no-strike">
        <div class="status-tags">
          ${(player.status ?? []).map(s => `<span class="tag">${s}</span>`).join('')}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
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
        const icon = d.type === 'ghostvote' ? '👻' : d.type === 'revive' ? '✨' : isExile ? '🚪' : '💀';
        const ghostTarget = d.type === 'ghostvote' ? (() => { const n = nominationAt(d.ts); return n ? ` on ${seatName(n.nomineeSeat)}` : ''; })() : '';
        const action = d.type === 'ghostvote' ? `ghost vote${ghostTarget}` : d.type === 'revive' ? 'revived' : isExile ? 'exiled' : 'died';
        const cls = d.type === 'revive' ? 'revive' : d.type === 'ghostvote' ? 'ghostvote' : '';
        const offsetStr = d.refStart ? '' : ` <span class="tl-death-time">+${duration(d.ts - block.start)}</span>`;
        return `<div class="tl-death ${cls}">${icon} <span class="${team ? `role-name ${team}` : ''}" data-player="${name}">${dn(name)}</span> ${action}${offsetStr}</div>`;
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
        <span class="nom-nominator role-name ${playerTeamByName(nominator)}" data-player="${nominator}">${dn(nominator)}</span>
        <span class="nom-arrow">→</span>
        <span class="nom-nominee role-name ${playerTeamByName(nominee)}" data-player="${nominee}">${dn(nominee)}</span>
        <span class="nom-meta">
          <span class="nom-count ${executed ? 'nom-execute' : ''}">${yesCount}/${needed}</span>
          <span class="nom-time">${fmt(nom.ts)}</span>
        </span>
      </div>
      <div class="nom-voters${yesNames.length === 0 ? ' nom-none' : ''}">
        <span class="nom-voters-label">${yesNames.length > 0 ? 'Voted' : 'No votes'}</span>
        ${yesNames.length > 0 ? yesNames.map(n => `${isGhostVoter(n) ? '👻 ' : ''}<span class="role-name ${playerTeamByName(n)}" data-player="${n}">${dn(n)}</span>`).join('<span class="nom-voter-sep">,</span> ') : ''}
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
  if (isStoryteller(userId)) return `<span class="chat-st" data-player="${name}">${dn(name)}</span>`;
  if (isObserver(userId)) return `<span class="observer-name"><span class="observer-eye">👁</span>${dn(name)}</span>`;
  const team = playerTeamByName(name);
  return `<span class="role-name ${team}" data-player="${name}">${dn(name)}</span>`;
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
      const target = nom ? ` on ${seatName(nom.nomineeSeat)}` : '';
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
      events.push({ ts: nom.ts, type: 'nom-made', label: `Nominated ${dn(nominee)} (${count})` });
      if (wasTracked) {
        events.push({ ts: nom.ts, type: raisedHand ? 'voted-yes' : 'voted-no', label: raisedHand ? `Voted yes as nominator${ghostSuffix}` : 'Did not vote as nominator' });
      }
    } else if (isNominee) {
      events.push({ ts: nom.ts, type: 'nom-received', label: `Nominated by ${dn(nominator)} (${count})` });
      const nomineeVoted = wasTracked ? raisedHand : null;
      if (nomineeVoted === true) {
        events.push({ ts: nom.ts, type: 'voted-yes', label: `Voted for own execution${ghostSuffix}` });
      } else {
        events.push({ ts: nom.ts, type: 'voted-no', label: 'Did not vote for own execution' });
      }
    } else if (wasTracked) {
      events.push({ ts: nom.ts, type: raisedHand ? 'voted-yes' : 'voted-no', label: `${raisedHand ? `Voted yes${ghostSuffix}` : 'Did not vote'} on ${dn(nominator)} → ${dn(nominee)} (${count})` });
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
    'death': '💀', 'revive': '✨', 'ghostvote': '👻',
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

function chipsHtml(player, phase) {
  const chips = cellTokens[`${player}|${phase}`] ?? [];
  return chips.map((chip, idx) => {
    const attrs = `data-player="${player}" data-phase="${phase}" data-idx="${idx}"`;
    const impCls = `imp-${chip.importance ?? 1}`;
    if (chip.type === 'role') {
      const icon = chip.iconUrl ? `<img class="tp-role-icon" src="${chip.iconUrl}" />` : '';
      return `<span class="token-chip role-chip role-name ${chip.team ?? ''} ${impCls}" ${attrs}>${icon}${chip.name}</span>`;
    }
    if (chip.type === 'tag') {
      return `<span class="token-chip tag-chip ${impCls}" ${attrs}>${chip.label}</span>`;
    }
    if (chip.type === 'note') {
      return `<span class="token-chip note-chip ${impCls}" ${attrs}>${chip.text}</span>`;
    }
    return '';
  }).join('');
}

function refreshCellChips(player, phase) {
  const cell = document.querySelector(`#notes-table td.notes-cell[data-player="${CSS.escape(player)}"][data-phase="${CSS.escape(phase)}"]`);
  if (cell) cell.querySelector('.cell-chips').innerHTML = chipsHtml(player, phase);
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
    <input type="text" class="tp-note-input" placeholder="note" />
    <select class="tp-tags-select">
      <option value="">tag</option>
      ${PREDEFINED_TAGS.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
    </select>
    <div class="tp-role-dd">
      <button class="tp-role-trigger" type="button">role</button>
      <div class="tp-role-list" style="display:none"></div>
    </div>
    <div class="tp-importance">
      <button class="tp-imp-btn" data-imp="3" title="high">•••</button>
      <button class="tp-imp-btn" data-imp="2" title="medium">••</button>
      <button class="tp-imp-btn active" data-imp="1" title="low">•</button>
    </div>
    <button class="tp-x-btn" type="button" title="Remove / cancel">✕</button>
  `;
  document.body.appendChild(_popover);

  const noteInput = _popover.querySelector('.tp-note-input');
  const tagsSelect = _popover.querySelector('.tp-tags-select');
  const roleTrigger = _popover.querySelector('.tp-role-trigger');
  const roleList = _popover.querySelector('.tp-role-list');
  const xBtn = _popover.querySelector('.tp-x-btn');
  const impBtns = [..._popover.querySelectorAll('.tp-imp-btn')];

  let _selectedRoleId = null;

  function buildRoleList() {
    const roles = currentState?.roles ?? [];
    roleList.innerHTML = roles.map(r => {
      const icon = r.iconUrl ? `<img class="tp-role-icon" src="${r.iconUrl}" />` : '';
      return `<div class="tp-role-item role-name ${r.team ?? ''}" data-id="${r.id}">${icon}${r.name}</div>`;
    }).join('');
    roleList.querySelectorAll('.tp-role-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const id = item.dataset.id;
        const role = (currentState?.roles ?? []).find(r => r.id === id);
        if (role) {
          _selectedRoleId = role.id;
          const icon = role.iconUrl ? `<img class="tp-role-icon" src="${role.iconUrl}" />` : '';
          roleTrigger.innerHTML = `${icon}${role.name}`;
          commit({ type: 'role', id: role.id, name: role.name, team: role.team ?? '', iconUrl: role.iconUrl ?? null });
        }
        roleList.style.display = 'none';
      });
    });
  }

  roleTrigger.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (roleList.style.display === 'none') {
      buildRoleList();
      roleList.style.display = 'block';
    } else {
      roleList.style.display = 'none';
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!_popover.querySelector('.tp-role-dd').contains(e.target)) {
      roleList.style.display = 'none';
    }
  }, true);

  impBtns.forEach(btn => btn.addEventListener('click', () => {
    impBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // In edit mode: immediately update the chip's importance
    if (_popoverTarget?.chipIdx !== null && _popoverTarget?.chipIdx !== undefined) {
      const { player, phase, chipIdx } = _popoverTarget;
      const chips = cellTokens[`${player}|${phase}`] ?? [];
      if (chips[chipIdx]) {
        chips[chipIdx] = { ...chips[chipIdx], importance: Number(btn.dataset.imp) };
        saveTokens(player, phase);
        refreshCellChips(player, phase);
      }
    }
  }));

  const getImportance = () => Number(_popover.querySelector('.tp-imp-btn.active')?.dataset.imp ?? 1);

  const commit = (chip) => {
    if (!_popoverTarget) return;
    const { player, phase, chipIdx } = _popoverTarget;
    setChip(player, phase, { ...chip, importance: getImportance() }, chipIdx);
    // Update chipIdx to the actual index (in case it was a new chip appended)
    const newIdx = chipIdx !== null ? chipIdx : (cellTokens[`${player}|${phase}`]?.length ?? 1) - 1;
    _popoverTarget = { player, phase, chipIdx: newIdx };
  };

  noteInput.addEventListener('input', () => {
    const val = noteInput.value.trim();
    if (val) commit({ type: 'note', text: val });
  });

  tagsSelect.addEventListener('change', () => {
    const id = tagsSelect.value;
    if (!id) return;
    const tag = PREDEFINED_TAGS.find(t => t.id === id);
    if (tag) commit({ type: 'tag', id: tag.id, label: tag.label });
  });


  xBtn.addEventListener('click', () => {
    if (!_popoverTarget) return;
    const { player, phase, chipIdx } = _popoverTarget;
    if (chipIdx !== null) {
      const chips = cellTokens[`${player}|${phase}`] ?? [];
      chips.splice(chipIdx, 1);
      cellTokens[`${player}|${phase}`] = chips;
      saveTokens(player, phase);
      refreshCellChips(player, phase);
    }
    closePopover();
  });

  document.addEventListener('mousedown', (e) => {
    if (_popover.style.display !== 'none' && !_popover.contains(e.target) && !e.target.closest('.notes-cell')) {
      closePopover();
    }
  });
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
  const tagsSelect = pop.querySelector('.tp-tags-select');


  // Pre-fill based on chip type
  noteInput.value = chip?.type === 'note' ? chip.text : '';
  tagsSelect.value = chip?.type === 'tag' ? chip.id : '';
  // Importance
  const imp = chip?.importance ?? 1;
  pop.querySelectorAll('.tp-imp-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.imp) === imp));
  // Role trigger label
  const roleTrigger = pop.querySelector('.tp-role-trigger');
  const roleList = pop.querySelector('.tp-role-list');
  roleList.style.display = 'none';
  if (chip?.type === 'role') {
    const icon = chip.iconUrl ? `<img class="tp-role-icon" src="${chip.iconUrl}" />` : '';
    roleTrigger.innerHTML = `${icon}${chip.name}`;
  } else {
    roleTrigger.textContent = 'role';
  }

  // Position
  pop.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  pop.style.top = spaceBelow > 80
    ? `${rect.bottom + window.scrollY + 2}px`
    : `${rect.top + window.scrollY - pop.offsetHeight - 2}px`;
  pop.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8)}px`;
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

  const renderList = (filter) => {
    const roles = (currentState?.roles ?? []).filter(r =>
      !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
    list.innerHTML = roles.map(r => {
      const icon = r.iconUrl ? `<img class="tp-role-icon" src="${r.iconUrl}" />` : '';
      const active = playerMeta[_roleTarget]?.roleId === r.id ? ' active' : '';
      return `<div class="mrp-item role-name ${r.team ?? ''}${active}" data-id="${r.id}">${icon}${r.name}</div>`;
    }).join('');
    list.querySelectorAll('.mrp-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!_roleTarget) return;
        const role = (currentState?.roles ?? []).find(r => r.id === item.dataset.id);
        if (!role) return;
        const meta = playerMeta[_roleTarget] ?? {};
        playerMeta[_roleTarget] = { ...meta, roleId: role.id, roleName: role.name, roleTeam: role.team ?? '', roleIconUrl: role.iconUrl ?? null };
        savePlayerMeta(_roleTarget);
        refreshMetaCells(_roleTarget, { recolorPage: true });
        _rolePop.style.display = 'none';
        _roleTarget = null;
      });
    });
  };

  search.addEventListener('input', () => renderList(search.value));

  clearBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!_roleTarget) return;
    playerMeta[_roleTarget] = { ...(playerMeta[_roleTarget] ?? {}), roleId: '', roleName: '', roleTeam: '', roleIconUrl: null };
    savePlayerMeta(_roleTarget);
    refreshMetaCells(_roleTarget, { recolorPage: true });
    _rolePop.style.display = 'none';
    _roleTarget = null;
  });

  document.addEventListener('mousedown', (e) => {
    if (_rolePop.style.display !== 'none' && !_rolePop.contains(e.target) && !e.target.closest('.notes-meta-role')) {
      _rolePop.style.display = 'none';
      _roleTarget = null;
    }
  });
  return _rolePop;
}

function openRolePopover(name, anchorEl) {
  const pop = getRolePopover();
  _roleTarget = name;
  const search = pop.querySelector('.mrp-search');
  search.value = '';
  pop.querySelector('.mrp-list').innerHTML = '';
  pop.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  pop.style.top = spaceBelow > 200
    ? `${rect.bottom + window.scrollY + 2}px`
    : `${rect.top + window.scrollY - pop.offsetHeight - 2}px`;
  pop.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8)}px`;
  // Render after positioning so offsetHeight is valid
  const roles = currentState?.roles ?? [];
  pop.querySelector('.mrp-list').innerHTML = roles.map(r => {
    const icon = r.iconUrl ? `<img class="tp-role-icon" src="${r.iconUrl}" />` : '';
    const active = playerMeta[name]?.roleId === r.id ? ' active' : '';
    return `<div class="mrp-item role-name ${r.team ?? ''}${active}" data-id="${r.id}">${icon}${r.name}</div>`;
  }).join('');
  pop.querySelectorAll('.mrp-item').forEach(item => {
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const role = (currentState?.roles ?? []).find(r => r.id === item.dataset.id);
      if (!role || !_roleTarget) return;
      const meta = playerMeta[_roleTarget] ?? {};
      playerMeta[_roleTarget] = { ...meta, roleId: role.id, roleName: role.name, roleTeam: role.team ?? '', roleIconUrl: role.iconUrl ?? null };
      savePlayerMeta(_roleTarget);
      refreshMetaCells(_roleTarget, { recolorPage: true });
      _rolePop.style.display = 'none';
      _roleTarget = null;
    });
  });
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
      ? `<span class="meta-role-chip role-name ${roleColorClass}">${icon}${meta.roleName}</span>`
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
    if (role.iconUrl) {
      const img = document.createElement('img');
      img.className = 'tp-role-icon';
      img.style.cssText = 'width:14px;height:14px;';
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

function renderNotesGrid() {
  if (!currentState?.players?.length) return;

  // Skip rebuild if popover note textarea is focused
  if (document.activeElement?.classList.contains('tp-note-input')) return;
  if (document.activeElement?.dataset?.player) return;

  const phases = getPhaseColumns();
  const players = currentState.players;

  const key = JSON.stringify([players.map(p => [p.name, p.team, p.isDead]), phases]);
  if (key === lastNotesKey) return;
  lastNotesKey = key;

  const table = document.getElementById('notes-table');

  const phaseColWidth = 110;
  const w = notesFixedColWidths;
  const minPhaseWidth = 90;

  let html = '';
  if (w) {
    const fixedTotal = w.player + w.role + w.align;
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
    table.style.minWidth = (fixedTotal + phases.length * minPhaseWidth) + 'px';
    html += '<colgroup>';
    html += `<col style="width:${w.player}px">`;
    html += `<col style="width:${w.role}px">`;
    html += `<col style="width:${w.align}px">`;
    for (let i = 0; i < phases.length; i++) html += '<col>';
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
  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i];
    const cls = ph.startsWith('Night') ? 'notes-night' : 'notes-day';
    const epoch = i % 2 === 0 ? ' epoch-start' : '';
    html += `<th class="notes-phase-col ${cls}${epoch}">${ph}</th>`;
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
        roleIconUrl: roleObj?.iconUrl ?? null,
      };
    }

    const meta = playerMeta[name] ?? {};
    const color = metaNameColor(name);
    const tint = metaRowTint(name);
    const dead = player.isDead ? ' dead' : '';
    const icon = meta.roleIconUrl ? `<img class="tp-role-icon" src="${meta.roleIconUrl}" />` : '';
    const roleColorClass = meta.alignment === 'evil' ? 'demon'
                         : meta.alignment === 'good' ? 'townsfolk'
                         : meta.roleTeam ?? '';
    const roleHtml = meta.roleName
      ? `<span class="meta-role-chip role-name ${roleColorClass}">${icon}${meta.roleName}</span>`
      : '';
    const alignLabel = { good: 'G', evil: 'E' };
    const alignClass = { good: 'meta-good', evil: 'meta-evil' };
    const a = meta.alignment ?? '';
    const alignHtml = a ? `<span class="meta-align-badge ${alignClass[a]}">${alignLabel[a]}</span>` : '';
    const tintStyle = tint ? `background:${tint}` : '';
    html += `<tr style="${tintStyle}">`;
    const pinned = pinnedPlayers.has(name);
    html += `<td class="notes-player-name${dead}" data-player="${name}" style="${color ? `color:${color};` : ''}${tintStyle}"><button class="pin-hl-btn${pinned ? ' pinned' : ''}" data-pin="${esc(name)}" title="Pin highlight">☀</button>${dn(name)}</td>`;
    const roleLocked = isTraveller ? ' role-locked' : '';
    html += `<td class="notes-meta-cell notes-meta-role${roleLocked}" data-player="${name}">${roleHtml}</td>`;
    html += `<td class="notes-meta-cell notes-meta-align" data-player="${name}">${alignHtml}</td>`;
    for (let i = 0; i < phases.length; i++) {
      const ph = phases[i];
      const epoch = i % 2 === 0 ? ' epoch-start' : '';
      html += `<td class="notes-cell${epoch}" data-player="${name}" data-phase="${ph}">
        <div class="cell-chips">${chipsHtml(name, ph)}</div>
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
        openPopover(cell.dataset.player, cell.dataset.phase, cell, Number(chip.dataset.idx));
      } else {
        openPopover(cell.dataset.player, cell.dataset.phase, cell, null);
      }
    });
  });

  applyHighlights(); applyPinnedHighlights();
}

// ── WS heartbeat ──────────────────────────────────────────────────────────

let lastWsTs = Date.now(); // start counting from page load so timer is always visible

function touchWsHeartbeat() {
  lastWsTs = Date.now();
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
  if (e.target.closest('#notes-table')) return;
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
      renderState(payload.data); patchTimelineNames(); renderTimeline(); renderNotesGrid(); refreshPlayerTimeline();
      if (nameMapGrew) { renderNominations(); renderChats(); renderMessages(); refreshPlayerTimeline(); }
    }
    else if (payload.type === 'WS_RECV' || payload.type === 'WS_SEND') { touchWsHeartbeat(); appendWsEvent(payload); }
    else if (payload.type === 'NEEDS_RELOAD') { showReloadPrompt(); }
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

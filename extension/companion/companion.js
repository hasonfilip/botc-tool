'use strict';

// Full sorted timeline kept locally so we can re-render intervals
let fullTimeline = [];
let currentState = null;
let revealedRoles = {}; // playerId → roleId, populated from end entry
let allNominations = [];
let allChatSessions = [];
let nameMap = {};
let showNightChats = false;
let lastPlayersJson = '';
let cellTokens = {};
let lastNotesKey = '';

const PREDEFINED_TAGS = [
  { id: 'first-night-info',     label: 'first night' },
  { id: 'no-first-night-info',  label: 'isn\'t first night' },
  { id: 'wakes',                label: 'wakes at night' },
  { id: 'no-wake',              label: 'doesn\'t wake' },
  { id: 'outsider',             label: 'outsider' },
  { id: 'not-outsider',         label: 'not an outsider' },
];

const phaseLabel = (phase) => phase % 2 === 1 ? `Night ${Math.ceil(phase / 2)}` : `Day ${Math.ceil(phase / 2)}`;

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
      <td><div class="player-name" data-player="${player.name ?? player.id}">${player.name ?? player.id}</div><div class="player-pronouns">${player.pronouns ?? ''}</div></td>
      <td class="role-name ${team}">${roleName}</td>
      <td class="no-strike">
        <div class="status-tags">
          ${(player.status ?? []).map(s => `<span class="tag">${s}</span>`).join('')}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  applyHighlights();
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
      const isEarlyDay = current.label.startsWith('Day') && (ev.ts - current.start) < 60000;
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
        const action = d.type === 'ghostvote' ? 'ghost vote' : d.type === 'revive' ? 'revived' : isExile ? 'exiled' : 'died';
        const cls = d.type === 'revive' ? 'revive' : d.type === 'ghostvote' ? 'ghostvote' : '';
        const offsetStr = d.refStart ? '' : ` <span class="tl-death-time">+${duration(d.ts - block.start)}</span>`;
        return `<div class="tl-death ${cls}">${icon} <span class="${team ? `role-name ${team}` : ''}" data-player="${name}">${name}</span> ${action}${offsetStr}</div>`;
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
  applyHighlights();
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

    const isGhostVoter = (name) => {
      const p = currentState?.players?.find(p => p.name === name);
      return p?.isDead ?? false;
    };

    const li = document.createElement('li');
    li.className = 'nom-entry';
    li.innerHTML = `
      <div class="nom-header">
        <span class="nom-nominator role-name ${playerTeamByName(nominator)}" data-player="${nominator}">${nominator}</span>
        <span class="nom-arrow">-></span>
        <span class="nom-nominee role-name ${playerTeamByName(nominee)}" data-player="${nominee}">${nominee}</span>
        <span class="nom-count ${yesCount >= needed ? 'nom-execute' : ''}">${yesCount}/${needed}</span>
        <span class="nom-time">${fmt(nom.ts)}</span>
      </div>
      ${yesNames.length > 0 ? `<div class="nom-voters">${yesNames.map(n => `${isGhostVoter(n) ? '👻 ' : ''}<span class="role-name ${playerTeamByName(n)}" data-player="${n}">${n}</span>`).join(', ')}</div>` : '<div class="nom-voters nom-none">no votes</div>'}
    `;
    list.appendChild(li);
  }
  bindPhaseSeparators(list, collapsedPhases);
  applyHighlights();
}

// ── Chats ─────────────────────────────────────────────────────────────────

function playerTeamByName(name) {
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

function formatParticipant(userId) {
  const name = resolveParticipant(userId);
  if (isStoryteller(userId)) return `<span class="chat-st" data-player="${name}">${name}</span>`;
  const team = playerTeamByName(name);
  return `<span class="role-name ${team}" data-player="${name}">${name}</span>`;
}

function renderChats() {
  const list = document.getElementById('chats-log');
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

    const names = session.participants.map(formatParticipant);
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
  applyHighlights();
}

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
      const t = chip.text.length > 40 ? chip.text.slice(0, 40) + '…' : chip.text;
      return `<span class="token-chip note-chip ${impCls}" ${attrs} title="${chip.text.replace(/"/g,'&quot;')}">${t}</span>`;
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
    <select class="tp-role-select">
      <option value="">role</option>
    </select>
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
  const roleSelect = _popover.querySelector('.tp-role-select');
  const xBtn = _popover.querySelector('.tp-x-btn');
  const impBtns = [..._popover.querySelectorAll('.tp-imp-btn')];

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

  roleSelect.addEventListener('change', () => {
    const id = roleSelect.value;
    if (!id) return;
    const role = (currentState?.roles ?? []).find(r => r.id === id);
    if (role) commit({ type: 'role', id: role.id, name: role.name, team: role.team ?? '', iconUrl: role.iconUrl ?? null });
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
  const roleSelect = pop.querySelector('.tp-role-select');

  // Pre-fill based on chip type
  noteInput.value = chip?.type === 'note' ? chip.text : '';
  tagsSelect.value = chip?.type === 'tag' ? chip.id : '';
  // Importance
  const imp = chip?.importance ?? 1;
  pop.querySelectorAll('.tp-imp-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.imp) === imp));
  // Rebuild role options from current state
  const roles = currentState?.roles ?? [];
  roleSelect.innerHTML = `<option value="">role</option>` +
    roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  roleSelect.value = chip?.type === 'role' ? chip.id : '';

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

function renderNotesGrid() {
  if (!currentState?.players?.length) return;

  // Skip rebuild if popover note textarea is focused
  if (document.activeElement?.classList.contains('tp-note-input')) return;

  const phases = getPhaseColumns();
  const players = currentState.players;

  const key = JSON.stringify([players.map(p => [p.name, p.team, p.isDead]), phases]);
  if (key === lastNotesKey) return;
  lastNotesKey = key;

  const table = document.getElementById('notes-table');

  let html = '<thead><tr>';
  html += `<th class="notes-player-col">Player</th>`;
  for (const ph of phases) {
    const cls = ph.startsWith('Night') ? 'notes-night' : 'notes-day';
    html += `<th class="notes-phase-col ${cls}">${ph}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const player of players) {
    const name = player.name ?? `Seat ${player.seat + 1}`;
    const dead = player.isDead ? ' class="dead"' : '';
    html += `<tr>`;
    html += `<td class="notes-player-name"${dead} data-player="${name}">${name}</td>`;
    for (const ph of phases) {
      html += `<td class="notes-cell" data-player="${name}" data-phase="${ph}">
        <div class="cell-chips">${chipsHtml(name, ph)}</div>
      </td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  table.innerHTML = html;

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

  applyHighlights();
}

// ── WS heartbeat ──────────────────────────────────────────────────────────

let lastWsTs = null;

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

const applyHighlights = () => {
  document.querySelectorAll('[data-player]').forEach(el => {
    el.classList.toggle('player-hl', el.dataset.player === hoveredPlayer && hoveredPlayer !== null);
  });
};

document.addEventListener('mouseover', e => {
  const entering = e.target.closest('[data-player]');
  const leaving = e.relatedTarget?.closest('[data-player]');
  if (entering === leaving) return;
  hoveredPlayer = entering?.dataset.player ?? null;
  applyHighlights();
});

document.addEventListener('mouseout', e => {
  const leaving = e.target.closest('[data-player]');
  const entering = e.relatedTarget?.closest('[data-player]');
  if (leaving && !entering) { hoveredPlayer = null; applyHighlights(); }
});

chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (!response) return;
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
  renderState(response.state);
  if (response.timeline?.length) addTimelineEvents(response.timeline);
  allNominations = response.nominations ?? [];
  renderNominations();
  allChatSessions = response.chatSessions ?? [];
  renderChats();
  renderNotesGrid();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FULL_REFRESH') {
    applyFullRefresh(message);
    return;
  }
  if (message.type === 'BOTC_UPDATE') {
    const payload = message.payload;
    if (payload.type === 'STATE') { renderState(payload.data); patchTimelineNames(); renderTimeline(); renderNotesGrid(); }
    else if (payload.type === 'WS_RECV' || payload.type === 'WS_SEND') { touchWsHeartbeat(); appendWsEvent(payload); }
    return;
  }
  if (message.type === 'TIMELINE_EVENTS') {
    addTimelineEvents(message.events ?? []);
    renderNotesGrid();
  }
  if (message.type === 'NOMINATIONS_UPDATE') {
    allNominations = message.nominations ?? [];
    renderNominations();
  }
  if (message.type === 'CHAT_SESSIONS_UPDATE') {
    allChatSessions = message.sessions ?? [];
    renderChats();
  }
});

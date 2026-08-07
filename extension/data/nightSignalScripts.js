// Pre-computed signal drafts for night-order roles (Trouble Brewing, v1).
// Keyed by bundled role id (see roles.js). Each entry describes how to build
// the signal a storyteller would send that role, when it's deterministic
// enough to compute from live game state — including the player's OWN reply
// signal, which carries their in-app selection (e.g. who they chose to
// poison/kill/look at) back to the storyteller, same as any other signal.
//
// entry.build(ctx, filled) -> { tokens, complete, needsInput?, inputHints?, warning? } | null
//   ctx: { holder, players, roles, night, replyTokens, holderDroisoned }
//     holder: the currentState.players entry for this role's holder
//     players: currentState.players (full list)
//     roles: currentState.roles (this game's script)
//     replyTokens: flattened tokens from the holder's inbound signals this
//       night (their reply to whatever the storyteller last sent) — this is
//       how a player's in-app selection (e.g. "I poisoned seat 3") reaches us.
//     holderDroisoned: true if the holder has an active "droisoned" (drunk/
//       poisoned) marker this night — same one the storyteller already
//       maintains by hand in the notes grid, regardless of which character
//       caused it. Any info-role builder should flag its result as
//       unreliable when this is set, rather than trying to fabricate
//       plausible-but-false info.
//   filled: manually-supplied input values, used as a fallback when no reply
//     has arrived yet (or the player replied out-of-band, e.g. verbally).
//   returning null means "can't build anything useful" — the role row falls
//   back to today's manual behavior (no draft, no send button).
// entry.blocking / entry.replyMatch: downstream night-order rows lock until a
//   reply matching replyMatch is seen for a `blocking: true` role.
// entry.manualOnly: needs storyteller judgment that isn't derivable from live
//   state at all — gets a plain template, no auto-fill attempted.
// entry.prompt: for roles whose build() depends on the player's reply — the
//   tokens to send FIRST (before any reply exists) to prompt them to act.
//   The queue engine offers this as the ready-to-send draft until an
//   outbound signal has actually gone out this night, then switches to
//   "waiting for reply" until build() reports something complete.
// entry.override: { field, values } — build()'s answer is a best-guess
//   suggestion, not certain (e.g. poison/red herring/registration can't be
//   seen) — the queue engine renders `values` as a clickable toggle so the
//   storyteller can flip it before sending; build() should honor
//   filled[field] over its own computed default when present.
// build()'s returned `warning` (string|null): shown next to a 'ready' draft
//   as a flag that the suggestion may be unreliable this time.

const BOTC_NIGHT_SIGNAL_SCRIPTS = (() => {
  const seat = (p) => p.seat;
  const GOOD_TEAMS = new Set(['townsfolk', 'outsider']);
  // Registration is a per-character ability (unlike drunk/poison, which
  // behaves the same regardless of cause) — kept as two small, DIRECTIONAL
  // tables rather than one blanket "might be wrong" flag, since which way a
  // character can misregister determines whether it even matters to a given
  // check (e.g. Spy registers as GOOD, so it's irrelevant to a demon-check).
  const MISREGISTERS_AS_EVIL = new Set(['recluse']); // actually good, may appear as a Minion/Demon
  const MISREGISTERS_AS_GOOD = new Set(['spy']); // actually evil, may appear as a Townsfolk/Outsider

  // Players are eligible targets to be NAMED in a signal regardless of
  // whether their seat has a linked account (an account is only required for
  // the signal's recipient, checked separately before a draft is queued).
  function livingOthers(players, holder) {
    return players.filter(p => p.seat !== holder.seat && !p.isDead);
  }

  // Two nearest living players in each direction around the seating circle,
  // skipping dead seats and the holder's own seat.
  function liveNeighbors(players, holder) {
    const seated = [...players].sort((a, b) => a.seat - b.seat);
    const n = seated.length;
    const idx = seated.findIndex(p => p.seat === holder.seat);
    if (idx === -1 || n < 2) return [null, null];
    const stepFrom = (dir) => {
      for (let i = 1; i < n; i++) {
        const p = seated[((idx + dir * i) % n + n) % n];
        if (p.seat !== holder.seat && !p.isDead) return p;
      }
      return null;
    };
    return [stepFrom(-1), stepFrom(1)];
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Shared across every info-role builder: if the holder is drunk/poisoned,
  // their result is fabricated by the storyteller anyway — flag it rather
  // than presenting the computed answer as trustworthy.
  function withDroisonWarning(built, ctx, roleName) {
    if (!built || !built.complete || !ctx.holderDroisoned) return built;
    return { ...built, warning: `${roleName} may be drunk or poisoned — this info could be false.` };
  }

  // First player-token seat found in the holder's reply this night, if any.
  function repliedSeat(ctx) {
    return (ctx.replyTokens ?? []).find(t => t.id === 'player')?.data ?? null;
  }

  // All player-token seats found in the holder's reply this night, in order.
  function repliedSeats(ctx) {
    return (ctx.replyTokens ?? []).filter(t => t.id === 'player').map(t => t.data);
  }

  // Shared "the player chooses one target, storyteller just acknowledges/
  // relays it" pattern (Poisoner, Imp). Auto-fills from their reply once it
  // arrives — until then the queue engine handles prompting them via
  // entry.prompt (see BOTC_NIGHT_SIGNAL_SCRIPTS below).
  function buildChooseOneSignal(ctx, filled, extraTokens = []) {
    const target = filled?.player ?? repliedSeat(ctx);
    if (target == null) return { tokens: [{ id: 'choice' }], complete: false };
    return { tokens: [{ id: 'player', data: target }, ...extraTokens], complete: true };
  }

  // Washerwoman/Librarian/Investigator share the same "point to two players,
  // one of them is a role of team X" info pattern. If nobody in play holds
  // that team, the two shown players are arbitrary and the role is a decoy
  // from the script (matching the official "no such character in play" rule).
  function buildTeamInfoSignal(ctx, team) {
    const others = livingOthers(ctx.players, ctx.holder);
    if (others.length < 2) return null;
    const teamRoles = (ctx.roles ?? []).filter(r => r.team === team && r.id !== ctx.holder.roleId);
    if (!teamRoles.length) return null;

    const targets = others.filter(p => p.roleId && teamRoles.some(r => r.id === p.roleId));
    let shownRoleId, a, b;
    if (targets.length) {
      const target = pickRandom(targets);
      const decoyPool = others.filter(p => p.seat !== target.seat);
      const decoy = pickRandom(decoyPool.length ? decoyPool : others);
      shownRoleId = target.roleId;
      [a, b] = Math.random() < 0.5 ? [target, decoy] : [decoy, target];
    } else {
      const pool = [...others];
      a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      b = pickRandom(pool);
      shownRoleId = pickRandom(teamRoles).id;
    }
    if (!a || !b) return null;
    return { tokens: [{ id: 'player', data: seat(a) }, { id: 'player', data: seat(b) }, { id: 'role', data: shownRoleId }], complete: true };
  }

  return {
    washerwoman: {
      build: (ctx) => withDroisonWarning(buildTeamInfoSignal(ctx, 'townsfolk'), ctx, 'Washerwoman'),
    },
    librarian: {
      build: (ctx) => {
        const built = buildTeamInfoSignal(ctx, 'outsider');
        if (built) return withDroisonWarning(built, ctx, 'Librarian');
        // No outsiders in the script at all -> librarian is told so directly.
        const hasOutsiders = (ctx.roles ?? []).some(r => r.team === 'outsider');
        if (hasOutsiders) return null; // couldn't build for another reason -> manual
        return withDroisonWarning({ tokens: [{ id: 'custom', data: 'No Outsiders in play' }], complete: true }, ctx, 'Librarian');
      },
    },
    investigator: {
      build: (ctx) => withDroisonWarning(buildTeamInfoSignal(ctx, 'minion'), ctx, 'Investigator'),
    },
    empath: {
      recomputeEveryNight: true,
      build: (ctx) => {
        const [l, r] = liveNeighbors(ctx.players, ctx.holder);
        if (!l && !r) return null;
        const count = [l, r].filter(p => p?.alignment === 'evil').length;
        const built = { tokens: [{ id: ['zero', 'one', 'two'][count] }], complete: true };
        if (ctx.holderDroisoned) return withDroisonWarning(built, ctx, 'Empath');
        const misregisters = [l, r].some(p => p && (MISREGISTERS_AS_EVIL.has(p.roleId) || MISREGISTERS_AS_GOOD.has(p.roleId)));
        return misregisters
          ? { ...built, warning: 'A neighbor may register as the opposite team (Recluse/Spy) — count may be off by one.' }
          : built;
      },
    },
    poisoner: {
      prompt: [{ id: 'choice' }],
      inputs: [{ type: 'player', label: 'Poisons' }],
      build: (ctx, filled) => buildChooseOneSignal(ctx, filled, [{ id: 'acknowledge' }]),
    },
    imp: {
      blocking: true,
      prompt: [{ id: 'choice' }],
      inputs: [{ type: 'player', label: 'Kills' }],
      build: (ctx, filled) => buildChooseOneSignal(ctx, filled),
      // Unblocks downstream night-order rows once the demon's player replies
      // naming a player — the actual kill target the app then applies.
      replyMatch: (entry) => (entry.message ?? []).some(t => t.id === 'player'),
    },
    // The two players queried are picked by the Fortune Teller themselves —
    // their reply carries both seats, so a yes/no SUGGESTION is derivable
    // once that reply lands: the actual Demon, or a Recluse (who, if it can
    // misregister, probably will — so it's treated as a hit too). Spy is
    // irrelevant here: it registers as GOOD, never as the Demon, so querying
    // one shouldn't raise any flag at all. Poison/red herring still can't be
    // seen, hence the override toggle regardless.
    fortuneteller: {
      prompt: [{ id: 'choice' }],
      override: { field: 'answer', values: ['yes', 'no'] },
      build: (ctx, filled) => {
        const seats = repliedSeats(ctx);
        if (seats.length < 2) return { tokens: [{ id: 'choice' }], complete: false };
        const seatPlayers = seats.map(s => ctx.players.find(pl => pl.seat === s));
        const demonHit = seatPlayers.some(p => (ctx.roles ?? []).find(r => r.id === p?.roleId)?.team === 'demon');
        const recluseHit = seatPlayers.some(p => MISREGISTERS_AS_EVIL.has(p?.roleId));
        const answer = filled?.answer ?? ((demonHit || recluseHit) ? 'yes' : 'no');
        const built = { tokens: [{ id: answer }], complete: true };
        if (ctx.holderDroisoned) return withDroisonWarning(built, ctx, 'Fortune Teller');
        return recluseHit && !demonHit
          ? { ...built, warning: 'Recluse queried — may register as the Demon (suggested yes).' }
          : built;
      },
    },
    // "Use your ability?" never depends on game state — always the same
    // prompt. What happens after the reply (which player(s) they then pick)
    // is next night's row, built fresh from whatever they answer.
    po: {
      build: () => ({ tokens: [{ id: 'ability' }], complete: true }),
    },
    // Who the Dreamer looked at comes from their reply; that player's real
    // role is then known live. Only the "wrong" role needs a storyteller
    // pick — official rule pairs one good + one evil character, so the wrong
    // one must come from the opposite alignment of the true one.
    dreamer: {
      prompt: [{ id: 'choice' }],
      inputs: [{ type: 'role', label: 'Wrong role' }],
      build: (ctx, filled) => {
        const targetSeat = repliedSeat(ctx);
        if (targetSeat == null) return { tokens: [{ id: 'choice' }], complete: false };
        const target = ctx.players.find(p => p.seat === targetSeat);
        const trueRoleId = target?.roleId;
        if (!trueRoleId) return { tokens: [{ id: 'choice' }], complete: false };
        if (filled?.role == null) {
          const trueTeam = (ctx.roles ?? []).find(r => r.id === trueRoleId)?.team ?? '';
          const filterTeams = GOOD_TEAMS.has(trueTeam) ? ['minion', 'demon'] : ['townsfolk', 'outsider'];
          return { tokens: [{ id: 'role', data: trueRoleId }], complete: false, needsInput: true, inputHints: { filterTeams, excludeRoleId: trueRoleId } };
        }
        const pair = Math.random() < 0.5 ? [trueRoleId, filled.role] : [filled.role, trueRoleId];
        return withDroisonWarning({ tokens: [{ id: 'role', data: pair[0] }, { id: 'role', data: pair[1] }], complete: true }, ctx, 'Dreamer');
      },
    },
    // No player selection to relay and no derivable outcome (a free
    // statement plus a kill judgment) — stays a bare template.
    gossip: { manualOnly: true, template: [{ id: 'choice' }] },
  };
})();

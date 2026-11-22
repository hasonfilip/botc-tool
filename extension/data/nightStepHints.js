// Optional suggested answers for night-order steps, keyed by bundled role id.
// The step itself is generic (driven by the role's chip spec in chipSpecs.js);
// a hint only pre-fills inputs the storyteller hasn't touched, shown as a
// suggestion they can override. Drunk/poisoned holders, Recluse/Spy
// misregistration and the like are deliberately ignored: that's the
// storyteller's call.
//
// hint(ctx, inputs) -> { i<idx>: value } | null
//   ctx: { holder, players, night, playerByName(name), alignmentOf(player) -> 'g'|'e'|null,
//          teamOf(player) -> 'townsfolk'|'outsider'|'minion'|'demon'|…,
//          roleOfName(name) -> script role id | null, nameOf(player) -> notes name,
//          executedYesterday() -> notes name | null,
//          nominationsYesterday() -> [{ nominator, nominee, voters: [player] }],
//          hasReminder(player, roleId, name) -> bool, lastExecuted() -> notes name | null,
//          reminderCarrier(roleId, name) -> notes name | null }
//   inputs: the step's current input values (player inputs hold notes names)

const BOTC_NIGHT_STEP_HINTS = (() => {
  // Nearest living player in each direction around the circle, skipping the holder.
  function liveNeighbors(players, holder) {
    const seated = [...players].sort((a, b) => a.seat - b.seat);
    const n = seated.length;
    const idx = seated.findIndex(p => p.seat === holder.seat);
    if (idx === -1 || n < 2) return [];
    const stepFrom = (dir) => {
      for (let i = 1; i < n; i++) {
        const p = seated[((idx + dir * i) % n + n) % n];
        if (p.seat !== holder.seat && !p.isDead) return p;
      }
      return null;
    };
    return [stepFrom(-1), stepFrom(1)].filter(Boolean);
  }

  // The character of the player in `name`, if they really are of `team`.
  function roleOfTeam(ctx, name, team, field) {
    const p = name && ctx.playerByName(name);
    return p && ctx.teamOf(p) === team ? { [field]: ctx.roleOfName(name) } : null;
  }

  return {
    empath: (ctx) => {
      const nbrs = [...new Set(liveNeighbors(ctx.players, ctx.holder))];
      if (!nbrs.length || nbrs.some(p => ctx.alignmentOf(p) === null)) return null;
      return { i0: nbrs.filter(p => ctx.alignmentOf(p) === 'e').length };
    },
    chef: (ctx) => {
      const seated = [...ctx.players].sort((a, b) => a.seat - b.seat);
      if (seated.length < 2 || seated.some(p => ctx.alignmentOf(p) === null)) return null;
      let pairs = 0;
      for (let i = 0; i < seated.length; i++) {
        const a = seated[i], b = seated[(i + 1) % seated.length];
        if (ctx.alignmentOf(a) === 'e' && ctx.alignmentOf(b) === 'e') pairs++;
      }
      return { i0: pairs };
    },
    // The character of the player marked as the real one (Player 1).
    // (Not when you're showing a Spy / Recluse as one — that character is your pick.)
    washerwoman: (ctx, inputs) => roleOfTeam(ctx, inputs.i0, 'townsfolk', 'i2'),
    librarian: (ctx, inputs) => roleOfTeam(ctx, inputs.i0, 'outsider', 'i2'),
    investigator: (ctx, inputs) => roleOfTeam(ctx, inputs.i0, 'minion', 'i2'),
    // The Cannibal has the ability of the last executee (if good): the most
    // recent execution, else whoever carries their Lunch reminder.
    cannibal: (ctx, inputs) => {
      const eaten = inputs.i0 || ctx.lastExecuted() || ctx.reminderCarrier('cannibal', 'Lunch');
      if (!eaten) return null;
      const p = ctx.playerByName(eaten);
      return { i0: eaten, i1: p && ['townsfolk', 'outsider'].includes(ctx.teamOf(p)) ? ctx.roleOfName(eaten) : null };
    },
    // Their character, for roles that learn a player's true character.
    undertaker: (ctx, inputs) => {
      const executed = inputs.i0 || ctx.executedYesterday();
      return executed ? { i0: executed, i1: ctx.roleOfName(executed) } : null;
    },
    ravenkeeper: (ctx, inputs) => inputs.i0 ? { i1: ctx.roleOfName(inputs.i0) } : null,
    grandmother: (ctx, inputs) => inputs.i0 ? { i1: ctx.roleOfName(inputs.i0) } : null,
    // Only if they agreed — otherwise the Harlot learns nothing.
    harlot: (ctx, inputs) => inputs.i0 && inputs.i1 === 'yes' ? { i2: ctx.roleOfName(inputs.i0) } : null,
    // From today's nominations (the day before this night).
    towncrier: (ctx) => ({ i0: ctx.nominationsYesterday().some(n => n.nominator && ctx.teamOf(n.nominator) === 'minion') ? 'yes' : 'no' }),
    flowergirl: (ctx) => ({ i0: ctx.nominationsYesterday().some(n => n.voters.some(v => ctx.teamOf(v) === 'demon')) ? 'yes' : 'no' }),
    oracle: (ctx) => ({ i0: ctx.players.filter(p => p.isDead && ctx.alignmentOf(p) === 'e').length }),
    // Steps around the circle from the Demon to its nearest Minion.
    clockmaker: (ctx) => {
      const n = ctx.players.length;
      const demons = ctx.players.filter(p => ctx.teamOf(p) === 'demon');
      const minions = ctx.players.filter(p => ctx.teamOf(p) === 'minion');
      if (!demons.length || !minions.length) return null;
      let best = Infinity;
      for (const d of demons) for (const m of minions) {
        const diff = Math.abs(d.seat - m.seat);
        best = Math.min(best, diff, n - diff);
      }
      return { i0: best };
    },
    // Direction of the nearest evil player (seats count up clockwise); a tie is
    // the storyteller's call.
    shugenja: (ctx) => {
      const n = ctx.players.length;
      const evil = ctx.players.filter(p => p.seat !== ctx.holder.seat && ctx.alignmentOf(p) === 'e');
      if (!evil.length) return null;
      const cw = Math.min(...evil.map(p => (p.seat - ctx.holder.seat + n) % n));
      const acw = Math.min(...evil.map(p => (ctx.holder.seat - p.seat + n) % n));
      return cw === acw ? null : { i0: cw < acw ? 'clockwise' : 'anti-clockwise' };
    },
    villageidiot: (ctx, inputs) => {
      const p = inputs.i0 && ctx.playerByName(inputs.i0);
      const a = p && ctx.alignmentOf(p);
      return a ? { i1: a === 'e' ? 'evil' : 'good' } : null;
    },
    seamstress: (ctx, inputs) => {
      const [a, b] = [inputs.i0, inputs.i1].map(n => n && ctx.playerByName(n));
      if (!a || !b || !ctx.alignmentOf(a) || !ctx.alignmentOf(b)) return null;
      return { i2: ctx.alignmentOf(a) === ctx.alignmentOf(b) ? 'yes' : 'no' };
    },
    sage: (ctx) => {
      const d = ctx.players.find(p => ctx.teamOf(p) === 'demon');
      return d ? { i0: ctx.nameOf(d) } : null;
    },
    choirboy: (ctx) => {
      const d = ctx.players.find(p => ctx.teamOf(p) === 'demon');
      return d ? { i0: ctx.nameOf(d) } : null;
    },
    // Their pick's true character goes in the matching good / evil slot; the
    // other one is the storyteller's pick.
    dreamer: (ctx, inputs) => {
      const p = inputs.i0 && ctx.playerByName(inputs.i0);
      const role = inputs.i0 && ctx.roleOfName(inputs.i0);
      if (!p || !role) return null;
      return ['minion', 'demon'].includes(ctx.teamOf(p)) ? { i2: role } : { i1: role };
    },
    // Yes if either chosen player is the Demon or the Red Herring.
    fortuneteller: (ctx, inputs) => {
      const picked = [inputs.i0, inputs.i1].map(n => n && ctx.playerByName(n)).filter(Boolean);
      if (picked.length < 2) return null;
      return { i2: picked.some(p => ctx.teamOf(p) === 'demon' || ctx.hasReminder(p, 'fortuneteller', 'Red Herring')) ? 'yes' : 'no' };
    },
  };
})();

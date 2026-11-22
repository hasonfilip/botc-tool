// Things the storyteller has to resolve at the moment a nomination is made —
// surfaced while picking the nominator and nominee, before the nomination goes in.
//
// Each rule declares which side of the nomination it inspects:
//   'nominator' — fires on the player doing the nominating
//   'nominee'   — fires on the player being nominated
//   'pair'      — needs both, so it only fires once a nominator is picked
//
// test(ctx) returns falsy (no alert), true, or a string: a short note shown
// after the label, for when the outcome is the storyteller's call ("Spy: your
// call"). ctx (built in companion.js, nominationAlerts()):
//   nominator, nominee  player objects (nominee is null while still picking one)
//   rem(p, roleId, name)  live reminder token on that seat — flipped tokens
//                       (face down = droisoned ability) never count
//   ability(p)          role id of the ability the player has: their token,
//                       unless they're really the Drunk/Marionette/Lunatic
//   team(p)             their true team ('townsfolk', 'minion', …)
//   good(p)             true / false / null by alignment
//   misreg(p)           how they may register as something else, or null:
//                       { role: 'Spy', asGood, asTownsfolk, asEvil, asDemon, asMinion }
//   holder(roleId)      the living player with that ability, or null —
//                       compare players by .seat, not ===
//   alive               number of living players
//   day                 current day number, or null if phases aren't tracked
//   timesNominated(p)   earlier nominations of p, all game
//   timesNominating(p)  earlier nominations made by p, all game
//
// holder(ctx) names the player whose ability the alert is about; when they
// have a drunk/poisoned reminder the alert says so, since it may not happen.
//
// role is the icon shown on the chip; label (string or fn(ctx)) is read at a
// glance mid-nomination, so it stays a few words. level: 'danger' for something
// that kills, executes or ends the game, 'info' for something that changes the
// outcome without one.
const BOTC_NOM_ALERTS = [
  // ── Danger ──
  {
    id: 'virgin-execute',
    side: 'pair',
    level: 'danger',
    role: 'virgin',
    label: 'nominator executed!',
    holder: ({ nominee }) => nominee,
    test: ({ nominator, nominee, rem, ability, team, misreg, timesNominated }) => {
      if (ability(nominee) !== 'virgin' || rem(nominee, 'virgin', 'No Ability') || timesNominated(nominee) > 0) return false;
      if (team(nominator) === 'townsfolk') return true;
      const m = misreg(nominator);
      return m?.asTownsfolk ? `${m.role}: your call` : false;
    },
  },
  {
    id: 'witch-cursed',
    side: 'nominator',
    level: 'danger',
    role: 'witch',
    label: 'dies!',
    holder: ({ holder }) => holder('witch'),
    // The Witch loses her ability once just 3 players live.
    test: ({ nominator, rem, alive }) => rem(nominator, 'witch', 'Cursed') && alive > 3,
  },
  {
    id: 'golem-nominate',
    side: 'pair',
    level: 'danger',
    role: 'golem',
    label: 'nominee dies!',
    holder: ({ nominator }) => nominator,
    test: ({ nominator, nominee, rem, ability, team, misreg, timesNominating }) => {
      if (ability(nominator) !== 'golem' || rem(nominator, 'golem', 'May Not Nominate') || timesNominating(nominator) > 0) return false;
      if (team(nominee) === 'demon') return false;
      const m = misreg(nominee);
      return m?.asDemon ? `${m.role}: your call` : true;
    },
  },
  {
    id: 'saint',
    side: 'nominee',
    level: 'danger',
    role: 'saint',
    label: 'if executed, good loses!',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'saint',
  },
  {
    id: 'fearmonger',
    side: 'pair',
    level: 'danger',
    role: 'fearmonger',
    label: ({ nominee, good }) => `if executed, ${good(nominee) === false ? 'evil' : 'good'} loses!`,
    holder: ({ nominator }) => nominator,
    test: ({ nominator, nominee, rem, ability }) =>
      ability(nominator) === 'fearmonger' && rem(nominee, 'fearmonger', 'Fear'),
  },
  {
    id: 'boomdandy',
    side: 'nominee',
    level: 'danger',
    role: 'boomdandy',
    label: 'if executed, all but 3 die!',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'boomdandy',
  },
  {
    id: 'goblin',
    side: 'nominee',
    level: 'danger',
    role: 'goblin',
    label: 'claims Goblin & executed: evil wins!',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'goblin',
  },
  {
    id: 'riot',
    side: 'nominee',
    level: 'danger',
    role: 'riot',
    label: 'nominee dies, nominates next',
    holder: ({ holder }) => holder('riot'),
    test: ({ holder, rem, day }) => {
      const riot = holder('riot');
      return !!riot && (day >= 3 || rem(riot, 'riot', 'Day 3'));
    },
  },

  // ── Info ──
  {
    id: 'virgin-spends',
    side: 'nominee',
    level: 'info',
    role: 'virgin',
    label: 'ability spent',
    test: ({ nominee, rem, ability, timesNominated }) =>
      ability(nominee) === 'virgin' && !rem(nominee, 'virgin', 'No Ability') && timesNominated(nominee) === 0,
  },
  {
    id: 'golem-spent',
    side: 'nominator',
    level: 'info',
    role: 'golem',
    label: 'cannot nominate',
    test: ({ nominator, rem, ability, timesNominating }) =>
      rem(nominator, 'golem', 'May Not Nominate')
      || (ability(nominator) === 'golem' && timesNominating(nominator) > 0),
  },
  {
    id: 'princess',
    side: 'pair',
    level: 'info',
    role: 'princess',
    label: 'if executed, no Demon kill tonight',
    holder: ({ nominator }) => nominator,
    test: ({ nominator, ability, day }) => ability(nominator) === 'princess' && day === 1,
  },
  {
    id: 'devils-advocate',
    side: 'nominee',
    level: 'info',
    role: 'devilsadvocate',
    label: 'survives execution',
    holder: ({ holder }) => holder('devilsadvocate'),
    test: ({ nominee, rem }) => rem(nominee, 'devilsadvocate', 'Survives Execution'),
  },
  {
    id: 'tea-lady',
    side: 'nominee',
    level: 'info',
    role: 'tealady',
    label: 'cannot die',
    holder: ({ holder }) => holder('tealady'),
    test: ({ nominee, rem }) => rem(nominee, 'tealady', 'Cannot Die'),
  },
  {
    id: 'sailor',
    side: 'nominee',
    level: 'info',
    role: 'sailor',
    label: 'cannot die',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'sailor',
  },
  {
    id: 'fool',
    side: 'nominee',
    level: 'info',
    role: 'fool',
    label: 'survives 1st death',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, rem, ability }) => ability(nominee) === 'fool' && !rem(nominee, 'fool', 'No Ability'),
  },
  {
    id: 'zombuul',
    side: 'nominee',
    level: 'info',
    role: 'zombuul',
    label: 'survives 1st death',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, rem, ability }) => ability(nominee) === 'zombuul' && !rem(nominee, 'zombuul', 'Dead'),
  },
  {
    id: 'psychopath',
    side: 'nominee',
    level: 'info',
    role: 'psychopath',
    label: 'if executed, dies only on losing roshambo',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'psychopath',
  },
  {
    id: 'pacifist',
    side: 'nominee',
    level: 'info',
    role: 'pacifist',
    label: 'if executed, might not die',
    holder: ({ holder }) => holder('pacifist'),
    test: ({ nominee, holder, good, misreg }) => {
      if (!holder('pacifist')) return false;
      if (good(nominee) === true) return true;
      const m = misreg(nominee);
      return m?.asGood ? `${m.role}: your call` : false;
    },
  },
  {
    id: 'scapegoat',
    side: 'nominee',
    level: 'info',
    role: 'scapegoat',
    label: 'Scapegoat may be executed instead',
    holder: ({ holder }) => holder('scapegoat'),
    test: ({ nominee, holder, good }) => {
      const goat = holder('scapegoat');
      return !!goat && goat.seat !== nominee.seat && good(goat) !== null && good(goat) === good(nominee);
    },
  },
  {
    id: 'minstrel',
    side: 'nominee',
    level: 'info',
    role: 'minstrel',
    label: 'if executed, everyone is drunk',
    holder: ({ holder }) => holder('minstrel'),
    test: ({ nominee, holder, team }) => !!holder('minstrel') && team(nominee) === 'minion',
  },
  {
    id: 'judge',
    side: 'nominator',
    level: 'info',
    role: 'judge',
    label: 'Judge may force pass or fail',
    holder: ({ holder }) => holder('judge'),
    test: ({ nominator, holder, rem }) => {
      const judge = holder('judge');
      return !!judge && judge.seat !== nominator.seat && !rem(judge, 'judge', 'No Ability');
    },
  },
  {
    id: 'bishop',
    side: 'nominator',
    level: 'info',
    role: 'bishop',
    label: 'only the Storyteller nominates',
    holder: ({ holder }) => holder('bishop'),
    test: ({ holder }) => !!holder('bishop'),
  },
];

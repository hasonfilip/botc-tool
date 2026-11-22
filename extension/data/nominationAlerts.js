// Things the storyteller has to resolve around a nomination, by when they matter
// (when):
//   'now'           the moment the nomination is made
//   'execution'     if the nominee is executed — with the nomination, and for
//                   the marked player
//   'death'         as 'execution', and again once they've died by day, until
//                   dismissed
//   'no-execution'  if nobody is executed today — at the No execution button
//
// Each rule declares which side of the nomination it inspects:
//   'nominator' — fires on the player doing the nominating
//   'nominee'   — fires on the player being nominated
//   'pair'      — needs both, so it only fires once a nominator is picked
//   'none'      — neither ('no-execution' rules)
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
//   aliveBefore         living players counting the nominee, even if they've died
//   day                 current day number, or null if phases aren't tracked
//   timesNominated(p)   earlier nominations of p, all game
//   timesNominating(p)  earlier nominations made by p, all game
//
// holder(ctx) names the player whose ability the alert is about; when they
// have a drunk/poisoned reminder the alert says so, since it may not happen.
//
// Only what the storyteller has to act on or keep in mind at that moment —
// bookkeeping (the Virgin's ability being spent) and roles that matter on every
// nomination (Judge, Bishop) don't get an alert.
//
// role is the icon (whose ability it is); the label never leans on it for its
// subject, since that's often someone else (the Pacifist's alert is about the
// nominee). 'now' labels name who: "nominator …" / "nominee …". The rest show
// under "If executed" / "Died today" next to the player, so they read as what
// happens: "they …" is that player. level: 'danger' for something that kills,
// executes or ends the game, 'info' for something that changes the outcome
// without one.
const BOTC_NOM_ALERTS = [
  // ── Danger ──
  {
    id: 'virgin-execute',
    when: 'now',
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
    when: 'now',
    side: 'nominator',
    level: 'danger',
    role: 'witch',
    label: 'nominator dies!',
    holder: ({ holder }) => holder('witch'),
    // The Witch loses her ability once just 3 players live.
    test: ({ nominator, rem, alive }) => rem(nominator, 'witch', 'Cursed') && alive > 3,
  },
  {
    id: 'golem-nominate',
    when: 'now',
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
    when: 'execution',
    side: 'nominee',
    level: 'danger',
    role: 'saint',
    label: 'good loses!',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'saint',
  },
  {
    id: 'fearmonger',
    when: 'execution',
    side: 'nominee',
    level: 'danger',
    role: 'fearmonger',
    label: ({ nominee, good }) => `${good(nominee) === false ? 'evil' : 'good'} loses!`,
    holder: ({ holder }) => holder('fearmonger'),
    test: ({ nominee, rem, holder }) => !!holder('fearmonger') && rem(nominee, 'fearmonger', 'Fear'),
  },
  {
    id: 'boomdandy',
    when: 'execution',
    side: 'nominee',
    level: 'danger',
    role: 'boomdandy',
    label: 'all but 3 players die!',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'boomdandy',
  },
  {
    id: 'goblin',
    when: 'execution',
    side: 'nominee',
    level: 'danger',
    role: 'goblin',
    label: 'evil wins if they claimed Goblin!',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'goblin',
  },
  {
    id: 'riot',
    when: 'now',
    side: 'nominee',
    level: 'danger',
    role: 'riot',
    label: 'nominee dies, then nominates',
    holder: ({ holder }) => holder('riot'),
    test: ({ holder, rem, day }) => {
      const riot = holder('riot');
      return !!riot && (day >= 3 || rem(riot, 'riot', 'Day 3'));
    },
  },

  // ── Info ──
  {
    id: 'golem-spent',
    when: 'now',
    side: 'nominator',
    level: 'info',
    role: 'golem',
    label: 'nominator can\'t nominate again',
    test: ({ nominator, rem, ability, timesNominating }) =>
      rem(nominator, 'golem', 'May Not Nominate')
      || (ability(nominator) === 'golem' && timesNominating(nominator) > 0),
  },
  {
    id: 'princess',
    when: 'execution',
    side: 'pair',
    level: 'info',
    role: 'princess',
    label: 'no Demon kill tonight',
    holder: ({ nominator }) => nominator,
    test: ({ nominator, ability, day }) => ability(nominator) === 'princess' && day === 1,
  },
  {
    id: 'devils-advocate',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'devilsadvocate',
    label: 'they survive',
    holder: ({ holder }) => holder('devilsadvocate'),
    test: ({ nominee, rem }) => rem(nominee, 'devilsadvocate', 'Survives Execution'),
  },
  {
    id: 'tea-lady',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'tealady',
    label: 'they can\'t die',
    holder: ({ holder }) => holder('tealady'),
    test: ({ nominee, rem }) => rem(nominee, 'tealady', 'Cannot Die'),
  },
  {
    id: 'sailor',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'sailor',
    label: 'they can\'t die',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'sailor',
  },
  {
    id: 'fool',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'fool',
    label: 'they survive (1st death)',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, rem, ability }) => ability(nominee) === 'fool' && !rem(nominee, 'fool', 'No Ability'),
  },
  {
    id: 'zombuul',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'zombuul',
    label: 'they survive, but register as dead',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, rem, ability }) => ability(nominee) === 'zombuul' && !rem(nominee, 'zombuul', 'Dead'),
  },
  {
    id: 'psychopath',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'psychopath',
    label: 'they die only if they lose roshambo',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'psychopath',
  },
  {
    id: 'pacifist',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'pacifist',
    label: 'they might not die',
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
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'scapegoat',
    label: 'the Scapegoat may be executed instead',
    holder: ({ holder }) => holder('scapegoat'),
    test: ({ nominee, holder, good }) => {
      const goat = holder('scapegoat');
      return !!goat && goat.seat !== nominee.seat && good(goat) !== null && good(goat) === good(nominee);
    },
  },
  {
    id: 'minstrel',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'minstrel',
    label: 'everyone else drunk till tomorrow dusk',
    holder: ({ holder }) => holder('minstrel'),
    test: ({ nominee, holder, team }) => !!holder('minstrel') && team(nominee) === 'minion',
  },

  // ── If executed (new) ──
  {
    id: 'evil-twin',
    when: 'execution',
    side: 'nominee',
    level: 'danger',
    role: 'eviltwin',
    label: 'evil wins!',
    holder: ({ holder }) => holder('eviltwin'),
    test: ({ nominee, rem, holder, good }) => !!holder('eviltwin') && rem(nominee, 'eviltwin', 'Twin') && good(nominee) !== false,
  },
  {
    id: 'mastermind',
    when: 'execution',
    side: 'nominee',
    level: 'info',
    role: 'mastermind',
    label: 'play 1 more day',
    holder: ({ holder }) => holder('mastermind'),
    test: ({ nominee, holder, team }) => !!holder('mastermind') && team(nominee) === 'demon',
  },

  // ── On death: whenever they die by day, executed or not ──
  {
    id: 'klutz',
    when: 'death',
    side: 'nominee',
    level: 'danger',
    role: 'klutz',
    label: 'they publicly choose a player: if evil, good loses',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'klutz',
  },
  {
    id: 'moonchild',
    when: 'death',
    side: 'nominee',
    level: 'info',
    role: 'moonchild',
    label: 'they publicly choose a player: if good, that player dies tonight',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'moonchild',
  },
  {
    id: 'sweetheart',
    when: 'death',
    side: 'nominee',
    level: 'info',
    role: 'sweetheart',
    label: '1 player is drunk from now on',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'sweetheart',
  },
  {
    id: 'plague-doctor',
    when: 'death',
    side: 'nominee',
    level: 'info',
    role: 'plaguedoctor',
    label: 'the Storyteller gains a Minion ability',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'plaguedoctor',
  },
  {
    id: 'barber',
    when: 'death',
    side: 'nominee',
    level: 'info',
    role: 'barber',
    label: 'the Demon may swap 2 characters tonight',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'barber',
  },
  {
    id: 'hatter',
    when: 'death',
    side: 'nominee',
    level: 'info',
    role: 'hatter',
    label: 'evil players may change characters tonight',
    holder: ({ nominee }) => nominee,
    test: ({ nominee, ability }) => ability(nominee) === 'hatter',
  },
  {
    id: 'lleech-host',
    when: 'death',
    side: 'nominee',
    level: 'danger',
    role: 'lleech',
    label: 'the Lleech dies too',
    holder: ({ holder }) => holder('lleech'),
    test: ({ nominee, rem, holder }) => !!holder('lleech') && rem(nominee, 'lleech', 'Poisoned'),
  },
  {
    id: 'scarlet-woman',
    when: 'death',
    side: 'nominee',
    level: 'info',
    role: 'scarletwoman',
    label: 'the Scarlet Woman becomes the Demon',
    holder: ({ holder }) => holder('scarletwoman'),
    test: ({ nominee, holder, team, aliveBefore }) =>
      team(nominee) === 'demon' && !!holder('scarletwoman') && aliveBefore >= 5,
  },

  // ── If nobody is executed today ──
  {
    id: 'mayor',
    when: 'no-execution',
    side: 'none',
    level: 'danger',
    role: 'mayor',
    label: 'good wins!',
    holder: ({ holder }) => holder('mayor'),
    test: ({ holder, alive }) => !!holder('mayor') && alive === 3,
  },
  {
    id: 'vortox',
    when: 'no-execution',
    side: 'none',
    level: 'danger',
    role: 'vortox',
    label: 'evil wins!',
    holder: ({ holder }) => holder('vortox'),
    test: ({ holder }) => !!holder('vortox'),
  },
];

// Things the storyteller has to resolve at the moment a nomination is made —
// surfaced while picking the nominator and nominee, before the nomination goes in.
//
// Each rule declares which side of the nomination it inspects:
//   'nominator' — fires on the player doing the nominating
//   'nominee'   — fires on the player being nominated
//   'pair'      — needs both, so it only fires once a nominator is picked
//
// test(ctx) gets { nominator, nominee, rem, alive } where nominator/nominee are
// player objects from companion state (nominee is null while still picking one)
// and rem(player, roleId, name) reports whether a live reminder token is on that
// seat — flipped tokens (face down = droisoned ability) never count, so rules can
// test for them without special-casing it.
//
// role is the icon shown on the chip; label is read at a glance mid-nomination,
// so it stays a couple of words. level: 'danger' for something that kills or
// executes right now, 'info' for something that changes the outcome without one.
const BOTC_NOM_ALERTS = [
  {
    id: 'virgin-execute',
    side: 'pair',
    level: 'danger',
    role: 'virgin',
    label: 'nominator executed!',
    test: ({ nominator, nominee, rem }) =>
      nominee?.roleId === 'virgin'
      && !rem(nominee, 'virgin', 'No Ability')
      && nominator?.team === 'townsfolk',
  },
  {
    id: 'virgin-spends',
    side: 'nominee',
    level: 'info',
    role: 'virgin',
    label: 'ability spent',
    test: ({ nominee, rem }) =>
      nominee?.roleId === 'virgin' && !rem(nominee, 'virgin', 'No Ability'),
  },
  {
    id: 'witch-cursed',
    side: 'nominator',
    level: 'danger',
    role: 'witch',
    label: 'dies!',
    test: ({ nominator, rem }) => rem(nominator, 'witch', 'Cursed'),
  },
  {
    id: 'golem-nominate',
    side: 'nominator',
    level: 'danger',
    role: 'golem',
    label: 'nominee dies!',
    test: ({ nominator, rem }) =>
      nominator?.roleId === 'golem' && !rem(nominator, 'golem', 'May Not Nominate'),
  },
  {
    id: 'golem-spent',
    side: 'nominator',
    level: 'info',
    role: 'golem',
    label: 'cannot nominate',
    test: ({ nominator, rem }) => rem(nominator, 'golem', 'May Not Nominate'),
  },
  {
    id: 'devils-advocate',
    side: 'nominee',
    level: 'info',
    role: 'devilsadvocate',
    label: 'survives execution',
    test: ({ nominee, rem }) => rem(nominee, 'devilsadvocate', 'Survives Execution'),
  },
  {
    id: 'tea-lady',
    side: 'nominee',
    level: 'info',
    role: 'tealady',
    label: 'cannot die',
    test: ({ nominee, rem }) => rem(nominee, 'tealady', 'Cannot Die'),
  },
  {
    id: 'sailor',
    side: 'nominee',
    level: 'info',
    role: 'sailor',
    label: 'cannot die',
    test: ({ nominee }) => nominee?.roleId === 'sailor',
  },
  {
    id: 'fool',
    side: 'nominee',
    level: 'info',
    role: 'fool',
    label: 'survives 1st death',
    test: ({ nominee, rem }) =>
      nominee?.roleId === 'fool' && !rem(nominee, 'fool', 'No Ability'),
  },
];

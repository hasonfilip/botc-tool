// Defines the input fields for each role's ability chip.
// inputs: array of { type, label, filter?, options? }
//   type: 'player' | 'player?' | 'role' | 'number' | 'yn' | 'alignment' | 'direction' | 'text' | 'options'
//   filter (for role type): 'townsfolk'|'outsider'|'minion'|'demon'|'good'|'evil' — leave out for any role in play
//   options (for options type): string[] of selectable values
// confirmedLabel: what "confirmed" means for this role (placed on another player's cell)

const BOTC_CHIP_SPECS = {
  // ── Townsfolk ─────────────────────────────────────────────────────────────

  washerwoman: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
      { type: 'role', label: 'Townsfolk', filter: 'townsfolk' },
    ],
    confirmedLabel: 'is the Townsfolk',
  },
  librarian: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player?', label: 'Player 2' },
      { type: 'role', label: 'Outsider', filter: 'outsider' },
    ],
    confirmedLabel: 'is the Outsider',
  },
  investigator: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
      { type: 'role', label: 'Minion', filter: 'minion' },
    ],
    confirmedLabel: 'is the Minion',
  },
  chef: {
    inputs: [
      { type: 'number', label: 'Evil pairs', min: 0, max: 10 },
    ],
  },
  empath: {
    inputs: [
      { type: 'number', label: 'Evil neighbors', min: 0, max: 2 },
    ],
  },
  fortuneteller: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
      { type: 'yn', label: 'Demon ping?' },
    ],
    confirmedLabel: 'is the Demon',
  },
  undertaker: {
    inputs: [
      { type: 'player', label: 'Executed' },
      { type: 'role', label: 'Their role' },
    ],
    confirmedLabel: 'confirmed role',
  },
  monk: {
    inputs: [
      { type: 'player', label: 'Protected' },
    ],
    confirmedLabel: 'protected by Monk',
  },
  ravenkeeper: {
    inputs: [
      { type: 'player', label: 'Chosen' },
      { type: 'role', label: 'Their role' },
    ],
    confirmedLabel: 'role learned',
  },
  virgin: {
    inputs: [],
    confirmedLabel: 'nominator executed',
  },
  slayer: {
    inputs: [
      { type: 'player', label: 'Target' },
    ],
    confirmedLabel: 'shot by Slayer',
  },
  soldier: {
    inputs: [],
  },
  mayor: {
    inputs: [],
  },
  grandmother: {
    inputs: [
      { type: 'player', label: 'Grandchild' },
      { type: 'role', label: 'Their role', filter: 'good' },
    ],
    confirmedLabel: 'is the grandchild',
  },
  sailor: {
    inputs: [
      { type: 'player', label: 'Drunk target' },
    ],
    confirmedLabel: 'drunk by Sailor',
  },
  chambermaid: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
      { type: 'number', label: 'Woke tonight', min: 0, max: 2 },
    ],
  },
  exorcist: {
    inputs: [
      { type: 'player', label: 'Chosen' },
    ],
    confirmedLabel: 'exorcised',
  },
  innkeeper: {
    inputs: [
      { type: 'player', label: 'Protected 1' },
      { type: 'player', label: 'Protected 2' },
    ],
  },
  gambler: {
    inputs: [
      { type: 'player', label: 'Target' },
      { type: 'role', label: 'Guessed role' },
    ],
  },
  gossip: {
    inputs: [
      { type: 'text', label: 'Statement' },
    ],
  },
  courtier: {
    inputs: [
      { type: 'role', label: 'Drunk role' },
    ],
    confirmedLabel: 'drunk by Courtier',
  },
  professor: {
    inputs: [
      { type: 'player', label: 'Resurrected' },
    ],
    confirmedLabel: 'resurrected by Prof',
  },
  clockmaker: {
    inputs: [
      { type: 'number', label: 'Steps Demon→Minion', min: 1, max: 20 },
    ],
  },
  dreamer: {
    inputs: [
      { type: 'player', label: 'Chosen' },
      { type: 'role', label: 'Good role', filter: 'good' },
      { type: 'role', label: 'Evil role', filter: 'evil' },
    ],
  },
  flowergirl: {
    inputs: [
      { type: 'yn', label: 'Demon voted?' },
    ],
  },
  towncrier: {
    inputs: [
      { type: 'yn', label: 'Minion nominated?' },
    ],
  },
  oracle: {
    inputs: [
      { type: 'number', label: 'Dead evil players', min: 0, max: 15 },
    ],
  },
  savant: {
    inputs: [
      { type: 'text', label: 'True fact' },
      { type: 'text', label: 'False fact' },
    ],
  },
  seamstress: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
      { type: 'yn', label: 'Same alignment?' },
    ],
  },
  philosopher: {
    inputs: [
      { type: 'role', label: 'Gained ability', filter: 'good' },
    ],
    confirmedLabel: 'ability taken by Phil',
  },
  artist: {
    inputs: [
      { type: 'text', label: 'Question asked' },
      { type: 'yn', label: 'Answer' },
    ],
  },
  juggler: {
    inputs: [
      { type: 'text', label: 'Guesses (p:role, …)' },
      { type: 'number', label: 'Correct', min: 0, max: 5 },
    ],
  },
  sage: {
    inputs: [
      { type: 'player', label: 'Demon option 1' },
      { type: 'player', label: 'Demon option 2' },
    ],
  },
  mathematician: {
    inputs: [
      { type: 'number', label: 'Abnormal abilities', min: 0, max: 15 },
    ],
  },
  balloonist: {
    inputs: [
      { type: 'player', label: 'Shown player' },
    ],
  },
  pixie: {
    inputs: [
      { type: 'role', label: 'Known Townsfolk', filter: 'townsfolk' },
    ],
  },
  huntsman: {
    inputs: [
      { type: 'player', label: 'Chosen' },
    ],
    confirmedLabel: 'chosen by Huntsman',
  },
  bounty_hunter: {
    inputs: [
      { type: 'player', label: 'Known evil' },
    ],
    confirmedLabel: 'known evil',
  },
  bountyhunter: {
    inputs: [
      { type: 'player', label: 'Known evil' },
    ],
    confirmedLabel: 'known evil',
  },
  highpriestess: {
    inputs: [
      { type: 'player', label: 'Talk to' },
    ],
  },
  nightwatchman: {
    inputs: [
      { type: 'player', label: 'Told' },
    ],
    confirmedLabel: 'knows Nightwatchman',
  },
  general: {
    inputs: [
      { type: 'alignment', label: 'Winning side' },
    ],
  },
  shugenja: {
    inputs: [
      { type: 'direction', label: 'Nearest evil' },
    ],
  },
  villageidiot: {
    inputs: [
      { type: 'player', label: 'Seen player' },
      { type: 'alignment', label: 'Their alignment' },
    ],
  },
  preacher: {
    inputs: [
      { type: 'player', label: 'Chosen Minion' },
    ],
    confirmedLabel: 'preached at',
  },
  snakecharmer: {
    inputs: [
      { type: 'player', label: 'Chosen' },
    ],
  },
  acrobat: {
    inputs: [
      { type: 'player', label: 'Watched' },
    ],
  },
  lycanthrope: {
    inputs: [
      { type: 'player', label: 'Chosen' },
    ],
  },
  cultleader: {
    inputs: [],
  },
  noble: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
      { type: 'player', label: 'Player 3' },
    ],
    confirmedLabel: '1 of 3 is evil',
  },
  knight: {
    inputs: [
      { type: 'player', label: 'Not Demon 1' },
      { type: 'player', label: 'Not Demon 2' },
    ],
    confirmedLabel: 'not the Demon',
  },
  steward: {
    inputs: [
      { type: 'player', label: 'Good player' },
    ],
    confirmedLabel: 'known good',
  },
  king: {
    inputs: [
      { type: 'player', label: 'Seen' },
      { type: 'role', label: 'Their role' },
    ],
    confirmedLabel: 'seen by King',
  },
  alsaahir: {
    inputs: [
      { type: 'text', label: 'Guessed Minions/Demons' },
    ],
  },
  engineer: {
    inputs: [
      { type: 'text', label: 'Changed Minions or Demon' },
    ],
  },
  alchemist: {
    inputs: [
      { type: 'role', label: 'Minion ability', filter: 'minion' },
    ],
  },
  amnesiac: {
    inputs: [
      { type: 'text', label: 'Guessed ability' },
    ],
  },
  cannibal: {
    inputs: [
      { type: 'player', label: 'Executee' },
      { type: 'role', label: 'Their role' },
    ],
  },

  // ── Outsiders ─────────────────────────────────────────────────────────────

  butler: {
    inputs: [
      { type: 'player', label: 'Master' },
    ],
    confirmedLabel: 'master of Butler',
  },
  ogre: {
    inputs: [
      { type: 'player', label: 'Chosen' },
      { type: 'alignment', label: 'Became' },
    ],
  },
  puzzlemaster: {
    inputs: [
      { type: 'player', label: 'Drunk guess' },
    ],
  },

  // ── Minions ───────────────────────────────────────────────────────────────

  poisoner: {
    inputs: [
      { type: 'player', label: 'Poisoned' },
    ],
    confirmedLabel: 'poisoned',
  },
  spy: {
    inputs: [],
  },
  scarletwoman: {
    inputs: [],
  },
  baron: {
    inputs: [],
  },
  assassin: {
    inputs: [
      { type: 'player', label: 'Target' },
    ],
    confirmedLabel: 'assassinated',
  },
  godfather: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
  },
  devilsadvocate: {
    inputs: [
      { type: 'player', label: 'Protected' },
    ],
    confirmedLabel: 'saved by DA',
  },
  eviltwin: {
    inputs: [
      { type: 'player', label: 'Good twin' },
    ],
    confirmedLabel: 'is the good twin',
  },
  witch: {
    inputs: [
      { type: 'player', label: 'Cursed' },
    ],
    confirmedLabel: 'cursed by Witch',
  },
  cerenovus: {
    inputs: [
      { type: 'player', label: 'Target' },
      { type: 'role', label: 'Mad as', filter: 'good' },
    ],
  },
  fearmonger: {
    inputs: [
      { type: 'player', label: 'Target' },
    ],
  },
  harpy: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
    ],
  },
  pithag: {
    inputs: [
      { type: 'player', label: 'Target' },
      { type: 'role', label: 'Becomes' },
    ],
  },
  widow: {
    inputs: [
      { type: 'player', label: 'Poisoned' },
    ],
    confirmedLabel: 'widow-poisoned',
  },
  marionette: {
    inputs: [
      { type: 'player', label: 'Is the Marionette' },
    ],
    confirmedLabel: 'is the Marionette',
  },
  mastermind: {
    inputs: [],
  },
  goblin: {
    inputs: [],
  },
  summoner: {
    inputs: [
      { type: 'player', label: 'Becomes Demon' },
    ],
    confirmedLabel: 'summoned as Demon',
  },
  vizier: {
    inputs: [],
  },
  organgrinder: {
    inputs: [],
  },
  boomdandy: {
    inputs: [],
  },
  xaan: {
    inputs: [
      { type: 'number', label: 'Night X (outsiders)', min: 1, max: 10 },
    ],
  },
  wraith: {
    inputs: [],
  },
  mezepheles: {
    inputs: [
      { type: 'text', label: 'Secret word' },
    ],
  },
  boffin: {
    inputs: [
      { type: 'role', label: 'Demon has ability', filter: 'good' },
    ],
  },
  wizard: {
    inputs: [
      { type: 'text', label: 'Wish' },
    ],
  },
  psychopath: {
    inputs: [
      { type: 'player', label: 'Killed' },
    ],
  },

  // ── Demons ────────────────────────────────────────────────────────────────

  imp: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'imp-killed',
  },
  vigormortis: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'vigor-killed',
  },
  vortox: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'vortox-killed',
  },
  po: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'po-killed',
  },
  shabaloth: {
    inputs: [
      { type: 'player', label: 'Kill 1' },
      { type: 'player?', label: 'Kill 2' },
    ],
    confirmedLabel: 'shabaloth-killed',
  },
  pukka: {
    inputs: [
      { type: 'player', label: 'Poisoned' },
    ],
    confirmedLabel: 'pukka-poisoned',
  },
  zombuul: {
    inputs: [
      { type: 'player?', label: 'Kill target' },
    ],
    confirmedLabel: 'zombuul-killed',
  },
  ojo: {
    inputs: [
      { type: 'role', label: 'Target role' },
    ],
  },
  lleech: {
    inputs: [
      { type: 'player', label: 'Host' },
      { type: 'player?', label: 'Kill target' },
    ],
    confirmedLabel: 'lleech host',
  },
  fanggu: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'fanggu-killed',
  },
  alhadikhia: {
    inputs: [
      { type: 'player', label: 'Player 1' },
      { type: 'player', label: 'Player 2' },
      { type: 'player', label: 'Player 3' },
    ],
  },
  nodashii: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'nodashii-killed',
  },
  kazali: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'kazali-killed',
  },
  leviathan: {
    inputs: [],
  },
  legion: {
    inputs: [],
  },
  lordoftyphon: {
    inputs: [
      { type: 'player', label: 'Kill target' },
    ],
    confirmedLabel: 'typhon-killed',
  },
  lilmonsta: {
    inputs: [
      { type: 'player', label: 'Babysitter tonight' },
    ],
  },
  riot: {
    inputs: [],
  },
  yaggababble: {
    inputs: [
      { type: 'text', label: 'Secret phrase' },
    ],
  },

  // ── Travellers ────────────────────────────────────────────────────────────

  thief: {
    inputs: [
      { type: 'player', label: 'Negative vote' },
    ],
    confirmedLabel: 'negative vote',
  },
  bureaucrat: {
    inputs: [
      { type: 'player', label: '3-vote player' },
    ],
    confirmedLabel: '3 votes',
  },
  barista: {
    inputs: [
      { type: 'player', label: 'Affected' },
      { type: 'options', label: 'Effect', options: ['true info', 'sober/double'] },
    ],
  },
  harlot: {
    inputs: [
      { type: 'player', label: 'Chosen' },
      { type: 'yn', label: 'They agreed?' },
      { type: 'role', label: 'Their role' },
    ],
  },
  butcher: {
    inputs: [
      { type: 'player?', label: 'Extra nominee' },
    ],
  },
  cacklejack: {
    inputs: [
      { type: 'player', label: 'Chosen' },
    ],
  },
  gunslinger: {
    inputs: [
      { type: 'player', label: 'Shot' },
    ],
    confirmedLabel: 'shot by Gunslinger',
  },
  matron: {
    inputs: [
      { type: 'text', label: 'Swaps (a↔b, …)' },
    ],
  },
  gangster: {
    inputs: [
      { type: 'player', label: 'Killed' },
    ],
    confirmedLabel: 'gangster-killed',
  },
  bonecollector: {
    inputs: [
      { type: 'player', label: 'Dead player' },
    ],
    confirmedLabel: 'ability restored',
  },
  judge: {
    inputs: [
      { type: 'yn', label: 'Forced execution?' },
    ],
  },
  apprentice: {
    inputs: [
      { type: 'role', label: 'Gained ability' },
    ],
  },
  beggar: {
    inputs: [
      { type: 'player', label: 'Gave vote token' },
      { type: 'alignment', label: 'Their alignment' },
    ],
  },
  deviant: {
    inputs: [],
  },
  scapegoat: {
    inputs: [],
  },
  gnome: {
    inputs: [
      { type: 'player?', label: 'Killed' },
    ],
  },
  bishop: {
    inputs: [
      { type: 'player', label: 'Nominated' },
    ],
  },
  voudon: {
    inputs: [],
  },
};

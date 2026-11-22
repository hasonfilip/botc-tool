// How each role's night-order step works, keyed by bundled role id. Builds on
// the role's chip spec (chipSpecs.js): `fields` says what each chip input is
// for, the rest says how the step talks to players.
//
//   wake:   'choice'  — open with "Make a choice!" and wait for their pick
//           'ability' — open with "Use your ability?"; a "no" means they pass
//           'info'    — they just learn something; nothing to ask
//           'none'    — the holder isn't woken (an announcement, bookkeeping,
//                       or only other players are woken — see notify)
//   ask:    tokens of the opening message, when not the default for `wake`
//           (e.g. the Widow is shown the grimoire with her "Make a choice!")
//   once:   once-per-game ability — the step shows "used" after a night it was used
//   when:   the condition for waking at all, shown on the step (not checked)
//   fields: { i<n>: 'pick' | 'tell' | 'note' } per chip input
//           pick — the player chooses it; their reply fills it; never sent back
//           tell — what they learn; Send sends these
//           note — storyteller's record only; never sent
//           Inputs not listed are notes.
//   tell:   the message Send sends, as a token template (default: the tell
//           fields in order)
//   notify: [{ to, if?, tokens }] — messages to other players this step causes
//           to: 'i<n>' (the player in that input), 'holder', 'demon', 'minions',
//               'evil', 'neighbours' (the holder's), 'reminder:<name>' (whoever
//               carries this role's reminder of that name)
//           if: a condition or a list of them, all of which must hold:
//               'i<n>:<team or role id>' — that player is one
//               'i<n>:yes' — that input is yes
//               'i<n>:notInPlay' — the character in that input isn't in play
//               'noReminder:<name>' — no one carries this role's reminder of that name
//   reminders: { i<n>: '<reminder name>' } — this role's grimoire reminder that
//           marks the player in that input (e.g. the Poisoner's "Poisoned").
//           Reminders placed in botc.app fill the input (for picks, only ones
//           placed after the night started); finishing the step places them
//           there, moving them off anyone else.
//   shuffle: inputs whose players are sent in random order (so the real one
//           isn't always first)
//   pick:   rules the player's picks must follow, from the ability's wording:
//           'alive', 'dead', 'notSelf', 'notTraveller', 'distinct' (all
//           different players), 'notLastNight' (not who they chose last night).
//           A reply that breaks one is flagged, with a "No + Make a choice!" reply.
//   dead:   the holder acts even though dead (Ravenkeeper, Sage, Farmer, …) —
//           otherwise dead holders are skipped when picking the active step
//   zeroIf: '<team>' — when nobody of that team is in play, Send sends 0
//           instead (the Librarian's "zero Outsiders")
//   optionTokens: { i<n>: { '<option>': '<token id>' } } — how an options
//           input is sent (e.g. the Barista's finger signal)
//   grants: { from: 'i<n>', to?: 'holder' | 'demon' | 'storyteller' } — the
//           character in that input is an ability someone now has (Philosopher,
//           Apprentice, Alchemist → the holder; Boffin → the Demon; Plague
//           Doctor → the Storyteller). From that night on it gets its own step at
//           that character's place in the night order. (The Cannibal's comes
//           from the last executed good player.)
//   confirm: not a wake — shown above the night order as something to check
//           (e.g. whose ability the Cannibal has), not as a step
//   first / other: overrides for the first night / other nights
//
// Token templates (strings):
//   'you' 'selected' 'claim' 'demon' 'minions' 'bluffs' 'good' 'evil' 'neutral'
//   'yes' 'no' 'acknowledge' 'grimoire' 'choice' 'ability'  — literal phrases
//   'self'        — this role's character token
//   'holder'      — the holder's seat
//   'i<n>'        — the value of that input (player, role, number, …)
//   'i<n>.role'   — the character of the player in that input
//   'role:<id>'   — a specific character token
//   'demonPlayers' 'minionPlayers' 'otherMinions' — those players' seats
//   'bluffRoles'  — the demon bluffs
//   'recipientRole' — each recipient's own character (follow-ups only)
//   'custom:<text>' — free text
//   'inPlay:<team>' — the characters of that team in play
//
// Roles without an entry get a plain step: the instruction tooltip, Compose…
// and Done.

const BOTC_NIGHT_ACTIONS = {
  // ── First-night info (pseudo-roles for the Minion Info / Demon Info steps) ──
  minioninfo: { wake: 'info', holders: 'minions', minPlayers: 7, tell: ['demon', 'demonPlayers', 'minions', 'otherMinions'] },
  demoninfo:  { wake: 'info', holders: 'demon',   minPlayers: 7, tell: ['minions', 'minionPlayers', 'bluffs', 'bluffRoles'] },

  // ── Townsfolk ──
  washerwoman:  { wake: 'info', shuffle: ['i0', 'i1'], reminders: { i0: 'Townsfolk', i1: 'Wrong' }, fields: { i0: 'tell', i1: 'tell', i2: 'tell' }, tell: ['i2', 'i0', 'i1'] },
  librarian:    { wake: 'info', shuffle: ['i0', 'i1'], reminders: { i0: 'Outsider', i1: 'Wrong' }, fields: { i0: 'tell', i1: 'tell', i2: 'tell' }, tell: ['i2', 'i0', 'i1'], zeroIf: 'outsider' },
  investigator: { wake: 'info', shuffle: ['i0', 'i1'], reminders: { i0: 'Minion', i1: 'Wrong' }, fields: { i0: 'tell', i1: 'tell', i2: 'tell' }, tell: ['i2', 'i0', 'i1'] },
  chef:         { wake: 'info', fields: { i0: 'tell' } },
  empath:       { wake: 'info', fields: { i0: 'tell' } },
  fortuneteller:{ wake: 'choice', pick: ['distinct'], fields: { i0: 'pick', i1: 'pick', i2: 'tell' } },
  undertaker:   { wake: 'info', reminders: { i0: 'Died Today' }, when: 'A player was executed today', fields: { i0: 'note', i1: 'tell' } },
  monk:         { wake: 'choice', pick: ['notSelf'], reminders: { i0: 'Safe' }, fields: { i0: 'pick' } },
  ravenkeeper:  { wake: 'choice', dead: true, when: 'The Ravenkeeper died tonight', fields: { i0: 'pick', i1: 'tell' } },
  grandmother:  { wake: 'info', reminders: { i0: 'Grandchild' }, fields: { i0: 'tell', i1: 'tell' }, other: { wake: 'none', when: 'The grandchild was killed by the Demon', fields: { i0: 'note', i1: 'note' } } },
  sailor:       { wake: 'choice', pick: ['alive'], fields: { i0: 'pick' } }, // you decide whether the Sailor or the target is drunk
  chambermaid:  { wake: 'choice', pick: ['alive', 'notSelf', 'distinct'], fields: { i0: 'pick', i1: 'pick', i2: 'tell' } },
  exorcist:     { wake: 'choice', pick: ['notLastNight'], reminders: { i0: 'Chosen' }, fields: { i0: 'pick' }, notify: [{ to: 'demon', if: 'i0:demon', tokens: ['selected', 'self', 'holder'] }] },
  innkeeper:    { wake: 'choice', pick: ['distinct'], reminders: { i0: 'Safe', i1: 'Safe' }, fields: { i0: 'pick', i1: 'pick' } },
  gambler:      { wake: 'choice', fields: { i0: 'pick', i1: 'pick' } },
  courtier:     { wake: 'ability', once: true, fields: { i0: 'pick' } },
  professor:    { wake: 'ability', pick: ['dead'], once: true, fields: { i0: 'pick' } },
  clockmaker:   { wake: 'info', fields: { i0: 'tell' } },
  dreamer:      { wake: 'choice', pick: ['notSelf', 'notTraveller'], fields: { i0: 'pick', i1: 'tell', i2: 'tell' } },
  snakecharmer: { wake: 'choice', pick: ['alive'], fields: { i0: 'pick' }, notify: [
    { to: 'holder', if: 'i0:demon', tokens: ['you', 'i0.role', 'evil'] },
    { to: 'i0', if: 'i0:demon', tokens: ['you', 'self', 'good'] },
  ] },
  mathematician:{ wake: 'info', fields: { i0: 'tell' } },
  flowergirl:   { wake: 'info', fields: { i0: 'tell' } },
  towncrier:    { wake: 'info', fields: { i0: 'tell' } },
  oracle:       { wake: 'info', fields: { i0: 'tell' } },
  seamstress:   { wake: 'ability', pick: ['notSelf', 'distinct'], once: true, fields: { i0: 'pick', i1: 'pick', i2: 'tell' } },
  philosopher:  { wake: 'ability', once: true, fields: { i0: 'pick' }, grants: { from: 'i0' } },
  juggler:      { wake: 'info', when: 'The night after they juggled', fields: { i0: 'note', i1: 'tell' } },
  sage:         { wake: 'info', dead: true, shuffle: ['i0', 'i1'], when: 'The Demon killed the Sage', fields: { i0: 'tell', i1: 'tell' } },
  noble:        { wake: 'info', reminders: { i0: 'Know', i1: 'Know', i2: 'Know' }, fields: { i0: 'tell', i1: 'tell', i2: 'tell' } },
  knight:       { wake: 'info', reminders: { i0: 'Know', i1: 'Know' }, fields: { i0: 'tell', i1: 'tell' } },
  steward:      { wake: 'info', reminders: { i0: 'Know' }, fields: { i0: 'tell' } },
  shugenja:     { wake: 'info', fields: { i0: 'tell' } },
  balloonist:   { wake: 'info', reminders: { i0: 'Know' }, fields: { i0: 'tell' } },
  bountyhunter: { wake: 'info', reminders: { i0: 'Know' }, fields: { i0: 'tell' }, other: { when: 'The player marked KNOW died today or tonight' } },
  nightwatchman:{ wake: 'ability', once: true, fields: { i0: 'pick' }, notify: [{ to: 'i0', tokens: ['claim', 'self', 'holder'] }] },
  villageidiot: { wake: 'choice', fields: { i0: 'pick', i1: 'tell' } },
  highpriestess:{ wake: 'info', fields: { i0: 'tell' } },
  general:      { wake: 'info', fields: { i0: 'tell' } },
  king:         { wake: 'none', notify: [{ to: 'demon', tokens: ['claim', 'self', 'holder'] }],
                  other: { wake: 'info', when: 'The dead equal or outnumber the living', fields: { i0: 'note', i1: 'tell' }, notify: [] } },
  choirboy:     { wake: 'info', when: 'The Demon killed the King', fields: { i0: 'tell' } },
  preacher:     { wake: 'choice', fields: { i0: 'pick' }, notify: [{ to: 'i0', if: 'i0:minion', tokens: ['selected', 'self'] }] },
  cultleader:   { wake: 'info' },
  pixie:        { wake: 'info', fields: { i0: 'tell' } },
  huntsman:     { wake: 'ability', pick: ['alive'], once: true, fields: { i0: 'pick' }, notify: [{ to: 'i0', if: 'i0:damsel', tokens: ['you', 'recipientRole'] }] },
  alchemist:    { wake: 'info', fields: { i0: 'tell' }, tell: ['you', 'i0'], grants: { from: 'i0' } },
  farmer:       { wake: 'none', dead: true, when: 'The Farmer died tonight', fields: { i0: 'note' }, notify: [{ to: 'i0', tokens: ['you', 'self'] }] },
  poppygrower:  { wake: 'none', notify: [{ to: 'demon', tokens: ['bluffs', 'bluffRoles'] }],
                  other: { when: 'The Poppy Grower died today or tonight', notify: [
                    { to: 'minions', tokens: ['demon', 'demonPlayers'] },
                    { to: 'demon', tokens: ['minions', 'minionPlayers'] },
                  ] } },
  banshee:      { wake: 'none', dead: true, when: 'The Banshee was killed by the Demon tonight' },
  angel:        { wake: 'none' },
  tor:          { wake: 'none' },
  buddhist:     { wake: 'none' },
  toymaker:     { wake: 'none' },
  stormcatcher: { wake: 'none' },
  amnesiac:     { wake: 'info', fields: { i0: 'note' } },
  engineer:     { wake: 'ability', once: true, fields: { i0: 'pick' } },
  bonecollector:{ wake: 'ability', pick: ['dead'], once: true, fields: { i0: 'pick' } },
  apprentice:   { wake: 'info', fields: { i0: 'tell' }, tell: ['you', 'i0'], grants: { from: 'i0' } },
  barista:      { wake: 'none', fields: { i0: 'note', i1: 'note' }, optionTokens: { i1: { 'true info': 'one', 'sober/double': 'two' } }, notify: [{ to: 'i0', tokens: ['selected', 'self', 'i1'] }] },
  bureaucrat:   { wake: 'choice', pick: ['notSelf'], reminders: { i0: '3 Votes' }, fields: { i0: 'pick' } },
  thief:        { wake: 'choice', pick: ['notSelf'], reminders: { i0: 'Negative Vote' }, fields: { i0: 'pick' } },
  boffin:       { wake: 'info', fields: { i0: 'tell' }, tell: ['selected', 'self', 'i0'], notify: [{ to: 'demon', tokens: ['selected', 'self', 'i0'] }], grants: { from: 'i0', to: 'demon' } },
  harlot:       { wake: 'choice', pick: ['alive'], fields: { i0: 'pick', i1: 'note', i2: 'tell' }, notify: [{ to: 'i0', tokens: ['selected', 'self'] }] },
  acrobat:      { wake: 'choice', reminders: { i0: 'Chosen' }, fields: { i0: 'pick' } },
  lycanthrope:  { wake: 'choice', pick: ['alive'], fields: { i0: 'pick' } },
  duchess:      { wake: 'none' },

  // ── Outsiders ──
  butler:       { wake: 'choice', pick: ['notSelf'], reminders: { i0: 'Master' }, fields: { i0: 'pick' } },
  lunatic:      { wake: 'info', notify: [{ to: 'demon', tokens: ['claim', 'role:lunatic', 'holder'] }],
                  other: { wake: 'choice', fields: { i0: 'pick' }, notify: [{ to: 'demon', tokens: ['role:lunatic', 'holder', 'i0'] }] } },
  tinker:       { wake: 'none' },
  moonchild:    { wake: 'none', dead: true, when: 'The Moonchild is due to kill a good player' },
  sweetheart:   { wake: 'none', dead: true, when: 'The Sweetheart died' },
  cannibal:     { confirm: true, fields: { i0: 'note', i1: 'note' }, grants: { from: 'i1' } }, // not woken: whose ability they have, shown to confirm above the order
  plaguedoctor: { wake: 'none', dead: true, when: 'The Plague Doctor died', fields: { i0: 'note' }, grants: { from: 'i0', to: 'storyteller' } },
  hatter:       { wake: 'none', dead: true, when: 'The Hatter died today or tonight' },
  damsel:       { wake: 'none', notify: [{ to: 'minions', tokens: ['role:damsel'] }],
                  other: { when: 'The Damsel was chosen by the Huntsman', notify: [] } },
  barber:       { wake: 'none', dead: true, when: 'The Barber died today or tonight', notify: [{ to: 'demon', tokens: ['selected', 'self'] }] },
  organgrinder: { wake: 'choice', ask: ['custom:Drunk tonight?'] }, // yes = drunk, no = sober

  // ── Minions ──
  poisoner:     { wake: 'choice', reminders: { i0: 'Poisoned' }, fields: { i0: 'pick' } },
  spy:          { wake: 'info', tell: ['grimoire'] },
  widow:        { wake: 'choice', reminders: { i0: 'Poisoned' }, ask: ['grimoire', 'choice'], fields: { i0: 'pick' }, notify: [{ to: 'reminder:Know', tokens: ['self'] }] },
  scarletwoman: { wake: 'info', when: 'The Scarlet Woman became the Demon today', tell: ['you', 'inPlay:demon'] },
  godfather:    { wake: 'info', tell: ['inPlay:outsider'],
                  other: { wake: 'choice', when: 'An Outsider died today', fields: { i0: 'pick' }, reminders: { i0: 'Dead' }, tell: null } },
  devilsadvocate:{ wake: 'choice', pick: ['alive', 'notLastNight'], reminders: { i0: 'Survives Execution' }, fields: { i0: 'pick' } },
  assassin:     { wake: 'ability', reminders: { i0: 'Dead' }, once: true, fields: { i0: 'pick' } },
  witch:        { wake: 'choice', reminders: { i0: 'Cursed' }, fields: { i0: 'pick' } },
  cerenovus:    { wake: 'choice', reminders: { i0: 'Mad' }, fields: { i0: 'pick', i1: 'pick' }, notify: [{ to: 'i0', tokens: ['selected', 'self', 'i1'] }] },
  pithag:       { wake: 'choice', fields: { i0: 'pick', i1: 'pick' }, notify: [{ to: 'i0', if: 'i1:notInPlay', tokens: ['you', 'i1'] }] },
  fearmonger:   { wake: 'choice', reminders: { i0: 'Fear' }, fields: { i0: 'pick' } },
  harpy:        { wake: 'choice', pick: ['distinct'], reminders: { i0: 'Mad', i1: '2nd' }, fields: { i0: 'pick', i1: 'pick' }, notify: [{ to: 'i0', tokens: ['selected', 'self', 'i1'] }] },
  mezepheles:   { wake: 'info', fields: { i0: 'tell' }, other: { wake: 'none', when: 'A good player said the secret word', fields: { i0: 'note' } } },
  marionette:   { wake: 'none', notify: [{ to: 'demon', tokens: ['claim', 'self', 'holder'] }] },
  eviltwin:     { wake: 'info', reminders: { i0: 'Twin' }, fields: { i0: 'tell' }, tell: ['i0', 'i0.role'], notify: [{ to: 'i0', tokens: ['holder', 'self'] }] },
  vizier:       { wake: 'none' },
  wizard:       { wake: 'info', fields: { i0: 'note' } },
  xaan:         { wake: 'none' },
  summoner:     { wake: 'info', tell: ['bluffs', 'bluffRoles'],
                  other: { wake: 'choice', when: 'It is night 3', fields: { i0: 'pick' }, tell: null, notify: [{ to: 'i0', tokens: ['you', 'recipientRole', 'evil'] }] } },

  // ── Demons ──
  imp:          { wake: 'choice', reminders: { i0: 'Dead' }, fields: { i0: 'pick' } },
  zombuul:      { wake: 'choice', reminders: { i0: 'Dead' }, when: 'No one died today', fields: { i0: 'pick' } },
  pukka:        { wake: 'choice', fields: { i0: 'pick' } },
  shabaloth:    { wake: 'choice', pick: ['distinct'], fields: { i0: 'pick', i1: 'pick' } },
  po:           { wake: 'ability', reminders: { i0: 'Dead' }, fields: { i0: 'pick' } },
  fanggu:       { wake: 'choice', reminders: { i0: 'Dead' }, fields: { i0: 'pick' }, notify: [{ to: 'i0', if: ['i0:outsider', 'noReminder:Once'], tokens: ['you', 'self', 'evil'] }] },
  nodashii:     { wake: 'choice', reminders: { i0: 'Dead' }, fields: { i0: 'pick' } },
  vortox:       { wake: 'choice', reminders: { i0: 'Dead' }, fields: { i0: 'pick' } },
  vigormortis:  { wake: 'choice', reminders: { i0: 'Dead' }, fields: { i0: 'pick' } },
  ojo:          { wake: 'choice', fields: { i0: 'pick' } },
  alhadikhia:   { wake: 'ability', pick: ['distinct'], reminders: { i0: '1', i1: '2', i2: '3' }, fields: { i0: 'pick', i1: 'pick', i2: 'pick' } },
  lleech:       { wake: 'choice', pick: ['alive'], reminders: { i0: 'Poisoned' }, fields: { i0: 'pick' }, other: { fields: { i0: 'note', i1: 'pick' }, reminders: { i1: 'Dead' }, pick: [] } },
  lilmonsta:    { wake: 'none' },
  legion:       { wake: 'none' },
  leviathan:    { wake: 'none' },
  gossip:       { wake: 'none' },
  yaggababble:  { wake: 'info', fields: { i0: 'tell' }, other: { wake: 'none', fields: { i0: 'note' } } },
  kazali:       { wake: 'info', notify: [{ to: 'minions', tokens: ['you', 'recipientRole', 'evil'] }], other: { wake: 'choice', reminders: { i0: 'Dead' }, fields: { i0: 'pick' }, notify: [] } },
  lordoftyphon: { wake: 'none', notify: [{ to: 'neighbours', tokens: ['you', 'recipientRole', 'evil'] }], other: { wake: 'choice', reminders: { i0: 'Dead' }, fields: { i0: 'pick' }, notify: [] } },
  wraith:       { wake: 'none' },
  magician:     { wake: 'none' },
  snitch:       { wake: 'none', notify: [{ to: 'minions', tokens: ['bluffs'] }] },
  ogre:         { wake: 'choice', pick: ['notSelf'], reminders: { i0: 'Friend' }, fields: { i0: 'pick', i1: 'note' } },
};

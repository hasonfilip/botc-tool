// Per-character difficulty facts, used to estimate how hard a script is to
// PLAY in the script library (see scriptComplexity in companion.js).
// First-pass ratings checked against the official wiki character pages —
// edit freely, the notes say why each character got its numbers.
//
//   id: [worlds, depth, chaos, presence, 'flags']   each 0–3
//   worlds    extra hypotheses good must consider while it's on the script
//   depth     strategy needed to play it, or play around it, well
//   chaos     unpredictability, incl. how much hangs on Storyteller choices
//   presence  how much its mere possibility changes play, in play or not
//   flags     S setup modifier · D drunk/poison · F false info · R registers
//             as something else · C changes character/alignment · U holder
//             unsure of own character/alignment/info · M madness or public
//             statements
//
// The script score currently uses depth, chaos and presence. Worlds and the
// flags are recorded too, but weighting them didn't improve the fit against
// TPI's published Player Complexity scores, so they're informational for now.
//
// Only Townsfolk/Outsiders/Minions/Demons are rated — Travellers, Fabled and
// Loric don't count toward a script's rating.
const ROLE_COMPLEXITY = {
  // ── Trouble Brewing / Bad Moon Rising / Sects & Violets ──
  washerwoman: [0, 0, 0, 0, ''], // Simple first-night info; wiki tips centre on just sharing it.
  librarian: [0, 0, 0, 0, ''], // First-night outsider info, also confirms 0-outsider games; straightforward.
  investigator: [0, 1, 0, 0, ''], // Wiki: Recluse can register as Minion and the non-Minion pick isn't necessarily good.
  chef: [0, 1, 0, 0, ''], // Wiki: pair count; Spy may not register evil and Recluse may register evil.
  empath: [0, 1, 0, 0, ''], // Wiki: nightly neighbour count; Spy/Recluse registration and evil 0-claims are the main pitfalls.
  fortuneteller: [1, 1, 1, 0, 'R'], // Wiki: red herring is a good player that registers as a Demon; star-pass/Scarlet Woman can make old 'no' reads stale.
  undertaker: [0, 0, 0, 0, ''], // Confirms executed characters; low complexity.
  monk: [0, 1, 0, 0, ''], // Wiki tips: protect players likely to be targeted, conceal who you protect.
  ravenkeeper: [0, 1, 0, 0, ''], // Wiki: info only on night death; Spy/Recluse can mis-register; popular evil bluff.
  virgin: [0, 1, 0, 1, ''], // Nomination order matters; a Virgin proc confirms a Townsfolk, which shapes who nominates first.
  slayer: [0, 1, 0, 1, ''], // Wiki: public one-shot, Recluse may register as Demon; late-game use is more effective.
  soldier: [0, 0, 0, 0, ''], // Passive protection; little to think about.
  mayor: [1, 2, 1, 1, ''], // Bounced kills (ST choice) and the final-3 no-execution win need coordination.
  butler: [0, 1, 0, 0, ''], // Vote restriction; mostly a bluff-checking issue.
  drunk: [2, 1, 2, 2, 'DU'], // Wiki: thinks they are a Townsfolk; ST decides whether their info is false or occasionally true, so any Townsfolk claim may be the Drunk.
  recluse: [1, 1, 2, 1, 'FR'], // Wiki: ST chooses registration per ability, can vary over the game, even when dead.
  saint: [0, 1, 0, 1, ''], // Execution means a loss, so the town gets careful about executing Outsiders.
  poisoner: [2, 2, 2, 2, 'D'], // Wiki: ST may give poisoned players false info; tips: target multi-night info roles and vary targets.
  spy: [2, 3, 2, 2, 'FR'], // Wiki: sees the Grimoire; ST chooses its registration each time it is detected; can even trigger Virgin.
  scarletwoman: [1, 1, 0, 1, 'C'], // Becomes the Demon if the Demon dies with 5+ alive, so executing the Demon may not end the game.
  baron: [1, 1, 0, 1, 'S'], // +2 Outsiders changes the setup math; outsider count becomes evidence.
  imp: [1, 2, 1, 1, 'C'], // Star-pass turns a Minion into the Imp, so a 'dead Demon' world has to be considered.
  grandmother: [0, 1, 0, 0, ''], // Learns a good player; their death by the Demon kills the Grandmother.
  sailor: [1, 1, 2, 1, 'D'], // Wiki: ST decides whether Sailor or target is drunk ('ST discretion is critical'); sober Sailor survives execution.
  chambermaid: [0, 1, 0, 0, ''], // Counts wakers; needs knowledge of night order.
  exorcist: [0, 1, 0, 0, ''], // Finding the Demon by choice; low complexity.
  innkeeper: [1, 1, 1, 1, 'D'], // Protects two, one drunk; irregular deaths and droison add uncertainty.
  gambler: [0, 1, 1, 0, ''], // Risky guess; mostly self-inflicted chaos.
  gossip: [1, 2, 2, 1, 'M'], // Wiki: true public statements kill a player of the ST's choosing; tips suggest testing hypotheses with deliberate statements.
  courtier: [1, 2, 0, 1, 'D'], // 3-day drunkness on a character; timing and choice of target matter.
  professor: [0, 1, 0, 1, ''], // Resurrection makes the Demon wary of killing confirmed Townsfolk.
  minstrel: [1, 1, 0, 1, 'D'], // Minion execution makes everyone drunk for a day, so Minions avoid exposure.
  tealady: [1, 1, 0, 1, ''], // Wiki: protected executees survive unexplained, and Devil's Advocate/Pacifist create ambiguity about whether it fired.
  pacifist: [1, 0, 2, 1, ''], // ST decides whether executed good players survive, so executions become unreliable.
  fool: [1, 0, 0, 0, ''], // Wiki: survives first death unexplained; good players often bluff Fool, adding another 'why did they live' explanation.
  goon: [2, 2, 1, 1, 'DC'], // Drunks the chooser and swaps alignment to match, so good players may turn evil.
  lunatic: [2, 1, 2, 2, 'FU'], // Thinks they're the Demon; wiki: the real Demon learns their choices and ST picks their info.
  tinker: [1, 0, 3, 1, ''], // Can die at any time at ST discretion, adding unexplained-death worlds.
  moonchild: [0, 1, 0, 1, ''], // Death retaliation makes executing a claimed Moonchild costly.
  godfather: [1, 2, 0, 2, 'S'], // ±1 Outsider and extra kill after Outsider deaths; Outsider counts become key evidence.
  devilsadvocate: [1, 2, 0, 1, ''], // Protected executees survive, muddying who is good.
  assassin: [1, 1, 0, 1, ''], // One kill that ignores protection; breaks protection-based deductions.
  mastermind: [2, 2, 0, 1, ''], // Wiki: players don't learn the Demon died, so 'Demon executed but game continues' must be considered.
  zombuul: [2, 3, 1, 2, 'FR'], // Registers as dead after surviving death; 'no kills' nights are themselves information.
  pukka: [2, 2, 1, 2, 'D'], // Poisons then kills a night later, so deaths and poisoning are offset.
  shabaloth: [2, 2, 2, 2, ''], // Wiki: most dangerous BMR Demon; ST-discretion regurgitation; town should execute daily at 4-5 alive.
  po: [1, 2, 1, 1, ''], // Skipping a kill charges three kills, making zero-death nights ominous.
  clockmaker: [0, 1, 0, 0, ''], // Single distance number; simple.
  dreamer: [1, 1, 0, 0, ''], // One-good-one-evil pair adds a two-way hypothesis each night.
  snakecharmer: [2, 2, 1, 2, 'DC'], // Swaps with the Demon; the old Demon becomes a poisoned good player.
  mathematician: [0, 1, 0, 0, ''], // Reports malfunction count, which actually helps rule worlds out.
  flowergirl: [0, 1, 0, 1, ''], // Demon-vote info; the Demon learns to hide voting.
  towncrier: [0, 1, 0, 1, ''], // Minion-nominated info; Minions learn to avoid nominating.
  oracle: [0, 1, 0, 0, ''], // Counts evil dead; moderate.
  savant: [1, 2, 1, 0, 'M'], // Daily one-true-one-false pair; wiki tips on cross-checking with others.
  seamstress: [0, 1, 0, 0, ''], // One alignment check; simple.
  philosopher: [2, 2, 1, 1, 'DC'], // Becomes any good character and drunks the original, creating duplicate claims.
  artist: [0, 2, 1, 0, ''], // Wiki: honest yes/no answer; question phrasing is the skill, and it can be used to test for Vortox.
  juggler: [0, 2, 0, 0, 'M'], // Public guesses on day one; info depends on making smart guesses.
  sage: [0, 0, 0, 0, ''], // Learns two players on death; simple.
  mutant: [1, 1, 2, 1, 'M'], // Wiki: 'always up to the Storyteller' to judge madness, and execution can happen at any time.
  sweetheart: [1, 0, 2, 1, 'D'], // Wiki: ST picks which player is drunk for the rest of the game when Sweetheart dies.
  barber: [2, 1, 2, 2, 'C'], // Demon swaps two players' characters, making earlier claims stale.
  klutz: [0, 1, 0, 1, 'M'], // Wiki: public mandatory choice on death, and unaffected by drunk/poison, so outcome is player-driven.
  eviltwin: [2, 3, 0, 2, ''], // Good can't win while the twin lives; mirrored claims are hard to untangle.
  witch: [1, 2, 0, 1, ''], // Cursed player dies if they nominate, warping nominations.
  cerenovus: [2, 2, 2, 2, 'M'], // Madness demands may cause executions; players' claims become unreliable.
  pithag: [3, 3, 3, 3, 'C'], // Wiki: changes characters (not alignment) nightly; a new Demon makes deaths arbitrary; good Demons/evil Townsfolk possible.
  fanggu: [2, 2, 1, 3, 'SC'], // +1 Outsider and jump-to-Outsider makes Outsiders hide.
  vigormortis: [2, 2, 1, 2, 'SD'], // -1 Outsider; killed Minions keep abilities and poison a neighbour.
  nodashii: [2, 2, 0, 2, 'D'], // Poisons nearest Townsfolk neighbours, so seating is key to solving.
  vortox: [3, 3, 1, 3, 'F'], // Wiki: all Townsfolk info false and evil wins on a no-execution day; tips: reverse all info once Vortox is identified.

  // ── Experimental ──
  steward: [0, 0, 0, 0, ''], // Single first-night ping of a good player; simple, minimal effect on solving.
  knight: [0, 0, 0, 0, ''], // First-night learn 2 non-Demons; straightforward info.
  noble: [1, 1, 0, 0, ''], // Learns 3 players, 1 evil; mild triangulation puzzle.
  shugenja: [0, 1, 0, 0, ''], // Wiki: direction to nearest evil; on ties info is arbitrary and the Shugenja never knows.
  pixie: [1, 2, 1, 1, 'UM'], // Wiki: ST alone judges whether the Pixie was mad enough, and Pixie gets no notice when they gain the ability.
  bountyhunter: [2, 1, 1, 2, 'S'], // Wiki: 1 Townsfolk is secretly evil with a free bluff and incentive to lie; drunk BH may be shown a good player.
  highpriestess: [0, 1, 1, 0, ''], // ST picks who you should talk to; vague, ST-discretion info.
  balloonist: [1, 1, 0, 1, 'S'], // Adds +0/+1 Outsider and cross-type info; ambiguity on character-type reads.
  general: [0, 1, 1, 0, ''], // ST judgment of who is winning; subjective info.
  preacher: [0, 1, 0, 1, ''], // Strips Minion abilities; Minions learn it, so mid-game ability loss must be considered.
  villageidiot: [2, 2, 1, 1, 'SDU'], // Wiki: +0-2 extra Village Idiots, one drunk (ST may still give it true info); conflicting alignment reads to untangle.
  king: [0, 1, 0, 1, ''], // Demon knows the King; King learns alive characters late; outing risk shapes play.
  cultleader: [1, 3, 1, 2, 'CM'], // Alignment follows neighbours; cult calls need public persuasion and can end the game.
  acrobat: [1, 1, 0, 1, ''], // Dies if chosen player is droisoned; death becomes a droison signal to interpret.
  lycanthrope: [1, 1, 1, 1, 'R'], // Wiki: faux paw good player registers evil; poisoned Lycanthrope looks like hitting evil, and evil can blame kills on it.
  alsaahir: [0, 2, 0, 1, 'M'], // Public guess of all Minions/Demons wins; forces evil to hide and good to commit to worlds.
  engineer: [2, 2, 1, 2, 'C'], // Wiki: once per game chooses which Minions/Demon are in play; evil keep alignment but characters change, early info goes stale.
  nightwatchman: [0, 1, 0, 0, ''], // Confirms self to one player; simple trust-building.
  huntsman: [1, 1, 0, 1, 'SC'], // Wiki: adds the Damsel at setup; one night guess turns the Damsel into a not-in-play Townsfolk.
  fisherman: [0, 0, 1, 0, ''], // One-time ST advice; ST-dependent but low complexity.
  princess: [0, 1, 0, 1, ''], // Day-1 execution of a nominee blocks a Demon kill; nudges early executions.
  alchemist: [1, 1, 1, 1, ''], // Wiki: good player with a Minion ability (ST may prompt different choices); can add setup/poison effects depending on the Minion.
  cannibal: [1, 2, 1, 1, 'DU'], // Wiki: not told which ability they gained; poisoned with fake ability after an evil executee.
  amnesiac: [2, 2, 3, 1, 'U'], // ST invents the ability; holder doesn't know it, guessing game with heavy ST discretion.
  farmer: [0, 0, 0, 0, 'C'], // On death a good player becomes Farmer; near-trivial impact.
  choirboy: [0, 1, 0, 1, 'S'], // Wiki: adds the King at setup; learns Demon only if Demon's own kill hits the King.
  banshee: [0, 1, 0, 1, 'M'], // If killed by Demon, publicly announced and gains double nominations/votes.
  magician: [1, 1, 1, 1, ''], // Demon and Minions get confused info about who is evil; hurts evil coordination.
  poppygrower: [1, 1, 0, 2, ''], // Evil don't learn each other while alive; changes evil bluff coordination and adds disjointed-evil world.
  atheist: [3, 2, 2, 3, 'SF'], // Wiki: no evil characters in setup and ST may break rules to fake evil; every game must consider the no-evil world (or the Drunk-thinks-Atheist world).
  hermit: [2, 2, 2, 1, 'SDFR'], // Has all Outsider abilities at once, -0/-1 Outsider; flags are script-dependent (depend on which Outsiders are on the script).
  ogre: [1, 2, 0, 1, 'U'], // Mirrors chosen player's alignment without knowing it; Ogres often lie about choice/role.
  golem: [0, 1, 1, 1, ''], // One nomination kills non-Demon nominee; nominating discipline matters.
  plaguedoctor: [1, 1, 2, 1, ''], // If dies, ST gains a Minion ability — ST discretion injects new effects.
  hatter: [2, 2, 2, 2, 'C'], // On death, Minions/Demon may change characters; early info goes stale.
  politician: [0, 2, 1, 1, 'C'], // Wiki: ST judges who was most responsible for the loss; drunk/poisoned Politician can't switch.
  zealot: [0, 0, 0, 0, ''], // Must vote for all nominations with 5+ alive; simple restriction.
  damsel: [1, 2, 0, 2, 'C'], // Minions know a Damsel; a correct guess loses the game, forcing Damsel to hide and good to protect.
  snitch: [0, 0, 0, 1, ''], // Gives Minions 3 extra bluffs; minor but strengthens evil bluffs.
  heretic: [2, 3, 1, 3, 'F'], // Wiki: win flips even if dead; reveal late because the Demon may kill itself if evil learns of the Heretic.
  puzzlemaster: [2, 2, 1, 1, 'DUM'], // One player is drunk all game; public guess to find them — puzzle by design.
  mezepheles: [1, 2, 1, 2, 'CM'], // Secret word turns a good player evil; everyone avoids saying words, alignment changes silently.
  harpy: [1, 2, 2, 2, 'M'], // Makes a player mad that another is evil, with deaths for breaking madness; forces public accusations.
  fearmonger: [0, 1, 0, 2, ''], // Executing the chosen player loses the game; publicly announced choice pressures nominations.
  psychopath: [0, 1, 1, 1, 'M'], // Day kills and roshambo on execution; public, obvious, somewhat swingy.
  wizard: [3, 2, 3, 2, 'DFC'], // Wiki: one wish, ST sets price/clue and may e.g. make all good drunk; nearly anything can happen, maximal ST discretion.
  widow: [1, 1, 1, 2, 'D'], // Wiki: sees Grimoire, poison lasts until Widow dies; 1 good player learns Widow in play (unless Widow poisons self), sparking a hunt.
  xaan: [2, 2, 1, 2, 'SDU'], // Wiki: on night X (X = Outsiders in play) all Townsfolk poisoned until dusk; Outsider count tells which night's info is false.
  marionette: [2, 2, 1, 2, 'SFU'], // Wiki: Townsfolk token replaces it, sits next to Demon, treated as drunk so gets false info and thinks they're good.
  wraith: [1, 2, 0, 1, ''], // Can watch the night; good may find evil via who reacts, otherwise mainly helps evil coordination.
  summoner: [2, 2, 1, 2, 'SC'], // Wiki: no Demon at setup, Summoner gets 3 bluffs and creates a Demon of its choice on night 3; good wins if it fails.
  goblin: [0, 1, 0, 2, 'M'], // Wiki: must publicly claim when nominated; anyone may claim Goblin, chilling executions of claimants.
  boomdandy: [0, 1, 1, 1, 'M'], // Executing it triggers a public 10-second finger-point; dramatic but simple.
  vizier: [0, 1, 0, 1, ''], // Publicly known; can force executions; good must coordinate votes around it.
  organgrinder: [1, 2, 1, 2, 'D'], // Wiki: votes are eyes-closed with a secret tally, removing vote-tracking info; can choose to be drunk.
  boffin: [2, 2, 1, 2, ''], // Demon gains a not-in-play good ability (may lack the knowledge); evil has an unknown extra power.
  yaggababble: [1, 2, 3, 3, 'M'], // Secret phrase: kills per public utterance, ST picks who dies; everyone watches repeated phrases.
  lilmonsta: [2, 2, 2, 2, 'SRC'], // Wiki: +1 Minion, babysitter 'is the Demon' and registers as Demon (can rotate nightly), ST picks the nightly death.
  ojo: [1, 2, 2, 2, ''], // Wiki: names a character; if not in play ST picks the victim (can be multiple), so quiet power roles die and kill patterns mislead.
  kazali: [3, 2, 2, 2, 'SC'], // Wiki: Demon picks which players become which Minions (they get their old character as a bluff), Outsider count -? to +?.
  legion: [3, 3, 2, 3, 'SFR'], // Wiki: most players are Legion and register as Minion too; executions fail if only evil voted; ST picks deaths.
  lordoftyphon: [3, 3, 1, 3, 'S'], // Evil in a line with Demon in middle, +1 Minion, any Outsider count; seating logic dominates.
  lleech: [2, 2, 1, 2, 'D'], // Wiki: host poisoned all game and Lleech can't die while host lives; host gets plausible false info.
  alhadikhia: [2, 2, 2, 2, 'M'], // Wiki: 3 publicly named players silently choose live/die, all die if all live; can resurrect dead Minions.
  riot: [2, 3, 2, 3, 'C'], // Wiki: on day 3 Minions become Riot and nominees die and must nominate immediately; endgame math entirely different.
  leviathan: [1, 2, 1, 2, ''], // Wiki: publicly known, evil wins after day 5 or on 2nd good execution; no night kills so info characters survive.
};

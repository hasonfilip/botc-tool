const BOTC_ROLES = [
  {
    "id": "steward",
    "name": "Steward",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You start knowing 1 good player.",
    "reminders": [
      "Know"
    ],
    "iconPath": "data/icons/carousel/steward_g.webp"
  },
  {
    "id": "knight",
    "name": "Knight",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You start knowing 2 players that are not the Demon.",
    "reminders": [
      "Know",
      "Know"
    ],
    "iconPath": "data/icons/carousel/knight_g.webp"
  },
  {
    "id": "chef",
    "name": "Chef",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "You start knowing how many pairs of evil players there are.",
    "reminders": [],
    "iconPath": "data/icons/tb/chef_g.webp"
  },
  {
    "id": "noble",
    "name": "Noble",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You start knowing 3 players, 1 and only 1 of which is evil.",
    "reminders": [
      "Know",
      "Know",
      "Know"
    ],
    "iconPath": "data/icons/carousel/noble_g.webp"
  },
  {
    "id": "investigator",
    "name": "Investigator",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "You start knowing that 1 of 2 players is a particular Minion.",
    "reminders": [
      "Minion",
      "Wrong"
    ],
    "iconPath": "data/icons/tb/investigator_g.webp"
  },
  {
    "id": "washerwoman",
    "name": "Washerwoman",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "You start knowing that 1 of 2 players is a particular Townsfolk.",
    "reminders": [
      "Townsfolk",
      "Wrong"
    ],
    "iconPath": "data/icons/tb/washerwoman_g.webp"
  },
  {
    "id": "clockmaker",
    "name": "Clockmaker",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "You start knowing how many steps from the Demon to its nearest Minion.",
    "reminders": [],
    "iconPath": "data/icons/snv/clockmaker_g.webp"
  },
  {
    "id": "grandmother",
    "name": "Grandmother",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "You start knowing a good player & their character. If the Demon kills them, you die too.",
    "reminders": [
      "Grandchild",
      "Dead"
    ],
    "iconPath": "data/icons/bmr/grandmother_g.webp"
  },
  {
    "id": "librarian",
    "name": "Librarian",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)",
    "reminders": [
      "Outsider",
      "Wrong"
    ],
    "iconPath": "data/icons/tb/librarian_g.webp"
  },
  {
    "id": "shugenja",
    "name": "Shugenja",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You start knowing if your closest evil player is clockwise or anti-clockwise. If equidistant, this info is arbitrary.",
    "reminders": [],
    "iconPath": "data/icons/carousel/shugenja_g.webp"
  },
  {
    "id": "pixie",
    "name": "Pixie",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You start knowing 1 in-play Townsfolk. If you were mad that you were this character, you gain their ability when they die.",
    "reminders": [
      "Mad",
      "Has Ability"
    ],
    "iconPath": "data/icons/carousel/pixie_g.webp"
  },
  {
    "id": "bountyhunter",
    "name": "Bounty Hunter",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You start knowing 1 evil player. If the player you know dies, you learn another evil player tonight. [1 Townsfolk is evil]",
    "reminders": [
      "Know"
    ],
    "iconPath": "data/icons/carousel/bountyhunter_g.webp"
  },
  {
    "id": "empath",
    "name": "Empath",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "Each night, you learn how many of your 2 alive neighbors are evil.",
    "reminders": [],
    "iconPath": "data/icons/tb/empath_g.webp"
  },
  {
    "id": "highpriestess",
    "name": "High Priestess",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night, learn which player the Storyteller believes you should talk to most.",
    "reminders": [],
    "iconPath": "data/icons/carousel/highpriestess_g.webp"
  },
  {
    "id": "sailor",
    "name": "Sailor",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Each night, choose an alive player: either you or they are drunk until dusk. You can't die.",
    "reminders": [
      "Drunk"
    ],
    "iconPath": "data/icons/bmr/sailor_g.webp"
  },
  {
    "id": "balloonist",
    "name": "Balloonist",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night, you learn a player of a different character type than last night. [+0 or +1 Outsider]",
    "reminders": [
      "Know"
    ],
    "iconPath": "data/icons/carousel/balloonist_g.webp"
  },
  {
    "id": "general",
    "name": "General",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night, you learn which alignment the Storyteller believes is winning: good, evil, or neither.",
    "reminders": [],
    "iconPath": "data/icons/carousel/general_g.webp"
  },
  {
    "id": "preacher",
    "name": "Preacher",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night, choose a player: a Minion, if chosen, learns this. All chosen Minions have no ability.",
    "reminders": [
      "No Ability",
      "No Ability",
      "No Ability"
    ],
    "iconPath": "data/icons/carousel/preacher_g.webp"
  },
  {
    "id": "chambermaid",
    "name": "Chambermaid",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Each night, choose 2 alive players (not yourself): you learn how many woke tonight due to their ability.",
    "reminders": [],
    "iconPath": "data/icons/bmr/chambermaid_g.webp"
  },
  {
    "id": "villageidiot",
    "name": "Village Idiot",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night, choose a player: you learn their alignment. [+0 to +2 Village Idiots. 1 of the extras is drunk]",
    "reminders": [
      "Drunk"
    ],
    "iconPath": "data/icons/carousel/villageidiot_g.webp"
  },
  {
    "id": "snakecharmer",
    "name": "Snake Charmer",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Each night, choose an alive player: a chosen Demon swaps characters & alignments with you & is then poisoned.",
    "reminders": [
      "Poisoned"
    ],
    "iconPath": "data/icons/snv/snakecharmer_g.webp"
  },
  {
    "id": "mathematician",
    "name": "Mathematician",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Each night, you learn how many players\u2019 abilities worked abnormally (since dawn) due to another character's ability.",
    "reminders": [
      "Abnormal",
      "Abnormal",
      "Abnormal",
      "Abnormal",
      "Abnormal"
    ],
    "iconPath": "data/icons/snv/mathematician_g.webp"
  },
  {
    "id": "king",
    "name": "King",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night, if the dead equal or outnumber the living, you learn 1 alive character. The Demon knows you are the King.",
    "reminders": [],
    "iconPath": "data/icons/carousel/king_g.webp"
  },
  {
    "id": "dreamer",
    "name": "Dreamer",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Each night, choose a player (not yourself or Travellers): you learn 1 good & 1 evil character, 1 of which is correct.",
    "reminders": [],
    "iconPath": "data/icons/snv/dreamer_g.webp"
  },
  {
    "id": "fortuneteller",
    "name": "Fortune Teller",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.",
    "reminders": [
      "Red Herring"
    ],
    "iconPath": "data/icons/tb/fortuneteller_g.webp"
  },
  {
    "id": "cultleader",
    "name": "Cult Leader",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night, you become the alignment of an alive neighbor. If all good players choose to join your cult, your team wins.",
    "reminders": [],
    "iconPath": "data/icons/carousel/cultleader_g.webp"
  },
  {
    "id": "flowergirl",
    "name": "Flowergirl",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Each night*, you learn if a Demon voted today.",
    "reminders": [
      "Demon Voted",
      "Demon Not Voted"
    ],
    "iconPath": "data/icons/snv/flowergirl_g.webp"
  },
  {
    "id": "towncrier",
    "name": "Town Crier",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Each night*, you learn if a Minion nominated today.",
    "reminders": [
      "Minions Not Nominated",
      "Minion Nominated"
    ],
    "iconPath": "data/icons/snv/towncrier_g.webp"
  },
  {
    "id": "oracle",
    "name": "Oracle",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Each night*, you learn how many dead players are evil.",
    "reminders": [],
    "iconPath": "data/icons/snv/oracle_g.webp"
  },
  {
    "id": "undertaker",
    "name": "Undertaker",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "Each night*, you learn which character died by execution today.",
    "reminders": [
      "Died Today"
    ],
    "iconPath": "data/icons/tb/undertaker_g.webp"
  },
  {
    "id": "innkeeper",
    "name": "Innkeeper",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Each night*, choose 2 players: they can't die tonight, but 1 is drunk until dusk.",
    "reminders": [
      "Safe",
      "Safe",
      "Drunk"
    ],
    "iconPath": "data/icons/bmr/innkeeper_g.webp"
  },
  {
    "id": "monk",
    "name": "Monk",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "Each night*, choose a player (not yourself): they are safe from the Demon tonight.",
    "reminders": [
      "Safe"
    ],
    "iconPath": "data/icons/tb/monk_g.webp"
  },
  {
    "id": "gambler",
    "name": "Gambler",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Each night*, choose a player & guess their character: if you guess wrong, you die.",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/bmr/gambler_g.webp"
  },
  {
    "id": "acrobat",
    "name": "Acrobat",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night*, choose a player: if they are or become drunk or poisoned tonight, you die.",
    "reminders": [
      "Dead",
      "Chosen"
    ],
    "iconPath": "data/icons/carousel/acrobat_g.webp"
  },
  {
    "id": "exorcist",
    "name": "Exorcist",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Each night*, choose a player (different to last night): the Demon, if chosen, learns who you are then doesn't wake tonight.",
    "reminders": [
      "Chosen"
    ],
    "iconPath": "data/icons/bmr/exorcist_g.webp"
  },
  {
    "id": "lycanthrope",
    "name": "Lycanthrope",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each night*, choose an alive player. If good, they die & the Demon doesn\u2019t kill tonight. One good player registers as evil.",
    "reminders": [
      "Faux Paw",
      "Dead"
    ],
    "iconPath": "data/icons/carousel/lycanthrope_g.webp"
  },
  {
    "id": "gossip",
    "name": "Gossip",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Each day, you may make a public statement. Tonight, if it was true, a player dies.",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/bmr/gossip_g.webp"
  },
  {
    "id": "savant",
    "name": "Savant",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Each day, you may visit the Storyteller to learn 2 things in private: 1 is true & 1 is false.",
    "reminders": [],
    "iconPath": "data/icons/snv/savant_g.webp"
  },
  {
    "id": "alsaahir",
    "name": "Alsaahir",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Each day, if you publicly guess which players are Minion(s) and which are Demon(s), good wins.",
    "reminders": [],
    "iconPath": "data/icons/carousel/alsaahir_g.webp"
  },
  {
    "id": "engineer",
    "name": "Engineer",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Once per game, at night, choose which Minions or which Demon is in play.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/carousel/engineer_g.webp"
  },
  {
    "id": "nightwatchman",
    "name": "Nightwatchman",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Once per game, at night, choose a player: they learn you are the Nightwatchman.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/carousel/nightwatchman_g.webp"
  },
  {
    "id": "courtier",
    "name": "Courtier",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Once per game, at night, choose a character: they are drunk for 3 nights & 3 days.",
    "reminders": [
      "Drunk 3",
      "Drunk 2",
      "Drunk 1",
      "No Ability"
    ],
    "iconPath": "data/icons/bmr/courtier_g.webp"
  },
  {
    "id": "seamstress",
    "name": "Seamstress",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Once per game, at night, choose 2 players (not yourself): you learn if they are the same alignment.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/snv/seamstress_g.webp"
  },
  {
    "id": "philosopher",
    "name": "Philosopher",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Once per game, at night, choose a good character: gain that ability. If this character is in play, they are drunk.",
    "reminders": [
      "Drunk"
    ],
    "iconPath": "data/icons/snv/philosopher_g.webp"
  },
  {
    "id": "huntsman",
    "name": "Huntsman",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Once per game, at night, choose a living player: the Damsel, if chosen, becomes a not-in-play Townsfolk. [+the Damsel]",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/carousel/huntsman_g.webp"
  },
  {
    "id": "professor",
    "name": "Professor",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Once per game, at night*, choose a dead player: if they are a Townsfolk, they are resurrected.",
    "reminders": [
      "Alive",
      "No Ability"
    ],
    "iconPath": "data/icons/bmr/professor_g.webp"
  },
  {
    "id": "artist",
    "name": "Artist",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "Once per game, during the day, privately ask the Storyteller any yes/no question.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/snv/artist_g.webp"
  },
  {
    "id": "slayer",
    "name": "Slayer",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "Once per game, during the day, publicly choose a player: if they are the Demon, they die.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/tb/slayer_g.webp"
  },
  {
    "id": "fisherman",
    "name": "Fisherman",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Once per game, during the day, visit the Storyteller for some advice to help your team win.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/carousel/fisherman_g.webp"
  },
  {
    "id": "princess",
    "name": "Princess",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "On your 1st day, if you nominated & executed a player, the Demon doesn't kill tonight.",
    "reminders": [
      "Doesn't Kill"
    ],
    "iconPath": "data/icons/carousel/princess_g.webp"
  },
  {
    "id": "juggler",
    "name": "Juggler",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "On your 1st day, publicly guess up to 5 players' characters. That night, you learn how many you got correct.",
    "reminders": [
      "Correct",
      "Correct",
      "Correct",
      "Correct",
      "Correct"
    ],
    "iconPath": "data/icons/snv/juggler_g.webp"
  },
  {
    "id": "soldier",
    "name": "Soldier",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "You are safe from the Demon.",
    "reminders": [],
    "iconPath": "data/icons/tb/soldier_g.webp"
  },
  {
    "id": "alchemist",
    "name": "Alchemist",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You have a Minion ability. When using this, the Storyteller may prompt you to choose differently.",
    "reminders": [],
    "iconPath": "data/icons/carousel/alchemist_g.webp"
  },
  {
    "id": "cannibal",
    "name": "Cannibal",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You have the ability of the recently killed executee. If they are evil, you are poisoned until a good player dies by execution.",
    "reminders": [
      "Poisoned",
      "Lunch"
    ],
    "iconPath": "data/icons/carousel/cannibal_g.webp"
  },
  {
    "id": "amnesiac",
    "name": "Amnesiac",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "You do not know what your ability is. Each day, privately guess what it is: you learn how accurate you are.",
    "reminders": [
      "?",
      "?",
      "?"
    ],
    "iconPath": "data/icons/carousel/amnesiac_g.webp"
  },
  {
    "id": "farmer",
    "name": "Farmer",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "When you die at night, an alive good player becomes a Farmer.",
    "reminders": [],
    "iconPath": "data/icons/carousel/farmer_g.webp"
  },
  {
    "id": "minstrel",
    "name": "Minstrel",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "When a Minion dies by execution, all other players (except Travellers) are drunk until dusk tomorrow.",
    "reminders": [
      "Everyone Is Drunk"
    ],
    "iconPath": "data/icons/bmr/minstrel_g.webp"
  },
  {
    "id": "ravenkeeper",
    "name": "Ravenkeeper",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "If you die at night, you are woken to choose a player: you learn their character.",
    "reminders": [],
    "iconPath": "data/icons/tb/ravenkeeper_g.webp"
  },
  {
    "id": "sage",
    "name": "Sage",
    "team": "townsfolk",
    "edition": "snv",
    "ability": "If the Demon kills you, you learn that it is 1 of 2 players.",
    "reminders": [],
    "iconPath": "data/icons/snv/sage_g.webp"
  },
  {
    "id": "choirboy",
    "name": "Choirboy",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "If the Demon kills the King, you learn which player is the Demon. [+the King]",
    "reminders": [],
    "iconPath": "data/icons/carousel/choirboy_g.webp"
  },
  {
    "id": "banshee",
    "name": "Banshee",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "If the Demon kills you, all players learn this. From now on, you may nominate twice per day and vote twice per nomination.",
    "reminders": [
      "Has Ability"
    ],
    "iconPath": "data/icons/carousel/banshee_g.webp"
  },
  {
    "id": "tealady",
    "name": "Tea Lady",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "If both your alive neighbors are good, they can't die.",
    "reminders": [
      "Cannot Die",
      "Cannot Die"
    ],
    "iconPath": "data/icons/bmr/tealady_g.webp"
  },
  {
    "id": "mayor",
    "name": "Mayor",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.",
    "reminders": [],
    "iconPath": "data/icons/tb/mayor_g.webp"
  },
  {
    "id": "fool",
    "name": "Fool",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "The 1st time you die, you don't.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/bmr/fool_g.webp"
  },
  {
    "id": "virgin",
    "name": "Virgin",
    "team": "townsfolk",
    "edition": "tb",
    "ability": "The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/tb/virgin_g.webp"
  },
  {
    "id": "magician",
    "name": "Magician",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "The Demon thinks you are a Minion. Minions think you are a Demon.",
    "reminders": [],
    "iconPath": "data/icons/carousel/magician_g.webp"
  },
  {
    "id": "poppygrower",
    "name": "Poppy Grower",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "Minions & Demons do not know each other. If you die, they learn who each other are that night.",
    "reminders": [
      "Evil Wakes"
    ],
    "iconPath": "data/icons/carousel/poppygrower_g.webp"
  },
  {
    "id": "pacifist",
    "name": "Pacifist",
    "team": "townsfolk",
    "edition": "bmr",
    "ability": "Executed good players might not die.",
    "reminders": [],
    "iconPath": "data/icons/bmr/pacifist_g.webp"
  },
  {
    "id": "atheist",
    "name": "Atheist",
    "team": "townsfolk",
    "edition": "carousel",
    "ability": "The Storyteller can break the game rules, and if executed, good wins, even if you are dead. [No evil characters]",
    "reminders": [],
    "iconPath": "data/icons/carousel/atheist_g.webp"
  },
  {
    "id": "hermit",
    "name": "Hermit",
    "team": "outsider",
    "edition": "carousel",
    "ability": "You have all Outsider abilities. [-0 or -1 Outsider]",
    "reminders": [
      "1",
      "2",
      "3"
    ],
    "iconPath": "data/icons/carousel/hermit_g.webp"
  },
  {
    "id": "butler",
    "name": "Butler",
    "team": "outsider",
    "edition": "tb",
    "ability": "Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.",
    "reminders": [
      "Master"
    ],
    "iconPath": "data/icons/tb/butler_g.webp"
  },
  {
    "id": "goon",
    "name": "Goon",
    "team": "outsider",
    "edition": "bmr",
    "ability": "Each night, the 1st player to choose you with their ability is drunk until dusk. You become their alignment.",
    "reminders": [
      "Drunk"
    ],
    "iconPath": "data/icons/bmr/goon_g.webp"
  },
  {
    "id": "ogre",
    "name": "Ogre",
    "team": "outsider",
    "edition": "carousel",
    "ability": "On your 1st night, choose a player (not yourself): you become their alignment (you don't know which) even if drunk or poisoned.",
    "reminders": [
      "Friend"
    ],
    "iconPath": "data/icons/carousel/ogre_g.webp"
  },
  {
    "id": "lunatic",
    "name": "Lunatic",
    "team": "outsider",
    "edition": "bmr",
    "ability": "You think you are a Demon, but you are not. The Demon knows who you are & who you choose at night.",
    "reminders": [
      "Chosen",
      "Chosen",
      "Chosen"
    ],
    "iconPath": "data/icons/bmr/lunatic_g.webp"
  },
  {
    "id": "drunk",
    "name": "Drunk",
    "team": "outsider",
    "edition": "tb",
    "ability": "You do not know you are the Drunk. You think you are a Townsfolk character, but you are not.",
    "reminders": [],
    "iconPath": "data/icons/tb/drunk_g.webp"
  },
  {
    "id": "tinker",
    "name": "Tinker",
    "team": "outsider",
    "edition": "bmr",
    "ability": "You might die at any time.",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/bmr/tinker_g.webp"
  },
  {
    "id": "recluse",
    "name": "Recluse",
    "team": "outsider",
    "edition": "tb",
    "ability": "You might register as evil & as a Minion or Demon, even if dead.",
    "reminders": [],
    "iconPath": "data/icons/tb/recluse_g.webp"
  },
  {
    "id": "golem",
    "name": "Golem",
    "team": "outsider",
    "edition": "carousel",
    "ability": "You may only nominate once per game. When you do, if the nominee is not the Demon, they die.",
    "reminders": [
      "May Not Nominate"
    ],
    "iconPath": "data/icons/carousel/golem_g.webp"
  },
  {
    "id": "sweetheart",
    "name": "Sweetheart",
    "team": "outsider",
    "edition": "snv",
    "ability": "When you die, 1 player is drunk from now on.",
    "reminders": [
      "Drunk"
    ],
    "iconPath": "data/icons/snv/sweetheart_g.webp"
  },
  {
    "id": "plaguedoctor",
    "name": "Plague Doctor",
    "team": "outsider",
    "edition": "carousel",
    "ability": "When you die, the Storyteller gains a Minion ability.",
    "reminders": [
      "Storyteller Ability"
    ],
    "iconPath": "data/icons/carousel/plaguedoctor_g.webp"
  },
  {
    "id": "klutz",
    "name": "Klutz",
    "team": "outsider",
    "edition": "snv",
    "ability": "When you learn that you died, publicly choose 1 alive player: if they are evil, your team loses.",
    "reminders": [],
    "iconPath": "data/icons/snv/klutz_g.webp"
  },
  {
    "id": "moonchild",
    "name": "Moonchild",
    "team": "outsider",
    "edition": "bmr",
    "ability": "When you learn that you died, publicly choose 1 alive player. Tonight, if it was a good player, they die.",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/bmr/moonchild_g.webp"
  },
  {
    "id": "saint",
    "name": "Saint",
    "team": "outsider",
    "edition": "tb",
    "ability": "If you die by execution, your team loses.",
    "reminders": [],
    "iconPath": "data/icons/tb/saint_g.webp"
  },
  {
    "id": "barber",
    "name": "Barber",
    "team": "outsider",
    "edition": "snv",
    "ability": "If you died today or tonight, the Demon may choose 2 players (not another Demon) to swap characters.",
    "reminders": [
      "Haircuts Tonight"
    ],
    "iconPath": "data/icons/snv/barber_g.webp"
  },
  {
    "id": "hatter",
    "name": "Hatter",
    "team": "outsider",
    "edition": "carousel",
    "ability": "If you died today or tonight, the Minion & Demon players may choose new Minion & Demon characters to be.",
    "reminders": [
      "Tea Party Tonight"
    ],
    "iconPath": "data/icons/carousel/hatter_g.webp"
  },
  {
    "id": "mutant",
    "name": "Mutant",
    "team": "outsider",
    "edition": "snv",
    "ability": "If you are \u201cmad\u201d about being an Outsider, you might be executed.",
    "reminders": [],
    "iconPath": "data/icons/snv/mutant_g.webp"
  },
  {
    "id": "politician",
    "name": "Politician",
    "team": "outsider",
    "edition": "carousel",
    "ability": "If you were the player most responsible for your team losing, you change alignment & win, even if dead.",
    "reminders": [],
    "iconPath": "data/icons/carousel/politician_g.webp"
  },
  {
    "id": "zealot",
    "name": "Zealot",
    "team": "outsider",
    "edition": "carousel",
    "ability": "If there are 5 or more players alive, you must vote for every nomination.",
    "reminders": [],
    "iconPath": "data/icons/carousel/zealot_g.webp"
  },
  {
    "id": "damsel",
    "name": "Damsel",
    "team": "outsider",
    "edition": "carousel",
    "ability": "All Minions know a Damsel is in play. If a Minion publicly guesses you (once), your team loses.",
    "reminders": [
      "Guess Used"
    ],
    "iconPath": "data/icons/carousel/damsel_g.webp"
  },
  {
    "id": "snitch",
    "name": "Snitch",
    "team": "outsider",
    "edition": "carousel",
    "ability": "Each Minion gets 3 bluffs.",
    "reminders": [],
    "iconPath": "data/icons/carousel/snitch_g.webp"
  },
  {
    "id": "heretic",
    "name": "Heretic",
    "team": "outsider",
    "edition": "carousel",
    "ability": "Whoever wins, loses & whoever loses, wins, even if you are dead.",
    "reminders": [],
    "iconPath": "data/icons/carousel/heretic_g.webp"
  },
  {
    "id": "puzzlemaster",
    "name": "Puzzlemaster",
    "team": "outsider",
    "edition": "carousel",
    "ability": "1 player is drunk, even if you die. If you guess (once) who it is, learn the Demon player, but guess wrong & get false info.",
    "reminders": [
      "Drunk",
      "Guess Used"
    ],
    "iconPath": "data/icons/carousel/puzzlemaster_g.webp"
  },
  {
    "id": "mezepheles",
    "name": "Mezepheles",
    "team": "minion",
    "edition": "carousel",
    "ability": "You start knowing a secret word. The 1st good player to say this word becomes evil that night.",
    "reminders": [
      "Turns Evil",
      "No Ability"
    ],
    "iconPath": "data/icons/carousel/mezepheles_e.webp"
  },
  {
    "id": "godfather",
    "name": "Godfather",
    "team": "minion",
    "edition": "bmr",
    "ability": "You start knowing which Outsiders are in play. If 1 died today, choose a player tonight: they die. [-1 or +1 Outsider]",
    "reminders": [
      "Died Today",
      "Dead"
    ],
    "iconPath": "data/icons/bmr/godfather_e.webp"
  },
  {
    "id": "poisoner",
    "name": "Poisoner",
    "team": "minion",
    "edition": "tb",
    "ability": "Each night, choose a player: they are poisoned tonight and tomorrow day.",
    "reminders": [
      "Poisoned"
    ],
    "iconPath": "data/icons/tb/poisoner_e.webp"
  },
  {
    "id": "devilsadvocate",
    "name": "Devil's Advocate",
    "team": "minion",
    "edition": "bmr",
    "ability": "Each night, choose a living player (different to last night): if executed tomorrow, they don't die.",
    "reminders": [
      "Survives Execution"
    ],
    "iconPath": "data/icons/bmr/devilsadvocate_e.webp"
  },
  {
    "id": "spy",
    "name": "Spy",
    "team": "minion",
    "edition": "tb",
    "ability": "Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.",
    "reminders": [],
    "iconPath": "data/icons/tb/spy_e.webp"
  },
  {
    "id": "harpy",
    "name": "Harpy",
    "team": "minion",
    "edition": "carousel",
    "ability": "Each night, choose 2 players: tomorrow, the 1st player is mad that the 2nd is evil, or one or both might die.",
    "reminders": [
      "Mad",
      "2nd"
    ],
    "iconPath": "data/icons/carousel/harpy_e.webp"
  },
  {
    "id": "witch",
    "name": "Witch",
    "team": "minion",
    "edition": "snv",
    "ability": "Each night, choose a player: if they nominate tomorrow, they die. If just 3 players live, you lose this ability.",
    "reminders": [
      "Cursed"
    ],
    "iconPath": "data/icons/snv/witch_e.webp"
  },
  {
    "id": "cerenovus",
    "name": "Cerenovus",
    "team": "minion",
    "edition": "snv",
    "ability": "Each night, choose a player & a good character: they are \u201cmad\u201d they are this character tomorrow, or might be executed.",
    "reminders": [
      "Mad"
    ],
    "iconPath": "data/icons/snv/cerenovus_e.webp"
  },
  {
    "id": "fearmonger",
    "name": "Fearmonger",
    "team": "minion",
    "edition": "carousel",
    "ability": "Each night, choose a player: if you nominate & execute them, their team loses. All players know if you choose a new player.",
    "reminders": [
      "Fear"
    ],
    "iconPath": "data/icons/carousel/fearmonger_e.webp"
  },
  {
    "id": "pithag",
    "name": "Pit-Hag",
    "team": "minion",
    "edition": "snv",
    "ability": "Each night*, choose a player & a character they become (if not in play). If a Demon is made, deaths tonight are arbitrary.",
    "reminders": [],
    "iconPath": "data/icons/snv/pithag_e.webp"
  },
  {
    "id": "psychopath",
    "name": "Psychopath",
    "team": "minion",
    "edition": "carousel",
    "ability": "Each day, before nominations, you may publicly choose a player: they die. If executed, you only die if you lose roshambo.",
    "reminders": [],
    "iconPath": "data/icons/carousel/psychopath_e.webp"
  },
  {
    "id": "assassin",
    "name": "Assassin",
    "team": "minion",
    "edition": "bmr",
    "ability": "Once per game, at night*, choose a player: they die, even if for some reason they could not.",
    "reminders": [
      "Dead",
      "No Ability"
    ],
    "iconPath": "data/icons/bmr/assassin_e.webp"
  },
  {
    "id": "wizard",
    "name": "Wizard",
    "team": "minion",
    "edition": "carousel",
    "ability": "Once per game, choose to make a wish. If granted, it might have a price & leave a clue as to its nature.",
    "reminders": [
      "?",
      "?"
    ],
    "iconPath": "data/icons/carousel/wizard_e.webp"
  },
  {
    "id": "widow",
    "name": "Widow",
    "team": "minion",
    "edition": "carousel",
    "ability": "On your 1st night, look at the Grimoire & choose a player: they are poisoned. 1 good player knows a Widow is in play.",
    "reminders": [
      "Poisoned",
      "Know"
    ],
    "iconPath": "data/icons/carousel/widow_e.webp"
  },
  {
    "id": "xaan",
    "name": "Xaan",
    "team": "minion",
    "edition": "carousel",
    "ability": "On night X, all Townsfolk are poisoned until dusk. [X Outsiders]",
    "reminders": [
      "Night 1",
      "Night 2",
      "Night 3",
      "X"
    ],
    "iconPath": "data/icons/carousel/xaan_e.webp"
  },
  {
    "id": "marionette",
    "name": "Marionette",
    "team": "minion",
    "edition": "carousel",
    "ability": "You think you are a good character, but you are not. The Demon knows who you are. [You neighbor the Demon]",
    "reminders": [],
    "iconPath": "data/icons/carousel/marionette_e.webp"
  },
  {
    "id": "wraith",
    "name": "Wraith",
    "team": "minion",
    "edition": "carousel",
    "ability": "You may choose to open your eyes at night. You wake when other evil players do.",
    "reminders": [],
    "iconPath": "data/icons/carousel/wraith_e.webp"
  },
  {
    "id": "summoner",
    "name": "Summoner",
    "team": "minion",
    "edition": "carousel",
    "ability": "You get 3 bluffs. On the 3rd night, choose a player: they become an evil Demon of your choice. [No Demon]",
    "reminders": [
      "Night 1",
      "Night 2",
      "Night 3"
    ],
    "iconPath": "data/icons/carousel/summoner_e.webp"
  },
  {
    "id": "eviltwin",
    "name": "Evil Twin",
    "team": "minion",
    "edition": "snv",
    "ability": "You & an opposing player know each other. If the good player is executed, evil wins. Good can't win if you both live.",
    "reminders": [
      "Twin"
    ],
    "iconPath": "data/icons/snv/eviltwin_e.webp"
  },
  {
    "id": "goblin",
    "name": "Goblin",
    "team": "minion",
    "edition": "carousel",
    "ability": "If you publicly claim to be the Goblin when nominated & are executed that day, your team wins.",
    "reminders": [
      "Claimed"
    ],
    "iconPath": "data/icons/carousel/goblin_e.webp"
  },
  {
    "id": "boomdandy",
    "name": "Boomdandy",
    "team": "minion",
    "edition": "carousel",
    "ability": "If you are executed, all but 3 players die. After a 10 to 1 countdown, the player with the most players pointing at them, dies.",
    "reminders": [],
    "iconPath": "data/icons/carousel/boomdandy_e.webp"
  },
  {
    "id": "mastermind",
    "name": "Mastermind",
    "team": "minion",
    "edition": "bmr",
    "ability": "If the Demon dies by execution (ending the game), play for 1 more day. If a player is then executed, their team loses.",
    "reminders": [],
    "iconPath": "data/icons/bmr/mastermind_e.webp"
  },
  {
    "id": "scarletwoman",
    "name": "Scarlet Woman",
    "team": "minion",
    "edition": "tb",
    "ability": "If there are 5 or more players alive & the Demon dies, you become the Demon. (Travellers don't count.)",
    "reminders": [
      "Is The Demon"
    ],
    "iconPath": "data/icons/tb/scarletwoman_e.webp"
  },
  {
    "id": "vizier",
    "name": "Vizier",
    "team": "minion",
    "edition": "carousel",
    "ability": "All players know you are the Vizier. You cannot die during the day. If good voted, you may choose to execute immediately.",
    "reminders": [],
    "iconPath": "data/icons/carousel/vizier_e.webp"
  },
  {
    "id": "organgrinder",
    "name": "Organ Grinder",
    "team": "minion",
    "edition": "carousel",
    "ability": "All players keep their eyes closed when voting and the vote tally is secret. Each night, choose if you are drunk until dusk.",
    "reminders": [
      "About To Die",
      "Drunk"
    ],
    "iconPath": "data/icons/carousel/organgrinder_e.webp"
  },
  {
    "id": "boffin",
    "name": "Boffin",
    "team": "minion",
    "edition": "carousel",
    "ability": "The Demon (even if drunk or poisoned) has a not-in-play good character\u2019s ability. You both know which.",
    "reminders": [],
    "iconPath": "data/icons/carousel/boffin_e.webp"
  },
  {
    "id": "baron",
    "name": "Baron",
    "team": "minion",
    "edition": "tb",
    "ability": "There are extra Outsiders in play. [+2 Outsiders]",
    "reminders": [],
    "iconPath": "data/icons/tb/baron_e.webp"
  },
  {
    "id": "yaggababble",
    "name": "Yaggababble",
    "team": "demon",
    "edition": "carousel",
    "ability": "You start knowing a secret phrase. For each time you said it publicly today, a player might die.",
    "reminders": [
      "Dead",
      "Dead",
      "Dead"
    ],
    "iconPath": "data/icons/carousel/yaggababble_e.webp"
  },
  {
    "id": "pukka",
    "name": "Pukka",
    "team": "demon",
    "edition": "bmr",
    "ability": "Each night, choose a player: they are poisoned. The previously poisoned player dies then becomes healthy.",
    "reminders": [
      "Poisoned",
      "Poisoned",
      "Dead"
    ],
    "iconPath": "data/icons/bmr/pukka_e.webp"
  },
  {
    "id": "lilmonsta",
    "name": "Lil' Monsta",
    "team": "demon",
    "edition": "carousel",
    "ability": "Each night, Minions choose who babysits Lil' Monsta & \"is the Demon\". Each night*, a player might die. [+1 Minion]",
    "reminders": [],
    "iconPath": "data/icons/carousel/lilmonsta_e.webp"
  },
  {
    "id": "nodashii",
    "name": "No Dashii",
    "team": "demon",
    "edition": "snv",
    "ability": "Each night*, choose a player: they die. Your 2 Townsfolk neighbors are poisoned.",
    "reminders": [
      "Dead",
      "Poisoned",
      "Poisoned"
    ],
    "iconPath": "data/icons/snv/nodashii_e.webp"
  },
  {
    "id": "imp",
    "name": "Imp",
    "team": "demon",
    "edition": "tb",
    "ability": "Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/tb/imp_e.webp"
  },
  {
    "id": "shabaloth",
    "name": "Shabaloth",
    "team": "demon",
    "edition": "bmr",
    "ability": "Each night*, choose 2 players: they die. A dead player you chose last night might be regurgitated.",
    "reminders": [
      "Dead",
      "Dead",
      "Alive"
    ],
    "iconPath": "data/icons/bmr/shabaloth_e.webp"
  },
  {
    "id": "ojo",
    "name": "Ojo",
    "team": "demon",
    "edition": "carousel",
    "ability": "Each night*, choose a character: they die. If they are not in play, the Storyteller chooses who dies.",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/carousel/ojo_e.webp"
  },
  {
    "id": "kazali",
    "name": "Kazali",
    "team": "demon",
    "edition": "carousel",
    "ability": "Each night*, choose a player: they die. [You choose which players are which Minions. -? to +? Outsiders]",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/carousel/kazali_e.webp"
  },
  {
    "id": "po",
    "name": "Po",
    "team": "demon",
    "edition": "bmr",
    "ability": "Each night*, you may choose a player: they die. If your last choice was no-one, choose 3 players tonight.",
    "reminders": [
      "Dead",
      "Dead",
      "Dead",
      "3 Attacks"
    ],
    "iconPath": "data/icons/bmr/po_e.webp"
  },
  {
    "id": "zombuul",
    "name": "Zombuul",
    "team": "demon",
    "edition": "bmr",
    "ability": "Each night*, if no-one died today, choose a player: they die. The 1st time you die, you live but register as dead.",
    "reminders": [
      "Died Today",
      "Dead"
    ],
    "iconPath": "data/icons/bmr/zombuul_e.webp"
  },
  {
    "id": "vigormortis",
    "name": "Vigormortis",
    "team": "demon",
    "edition": "snv",
    "ability": "Each night*, choose a player: they die. Minions you kill keep their ability & poison 1 Townsfolk neighbor. [-1 Outsider]",
    "reminders": [
      "Dead",
      "Has Ability",
      "Has Ability",
      "Has Ability",
      "Poisoned",
      "Poisoned",
      "Poisoned"
    ],
    "iconPath": "data/icons/snv/vigormortis_e.webp"
  },
  {
    "id": "vortox",
    "name": "Vortox",
    "team": "demon",
    "edition": "snv",
    "ability": "Each night*, choose a player: they die. Townsfolk abilities yield false info. Each day, if no-one is executed, evil wins.",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/snv/vortox_e.webp"
  },
  {
    "id": "legion",
    "name": "Legion",
    "team": "demon",
    "edition": "carousel",
    "ability": "Each night*, a player might die. Executions fail if only evil voted. You register as a Minion too. [Most players are Legion]",
    "reminders": [
      "Dead",
      "About To Die"
    ],
    "iconPath": "data/icons/carousel/legion_e.webp"
  },
  {
    "id": "fanggu",
    "name": "Fang Gu",
    "team": "demon",
    "edition": "snv",
    "ability": "Each night*, choose a player: they die. The 1st Outsider this kills becomes an evil Fang Gu & you die instead. [+1 Outsider]",
    "reminders": [
      "Dead",
      "Once"
    ],
    "iconPath": "data/icons/snv/fanggu_e.webp"
  },
  {
    "id": "lordoftyphon",
    "name": "Lord of Typhon",
    "team": "demon",
    "edition": "carousel",
    "ability": "Each night*, choose a player: they die. [Evil characters are in a line. You are in the middle. +1 Minion. -? to +? Outsiders]",
    "reminders": [
      "Dead"
    ],
    "iconPath": "data/icons/carousel/lordoftyphon_e.webp"
  },
  {
    "id": "lleech",
    "name": "Lleech",
    "team": "demon",
    "edition": "carousel",
    "ability": "Each night*, choose a player: they die. You start by choosing a player: they are poisoned. You die if & only if they are dead.",
    "reminders": [
      "Dead",
      "Poisoned"
    ],
    "iconPath": "data/icons/carousel/lleech_e.webp"
  },
  {
    "id": "alhadikhia",
    "name": "Al-Hadikhia",
    "team": "demon",
    "edition": "carousel",
    "ability": "Each night*, you may choose 3 players (all players learn who): each silently chooses to live or die, but if all live, all die.",
    "reminders": [
      "1",
      "2",
      "3"
    ],
    "iconPath": "data/icons/carousel/alhadikhia_e.webp"
  },
  {
    "id": "riot",
    "name": "Riot",
    "team": "demon",
    "edition": "carousel",
    "ability": "On day 3, Minions become Riot & nominees die but nominate an alive player immediately. This must happen.",
    "reminders": [
      "Day 1",
      "Day 2",
      "Day 3"
    ],
    "iconPath": "data/icons/carousel/riot_e.webp"
  },
  {
    "id": "leviathan",
    "name": "Leviathan",
    "team": "demon",
    "edition": "carousel",
    "ability": "If more than 1 good player is executed, evil wins. All players know you are in play. After day 5, evil wins.",
    "reminders": [
      "Day 1",
      "Day 2",
      "Day 3",
      "Day 4",
      "Day 5",
      "Good Player Executed"
    ],
    "iconPath": "data/icons/carousel/leviathan_e.webp"
  },
  {
    "id": "thief",
    "name": "Thief",
    "team": "traveller",
    "edition": "tb",
    "ability": "Each night, choose a player (not yourself): their vote counts negatively tomorrow.",
    "reminders": [
      "Negative Vote"
    ],
    "iconPath": "data/icons/tb/thief_g.webp"
  },
  {
    "id": "bureaucrat",
    "name": "Bureaucrat",
    "team": "traveller",
    "edition": "tb",
    "ability": "Each night, choose a player (not yourself): their vote counts as 3 votes tomorrow.",
    "reminders": [
      "3 Votes"
    ],
    "iconPath": "data/icons/tb/bureaucrat_g.webp"
  },
  {
    "id": "barista",
    "name": "Barista",
    "team": "traveller",
    "edition": "snv",
    "ability": "Each night, until dusk, 1) a player becomes sober, healthy & gets true info, or 2) their ability works twice. They learn which.",
    "reminders": [
      "Sober & Healthy",
      "Acts Twice",
      "?",
      "?"
    ],
    "iconPath": "data/icons/snv/barista_g.webp"
  },
  {
    "id": "harlot",
    "name": "Harlot",
    "team": "traveller",
    "edition": "snv",
    "ability": "Each night*, choose a living player: if they agree, you learn their character, but you both might die.",
    "reminders": [
      "Dead",
      "Dead"
    ],
    "iconPath": "data/icons/snv/harlot_g.webp"
  },
  {
    "id": "butcher",
    "name": "Butcher",
    "team": "traveller",
    "edition": "snv",
    "ability": "Each day, after the 1st execution, you may nominate again.",
    "reminders": [],
    "iconPath": "data/icons/snv/butcher_g.webp"
  },
  {
    "id": "cacklejack",
    "name": "Cacklejack",
    "team": "traveller",
    "edition": "carousel",
    "ability": "Each day, choose a player: a different player changes character tonight.",
    "reminders": [
      "Not Me"
    ],
    "iconPath": "data/icons/carousel/cacklejack_g.webp"
  },
  {
    "id": "gunslinger",
    "name": "Gunslinger",
    "team": "traveller",
    "edition": "tb",
    "ability": "Each day, after the 1st vote has been tallied, you may choose a player that voted: they die.",
    "reminders": [],
    "iconPath": "data/icons/tb/gunslinger_g.webp"
  },
  {
    "id": "matron",
    "name": "Matron",
    "team": "traveller",
    "edition": "bmr",
    "ability": "Each day, you may choose up to 3 sets of 2 players to swap seats. Players may not leave their seats to talk in private.",
    "reminders": [],
    "iconPath": "data/icons/bmr/matron_g.webp"
  },
  {
    "id": "gangster",
    "name": "Gangster",
    "team": "traveller",
    "edition": "carousel",
    "ability": "Once per day, you may choose to kill an alive neighbor, if your other alive neighbor agrees.",
    "reminders": [],
    "iconPath": "data/icons/carousel/gangster_g.webp"
  },
  {
    "id": "bonecollector",
    "name": "Bone Collector",
    "team": "traveller",
    "edition": "snv",
    "ability": "Once per game, at night*, choose a dead player: they regain their ability until dusk.",
    "reminders": [
      "No Ability",
      "Has Ability"
    ],
    "iconPath": "data/icons/snv/bonecollector_g.webp"
  },
  {
    "id": "judge",
    "name": "Judge",
    "team": "traveller",
    "edition": "bmr",
    "ability": "Once per game, if another player nominated, you may choose to force the current execution to pass or fail.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/bmr/judge_g.webp"
  },
  {
    "id": "apprentice",
    "name": "Apprentice",
    "team": "traveller",
    "edition": "bmr",
    "ability": "On your 1st night, you gain a Townsfolk ability (if good), or a Minion ability (if evil).",
    "reminders": [
      "Is The Apprentice"
    ],
    "iconPath": "data/icons/bmr/apprentice_g.webp"
  },
  {
    "id": "beggar",
    "name": "Beggar",
    "team": "traveller",
    "edition": "tb",
    "ability": "You must use a vote token to vote. If a dead player gives you theirs, you learn their alignment. You are sober & healthy.",
    "reminders": [],
    "iconPath": "data/icons/tb/beggar_g.webp"
  },
  {
    "id": "deviant",
    "name": "Deviant",
    "team": "traveller",
    "edition": "snv",
    "ability": "If you were funny today, you cannot die by exile.",
    "reminders": [],
    "iconPath": "data/icons/snv/deviant_g.webp"
  },
  {
    "id": "scapegoat",
    "name": "Scapegoat",
    "team": "traveller",
    "edition": "tb",
    "ability": "If a player of your alignment is executed, you might be executed instead.",
    "reminders": [],
    "iconPath": "data/icons/tb/scapegoat_g.webp"
  },
  {
    "id": "gnome",
    "name": "Gnome",
    "team": "traveller",
    "edition": "carousel",
    "ability": "All players start knowing a player of your alignment. You may choose to kill anyone who nominates them.",
    "reminders": [
      "Amigo"
    ],
    "iconPath": "data/icons/carousel/gnome_g.webp"
  },
  {
    "id": "bishop",
    "name": "Bishop",
    "team": "traveller",
    "edition": "bmr",
    "ability": "Only the Storyteller can nominate. At least 1 opposing player must be nominated each day.",
    "reminders": [
      "Nominate Good",
      "Nominate Evil"
    ],
    "iconPath": "data/icons/bmr/bishop_g.webp"
  },
  {
    "id": "voudon",
    "name": "Voudon",
    "team": "traveller",
    "edition": "bmr",
    "ability": "Only you & the dead can vote. They don't need a vote token to do so. A 50% majority isn't required.",
    "reminders": [],
    "iconPath": "data/icons/bmr/voudon_g.webp"
  },
  {
    "id": "angel",
    "name": "Angel",
    "team": "fabled",
    "edition": "fabled",
    "ability": "Something bad might happen to whoever is most responsible for the death of a new player.",
    "reminders": [
      "Protected",
      "Protected",
      "Something Bad"
    ],
    "iconPath": "data/icons/fabled/angel.webp"
  },
  {
    "id": "buddhist",
    "name": "Buddhist",
    "team": "fabled",
    "edition": "fabled",
    "ability": "For the first 2 minutes of each day, veteran players may not talk.",
    "reminders": [],
    "iconPath": "data/icons/fabled/buddhist.webp"
  },
  {
    "id": "deusexfiasco",
    "name": "Deus ex Fiasco",
    "team": "fabled",
    "edition": "carousel",
    "ability": "At least once per game, the Storyteller will make a mistake, correct it, and publicly admit to it.",
    "reminders": [
      "Whoopsie"
    ],
    "iconPath": "data/icons/carousel/deusexfiasco.webp"
  },
  {
    "id": "djinn",
    "name": "Djinn",
    "team": "fabled",
    "edition": "fabled",
    "ability": "Use the Djinn's special rule. All players know what it is.",
    "reminders": [],
    "iconPath": "data/icons/fabled/djinn.webp"
  },
  {
    "id": "doomsayer",
    "name": "Doomsayer",
    "team": "fabled",
    "edition": "fabled",
    "ability": "If 4 or more players live, each living player may publicly choose (once per game) that a player of their own alignment dies.",
    "reminders": [],
    "iconPath": "data/icons/fabled/doomsayer.webp"
  },
  {
    "id": "duchess",
    "name": "Duchess",
    "team": "fabled",
    "edition": "fabled",
    "ability": "Each day, 3 players may choose to visit you. At night*, each visitor learns how many visitors are evil, but 1 gets false info.",
    "reminders": [
      "Visitor",
      "Visitor",
      "False Info"
    ],
    "iconPath": "data/icons/fabled/duchess.webp"
  },
  {
    "id": "ferryman",
    "name": "Ferryman",
    "team": "fabled",
    "edition": "carousel",
    "ability": "On the final day, all dead players regain their vote token.",
    "reminders": [],
    "iconPath": "data/icons/carousel/ferryman.webp"
  },
  {
    "id": "fibbin",
    "name": "Fibbin",
    "team": "fabled",
    "edition": "fabled",
    "ability": "Once per game, 1 good player might get incorrect information.",
    "reminders": [
      "No Ability"
    ],
    "iconPath": "data/icons/fabled/fibbin.webp"
  },
  {
    "id": "fiddler",
    "name": "Fiddler",
    "team": "fabled",
    "edition": "fabled",
    "ability": "Once per game, the Demon secretly chooses an opposing player: all players choose which of these 2 players win.",
    "reminders": [],
    "iconPath": "data/icons/fabled/fiddler.webp"
  },
  {
    "id": "hellslibrarian",
    "name": "Hell's Librarian",
    "team": "fabled",
    "edition": "fabled",
    "ability": "Something bad might happen to whoever talks when the Storyteller has asked for silence.",
    "reminders": [
      "Something Bad"
    ],
    "iconPath": "data/icons/fabled/hellslibrarian.webp"
  },
  {
    "id": "revolutionary",
    "name": "Revolutionary",
    "team": "fabled",
    "edition": "fabled",
    "ability": "2 neighboring players are known to be the same alignment. Once per game, 1 of them registers falsely.",
    "reminders": [
      "Register Falsely?",
      "Aligned",
      "Aligned"
    ],
    "iconPath": "data/icons/fabled/revolutionary.webp"
  },
  {
    "id": "sentinel",
    "name": "Sentinel",
    "team": "fabled",
    "edition": "fabled",
    "ability": "There might be 1 extra or 1 fewer Outsider in play.",
    "reminders": [],
    "iconPath": "data/icons/fabled/sentinel.webp"
  },
  {
    "id": "spiritofivory",
    "name": "Spirit of Ivory",
    "team": "fabled",
    "edition": "fabled",
    "ability": "There can't be more than 1 extra evil player.",
    "reminders": [
      "No More Evil"
    ],
    "iconPath": "data/icons/fabled/spiritofivory.webp"
  },
  {
    "id": "toymaker",
    "name": "Toymaker",
    "team": "fabled",
    "edition": "fabled",
    "ability": "The Demon may choose not to attack & must do this at least once per game. Evil players get normal starting info.",
    "reminders": [
      "Final Night: No Attack"
    ],
    "iconPath": "data/icons/fabled/toymaker.webp"
  },
  {
    "id": "bootlegger",
    "name": "Bootlegger",
    "team": "loric",
    "edition": "loric",
    "ability": "This script has homebrew characters or rules.",
    "reminders": [
      "?",
      "?"
    ],
    "iconPath": "data/icons/loric/bootlegger.webp"
  },
  {
    "id": "bigwig",
    "name": "Big Wig",
    "team": "loric",
    "edition": "loric",
    "ability": "Each nominee chooses a player: until voting, only they may speak & they are mad the nominee is good or they might die.",
    "reminders": [],
    "iconPath": "data/icons/loric/bigwig.webp"
  },
  {
    "id": "gardener",
    "name": "Gardener",
    "team": "loric",
    "edition": "loric",
    "ability": "The Storyteller assigns all players' characters.",
    "reminders": [],
    "iconPath": "data/icons/loric/gardener.webp"
  },
  {
    "id": "godofug",
    "name": "God of Ug",
    "team": "loric",
    "edition": "loric",
    "ability": "One Ug hat. When wear Ug hat, must speak one sound at a time but vote twice. If fail, pass Ug hat.",
    "reminders": [
      "Hat"
    ],
    "iconPath": "data/icons/loric/godofug.webp"
  },
  {
    "id": "hindu",
    "name": "Hindu",
    "team": "loric",
    "edition": "loric",
    "ability": "The first 4 players to die are immediately reincarnated as Travellers of the same alignment.",
    "reminders": [],
    "iconPath": "data/icons/loric/hindu.webp"
  },
  {
    "id": "knaves",
    "name": "Knaves",
    "team": "loric",
    "edition": "loric",
    "ability": "There are 2 Storytellers: one lies & one tells the truth. Once per game, at dusk, they might switch.",
    "reminders": [],
    "iconPath": "data/icons/loric/knaves.webp"
  },
  {
    "id": "pope",
    "name": "Pope",
    "team": "loric",
    "edition": "loric",
    "ability": "There are duplicate good characters in play. They might also be bluffs.",
    "reminders": [],
    "iconPath": "data/icons/loric/pope.webp"
  },
  {
    "id": "stormcatcher",
    "name": "Storm Catcher",
    "team": "loric",
    "edition": "loric",
    "ability": "Name a good character. If in play, they can only die by execution, but evil players learn which player it is.",
    "reminders": [
      "Stormcaught"
    ],
    "iconPath": "data/icons/loric/stormcatcher.webp"
  },
  {
    "id": "tor",
    "name": "Tor",
    "team": "loric",
    "edition": "loric",
    "ability": "Players don't know their character or alignment. They learn them when they die.",
    "reminders": [],
    "iconPath": "data/icons/loric/tor.webp"
  },
  {
    "id": "ventriloquist",
    "name": "Ventriloquist",
    "team": "loric",
    "edition": "loric",
    "ability": "If a player is mad as a fresh character during their nomination, they might not die if executed today.",
    "reminders": [
      "Mad"
    ],
    "iconPath": "data/icons/loric/ventriloquist.webp"
  },
  {
    "id": "zenomancer",
    "name": "Zenomancer",
    "team": "loric",
    "edition": "loric",
    "ability": "One or more players each have a goal. When achieved, that player learns a piece of true info.",
    "reminders": [
      "Goal",
      "Goal",
      "Goal"
    ],
    "iconPath": "data/icons/loric/zenomancer.webp"
  }
];

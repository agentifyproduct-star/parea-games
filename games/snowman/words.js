/* Snowman word data.

   Every entry is lowercase a-z plus spaces and hyphens. Multi-word answers are
   allowed: the separators are revealed from the start, so the player only ever
   guesses letters. The category is shown to the player as the standing clue,
   which is what makes a phrase like "kuala lumpur" fair rather than cruel.

   Difficulty is derived rather than hand-assigned, so adding a word is a
   one-line change and no tier can drift out of date. See difficultyOf().

   Places is the mixed one, countries beside cities. Countries is only
   countries, and it is there because the daily runway is governed by the easy
   pile: country names are vowel-rich, so difficultyOf() scores most of them
   easy, which is exactly the pile that empties first.

   The list is UN member states, which is the one line that can be drawn without
   picking a side. That leaves out Taiwan, Kosovo and Palestine, and leaves out
   anything whose English name runs past twelve characters, which is the widest
   phrase the board has ever had to fit.

   Global is the things that cross borders: languages, currencies, and the
   machinery of travel and time. Keeping the three apart is what stops the
   standing clue being useless in any of them. */

const CATEGORIES = {
  'Animals': [
    'elephant', 'giraffe', 'penguin', 'dolphin', 'kangaroo', 'octopus', 'squirrel',
    'hedgehog', 'flamingo', 'crocodile', 'butterfly', 'jellyfish', 'rhinoceros',
    'chimpanzee', 'polar bear', 'sea turtle', 'king cobra', 'honey badger',
    'arctic fox', 'blue whale', 'zebra', 'walrus', 'lynx', 'quail', 'jaguar',
    'koala', 'otter', 'badger', 'falcon', 'gecko'
  ],
  'Food and drink': [
    'pineapple', 'spaghetti', 'chocolate', 'avocado', 'pancake', 'croissant',
    'dumpling', 'lasagne', 'cinnamon', 'cucumber', 'pumpkin', 'waffle', 'yoghurt',
    'biryani', 'sushi', 'mango', 'olive oil', 'ice cream', 'hot sauce',
    'maple syrup', 'garlic bread', 'apple pie', 'black pepper', 'coconut', 'espresso'
  ],
  'Places': [
    'portugal', 'thailand', 'morocco', 'iceland', 'vietnam', 'ethiopia', 'argentina',
    'singapore', 'new zealand', 'sri lanka', 'costa rica', 'south korea',
    'buenos aires', 'cape town', 'kuala lumpur', 'reykjavik', 'marrakesh',
    'brisbane', 'quebec', 'zurich', 'prague', 'nairobi', 'jakarta', 'helsinki',
    'montevideo'
  ],
  'Science': [
    'gravity', 'molecule', 'telescope', 'asteroid', 'magnetism', 'nitrogen',
    'ecosystem', 'antibody', 'velocity', 'eclipse', 'quantum', 'oxygen', 'volcano',
    'glacier', 'enzyme', 'galaxy', 'neutron', 'plasma', 'fossil', 'orbit', 'vaccine',
    'chromosome', 'black hole', 'solar wind', 'big bang'
  ],
  'Music': [
    'guitar', 'symphony', 'trumpet', 'ukulele', 'saxophone', 'harmonica', 'melody',
    'rhythm', 'chorus', 'violin', 'drum kit', 'jazz band', 'sheet music', 'bass line',
    'xylophone', 'banjo', 'cello', 'tempo', 'encore', 'opera'
  ],
  'Sport': [
    'football', 'marathon', 'cricket', 'badminton', 'swimming', 'archery',
    'gymnastics', 'cycling', 'surfing', 'boxing', 'hockey', 'judo', 'rugby', 'skiing',
    'tennis', 'high jump', 'ice hockey', 'long jump', 'table tennis', 'penalty kick'
  ],
  'Around the house': [
    'umbrella', 'kettle', 'cushion', 'mirror', 'blanket', 'doorbell', 'cupboard',
    'wardrobe', 'mattress', 'radiator', 'toaster', 'vacuum', 'curtain', 'laundry',
    'dishwasher', 'light bulb', 'front door', 'coffee mug', 'alarm clock',
    'bookshelf', 'hairbrush', 'scissors', 'keyboard', 'pillow', 'candle'
  ],
  'Movies': [
    'director', 'screenplay', 'soundtrack', 'popcorn', 'sequel', 'trailer', 'cameo',
    'subtitle', 'blockbuster', 'red carpet', 'box office', 'sound stage', 'stunt double',
    'premiere', 'silent film', 'the matrix', 'casablanca', 'psycho', 'toy story',
    'frozen', 'finding nemo', 'star wars', 'gladiator', 'inception', 'titanic'
  ],
  'Nature': [
    'rainbow', 'waterfall', 'thunder', 'blossom', 'meadow', 'canyon', 'iceberg',
    'sunrise', 'wildfire', 'seashell', 'acorn', 'pebble', 'coral reef', 'sand dune',
    'rainforest', 'tide pool', 'avalanche', 'estuary', 'wetland', 'driftwood', 'hailstone',
    'monsoon', 'riverbank', 'treeline', 'snowdrift'
  ],
  'Companies': [
    'samsung', 'toyota', 'nintendo', 'spotify', 'unilever', 'siemens', 'panasonic',
    'starbucks', 'volkswagen', 'ikea', 'adidas', 'lego', 'canon', 'philips', 'shell',
    'visa', 'airbnb', 'netflix', 'pixar', 'bosch', 'kodak', 'ferrari', 'michelin',
    'heineken', 'nestle'
  ],
  'Global': [
    'mandarin', 'swahili', 'portuguese', 'arabic', 'esperanto', 'rupee', 'euro',
    'dollar', 'peso', 'yuan', 'olympics', 'world cup', 'passport', 'embassy', 'ambassador',
    'equator', 'time zone', 'continent', 'hemisphere', 'longitude', 'airport', 'customs',
    'translator', 'summit', 'treaty'
  ],
  'Countries': [
    'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'armenia', 'australia',
    'austria', 'azerbaijan', 'bahamas', 'bahrain', 'bangladesh', 'barbados', 'belarus',
    'belgium', 'belize', 'benin', 'bhutan', 'bolivia', 'botswana', 'brazil', 'brunei',
    'bulgaria', 'burkina faso', 'burundi', 'cambodia', 'cameroon', 'canada', 'cape verde',
    'chad', 'chile', 'china', 'colombia', 'comoros', 'croatia', 'cuba', 'cyprus',
    'denmark', 'djibouti', 'dominica', 'ecuador', 'egypt', 'el salvador', 'eritrea',
    'estonia', 'eswatini', 'fiji', 'finland', 'france', 'gabon', 'gambia', 'georgia',
    'germany', 'ghana', 'greece', 'grenada', 'guatemala', 'guinea', 'guyana', 'haiti',
    'honduras', 'hungary', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel',
    'italy', 'ivory coast', 'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya',
    'kiribati', 'kuwait', 'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia',
    'libya', 'lithuania', 'luxembourg', 'madagascar', 'malawi', 'malaysia', 'maldives',
    'mali', 'malta', 'mauritania', 'mauritius', 'mexico', 'micronesia', 'moldova',
    'monaco', 'mongolia', 'montenegro', 'mozambique', 'myanmar', 'namibia', 'nauru',
    'nepal', 'nicaragua', 'niger', 'nigeria', 'north korea', 'norway', 'oman', 'pakistan',
    'palau', 'panama', 'paraguay', 'peru', 'philippines', 'poland', 'qatar', 'romania',
    'russia', 'rwanda', 'samoa', 'san marino', 'saudi arabia', 'senegal', 'serbia',
    'seychelles', 'sierra leone', 'slovakia', 'slovenia', 'somalia', 'south africa',
    'south sudan', 'spain', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria',
    'tajikistan', 'tanzania', 'timor leste', 'togo', 'tonga', 'tunisia', 'turkey',
    'turkmenistan', 'tuvalu', 'uganda', 'ukraine', 'uruguay', 'uzbekistan', 'vanuatu',
    'venezuela', 'yemen', 'zambia', 'zimbabwe'
  ]
};

const LEVELS = ['easy', 'medium', 'hard'];

/* Puzzle #1 is 16 Feb 2026, the same start as Shabda, and the day turns over at
   midnight in New York (assets/daily.js). The daily word is drawn from the whole
   book rather than one difficulty: a level pool is only a few dozen words deep,
   which would come round again within a month, and a single daily word is also
   the same word for everybody — which is the point of having one. */
const EPOCH_KEY = '2026-02-16';

/* Same small PRNG the other games use: same seed, same order, everywhere. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const deck = list.slice();
  const rnd = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

/* What actually makes a snowman word hard is not its length — it is how many
   different letters have to be found, and how many of those a player is unlikely
   to try early. So the score counts distinct letters, adds a penalty for rare
   ones, and subtracts credit for vowels, which is what most people open with. */
function difficultyOf(phrase) {
  const distinct = [...new Set(phrase.replace(/[^a-z]/g, ''))];
  const rare = distinct.filter(c => 'jqxz'.includes(c)).length * 2
             + distinct.filter(c => 'kvw'.includes(c)).length;
  const vowels = distinct.filter(c => 'aeiou'.includes(c)).length;

  /* Thresholds chosen to split this book roughly 70 / 75 / 25, so every tier has
     enough words that a session is unlikely to run the pool dry. */
  const score = distinct.length + rare * 1.5 - vowels;
  if (score <= 4) return 'easy';
  if (score <= 6.5) return 'medium';
  return 'hard';
}

/* [{ phrase, category, level }] for everything in the book. */
const ALL = Object.keys(CATEGORIES).flatMap(category =>
  CATEGORIES[category].map(phrase => ({
    phrase,
    category,
    level: difficultyOf(phrase)
  }))
);

/* How often each tier comes up, and it is not the same question in the two
   modes. Today keeps hard in the rotation at one day in twenty, which is about
   one hard day every three weeks. Unlimited never serves hard at all: it is
   where somebody goes to keep playing, and the hardest words in the book are
   not what that is for. */
const LEVEL_WEIGHTS = {
  daily: [['easy', 65], ['medium', 30], ['hard', 5]],
  unlimited: [['easy', 70], ['medium', 30]]
};

function pickLevel(table, rnd) {
  const total = table.reduce((sum, pair) => sum + pair[1], 0);
  let roll = rnd() * total;
  for (let i = 0; i < table.length; i++) {
    roll -= table[i][1];
    if (roll < 0) return table[i][0];
  }
  return table[table.length - 1][0];
}

/* One shuffled run per tier, rather than the single run through the whole book
   this used to be. Weighting the day by difficulty means the day has to be dealt
   from that difficulty, and dealing from a shuffle is still what stops a word
   coming round twice.

   It does cost some runway. The book is 70 easy, 74 medium and 26 hard; at 65%
   easy the easy pile is the one that empties first, after about 108 days rather
   than the 170 a single run gave. Worth knowing before it happens. */
const SCHEDULES = {};
LEVELS.forEach((level, i) => {
  SCHEDULES[level] = shuffled(ALL.filter(w => w.level === level), 0xC01D5E + i * 0x9E3779B1);
});

/* How many of the days before this one drew the same tier, which is this day's
   place in that tier's run. Counted rather than hashed, so the run is walked in
   order and nothing repeats until the pile is used up. Cheap: one small PRNG
   call per elapsed day, and the epoch is 2026. */
function placeInRun(n, level) {
  let seen = 0;
  for (let i = 0; i < n; i++) {
    if (pickLevel(LEVEL_WEIGHTS.daily, mulberry32(0x5C01D + i * 0x9E3779B1)) === level) seen++;
  }
  return seen;
}

window.SNOWMAN_WORDS = {
  levels: LEVELS,
  categories: Object.keys(CATEGORIES),
  difficultyOf,

  /* Which puzzle today is. Shared with the rest of Parea's clock. */
  puzzleNumber(date = new Date()) {
    return DAILY.daysBetween(EPOCH_KEY, DAILY.key(date)) + 1;
  },

  /* Which tier today is played at: a weighted draw seeded off the puzzle
     number, so it is the same draw for everybody and the same one again if you
     come back to an old day. */
  dailyLevel(date = new Date()) {
    const n = this.puzzleNumber(date) - 1;
    return pickLevel(LEVEL_WEIGHTS.daily, mulberry32(0x5C01D + n * 0x9E3779B1));
  },

  /* The word of the day: the same one for everybody, everywhere. */
  daily(date = new Date()) {
    const n = this.puzzleNumber(date) - 1;
    const level = this.dailyLevel(date);
    const run = SCHEDULES[level];
    if (!run.length) return SCHEDULES.medium[0] || ALL[0];
    const place = placeInRun(n, level);
    return run[((place % run.length) + run.length) % run.length];
  },

  /* Unlimited rolls its own tier per word, off the gentler table. */
  unlimitedLevel() {
    return pickLevel(LEVEL_WEIGHTS.unlimited, Math.random);
  },

  weights(mode) {
    return (LEVEL_WEIGHTS[mode] || []).map(pair => ({ level: pair[0], weight: pair[1] }));
  },

  all() {
    return ALL.slice();
  },

  /* Every entry at one difficulty. The caller decides which of them are still
     unplayed — this layer has no memory. */
  atLevel(level) {
    return ALL.filter(w => w.level === level);
  },

  /* One entry at the given difficulty, avoiding anything in `exclude`. Returns
     null when the level is empty, and ignores `exclude` once it has swallowed
     the whole pool, so a long session recycles rather than dead-ends. */
  pick(level, exclude = []) {
    const pool = ALL.filter(w => w.level === level);
    if (!pool.length) return null;

    const skip = new Set(exclude);
    const fresh = pool.filter(w => !skip.has(w.phrase));
    const from = fresh.length ? fresh : pool;
    return from[Math.floor(Math.random() * from.length)];
  }
};

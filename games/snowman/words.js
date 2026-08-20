/* Snowman word data.

   Every entry is lowercase a-z plus spaces and hyphens. Multi-word answers are
   allowed: the separators are revealed from the start, so the player only ever
   guesses letters. The category is shown to the player as the standing clue,
   which is what makes a phrase like "kuala lumpur" fair rather than cruel.

   Difficulty is derived rather than hand-assigned, so adding a word is a
   one-line change and no tier can drift out of date. See difficultyOf(). */

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

/* A shuffle rather than a date hash, so no word can come round again until the
   whole book has been through. 170 words is 170 days. */
const SCHEDULE = shuffled(ALL, 0xC01D5E);

window.SNOWMAN_WORDS = {
  levels: LEVELS,
  categories: Object.keys(CATEGORIES),
  difficultyOf,

  /* Which puzzle today is. Shared with the rest of Parea's clock. */
  puzzleNumber(date = new Date()) {
    return DAILY.daysBetween(EPOCH_KEY, DAILY.key(date)) + 1;
  },

  /* The word of the day: the same one for everybody, everywhere. */
  daily(date = new Date()) {
    const n = this.puzzleNumber(date) - 1;
    const size = SCHEDULE.length;
    return SCHEDULE[((n % size) + size) % size];
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

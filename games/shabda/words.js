/* Shabda word engine.
   Reads the per-length lists registered by words-4.js / words-5.js / words-6.js
   and turns them into a daily schedule, one independent run per length. */

const LENGTHS = [4, 5, 6, 7];

/* How often each board comes up, in both modes alike. The dip at five is
   deliberate: four is a quick win, six and seven are where the game has room to
   be a game, and five sits close enough to six to feel like a repeat of it.

   Weights rather than a rotation, because the board is no longer something the
   player picks. Take one away or change a number and the game reweights; there
   is nothing else to keep in step. */
const LENGTH_WEIGHTS = [[4, 20], [5, 10], [6, 40], [7, 30]];
const WEIGHT_TOTAL = LENGTH_WEIGHTS.reduce((sum, pair) => sum + pair[1], 0);

/* One draw from the table, given something that returns 0..1. */
function pickLength(rnd) {
  let roll = rnd() * WEIGHT_TOTAL;
  for (let i = 0; i < LENGTH_WEIGHTS.length; i++) {
    roll -= LENGTH_WEIGHTS[i][1];
    if (roll < 0) return LENGTH_WEIGHTS[i][0];
  }
  return LENGTH_WEIGHTS[LENGTH_WEIGHTS.length - 1][0];
}

/* Puzzle #1 is 16 Feb 2026, so the six months up to today are all back-filled.
   Which day it is comes from assets/daily.js: midnight in New York, the same
   moment for every player wherever they are. */
const EPOCH_KEY = '2026-02-16';
const DAY_MS = 86400000;

/* Small seeded PRNG. Same seed, same sequence, every browser and every visit. */
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

/* Per length: the answer pool, a Set of everything accepted as a guess, and the
   shuffled play order. A shuffle rather than a date-hash means a word cannot
   recur until the whole pool is used up, so no length repeats inside six months.
   Each length gets its own seed so 4-, 5- and 6-letter days advance independently. */
const BANK = {};

/* Only plain a-z of exactly the right length survives. The keyboard cannot type
   an accent, so entries like "émigré" would just be dead weight in the Set. */
const usable = (list, len) => list.filter(w => w.length === len && /^[a-z]+$/.test(w));

/* VALID arrives as fixed-width text - one word every `len` characters, with no
   separators - so slice it back into words. */
function unpack(packed, len) {
  const out = [];
  for (let i = 0; i + len <= packed.length; i += len) out.push(packed.slice(i, i + len));
  return out;
}

LENGTHS.forEach((len, i) => {
  const raw = (window.WORD_LISTS || {})[len] || {};
  const answers = usable(raw.answers || [], len);

  /* Answers are guessable by definition, and `extra` is still honoured so a word
     can be added by hand without regenerating the packed list. */
  const valid = new Set(answers);
  unpack(raw.valid || '', len).forEach(w => valid.add(w));
  usable(raw.extra || [], len).forEach(w => valid.add(w));

  BANK[len] = {
    answers,
    valid,
    schedule: shuffled(answers, 0x5EED1E + i * 0x9E3779B1)
  };
});

const WORDS = {
  lengths: LENGTHS,

  supports(len) {
    return Object.prototype.hasOwnProperty.call(BANK, len) && BANK[len].answers.length > 0;
  },

  answers(len) {
    return BANK[len] ? BANK[len].answers : [];
  },

  /* Length is inferred from the word, so a 4-letter guess is only ever checked
     against the 4-letter bank. */
  isValid(word) {
    const w = String(word || '').toLowerCase();
    const bank = BANK[w.length];
    return !!bank && bank.valid.has(w);
  },

  /* Puzzle number for a date; #1 is the epoch. Shared across lengths so the
     header reads the same number whichever board you are on. */
  puzzleNumber(date = new Date()) {
    return DAILY.daysBetween(EPOCH_KEY, DAILY.key(date)) + 1;
  },

  /* The key the rest of the game counts days by. */
  dayKey(date = new Date()) {
    return DAILY.key(date);
  },

  /* Which board today's word is played on: a draw from the weight table, seeded
     off the puzzle number so it is the same draw for everybody, everywhere, and
     the same one again tomorrow if you come back to yesterday. */
  dailyLength(date = new Date()) {
    return pickLength(mulberry32(0xB0A2D + this.puzzleNumber(date) * 0x9E3779B1));
  },

  /* Unlimited draws fresh every word. The same table, none of the calendar:
     nobody else is playing your unlimited round, so there is nothing to agree
     with. Rolled per word rather than per session, so a run of unlimited words
     is a run of different boards. */
  unlimitedLength() {
    return pickLength(Math.random);
  },

  weights() {
    return LENGTH_WEIGHTS.map(pair => ({ len: pair[0], weight: pair[1] }));
  },

  /* Everyone gets the same word for a given length on a given calendar day. */
  dailyWord(len, date = new Date()) {
    const bank = BANK[len];
    if (!bank || !bank.schedule.length) return '';
    const n = this.puzzleNumber(date) - 1;
    const size = bank.schedule.length;
    return bank.schedule[((n % size) + size) % size]; // stays in range for negative n
  },

  /* The archive: [{ date, iso, puzzle, word }] for the `days` days ending today,
     oldest first. Defaults to roughly six months. */
  history(len, days = 182, endDate = new Date()) {
    const endKey = DAILY.key(endDate);
    const out = [];

    for (let i = days - 1; i >= 0; i--) {
      const iso = DAILY.shift(endKey, -i);
      const date = DAILY.keyToDate(iso);
      out.push({
        date,
        iso,
        puzzle: DAILY.daysBetween(EPOCH_KEY, iso) + 1,
        word: this.dailyWord(len, date)
      });
    }
    return out;
  },

  randomWord(len) {
    const pool = this.answers(len);
    return pool[Math.floor(Math.random() * pool.length)];
  }
};

/* `const` at top level does not attach to window — publish it explicitly. */
window.WORDS = WORDS;

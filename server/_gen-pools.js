/* Builds pools.json — the word pools rooms draw from.

   Section 8 of the room spec keeps the public and room pools partitioned: a room
   word must never be one the public daily game can also serve, or a member could
   preview tomorrow's answer by playing a match. So this script reads what each
   public game already uses and excludes every one of those words.

   Shabda and Anagram pools are derived: common words by frequency band, filtered
   the same way the public Anagram manifest is. Snowman's are hand-written below,
   because its clue is a category and no frequency list carries one.

   Run: node _gen-pools.js     (sources cached in the temp folder) */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'pools.json');

const SOURCES = {
  enable: {
    file: 'shabda-enable1.txt',
    url: 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt'
  },
  freq: {
    file: 'anagram-freq.txt',
    url: 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa.txt'
  }
};

/* Snowman needs a category per word, so its room book is written by hand rather
   than derived. Every word here is checked against the public book below and any
   overlap is dropped, so the two never serve the same answer. */
const SNOWMAN_ROOM_BOOK = {
  'Animals': [
    'panther', 'raccoon', 'buffalo', 'antelope', 'ostrich', 'meerkat', 'porcupine',
    'chameleon', 'salamander', 'tarantula', 'mongoose', 'wolverine', 'armadillo',
    'orangutan', 'kingfisher', 'woodpecker', 'seahorse', 'starfish', 'barn owl',
    'grizzly bear', 'mountain goat', 'snow leopard'
  ],
  'Food and drink': [
    'tortilla', 'meatball', 'porridge', 'omelette', 'baguette', 'macaroni',
    'artichoke', 'aubergine', 'courgette', 'raspberry', 'blueberry', 'watermelon',
    'gingerbread', 'marshmallow', 'peanut butter', 'orange juice', 'fried rice',
    'lemon tart', 'roast dinner', 'cheese board'
  ],
  'Places': [
    'denmark', 'malaysia', 'colombia', 'tanzania', 'slovakia', 'lithuania',
    'barcelona', 'stockholm', 'edinburgh', 'amsterdam', 'copenhagen', 'valencia',
    'santiago', 'bratislava', 'san marino', 'cape verde', 'ivory coast',
    'papua new guinea', 'san francisco', 'buenos aires'
  ],
  'Science': [
    'hydrogen', 'helium', 'gravity well', 'atmosphere', 'photosynthesis',
    'evolution', 'bacteria', 'skeleton', 'satellite', 'meteorite', 'crystal',
    'magnetic field', 'periodic table', 'solar panel', 'microscope', 'telescope lens',
    'genome', 'protein', 'circuit', 'friction'
  ],
  'Music': [
    'clarinet', 'accordion', 'tambourine', 'mandolin', 'bagpipes', 'keyboard',
    'orchestra', 'conductor', 'crescendo', 'harmony', 'quartet', 'lullaby',
    'folk song', 'brass band', 'drum solo', 'guitar pick', 'concert hall', 'metronome'
  ],
  'Sport': [
    'volleyball', 'basketball', 'skateboard', 'snowboard', 'triathlon', 'wrestling',
    'canoeing', 'fencing', 'rowing', 'sprinting', 'goalkeeper', 'referee',
    'pole vault', 'shot put', 'water polo', 'ice skating', 'mountain bike', 'relay race'
  ],
  'Around the house': [
    'colander', 'saucepan', 'floorboard', 'chandelier', 'doormat', 'letterbox',
    'wheelbarrow', 'watering can', 'ironing board', 'chest of drawers', 'kitchen sink',
    'bedside lamp', 'coat hanger', 'washing line', 'window frame', 'garden shed',
    'staircase', 'fireplace', 'bookcase', 'tea towel'
  ]
};

/* ---------------- sources ---------------- */

async function cached(source) {
  const file = path.join(os.tmpdir(), source.file);
  if (!fs.existsSync(file)) {
    process.stdout.write(`fetching ${source.file}... `);
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`${source.url} -> HTTP ${res.status}`);
    fs.writeFileSync(file, await res.text(), 'utf8');
    console.log('cached');
  }
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase());
}

/* Runs the public games' browser data files in a sandbox to find out exactly
   which words they already use. */
function publicWords() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);

  const run = file => vm.runInContext(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), ctx, { filename: file });

  ['words-4.js', 'words-5.js', 'words-6.js', 'words.js']
    .forEach(f => run(path.join(ROOT, 'games', 'shabda', f)));
  const shabda = new Set([4, 5, 6].flatMap(len => ctx.WORDS.answers(len)));

  const hangCtx = { console };
  hangCtx.window = hangCtx;
  vm.createContext(hangCtx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'games', 'snowman', 'words.js'), 'utf8'), hangCtx);
  const snowman = new Set(hangCtx.SNOWMAN_WORDS.all().map(w => w.phrase));

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'games', 'anagram', 'puzzles.json'), 'utf8'));
  const anagram = new Set(manifest.days.flatMap(d => [d.w1, d.w2]));

  return { shabda, snowman, anagram, all: new Set([...shabda, ...snowman, ...anagram]) };
}

/* ---------------- word quality ---------------- */

/* The same rules the public Anagram manifest is held to, so a room word is no
   worse than a daily one. */
const BLOCKLIST = `
  death dead deadly died dies dying kill killed killing killer murder suicide
  weapon weapons gun guns rifle bomb bombs bullet war wars army enemy attack
  assault threat terror riot violence violent blood wound injury fatal victim
  corpse funeral grave coffin cancer tumor disease illness disorder infection
  plague virus famine drought disaster crisis emergency prison jail arrest crime
  criminal fraud theft stolen slave slavery racist racism abuse torture trauma
  hostage drug drugs cocaine heroin addict overdose hate hatred anger angry panic
  fear afraid grief divorce bankrupt debt poverty homeless refugee
  piss pissing crap damn hell sexy naked nude breast butt bitch bastard whore
  slut porn erotic drunk vomit pussy vibrator boobs penis vagina orgy sperm
  incest molest rape rapist abortion obesity tsunami diabetes infected deviant
  alcohol smoking conflict warrior genocide massacre kidnap ransom shooting
  shooter gunman explosion militant terrorist
  their there these those which whose where while would could should might shall
  every other either neither being having itself myself himself herself yourself
  anyone anybody someone somebody everyone nothing nobody however therefore
  although because unless until whether always never often perhaps indeed rather
  quite still since though
  warcraft google yahoo verizon toyota honda samsung nokia oracle adobe cisco
  intel xerox boeing disney pepsi linux ubuntu firefox paypal twitter youtube
  facebook android iphone windows
  charlie franklin madonna william robert michael richard thomas jackson jordan
  austin patrick matthew anthony benjamin brandon cameron douglas gregory
  jonathan lawrence nicholas timothy vincent wallace warren wesley morgan nelson
  oliver russell spencer stanley walker harris hunter marshall mitchell jennifer
  jessica melissa michelle patricia rebecca victoria samantha stephanie kimberly
  japan french china chinese india indian africa african america american europe
  european britain british england english ireland irish german germany spanish
  italian russian mexico canada brazil korea korean egypt greece greek poland
  polish sweden swedish norway denmark finland iceland holland dutch belgium
  peter smith martin shanghai licence quizzes
`.split(/\s+/).filter(Boolean);

const vowels = w => (w.match(/[aeiou]/g) || []).length;
const sortedKey = w => [...w].sort().join('');

function qualityFilter(freq, enableSet) {
  const byKey = new Map();
  freq.forEach(w => {
    if (!/^[a-z]+$/.test(w)) return;
    byKey.set(sortedKey(w), (byKey.get(sortedKey(w)) || 0) + 1);
  });
  const blocked = new Set(BLOCKLIST);

  return word => {
    if (!/^[a-z]+$/.test(word)) return false;
    if (!enableSet.has(word)) return false;
    if (blocked.has(word)) return false;
    if (byKey.get(sortedKey(word)) > 1) return false;                          // ambiguous letter set
    if (word.endsWith('s') && enableSet.has(word.slice(0, -1))) return false;
    if (word.endsWith('es') && enableSet.has(word.slice(0, -2))) return false;
    if (word.endsWith('ies') && enableSet.has(word.slice(0, -3) + 'y')) return false;
    if (word.length >= 7 && vowels(word) < 2) return false;
    if (vowels(word) < 1) return false;
    if (new Set(word).size < 3) return false;
    return true;
  };
}

/* ---------------- main ---------------- */

async function main() {
  const [enableLines, freqLines] = await Promise.all([cached(SOURCES.enable), cached(SOURCES.freq)]);
  const enableSet = new Set(enableLines.filter(Boolean));
  const freq = freqLines.filter(Boolean);
  const usable = qualityFilter(freq, enableSet);

  const used = publicWords();
  console.log(`public games already use ${used.all.size} words — every one of them is excluded`);

  const band = (from, to, minLen, maxLen) => freq
    .slice(from - 1, to)
    .filter(w => w.length >= minLen && w.length <= maxLen && usable(w) && !used.all.has(w));

  /* Shabda rooms play the 5-letter board, so its band is common 5-letter words.
     Anagram keeps the public game's two bands. */
  /* The bands run wider than the public game's because the public game has
     already taken the most common words in each one, and what is left still has
     to be big enough that a room does not see repeats. */
  const pools = {
    generated: new Date().toISOString().slice(0, 10),
    shabda: { five: band(1, 9999, 5, 5) },
    anagram: { easy: band(1, 5000, 5, 6), hard: band(2000, 9999, 7, 8) },
    snowman: { medium: [] }
  };

  /* Snowman: hand-written, minus anything the public book already holds. */
  const snowman = [];
  Object.keys(SNOWMAN_ROOM_BOOK).forEach(category => {
    SNOWMAN_ROOM_BOOK[category].forEach(phrase => {
      /* Against every public game, not just the public Snowman book: a word can
         be a Snowman answer here and an Anagram answer there. */
      if (used.all.has(phrase)) {
        console.log(`  snowman "${phrase}" is already used by a public game, dropped`);
        return;
      }
      if (!/^[a-z]+([ -][a-z]+)*$/.test(phrase)) {
        console.log(`  snowman "${phrase}" is malformed, dropped`);
        return;
      }
      snowman.push({ phrase, category });
    });
  });
  pools.snowman.medium = snowman;

  /* Every pool has to be big enough that a room can play a long session without
     seeing a repeat (SG-1.5 keeps a window of recent matches). */
  const sizes = {
    'shabda.five': pools.shabda.five.length,
    'anagram.easy': pools.anagram.easy.length,
    'anagram.hard': pools.anagram.hard.length,
    'snowman.medium': pools.snowman.medium.length
  };
  Object.entries(sizes).forEach(([name, size]) => {
    console.log(`${name.padEnd(16)} ${size}`);
    if (size < 60) throw new Error(`${name} is too small to avoid repeats (${size})`);
  });

  /* The partition is the whole point, so assert it rather than trusting it. */
  const roomWords = [
    ...pools.shabda.five,
    ...pools.anagram.easy,
    ...pools.anagram.hard,
    ...pools.snowman.medium.map(w => w.phrase)
  ];
  const overlap = roomWords.filter(w => used.all.has(w));
  if (overlap.length) throw new Error('room pool overlaps the public pool: ' + overlap.slice(0, 10).join(', '));

  fs.writeFileSync(OUT, JSON.stringify(pools, null, 1), 'utf8');
  console.log(`\nwrote pools.json — ${roomWords.length} room words, none shared with a public game`);
}

main().catch(err => { console.error(err.message); process.exit(1); });

/* Authors puzzles.json / puzzles.js — the dated manifest the game plays from.

   Everything expensive or network-bound happens here, once, at authoring time:
   frequency banding, the word-quality filters in section 6.2 of the spec, the
   dictionary check on every scramble (FR-2.4), and the definitions shown when a
   word is missed. The browser ships only the manifest.

   Run: node _gen-puzzles.js
   Sources are cached in the temp folder, so a second run is fast and offline. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const SCRAMBLE = require('./scramble.js');

const OUT_DIR = __dirname;
const DAYS = 400;                    // FR-1.5 wants at least a 180-day runway
const PRACTICE_WORDS = 80;           // words available once the day's puzzle is done

/* What "keep it simple" is worth in numbers. The top three thousand words is
   the band where an eight-letter anagram is still a word somebody recognises
   on sight; past that the length stops being the puzzle and recall starts. */
const RANK_LIMIT = 3000;
const MIN_LETTERS = 5;
const MAX_LETTERS = 8;
const LAUNCH_DATE = '2026-08-18';
const SCHEMA_VERSION = 1;

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

const DEFS_CACHE = path.join(os.tmpdir(), 'anagram-definitions.json');
const DICT_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

/* Nothing anyone wants to meet in a light daily puzzle. Section 6.2 asks for
   "offensive or distressing connotations" to be kept out; this is the blunt
   instrument for that, and it is meant to be extended rather than argued with. */
const BLOCKLIST = `
  death dead deadly died dies dying kill killed killing killer murder suicide
  weapon weapons gun guns rifle rifles bomb bombs bullet war wars army enemy
  attack attacks assault threat threats terror riot rebel violence violent
  blood bleeding wound wounded injury injured fatal victim victims corpse
  funeral grave graves coffin burial tomb
  cancer tumor tumour disease diseased illness disorder infection plague virus
  famine drought disaster crisis emergency
  prison prisons jail arrest arrested crime criminal fraud theft stolen
  slave slavery racist racism abuse abused torture trauma hostage
  drug drugs cocaine heroin addict addicted overdose alcoholic
  hate hatred anger angry panic fear afraid grief mourning divorce
  bankrupt debt poverty homeless refugee refugees
  piss pissing crap damn hell sexy naked nude breast breasts butt bitch bastard
  whore slut porn stripper erotic drunk vomit
`.split(/\s+/).filter(Boolean);

/* A frequency list built from the web carries plenty that FR-1.7 rules out.
   ENABLE does not help here: it holds japan (a varnish), french (to cut into
   strips) and charlie (the Vietcong) as ordinary nouns, so they pass every
   automated test while reading to a player as a name, a country or a slur.
   A names list was tried and rejected: it missed charlie and franklin while
   throwing out sapphire and sunshine. Curation it is - extend as needed. */
const NOT_ANSWERS = `
  grammar:
  their there these those which whose where while would could should might shall
  every other either neither being having itself myself himself herself yourself
  anyone anybody someone somebody everyone nothing nobody
  however therefore although because unless until whether always never often
  perhaps indeed rather quite still since though

  names:
  charlie franklin madonna william robert michael richard thomas jackson jordan
  austin patrick matthew anthony benjamin brandon cameron douglas gregory
  jonathan lawrence nicholas timothy vincent wallace warren wesley morgan murphy
  nelson oliver russell spencer stanley stewart sullivan walker harris hunter
  marshall mitchell preston sherman sidney sterling jennifer jessica melissa
  michelle patricia rebecca victoria samantha stephanie kimberly katherine
  barbara jeffrey gordon herbert leonard maurice raymond

  places:
  japan french china chinese india indian africa african america american europe
  european britain british england english ireland irish german germany spanish
  italian russian mexico canada brazil korea korean egypt greece greek poland
  polish sweden swedish norway denmark finland iceland holland dutch belgium
  austria hungary romania bulgaria ukraine turkey israel lebanon kuwait bahrain
  morocco tunisia algeria nigeria kenya uganda zambia malawi angola bolivia
  ecuador uruguay paraguay chile panama jamaica bahamas alaska hawaii florida
  georgia montana nevada oregon arizona indiana illinois michigan missouri
  nebraska oklahoma tennessee virginia wyoming ontario quebec toronto montreal
  chicago boston seattle denver phoenix atlanta dallas houston detroit memphis
  portland orlando london paris berlin madrid moscow tokyo sydney dublin vienna
  prague warsaw athens cairo delhi mumbai beijing bangkok jakarta manila nairobi

  brands:
  warcraft google yahoo verizon toyota honda nissan samsung nokia oracle adobe
  cisco intel xerox boeing disney pepsi nestle linux ubuntu firefox netscape
  myspace paypal twitter youtube facebook android iphone windows

  crude:
  fisting mistress lingerie orgasm condom brothel hooker nudity topless seduce
  pussy vibrator boobs penis vagina nipple nipples orgy sperm incest molest
  rape rapist pedophile abortion bestiality

  distressing, for the same reason as the blocklist above:
  obesity tsunami diabetes infected deviant alcohol smoking conflict warrior
  genocide massacre slaughter kidnap ransom stabbing shooting shooter gunman
  explosion casualties militant insurgent terrorist hitler stalin holocaust

  ambiguous spelling or a weak answer:
  licence quizzes peter smith martin shanghai
`.split(/\s+/).filter(w => w && !w.endsWith(':'));

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

/* ---------------- word quality ---------------- */

const vowels = w => (w.match(/[aeiou]/g) || []).length;
const sortedKey = w => [...w].sort().join('');

function buildPools(freq, enableSet) {
  /* A letter set that spells more than one word people actually know is out:
     LISTEN / SILENT / ENLIST is a puzzle with no single answer. The frequency
     list stands in for "words people actually know". */
  const byKey = new Map();
  freq.forEach(w => {
    if (!/^[a-z]+$/.test(w)) return;
    const k = sortedKey(w);
    byKey.set(k, (byKey.get(k) || 0) + 1);
  });

  const blocked = new Set([...BLOCKLIST, ...NOT_ANSWERS]);

  const usable = (word, rank) => {
    if (!/^[a-z]+$/.test(word)) return false;
    if (!enableSet.has(word)) return false;            // kills proper nouns and abbreviations
    if (blocked.has(word)) return false;
    if (byKey.get(sortedKey(word)) > 1) return false;  // ambiguous letter set
    if (word.endsWith('s') && enableSet.has(word.slice(0, -1))) return false;   // -s plural
    if (word.endsWith('es') && enableSet.has(word.slice(0, -2))) return false;  // -es plural
    if (word.endsWith('ies') && enableSet.has(word.slice(0, -3) + 'y')) return false;  // -ies plural
    if (word.length >= 7 && vowels(word) < 2) return false;   // RHYTHM, SPHINX
    if (vowels(word) < 1) return false;
    if (new Set(word).size < 3) return false;          // too little to scramble
    return true;
  };

  /* One pool, where there used to be a short-and-common one and a long-and-
     rarer one. The day is a single word now, and the point of it is that people
     keep coming back, so the length range widened and the rarity range did not:
     an eight-letter day is CHILDREN or QUESTION, a word everybody knows the
     moment the letters land, rather than something from the tail of the ten
     thousand. Length carries the difficulty; obscurity is not asked to help. */
  const pool = [];

  freq.forEach((word, i) => {
    const rank = i + 1;
    if (rank > RANK_LIMIT) return;
    if (word.length < MIN_LETTERS || word.length > MAX_LETTERS) return;
    if (!usable(word, rank)) return;
    pool.push(word);
  });

  return pool;
}

/* Fixed-seed shuffle so the running order is stable across regenerations: the
   same word never lands on two different dates between builds. */
function shuffledPool(pool, seedKey) {
  const rnd = SCRAMBLE.mulberry32(SCRAMBLE.hashString(seedKey));
  return SCRAMBLE.fisherYates(pool, rnd);
}

/* ---------------- definitions ---------------- */

/* Only successes are cached. A blank is usually the free dictionary rate
   limiting us rather than a word it has never heard of, and caching that would
   make the gap permanent. */
const defs = fs.existsSync(DEFS_CACHE) ? JSON.parse(fs.readFileSync(DEFS_CACHE, 'utf8')) : {};
let lookups = 0;

async function definitionFor(word) {
  if (defs[word]) return defs[word];

  const text = await lookup(word);
  lookups++;
  if (text) defs[word] = text;
  await new Promise(r => setTimeout(r, 120));          // stay under the rate limit
  return text;
}

function saveDefinitions() {
  fs.writeFileSync(DEFS_CACHE, JSON.stringify(defs), 'utf8');
}

async function lookup(word, attempt = 1) {
  try {
    const res = await fetch(DICT_URL + encodeURIComponent(word));
    /* 404 means the dictionary genuinely has no entry; anything else that is not
       OK is worth another go. */
    if (res.status !== 404 && !res.ok && attempt <= 4) {
      await new Promise(r => setTimeout(r, 700 * attempt));
      return lookup(word, attempt + 1);
    }
    if (!res.ok) return '';

    const body = await res.json();
    const meaning = body[0] && body[0].meanings && body[0].meanings[0];
    const sense = meaning && meaning.definitions && meaning.definitions[0];
    if (!sense || !sense.definition) return '';

    let text = String(sense.definition).replace(/\s+/g, ' ').trim();
    if (meaning.partOfSpeech) text = `(${meaning.partOfSpeech}) ${text}`;
    if (text.length > 130) text = text.slice(0, 127).replace(/[\s,;.]+\S*$/, '') + '...';
    return text;
  } catch {
    if (attempt <= 4) {
      await new Promise(r => setTimeout(r, 700 * attempt));
      return lookup(word, attempt + 1);
    }
    return '';
  }
}

/* ---------------- the manifest ---------------- */

const DAY_MS = 86400000;
const dateKey = ms => new Date(ms).toISOString().slice(0, 10);

async function main() {
  const [enableLines, freqLines] = await Promise.all([cached(SOURCES.enable), cached(SOURCES.freq)]);
  const enableSet = new Set(enableLines.filter(Boolean));
  const freq = freqLines.filter(Boolean);

  const pool = buildPools(freq, enableSet);
  console.log(`pool after filtering: ${pool.length} words of ${MIN_LETTERS}-${MAX_LETTERS} letters, top ${RANK_LIMIT}`);
  if (pool.length < DAYS + PRACTICE_WORDS) {
    throw new Error(`not enough words for ${DAYS} days and ${PRACTICE_WORDS} practice words`);
  }

  /* A fresh seed. The old one dealt a different pool, so keeping it would only
     imply a continuity that does not exist. */
  const words = shuffledPool(pool, 'anagram-single-v2');
  const isWord = w => enableSet.has(w);

  const launchMs = Date.parse(LAUNCH_DATE + 'T00:00:00Z');
  const notes = [];
  const days = [];

  /* One pointer, walking the pool. A word that cannot be scrambled cleanly is
     skipped rather than pushed onto a later date, so no word is ever used
     twice. */
  let wi = 0;

  console.log('picking words and looking up definitions...');

  for (let n = 0; n < DAYS; n++) {
    const date = dateKey(launchMs + n * DAY_MS);
    const pick = await takeWord(words, () => wi++, date, isWord, notes, 'daily');

    days.push({ n: n + 1, date, w: pick.word, s: pick.attempt, d: pick.definition });

    if ((n + 1) % 50 === 0) { saveDefinitions(); console.log(`  ${n + 1}/${DAYS} days`); }
  }

  saveDefinitions();

  /* A practice pool, kept apart from the calendar. Practice has to come from
     somewhere the daily never uses, or a spare five minutes would hand you the
     next few days' answers. Each entry carries its own accepted scramble, so a
     practice word is checked against the dictionary exactly like a daily one. */
  console.log('picking practice words...');
  const practice = [];

  for (let i = 0; i < PRACTICE_WORDS; i++) {
    const pick = await takeWord(words, () => wi++, `practice:${i}`, isWord, notes, 'practice');
    practice.push({
      w: pick.word,
      s: SCRAMBLE.scramble(pick.word, `practice:${pick.word}`, { isWord }).attempt,
      d: pick.definition
    });
    if ((i + 1) % 20 === 0) { saveDefinitions(); console.log(`  ${i + 1}/${PRACTICE_WORDS} practice words`); }
  }
  saveDefinitions();

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    launchDate: LAUNCH_DATE,
    days,
    practice
  };

  const json = JSON.stringify(manifest);
  fs.writeFileSync(path.join(OUT_DIR, 'puzzles.json'), JSON.stringify(manifest, null, 1), 'utf8');

  /* The same manifest as a plain script. Parea's games open straight off
     the filesystem, where fetch() of a local JSON file is blocked, so the
     loadable copy is a one-line global assignment. */
  fs.writeFileSync(path.join(OUT_DIR, 'puzzles.js'),
    '/* Generated by _gen-puzzles.js — do not edit by hand.\n' +
    '   The manifest in puzzles.json, wrapped so it loads without a server. */\n' +
    'window.ANAGRAM_MANIFEST = ' + json + ';\n', 'utf8');

  const missingDefs = days.filter(d => !d.d).length;   // should always be 0
  const byLength = {};
  days.forEach(d => { byLength[d.w.length] = (byLength[d.w.length] || 0) + 1; });
  console.log(`\nwrote ${days.length} days: ${days[0].date} to ${days[days.length - 1].date}`);
  console.log(`manifest ${(json.length / 1024).toFixed(0)} KB, ${missingDefs} days missing a definition, ${lookups} fresh lookups`);
  console.log(`lengths: ${Object.keys(byLength).sort().map(k => `${k}:${byLength[k]}`).join('  ')}`);
  console.log(`practice pool: ${practice.length} words`);
  notes.forEach(note => console.log('note: ' + note));
  verify(manifest, isWord);
}

/* Walks the pool until it finds a word that scrambles cleanly and has a
   definition to show when it is missed (FR-3.10). Anything that fails either
   test is passed over for good, so no word is ever used on two dates. */
async function takeWord(pool, advance, seedKey, isWord, notes, label) {
  for (let tries = 0; tries < 25; tries++) {
    const word = pool[advance()];
    if (!word) break;

    const result = SCRAMBLE.scramble(word, seedKey, { isWord });
    if (result.fallback) {
      notes.push(`${label} word "${word}" could not be scrambled cleanly, skipped`);
      continue;
    }

    const definition = await definitionFor(word);
    if (!definition) {
      notes.push(`${label} word "${word}" has no definition, skipped`);
      continue;
    }

    return { word, attempt: result.attempt, definition };
  }
  throw new Error(`ran out of ${label} words at ${seedKey}`);
}

/* A full sweep of the finished manifest, asserting the properties the spec
   promises. This is the authoring-time half of acceptance criterion 7. */
function verify(manifest, isWord) {
  const problems = [];
  const seen = new Set();

  /* The practice pool is swept alongside the calendar: a practice word is
     played exactly like a daily one and has to hold up the same way. */
  const entries = manifest.days.map(day => [day.w, day.s, day.date, day.date])
    .concat(manifest.practice.map(e => [e.w, e.s, `practice:${e.w}`, `practice ${e.w}`]));

  entries.forEach(([word, take, seedKey, label]) => {
    const replay = SCRAMBLE.scramble(word, seedKey, { take });
    if (replay.text === word) problems.push(`${label} scramble equals the word`);
    if (isWord(replay.text)) problems.push(`${label} scramble "${replay.text}" is a word`);
    if (SCRAMBLE.longestKeptRun(word, replay.text) > 2) problems.push(`${label} keeps a run of 3`);
    if (sortedKey(replay.text) !== sortedKey(word)) problems.push(`${label} letters do not match`);
    if (seen.has(word)) problems.push(`${label} repeats "${word}"`);
    seen.add(word);
    if (word.length < MIN_LETTERS || word.length > MAX_LETTERS) {
      problems.push(`${label} is the wrong length`);
    }
  });

  console.log(problems.length
    ? `\nSWEEP FAILED:\n  ${problems.slice(0, 20).join('\n  ')}`
    : `\nsweep clean: ${manifest.days.length} days and ${manifest.practice.length} practice words, every scramble differs from its word, spells nothing, keeps no run of three, and no word repeats anywhere`);
}

main().catch(err => { console.error(err.message); process.exit(1); });

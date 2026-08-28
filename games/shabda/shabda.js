/* Shabda — Sanskrit for "word", and a word-guessing game, written from scratch.
   Six guesses at a hidden word of 4, 5 or 6 letters. Teal = right letter right
   spot, amber = right letter wrong spot, grey = not in the word.
   Duplicate letters are scored the strict way: exact matches claim their copies
   first, then misplaced letters draw from whatever copies are left over. */

const ROWS = 6;
const DEFAULT_LEN = 5;

const KEY_LAYOUT = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['ENTER','z','x','c','v','b','n','m','BACK']
];

/* One record, for the word of the day. The board size is the day's business
   rather than the player's, so a per-length record would only fragment the same
   streak three ways. Unlimited never lands here at all. */
/* These keys are frozen. They read oddly now the site is called Parea, but
   they are the address of every player's streak: rename one and that
   player starts again from nothing. */
const STORE_STATS = 'arcade.shabda.stats';
const STORE_DAILY = 'arcade.shabda.daily';
/* An unlimited round in progress. Kept apart from the day's board so neither can
   overwrite the other, and so leaving the page mid-round is not a loss. */
const STORE_GAME = 'arcade.shabda.game';
/* Unlimited keeps its own record, in its own key. Nothing it does can reach
   the daily one above, which is the whole promise the mode is sold on. */
const STORE_UNLIMITED = 'arcade.shabda.unlimited';
const STORE_DICT = 'arcade.shabda.dict';
const STORE_HELP = 'arcade.shabda.seenHelp';

const boardEl = document.getElementById('board');
const keyboardEl = document.getElementById('keyboard');
const toastArea = document.getElementById('toast-area');
const modeBtns = [...document.querySelectorAll('.mode-btn')];

const state = {
  len: DEFAULT_LEN,
  answer: '',
  guesses: [],      // committed guesses, lowercase strings
  current: '',      // row being typed
  status: 'playing',// 'playing' | 'won' | 'lost'
  daily: true,      // false once the player asks for a random word
  puzzle: 0,
  busy: false       // true while a reveal or a lookup is running
};

/* `const` at top level does not attach to window, and _test.html drives the game
   through its real state rather than a copy — so publish it, exactly as Snowman
   and Anagram do. */
window.state = state;

/* ---------------- storage ---------------- */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage full — the game still plays, it just won't persist */
  }
}

function blankStats() {
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0] };
}

function loadStats() {
  const s = Object.assign(blankStats(), loadJSON(STORE_STATS, {}));
  if (!Array.isArray(s.dist) || s.dist.length !== ROWS) s.dist = [0, 0, 0, 0, 0, 0];
  return s;
}

let stats = loadStats();

/* A run is consecutive wins and nothing else. Unlimited has no day boundary, so
   a streak there would count free time rather than days returned to. */
function blankRun() {
  return { played: 0, wins: 0, run: 0, best: 0, dist: [0, 0, 0, 0, 0, 0] };
}

function loadRun() {
  const r = Object.assign(blankRun(), loadJSON(STORE_UNLIMITED, {}));
  if (!Array.isArray(r.dist) || r.dist.length !== ROWS) r.dist = [0, 0, 0, 0, 0, 0];
  return r;
}

let unlimited = loadRun();

function recordUnlimited(won, guessCount) {
  unlimited.played += 1;
  if (won) {
    unlimited.wins += 1;
    unlimited.run += 1;
    unlimited.best = Math.max(unlimited.best, unlimited.run);
    unlimited.dist[guessCount - 1] += 1;
  } else {
    unlimited.run = 0;
  }
  saveJSON(STORE_UNLIMITED, unlimited);
}

/* The daily record. Never called for an unlimited round. */
function recordResult(won, guessCount) {
  stats.played += 1;
  if (won) {
    stats.wins += 1;
    stats.streak += 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    stats.dist[guessCount - 1] += 1;
  } else {
    stats.streak = 0;
  }
  saveJSON(STORE_STATS, stats);
}

/* Both boards are written down, not just today's. An unlimited round used to
   live only in memory, so stepping away to another game and back dealt a new
   word and threw away the one being played. */
function saveGame() {
  saveJSON(state.daily ? STORE_DAILY : STORE_GAME, {
    puzzle: state.puzzle,
    len: state.len,
    answer: state.answer,
    guesses: state.guesses,
    /* The row being typed, so half a word survives the trip too. */
    current: state.current,
    status: state.status
  });
}

/* ---------------- build the DOM ---------------- */

function buildBoard() {
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--cols', String(state.len));

  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.row = String(r);
    row.style.setProperty('--cols', String(state.len));

    for (let c = 0; c < state.len; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.row = String(r);
      tile.dataset.col = String(c);
      tile.setAttribute('role', 'gridcell');
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
  }
}

function buildKeyboard() {
  keyboardEl.innerHTML = '';
  KEY_LAYOUT.forEach((rowKeys, i) => {
    const row = document.createElement('div');
    row.className = 'kb-row';
    if (i === 1) row.appendChild(spacer());

    rowKeys.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'key' + (k.length > 1 ? ' wide' : '');
      btn.dataset.key = k;
      btn.type = 'button';
      btn.textContent = k === 'BACK' ? String.fromCharCode(0x232B) : k;
      btn.addEventListener('click', () => handleKey(k));
      row.appendChild(btn);
    });

    if (i === 1) row.appendChild(spacer());
    keyboardEl.appendChild(row);
  });
}

function spacer() {
  const s = document.createElement('div');
  s.className = 'kb-spacer';
  return s;
}

const tileAt = (r, c) => boardEl.querySelector(`.tile[data-row="${r}"][data-col="${c}"]`);
const rowAt = r => boardEl.querySelector(`.row[data-row="${r}"]`);

/* ---------------- scoring ---------------- */

/* Returns an array of 'correct' | 'present' | 'absent', one per letter. */
function scoreGuess(guess, answer) {
  const n = answer.length;
  const result = new Array(n).fill('absent');
  const pool = {};

  // Pass 1: exact matches. Everything else goes into the leftover pool.
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      pool[answer[i]] = (pool[answer[i]] || 0) + 1;
    }
  }

  // Pass 2: misplaced letters, but only while copies remain unclaimed.
  for (let i = 0; i < n; i++) {
    if (result[i] === 'correct') continue;
    const ch = guess[i];
    if (pool[ch] > 0) {
      result[i] = 'present';
      pool[ch] -= 1;
    }
  }

  return result;
}

/* ---------------- rendering ---------------- */

function renderCurrentRow() {
  const r = state.guesses.length;
  if (r >= ROWS) return;
  for (let c = 0; c < state.len; c++) {
    const tile = tileAt(r, c);
    const ch = state.current[c] || '';
    tile.textContent = ch;
    tile.classList.toggle('filled', ch !== '');
  }
}

const KEY_RANK = { absent: 1, present: 2, correct: 3 };

function paintKey(letter, verdict) {
  const key = keyboardEl.querySelector(`.key[data-key="${letter}"]`);
  if (!key) return;
  const currentRank = KEY_RANK[key.dataset.state] || 0;
  if (KEY_RANK[verdict] <= currentRank) return; // never downgrade a key
  key.dataset.state = verdict;
  key.classList.remove('correct', 'present', 'absent');
  key.classList.add(verdict);
}

/* Reveal a committed guess with the staggered flip. */
function revealRow(rowIndex, guess, verdicts, animate = true) {
  const step = animate ? 300 : 0;

  for (let c = 0; c < guess.length; c++) {
    const tile = tileAt(rowIndex, c);
    if (!tile) continue;
    tile.textContent = guess[c];
    tile.classList.add('filled');

    if (!animate) {
      tile.classList.add(verdicts[c]);
      paintKey(guess[c], verdicts[c]);
      continue;
    }

    setTimeout(() => {
      tile.classList.add('flip');
      // Colour swaps at the halfway point, while the tile is edge-on.
      setTimeout(() => {
        tile.classList.add(verdicts[c]);
        paintKey(guess[c], verdicts[c]);
      }, 250);
    }, c * step);
  }

  return animate ? (guess.length - 1) * step + 500 : 0;
}

function bounceRow(rowIndex) {
  for (let c = 0; c < state.len; c++) {
    setTimeout(() => {
      const t = tileAt(rowIndex, c);
      if (t) t.classList.add('bounce');
    }, c * 100);
  }
}

function shakeRow(rowIndex) {
  const row = rowAt(rowIndex);
  if (!row) return;
  row.classList.add('shake');
  setTimeout(() => row.classList.remove('shake'), 500);
}

/* Pass ms = 0 for a toast that stays until you call .dismiss() on it. */
function toast(message, ms = 1600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  toastArea.appendChild(el);

  el.dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  };

  if (ms > 0) setTimeout(el.dismiss, ms);
  return el;
}

/* ---------------- input ---------------- */

function handleKey(key) {
  if (state.busy || state.status !== 'playing') return;
  if (document.querySelector('.modal:not([hidden])')) return;

  if (key === 'ENTER') return submitGuess();
  if (key === 'BACK') {
    state.current = state.current.slice(0, -1);
    renderCurrentRow();
    return saveGame();
  }
  if (/^[a-z]$/.test(key) && state.current.length < state.len) {
    state.current += key;
    renderCurrentRow();
    saveGame();
  }
}

/* ---------------- word checking ----------------
   The built-in list holds every word in the ENABLE lexicon at this length, so
   almost anything real is accepted outright. A guess that still misses it gets a
   second opinion from a dictionary before we call it junk:
     in the local list      -> accept immediately, no network
     dictionary says yes    -> accept, and remember it for next time
     dictionary says no     -> junk, ask for another word (no try is spent)
     dictionary unreachable -> accept it. A real word must never be refused
                               because the network is down. */

const DICT_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const LOOKUP_TIMEOUT_MS = 6000;

/* word -> true (real) | false (junk), carried across sessions so repeat guesses
   and offline play still work once a word has been checked. */
const dictCache = loadJSON(STORE_DICT, {});

function rememberWord(word, isReal) {
  dictCache[word] = isReal;
  saveJSON(STORE_DICT, dictCache);
}

/* Resolves true (real word), false (not a word), or null (could not check). */
async function lookupInDictionary(word) {
  if (typeof fetch !== 'function') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(DICT_URL + encodeURIComponent(word), { signal: controller.signal });
    if (res.status === 404) return false;   // the API's "no such word"
    if (res.ok) return true;
    return null;                            // rate limited or server hiccup
  } catch {
    return null;                            // offline, blocked, or timed out
  } finally {
    clearTimeout(timer);
  }
}

/* 'accept' | 'reject' — and it handles its own user feedback. */
async function checkGuess(word, rowIndex) {
  if (WORDS.isValid(word) || dictCache[word] === true) return 'accept';

  if (dictCache[word] === false) {
    shakeRow(rowIndex);
    toast('Not a word we know — try another');
    return 'reject';
  }

  // Unknown word: ask the dictionary. Lock input so nothing changes mid-flight.
  state.busy = true;
  const checking = toast('Checking…', 0);
  const isReal = await lookupInDictionary(word);
  checking.dismiss();
  state.busy = false;

  if (isReal === true) {
    rememberWord(word, true);
    return 'accept';
  }
  if (isReal === false) {
    rememberWord(word, false);
    shakeRow(rowIndex);
    toast('Not a word — try another');
    return 'reject';
  }

  /* Unverifiable. The guess is outside our list but may well be a real word, and
     turning away a legitimate guess is the worse failure, so let it through and
     spend the try. Deliberately not cached: the next lookup gets a fresh chance.
     The exception is a string with no vowel in it. The lexicon already failed to
     recognise it, and English words this short without a vowel are vanishingly
     rare, so that is a mashed keyboard rather than a word we happen to be missing. */
  if (!/[aeiouy]/.test(word)) {
    shakeRow(rowIndex);
    toast('Not a word — try another');
    return 'reject';
  }
  return 'accept';
}

async function submitGuess() {
  const rowIndex = state.guesses.length;
  const guess = state.current;
  const lenAtSubmit = state.len;

  if (guess.length < state.len) {
    shakeRow(rowIndex);
    toast('Not enough letters');
    return;
  }

  const verdict = await checkGuess(guess, rowIndex);
  // The player may have finished, restarted, or switched length mid-lookup.
  if (verdict !== 'accept') return;
  if (state.status !== 'playing' || state.len !== lenAtSubmit || state.guesses.length !== rowIndex) return;

  const verdicts = scoreGuess(guess, state.answer);
  state.guesses.push(guess);
  state.current = '';
  state.busy = true;

  const revealMs = revealRow(rowIndex, guess, verdicts, true);

  setTimeout(() => {
    state.busy = false;
    finishTurn(rowIndex, guess);
  }, revealMs);
}

/* One for each row, so the praise is proportional to how few guesses it took.
   Ours, not the ones the genre is used to — a game explaining itself in another
   game's words is a game with nothing of its own to say. */
const WIN_WORDS = ['Uncanny', 'Sharp', 'Tidy', 'Solid', 'Cut it fine', 'Just in time'];

function finishTurn(rowIndex, guess) {
  if (guess === state.answer) {
    state.status = 'won';
    bounceRow(rowIndex);
    toast(WIN_WORDS[rowIndex] || 'Nice', 2200);
  } else if (state.guesses.length >= ROWS) {
    state.status = 'lost';
    toast(state.answer.toUpperCase(), 4000);
  }

  /* Only the word of the day counts here. Unlimited rounds have no day to be
     counted against, so letting them touch this record would make the streak
     meaningless: twenty days of streak in ten minutes, without a day passing. */
  if (state.status !== 'playing' && state.daily) {
    recordResult(state.status === 'won', state.guesses.length);
    TODAY.set('shabda', state.status);
  } else if (state.status !== 'playing') {
    recordUnlimited(state.status === 'won', state.guesses.length);
  }

  saveGame();
  updateCountdown();
  if (state.status !== 'playing') {
    if (state.daily) setTimeout(showStats, state.status === 'won' ? 2000 : 2400);
    else setTimeout(() => toast('Your streak is safe here', 2400), 1200);
  }
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    document.querySelectorAll('.modal:not([hidden])').forEach(m => (m.hidden = true));
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); return handleKey('ENTER'); }
  if (e.key === 'Backspace') { e.preventDefault(); return handleKey('BACK'); }

  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) handleKey(k);
});


/* ---------------- next puzzle ----------------
   Only worth showing once today's word is settled: while you are still playing
   there is no deadline, and an unlimited round has nothing to wait for. */

function updateCountdown() {
  const show = state.daily && state.status !== 'playing';
  const node = document.getElementById('next-up');
  if (!node) return;

  node.hidden = !show;
  if (show) document.getElementById('countdown').textContent = DAILY.untilRollover();
}

setInterval(updateCountdown, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateCountdown(); });

/* ---------------- modals ---------------- */

function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(el) { el.hidden = true; }

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.hasAttribute('data-close')) closeModal(modal);
  });
});

document.getElementById('btn-help').addEventListener('click', () => openModal('help-modal'));
document.getElementById('btn-stats').addEventListener('click', showStats);

/* The refresh is the only way to another word now, so it has to be careful with
   the one in front of you. It is dead on today's board — there is one word a day
   and no amount of pressing makes a second — and in Unlimited it asks first if
   there is anything to lose. Nothing is recorded either way: a word you walked
   away from is not a word you played. */
function newWordAllowed() {
  return !state.daily;
}

function markNewButton() {
  const btn = document.getElementById('btn-new');
  if (!btn) return;
  btn.disabled = !newWordAllowed();
  btn.title = newWordAllowed()
    ? 'Another word'
    : 'One word a day — switch to Unlimited for more';
}

document.getElementById('btn-new').addEventListener('click', () => {
  if (!newWordAllowed()) return;

  const started = state.status === 'playing' &&
    (state.guesses.length > 0 || state.current.length > 0);
  if (started && !confirm('Give up on this word and take another?')) return;

  startGame({ daily: false, fresh: true });
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  closeModal(document.getElementById('stats-modal'));
  startGame({ daily: false, fresh: true });
});

/* Which record the panel is showing.

   It opened on the day whatever you were playing, which meant somebody four
   rounds into Unlimited pressed Results and was shown a board they were not on,
   with their own rounds one tab away. The tab now follows the game: through
   Today you get today, through Unlimited you get Unlimited.

   Set on the way in rather than inside openStats, because the two tabs inside
   the panel reopen it to redraw — deciding there would snap the panel back the
   instant anyone tried to look at the other one. */
let statsMode = 'daily';

function showStats() {
  statsMode = state.daily ? 'daily' : 'unlimited';
  openStats();
}

/* Streak and run are the same arithmetic asked of different things, so the two
   records hold the same shape and only the words change. A streak counts days
   returned to; a run counts wins in a row, which is all Unlimited can honestly
   measure without a day boundary to hang on. */
function markStatsModes() {
  document.querySelectorAll('.stat-mode-btn').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.stat === statsMode ? 'true' : 'false'));

  const daily = statsMode === 'daily';
  document.getElementById('st-scope-daily').hidden = !daily;
  document.getElementById('st-scope-unlimited').hidden = daily;
  document.getElementById('st-streak-lbl').textContent = daily ? 'Current streak' : 'Current run';
  document.getElementById('st-max-lbl').textContent = daily ? 'Max streak' : 'Best run';
}

document.querySelectorAll('.stat-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.stat === statsMode) return;
    statsMode = btn.dataset.stat;
    openStats();
  });
});

function openStats() {
  TODAY.offerNext('shabda', {
    container: document.getElementById('next-game'),
    link: document.getElementById('next-game-link'),
    note: document.getElementById('next-game-note')
  });

  markStatsModes();
  const daily = statsMode === 'daily';
  const shown = daily ? stats : unlimited;

  document.getElementById('st-len').textContent = String(state.len);
  document.getElementById('st-played').textContent = shown.played;
  document.getElementById('st-win').textContent =
    shown.played ? Math.round((shown.wins / shown.played) * 100) : 0;
  document.getElementById('st-streak').textContent = daily ? shown.streak : shown.run;
  document.getElementById('st-max').textContent = daily ? shown.maxStreak : shown.best;

  const max = Math.max(1, ...shown.dist);
  const dist = document.getElementById('dist');
  dist.innerHTML = '';

  shown.dist.forEach((count, i) => {
    const row = document.createElement('div');
    row.className = 'dist-row';

    const key = document.createElement('div');
    key.className = 'dist-key';
    key.textContent = String(i + 1);

    const bar = document.createElement('div');
    bar.className = 'dist-bar';
    bar.style.width = `${Math.max(7, (count / max) * 100)}%`;
    bar.textContent = String(count);
    /* Only mark the bar the round just played landed in, and only on the tab
       that round was actually recorded against. */
    if (state.status === 'won' && state.guesses.length === i + 1 && daily === state.daily) {
      bar.classList.add('current');
    }

    row.append(key, bar);
    dist.appendChild(row);
  });

  document.getElementById('btn-share').disabled = state.status === 'playing';
  window.statsMode = statsMode;      // the harness drives the real panel
  openModal('stats-modal');
}

/* ---------------- share ---------------- */

const EMOJI = { correct: '\u{1F7E9}', present: '\u{1F7E8}', absent: '\u{2B1B}' };

function shareText() {
  const score = state.status === 'won' ? state.guesses.length : 'X';
  const label = state.daily
    ? `Shabda #${state.puzzle} · ${state.len} letters`
    : `Shabda · ${state.len} letters (unlimited)`;
  const grid = state.guesses
    .map(g => scoreGuess(g, state.answer).map(v => EMOJI[v]).join(''))
    .join('\n');
  return `${label} ${score}/${ROWS}\n\n${grid}`;
}

document.getElementById('btn-share').addEventListener('click', async () => {
  if (state.status === 'playing') return;
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    // clipboard API needs a secure context; fall back to the old select-and-copy trick
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); }
    catch { toast('Copy failed'); }
    ta.remove();
  }
});

/* ---------------- length picker ---------------- */

function markModeButtons() {
  modeBtns.forEach(b => {
    const isToday = b.dataset.mode === 'daily';
    b.setAttribute('aria-pressed', (isToday ? state.daily : !state.daily) ? 'true' : 'false');
  });
}

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.busy) return;

    const wantsToday = btn.dataset.mode === 'daily';
    if (wantsToday === state.daily) return;

    /* No dialog either way: today's game is saved as you go, and an unlimited
       game is unlimited. Dropping one is worth a word, not a decision. */
    const dropping = !state.daily && state.status === 'playing' && state.guesses.length > 0;

    if (wantsToday) {
      startGame({ daily: true });
      toast(dropping ? 'Unlimited word dropped'
                     : state.status === 'playing' ? "Today's word" : "Today's word is already done");
      return;
    }
    startGame({ daily: false });
  });
});

/* ---------------- game setup ---------------- */

/* `fresh` is how you ask for a new word rather than the one already going: the
   refresh button, Play another, and the stats panel's Play again all want a deal
   rather than a resume. Everything else resumes. */
function startGame({ daily, fresh = false }) {
  const saved = fresh ? null : loadJSON(daily ? STORE_DAILY : STORE_GAME, null);
  const sane = !!saved && typeof saved.answer === 'string' && WORDS.supports(saved.answer.length);

  /* Today's board is whatever the calendar says, and a saved day that does not
     match it is yesterday's. An unlimited round has no calendar to answer to, so
     it comes back on the board it was dealt on, however long that is. */
  const dailyLen = WORDS.dailyLength();
  const resume = daily
    ? sane && saved.puzzle === WORDS.puzzleNumber() && saved.answer.length === dailyLen
    : sane && saved.status === 'playing';

  const wanted = resume ? saved.answer.length : (daily ? dailyLen : WORDS.unlimitedLength());
  state.len = WORDS.supports(wanted) ? wanted : DEFAULT_LEN;
  state.daily = daily;
  state.guesses = [];
  state.current = '';
  state.status = 'playing';
  state.busy = false;
  state.puzzle = WORDS.puzzleNumber();

  stats = loadStats();

  buildBoard();
  buildKeyboard();
  markModeButtons();
  markNewButton();
  /* Clears whatever the last round left at the foot of the page — the clock or
     the way on to the next word — without waiting for the next tick. */
  updateCountdown();

  if (resume) {
    // Exactly where it was left: the rows played, and the row part-typed.
    state.answer = saved.answer;
    state.status = saved.status || 'playing';
    state.guesses = Array.isArray(saved.guesses) ? saved.guesses.slice(0, ROWS) : [];
    state.guesses.forEach((g, i) => revealRow(i, g, scoreGuess(g, state.answer), false));

    const typed = typeof saved.current === 'string' ? saved.current : '';
    state.current = state.status === 'playing' ? typed.slice(0, state.len) : '';
    renderCurrentRow();

    if (daily) TODAY.set('shabda', state.status);

    /* Coming back to a day already played used to be met with the results
       panel over the board, which is a popup nobody asked for: the result is
       a thing you have already seen. The finished board is left up the way
       the other two games leave theirs, with the countdown to the next word
       under it and the Results button in the header for anyone who wants the
       record again. The panel still opens by itself the moment a round ends,
       which is the one time it has something to say. */
    updateCountdown();
    return;
  }

  if (daily) {
    state.answer = WORDS.dailyWord(state.len);
    TODAY.set('shabda', 'playing');
  } else {
    state.answer = WORDS.randomWord(state.len);
    toast(`${state.len} letters. Your streak is safe here.`);
  }
  saveGame();
}

/* Today's word is the front door — unless an unlimited round was left part
   played, in which case that is what the page was in the middle of and that is
   what it comes back to. Merely having opened Unlimited does not count: a word
   dealt and never touched is not something anyone is waiting to finish. */
const pending = loadJSON(STORE_GAME, null);
startGame({
  daily: !(pending && pending.status === 'playing' &&
           ((Array.isArray(pending.guesses) && pending.guesses.length > 0) ||
            (typeof pending.current === 'string' && pending.current.length > 0)))
});

// First-time visitors get the rules up front.
if (!localStorage.getItem(STORE_HELP)) {
  openModal('help-modal');
  try { localStorage.setItem(STORE_HELP, '1'); } catch { /* ignore */ }
}

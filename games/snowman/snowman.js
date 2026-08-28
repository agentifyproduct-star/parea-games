/* Snowman — six wrong guesses and there is nothing left but a puddle.

   Hangman's rules, with hangman's drawing running backwards: the snowman starts
   whole and loses a piece per wrong guess, so the picture is also the lives
   counter, and losing means something melted rather than someone died. Snowman
   is the name classrooms have used for this version for years.

   Decisions worth knowing before reading on:
     - spaces and hyphens are revealed from the start; only letters are guessed
     - a whole-word guess is allowed, and a wrong one costs a life like any miss
     - repeating a letter you already tried is free: it is a slip, not a guess
     - everything is lowercase internally and uppercased for display only
     - a word is not repeated until its difficulty pool has been used up */

const LIVES = 6;
const DEFAULT_LEVEL = 'medium';

/* Lost in this order, one per wrong guess — least missed first, so the snowman
   is recognisably in trouble long before it is gone. The ids match the SVG. */
const MELT_ORDER = ['hat', 'scarf', 'arm-left', 'arm-right', 'head', 'body'];

const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm']
];

/* The record belongs to the word of the day and nothing else. Unlimited rounds are
   unlimited, so counting them would turn a streak into a measure of free time. */
/* These keys are frozen. They read oddly now the site is called Parea, but
   they are the address of every player's streak: rename one and that
   player starts again from nothing. */
const STORE_STATS = 'arcade.snowman.stats';
const STORE_DAILY = 'arcade.snowman.daily';
const STORE_USED = level => `arcade.snowman.used.${level}`;
const STORE_GAME = 'arcade.snowman.game';
/* Unlimited keeps its own record, in its own key. Nothing it does can reach
   the daily one, which is the whole promise the mode is sold on. */
const STORE_UNLIMITED = 'arcade.snowman.unlimited';
const STORE_HELP = 'arcade.snowman.seenHelp';

const wordEl = document.getElementById('word');
const keyboardEl = document.getElementById('keyboard');
const guessedEl = document.getElementById('guessed');
const livesEl = document.getElementById('lives');
const categoryEl = document.getElementById('category');
const toastArea = document.getElementById('toast-area');
const wordGuessForm = document.getElementById('word-guess');
const wordGuessInput = document.getElementById('word-guess-input');
const modeBtns = [...document.querySelectorAll('.mode-btn')];

const state = {
  level: DEFAULT_LEVEL,
  daily: true,           // false once the player asks for an unlimited word
  puzzle: 0,
  secretWord: '',        // lowercase, may contain spaces or hyphens
  category: '',
  guessedLetters: new Set(),
  wrongGuesses: 0,
  hintUsed: false,
  hintText: '',
  status: 'playing'      // 'playing' | 'won' | 'lost'
};

/* `const` at top level does not attach to window, and _test.html drives the game
   through its real state rather than a copy — so publish it. Function
   declarations below are already global; this is the only binding that is not. */
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
  if (!Array.isArray(s.dist) || s.dist.length !== LIVES) s.dist = [0, 0, 0, 0, 0, 0];
  return s;
}

let stats = loadStats();

/* A run is consecutive wins and nothing else. Unlimited has no day boundary, so
   a streak there would count free time rather than days returned to. */
function blankRun() {
  return { played: 0, wins: 0, run: 0, best: 0, dist: [0, 0, 0, 0, 0, 0, 0] };
}

function loadRun() {
  const r = Object.assign(blankRun(), loadJSON(STORE_UNLIMITED, {}));
  if (!Array.isArray(r.dist) || r.dist.length !== LIVES + 1) {
    r.dist = new Array(LIVES + 1).fill(0);
  }
  return r;
}

let unlimited = loadRun();

function recordUnlimited(won, wrongGuesses) {
  unlimited.played += 1;
  if (won) {
    unlimited.wins += 1;
    unlimited.run += 1;
    unlimited.best = Math.max(unlimited.best, unlimited.run);
    unlimited.dist[wrongGuesses] += 1;
  } else {
    unlimited.run = 0;
  }
  saveJSON(STORE_UNLIMITED, unlimited);
}

function recordResult(won, wrongGuesses) {
  stats.played += 1;
  if (won) {
    stats.wins += 1;
    stats.streak += 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    stats.dist[wrongGuesses] += 1;   // 0 wrong lands in the first bar
  } else {
    stats.streak = 0;
  }
  saveJSON(STORE_STATS, stats);
}

/* Words already played at this difficulty, so a session does not repeat itself.
   Kept per level and reset by pick() once the pool is exhausted. */
function loadUsed(level) {
  const used = loadJSON(STORE_USED(level), []);
  return Array.isArray(used) ? used : [];
}

function rememberUsed(level, phrase) {
  const used = loadUsed(level);
  if (used.includes(phrase)) return;
  used.push(phrase);

  /* Once every word has been seen, start the cycle over rather than growing a
     list that can never be satisfied. */
  if (used.length >= SNOWMAN_WORDS.atLevel(level).length) {
    saveJSON(STORE_USED(level), [phrase]);
    return;
  }
  saveJSON(STORE_USED(level), used);
}

function saveGame() {
  const snapshot = {
    level: state.level,
    daily: state.daily,
    puzzle: state.puzzle,
    secretWord: state.secretWord,
    category: state.category,
    guessedLetters: [...state.guessedLetters],
    wrongGuesses: state.wrongGuesses,
    hintUsed: state.hintUsed,
    hintText: state.hintText,
    status: state.status
  };

  /* The day's game is kept apart from unlimited, so starting an unlimited round
     never loses where you had got to on today's word. */
  saveJSON(state.daily ? STORE_DAILY : STORE_GAME, snapshot);
}

/* ---------------- the word ---------------- */

const isLetter = ch => /^[a-z]$/.test(ch);

/* True once every letter in the answer has been guessed. Separators do not
   count — they were never hidden. */
function isSolved() {
  return [...state.secretWord].every(ch => !isLetter(ch) || state.guessedLetters.has(ch));
}

/* The masked answer, one entry per character, for rendering and for tests. */
function maskedWord() {
  return [...state.secretWord].map(ch => {
    if (!isLetter(ch)) return { char: ch, revealed: true, separator: true };
    const revealed = state.guessedLetters.has(ch) || state.status === 'lost';
    return {
      char: ch,
      revealed,
      separator: false,
      missed: state.status === 'lost' && !state.guessedLetters.has(ch)
    };
  });
}

/* The player-facing string: underscores for what is still hidden. */
function maskedText() {
  return maskedWord().map(c => (c.separator ? c.char : c.revealed ? c.char : '_')).join('');
}

/* ---------------- guessing ---------------- */

/* Returns why the guess did what it did, which is what the tests assert on:
   'hit' | 'miss' | 'duplicate' | 'invalid' | 'over'. Only a miss costs a life. */
function guessLetter(raw) {
  if (state.status !== 'playing') return 'over';

  const ch = String(raw || '').toLowerCase();
  if (!isLetter(ch)) return 'invalid';

  if (state.guessedLetters.has(ch)) return 'duplicate';
  state.guessedLetters.add(ch);

  const hit = state.secretWord.includes(ch);
  if (!hit) state.wrongGuesses += 1;

  finishTurn();
  return hit ? 'hit' : 'miss';
}

/* A whole-word attempt. Right ends the game; wrong costs a life, exactly as a
   wrong letter does — otherwise guessing the word would be free. */
function guessWord(raw) {
  if (state.status !== 'playing') return 'over';

  const attempt = String(raw || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!attempt || !/^[a-z]+([ -][a-z]+)*$/.test(attempt)) return 'invalid';

  if (attempt === state.secretWord) {
    /* Fill in whatever is still hidden so the finished board reads properly. */
    [...state.secretWord].forEach(ch => { if (isLetter(ch)) state.guessedLetters.add(ch); });
    finishTurn();
    return 'win';
  }

  state.wrongGuesses += 1;
  finishTurn();
  return 'miss';
}

function finishTurn() {
  if (isSolved()) {
    state.status = 'won';
  } else if (state.wrongGuesses >= LIVES) {
    state.status = 'lost';
  }

  render();
  saveGame();

  if (state.daily && state.status !== 'playing') TODAY.set('snowman', state.status);

  if (state.status === 'won') {
    if (state.daily) recordResult(true, state.wrongGuesses);
    else recordUnlimited(true, state.wrongGuesses);
    toast(WIN_WORDS[state.wrongGuesses] || 'Saved', 2200);
  } else if (state.status === 'lost') {
    if (state.daily) recordResult(false, state.wrongGuesses);
    else recordUnlimited(false, state.wrongGuesses);
    toast(state.secretWord.toUpperCase(), 4000);
  }

  if (state.status === 'playing') return;

  /* The record only moves on the word of the day, so only the day's game has
     anything to show afterwards. */
  if (state.daily) setTimeout(showStats, state.status === 'won' ? 1400 : 2000);
  else setTimeout(() => toast('Your streak is safe here', 2400), 1600);
}

const WIN_WORDS = ['Flawless', 'Superb', 'Neat', 'Nicely done', 'Close one', 'By a thread'];

/* ---------------- rendering ---------------- */

/* ---------------- the hint ----------------

   Snowman's words carry a category and nothing else, so there is no written
   clue to hand out the way the [redacted] board has one. What there is instead is the
   word itself: the hint names a letter that is in it and has not been found,
   and leaves the player to go and press it. That is a nudge rather than a free
   move, which is the difference between a hint and a gift.

   Held back until two guesses have actually cost something. Offered before that
   it would just be a faster way to play, and the category on its own is enough
   for most words. One a round, and it travels with the round, so leaving the
   page and coming back does not hand out a second.

   hintUsed is written down for that reason and no other. It is deliberately
   kept out of the record, the results line and the share text — which is where
   Anagram does put its own, so the two games genuinely differ here rather than
   one of them having been missed. A hint that turns up in the score you send
   people is a hint nobody takes, and a feature nobody takes is not a feature.
   Changing that means changing it on purpose, not tidying up an oversight. */
const HINT_AFTER = 2;

function hintAvailable() {
  return state.status === 'playing' && !state.hintUsed && state.wrongGuesses >= HINT_AFTER;
}

function hintFor() {
  const letters = [...state.secretWord].filter(isLetter);
  const first = letters[0];

  if (first && !state.guessedLetters.has(first)) {
    return 'It starts with ' + first.toUpperCase() + '.';
  }

  const missing = letters.find(ch => !state.guessedLetters.has(ch));
  if (!missing) return 'Every letter is already up there.';
  return 'There is a ' + missing.toUpperCase() + ' in it.';
}

function renderHint() {
  const btn = document.getElementById('btn-hint');
  const line = document.getElementById('hint');
  if (!btn || !line) return;

  btn.disabled = !hintAvailable();
  btn.hidden = state.hintUsed;
  btn.title = hintAvailable()
    ? 'One clue about the word'
    : 'A clue, after ' + HINT_AFTER + ' wrong letters';

  line.textContent = state.hintText;
}

document.getElementById('btn-hint').addEventListener('click', () => {
  if (!hintAvailable()) return;
  state.hintUsed = true;
  state.hintText = hintFor();
  saveGame();
  render();
  /* The toast area is the page's live region, so saying it there is also how a
     screen reader hears it. */
  toast(state.hintText, 3200);
});

function render() {
  updateCountdown();
  renderWord();
  renderFigure();
  renderKeyboard();
  renderGuessed();
  renderLives();
  renderHint();

  categoryEl.textContent = state.category;
  wordGuessInput.disabled = state.status !== 'playing';
  wordGuessForm.querySelector('button').disabled = state.status !== 'playing';
}

function renderWord() {
  wordEl.innerHTML = '';
  wordEl.setAttribute('aria-label', `Word: ${maskedText()}`);

  maskedWord().forEach(cell => {
    if (cell.separator) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = cell.char === '-' ? '-' : '';
      wordEl.appendChild(sep);
      return;
    }
    const slot = document.createElement('span');
    slot.className = 'slot' + (cell.revealed ? ' revealed' : '') + (cell.missed ? ' missed' : '');
    slot.textContent = cell.revealed ? cell.char : '';
    wordEl.appendChild(slot);
  });
}

function renderFigure() {
  MELT_ORDER.forEach((part, i) => {
    const el = document.getElementById(`part-${part}`);
    if (el) el.classList.toggle('gone', i < state.wrongGuesses);
  });

  /* The puddle is the last frame: it only appears once everything else has. */
  const melted = state.wrongGuesses >= LIVES;
  document.querySelectorAll('.puddle').forEach(el => el.classList.toggle('shown', melted));
}

function buildKeyboard() {
  keyboardEl.innerHTML = '';
  KEY_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';

    row.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'key';
      btn.dataset.key = k;
      btn.type = 'button';
      btn.textContent = k;
      btn.addEventListener('click', () => handleLetter(k));
      rowEl.appendChild(btn);
    });

    keyboardEl.appendChild(rowEl);
  });
}

function renderKeyboard() {
  keyboardEl.querySelectorAll('.key').forEach(btn => {
    const k = btn.dataset.key;
    const used = state.guessedLetters.has(k);
    btn.classList.toggle('hit', used && state.secretWord.includes(k));
    btn.classList.toggle('miss', used && !state.secretWord.includes(k));
    btn.disabled = used || state.status !== 'playing';
  });
}

function renderGuessed() {
  const letters = [...state.guessedLetters].sort();
  guessedEl.innerHTML = '';

  if (!letters.length) {
    guessedEl.innerHTML = '<span class="none">no letters tried yet</span>';
    return;
  }

  letters.forEach(ch => {
    const tag = document.createElement('span');
    tag.className = 'tried ' + (state.secretWord.includes(ch) ? 'hit' : 'miss');
    tag.textContent = ch;
    guessedEl.appendChild(tag);
  });
}

function renderLives() {
  const left = LIVES - state.wrongGuesses;
  livesEl.innerHTML = '';
  livesEl.setAttribute('aria-label', `${left} of ${LIVES} lives left`);

  for (let i = 0; i < LIVES; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < left ? '' : ' spent');
    livesEl.appendChild(pip);
  }

  const label = document.createElement('span');
  label.className = 'lives-text';
  label.textContent = `${left} left`;
  livesEl.appendChild(label);
}


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

/* ---------------- toast ---------------- */

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

function shakeFigure() {
  const stage = document.getElementById('stage');
  stage.classList.add('shake');
  setTimeout(() => stage.classList.remove('shake'), 450);
}

/* ---------------- input ---------------- */

/* One entry point for the on-screen keyboard and the physical one, so the
   feedback for a repeat or a dead key is identical either way. */
function handleLetter(k) {
  const verdict = guessLetter(k);
  if (verdict === 'duplicate') toast(`${k.toUpperCase()} already tried`);
  else if (verdict === 'miss') shakeFigure();
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    document.querySelectorAll('.modal:not([hidden])').forEach(m => (m.hidden = true));
    return;
  }

  // The whole-word box has its own submit handler; stay out of its way.
  if (document.activeElement === wordGuessInput) return;
  if (document.querySelector('.modal:not([hidden])')) return;

  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) handleLetter(k);
});

wordGuessForm.addEventListener('submit', e => {
  e.preventDefault();
  const attempt = wordGuessInput.value;
  if (!attempt.trim()) return;

  const verdict = guessWord(attempt);
  wordGuessInput.value = '';

  if (verdict === 'invalid') toast('Letters and spaces only');
  else if (verdict === 'miss') { shakeFigure(); toast('Not the word — that cost a life'); }
});

/* ---------------- new games ---------------- */

/* Today's word: the same one for every player, wherever they are. */
function startDaily() {
  const today = SNOWMAN_WORDS.daily();

  state.daily = true;
  state.puzzle = SNOWMAN_WORDS.puzzleNumber();
  state.secretWord = today ? today.phrase : '';
  state.category = today ? today.category : '';
  state.guessedLetters = new Set();
  state.wrongGuesses = 0;
  state.hintUsed = false;
  state.hintText = '';
  state.status = 'playing';

  stats = loadStats();
  TODAY.set('snowman', 'playing');
  markModeButtons();
  render();
  saveGame();
}

/* An unlimited word. The tier is rolled per word off the gentler of the two
   tables, so nobody picks it and hard never turns up here. */
function startGame() {
  state.level = SNOWMAN_WORDS.unlimitedLevel();

  const pick = SNOWMAN_WORDS.pick(state.level, loadUsed(state.level));
  state.daily = false;
  state.puzzle = 0;
  state.secretWord = pick ? pick.phrase : '';
  state.category = pick ? pick.category : '';
  state.guessedLetters = new Set();
  state.wrongGuesses = 0;
  state.hintUsed = false;
  state.hintText = '';
  state.status = 'playing';

  stats = loadStats();
  rememberUsed(state.level, state.secretWord);
  markModeButtons();
  render();
  saveGame();
}

/* Restores a game so a refresh is not a loss. Anything that does not line up with
   the current word book, or with today, is discarded rather than trusted. */
function restore(key, { finished = false } = {}) {
  const saved = loadJSON(key, null);
  if (!saved || typeof saved.secretWord !== 'string' || !saved.secretWord) return false;
  if (!SNOWMAN_WORDS.levels.includes(saved.level)) return false;

  /* Yesterday's game is not today's game. */
  if (saved.daily && saved.puzzle !== SNOWMAN_WORDS.puzzleNumber()) return false;
  if (!finished && saved.status !== 'playing') return false;

  state.level = saved.level;
  state.daily = !!saved.daily;
  state.puzzle = Number(saved.puzzle) || 0;
  state.secretWord = saved.secretWord;
  state.category = saved.category || '';
  state.guessedLetters = new Set(Array.isArray(saved.guessedLetters) ? saved.guessedLetters : []);
  state.wrongGuesses = Number(saved.wrongGuesses) || 0;
  state.hintUsed = !!saved.hintUsed;
  state.hintText = typeof saved.hintText === 'string' ? saved.hintText : '';
  state.status = saved.status === 'won' || saved.status === 'lost' ? saved.status : 'playing';

  if (state.status === 'playing' && (state.wrongGuesses >= LIVES || isSolved())) return false;

  stats = loadStats();
  if (state.daily) TODAY.set('snowman', state.status);
  markModeButtons();
  render();
  return true;
}

/* A declaration, not a const arrow: the page and _test.html both reach for this
   by name, and a const never attaches to window. */
function restoreGame() {
  return restore(STORE_GAME);
}

function markModeButtons() {
  markNewButton();
  modeBtns.forEach(btn => {
    const isDaily = btn.dataset.mode === 'daily';
    btn.setAttribute('aria-pressed', String(isDaily ? state.daily : !state.daily));
  });
}

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const wantsDaily = btn.dataset.mode === 'daily';
    if (wantsDaily === state.daily) return;

    if (wantsDaily) {
      /* Coming back to today's word picks it up where it was left, finished or not. */
      if (!restore(STORE_DAILY, { finished: true })) startDaily();
      toast(state.status === 'playing' ? "Today's word" : "Today's word is already done");
      return;
    }

    /* And coming back to Unlimited picks up the round in progress, rather than
       dealing over the top of it. Stepping away to today's word and back used to
       cost you the word you were on and every letter you had spent on it. */
    if (restoreGame()) {
      toast(state.guessedLetters.size ? 'Back to your word' : 'Your streak is safe here');
      return;
    }

    startGame();
    toast('Your streak is safe here');
  });
});

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

/* The refresh is the only way to another word now. Dead on today's word, since
   there is one a day, and in Unlimited it asks before throwing away a round with
   letters already spent on it. Nothing is recorded: a word walked away from is
   not a word played. */
function markNewButton() {
  const btn = document.getElementById('btn-new');
  if (!btn) return;
  btn.disabled = state.daily;
  btn.title = state.daily
    ? 'One word a day — switch to Unlimited for more'
    : 'Another word';
}

document.getElementById('btn-new').addEventListener('click', () => {
  if (state.daily) return;

  const started = state.status === 'playing' && state.guessedLetters.size > 0;
  if (started && !confirm('Give up on this word and take another?')) return;

  startGame();
  toast('Your streak is safe here');
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
  TODAY.offerNext('snowman', {
    container: document.getElementById('next-game'),
    link: document.getElementById('next-game-link'),
    note: document.getElementById('next-game-note')
  });
  markStatsModes();
  const daily = statsMode === 'daily';
  const shown = daily ? stats : unlimited;

  document.getElementById('st-played').textContent = shown.played;
  document.getElementById('st-win').textContent =
    shown.played ? Math.round((shown.wins / shown.played) * 100) : 0;
  document.getElementById('st-streak').textContent = daily ? shown.streak : shown.run;
  document.getElementById('st-max').textContent = daily ? shown.maxStreak : shown.best;

  const outcome = document.getElementById('st-outcome');
  outcome.textContent = state.status === 'won'
    ? `You got it: ${state.secretWord.toUpperCase()}`
    : state.status === 'lost'
      ? `The word was ${state.secretWord.toUpperCase()}`
      : '';
  outcome.hidden = state.status === 'playing';

  const max = Math.max(1, ...shown.dist);
  const dist = document.getElementById('dist');
  dist.innerHTML = '';

  shown.dist.forEach((count, wrong) => {
    const row = document.createElement('div');
    row.className = 'dist-row';

    const key = document.createElement('div');
    key.className = 'dist-key';
    key.textContent = String(wrong);

    const bar = document.createElement('div');
    bar.className = 'dist-bar';
    bar.style.width = `${Math.max(7, (count / max) * 100)}%`;
    bar.textContent = String(count);
    /* Only mark the bar the round just played landed in, and only on the tab
       that round was actually recorded against. */
    if (state.status === 'won' && state.wrongGuesses === wrong && daily === state.daily) {
      bar.classList.add('current');
    }

    row.append(key, bar);
    dist.appendChild(row);
  });

  openModal('stats-modal');
}

/* ---------------- boot ---------------- */

buildKeyboard();

/* Today's word is the front door — unless an unlimited round was left part
   played, in which case that is what the page was in the middle of and that is
   what it comes back to. A word dealt and never touched does not count: nobody
   is waiting to finish a round they never started. */
const pending = loadJSON(STORE_GAME, null);
const midRound = !!pending && pending.status === 'playing' &&
  Array.isArray(pending.guessedLetters) && pending.guessedLetters.length > 0;

if (midRound && restoreGame()) {
  /* nothing else to do: the round is back on screen */
} else if (!restore(STORE_DAILY)) {
  const dailyDone = restore(STORE_DAILY, { finished: true });
  if (!dailyDone) startDaily();
  else if (!restoreGame()) render();
}

if (!loadJSON(STORE_HELP, false)) {
  openModal('help-modal');
  saveJSON(STORE_HELP, true);
}

/* Anagram — two scrambled words a day, the same two for everybody.

   The shape of the thing:
     - puzzles.js carries a dated manifest: which words fall on which date, and
       which candidate in each scramble sequence was accepted at authoring time
     - scramble.js replays that sequence here, so the arrangement is identical on
       every device and every load, with no dictionary shipped to the browser
     - the day rolls over at midnight in New York, the same instant for everyone,
       so shared results line up wherever people are
     - progress is written after every attempt, never only at the end */

const ATTEMPTS = 5;
const HINT_AFTER = 3;            // failed attempts on word 2 before a hint is offered
const SCHEMA_VERSION = 1;
const STORE_KEY = 'arcade.anagram.v1';
const SLOTS = ['word1', 'word2'];

const DAY_MS = 86400000;
const manifest = window.ANAGRAM_MANIFEST || null;

/* ---------------- storage ----------------
   Storage may be unavailable (private mode, blocked cookies). The game still
   plays; it just cannot remember anything, and says so rather than pretending. */

const storage = (() => {
  try {
    const probe = '__anagram__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
})();

const storageAvailable = storage !== null;

function blankProgress(date) {
  return {
    date,
    word1: { solved: false, attemptsUsed: 0, guesses: [], resolved: false },
    word2: { solved: false, attemptsUsed: 0, guesses: [], resolved: false, hintUsed: false, unlocked: false }
  };
}

function blankDistribution() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, failed: 0 };
}

function blankStats() {
  return {
    daysPlayed: 0,
    daysBothSolved: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastCompletedDate: '',
    /* Not in the spec's table, but the streak has to know whether today has
       already counted — otherwise solving word 2 would increment it twice. */
    lastStreakDate: '',
    distribution: { word1: blankDistribution(), word2: blankDistribution() }
  };
}

function blankSave() {
  return {
    schemaVersion: SCHEMA_VERSION,
    lastPlayedDate: '',
    progress: null,
    stats: blankStats()
  };
}

/* Anything unparseable, or from a schema we do not know, is dropped and the
   visit treated as a first one. Never surfaced as an error. */
function loadSave() {
  if (!storage) return blankSave();
  try {
    const raw = storage.getItem(STORE_KEY);
    if (!raw) return blankSave();

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return blankSave();

    const save = Object.assign(blankSave(), parsed);
    save.stats = Object.assign(blankStats(), parsed.stats);
    save.stats.distribution = {
      word1: Object.assign(blankDistribution(), (parsed.stats || {}).distribution?.word1),
      word2: Object.assign(blankDistribution(), (parsed.stats || {}).distribution?.word2)
    };
    return save;
  } catch {
    return blankSave();
  }
}

function persist() {
  if (practice) return;      // a practice round is never saved
  if (!storage) return;
  try {
    storage.setItem(STORE_KEY, JSON.stringify(save));
  } catch {
    /* Quota or a mid-session revocation: keep playing, keep quiet. */
  }
}

const save = loadSave();

/* ---------------- dates ----------------
   Everything is a plain YYYY-MM-DD string, and which day it is comes from
   assets/daily.js: the date as it reads in New York. Never the device's own
   timezone, so two players on opposite sides of the world get the same puzzle
   at the same moment (decision D-1). */

const todayKey = () => DAILY.key();
const keyToMs = key => DAILY.keyToMs(key);
const dayGap = (from, to) => DAILY.daysBetween(from, to);

function nextRolloverMs() {
  return DAILY.nextRollover();
}

/* ---------------- the puzzle ---------------- */

function puzzleFor(date) {
  if (!manifest || !Array.isArray(manifest.days)) return null;
  return manifest.days.find(d => d.date === date) || null;
}

function remainingDays(date) {
  if (!manifest) return 0;
  return manifest.days.filter(d => d.date >= date).length;
}

/* A practice round, when one is running: its own words and its own progress,
   held in memory only. Nothing about it is written down, which is what keeps it
   away from the day's game and the record. */
let practice = null;

const state = {
  puzzleDate: '',
  puzzleNumber: 0,
  day: null,              // the manifest entry
  activeSlot: 'word1',    // word1 | word2 | results
  tiles: [],              // [{ letter }] in tray order
  placed: [],             // per answer position: tile index, or null
  lockedSlots: [],        // positions the hint filled in and pinned
  gameStatus: 'idle',     // idle | playing | slotResolved | dayComplete
  revealed: false         // the answer panel is showing
};

window.state = state;     // `const` does not attach to window; the tests drive this

/* Word and scramble for a slot. The scramble is replayed from the manifest's
   accepted-attempt number, never re-decided here. */
function wordFor(slot) {
  const day = practice ? practice.day : state.day;
  if (!day) return '';
  return slot === 'word1' ? day.w1 : day.w2;
}

function definitionFor(slot) {
  const day = practice ? practice.day : state.day;
  if (!day) return '';
  return slot === 'word1' ? day.d1 : day.d2;
}

function scrambleFor(slot) {
  const word = wordFor(slot);

  /* Practice words carry their own accepted arrangement, checked at authoring
     time just like the daily ones. */
  if (practice) {
    const entry = slot === 'word1' ? practice.day.e1 : practice.day.e2;
    return SCRAMBLE.scramble(word, `practice:${word}`, { take: entry.s }).text;
  }

  const take = slot === 'word1' ? state.day.s1 : state.day.s2;
  const result = SCRAMBLE.scramble(word, `${state.puzzleDate}:${slot === 'word1' ? 1 : 2}`, { take });

  /* The manifest was swept at authoring time; if that ever stops holding, say so
     rather than handing the player the answer unscrambled. */
  if (result.text === word) console.error(`anagram: scramble for ${word} equals the word`);
  return result.text;
}

const progressFor = slot => (practice ? practice.progress[slot] : save.progress[slot]);

/* ---------------- elements ---------------- */

const el = id => document.getElementById(id);
const trayEl = el('tray');
const slotsEl = el('slots');
const historyEl = el('history');
const messageEl = el('message');
const liveEl = el('live');

/* Anagram says most things inline; a practice round needs one passing word that
   does not belong to either puzzle slot. */
function toast(text) {
  message(text, 'info');
}

function announce(text) {
  liveEl.textContent = text;      // UI-2.6: every state change reaches a screen reader
}

function message(text, tone = 'info') {
  messageEl.textContent = text;
  messageEl.className = 'message ' + tone;
  if (text) announce(text);
}

/* ---------------- building a slot ---------------- */

function beginSlot(slot) {
  state.activeSlot = slot;
  state.revealed = false;
  state.revealMissed = false;
  state.lockedSlots = [];

  const scrambled = scrambleFor(slot);
  state.tiles = [...scrambled].map(letter => ({ letter }));
  state.placed = new Array(wordFor(slot).length).fill(null);

  const progress = progressFor(slot);
  state.gameStatus = progress.resolved ? 'slotResolved' : 'playing';

  /* A hint taken earlier in the day is part of the restored position. */
  if (slot === 'word2' && progress.hintUsed && !progress.resolved) applyHint(true);

  /* A word that is over shows its answer and stays put. */
  if (progress.resolved) revealOnBoard(slot);

  message('');
  render();
  announce(`${slotLabel(slot)}. ${wordFor(slot).length} letters. ${attemptsLeft(slot)} attempts left.`);
}

const slotLabel = slot => (slot === 'word1' ? 'Word 1 of 2' : 'Word 2 of 2');

/* Spells the answer out across the slots using the tiles already on the board,
   so a finished word stays readable instead of leaving an empty frame. */
function revealOnBoard(slot) {
  const answer = wordFor(slot);
  const used = new Set();

  state.placed = [...answer].map(letter => {
    const index = state.tiles.findIndex((tile, i) => tile.letter === letter && !used.has(i));
    if (index !== -1) used.add(index);
    return index === -1 ? null : index;
  });

  /* No padlocks: that marker means the hint pinned a letter. These slots are
     already beyond touching, because the word is over. */
  state.revealMissed = !progressFor(slot).solved;
}
const attemptsLeft = slot => ATTEMPTS - progressFor(slot).attemptsUsed;

/* ---------------- tiles ---------------- */

const usedTileIndexes = () => new Set(state.placed.filter(i => i !== null));
const currentInput = () => state.placed.map(i => (i === null ? '' : state.tiles[i].letter)).join('');
const nextEmptySlot = () => state.placed.findIndex(i => i === null);

function placeTile(tileIndex) {
  if (state.gameStatus !== 'playing') return false;
  if (usedTileIndexes().has(tileIndex)) return false;

  const pos = nextEmptySlot();
  if (pos === -1) return false;

  state.placed[pos] = tileIndex;
  render();
  return true;
}

function removeAt(pos) {
  if (state.gameStatus !== 'playing') return false;
  if (state.lockedSlots.includes(pos)) return false;    // the hint stays put
  if (state.placed[pos] === null) return false;

  state.placed[pos] = null;
  render();
  return true;
}

function removeLast() {
  for (let pos = state.placed.length - 1; pos >= 0; pos--) {
    if (state.placed[pos] !== null && !state.lockedSlots.includes(pos)) return removeAt(pos);
  }
  return false;
}

/* Typing: takes the first unused tile carrying that letter, which is what makes
   repeated letters work — tiles are tracked by index, never by character. */
function typeLetter(letter) {
  if (state.gameStatus !== 'playing') return false;
  const used = usedTileIndexes();
  const tileIndex = state.tiles.findIndex((t, i) => t.letter === letter && !used.has(i));

  if (tileIndex === -1) {
    message(`No ${letter.toUpperCase()} left to place`, 'warn');
    return false;
  }
  return placeTile(tileIndex);
}

function clearInput() {
  if (state.gameStatus !== 'playing') return;
  state.placed = state.placed.map((tile, pos) => (state.lockedSlots.includes(pos) ? tile : null));
  message('');
  render();
  announce('Input cleared');
}

/* Free and unlimited: reorders the tray only. The puzzle, the attempts and the
   letters are all untouched. */
function shuffleTiles() {
  const used = usedTileIndexes();
  const positionOf = new Map();
  state.placed.forEach((tileIndex, pos) => { if (tileIndex !== null) positionOf.set(tileIndex, pos); });

  const order = state.tiles.map((tile, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const remap = new Map();
  order.forEach((oldIndex, newIndex) => remap.set(oldIndex, newIndex));

  state.tiles = order.map(i => state.tiles[i]);
  state.placed = state.placed.map(tileIndex => (tileIndex === null ? null : remap.get(tileIndex)));

  render();
  announce('Letters shuffled');
}

/* ---------------- hints ---------------- */

const hintAvailable = () =>
  state.activeSlot === 'word2' &&
  state.gameStatus === 'playing' &&
  !progressFor('word2').hintUsed &&
  progressFor('word2').attemptsUsed >= HINT_AFTER;

function applyHint(restoring = false) {
  const progress = progressFor('word2');
  if (!restoring && !hintAvailable()) return false;

  const first = wordFor('word2')[0];
  const used = usedTileIndexes();
  const tileIndex = state.tiles.findIndex((t, i) => t.letter === first && !used.has(i));

  /* If that letter is already sitting somewhere else, take it back first. */
  if (tileIndex === -1) {
    const holder = state.placed.findIndex(i => i !== null && state.tiles[i].letter === first);
    if (holder !== -1) state.placed[holder] = null;
  }

  const free = state.tiles.findIndex((t, i) => t.letter === first && !usedTileIndexes().has(i));
  if (free === -1) return false;

  if (state.placed[0] !== null) state.placed[0] = null;
  state.placed[0] = free;
  state.lockedSlots = [0];

  progress.hintUsed = true;
  if (!restoring) {
    persist();
    message(`Hint: the word starts with ${first.toUpperCase()}`, 'info');
    announce(`Hint used. The word starts with ${first.toUpperCase()}.`);
  }
  render();
  return true;
}

/* ---------------- submitting ---------------- */

const sortedLetters = word => [...word].sort().join('');

/* 'empty' | 'short' | 'letters' | 'duplicate' | 'correct' | 'wrong' — the caller
   is the UI, and the tests read these directly. Only 'correct' and 'wrong' cost
   an attempt. */
function submitGuess() {
  if (state.gameStatus !== 'playing') return 'over';

  const slot = state.activeSlot;
  const progress = progressFor(slot);
  const answer = wordFor(slot);
  const guess = currentInput();

  if (!guess) { message('Put some letters down first', 'warn'); return 'empty'; }
  if (guess.length !== answer.length) { message('Use all of the letters', 'warn'); return 'short'; }
  if (sortedLetters(guess) !== sortedLetters(scrambleFor(slot))) {
    message('Those are not your letters', 'warn');
    return 'letters';
  }
  if (progress.guesses.includes(guess)) {
    message('Already tried that one', 'warn');
    shake();
    return 'duplicate';
  }

  notePlayed();

  if (guess === answer) {
    progress.solved = true;
    progress.attemptsUsed += 1;
    progress.guesses.push(guess);
    resolveSlot(slot, true);
    return 'correct';
  }

  progress.attemptsUsed += 1;
  progress.guesses.push(guess);
  persist();

  if (progress.attemptsUsed >= ATTEMPTS) {
    resolveSlot(slot, false);
    return 'wrong';
  }

  /* UI-2.5: shake, empty the answer, leave the tiles where they are. */
  shake();
  clearInput();
  const left = attemptsLeft(slot);
  message(`Not it — ${left} tr${left === 1 ? 'y' : 'ies'} left`, 'bad');
  return 'wrong';
}

/* Giving up on a word counts as a failure for that word (decision D-3). */
function skipSlot() {
  if (state.gameStatus !== 'playing') return false;
  resolveSlot(state.activeSlot, false);
  return true;
}

function resolveSlot(slot, solved) {
  const progress = progressFor(slot);
  progress.solved = solved;
  progress.resolved = true;
  state.gameStatus = 'slotResolved';

  if (!practice) {
    const bucket = save.stats.distribution[slot];
    if (solved) bucket[progress.attemptsUsed] = (bucket[progress.attemptsUsed] || 0) + 1;
    else bucket.failed += 1;
  }

  if (solved) noteSolved();
  if (slot === 'word1') progressFor('word2').unlocked = true;

  const both = progressFor('word1').solved && progressFor('word2').solved;
  const done = progressFor('word1').resolved && progressFor('word2').resolved;
  if (done && !practice) {
    save.stats.lastCompletedDate = state.puzzleDate;
    if (both) save.stats.daysBothSolved += 1;
  }

  persist();
  showReveal(slot, solved);
}

/* ---------------- streak bookkeeping ----------------
   FR-6.3 / FR-6.4, and the help panel says all of this out loud. */

function notePlayed() {
  if (practice) return;
  if (save.lastPlayedDate === state.puzzleDate) return;

  /* A calendar day with no play at all is the only thing that breaks a streak. */
  if (save.lastPlayedDate && dayGap(save.lastPlayedDate, state.puzzleDate) > 1) {
    save.stats.currentStreak = 0;
  }
  save.lastPlayedDate = state.puzzleDate;
  save.stats.daysPlayed += 1;
  persist();
}

function noteSolved() {
  if (practice) return;
  if (save.stats.lastStreakDate === state.puzzleDate) return;   // once a day, not once a word
  save.stats.currentStreak += 1;
  save.stats.maxStreak = Math.max(save.stats.maxStreak, save.stats.currentStreak);
  save.stats.lastStreakDate = state.puzzleDate;
  persist();
}

/* ---------------- reveal and advance ---------------- */

let revealTimer = null;

function showReveal(slot, solved) {
  state.revealed = true;
  const answer = wordFor(slot);

  el('reveal-title').textContent = solved ? 'Got it' : 'The word was';
  el('reveal-word').textContent = answer.toUpperCase();
  el('reveal-def').textContent = definitionFor(slot);
  el('reveal').hidden = false;
  el('reveal').classList.toggle('good', solved);

  announce(solved
    ? `Correct. ${answer}. ${definitionFor(slot)}`
    : `Out of attempts. The word was ${answer}. ${definitionFor(slot)}`);

  render();

  /* A win needs a beat; a loss needs long enough to read the definition. Either
     way Continue is there for anyone who does not want to wait. */
  clearTimeout(revealTimer);
  revealTimer = setTimeout(advance, solved ? 1600 : 5200);
}

function advance() {
  clearTimeout(revealTimer);
  el('reveal').hidden = true;
  state.revealed = false;

  if (state.activeSlot === 'word1' && !progressFor('word2').resolved) {
    beginSlot('word2');
    return;
  }
  showResults();
}

function markModeButtons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const isToday = btn.dataset.mode === 'daily';
    btn.setAttribute('aria-pressed', String(isToday ? !practice : !!practice));
  });
}

/* ---------------- practice ----------------
   Once the day's puzzle is done there is nothing left to play, which is a poor
   way to treat someone who wants another go. Practice deals a fresh pair from a
   pool the calendar never touches, so it can be played as often as you like
   without ever showing you a word that is due tomorrow. */

function startPractice() {
  const pool = manifest && manifest.practice;
  if (!pool || !pool.easy.length || !pool.hard.length) {
    toast('No practice words available');
    return false;
  }

  const short = pool.easy[Math.floor(Math.random() * pool.easy.length)];
  const long = pool.hard[Math.floor(Math.random() * pool.hard.length)];

  practice = {
    day: { w1: short.w, w2: long.w, d1: short.d, d2: long.d, e1: short, e2: long },
    progress: blankProgress('practice')
  };

  state.activeSlot = 'word1';
  el('results').hidden = true;
  beginSlot('word1');
  toast('Practice round — nothing counts');
  return true;
}

function leavePractice() {
  practice = null;
  clearTimeout(revealTimer);
  el('reveal').hidden = true;
  state.revealed = false;
  showResults();
}

/* ---------------- results ---------------- */

function showResults() {
  /* The board stays on screen with the last word spelled out, the way the other
     two games leave their finished puzzle up. This panel sits underneath it,
     and the record itself lives behind the statistics button. */
  state.activeSlot = 'word2';
  beginSlot('word2');

  /* beginSlot draws while the slot is merely resolved; the finished view only
     appears once the day is marked complete, so draw again. */
  state.gameStatus = 'dayComplete';
  render();
  el('results').hidden = false;

  markModeButtons();
  const inPractice = !!practice;
  el('results-heading').textContent = inPractice ? 'Practice round over' : 'Done for today';
  el('btn-share').hidden = inPractice;
  el('btn-back-to-today').hidden = !inPractice;
  el('practice-note').hidden = !inPractice;
  el('next-up').hidden = inPractice;

  el('res-word1').textContent = wordFor('word1').toUpperCase();
  el('res-word2').textContent = wordFor('word2').toUpperCase();
  el('res-attempt1').textContent = outcomeText('word1');
  el('res-attempt2').textContent = outcomeText('word2');

  updateCountdown();
  announce((inPractice ? 'Practice round over. ' : 'Puzzle complete. ') +
           shareText().split(String.fromCharCode(10)).join('. '));
}

function outcomeText(slot) {
  const p = progressFor(slot);
  if (!p.solved) return 'missed';
  return `${p.attemptsUsed} attempt${p.attemptsUsed === 1 ? '' : 's'}${p.hintUsed ? ', hint' : ''}`;
}

function renderDistribution() {
  const wrap = el('dist');
  wrap.innerHTML = '';

  SLOTS.forEach(slot => {
    const head = document.createElement('h4');
    head.textContent = slot === 'word1' ? 'Word 1' : 'Word 2';
    wrap.appendChild(head);

    const bucket = save.stats.distribution[slot];
    const keys = ['1', '2', '3', '4', '5', 'failed'];
    const max = Math.max(1, ...keys.map(k => bucket[k] || 0));
    const todayAttempts = progressFor(slot).solved ? String(progressFor(slot).attemptsUsed) : 'failed';

    keys.forEach(key => {
      const row = document.createElement('div');
      row.className = 'dist-row';

      const label = document.createElement('div');
      label.className = 'dist-key';
      label.textContent = key === 'failed' ? 'X' : key;

      const bar = document.createElement('div');
      bar.className = 'dist-bar' + (key === todayAttempts ? ' current' : '');
      bar.style.width = `${Math.max(8, ((bucket[key] || 0) / max) * 100)}%`;
      bar.textContent = String(bucket[key] || 0);

      row.append(label, bar);
      wrap.appendChild(row);
    });
  });
}

/* ---------------- share ----------------
   Emoji only: five markers per word, one per attempt spent, a lamp where a hint
   was taken. No letter of either answer appears, and there is no link to leak
   one either. */

function shareLine(slot) {
  const p = progressFor(slot);
  const icon = slot === 'word1' ? '1️⃣' : '2️⃣';

  let marks;
  if (p.solved) {
    marks = '\u{1F7E9}'.repeat(p.attemptsUsed);
    if (p.hintUsed) marks += '\u{1F4A1}';
    marks += '⬜'.repeat(Math.max(0, ATTEMPTS - p.attemptsUsed - (p.hintUsed ? 1 : 0)));
  } else {
    marks = '\u{1F7E5}'.repeat(ATTEMPTS - (p.hintUsed ? 1 : 0));
    if (p.hintUsed) marks += '\u{1F4A1}';
  }

  const score = p.solved ? `(${p.attemptsUsed}${p.hintUsed ? ', hint' : ''})` : '(X)';
  return `${icon} ${marks} ${score}`;
}

function shareText() {
  const lines = [`Anagram #${state.puzzleNumber}`, shareLine('word1'), shareLine('word2')];
  if (save.stats.currentStreak > 0) lines.push(`\u{1F525} ${save.stats.currentStreak} day streak`);
  return lines.join('\n');
}

async function copyShare() {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    message('Copied to clipboard', 'good');
  } catch {
    /* The Clipboard API needs a secure context; fall back to select-and-copy. */
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      message('Copied to clipboard', 'good');
    } catch {
      message('Copy failed — select the text above', 'warn');
    }
    ta.remove();
  }
}

/* ---------------- countdown ----------------
   Recomputed from the clock every tick rather than counted down, so a sleeping
   tab cannot drift (TR-5). */

function updateCountdown() {
  const node = el('countdown');
  if (node) node.textContent = DAILY.untilRollover();
}

/* The date can turn over while the tab sits open. Say so; never swap the puzzle
   under the player's hands (FR-5.5). */
function checkRollover() {
  if (!state.puzzleDate) return;
  if (todayKey() !== state.puzzleDate) el('banner').hidden = false;
}

/* ---------------- rendering ---------------- */

function render() {
  markModeButtons();
  renderTray();
  renderSlots();
  renderAttempts();
  renderHistory();

  const finished = state.gameStatus === 'dayComplete';
  el('slot-label').textContent = finished
    ? (practice ? 'Practice words' : "Today's words")
    : slotLabel(state.activeSlot === 'results' ? 'word2' : state.activeSlot);

  /* Nothing left to do with the tray, the controls or the attempt count. */
  el('tray').hidden = finished;
  el('controls').hidden = finished;
  el('btn-submit').hidden = finished;
  el('attempts-row').hidden = finished;
  el('streak').textContent = save.stats.currentStreak;
  /* During practice the day number would be a lie, and the streak is not at
     stake either way. */
  el('puzzle-no').textContent = practice ? 'Practice' : '#' + state.puzzleNumber;

  const playing = state.gameStatus === 'playing';
  el('btn-submit').disabled = !playing;
  el('btn-clear').disabled = !playing;
  el('btn-shuffle').disabled = !playing;
  el('btn-skip').disabled = !playing;

  const hintBtn = el('btn-hint');
  hintBtn.hidden = state.activeSlot !== 'word2' || progressFor('word2').hintUsed;
  hintBtn.disabled = !hintAvailable();
  hintBtn.title = hintAvailable()
    ? 'Reveal the first letter'
    : `Available after ${HINT_AFTER} wrong attempts`;
}

function renderTray() {
  const used = usedTileIndexes();
  trayEl.innerHTML = '';

  state.tiles.forEach((tile, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile' + (used.has(i) ? ' spent' : '');
    btn.textContent = tile.letter;
    btn.dataset.tile = String(i);
    btn.disabled = used.has(i) || state.gameStatus !== 'playing';
    /* UI-2.9: the spent state is carried by the label too, not by colour alone. */
    btn.setAttribute('aria-label', used.has(i) ? `${tile.letter}, used` : `Letter ${tile.letter}`);
    btn.addEventListener('click', () => placeTile(i));
    trayEl.appendChild(btn);
  });
}

function renderSlots() {
  slotsEl.innerHTML = '';

  /* Once the day is done, both words are worth seeing — the first one is just
     as much a part of today as the one that happened to be last. */
  if (state.gameStatus === 'dayComplete') return renderBothWords();

  state.placed.forEach((tileIndex, pos) => {
    const locked = state.lockedSlots.includes(pos);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'answer-slot' + (tileIndex === null ? ' empty' : ' filled') +
                    (locked ? ' locked' : '') +
                    (state.revealMissed && tileIndex !== null ? ' missed' : '');
    btn.textContent = tileIndex === null ? '' : state.tiles[tileIndex].letter;
    btn.dataset.pos = String(pos);
    btn.disabled = tileIndex === null || locked || state.gameStatus !== 'playing';
    btn.setAttribute('aria-label', tileIndex === null
      ? `Position ${pos + 1}, empty`
      : `Position ${pos + 1}, ${state.tiles[tileIndex].letter}${locked ? ', from the hint' : ''}`);
    btn.addEventListener('click', () => removeAt(pos));
    slotsEl.appendChild(btn);
  });
}

/* Both answers, spelled out, each behind its own number. */
function renderBothWords() {
  SLOTS.forEach((slot, i) => {
    const row = document.createElement('div');
    row.className = 'finished-row';

    const badge = document.createElement('span');
    badge.className = 'answer-slot-no';
    badge.textContent = String(i + 1);

    const letters = document.createElement('div');
    letters.className = 'finished-letters';
    const solved = progressFor(slot).solved;

    [...wordFor(slot)].forEach(letter => {
      const cell = document.createElement('span');
      cell.className = 'answer-slot filled' + (solved ? '' : ' missed');
      cell.textContent = letter;
      letters.appendChild(cell);
    });

    row.append(badge, letters);
    row.setAttribute('aria-label',
      `Word ${i + 1}, ${wordFor(slot)}, ${solved ? 'solved' : 'missed'}`);
    slotsEl.appendChild(row);
  });
}

function renderAttempts() {
  const slot = state.activeSlot === 'results' ? 'word2' : state.activeSlot;
  const used = progressFor(slot).attemptsUsed;
  const left = ATTEMPTS - used;
  const wrap = el('attempts');
  wrap.innerHTML = '';
  wrap.setAttribute('aria-label', `${left} of ${ATTEMPTS} attempts left`);

  for (let i = 0; i < ATTEMPTS; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < left ? '' : ' spent');
    wrap.appendChild(pip);
  }

  /* The dots alone make you count. Say the number as well, as Snowman does. */
  const label = document.createElement('span');
  label.className = 'attempts-left';
  label.textContent = `${left} left`;
  wrap.appendChild(label);
}

function renderHistory() {
  const slot = state.activeSlot === 'results' ? 'word2' : state.activeSlot;
  const guesses = progressFor(slot).guesses;
  historyEl.innerHTML = '';

  guesses.forEach(guess => {
    const item = document.createElement('span');
    item.className = 'past-guess';
    item.textContent = guess;
    historyEl.appendChild(item);
  });
  /* Once both words are up, a list of one word's wrong guesses reads as noise. */
  historyEl.hidden = guesses.length === 0 || state.gameStatus === 'dayComplete';
}

function shake() {
  const box = el('slots');
  box.classList.add('shake');
  setTimeout(() => box.classList.remove('shake'), 450);
}

/* ---------------- input wiring ---------------- */

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    document.querySelectorAll('.modal:not([hidden])').forEach(m => (m.hidden = true));
    return;
  }
  if (document.querySelector('.modal:not([hidden])')) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    if (state.revealed) return advance();
    if (state.gameStatus === 'playing') submitGuess();
    return;
  }
  if (e.key === 'Backspace') { e.preventDefault(); removeLast(); return; }

  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) { e.preventDefault(); typeLetter(k); }
});

/* Pasting is sanitised down to letters and then validated against the tiles;
   anything that does not fit is refused as a whole rather than half-applied. */
document.addEventListener('paste', e => {
  if (state.gameStatus !== 'playing') return;
  const text = (e.clipboardData || window.clipboardData).getData('text') || '';
  e.preventDefault();
  applyPaste(text);
});

function applyPaste(text) {
  const letters = String(text).toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) { message('Nothing to paste', 'warn'); return false; }

  const answerLength = state.placed.length;
  const room = state.placed.filter(i => i === null).length;
  if (letters.length > room) { message('That is more letters than you have', 'warn'); return false; }

  /* Check the whole thing fits before placing any of it. */
  const used = new Set(usedTileIndexes());
  const chosen = [];
  for (const letter of letters) {
    const tileIndex = state.tiles.findIndex((t, i) => t.letter === letter && !used.has(i));
    if (tileIndex === -1) { message(`No ${letter.toUpperCase()} left to use`, 'warn'); return false; }
    used.add(tileIndex);
    chosen.push(tileIndex);
  }

  chosen.forEach(placeTile);
  announce(`Pasted ${letters.length} letters of ${answerLength}`);
  return true;
}

el('btn-submit').addEventListener('click', () => submitGuess());
el('btn-clear').addEventListener('click', clearInput);
el('btn-shuffle').addEventListener('click', shuffleTiles);
el('btn-hint').addEventListener('click', () => applyHint());
el('btn-continue').addEventListener('click', advance);
el('btn-share').addEventListener('click', copyShare);
el('btn-practice').addEventListener('click', startPractice);
el('btn-back-to-today').addEventListener('click', leavePractice);

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const wantsToday = btn.dataset.mode === 'daily';

    if (wantsToday) {
      if (!practice) return;

      /* No dialog: today's puzzle is saved as you go, and a practice round is
         unlimited and counts for nothing. There is nothing here worth stopping
         someone to ask about — just say what happened. */
      const spent = progressFor('word1').attemptsUsed + progressFor('word2').attemptsUsed;
      leavePractice();
      if (spent) toast('Practice round dropped');
      return;
    }

    if (practice) return;
    startPractice();
  });
});
el('btn-reload').addEventListener('click', () => location.reload());

el('btn-skip').addEventListener('click', () => {
  if (state.gameStatus !== 'playing') return;
  const word = state.activeSlot === 'word1' ? 'first' : 'second';
  if (confirm(`Give up on the ${word} word? It counts as a miss.`)) skipSlot();
});

/* ---------------- modals ---------------- */

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.hasAttribute('data-close')) modal.hidden = true;
  });
});

el('btn-help').addEventListener('click', () => { el('help-modal').hidden = false; });
el('btn-stats').addEventListener('click', () => {
  el('stats-played').textContent = save.stats.daysPlayed;
  el('stats-both').textContent = save.stats.daysBothSolved;
  el('stats-streak').textContent = save.stats.currentStreak;
  el('stats-max').textContent = save.stats.maxStreak;
  renderDistribution();
  el('stats-modal').hidden = false;
});

/* ---------------- test surface ----------------
   `const` bindings never attach to window, and _test.html drives the real game
   rather than a copy of it. One published object beats scattering assignments. */

window.ANAGRAM = {
  ATTEMPTS, HINT_AFTER, STORE_KEY, SCHEMA_VERSION,
  state, save, manifest, storageAvailable,
  currentInput, usedTileIndexes, typeLetter, placeTile, removeAt, removeLast,
  clearInput, shuffleTiles, applyPaste,
  submitGuess, skipSlot, applyHint, hintAvailable, advance,
  beginSlot, showResults, shareText, shareLine,
  startPractice, leavePractice, inPractice: () => !!practice, markModeButtons,
  wordFor, scrambleFor, definitionFor, progressFor, puzzleFor, remainingDays,
  todayKey, dayGap, nextRolloverMs, checkRollover, loadSave,
  notePlayed, noteSolved, blankProgress, blankStats, persist
};

/* ---------------- boot ---------------- */

function init() {
  const date = todayKey();
  const day = puzzleFor(date);

  if (!day) {
    console.error('anagram: no puzzle in the manifest for ' + date);
    el('play').hidden = true;
    el('no-puzzle').hidden = false;
    return;
  }

  const left = remainingDays(date);
  if (left < 30) console.warn(`anagram: only ${left} days of puzzles remain — regenerate the manifest`);

  state.puzzleDate = date;
  state.day = day;
  state.puzzleNumber = day.n;

  /* A new day wipes the board but never the record. */
  if (!save.progress || save.progress.date !== date) {
    save.progress = blankProgress(date);
    persist();
  }

  if (!storageAvailable) el('no-storage').hidden = false;

  const p1 = progressFor('word1');
  const p2 = progressFor('word2');

  if (p1.resolved && p2.resolved) {
    beginSlot('word2');            // fills state.tiles so the results screen has a word
    showResults();
  } else if (p1.resolved) {
    p2.unlocked = true;
    beginSlot('word2');
  } else {
    beginSlot('word1');
  }

  if (!save.stats.daysPlayed && !p1.resolved) el('help-modal').hidden = false;   // UI-3.1

  setInterval(() => { updateCountdown(); checkRollover(); }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { updateCountdown(); checkRollover(); }               // TR-6
  });
  updateCountdown();
}

init();

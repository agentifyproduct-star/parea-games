/* Shabda, room rules: one 5-letter word, six attempts, played by everyone at once.

   The answer never leaves this process until the game is over. A client sends a
   guess and gets back per-tile verdicts, which is exactly what it needs to draw
   the board and nothing more (SG-1.7, acceptance criterion 7). */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ATTEMPTS = 6;
const LENGTH = 5;

/* The public game's validity lexicon, loaded once. This is the list of words a
   guess may be, not the list an answer may be — room answers come from the
   partitioned pool in pools.json, so sharing it leaks nothing. */
let validWords = null;

function lexicon() {
  if (validWords) return validWords;

  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);

  const dir = path.join(__dirname, '..', '..', 'games', 'shabda');
  ['words-4.js', 'words-5.js', 'words-6.js', 'words.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, ''), ctx, { filename: file });
  });

  validWords = ctx.WORDS;
  return validWords;
}

/* Same scoring as the public game: exact matches claim their copies first, then
   misplaced letters draw from whatever is left. */
function scoreGuess(guess, answer) {
  const result = new Array(answer.length).fill('absent');
  const pool = {};

  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) result[i] = 'correct';
    else pool[answer[i]] = (pool[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < answer.length; i++) {
    if (result[i] === 'correct') continue;
    if (pool[guess[i]] > 0) { result[i] = 'present'; pool[guess[i]] -= 1; }
  }
  return result;
}

module.exports = {
  id: 'shabda',
  label: 'Shabda',
  timeLimitMs: 90000,          // decision D-2
  maxAttempts: ATTEMPTS,

  /* One word from the room pool. `taken` holds everything already used in this
     match and in the room's recent matches (SG-1.4, SG-1.5). */
  pick(pools, pickOne) {
    const answer = pickOne(pools.shabda.five);
    return { answer, words: [answer] };
  },

  blankPlayer() {
    return { guesses: [], verdicts: [], attemptsUsed: 0, solved: false, resolved: false, solvedAtMs: null };
  },

  /* What a client is allowed to see while the game is live. */
  view(secret, player) {
    return {
      length: LENGTH,
      attempts: ATTEMPTS,
      attemptsUsed: player.attemptsUsed,
      guesses: player.guesses,
      verdicts: player.verdicts,
      resolved: player.resolved,
      solved: player.solved
    };
  },

  /* Progress only — never a guess, never a letter (decision D-3). */
  progress(player) {
    return { attemptsUsed: player.attemptsUsed, resolved: player.resolved, solved: player.solved };
  },

  submit(secret, player, payload) {
    const guess = String(payload && payload.guess || '').toLowerCase();

    if (player.resolved) return { rejected: 'over' };
    if (!/^[a-z]+$/.test(guess) || guess.length !== LENGTH) return { rejected: 'length' };
    if (!lexicon().isValid(guess)) return { rejected: 'unknown' };
    if (player.guesses.includes(guess)) return { rejected: 'duplicate' };

    const verdict = scoreGuess(guess, secret.answer);
    player.guesses.push(guess);
    player.verdicts.push(verdict);
    player.attemptsUsed += 1;

    if (guess === secret.answer) { player.solved = true; player.resolved = true; }
    else if (player.attemptsUsed >= ATTEMPTS) player.resolved = true;

    return { accepted: true, verdict, resolved: player.resolved, solved: player.solved };
  },

  /* How far an unsolved player got: the share of the answer's letters they have
     pinned to the right position. */
  partial(secret, player) {
    let best = 0;
    player.verdicts.forEach(v => {
      best = Math.max(best, v.filter(x => x === 'correct').length);
    });
    return best / LENGTH;
  },

  reveal(secret) {
    return { answer: secret.answer };
  }
};

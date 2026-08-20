/* Snowman, room rules: one word, a category as the clue, six wrong guesses.

   The client is sent the mask, never the word. Guessing a letter returns the
   positions it occupies, so the client can draw the reveal without ever holding
   the answer (SG-1.7, acceptance criterion 7). */

const LIVES = 6;

const isLetter = ch => /^[a-z]$/.test(ch);

/* Underscores for what is still hidden, separators always shown — the same rule
   the public game plays by. */
function mask(word, guessed) {
  return [...word].map(ch => (!isLetter(ch) ? ch : guessed.includes(ch) ? ch : '_')).join('');
}

function solved(word, guessed) {
  return [...word].every(ch => !isLetter(ch) || guessed.includes(ch));
}

module.exports = {
  id: 'snowman',
  label: 'Snowman',
  timeLimitMs: 120000,          // decision D-2: Snowman gets longer
  maxAttempts: LIVES,

  pick(pools, pickOne) {
    const entry = pickOne(pools.snowman.medium, w => w.phrase);
    return { answer: entry.phrase, category: entry.category, words: [entry.phrase] };
  },

  blankPlayer() {
    return { guessed: [], wrongGuesses: 0, solved: false, resolved: false };
  },

  view(secret, player) {
    return {
      category: secret.category,
      mask: mask(secret.answer, player.guessed),
      guessed: player.guessed,
      lives: LIVES,
      wrongGuesses: player.wrongGuesses,
      resolved: player.resolved,
      solved: player.solved
    };
  },

  progress(player) {
    return { attemptsUsed: player.wrongGuesses, resolved: player.resolved, solved: player.solved };
  },

  submit(secret, player, payload) {
    const letter = String(payload && payload.letter || '').toLowerCase();

    if (player.resolved) return { rejected: 'over' };
    if (!isLetter(letter)) return { rejected: 'invalid' };
    if (player.guessed.includes(letter)) return { rejected: 'duplicate' };   // free, as in the public game

    player.guessed.push(letter);
    const hit = secret.answer.includes(letter);
    if (!hit) player.wrongGuesses += 1;

    if (solved(secret.answer, player.guessed)) { player.solved = true; player.resolved = true; }
    else if (player.wrongGuesses >= LIVES) player.resolved = true;

    return {
      accepted: true,
      hit,
      mask: mask(secret.answer, player.guessed),
      wrongGuesses: player.wrongGuesses,
      resolved: player.resolved,
      solved: player.solved
    };
  },

  /* Share of the answer's distinct letters found before the lives ran out. */
  partial(secret, player) {
    const needed = new Set([...secret.answer].filter(isLetter));
    if (!needed.size) return 0;
    const found = [...needed].filter(ch => player.guessed.includes(ch)).length;
    return found / needed.size;
  },

  reveal(secret) {
    return { answer: secret.answer, category: secret.category };
  }
};

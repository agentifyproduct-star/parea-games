/* Anagram, room rules: two words in one slot — a short one from the easy band
   and a longer one from the hard band — five attempts each.

   Keeping both words preserves the shape players know from the daily game and
   uses both difficulty bands (SG-1.3). The client receives the scrambled letters
   only; the answer arrives when the game ends. */

const SCRAMBLE = require('../../games/anagram/scramble.js');

const ATTEMPTS = 5;

/* The same validity rules the daily manifest is held to, checked here at pick
   time rather than at authoring time: never the source word, never a run of
   three, and — because this process has no dictionary — a spelled-out
   alternative is ruled out by the pool itself, whose words were filtered for
   ambiguous letter sets when pools.json was built (SG-1.6). */
function scrambleWord(word, seedKey) {
  const result = SCRAMBLE.scramble(word, seedKey);
  return result.text;
}

const sorted = w => [...w].sort().join('');

module.exports = {
  id: 'anagram',
  label: 'Anagram',
  timeLimitMs: 90000,           // decision D-2
  maxAttempts: ATTEMPTS,

  /* Random within each band, never across them. */
  pick(pools, pickOne, seed) {
    const easy = pickOne(pools.anagram.easy);
    const hard = pickOne(pools.anagram.hard);
    return {
      answers: [easy, hard],
      words: [easy, hard],
      scrambles: [scrambleWord(easy, `${seed}:1`), scrambleWord(hard, `${seed}:2`)]
    };
  },

  blankPlayer() {
    return {
      slot: 0,
      words: [
        { guesses: [], attemptsUsed: 0, solved: false, resolved: false },
        { guesses: [], attemptsUsed: 0, solved: false, resolved: false }
      ],
      resolved: false,
      solved: false
    };
  },

  view(secret, player) {
    return {
      scrambles: secret.scrambles,
      attempts: ATTEMPTS,
      slot: player.slot,
      words: player.words,
      resolved: player.resolved,
      solved: player.solved
    };
  },

  progress(player) {
    const attemptsUsed = player.words.reduce((n, w) => n + w.attemptsUsed, 0);
    return {
      attemptsUsed,
      solvedWords: player.words.filter(w => w.solved).length,
      resolved: player.resolved,
      solved: player.solved
    };
  },

  submit(secret, player, payload) {
    if (player.resolved) return { rejected: 'over' };

    const index = player.slot;
    const word = player.words[index];
    const answer = secret.answers[index];
    const guess = String(payload && payload.guess || '').toLowerCase();

    if (!/^[a-z]+$/.test(guess)) return { rejected: 'invalid' };
    if (guess.length !== answer.length) return { rejected: 'length' };
    if (sorted(guess) !== sorted(secret.scrambles[index])) return { rejected: 'letters' };
    if (word.guesses.includes(guess)) return { rejected: 'duplicate' };

    word.guesses.push(guess);
    word.attemptsUsed += 1;

    if (guess === answer) { word.solved = true; word.resolved = true; }
    else if (word.attemptsUsed >= ATTEMPTS) word.resolved = true;

    /* Resolving the first word moves the player straight on to the second. */
    if (word.resolved && index === 0) player.slot = 1;

    player.solved = player.words.every(w => w.solved);
    player.resolved = player.words.every(w => w.resolved);

    return {
      accepted: true,
      correct: word.solved,
      slot: player.slot,
      words: player.words,
      resolved: player.resolved,
      solved: player.solved
    };
  },

  /* Each word is worth half the slot, so solving the short one and missing the
     long one is properly credited. */
  partial(secret, player) {
    return player.words.filter(w => w.solved).length / player.words.length;
  },

  reveal(secret) {
    return { answers: secret.answers };
  }
};

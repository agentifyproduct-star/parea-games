/* The puzzle service: random selection from a curated pool, on demand.

   No calendar, no manifest scheduling, no runway. The only memory it needs is
   what a room has seen lately, so a word does not come round twice (SG-1.4 for
   the match, SG-1.5 for the room).

   Selection happens when the start countdown completes and never before, which
   is what closes the reroll exploits in Section 2 — a word set that does not
   exist cannot be previewed, aborted away, or rerolled. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GAMES = {
  shabda: require('./games/shabda.js'),
  snowman: require('./games/snowman.js'),
  anagram: require('./games/anagram.js')
};

const pools = JSON.parse(fs.readFileSync(path.join(__dirname, 'pools.json'), 'utf8'));

/* How many matches back a room remembers. SG-1.5 asks for this to be sized to
   the room's play frequency; 25 covers a long evening in the smallest pool
   (Snowman's 135 words) without ever starving selection. */
const RECENT_MATCHES = 25;

const gameIds = () => Object.keys(GAMES);
const gameById = id => GAMES[id] || null;

/* Cryptographically random, not seeded: there is no reason for a room's word
   set to be predictable, and every reason for it not to be. */
function randomInt(n) {
  return crypto.randomInt(n);
}

/* Builds the word set for one match.

   `recent` is the flat list of words the room has served over its last matches.
   Anything in it, and anything already chosen for this match, is off the table.
   If a pool is so exhausted that nothing is left, the recent window is ignored
   rather than failing the match — a repeat is better than a dead lobby. */
function generateMatch(gameIdsInOrder, recent = []) {
  const taken = new Set(recent);
  const seed = crypto.randomBytes(8).toString('hex');

  const pickOne = (list, keyOf = w => w) => {
    const fresh = list.filter(item => !taken.has(keyOf(item)));
    const from = fresh.length ? fresh : list;
    const chosen = from[randomInt(from.length)];
    taken.add(keyOf(chosen));
    return chosen;
  };

  return gameIdsInOrder.map((id, index) => {
    const game = gameById(id);
    if (!game) throw new Error('unknown game: ' + id);
    return {
      gameId: id,
      secret: game.pick(pools, pickOne, `${seed}:${index}`)
    };
  });
}

module.exports = {
  pools,
  GAMES,
  gameIds,
  gameById,
  generateMatch,
  RECENT_MATCHES
};

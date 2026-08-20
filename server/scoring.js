/* Scoring: efficiency first, speed second, partial credit for getting somewhere.

   Every game normalises to the same 0-100 band (SC-1.4), so a match made of
   Shabda and Snowman cannot be decided by whichever game happens to hand out
   more points. Everything here is computed from server-recorded timestamps
   (SC-1.5) measured from the moment the puzzle was delivered (SC-1.6), never
   from anything a client reports. */

const EFFICIENCY_MAX = 70;    // primary: attempts or wrong guesses used
const SPEED_MAX = 30;         // secondary, capped below efficiency on purpose
const PARTIAL_MAX = 25;       // an unsolved puzzle can still be worth something

/* A clean slow solve (70) must beat a sloppy fast one (11.7 + 30 = 41.7), which
   is what SC-1.2's cap is for. */
function efficiencyPoints(attemptsUsed, maxAttempts) {
  const used = Math.max(1, Math.min(attemptsUsed, maxAttempts));
  return EFFICIENCY_MAX * ((maxAttempts - used + 1) / maxAttempts);
}

function speedPoints(elapsedMs, timeLimitMs) {
  if (!(timeLimitMs > 0)) return 0;
  const left = Math.max(0, Math.min(timeLimitMs, timeLimitMs - elapsedMs));
  return SPEED_MAX * (left / timeLimitMs);
}

/* One player, one game slot.
     solved:      efficiency + speed
     not solved:  partial credit only, so finishing always outranks not */
function scoreSlot({ solved, attemptsUsed, maxAttempts, elapsedMs, timeLimitMs, partial }) {
  if (solved) {
    const efficiency = efficiencyPoints(attemptsUsed, maxAttempts);
    const speed = speedPoints(elapsedMs, timeLimitMs);
    return {
      points: round(efficiency + speed),
      efficiency: round(efficiency),
      speed: round(speed),
      partial: 0,
      solved: true
    };
  }

  const credit = PARTIAL_MAX * clamp01(partial || 0);
  return { points: round(credit), efficiency: 0, speed: 0, partial: round(credit), solved: false };
}

/* Anagram plays two words in one slot; each is scored on its own attempts and
   its own finishing time, then averaged, so the slot still lands in the same
   0-100 band as a single-word game. */
function scoreCombined(parts) {
  if (!parts.length) return { points: 0, efficiency: 0, speed: 0, partial: 0, solved: false };

  const scored = parts.map(scoreSlot);
  const mean = key => round(scored.reduce((sum, s) => sum + s[key], 0) / scored.length);

  return {
    points: mean('points'),
    efficiency: mean('efficiency'),
    speed: mean('speed'),
    partial: mean('partial'),
    solved: scored.every(s => s.solved)
  };
}

const clamp01 = n => Math.max(0, Math.min(1, n));
const round = n => Math.round(n * 10) / 10;

/* Room standings normalise for participation (SC-2.3): members join at different
   times and play different numbers of matches, so ranking is by average points
   per match, with total as the tiebreak. */
function rankStandings(standings) {
  return [...standings]
    .map(entry => ({
      ...entry,
      average: entry.matches ? round(entry.points / entry.matches) : 0
    }))
    .sort((a, b) => b.average - a.average || b.points - a.points || a.name.localeCompare(b.name));
}

module.exports = {
  EFFICIENCY_MAX,
  SPEED_MAX,
  PARTIAL_MAX,
  efficiencyPoints,
  speedPoints,
  scoreSlot,
  scoreCombined,
  rankStandings,
  round
};

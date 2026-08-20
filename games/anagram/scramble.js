/* The scrambler, shared by the browser and by _gen-puzzles.js.

   It matters that both run the *same* code. The authoring script is where a
   candidate is checked against a dictionary (FR-2.4) — the browser ships no
   dictionary — so the manifest records which candidate in the shuffle sequence
   was accepted, and the browser replays the identical sequence to reach it.
   Same seed, same algorithm, same arrangement, on every device and every load. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SCRAMBLE = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /* FNV-1a: turns "2026-08-18:1" into a 32-bit seed, so each date and slot gets
     its own stream. */
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /* mulberry32 — small, fast, and identical everywhere. Never Math.random(). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fisherYates(letters, rnd) {
    const out = letters.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /* Longest run of source letters still sitting next to each other in the same
     order. FR-2.5 caps this at two. */
  function longestKeptRun(word, candidate) {
    let best = 0;
    for (let len = word.length; len > best; len--) {
      for (let i = 0; i + len <= word.length; i++) {
        if (candidate.includes(word.slice(i, i + len))) return len;
      }
    }
    return best;
  }

  const MAX_ATTEMPTS = 50;

  /* Walks the shuffle sequence for `word` under `seedKey`.

     Authoring mode: pass opts.isWord and it returns the first candidate that is
     not the source word (FR-2.3), not another dictionary word (FR-2.4) and keeps
     no run of three (FR-2.5), reporting which attempt that was.

     Play mode: pass opts.take = that attempt number and it replays the sequence
     and hands back the same arrangement without needing a dictionary.

     Either way, 50 failed attempts falls back to the reversed word (FR-2.6). */
  function scramble(word, seedKey, opts = {}) {
    const letters = [...word];
    const rnd = mulberry32(hashString(seedKey));
    const take = opts.take;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const candidate = fisherYates(letters, rnd).join('');

      if (take) {
        if (attempt === take) return { text: candidate, attempt, fallback: false };
        continue;                                   // replaying, not judging
      }

      if (candidate === word) continue;             // FR-2.3
      if (longestKeptRun(word, candidate) > 2) continue;   // FR-2.5
      if (opts.isWord && opts.isWord(candidate)) continue; // FR-2.4

      return { text: candidate, attempt, fallback: false };
    }

    /* Nothing survived 50 tries — reverse it, and let the caller shout. */
    const reversed = [...word].reverse().join('');
    return { text: reversed, attempt: 0, fallback: true };
  }

  return { hashString, mulberry32, fisherYates, longestKeptRun, scramble, MAX_ATTEMPTS };
});

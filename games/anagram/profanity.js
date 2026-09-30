/* The explicit/curse-word subset of _gen-puzzles.js's BLOCKLIST and
   NOT_ANSWERS, factored out so _publish-puzzles.js can run the same check as
   a last safety net before an unattended publish writes anything.

   _gen-puzzles.js already keeps every one of these out of the pool a day's
   word is drawn from, so this should never actually catch anything in
   practice — it exists for the run that publishes without a person reading
   the output first. */
const PROFANITY = new Set(`
  piss pissing crap damn hell sexy naked nude breast breasts butt bitch bastard
  whore slut porn stripper erotic drunk vomit
  fisting mistress lingerie orgasm condom brothel hooker nudity topless seduce
  pussy vibrator boobs penis vagina nipple nipples orgy sperm incest molest
  rape rapist pedophile abortion bestiality
`.split(/\s+/).filter(Boolean));

/* True if `text` contains any listed word as a whole word — "class" must not
   trip on a substring the way a plain includes() would. */
function containsProfanity(text) {
  const words = String(text || '').toLowerCase().match(/[a-z']+/g) || [];
  return words.some(w => PROFANITY.has(w));
}

module.exports = { PROFANITY, containsProfanity };

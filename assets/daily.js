/* When a new puzzle arrives.

   Every daily puzzle in Parea turns over at midnight in New York, and at
   that same instant for everybody — a player in London, Mumbai or Sydney gets
   the new word at the same moment as a player in New York, just at a different
   hour of their own day. Nobody's clock decides their puzzle.

   Two notes on how that is done:

     - The solo games are plain files with no server behind them, so the only
       clock available is the device's. What this file does is convert that clock
       into New York time, which gives the same answer everywhere regardless of
       the timezone the device is set to. A device whose clock is genuinely wrong
       will still be wrong; nothing client-side can fix that.

     - "America/New_York" follows US daylight saving, so the change lands at
       midnight New York time all year rather than drifting an hour in summer.
       For a fixed UTC-5 instead, set ZONE to false and FIXED_OFFSET_MIN to -300. */

(function () {
  const ZONE = 'America/New_York';
  const FIXED_OFFSET_MIN = -300;              // used only if the zone is unavailable
  const DAY_MS = 86400000;

  /* Older engines, and a few locked-down ones, cannot do named timezones. */
  const zoneWorks = (() => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: ZONE }).format(new Date());
      return true;
    } catch {
      return false;
    }
  })();

  const parts = zoneWorks
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
      })
    : null;

  /* The calendar date as it reads in New York, always YYYY-MM-DD. */
  function key(date = new Date()) {
    if (!zoneWorks) {
      const shifted = new Date(date.getTime() + FIXED_OFFSET_MIN * 60000);
      return shifted.toISOString().slice(0, 10);
    }
    const found = {};
    parts.formatToParts(date).forEach(part => { found[part.type] = part.value; });
    return `${found.year}-${found.month}-${found.day}`;
  }

  /* Keys are compared and subtracted as plain dates, so they are anchored to UTC
     midnight purely as a counting device — never shown to anyone. */
  const keyToMs = k => Date.parse(k + 'T00:00:00Z');
  const msToKey = ms => new Date(ms).toISOString().slice(0, 10);

  const daysBetween = (fromKey, toKey) => Math.round((keyToMs(toKey) - keyToMs(fromKey)) / DAY_MS);
  const shift = (k, days) => msToKey(keyToMs(k) + days * DAY_MS);

  /* The exact instant the date next changes in New York. Found by narrowing down
     rather than by adding 24 hours, so the two daylight-saving days — one 23
     hours long, one 25 — come out right. */
  let cached = { from: '', at: 0 };

  function nextRollover(from = Date.now()) {
    const today = key(new Date(from));
    if (cached.from === today && cached.at > from) return cached.at;

    let before = from;
    let after = from + 36 * 3600000;
    while (after - before > 1) {
      const middle = Math.floor((before + after) / 2);
      if (key(new Date(middle)) === today) before = middle;
      else after = middle;
    }

    cached = { from: today, at: after };
    return after;
  }

  const msUntilRollover = (from = Date.now()) => Math.max(0, nextRollover(from) - from);

  /* "09:27:00" — how long until the next puzzle. Worked out from the clock every
     time it is asked rather than counted down, so a sleeping tab wakes up right. */
  function untilRollover(from = Date.now()) {
    const left = msUntilRollover(from);
    const hours = Math.floor(left / 3600000);
    const minutes = Math.floor((left % 3600000) / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    return [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
  }

  window.DAILY = {
    ZONE,
    ZONE_LABEL: 'New York',
    zoneWorks,
    key,
    keyToMs,
    daysBetween,
    shift,
    nextRollover,
    msUntilRollover,
    untilRollover,
    /* A Date fixed at midday on that key — safe to format, never near a boundary. */
    keyToDate: k => new Date(keyToMs(k) + 12 * 3600000)
  };
})();

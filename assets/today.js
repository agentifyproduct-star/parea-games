/* How today is going, across all three games.

   Each game already keeps its own save, in its own shape, under its own key.
   Nothing could answer "how much of today is left?" without opening all three
   and understanding each one — so the games also leave a single line here, and
   this is the only file anything else has to read.

   Deliberately tiny and deliberately dumb: one day, three words. If a game's own
   save format changes, this does not, and the front page does not care.

   Needs daily.js, so that "today" means the same midnight it means everywhere
   else in Parea. */

(function () {
  const KEY = 'arcade.today.v1';

  /* Play order, which is also the order the front page offers them in. */
  const GAMES = [
    { id: 'shabda', title: 'Shabda', path: 'games/shabda/' },
    { id: 'snowman', title: 'Snowman', path: 'games/snowman/' },
    { id: 'anagram', title: 'Anagram', path: 'games/anagram/' }
  ];

  /* 'playing' means started and unfinished. Anything else here means the day's
     puzzle is behind you, win or lose — the front page only cares which. */
  const FINISHED = ['won', 'lost', 'done'];

  const storage = (() => {
    try {
      const probe = '__today__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    } catch {
      return null;                       // private mode: the day just never records
    }
  })();

  const dayKey = () => (window.DAILY ? DAILY.key() : new Date().toISOString().slice(0, 10));

  /* Yesterday's record is not worth keeping: the question is only ever about
     today, and a stale day reads as a clean slate. */
  function read() {
    if (!storage) return {};
    try {
      const raw = JSON.parse(storage.getItem(KEY) || '{}');
      return raw && raw.day === dayKey() && raw.games ? raw.games : {};
    } catch {
      return {};
    }
  }

  function set(id, status) {
    if (!storage) return;
    const games = read();
    if (games[id] === status) return;
    games[id] = status;
    try {
      storage.setItem(KEY, JSON.stringify({ day: dayKey(), games }));
    } catch { /* full or blocked: the day is not important enough to complain */ }
  }

  const finished = status => FINISHED.indexOf(status) !== -1;

  /* Every game, in play order, with how it stands. */
  function summary() {
    const games = read();
    return GAMES.map(game => ({
      id: game.id,
      title: game.title,
      path: game.path,
      status: games[game.id] || 'unplayed',
      finished: finished(games[game.id])
    }));
  }

  /* The next one worth opening, starting after `afterId` and wrapping round, so
     finishing a game hands you the one you have not played rather than the one
     that happens to be first. Null once the day is done. */
  function next(afterId) {
    const list = summary();
    const from = afterId ? list.findIndex(game => game.id === afterId) + 1 : 0;
    for (let i = 0; i < list.length; i++) {
      const game = list[(from + i) % list.length];
      if (!game.finished) return game;
    }
    return null;
  }

  const counts = () => {
    const list = summary();
    return { done: list.filter(g => g.finished).length, total: list.length };
  };

  /* Draws the way onward at the end of a game. Every game has the same three
     elements and the same two outcomes, so the wording lives here rather than
     in three places that would slowly stop agreeing with each other. */
  function offerNext(currentId, els) {
    if (!els || !els.container) return;
    const upcoming = next(currentId);
    const { done, total } = counts();

    if (upcoming) {
      els.link.href = '../' + upcoming.id + '/index.html';
      els.link.textContent = 'Play ' + upcoming.title + ' \u2192';
      if (els.note) {
        els.note.textContent = done
          ? done + ' of ' + total + " done today \u2014 " + upcoming.title + ' is next.'
          : 'Two more games waiting today.';
      }
    } else {
      els.link.href = '../../index.html';
      els.link.textContent = 'See your day \u2192';
      if (els.note) els.note.textContent = 'All three done today. Come back at midnight.';
    }

    els.container.hidden = false;
  }

  window.TODAY = { KEY, GAMES, read, set, finished, summary, next, counts, dayKey, offerNext };
})();

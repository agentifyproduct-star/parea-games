/* What the front page can only know once it is open in somebody's browser.

   The page itself is plain HTML with every game named in the source, because
   that is what search engines and answer engines read. This adds the one thing
   that cannot be baked in: how far through today *you* are. Nothing here creates
   content — it ticks off what you have finished, and points at what is left.

   If it never runs, the page is still complete and every game is still one tap
   away. That is the deal, and the SEO suite enforces it. */

(function () {
  const panel = document.getElementById('today');
  if (!panel || !window.TODAY) return;

  const games = TODAY.summary();
  const { done, total } = TODAY.counts();
  const started = games.some(game => game.status !== 'unplayed');

  /* ---------- tick off what is finished ---------- */

  games.forEach(game => {
    if (!game.finished) return;
    document.querySelectorAll(`[data-game="${game.id}"]`).forEach(card => {
      card.classList.add('is-done');
      card.setAttribute('aria-label', `${game.title} — played today`);
    });
  });

  /* ---------- the day at a glance ---------- */

  const LABELS = {
    won: 'Solved',
    lost: 'Played',
    done: 'Played',
    playing: 'In progress',
    unplayed: 'Not played yet'
  };

  /* Nothing to summarise before the first game of the day: a brand new visitor
     should meet the games, not a scoreboard of noughts. */
  if (started) {
    document.getElementById('today-count').textContent =
      done === total ? 'All three done' : `${done} of ${total} done`;

    const list = document.getElementById('today-list');
    list.innerHTML = '';

    games.forEach(game => {
      const row = document.createElement('a');
      row.className = 'today-row' + (game.finished ? ' is-done' : '');
      row.href = game.path + 'index.html';

      const name = document.createElement('span');
      name.className = 'today-name';
      name.textContent = game.title;

      const state = document.createElement('span');
      state.className = 'today-state';
      state.textContent = LABELS[game.status] || LABELS.unplayed;

      row.append(name, state);
      list.appendChild(row);
    });

    panel.hidden = false;
  }

  /* ---------- send the button where the day actually is ---------- */

  const cta = document.getElementById('play-cta');
  if (!cta) return;

  const upcoming = TODAY.next();

  if (upcoming) {
    cta.href = upcoming.path + 'index.html';
    cta.textContent = started ? `Play ${upcoming.title}` : "Play today's games";
  } else {
    /* Everything is done: the honest thing is to say so rather than to send
       somebody back into a game they have already finished. */
    cta.href = '#today';
    cta.textContent = 'All three done';
    cta.classList.add('is-done');
  }
})();

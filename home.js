/* What the front page can only know once it is open in somebody's browser.

   The page itself is plain HTML with every game named in the source, because
   that is what search engines and answer engines read. This adds the two things
   that cannot be baked in: which of today's games you have already finished, and
   how you have been doing across all three.

   If it never runs, the page is still complete, every game is still one tap
   away, and the statistics button — which would open an empty dialog — is never
   shown. That is the deal, and the SEO suite enforces it. */

(function () {
  if (!window.TODAY) return;

  const games = TODAY.summary();
  const started = games.some(game => game.status !== 'unplayed');

  /* ---------- tick off what is finished ---------- */

  games.forEach(game => {
    if (!game.finished) return;
    document.querySelectorAll(`[data-game="${game.id}"]`).forEach(card => {
      card.classList.add('is-done');
      card.setAttribute('aria-label', `${game.title} — played today`);
    });
  });

  /* ---------- send the button where the day actually is ---------- */

  const cta = document.getElementById('play-cta');
  const upcoming = TODAY.next();

  if (cta && upcoming) {
    cta.href = upcoming.path + 'index.html';
    cta.textContent = started ? `Play ${upcoming.title}` : 'Play today';
  } else if (cta) {
    /* Everything is done: the honest thing is to say so rather than to send
       somebody back into a game they have already finished. */
    cta.href = '#games';
    cta.textContent = 'All three done';
    cta.classList.add('is-done');
  }

  /* ---------- the record, across all three ---------- */

  const sheet = document.getElementById('stats-modal');
  const button = document.getElementById('btn-stats');
  if (!sheet || !button) return;

  const TODAY_LABELS = {
    won: 'Solved today',
    lost: 'Played today',
    done: 'Played today',
    playing: 'In progress',
    unplayed: 'Not played yet'
  };

  function figure(value, label) {
    const box = document.createElement('div');
    box.className = 'sheet-figure';
    const number = document.createElement('b');
    number.textContent = String(value);
    const caption = document.createElement('span');
    caption.textContent = label;
    box.append(number, caption);
    return box;
  }

  function fill() {
    const record = TODAY.record();
    const { done, total } = TODAY.counts();
    const played = record.reduce((sum, game) => sum + game.played, 0);

    document.getElementById('sheet-note').textContent = played
      ? `${done} of ${total} done today.`
      : 'Nothing played yet — every game keeps its own streak.';

    const rows = document.getElementById('sheet-rows');
    rows.innerHTML = '';

    record.forEach(game => {
      const row = document.createElement('a');
      row.className = 'sheet-row' + (game.finished ? ' is-done' : '');
      row.href = game.path + 'index.html';

      const name = document.createElement('span');
      name.className = 'sheet-game';
      name.textContent = game.title;

      const today = document.createElement('span');
      today.className = 'sheet-today';
      today.textContent = TODAY_LABELS[game.status] || TODAY_LABELS.unplayed;

      const figures = document.createElement('div');
      figures.className = 'sheet-figures';
      figures.append(
        figure(game.played, 'Played'),
        figure(game.played ? Math.round((game.solved / game.played) * 100) + '%' : '—', 'Solved'),
        figure(game.streak, 'Streak'),
        figure(game.best, 'Best')
      );

      row.append(name, today, figures);
      rows.appendChild(row);
    });
  }

  const open = () => { fill(); sheet.hidden = false; };
  const close = () => { sheet.hidden = true; };

  button.hidden = false;
  button.addEventListener('click', open);

  sheet.addEventListener('click', event => {
    if (event.target === sheet || event.target.hasAttribute('data-close')) close();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !sheet.hidden) close();
  });
})();

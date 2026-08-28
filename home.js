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

  /* ---------- the compact homepage's one line ----------

     Only ever visible on the compact layout, where the hero has given up
     describing the site. Somebody on their fourth day knows what Parea is; what
     they cannot know without opening three games is how much of today is left,
     so that is what the row is spent on. Written from the same day-state the
     tick marks and the button above already read — no second source, and
     nothing new in storage. */

  const progress = document.getElementById('hero-progress');
  if (progress) {
    const { done, total } = TODAY.counts();
    progress.textContent =
      !upcoming ? `All ${total} done today`
      : done ? `${done} of ${total} done today — ${upcoming.title} is next`
      : `Nothing played yet today — ${upcoming.title} is first up`;
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

  /* Which record the sheet is showing. Opens on the day, always. */
  let statsMode = 'daily';

  document.querySelectorAll('.stat-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.stat === statsMode) return;
      statsMode = btn.dataset.stat;
      fill();
    });
  });

  /* One row a game, and no total. Plays could be added up; a win percentage and
     a run cannot, because the three games do not ask the same thing of you and
     an average across them would describe nobody. */
  function fill() {
    const daily = statsMode === 'daily';
    const record = daily ? TODAY.record() : TODAY.unlimitedRecord();
    const { done, total } = TODAY.counts();
    const played = record.reduce((sum, game) => sum + game.played, 0);

    document.querySelectorAll('.stat-mode-btn').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.stat === statsMode ? 'true' : 'false'));

    document.getElementById('sheet-note').textContent = daily
      ? (played ? `${done} of ${total} done today.`
                : 'Nothing played yet — every game keeps its own streak.')
      : (played ? 'Every Unlimited word you have played. Your daily records are untouched.'
                : 'No Unlimited words yet. Nothing played there is counted against you.');

    const rows = document.getElementById('sheet-rows');
    rows.innerHTML = '';

    record.forEach(game => {
      const row = document.createElement('a');
      row.className = 'sheet-row' + (daily && game.finished ? ' is-done' : '');
      row.href = game.path + 'index.html';

      const name = document.createElement('span');
      name.className = 'sheet-game';
      name.textContent = game.title;

      const today = document.createElement('span');
      today.className = 'sheet-today';
      today.textContent = daily
        ? (TODAY_LABELS[game.status] || TODAY_LABELS.unplayed)
        : (game.played ? `${game.played} played` : 'None yet');

      /* Abbreviated because four columns and a game name have to fit 380px.
         Every cell carries something on both tabs: a game nobody has played
         reads as zeroes rather than blanks, since an empty cell looks broken.
         The percentage keeps its dash, because nought per cent claims you
         played and won none, and a dash says you have not played. */
      const figures = document.createElement('div');
      figures.className = 'sheet-figures';
      figures.append(
        figure(game.played, daily ? 'Played' : 'Play'),
        figure(game.played ? Math.round((game.solved / game.played) * 100) + '%' : '—',
               daily ? 'Solved' : 'Win'),
        figure(daily ? game.streak : game.run, daily ? 'Streak' : 'Run'),
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


/* ---------------- folding away the reading, on the compact homepage ----------------

   About and Questions are 634 and 1211 pixels tall. On a phone they turned a
   layout built to put three games on one screen into two thousand pixels of
   scroll, with the games occupying ninety-five of it.

   They are folded rather than hidden, because the site navigation is display:
   none below 860px — so hiding them outright would leave a returning visitor on
   a phone with no route to that content at all, and "when does the new puzzle
   arrive?" is a fair question on somebody's fourth visit.

   Closed on every load, deliberately: remembering that somebody once opened the
   questions would hand them back the long page they were being spared.

   Only ever runs on the compact layout. A first-time visitor, a wide screen and
   a crawler all get both sections open and entire, which is also why none of
   this touches the structured data. */

(function () {
  if (!document.documentElement.classList.contains('compact-home')) return;

  document.querySelectorAll('#about, #questions').forEach(section => {
    const head = section.querySelector('.section-head');
    const heading = head && head.querySelector('h2');
    if (!heading) return;

    /* Everything below the heading is what folds. Moving it into one wrapper
       gives aria-controls something real to point at, and hiding one element
       beats hiding four. */
    const body = document.createElement('div');
    body.className = 'section-body';
    body.id = section.id + '-body';
    while (head.nextSibling) body.appendChild(head.nextSibling);
    section.appendChild(body);

    /* The button goes inside the heading rather than around it: the level still
       has to be announced, and a heading is not a control. */
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-toggle';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', body.id);
    button.textContent = heading.textContent;
    heading.textContent = '';
    heading.appendChild(button);

    body.hidden = true;
    section.classList.add('is-folded');

    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
      section.classList.toggle('is-folded', open);
    });
  });
})();

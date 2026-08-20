/* The room client.

   It holds no game state of its own worth the name: the server decides what a
   guess did, what the score is, and what happens next. This file connects, draws
   whatever the server last said, and sends what the player asked for.

   Two things here are worth reading closely:

     - the countdown never runs a local five second loop. It renders the
       difference between the server's end timestamp and the local clock,
       corrected by an offset measured from every message the server stamps. A
       throttled or backgrounded tab therefore converges instead of finishing
       late (CD-1.2, CD-1.3).

     - reconnection is automatic and silent. The seat is held by a token in
       sessionStorage, so a refresh, a dropped wifi or a backgrounded phone comes
       back to exactly the same game (CN-1.2). */

const WS_PATH = '/rooms';
const STORE = 'arcade.room.seat';

const el = id => document.getElementById(id);
const views = ['join', 'lobby', 'countdown', 'game', 'results'];

const state = {
  socket: null,
  connected: false,
  clockOffset: 0,          // serverNow - Date.now(), applied to every server timestamp
  me: null,                // playerId
  token: null,
  code: null,
  room: null,              // last room state from the server
  games: [],               // catalogue from the server's hello
  countdown: null,         // { endsAt }
  game: null,              // { gameId, label, index, total, deadline, view }
  progress: [],
  spectator: false,
  reconnectDelay: 500
};

window.ROOM = state;       // the browser test harness drives this

/* ---------------- plumbing ---------------- */

/* Opened straight off the filesystem there is no host to talk to, and building a
   WebSocket URL from an empty host throws. Rooms are the one part of Parea
   that genuinely needs the server, so say so rather than failing quietly. */
const servedFromFile = location.protocol === 'file:';

/* A healthy page connects in milliseconds, so hold the banner back briefly
   rather than flashing it on every load. Opened from a file we know at once. */
let showOffline = servedFromFile;
setTimeout(() => { if (!state.connected) { showOffline = true; renderConnection(); } }, 1500);

function connect() {
  if (servedFromFile) { renderConnection(); return; }

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;

  let socket;
  try {
    socket = new WebSocket(url);
  } catch {
    state.connected = false;
    renderConnection();
    setTimeout(connect, state.reconnectDelay);
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 8000);
    return;
  }
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.connected = true;
    state.reconnectDelay = 500;
    showOffline = false;
    renderConnection();

    /* A stored seat means we were here a moment ago: take it back rather than
       arriving as somebody new. */
    const seat = loadSeat();
    if (seat) send({ type: 'rejoin', code: seat.code, token: seat.token });
  });

  socket.addEventListener('message', event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handle(msg);
  });

  socket.addEventListener('close', () => {
    state.connected = false;
    showOffline = true;
    renderConnection();
    /* Back off gently rather than hammering a server that may be restarting. */
    setTimeout(connect, state.reconnectDelay);
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 8000);
  });
}

/* Returns false when there was nothing to send it down. A button press that goes
   nowhere must always say so — silence reads as a broken button. */
function send(msg) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(msg));
    return true;
  }
  toast(servedFromFile
    ? 'Rooms need the Parea server running — see the note above'
    : 'Not connected yet — hang on');
  return false;
}

/* Every message the server stamps with `serverNow` re-measures the offset, so
   timestamps can be compared against the local clock with confidence. */
function noteServerTime(msg) {
  if (typeof msg.serverNow === 'number') state.clockOffset = msg.serverNow - Date.now();
}

const serverTime = () => Date.now() + state.clockOffset;

function saveSeat(code, token) {
  state.code = code;
  state.token = token;
  try { sessionStorage.setItem(STORE, JSON.stringify({ code, token })); } catch { /* private mode */ }
}

function loadSeat() {
  try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch { return null; }
}

function clearSeat() {
  try { sessionStorage.removeItem(STORE); } catch { /* nothing to do */ }
}

/* ---------------- messages in ---------------- */

function handle(msg) {
  noteServerTime(msg);

  switch (msg.type) {
    case 'hello':
      state.games = msg.games;
      break;

    case 'joined':
      state.me = msg.playerId;
      state.spectator = !!msg.spectator;
      saveSeat(msg.code, msg.token);
      if (msg.spectator) toast('They have started — you are watching until the next round');
      break;

    case 'room':
      state.room = msg;
      if (msg.phase !== 'countdown') state.countdown = null;
      if (msg.phase === 'countdown') state.countdown = { endsAt: msg.countdownEndsAt };
      renderPhase();
      break;

    case 'countdown':
      state.countdown = { endsAt: msg.endsAt, durationMs: msg.durationMs };
      startCountdownLoop();
      break;

    case 'countdownAborted':
      state.countdown = null;
      toast(msg.reason || 'Countdown stopped');
      announce('Countdown stopped. Back to the lobby.');
      break;

    case 'gameStart':
      state.game = msg;
      state.progress = [];
      showView('game');
      renderGame();
      announce(`${msg.label} starting. Game ${msg.index + 1} of ${msg.total}.`);
      break;

    case 'submitResult':
      if (state.game) {
        state.game.view = msg.view;
        renderGame();
        describeResult(msg.result);
      }
      break;

    case 'progress':
      state.progress = msg.players;
      renderOpponents();
      break;

    case 'gameEnd':
      state.game = null;
      showResults(msg, false);
      break;

    case 'matchEnd':
      showResults(msg, true);
      break;

    case 'matchAbandoned':
      toast(msg.reason || 'The match was abandoned');
      break;

    case 'lobbyExpired':
      toast('It went quiet in here, so everyone is un-readied');
      break;

    case 'error':
      handleError(msg);
      break;
  }
}

const ERRORS = {
  'no-room': 'No room with that code',
  'no-seat': 'Your spot has gone',
  'countdown-locked': 'They are starting — try again in a second',
  'not-host': 'Only the host can do that',
  'not-ready': 'Everyone has to be ready first',
  'too-soon': 'Give them a moment longer',
  'nobody-ready': 'Nobody is ready yet',
  'locked': 'Too late, it is starting',
  'phase': 'Not right now',
  'duplicate': 'You already tried that one',
  'unknown': 'We do not know that word',
  'length': 'Wrong number of letters',
  'letters': 'You do not have those letters',
  'time': 'Time is up',
  'over': 'You are done with this one'
};

function handleError(msg) {
  if (msg.code === 'no-room' || msg.code === 'no-seat') {
    clearSeat();
    showView('join');
  }
  const text = ERRORS[msg.code] || msg.code;
  if (state.game) message(text, 'warn');
  else toast(text);
}

/* ---------------- views ---------------- */

function showView(name) {
  views.forEach(v => { el('view-' + v).hidden = v !== name; });
}

function renderPhase() {
  const room = state.room;
  if (!room) return;

  el('room-code').textContent = room.code;
  renderRoster();

  switch (room.phase) {
    case 'lobby':
      showView('lobby');
      renderLobby();
      break;
    case 'countdown':
      showView('countdown');
      renderCountdownRoster();
      el('btn-abort').hidden = !isHost();
      startCountdownLoop();
      break;
    case 'playing':
      if (state.game) showView('game');
      break;
    case 'interstitial':
    case 'results':
      /* The results view is put up by the gameEnd and matchEnd messages, which
         carry the scores; nothing to do here. */
      break;
  }
}

const isHost = () => !!(state.room && state.room.hostId === state.me);
const meInRoom = () => (state.room ? state.room.members.find(m => m.id === state.me) : null);

function renderRoster() {
  const list = el('roster');
  list.innerHTML = '';

  state.room.members.forEach(m => {
    const item = document.createElement('li');
    item.className = 'roster-row' + (m.connected ? '' : ' offline');

    const dot = document.createElement('span');
    dot.className = 'dot ' + (m.ready ? 'ready' : 'waiting');
    /* Colour is never the only signal: the state is spelled out beside it. */
    dot.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'roster-name';
    name.textContent = m.name + (m.id === state.me ? ' (you)' : '');

    const tags = document.createElement('span');
    tags.className = 'roster-tags';
    tags.textContent = [
      m.host ? 'host' : '',
      m.spectator ? 'watching' : '',
      !m.connected ? 'disconnected' : (m.ready ? 'ready' : 'not ready')
    ].filter(Boolean).join(' · ');

    item.append(dot, name, tags);
    list.appendChild(item);
  });
}

function renderLobby() {
  const room = state.room;
  const me = meInRoom();

  renderGamePicker();

  const ready = me && me.ready;
  el('btn-ready').textContent = ready ? "I'm not ready" : "I'm ready";
  el('btn-ready').classList.toggle('btn-ghost', !!ready);
  el('btn-ready').classList.toggle('btn-primary', !ready);
  el('btn-ready').hidden = !!(me && me.spectator);

  const playing = room.members.filter(m => !m.spectator && m.connected);
  const waiting = playing.filter(m => !m.ready);
  const canStart = isHost() && playing.length > 0 && (waiting.length === 0 || room.canForceStart);

  el('btn-start').hidden = !isHost();
  el('btn-start').disabled = !canStart;
  el('btn-start').textContent = waiting.length && room.canForceStart ? 'Start without them' : 'Start match';

  const notes = [];
  if (waiting.length) notes.push(`Waiting on ${waiting.map(m => m.name).join(', ')}`);
  if (playing.length < room.minPlayersToPost) {
    notes.push('On your own this is just practice — it will not count on the room table.');
  }
  if (!isHost()) notes.push('The host gets things going.');
  el('lobby-note').textContent = notes.join(' ');

  el('picker-note').hidden = isHost() ? false : true;
}

function renderGamePicker() {
  const picker = el('game-picker');
  const chosen = state.room.settings.games;
  picker.innerHTML = '';

  state.games.forEach(game => {
    const position = chosen.indexOf(game.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick' + (position >= 0 ? ' on' : '');
    btn.disabled = !isHost();
    btn.setAttribute('aria-pressed', String(position >= 0));
    btn.innerHTML = `<span class="pick-order">${position >= 0 ? position + 1 : ''}</span>
                     <span class="pick-name">${game.label}</span>
                     <span class="pick-time">${Math.round(game.timeLimitMs / 1000)}s</span>`;
    btn.addEventListener('click', () => toggleGame(game.id));
    picker.appendChild(btn);
  });
}

/* The order games are picked in is the order they are played in (LB-1.5). */
function toggleGame(id) {
  if (!isHost()) return;
  const games = state.room.settings.games.slice();
  const at = games.indexOf(id);

  if (at >= 0) games.splice(at, 1);
  else games.push(id);

  if (!games.length) return toast('Pick at least one game');
  send({ type: 'settings', games });
}

/* ---------------- countdown ---------------- */

let countdownFrame = null;
let announced = { start: false, two: false, go: false };

function startCountdownLoop() {
  if (!state.countdown) return;
  if (state.room && state.room.phase === 'countdown') showView('countdown');

  announced = { start: false, two: false, go: false };
  cancelAnimationFrame(countdownFrame);
  tickCountdown();
}

function tickCountdown() {
  if (!state.countdown) return;

  const total = state.countdown.durationMs || 5000;
  const remaining = state.countdown.endsAt - serverTime();
  const seconds = Math.max(0, Math.ceil(remaining / 1000));

  el('count-number').textContent = seconds > 0 ? String(seconds) : 'Go';
  el('count-number').classList.toggle('urgent', remaining <= 2000);

  /* CD-1.8: the ring drains, and shifts colour at two seconds. Under
     prefers-reduced-motion the CSS drops the drain and leaves the number. */
  const ring = el('ring-drain');
  const circumference = 2 * Math.PI * 52;
  const fraction = Math.max(0, Math.min(1, remaining / total));
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - fraction));
  ring.classList.toggle('urgent', remaining <= 2000);

  /* CD-1.9: three announcements, not one a second. */
  if (!announced.start) { announce('Match starting in five seconds'); announced.start = true; }
  if (!announced.two && remaining <= 2000 && remaining > 0) { announce('Two seconds'); announced.two = true; }
  if (!announced.go && remaining <= 0) { announce('Go'); announced.go = true; }

  countdownFrame = requestAnimationFrame(tickCountdown);
}

function renderCountdownRoster() {
  const list = el('countdown-roster');
  list.innerHTML = '';
  /* CD-1.8: the roster of who is in stays visible through the countdown. */
  state.room.members.filter(m => !m.spectator).forEach(m => {
    const item = document.createElement('li');
    item.className = 'roster-row small';
    item.textContent = m.name + (m.ready ? ' · ready' : '');
    list.appendChild(item);
  });
}

/* ---------------- playing ---------------- */

let timerFrame = null;

function renderGame() {
  const game = state.game;
  if (!game) return;

  el('game-slot').textContent = `Game ${game.index + 1} of ${game.total}`;
  el('game-name').textContent = game.label;

  const area = el('game-area');
  area.innerHTML = '';
  if (game.gameId === 'shabda') area.appendChild(shabdaBoard(game.view));
  if (game.gameId === 'snowman') area.appendChild(snowmanBoard(game.view));
  if (game.gameId === 'anagram') area.appendChild(anagramBoard(game.view));

  renderOpponents();
  runTimer();
}

function runTimer() {
  cancelAnimationFrame(timerFrame);
  const tick = () => {
    if (!state.game) return;
    const left = Math.max(0, state.game.deadline - serverTime());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    const node = el('game-timer');
    node.textContent = `${m}:${String(s).padStart(2, '0')}`;
    node.classList.toggle('urgent', left <= 15000);
    timerFrame = requestAnimationFrame(tick);
  };
  tick();
}

function renderOpponents() {
  const list = el('opponents');
  list.innerHTML = '';

  state.progress.forEach(player => {
    const item = document.createElement('li');
    item.className = 'opponent' + (player.connected ? '' : ' offline');

    const name = document.createElement('span');
    name.className = 'opponent-name';
    name.textContent = player.name + (player.id === state.me ? ' (you)' : '');

    const status = document.createElement('span');
    status.className = 'opponent-status';
    status.textContent = !player.connected ? 'disconnected'
      : player.resolved ? (player.solved ? 'solved' : 'out of attempts')
      : `${player.attemptsUsed} attempt${player.attemptsUsed === 1 ? '' : 's'}`;

    item.append(name, status);
    list.appendChild(item);
  });
}

/* --- Shabda --- */

function shabdaBoard(view) {
  const wrap = document.createElement('div');
  wrap.className = 'shabda';

  const board = document.createElement('div');
  board.className = 'sh-board';

  for (let row = 0; row < view.attempts; row++) {
    const guess = view.guesses[row] || '';
    const verdict = view.verdicts[row] || [];

    for (let col = 0; col < view.length; col++) {
      const tile = document.createElement('div');
      const typed = row === view.guesses.length ? (typedGuess[col] || '') : '';
      tile.className = 'sh-tile ' + (verdict[col] || '');
      tile.textContent = guess[col] || typed;
      board.appendChild(tile);
    }
  }

  wrap.appendChild(board);
  wrap.appendChild(letterKeyboard(view, ch => typeShabda(ch)));
  return wrap;
}

let typedGuess = [];

function typeShabda(key) {
  if (!state.game || state.game.gameId !== 'shabda') return;

  if (key === 'ENTER') {
    if (typedGuess.length !== state.game.view.length) return message('Not enough letters yet', 'warn');
    send({ type: 'submit', payload: { guess: typedGuess.join('') } });
    typedGuess = [];
    return;
  }
  if (key === 'BACK') { typedGuess.pop(); return renderGame(); }
  if (typedGuess.length >= state.game.view.length) return;

  typedGuess.push(key);
  renderGame();
}

/* --- Snowman --- */

function snowmanBoard(view) {
  const wrap = document.createElement('div');
  wrap.className = 'snowman';

  const category = document.createElement('div');
  category.className = 'chip';
  category.textContent = 'Category: ' + view.category;

  const lives = document.createElement('div');
  lives.className = 'lives';
  lives.textContent = `${view.lives - view.wrongGuesses} of ${view.lives} lives left`;

  const word = document.createElement('div');
  word.className = 'sm-word';
  [...view.mask].forEach(ch => {
    const slot = document.createElement('span');
    slot.className = 'sm-slot' + (ch === ' ' ? ' gap' : ch === '_' ? '' : ' filled');
    slot.textContent = ch === '_' ? '' : ch;
    word.appendChild(slot);
  });

  wrap.append(category, word, lives);
  wrap.appendChild(letterKeyboard(view, ch => send({ type: 'submit', payload: { letter: ch } }), view.guessed));
  return wrap;
}

/* --- Anagram --- */

function anagramBoard(view) {
  const wrap = document.createElement('div');
  wrap.className = 'anagram';

  const which = document.createElement('div');
  which.className = 'chip';
  which.textContent = `Word ${view.slot + 1} of 2`;

  const scramble = view.scrambles[view.slot] || '';
  const tiles = document.createElement('div');
  tiles.className = 'an-tiles';
  [...scramble].forEach(ch => {
    const tile = document.createElement('span');
    tile.className = 'an-tile';
    tile.textContent = ch;
    tiles.appendChild(tile);
  });

  const word = state.game.view.words[view.slot];
  const attempts = document.createElement('div');
  attempts.className = 'lives';
  attempts.textContent = `${view.attempts - word.attemptsUsed} of ${view.attempts} attempts left`;

  const form = document.createElement('form');
  form.className = 'an-form';
  form.innerHTML = `<input type="text" id="an-input" maxlength="12" placeholder="Your answer"
                      aria-label="Your answer" spellcheck="false" autocomplete="off" />
                    <button class="btn btn-primary" type="submit">Submit</button>`;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const input = el('an-input');
    const guess = (input.value || '').trim().toLowerCase();
    if (!guess) return;
    send({ type: 'submit', payload: { guess } });
    input.value = '';
  });

  wrap.append(which, tiles, attempts, form);
  return wrap;
}

/* --- shared letter keyboard --- */

const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['ENTER', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'BACK']
];

function letterKeyboard(view, onKey, spent = []) {
  const pad = document.createElement('div');
  pad.className = 'keyboard';
  const wantsEnter = state.game && state.game.gameId === 'shabda';

  KEY_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';

    row.forEach(key => {
      if (!wantsEnter && (key === 'ENTER' || key === 'BACK')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key' + (key.length > 1 ? ' wide' : '') + (spent.includes(key) ? ' spent' : '');
      btn.textContent = key === 'BACK' ? '⌫' : key;
      btn.disabled = spent.includes(key) || view.resolved;
      btn.addEventListener('click', () => onKey(key));
      rowEl.appendChild(btn);
    });

    pad.appendChild(rowEl);
  });

  return pad;
}

function describeResult(result) {
  if (!result) return;
  if (result.solved) return message('Solved', 'good');
  if (result.correct) return message('Got it — on to the next word', 'good');
  if (result.hit === true) return message('Yes, that one is in there', 'good');
  if (result.hit === false) return message('Not in the word', 'bad');
  if (result.resolved) return message('Out of guesses', 'bad');
  message('Keep going', '');
}

/* ---------------- results ---------------- */

function showResults(msg, isMatchEnd) {
  showView('results');
  cancelAnimationFrame(timerFrame);

  el('results-title').textContent = isMatchEnd ? 'Match over' : 'Standings so far';
  el('btn-rematch').hidden = !(isMatchEnd && isHost());

  const reveal = el('reveal');
  if (!isMatchEnd && msg.reveal) {
    const answers = msg.reveal.answers || [msg.reveal.answer];
    reveal.hidden = false;
    reveal.innerHTML = `<span class="reveal-label">The answer${answers.length > 1 ? 's' : ''}</span>
                        <b>${answers.join(' · ').toUpperCase()}</b>`;
  } else {
    reveal.hidden = true;
  }

  const board = el('scoreboard');
  board.innerHTML = '';
  const rows = isMatchEnd ? msg.scoreboard : msg.standings;

  rows.forEach((row, i) => {
    const item = document.createElement('li');
    item.className = 'score-row' + (row.id === state.me ? ' me' : '');
    item.innerHTML = `<span class="rank">${i + 1}</span>
                      <span class="score-name">${escapeHtml(row.name)}</span>
                      <span class="score-points">${row.points}</span>`;
    board.appendChild(item);
  });

  const standings = el('standings');
  const showStandings = isMatchEnd && msg.standings && msg.standings.length;
  el('standings-title').hidden = !showStandings;
  standings.hidden = !showStandings;

  if (showStandings) {
    standings.innerHTML = '';
    msg.standings.forEach((row, i) => {
      const item = document.createElement('li');
      item.className = 'score-row' + (row.id === state.me ? ' me' : '');
      item.innerHTML = `<span class="rank">${i + 1}</span>
                        <span class="score-name">${escapeHtml(row.name)}</span>
                        <span class="score-points">${row.average} avg</span>`;
      standings.appendChild(item);
    });
  }

  const notes = [];
  if (isMatchEnd && msg.posted === false) notes.push('Practice run — this one does not count.');
  if (!isMatchEnd) notes.push('Next game coming up…');
  if (isMatchEnd && !isHost()) notes.push('The host can start another round.');
  el('results-note').textContent = notes.join(' ');

  announce(isMatchEnd ? 'Match over. ' + rows.map(r => `${r.name} ${r.points}`).join(', ')
                      : 'Game over. Standings updated.');
}

/* ---------------- small helpers ---------------- */

function announce(text) { el('live').textContent = text; }

function message(text, tone = '') {
  const node = el('game-message');
  node.textContent = text;
  node.className = 'message ' + tone;
  if (text) announce(text);
}

function toast(text, ms = 2600) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  el('toast-area').appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 300);
  }, ms);
  announce(text);
}

function renderConnection() {
  const node = el('conn');
  node.classList.toggle('offline', !state.connected);
  node.title = state.connected ? 'Connected' : 'Reconnecting…';
  node.setAttribute('aria-label', node.title);

  /* The banner is the honest version of that little dot: what is wrong, and what
     to do about it. */
  const banner = el('offline');
  banner.hidden = state.connected || !showOffline;

  if (!banner.hidden) {
    if (servedFromFile) {
      el('offline-title').textContent = 'Rooms need the Parea server running';
      el('offline-detail').innerHTML =
        'This page was opened straight from a file, so there is nothing for it to talk to. ' +
        'Start the Parea server with <code>npm start</code> in the <code>server</code> folder, then ' +
        'open <code>http://localhost:8080/room/</code>.';
    } else {
      el('offline-title').textContent = 'Cannot reach the Parea server';
      el('offline-detail').innerHTML =
        'Trying again… If you are hosting this yourself, rooms need the Parea server running: ' +
        '<code>npm start</code> in the <code>server</code> folder, then open ' +
        '<code>/room/</code> on that port.';
    }
  }

  /* Nothing here works without a connection, so do not pretend otherwise. */
  ['btn-create', 'btn-ready', 'btn-start', 'btn-abort', 'btn-rematch'].forEach(id => {
    const button = el(id);
    if (button) button.disabled = !state.connected;
  });
  const joinButton = document.querySelector('#join-form button');
  if (joinButton) joinButton.disabled = !state.connected;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- controls ---------------- */

el('btn-create').addEventListener('click', () => {
  clearSeat();
  send({ type: 'create', name: el('name').value || 'Player' });
});

el('join-form').addEventListener('submit', e => {
  e.preventDefault();
  const code = (el('code').value || '').toUpperCase().trim();
  if (code.length < 4) return toast('Room codes are four letters long');
  clearSeat();
  send({ type: 'join', code, name: el('name').value || 'Player' });
});

el('btn-ready').addEventListener('click', () => {
  const me = meInRoom();
  send({ type: 'ready', ready: !(me && me.ready) });
});

el('btn-start').addEventListener('click', () => {
  const room = state.room;
  const waiting = room.members.filter(m => !m.spectator && m.connected && !m.ready);
  send({ type: 'start', force: waiting.length > 0 });
});

el('btn-abort').addEventListener('click', () => send({ type: 'abort' }));
el('btn-rematch').addEventListener('click', () => send({ type: 'rematch' }));

el('btn-copy').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?code=${state.room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied — go and share it');
  } catch {
    toast(link);
  }
});

el('btn-help').addEventListener('click', () => { el('help-modal').hidden = false; });
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.hasAttribute('data-close')) modal.hidden = true;
  });
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') return void document.querySelectorAll('.modal:not([hidden])').forEach(m => (m.hidden = true));
  if (!state.game || state.game.gameId !== 'shabda') return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

  if (e.key === 'Enter') { e.preventDefault(); return typeShabda('ENTER'); }
  if (e.key === 'Backspace') { e.preventDefault(); return typeShabda('BACK'); }
  const key = e.key.toLowerCase();
  if (/^[a-z]$/.test(key)) typeShabda(key);
});

/* Coming back from the background: ask where things are rather than trusting a
   clock that may have been asleep (TR-6). */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  send({ type: 'sync' });
  if (state.countdown) startCountdownLoop();
});

/* A shared link carries the code. */
const params = new URLSearchParams(location.search);
if (params.get('code')) el('code').value = params.get('code').toUpperCase();

renderConnection();
connect();

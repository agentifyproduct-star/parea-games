/* Rooms, lobbies, countdowns and matches.

   Deliberately free of sockets: a Room is handed a `send` function and calls it.
   That keeps the whole state machine — including every timing rule — drivable by
   the test harness without a network in the way.

   The shape of a session:

     lobby  --(all ready, host starts)-->  countdown (5s)
     countdown  --(completes)-->  puzzles generated, first game delivered
     countdown  --(host aborts, or anyone drops)-->  lobby
     playing  --(all resolved, or the clock runs out)-->  interstitial
     interstitial  --(next game)-->  playing, or --> results
     results  --(rematch)-->  lobby

   Puzzles are generated at the instant the countdown completes and not one
   moment earlier, which is what makes the reroll exploits in Section 2 of the
   spec impossible rather than merely inconvenient. */

const crypto = require('crypto');
const puzzles = require('./puzzles.js');
const scoring = require('./scoring.js');

const COUNTDOWN_MS = Number(process.env.ROOM_COUNTDOWN_MS || 5000);   // decision D-8
const COUNTDOWN_RESYNC_MS = Math.floor(COUNTDOWN_MS / 2);             // CD-1.3
const READY_TIMEOUT_MS = Number(process.env.ROOM_READY_TIMEOUT_MS || 60000);   // decision D-6
const DISCONNECT_GRACE_MS = Number(process.env.ROOM_GRACE_MS || 45000);        // CN-1.7
const LOBBY_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 15 * 60000);
const INTERSTITIAL_MS = Number(process.env.ROOM_INTERSTITIAL_MS || 5000);      // MS-1.5
const MIN_PLAYERS_TO_POST = 2;                                                // decision D-1

const rooms = new Map();

const now = () => Date.now();
const newId = () => crypto.randomBytes(8).toString('hex');

/* Unambiguous room codes: no O/0, no I/1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor() {
    this.code = newCode();
    this.createdAt = now();
    this.members = new Map();          // playerId -> member
    this.hostId = null;
    this.phase = 'lobby';              // lobby | countdown | playing | interstitial | results
    this.settings = { games: ['shabda', 'anagram'] };
    this.match = null;
    this.standings = new Map();        // playerId -> { name, points, matches, wins, best }
    this.recentWords = [];             // flat list, newest first, trimmed to the recent window
    this.matchesPlayed = 0;
    this.readyDeadline = null;
    this.timers = {};
    this.touchIdle();
    rooms.set(this.code, this);
  }

  /* ---------------- membership ---------------- */

  join(name) {
    const member = {
      id: newId(),
      token: newId(),
      name: String(name || 'Player').slice(0, 20),
      connected: true,
      ready: false,
      spectator: this.phase !== 'lobby',    // 4.2: arrive mid-match, watch until the next one
      joinedAt: now(),
      send: null
    };
    this.members.set(member.id, member);
    if (!this.hostId) this.hostId = member.id;
    this.touchIdle();
    return member;
  }

  /* Reconnection is by token, so a refresh or a dropped connection returns to the
     same seat rather than a new one (CN-1.2). */
  memberByToken(token) {
    return [...this.members.values()].find(m => m.token === token) || null;
  }

  /* `socketId` identifies the connection currently holding the seat. A client
     that reconnects while its old socket is still hanging around takes the seat
     over, and the old socket's eventual close is then ignored — otherwise a
     reconnect would tear down the very countdown it just rejoined. */
  attach(member, send, socketId) {
    member.send = send;
    member.socketId = socketId;
    const wasDisconnected = !member.connected;
    member.connected = true;
    clearTimeout(this.timers['grace:' + member.id]);
    if (wasDisconnected) this.broadcastRoom();
    return wasDisconnected;
  }

  /* A dropped connection holds the seat for a grace window before it is freed,
     so backgrounding a phone is not the same as leaving (CN-1.7). */
  detach(member, socketId) {
    if (socketId !== undefined && member.socketId !== socketId) return;   // a stale socket closing

    member.send = null;
    member.connected = false;
    member.ready = false;               // 4.2: ready state clears on disconnect

    /* CN-1.5: hand the room over straight away rather than after the grace
       window, so nobody is left unable to start while the old host's seat is
       still being held. */
    if (this.hostId === member.id) this.transferHost();

    if (this.phase === 'countdown') this.abortCountdown('a player dropped');   // CD-1.7

    this.timers['grace:' + member.id] = setTimeout(() => this.remove(member.id), DISCONNECT_GRACE_MS);
    this.broadcastRoom();
  }

  remove(id) {
    const member = this.members.get(id);
    if (!member) return;
    clearTimeout(this.timers['grace:' + id]);
    this.members.delete(id);

    if (this.hostId === id) this.transferHost();
    this.releaseFromMatch(id);
    if (!this.members.size) return this.destroy();

    if (this.phase === 'countdown') this.abortCountdown('a player left');
    this.broadcastRoom();
  }

  /* Someone who is gone for good should not hold the game open until the clock
     runs out. Their state resolves where it stands and is scored on what they
     actually achieved, which is what CN-1.4 asks for — while everyone still
     playing gets on with it. */
  releaseFromMatch(id) {
    if (this.phase !== 'playing' || !this.match) return;

    const slot = this.match.games[this.match.index];
    const state = slot && slot.states && slot.states.get(id);
    if (!state || state.resolved) return;

    state.resolved = true;
    state.resolvedAt = now();
    this.match.log.push({
      t: state.resolvedAt, type: 'resolve', playerId: id, gameId: slot.gameId,
      index: this.match.index, solved: false, reason: 'left'
    });

    this.broadcastProgress();
    if ([...slot.states.values()].every(s => s.resolved)) this.endGame('all-resolved');
  }

  /* Host passes to whoever has been here longest (4.2, CN-1.5). */
  transferHost() {
    const next = [...this.members.values()]
      .filter(m => m.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0]
      || [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    this.hostId = next ? next.id : null;
  }

  destroy() {
    Object.values(this.timers).forEach(clearTimeout);
    rooms.delete(this.code);
  }

  /* ---------------- lobby ---------------- */

  players() {
    return [...this.members.values()].filter(m => !m.spectator);
  }

  connectedPlayers() {
    return this.players().filter(m => m.connected);
  }

  setReady(member, ready) {
    if (this.phase !== 'lobby') return { error: 'locked' };     // CD-1.5
    if (member.spectator) return { error: 'spectator' };

    member.ready = !!ready;
    this.armReadyTimeout();
    this.broadcastRoom();
    return { ok: true };
  }

  /* LB-1.6: nobody should be ready to a match they did not agree to. */
  setSettings(member, games) {
    if (member.id !== this.hostId) return { error: 'not-host' };
    if (this.phase !== 'lobby') return { error: 'locked' };

    const valid = (Array.isArray(games) ? games : []).filter(id => puzzles.gameById(id));
    if (!valid.length) return { error: 'no-games' };

    this.settings = { games: valid.slice(0, 5) };
    this.members.forEach(m => { m.ready = false; });
    this.readyDeadline = null;
    this.broadcastRoom();
    return { ok: true };
  }

  everyoneReady() {
    const playing = this.connectedPlayers();
    return playing.length > 0 && playing.every(m => m.ready);
  }

  armReadyTimeout() {
    clearTimeout(this.timers.ready);
    const waiting = this.connectedPlayers().some(m => !m.ready);

    if (!waiting || this.connectedPlayers().length < 2) {
      this.readyDeadline = null;
      return;
    }
    /* After the wait, the host may force-start without the stragglers (4.2). */
    this.readyDeadline = now() + READY_TIMEOUT_MS;
    this.timers.ready = setTimeout(() => {
      this.readyDeadline = now();
      this.broadcastRoom();
    }, READY_TIMEOUT_MS);
  }

  canForceStart() {
    return this.readyDeadline !== null && now() >= this.readyDeadline;
  }

  /* ---------------- countdown ---------------- */

  startCountdown(member, { force = false } = {}) {
    if (member.id !== this.hostId) return { error: 'not-host' };
    if (this.phase !== 'lobby') return { error: 'phase' };

    const playing = this.connectedPlayers();
    if (!playing.length) return { error: 'nobody-here' };

    if (!this.everyoneReady()) {
      if (!force) return { error: 'not-ready' };
      if (!this.canForceStart()) return { error: 'too-soon' };

      /* Force-start drops whoever never readied to spectator, and plays on with
         the rest (4.2, acceptance criterion 5). */
      playing.filter(m => !m.ready).forEach(m => { m.spectator = true; });
      if (!this.connectedPlayers().length) return { error: 'nobody-ready' };
    }

    this.phase = 'countdown';
    this.countdownEndsAt = now() + COUNTDOWN_MS;
    clearTimeout(this.timers.ready);
    this.readyDeadline = null;

    this.broadcastRoom();
    this.broadcastCountdown();

    /* CD-1.3: one mid-flight resync, so a throttled client converges instead of
       finishing late. */
    this.timers.resync = setTimeout(() => this.broadcastCountdown(), COUNTDOWN_RESYNC_MS);
    this.timers.countdown = setTimeout(() => this.beginMatch(), COUNTDOWN_MS);
    return { ok: true };
  }

  abortCountdown(reason = 'aborted') {
    if (this.phase !== 'countdown') return { error: 'phase' };

    clearTimeout(this.timers.countdown);
    clearTimeout(this.timers.resync);
    this.countdownEndsAt = null;
    this.phase = 'lobby';

    /* CD-1.6: ready states survive an abort — the match was called off, not
       disagreed with. No puzzles existed yet, so there is nothing to discard. */
    this.send({ type: 'countdownAborted', reason });
    this.armReadyTimeout();
    this.broadcastRoom();
    return { ok: true };
  }

  hostAbort(member) {
    if (member.id !== this.hostId) return { error: 'not-host' };
    return this.abortCountdown('the host stopped the countdown');
  }

  broadcastCountdown() {
    if (this.phase !== 'countdown') return;
    this.send({
      type: 'countdown',
      endsAt: this.countdownEndsAt,
      durationMs: COUNTDOWN_MS,
      serverNow: now()                 // CD-1.2: clients render a difference, not a local loop
    });
  }

  /* ---------------- the match ---------------- */

  beginMatch() {
    clearTimeout(this.timers.resync);

    const roster = this.connectedPlayers();
    if (!roster.length) return this.abortCountdown('everyone left');

    /* Here, and nowhere earlier, is where the words come into existence. */
    const games = puzzles.generateMatch(this.settings.games, this.recentWords);

    this.match = {
      id: newId(),
      startedAt: now(),
      games,
      index: -1,
      posts: roster.length >= MIN_PLAYERS_TO_POST,     // D-1: solo practice does not post
      roster: roster.map(m => m.id),
      players: new Map(roster.map(m => [m.id, { name: m.name, slots: [] }])),
      log: [{ t: now(), type: 'matchStart', roster: roster.map(m => m.id), games: games.map(g => g.gameId) }],
      abandoned: false
    };

    this.matchesPlayed += 1;
    this.rememberWords(games);
    this.nextGame();
  }

  rememberWords(games) {
    const words = games.flatMap(g => g.secret.words || []);
    this.recentWords = [...words, ...this.recentWords].slice(0, puzzles.RECENT_MATCHES * 4);
  }

  nextGame() {
    const match = this.match;
    match.index += 1;

    if (match.index >= match.games.length) return this.endMatch();

    const slot = match.games[match.index];
    const game = puzzles.gameById(slot.gameId);

    this.phase = 'playing';
    slot.deliveredAt = now();                       // SC-1.6: scoring measures from here
    slot.deadline = slot.deliveredAt + game.timeLimitMs;
    slot.states = new Map();

    match.roster.forEach(id => {
      const member = this.members.get(id);
      if (!member) return;
      slot.states.set(id, game.blankPlayer());
    });

    match.log.push({
      t: slot.deliveredAt, type: 'deliver', gameId: slot.gameId, index: match.index,
      deadline: slot.deadline, players: [...slot.states.keys()]
    });

    this.broadcastRoom();
    slot.states.forEach((playerState, id) => {
      const member = this.members.get(id);
      if (!member || !member.send) return;
      member.send(this.gameStartMessage(slot, game, playerState));
    });
    this.broadcastProgress();

    clearTimeout(this.timers.game);
    this.timers.game = setTimeout(() => this.endGame('time'), game.timeLimitMs);
  }

  gameStartMessage(slot, game, playerState) {
    return {
      type: 'gameStart',
      matchId: this.match.id,
      gameId: slot.gameId,
      label: game.label,
      index: this.match.index,
      total: this.match.games.length,
      deadline: slot.deadline,
      serverNow: now(),
      view: game.view(slot.secret, playerState)
    };
  }

  submit(member, payload) {
    if (this.phase !== 'playing' || !this.match) return { error: 'phase' };

    const slot = this.match.games[this.match.index];
    const state = slot.states.get(member.id);
    if (!state) return { error: 'not-playing' };
    if (now() > slot.deadline) return { error: 'time' };

    const game = puzzles.gameById(slot.gameId);
    const result = game.submit(slot.secret, state, payload);

    this.match.log.push({
      t: now(), type: 'submit', playerId: member.id, gameId: slot.gameId,
      index: this.match.index, payload, rejected: result.rejected || null
    });

    if (result.rejected) return { error: result.rejected };

    if (state.resolved && !state.resolvedAt) {
      state.resolvedAt = now();
      this.match.log.push({
        t: state.resolvedAt, type: 'resolve', playerId: member.id,
        gameId: slot.gameId, index: this.match.index, solved: !!state.solved
      });
    }

    this.broadcastProgress();

    /* MS-1.4: the game ends the moment everyone is done, without waiting out the
       clock. */
    const everyoneDone = [...slot.states.values()].every(s => s.resolved);
    if (everyoneDone) this.endGame('all-resolved');

    return { ok: true, result, view: game.view(slot.secret, state) };
  }

  /* Progress only, never a guess or a revealed letter (decision D-3). */
  broadcastProgress() {
    if (this.phase !== 'playing' || !this.match) return;

    const slot = this.match.games[this.match.index];
    const game = puzzles.gameById(slot.gameId);

    this.send({
      type: 'progress',
      gameId: slot.gameId,
      players: [...slot.states.entries()].map(([id, state]) => {
        const member = this.members.get(id);
        return {
          id,
          name: member ? member.name : 'gone',
          connected: member ? member.connected : false,
          ...game.progress(state)
        };
      })
    });
  }

  endGame(reason) {
    if (this.phase !== 'playing' || !this.match) return;
    clearTimeout(this.timers.game);

    const match = this.match;
    const slot = match.games[match.index];
    const game = puzzles.gameById(slot.gameId);
    const endedAt = now();

    match.log.push({
      t: endedAt, type: 'gameEnd', gameId: slot.gameId, index: match.index, reason,
      secret: slot.secret                                   // recorded for replay, after the fact
    });

    const scores = [];
    slot.states.forEach((state, id) => {
      const score = scoreState(game, slot, state, endedAt);
      const entry = match.players.get(id);
      if (entry) entry.slots.push({ gameId: slot.gameId, ...score });

      const member = this.members.get(id);
      scores.push({
        id,
        name: member ? member.name : (entry ? entry.name : 'gone'),
        ...score
      });
    });

    scores.sort((a, b) => b.points - a.points);
    this.phase = 'interstitial';

    this.send({
      type: 'gameEnd',
      gameId: slot.gameId,
      reason,
      reveal: game.reveal(slot.secret),                     // answers, now that it is over
      scores,
      standings: this.matchStandings(),
      nextInMs: INTERSTITIAL_MS,
      isLast: match.index >= match.games.length - 1
    });
    this.broadcastRoom();

    clearTimeout(this.timers.interstitial);
    this.timers.interstitial = setTimeout(() => {
      if (this.match === match) this.nextGame();
    }, INTERSTITIAL_MS);
  }

  matchStandings() {
    if (!this.match) return [];
    return [...this.match.players.entries()]
      .map(([id, entry]) => ({
        id,
        name: entry.name,
        points: scoring.round(entry.slots.reduce((sum, s) => sum + s.points, 0)),
        slots: entry.slots
      }))
      .sort((a, b) => b.points - a.points);
  }

  endMatch() {
    const match = this.match;
    if (!match) return;

    clearTimeout(this.timers.game);
    clearTimeout(this.timers.interstitial);

    const scoreboard = this.matchStandings();
    match.log.push({ t: now(), type: 'matchEnd', scoreboard });

    /* SC-2.4 and SC-2.5: practice and wreckage do not post. */
    if (match.posts && !match.abandoned) {
      const winner = scoreboard[0];
      scoreboard.forEach(entry => {
        const record = this.standings.get(entry.id)
          || { id: entry.id, name: entry.name, points: 0, matches: 0, wins: 0, best: 0 };
        record.name = entry.name;
        record.points = scoring.round(record.points + entry.points);
        record.matches += 1;
        record.best = Math.max(record.best, entry.points);
        if (winner && winner.id === entry.id) record.wins += 1;
        this.standings.set(entry.id, record);
      });
    }

    this.phase = 'results';
    /* Kept after the match object goes: the log is the record scores can be
       recomputed from, and the only thing that outlives the match. */
    this.lastLog = match.log;
    this.members.forEach(m => { m.ready = false; m.spectator = false; });   // MS-1.7: everyone is in for the rematch

    this.send({
      type: 'matchEnd',
      scoreboard,
      posted: match.posts && !match.abandoned,
      standings: this.roomStandings()
    });
    this.broadcastRoom();
    this.match = null;
  }

  /* CN-1.6: a match nobody can finish ends without posting a corrupt result. */
  abandonMatch(reason) {
    if (!this.match) return;
    this.match.abandoned = true;
    this.match.log.push({ t: now(), type: 'abandoned', reason });
    this.send({ type: 'matchAbandoned', reason });
    this.endMatch();
  }

  rematch(member) {
    if (member.id !== this.hostId) return { error: 'not-host' };
    if (this.phase !== 'results') return { error: 'phase' };

    this.phase = 'lobby';
    this.members.forEach(m => { m.ready = false; });
    this.armReadyTimeout();
    this.broadcastRoom();
    return { ok: true };
  }

  roomStandings() {
    return scoring.rankStandings([...this.standings.values()]);
  }

  /* ---------------- talking to clients ---------------- */

  send(message, filter = () => true) {
    this.members.forEach(member => {
      if (member.send && filter(member)) member.send(message);
    });
  }

  roomState() {
    return {
      type: 'room',
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      minPlayersToPost: MIN_PLAYERS_TO_POST,
      readyDeadline: this.readyDeadline,
      canForceStart: this.canForceStart(),
      countdownEndsAt: this.phase === 'countdown' ? this.countdownEndsAt : null,
      serverNow: now(),
      matchesPlayed: this.matchesPlayed,
      members: [...this.members.values()].map(m => ({
        id: m.id,
        name: m.name,
        connected: m.connected,
        ready: m.ready,
        spectator: m.spectator,
        host: m.id === this.hostId
      })),
      standings: this.roomStandings()
    };
  }

  broadcastRoom() {
    this.touchIdle();
    this.send(this.roomState());
  }

  /* 4.2: a lobby left alone long enough returns to an unstarted state rather
     than sitting there half-ready forever. */
  touchIdle() {
    clearTimeout(this.timers.idle);
    this.timers.idle = setTimeout(() => {
      if (this.phase === 'lobby') {
        this.members.forEach(m => { m.ready = false; });
        this.readyDeadline = null;
        this.send({ type: 'lobbyExpired' });
        this.broadcastRoom();
      }
      if (!this.members.size) this.destroy();
    }, LOBBY_IDLE_MS);
  }
}

/* One player's score for one game slot. Anagram's two words are scored
   separately and averaged, so every game lands in the same band. */
function scoreState(game, slot, state, endedAt) {
  const elapsed = (state.resolvedAt || endedAt) - slot.deliveredAt;

  if (game.id === 'anagram') {
    return scoring.scoreCombined(state.words.map(word => ({
      solved: word.solved,
      attemptsUsed: word.attemptsUsed,
      maxAttempts: game.maxAttempts,
      elapsedMs: elapsed,
      timeLimitMs: game.timeLimitMs,
      partial: word.solved ? 1 : 0
    })));
  }

  return scoring.scoreSlot({
    solved: state.solved,
    attemptsUsed: state.attemptsUsed !== undefined ? state.attemptsUsed : state.wrongGuesses + 1,
    maxAttempts: game.maxAttempts,
    elapsedMs: elapsed,
    timeLimitMs: game.timeLimitMs,
    partial: game.partial(slot.secret, state)
  });
}

/* Acceptance criterion 8: the log alone is enough to recompute every score.
   Replays each submit against the recorded secret and rescores from scratch. */
function replayScores(log) {
  const slots = new Map();
  const results = new Map();

  log.forEach(entry => {
    if (entry.type === 'deliver') {
      slots.set(entry.index, { gameId: entry.gameId, deliveredAt: entry.t, states: new Map(), players: entry.players });
    }
    if (entry.type === 'submit' && !entry.rejected) {
      const slot = slots.get(entry.index);
      const game = puzzles.gameById(entry.gameId);
      if (!slot || !game) return;
      if (!slot.states.has(entry.playerId)) slot.states.set(entry.playerId, game.blankPlayer());
      slot.pendingSubmits = slot.pendingSubmits || [];
      slot.pendingSubmits.push(entry);
    }
    if (entry.type === 'resolve') {
      const slot = slots.get(entry.index);
      if (slot) (slot.resolvedAt = slot.resolvedAt || new Map()).set(entry.playerId, entry.t);
    }
    if (entry.type === 'gameEnd') {
      const slot = slots.get(entry.index);
      const game = puzzles.gameById(entry.gameId);
      if (!slot || !game) return;

      slot.players.forEach(id => { if (!slot.states.has(id)) slot.states.set(id, game.blankPlayer()); });
      (slot.pendingSubmits || []).forEach(sub => {
        game.submit(entry.secret, slot.states.get(sub.playerId), sub.payload);
      });

      slot.states.forEach((state, id) => {
        if (slot.resolvedAt && slot.resolvedAt.has(id)) state.resolvedAt = slot.resolvedAt.get(id);
        const score = scoreState(game, { secret: entry.secret, deliveredAt: slot.deliveredAt }, state, entry.t);
        const total = results.get(id) || { points: 0, slots: [] };
        total.points = scoring.round(total.points + score.points);
        total.slots.push({ gameId: entry.gameId, ...score });
        results.set(id, total);
      });
    }
  });

  return results;
}

module.exports = {
  Room,
  rooms,
  replayScores,
  scoreState,
  COUNTDOWN_MS,
  READY_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
  INTERSTITIAL_MS,
  MIN_PLAYERS_TO_POST
};

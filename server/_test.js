/* Integration tests for room play.

   Real sockets, real timers, real server. The countdown is left at its true 5
   seconds because acceptance criteria 11 to 14 are about exactly that; the other
   waits are shortened through the same environment variables production would
   use to tune them.

   Run: node _test.js */

process.env.ROOM_INTERSTITIAL_MS = '150';
process.env.ROOM_GRACE_MS = '600';
process.env.ROOM_READY_TIMEOUT_MS = '900';
process.env.ROOM_IDLE_MS = '600000';

const http = require('http');
const WebSocket = require('ws');
const { server, LIMITS } = require('./index.js');
const { Room, rooms, replayScores, COUNTDOWN_MS } = require('./rooms.js');
const puzzles = require('./puzzles.js');
const scoring = require('./scoring.js');

const results = [];
let failures = 0;

function check(name, condition, detail) {
  const line = (condition ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && detail !== '' ? ' :: ' + detail : '');
  if (!condition) failures++;
  results.push(line);
  console.log(line);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- a client ---------------- */

let PORT = 0;

class Client {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.consumed = new Set();
    this.socket = new WebSocket(`ws://localhost:${PORT}/rooms`);
    this.open = new Promise(resolve => this.socket.once('open', resolve));
    this.socket.on('message', raw => this.messages.push(JSON.parse(raw)));
  }

  send(msg) { this.socket.send(JSON.stringify(msg)); }

  /* Scans what has already arrived before waiting, so a fast server cannot race
     the test. Each message is handed out once. */
  /* Generous by design: a real 5-second countdown plus an interstitial is slow
     to begin with, and a loaded machine can stretch it further. A tight deadline
     here only produces flakes, never a useful failure. */
  async next(type, predicate = () => true, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = 0; i < this.messages.length; i++) {
        if (this.consumed.has(i)) continue;
        const msg = this.messages[i];
        if (msg.type === type && predicate(msg)) { this.consumed.add(i); return msg; }
      }
      if (Date.now() > deadline) throw new Error(`${this.name}: timed out waiting for ${type}`);
      await wait(15);
    }
  }

  /* Marks everything received so far as seen, so a later wait cannot match a
     message from an earlier round. */
  drain() { this.messages.forEach((_, i) => this.consumed.add(i)); return this; }

  all(type) { return this.messages.filter(m => m.type === type); }
  last(type) { return this.all(type).slice(-1)[0]; }
  close() { this.socket.close(); }
}

async function createRoom(name = 'Host') {
  const client = new Client(name);
  await client.open;
  client.send({ type: 'create', name });
  const joined = await client.next('joined');
  client.playerId = joined.playerId;
  client.token = joined.token;
  client.code = joined.code;
  return client;
}

async function joinRoom(code, name) {
  const client = new Client(name);
  await client.open;
  client.send({ type: 'join', code, name });
  const joined = await client.next('joined');
  client.playerId = joined.playerId;
  client.token = joined.token;
  client.code = code;
  client.spectator = joined.spectator;
  return client;
}

/* Ready everyone, start, and wait for the first game to arrive. */
async function startMatch(host, others, games) {
  /* Every wait below has to match this round's message, not one left over from
     an earlier match in the same session. */
  [host, ...others].forEach(c => c.drain());

  if (games) {
    host.send({ type: 'settings', games });
    await host.next('room', m => m.settings.games.join() === games.join());
  }
  [host, ...others].forEach(c => c.send({ type: 'ready', ready: true }));
  await host.next('room', m => m.phase === 'lobby' && m.members.filter(x => !x.spectator).every(x => x.ready));

  host.send({ type: 'start' });
  await host.next('countdown');
  return host.next('gameStart', () => true, COUNTDOWN_MS + 15000);
}

/* Solve whatever the current game is, from the server's point of view, by
   reaching into the room the same way a perfect player would through the wire. */
function currentSecret(code) {
  const room = rooms.get(code);
  const slot = room.match.games[room.match.index];
  return { room, slot, secret: slot.secret, gameId: slot.gameId };
}

/* ---------------- the tests ---------------- */

async function run() {
  // ---------- pools and partitioning ----------
  const pools = puzzles.pools;
  check('room pools are loaded', pools.shabda.five.length > 60 && pools.snowman.medium.length > 60,
        `${pools.shabda.five.length} shabda, ${pools.snowman.medium.length} snowman`);

  // ---------- lobby basics ----------
  const host = await createRoom('Ana');
  const guest = await joinRoom(host.code, 'Ben');
  let room = await guest.next('room', m => m.members.length === 2);

  check('a room has a host and both members', room.members.length === 2 &&
        room.members.filter(m => m.host).length === 1);
  check('the creator is the host', room.members.find(m => m.host).name === 'Ana');
  check('nobody starts ready', room.members.every(m => !m.ready));

  guest.send({ type: 'ready', ready: true });
  room = await host.next('room', m => m.members.some(x => x.name === 'Ben' && x.ready));
  check('ready toggles on', room.members.find(m => m.name === 'Ben').ready === true);

  guest.send({ type: 'ready', ready: false });
  room = await host.next('room', m => m.members.every(x => !x.ready));
  check('ready toggles off again', true);

  // ---------- acceptance 6: settings clear ready ----------
  host.send({ type: 'ready', ready: true });
  guest.send({ type: 'ready', ready: true });
  await host.next('room', m => m.members.every(x => x.ready));

  host.send({ type: 'settings', games: ['snowman'] });
  room = await host.next('room', m => m.settings.games.join() === 'snowman');
  check('changing match settings clears every ready flag', room.members.every(m => !m.ready));

  guest.send({ type: 'settings', games: ['shabda'] });
  const denied = await guest.next('error');
  check('only the host can change settings', denied.code === 'not-host', denied.code);

  // ---------- acceptance 1 and 13: no word set before the countdown completes ----------
  host.send({ type: 'ready', ready: true });
  guest.send({ type: 'ready', ready: true });
  await host.next('room', m => m.members.every(x => x.ready));

  host.send({ type: 'start' });
  const countdownA = await host.next('countdown');
  const serverRoom = rooms.get(host.code);

  check('no match, and so no words, exist during the countdown', serverRoom.match === null);
  const wordsInFlight = [...host.messages, ...guest.messages].some(m =>
    JSON.stringify(m).match(/"answers?"|"scrambles"|"mask"/));
  check('nothing transmitted during the countdown carries a word set', !wordsInFlight);

  host.drain();
  guest.drain();
  host.send({ type: 'abort' });
  await host.next('countdownAborted');
  check('the host can abort the countdown', rooms.get(host.code).phase === 'lobby');
  check('an aborted countdown leaves no word set behind', serverRoom.match === null);
  const roomAfterAbort = await host.next('room', m => m.phase === 'lobby');
  check('ready states survive an abort', roomAfterAbort.members.every(m => m.ready), 'CD-1.6');

  // abort and restart repeatedly, then let two run to completion
  const wordSets = [];
  for (let i = 0; i < 2; i++) {
    host.send({ type: 'start' });
    await host.next('countdown');
    host.send({ type: 'abort' });
    await host.next('countdownAborted');
    check(`abort ${i + 1} produced no word set`, rooms.get(host.code).match === null);
  }

  // ---------- acceptance 11 and 3: countdown agreement across clients ----------
  host.drain();
  guest.drain();
  host.send({ type: 'start' });
  const cdHost = await host.next('countdown');
  const cdGuest = await guest.next('countdown');
  check('every client is given the same countdown end, to the millisecond',
        cdHost.endsAt === cdGuest.endsAt, `${cdHost.endsAt} vs ${cdGuest.endsAt}`);
  check('the countdown is 5 seconds', cdHost.durationMs === 5000, String(cdHost.durationMs));

  /* Each client corrects for its own clock offset the way the browser does, then
     we compare the instant each one thinks the countdown ends. */
  const endAsSeenBy = cd => cd.endsAt - (cd.serverNow - Date.now());
  check('countdown end agrees across clients within 250ms',
        Math.abs(endAsSeenBy(cdHost) - endAsSeenBy(cdGuest)) < 250,
        Math.abs(endAsSeenBy(cdHost) - endAsSeenBy(cdGuest)) + 'ms apart');

  // ---------- acceptance 12 and 14: resync and mid-countdown reconnect ----------
  const resync = await host.next('countdown', m => m.serverNow > cdHost.serverNow + 1000);
  check('the server resyncs the countdown mid-flight', resync.endsAt === cdHost.endsAt, 'CD-1.3');

  const remainingAtResync = resync.endsAt - resync.serverNow;
  check('a client that ignored the first message still converges from the resync',
        remainingAtResync > 0 && remainingAtResync < COUNTDOWN_MS,
        remainingAtResync + 'ms left');

  const late = new Client('Late');
  await late.open;
  late.send({ type: 'join', code: host.code, name: 'Late' });
  const blocked = await late.next('error');
  check('joining during the countdown is blocked', blocked.code === 'countdown-locked', blocked.code);

  /* A refresh mid-countdown: the new socket takes the seat over, and the old
     one closing afterwards must not tear the countdown down (CD-1.4). */
  const guest2 = new Client('Ben2');
  await guest2.open;
  guest2.send({ type: 'rejoin', code: host.code, token: guest.token });
  await guest2.next('joined', m => m.resumed);

  const cdRejoin = await guest2.next('countdown');
  const leftForRejoiner = cdRejoin.endsAt - cdRejoin.serverNow;
  check('a client reconnecting mid-countdown gets the real remaining time, not a fresh 5',
        leftForRejoiner > 0 && leftForRejoiner < COUNTDOWN_MS - 200, leftForRejoiner + 'ms left');
  check('the rejoined client is given the same end instant as everyone else',
        cdRejoin.endsAt === cdHost.endsAt);

  guest.close();                                   // the stale socket closes late
  await wait(120);
  check('a stale socket closing does not abort the countdown its owner rejoined',
        rooms.get(host.code).phase === 'countdown', rooms.get(host.code).phase);

  // ---------- the match begins ----------
  const startHost = await host.next('gameStart', () => true, COUNTDOWN_MS + 15000);
  const startGuest = await guest2.next('gameStart', () => true, COUNTDOWN_MS + 15000);

  check('the match starts only once the countdown completes',
        rooms.get(host.code).match !== null && rooms.get(host.code).phase === 'playing');
  check('all players receive the same game, in the same slot',
        startHost.gameId === startGuest.gameId && startHost.index === startGuest.index,
        startHost.gameId);
  check('the word set is identical for both players',
        JSON.stringify(startHost.view.scrambles || startHost.view.mask || startHost.view.length) ===
        JSON.stringify(startGuest.view.scrambles || startGuest.view.mask || startGuest.view.length));

  const live = currentSecret(host.code);
  wordSets.push(live.secret.words.join(','));

  // ---------- acceptance 7: no answer on the wire while the game is live ----------
  const answer = live.secret.words[0];
  const everythingSoFar = JSON.stringify([...host.messages, ...guest2.messages]);
  check('no message sent so far contains the unsolved answer',
        !everythingSoFar.includes(answer), answer);

  // ---------- playing, and progress-only visibility ----------
  const game = puzzles.gameById(live.gameId);
  const solve = (client, secret, gameId) => {
    if (gameId === 'shabda') client.send({ type: 'submit', payload: { guess: secret.answer } });
    else if (gameId === 'anagram') client.send({ type: 'submit', payload: { guess: secret.answers[0] } });
    else [...new Set(secret.answer.replace(/[^a-z]/g, ''))].forEach(ch =>
      client.send({ type: 'submit', payload: { letter: ch } }));
  };

  host.send({ type: 'submit', payload: live.gameId === 'snowman' ? { letter: 'e' } : { guess: 'zzzzz' } });
  const firstResult = await host.next('submitResult').catch(() => null) ||
                      await host.next('error');
  check('the server answers a submission', !!firstResult);

  const progress = await guest2.next('progress');
  const progressText = JSON.stringify(progress);
  check('progress carries no guess and no revealed letter',
        !progressText.includes('guesses') && !progressText.includes('"mask"'), progressText.slice(0, 90));
  check('progress does name who is still working',
        progress.players.length === 2 && progress.players.every(p => 'resolved' in p));

  // finish the match: both players solve everything as fast as they can
  async function playOutMatch(clients) {
    clients.forEach(c => c.drain());
    for (;;) {
      const state = rooms.get(host.code);
      if (!state.match) break;

      const slot = state.match.games[state.match.index];
      if (!slot || !slot.states) { await wait(30); continue; }

      clients.forEach(c => solve(c, slot.secret, slot.gameId));
      if (slot.gameId === 'anagram') {
        await wait(60);
        clients.forEach(c => c.send({ type: 'submit', payload: { guess: slot.secret.answers[1] } }));
      }

      const ended = await clients[0].next('gameEnd', m => m.gameId === slot.gameId, 15000);
      if (ended.isLast) break;
      await wait(300);
    }
    return clients[0].next('matchEnd', () => true, 15000);
  }

  const matchEnd = await playOutMatch([host, guest2]);
  check('a match ends with a scoreboard', matchEnd.scoreboard.length === 2);
  check('the scoreboard is ordered by points',
        matchEnd.scoreboard[0].points >= matchEnd.scoreboard[1].points);
  check('a two-player match posts to room standings', matchEnd.posted === true);
  check('room standings accumulate', matchEnd.standings.length === 2 &&
        matchEnd.standings.every(s => s.matches === 1));

  const keptLog = rooms.get(host.code).lastLog;
  check('the finished match leaves a log behind',
        Array.isArray(keptLog) && keptLog.some(e => e.type === 'gameEnd'),
        keptLog ? keptLog.length + ' entries' : 'none');

  // ---------- acceptance 2 and 13: a fresh word set every completed match ----------
  host.send({ type: 'rematch' });
  await host.next('room', m => m.phase === 'lobby');
  await startMatch(host, [guest2]);
  const second = currentSecret(host.code);
  wordSets.push(second.secret.words.join(','));
  check('a rematch generates a different word set', wordSets[0] !== wordSets[1],
        wordSets.join(' | '));

  const roomNow = rooms.get(host.code);
  const recent = roomNow.recentWords;
  check('the room remembers recent words so they do not come round again',
        recent.length >= 2 && new Set(recent).size === recent.length);

  await playOutMatch([host, guest2]).catch(() => null);
  host.close();
  guest2.close();
  late.close();
  await wait(200);

  await scoringTests();
  await disconnectTests();
  await hostAndForceStartTests();
  await lateJoinerTests();
  await logReplayTest();
  await soloTest();
  await hardeningTests();
}

/* ---------------- scoring ---------------- */

async function scoringTests() {
  const clean = scoring.scoreSlot({ solved: true, attemptsUsed: 1, maxAttempts: 6, elapsedMs: 85000, timeLimitMs: 90000, partial: 1 });
  const sloppyFast = scoring.scoreSlot({ solved: true, attemptsUsed: 6, maxAttempts: 6, elapsedMs: 1000, timeLimitMs: 90000, partial: 1 });
  check('a clean slow solve beats a sloppy fast one', clean.points > sloppyFast.points,
        `${clean.points} vs ${sloppyFast.points}`);
  check('speed still counts for something', sloppyFast.points > 0 && sloppyFast.speed > 20);

  const perfect = scoring.scoreSlot({ solved: true, attemptsUsed: 1, maxAttempts: 6, elapsedMs: 0, timeLimitMs: 90000, partial: 1 });
  check('a perfect slot tops out at the shared 100-point band', perfect.points === 100, String(perfect.points));

  const missed = scoring.scoreSlot({ solved: false, attemptsUsed: 6, maxAttempts: 6, elapsedMs: 90000, timeLimitMs: 90000, partial: 0.8 });
  check('an unsolved puzzle still earns partial credit', missed.points > 0, String(missed.points));
  check('partial credit never beats a solve', missed.points < sloppyFast.points,
        `${missed.points} vs ${sloppyFast.points}`);

  const nothing = scoring.scoreSlot({ solved: false, attemptsUsed: 0, maxAttempts: 6, elapsedMs: 90000, timeLimitMs: 90000, partial: 0 });
  check('getting nowhere scores nothing', nothing.points === 0);

  /* Every game has to reach the same ceiling, or a match is decided by which
     games the host picked (SC-1.4). */
  const ceilings = ['shabda', 'snowman', 'anagram'].map(id => {
    const game = puzzles.gameById(id);
    return scoring.scoreSlot({
      solved: true, attemptsUsed: 1, maxAttempts: game.maxAttempts,
      elapsedMs: 0, timeLimitMs: game.timeLimitMs, partial: 1
    }).points;
  });
  check('all three games normalise to the same points band',
        new Set(ceilings).size === 1 && ceilings[0] === 100, ceilings.join(', '));

  const ranked = scoring.rankStandings([
    { id: 'a', name: 'Ana', points: 300, matches: 6, wins: 1, best: 60 },
    { id: 'b', name: 'Ben', points: 180, matches: 2, wins: 2, best: 95 }
  ]);
  check('standings rank on average, not raw total, so latecomers are not buried',
        ranked[0].name === 'Ben', ranked.map(r => `${r.name} ${r.average}`).join(', '));
}

/* ---------------- disconnection ---------------- */

async function disconnectTests() {
  const host = await createRoom('Cara');
  const guest = await joinRoom(host.code, 'Dan');
  await startMatch(host, [guest], ['shabda']);

  const { slot } = currentSecret(host.code);
  host.send({ type: 'submit', payload: { guess: 'crane' } });
  await host.next('submitResult').catch(() => host.next('error'));

  const before = rooms.get(host.code).match.games[0].states.get(host.playerId);
  const attemptsBefore = before.attemptsUsed;

  host.close();                                  // drop mid-game
  await wait(150);
  check('a disconnected player is marked, not deleted', rooms.get(host.code).members.size === 2);

  const back = new Client('Cara');
  await back.open;
  back.send({ type: 'rejoin', code: host.code, token: host.token });
  await back.next('joined', m => m.resumed);
  const resumed = await back.next('gameStart');

  check('reconnecting mid-game resumes the same game', resumed.gameId === 'shabda');
  check('reconnecting restores exact prior state',
        resumed.view.attemptsUsed === attemptsBefore && resumed.view.guesses.length === attemptsBefore,
        `${resumed.view.attemptsUsed} attempts, guesses ${JSON.stringify(resumed.view.guesses)}`);
  check('progress was never lost on the server',
        rooms.get(host.code).match.games[0].states.get(host.playerId).attemptsUsed === attemptsBefore);

  /* CN-1.4: a player who never comes back still scores what they achieved. */
  guest.close();
  back.send({ type: 'submit', payload: { guess: currentSecret(host.code).secret.answer } });
  const ended = await back.next('gameEnd', () => true, 15000);
  const droppedScore = ended.scores.find(s => s.name === 'Dan');
  check('a player who dropped is still scored on what they achieved',
        droppedScore && droppedScore.points >= 0, droppedScore ? String(droppedScore.points) : 'missing');

  back.close();
  await wait(200);
}

/* ---------------- host transfer and force-start ---------------- */

async function hostAndForceStartTests() {
  const host = await createRoom('Eve');
  const guest = await joinRoom(host.code, 'Finn');
  await guest.next('room', m => m.members.length === 2);

  host.close();
  await wait(150);
  const afterHostLeft = await guest.next('room', m => m.members.some(x => x.host && x.name === 'Finn'));
  check('the host role transfers when the host disconnects',
        afterHostLeft.members.find(m => m.host).name === 'Finn');

  /* Force-start: one player readies, the other never does. */
  /* Eve's seat is freed once the grace window passes, so the room is Finn plus
     whoever arrives next. */
  const other = await joinRoom(guest.code, 'Gus');
  await guest.next('room', m => m.members.length === 2 && m.members.some(x => x.name === 'Gus'));
  guest.send({ type: 'ready', ready: true });

  const tooSoon = (async () => {
    guest.send({ type: 'start', force: true });
    return guest.next('error');
  })();
  const tooSoonErr = await tooSoon;
  check('force-start is refused before the wait has elapsed',
        ['too-soon', 'not-ready'].includes(tooSoonErr.code), tooSoonErr.code);

  await wait(1200);                                // ROOM_READY_TIMEOUT_MS is 900 here
  guest.send({ type: 'start', force: true });
  const forced = await guest.next('countdown', () => true, 4000);
  check('the host can force-start once the wait has elapsed', !!forced);

  const started = await guest.next('gameStart', () => true, COUNTDOWN_MS + 15000);
  check('a forced start produces a valid match', !!started.gameId, started.gameId);

  const roomState = await guest.next('room', m => m.phase === 'playing');
  const dropped = roomState.members.find(m => m.name === 'Gus');
  check('players who never readied are moved to spectator, not into the match',
        dropped.spectator === true);
  check('the forced match has only the ready players',
        rooms.get(guest.code).match.roster.length === 1);

  guest.close();
  other.close();
  await wait(200);
}

/* ---------------- late joiners ---------------- */

async function lateJoinerTests() {
  const host = await createRoom('Hana');
  const guest = await joinRoom(host.code, 'Ivan');
  await startMatch(host, [guest], ['shabda']);

  const latecomer = await joinRoom(host.code, 'Jo');
  check('someone joining mid-match arrives as a spectator', latecomer.spectator === true);

  const room = rooms.get(host.code);
  check('a late joiner is not in the match roster', !room.match.roster.includes(latecomer.playerId));

  let gotGame = false;
  try { await latecomer.next('gameStart', () => true, 800); gotGame = true; } catch { /* expected */ }
  check('a late joiner is never dealt the live puzzle', !gotGame);

  host.close(); guest.close(); latecomer.close();
  await wait(200);
}

/* ---------------- acceptance 8: replay ---------------- */

async function logReplayTest() {
  const host = await createRoom('Kit');
  const guest = await joinRoom(host.code, 'Lena');
  await startMatch(host, [guest], ['shabda']);

  const { slot } = currentSecret(host.code);
  host.send({ type: 'submit', payload: { guess: 'crane' } });
  await wait(80);
  host.send({ type: 'submit', payload: { guess: slot.secret.answer } });
  guest.send({ type: 'submit', payload: { guess: slot.secret.answer } });

  const ended = await host.next('gameEnd', () => true, 15000);
  const matchEnd = await host.next('matchEnd', () => true, 15000);

  /* The log is the only input: no live objects, no in-memory state. */
  const log = rooms.get(host.code).lastLog;
  const replayed = replayScores(log);

  const live = new Map(matchEnd.scoreboard.map(s => [s.id, s.points]));
  const same = [...live.entries()].every(([id, points]) => {
    const r = replayed.get(id);
    return r && Math.abs(r.points - points) < 0.05;
  });

  check('match scores are reproducible from the server event log alone', same,
        [...live.entries()].map(([id, p]) => `${p} vs ${replayed.get(id) ? replayed.get(id).points : 'none'}`).join(', '));
  check('the replay saw both players', replayed.size === 2);

  host.close(); guest.close();
  await wait(200);
}

/* ---------------- solo practice ---------------- */

async function soloTest() {
  const host = await createRoom('Mo');
  await startMatch(host, [], ['shabda']);

  const { slot } = currentSecret(host.code);
  host.send({ type: 'submit', payload: { guess: slot.secret.answer } });
  const ended = await host.next('gameEnd', () => true, 15000);
  const matchEnd = await host.next('matchEnd', () => true, 15000);

  check('a solo match is playable as practice', ended.scores.length === 1);
  check('a solo match does not post to room standings', matchEnd.posted === false);
  check('room standings stay empty after solo practice', matchEnd.standings.length === 0);

  host.close();
  await wait(200);
}


/* ---------------- limits, caching and crash safety ---------------- */

/* A plain HTTP GET, with the pieces the caching tests need. */
function httpGet(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: PORT, path: pathname, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    }).on('error', reject);
  });
}

/* A socket without the room-joining conveniences: these tests care about how
   connections end, not about play. */
function rawSocket(options = {}) {
  const socket = new WebSocket(`ws://localhost:${PORT}/rooms`, options);
  const messages = [];
  socket.on('error', () => {});
  socket.on('message', raw => messages.push(JSON.parse(raw)));
  return {
    socket,
    messages,
    open: new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    closed: new Promise(resolve => socket.once('close', code => resolve(code)))
  };
}

async function hardeningTests() {
  /* --- what a browser is allowed to keep --- */

  const css = await httpGet('/styles.css');
  check('static files carry an ETag and a cache lifetime',
    !!css.headers.etag && String(css.headers['cache-control']).includes('max-age'),
    `${css.headers.etag} / ${css.headers['cache-control']}`);

  const revalidated = await httpGet('/styles.css', { 'if-none-match': css.headers.etag });
  check('an unchanged file comes back as 304 with no body at all',
    revalidated.status === 304 && revalidated.body.length === 0,
    `${revalidated.status}, ${revalidated.body.length} bytes`);

  const hashed = await httpGet('/styles.css?v=abc12345');
  check('a hash-stamped reference is cached forever, not just an hour',
    hashed.headers['cache-control'] === 'public, max-age=31536000, immutable',
    hashed.headers['cache-control']);

  const page = await httpGet('/index.html');
  check('pages revalidate every time, so a deploy is never invisible',
    page.headers['cache-control'] === 'no-cache', page.headers['cache-control']);

  const plain = await httpGet('/games/shabda/words-6.js');
  const packed = await httpGet('/games/shabda/words-6.js', { 'accept-encoding': 'gzip' });
  check('the heavy word lists are gzipped on the way out',
    packed.headers['content-encoding'] === 'gzip' && packed.body.length < plain.body.length / 1.5,
    `${plain.body.length} raw vs ${packed.body.length} packed`);
  check('a compressed response says what it varies on',
    String(packed.headers.vary).toLowerCase() === 'accept-encoding', packed.headers.vary);

  /* --- what is never served --- */

  check('room answers stay unreachable', (await httpGet('/server/pools.json')).status === 403);
  check('test harnesses are not served', (await httpGet('/room/_test.html')).status === 403);
  check('word generators are not served', (await httpGet('/games/shabda/_gen-words.js')).status === 403);
  check('a directory with no page of its own is a 404, not a listing',
    (await httpGet('/assets/')).status === 404);

  /* --- who may open a socket --- */

  let rejected = false;
  try {
    await rawSocket({ origin: 'http://not-our-site.example' }).open;
  } catch {
    rejected = true;
  }
  check('a socket from another site is turned away at the handshake', rejected);

  const sameSite = rawSocket({ origin: `http://localhost:${PORT}` });
  await sameSite.open;
  check('a socket from our own pages is let through', sameSite.socket.readyState === WebSocket.OPEN);
  sameSite.socket.close();

  /* --- how much one connection may send --- */

  const big = rawSocket();
  await big.open;
  big.socket.send(JSON.stringify({ type: 'create', name: 'x'.repeat(LIMITS.maxPayloadBytes * 2) }));
  const bigClose = await big.closed;
  check('a message over the size cap ends that connection', bigClose === 1009, String(bigClose));

  const burst = LIMITS.rateBurst;
  const perSecond = LIMITS.ratePerSecond;
  const strikes = LIMITS.rateStrikes;
  LIMITS.rateBurst = 3;
  LIMITS.ratePerSecond = 0.01;
  LIMITS.rateStrikes = 2;

  const flooder = rawSocket();
  await flooder.open;
  for (let i = 0; i < 12; i++) flooder.socket.send(JSON.stringify({ type: 'sync' }));
  const floodClose = await flooder.closed;
  check('a flood is answered with rate-limited, then hung up on',
    flooder.messages.some(m => m.type === 'error' && m.code === 'rate-limited') && floodClose === 1008,
    String(floodClose));

  LIMITS.rateBurst = burst;
  LIMITS.ratePerSecond = perSecond;
  LIMITS.rateStrikes = strikes;

  /* --- how many rooms one connection may open --- */

  const perSocket = LIMITS.maxRoomsPerSocket;
  LIMITS.maxRoomsPerSocket = 1;
  const opener = await createRoom('Opener');
  opener.send({ type: 'create', name: 'Opener' });
  const tooMany = await opener.next('error');
  check('one connection cannot open rooms without end', tooMany.code === 'too-many-rooms', tooMany.code);
  LIMITS.maxRoomsPerSocket = perSocket;
  opener.close();

  const maxRooms = LIMITS.maxRooms;
  LIMITS.maxRooms = rooms.size;
  const turnedAway = rawSocket();
  await turnedAway.open;
  turnedAway.socket.send(JSON.stringify({ type: 'create', name: 'Late' }));
  await wait(150);
  check('with every room in use, a new one is refused rather than made',
    turnedAway.messages.some(m => m.type === 'error' && m.code === 'server-busy'));
  LIMITS.maxRooms = maxRooms;
  turnedAway.socket.close();

  /* --- how many players one room may hold --- */

  const maxMembers = LIMITS.maxMembers;
  const host = await createRoom('Host');
  LIMITS.maxMembers = 1;
  const shutOut = rawSocket();
  await shutOut.open;
  shutOut.socket.send(JSON.stringify({ type: 'join', code: host.code, name: 'Extra' }));
  await wait(150);
  check('a full room turns the next player away',
    shutOut.messages.some(m => m.type === 'error' && m.code === 'room-full'));
  LIMITS.maxMembers = maxMembers;
  shutOut.socket.close();

  /* --- and when something throws anyway --- */

  const realSetReady = Room.prototype.setReady;
  Room.prototype.setReady = function () { throw new Error('deliberate test explosion'); };

  /* Listening before the message goes out: the server answers and hangs up in
     the same tick, so a listener attached afterwards would wait for an event
     that has already been and gone. */
  const hostClosed = new Promise(resolve => host.socket.once('close', resolve));

  host.drain();
  host.send({ type: 'ready', ready: true });
  const failure = await host.next('error');
  const hostClose = await hostClosed;
  Room.prototype.setReady = realSetReady;

  check('a throw inside room logic is answered, not swallowed',
    failure.code === 'server-error', failure.code);
  check('the connection that caused it is the only thing that ends',
    hostClose === 1011, String(hostClose));

  const survivor = await createRoom('Survivor');
  check('the server is still serving afterwards',
    typeof survivor.code === 'string' && survivor.code.length === 4);
  survivor.close();

  await wait(200);
}

/* ---------------- go ---------------- */

server.listen(0, async () => {
  PORT = server.address().port;
  console.log(`test server on ${PORT}\n`);

  try {
    await run();
  } catch (err) {
    check('the suite ran to the end', false, err.message);
    console.error(err);
  }

  console.log(`\n${results.filter(r => r.startsWith('PASS')).length} passed, ${failures} failed`);
  server.close();
  process.exit(failures ? 1 : 0);
});

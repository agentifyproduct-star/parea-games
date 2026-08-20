/* The room server: static files over HTTP, room play over a WebSocket.

   Everything decision-making lives in rooms.js; this file is the wire. It parses
   messages, checks that the sender is who they say they are, and hands off. No
   game state is ever taken from a client — the client sends intentions, the
   server decides what happened (Section 8: server-authoritative validation).

   It is also the only thing standing between the open internet and a process
   holding every live room in memory, so a good half of this file is about what a
   client is not allowed to do: how big a message may be, how fast they may
   arrive, how many rooms one connection may open, and what happens when
   something throws anyway.

   Run: node index.js       (PORT to change the port, default 8080) */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const { Room, rooms } = require('./rooms.js');
const puzzles = require('./puzzles.js');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, '..');

/* Test harnesses and word generators live beside the files they test. They are
   served only when this is switched on, so a deploy cannot hand out the very
   scripts that explain how the daily schedule is built. */
const DEV = process.env.PAREA_DEV === '1';

/* Ceilings, not tuning. Every one of these sits far above what real play needs
   and exists so that a script cannot turn one connection into all of the
   server's memory. Read at the point of use, so tests can bend them. */
const LIMITS = {
  maxPayloadBytes: Number(process.env.ROOM_MAX_PAYLOAD || 16 * 1024),
  maxSockets: Number(process.env.ROOM_MAX_SOCKETS || 400),
  maxRooms: Number(process.env.ROOM_MAX_ROOMS || 500),
  maxRoomsPerSocket: Number(process.env.ROOM_MAX_ROOMS_PER_SOCKET || 20),
  maxMembers: Number(process.env.ROOM_MAX_MEMBERS || 24),
  /* A token bucket: a burst of this many messages, refilled at this rate. A
     player guessing as fast as they can type uses a small fraction of it. */
  rateBurst: Number(process.env.ROOM_RATE_BURST || 40),
  ratePerSecond: Number(process.env.ROOM_RATE_PER_SECOND || 8),
  rateStrikes: Number(process.env.ROOM_RATE_STRIKES || 5)
};

/* Empty means "the same origin that served the page", which is right while one
   host serves everything. Set it when the games and the room server end up on
   different domains:
     ROOM_ALLOWED_ORIGINS=https://pareagames.com,https://www.pareagames.com */
const ALLOWED_ORIGINS = String(process.env.ROOM_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/* ---------------- static files ---------------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/* Worth compressing: the word lists and the puzzle manifest are the heaviest
   things we ship and all of them are text, which gzip roughly halves. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml']);
const COMPRESS_FLOOR = 1024;          // below this the header costs more than it saves

/* How long a browser may keep a file before asking again. Everything carries an
   ETag as well, so "asking again" is usually a 304 with no body — which is what
   actually saves the bandwidth on a 103 KB word list. HTML revalidates every
   time, so a deploy is never invisible. */
function cacheFor(ext) {
  if (ext === '.html') return 'no-cache';
  if (ext === '.png' || ext === '.svg' || ext === '.ico') return 'public, max-age=604800';
  return 'public, max-age=3600';
}

/* Gzipped bodies are kept until the file changes, so a busy path is compressed
   once rather than on every request. */
const gzipCache = new Map();
const GZIP_CACHE_MAX = 200;

function gzipped(file, stamp, body) {
  const hit = gzipCache.get(file);
  if (hit && hit.stamp === stamp) return hit.body;
  const packed = zlib.gzipSync(body, { level: 6 });
  if (gzipCache.size >= GZIP_CACHE_MAX) gzipCache.clear();
  gzipCache.set(file, { stamp, body: packed });
  return packed;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, rel);

  /* Never serve outside the site, never serve the server's own directory —
     pools.json holds every room answer — and never serve the workings. */
  const inside = file.startsWith(ROOT + path.sep) || file === ROOT;
  const isServerDir = file.startsWith(path.join(ROOT, 'server'));
  const isDevFile = path.basename(file).startsWith('_');

  if (!inside || isServerDir || (isDevFile && !DEV)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
    return;
  }

  fs.stat(file, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const ext = path.extname(file);
    const stamp = `${stat.size}-${Math.round(stat.mtimeMs)}`;
    const etag = `W/"${stamp}"`;
    const cacheControl = cacheFor(ext);

    /* Unchanged since last time: no body at all. */
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': cacheControl }).end();
      return;
    }

    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }

      const headers = {
        'content-type': TYPES[ext] || 'application/octet-stream',
        'cache-control': cacheControl,
        etag
      };

      const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      let payload = body;

      if (COMPRESSIBLE.has(ext)) {
        headers.vary = 'Accept-Encoding';
        if (wantsGzip && body.length >= COMPRESS_FLOOR) {
          payload = gzipped(file, stamp, body);
          headers['content-encoding'] = 'gzip';
        }
      }

      headers['content-length'] = payload.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : payload);
    });
  });
});

/* A malformed request line is the client's problem, not ours. */
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});

/* ---------------- websocket ---------------- */

/* The same site that served the page, unless an allowlist says otherwise. A
   request with no Origin at all is a native client or a test harness, never a
   browser, so there is nothing there to protect. */
function originAllowed(origin, req) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({
  server,
  path: '/rooms',
  maxPayload: LIMITS.maxPayloadBytes,
  verifyClient: ({ origin, req }) => originAllowed(origin, req)
});

wss.on('error', err => console.error('[rooms] socket server error:', err && err.message));

let socketCounter = 0;

wss.on('connection', socket => {
  if (wss.clients.size > LIMITS.maxSockets) {
    socket.close(1013, 'too many connections');
    return;
  }

  const socketId = ++socketCounter;
  const session = { room: null, member: null, roomsCreated: 0 };

  const send = message => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const fail = (code, detail) => send({ type: 'error', code, detail: detail || null });

  /* ws emits 'error' on an abrupt disconnect; with no listener for it that
     throws, which would take the process — and every other live room — down. */
  socket.on('error', err => console.warn('[rooms] connection error:', err && err.message));

  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  const bucket = { tokens: LIMITS.rateBurst, at: Date.now(), strikes: 0 };

  function withinRate() {
    const at = Date.now();
    bucket.tokens = Math.min(
      LIMITS.rateBurst,
      bucket.tokens + ((at - bucket.at) / 1000) * LIMITS.ratePerSecond
    );
    bucket.at = at;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  send({ type: 'hello', games: puzzles.gameIds().map(id => {
    const game = puzzles.gameById(id);
    return { id, label: game.label, timeLimitMs: game.timeLimitMs, maxAttempts: game.maxAttempts };
  }) });

  function handle(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return fail('bad-json');
    }
    if (!msg || typeof msg.type !== 'string') return fail('bad-message');

    /* --- joining --- */

    if (msg.type === 'create') {
      if (rooms.size >= LIMITS.maxRooms) return fail('server-busy');
      if (session.roomsCreated >= LIMITS.maxRoomsPerSocket) return fail('too-many-rooms');

      const room = new Room();
      session.roomsCreated++;
      const member = room.join(msg.name);
      session.room = room;
      session.member = member;
      room.attach(member, send, socketId);
      send({ type: 'joined', code: room.code, playerId: member.id, token: member.token });
      room.broadcastRoom();
      return;
    }

    if (msg.type === 'join') {
      const room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) return fail('no-room');

      /* 4.2: joining during a countdown is blocked outright rather than
         producing a player who missed the start. */
      if (room.phase === 'countdown') return fail('countdown-locked');
      if (room.members.size >= LIMITS.maxMembers) return fail('room-full');

      const member = room.join(msg.name);
      session.room = room;
      session.member = member;
      room.attach(member, send, socketId);
      send({
        type: 'joined',
        code: room.code,
        playerId: member.id,
        token: member.token,
        spectator: member.spectator          // arrived mid-match: watch, play the next one
      });
      room.broadcastRoom();
      return;
    }

    if (msg.type === 'rejoin') {
      /* No room-full check here on purpose: the seat is already this player's,
         and a reconnect must never be turned away for being one too many. */
      const room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) return fail('no-room');

      const member = room.memberByToken(String(msg.token || ''));
      if (!member) return fail('no-seat');

      session.room = room;
      session.member = member;
      room.attach(member, send, socketId);
      send({ type: 'joined', code: room.code, playerId: member.id, token: member.token, resumed: true });
      room.broadcastRoom();

      /* CD-1.4 and CN-1.2: come back to exactly what is happening now. */
      if (room.phase === 'countdown') room.broadcastCountdown();
      if (room.phase === 'playing' && room.match) {
        const slot = room.match.games[room.match.index];
        const state = slot.states.get(member.id);
        const game = puzzles.gameById(slot.gameId);
        if (state) send(room.gameStartMessage(slot, game, state));
        room.broadcastProgress();
      }
      return;
    }

    /* --- everything past here needs a seat --- */

    const { room, member } = session;
    if (!room || !member) return fail('not-in-a-room');

    const reply = result => {
      if (result && result.error) fail(result.error);
      return result;
    };

    switch (msg.type) {
      case 'ready':
        return void reply(room.setReady(member, msg.ready));

      case 'settings':
        return void reply(room.setSettings(member, msg.games));

      case 'start':
        return void reply(room.startCountdown(member, { force: !!msg.force }));

      case 'abort':
        return void reply(room.hostAbort(member));

      case 'submit': {
        const result = reply(room.submit(member, msg.payload));
        if (result && result.ok) send({ type: 'submitResult', result: result.result, view: result.view });
        return;
      }

      case 'rematch':
        return void reply(room.rematch(member));

      case 'leave':
        room.remove(member.id);
        session.room = null;
        session.member = null;
        return;

      case 'sync':
        /* Used by a client returning from the background: tell me where we are. */
        send(room.roomState());
        if (room.phase === 'countdown') room.broadcastCountdown();
        return;

      default:
        return fail('unknown-type', msg.type);
    }
  }

  socket.on('message', raw => {
    if (!withinRate()) {
      fail('rate-limited');
      if (++bucket.strikes >= LIMITS.rateStrikes) socket.close(1008, 'too many messages');
      return;
    }

    /* The whole point of this catch: one bad message ends one connection, not
       the process that is holding every other live room in memory. */
    try {
      handle(raw);
    } catch (err) {
      console.error('[rooms] message failed:', (err && err.stack) || err);
      fail('server-error');
      socket.close(1011, 'server error');
    }
  });

  socket.on('close', () => {
    /* Only if this socket is still the one holding the seat: a client that has
       already reconnected on a new socket must not be knocked out by the old
       one closing late. */
    if (session.room && session.member) session.room.detach(session.member, socketId);
  });
});

/* A dead connection that never closed cleanly is found by the heartbeat rather
   than left holding a seat forever. */
const heartbeat = setInterval(() => {
  try {
    wss.clients.forEach(socket => {
      if (!socket.isAlive) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  } catch (err) {
    console.error('[rooms] heartbeat failed:', (err && err.stack) || err);
  }
}, 15000);

wss.on('close', () => clearInterval(heartbeat));

/* ---------------- staying up ---------------- */

/* Rooms live in memory, so exiting on a stray exception would end every match in
   progress — a worse outcome than carrying on with one broken request. The usual
   argument for exiting is that process state may be corrupt, so the compromise
   is a fuse: log and continue, but if one minute produces a pile of them, then
   something really is wrong and a supervisor should get its chance to restart
   us. */
const FUSE_WINDOW_MS = 60000;
const FUSE_LIMIT = 10;
let recentFailures = [];

function survive(label, err) {
  console.error(`[rooms] ${label}:`, (err && err.stack) || err);
  const at = Date.now();
  recentFailures = recentFailures.filter(t => at - t < FUSE_WINDOW_MS);
  recentFailures.push(at);
  if (recentFailures.length >= FUSE_LIMIT) {
    console.error(`[rooms] ${FUSE_LIMIT} failures inside a minute — exiting for a clean restart`);
    process.exit(1);
  }
}

process.on('uncaughtException', err => survive('uncaught exception', err));
process.on('unhandledRejection', reason => survive('unhandled rejection', reason));

/* CN-1.6: on the way down, end matches gracefully rather than leaving half a
   result posted. */
function shutdown() {
  rooms.forEach(room => {
    if (room.match) room.abandonMatch('the server is restarting');
  });
  clearInterval(heartbeat);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Parea rooms listening on http://localhost:${PORT}`);
    console.log(`  play:  http://localhost:${PORT}/room/`);
  });
}

module.exports = { server, wss, PORT, LIMITS };

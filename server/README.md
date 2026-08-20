# Room server

Session-based room play for Parea Games: everyone in a room gets the same puzzles
at the same moment, and the server decides everything that matters.

The three solo games still run as plain static files with no server at all. This
is a second, separate mode — separate word pools, separate scoring, separate
stats — and it is the only part of Parea that needs a process running.

## Running it

```
cd server
npm install
npm start                 # http://localhost:8080
```

Then open `http://localhost:8080/room/`. The server also serves the rest of the
site, so the solo games work on the same port.

| Command | What it does |
|---|---|
| `npm start` | Runs the server (`PORT` to change the port) |
| `npm test` | Integration tests: 84 checks over real sockets |
| `node _test-browser.js` | Drives the real client in headless Chrome against a Node opponent |
| `npm run pools` | Rebuilds `pools.json`, the room word pools |

## Why the words appear when they do

The whole integrity position rests on one rule: **puzzles are generated at the
instant the start countdown completes**, and never before.

Generate them at room creation and a host can make a room, look at the words,
leave, and make another. Generate them on join and the last arrival decides the
puzzle. Generate them when the countdown *starts* and the host can abort and
restart until the words look easy. Generating at completion means the word set
first exists at the moment nobody can act on it — and because the countdown can
be aborted (CD-1.6, CD-1.7), that moment is the only safe one.

`rooms.js` does this in `beginMatch()`, which is the only caller of
`puzzles.generateMatch()`.

## What the client is told

Never an answer, never anyone else's guesses.

| Game | What the client receives while the game is live |
|---|---|
| Shabda | Word length, attempts used, its own guesses and their per-tile verdicts |
| Snowman | The category, the mask (`_ _ a _ _`), which letters it has tried, lives left |
| Anagram | The scrambled letters, attempts used |

Answers arrive in the `gameEnd` message, once the game is over for everyone.
Opponent state is progress only: attempts spent, finished or not, connected or
not. `broadcastProgress()` is the only thing that talks about other players and
it cannot leak a letter, because it never has one.

## Layout

| File | Responsibility |
|---|---|
| `index.js` | HTTP static serving, WebSocket transport, message parsing |
| `rooms.js` | Room and match state machine: lobby, countdown, sequencing, scoring hookup, reconnection |
| `puzzles.js` | Random selection from the pools, with no-repeat windows |
| `scoring.js` | Efficiency, speed, partial credit, standings ranking |
| `games/*.js` | Per-game server rules: what a guess did, what the client may see |
| `pools.json` | Room word pools — generated, and never served to a browser |
| `_gen-pools.js` | Builds `pools.json` from a frequency list and a dictionary |

`rooms.js` deliberately knows nothing about sockets: a room is handed a `send`
function. That is what lets the tests drive every timing rule directly.

## Word pools are partitioned from the public games

A room word is never a word the public daily games can serve. `_gen-pools.js`
loads what Shabda, Snowman and Anagram already use — 2,960 words — and excludes
every one of them, then asserts the result does not intersect. Without that, a
member could preview a future daily answer by playing a match.

Snowman's room book is hand-written because its clue is a category and no
frequency list carries one. The other two are derived by frequency band and put
through the same quality filters the public Anagram manifest uses.

## Scoring

Every game normalises to the same 0-100 band, so a match is not decided by which
games the host picked.

- **Efficiency, up to 70** — attempts or wrong guesses used.
- **Speed, up to 30** — capped deliberately below efficiency, so a clean slow
  solve (70) beats a scruffy fast one (11.7 + 30 = 41.7).
- **Partial credit, up to 25** — for an unsolved puzzle you made progress on.
  Always less than any solve.

Timing is measured from the moment the server delivered the puzzle, not from the
countdown, so nobody is scored on their latency. Everything is computed from
server-recorded timestamps; a client's opinion about time is never consulted.

Standings rank on **average points per match**, not raw totals, because members
join at different times and play different numbers of matches.

## Configuration

Timings are environment variables so they can be tuned without a code change.
The countdown is fixed at 5 seconds by decision D-8; the rest are starting points
to be tuned from data.

| Variable | Default | What it is |
|---|---|---|
| `PORT` | 8080 | HTTP and WebSocket port |
| `ROOM_COUNTDOWN_MS` | 5000 | Match start countdown |
| `ROOM_READY_TIMEOUT_MS` | 60000 | Wait before the host may force-start |
| `ROOM_GRACE_MS` | 45000 | How long a disconnected player's seat is held |
| `ROOM_INTERSTITIAL_MS` | 5000 | Standings shown between games |
| `ROOM_IDLE_MS` | 900000 | Idle lobby un-readies everyone |
| `PAREA_DEV` | unset | `1` also serves `_test.html` and `_gen-*.js` |
| `ROOM_ALLOWED_ORIGINS` | unset | Comma-separated origins allowed to open a socket. Unset means same-origin only |
| `ROOM_MAX_PAYLOAD` | 16384 | Largest message accepted, in bytes |
| `ROOM_MAX_SOCKETS` | 400 | Live connections before new ones are refused |
| `ROOM_MAX_ROOMS` | 500 | Live rooms before `create` is refused |
| `ROOM_MAX_ROOMS_PER_SOCKET` | 20 | Rooms one connection may open |
| `ROOM_MAX_MEMBERS` | 24 | Players in one room |
| `ROOM_RATE_BURST` | 40 | Messages one connection may send back to back |
| `ROOM_RATE_PER_SECOND` | 8 | Rate that burst refills at |
| `ROOM_RATE_STRIKES` | 5 | Rate-limited messages before the connection is closed |

Per-game time limits live in `games/*.js`: 90s for Shabda and Anagram, 120s for
Snowman (decision D-2).

## Protocol

One WebSocket at `/rooms`. JSON both ways, `type` on every message.

**Client to server:** `create`, `join`, `rejoin`, `ready`, `settings`, `start`,
`abort`, `submit`, `rematch`, `leave`, `sync`.

**Server to client:** `hello`, `joined`, `room`, `countdown`, `countdownAborted`,
`gameStart`, `submitResult`, `progress`, `gameEnd`, `matchEnd`,
`matchAbandoned`, `lobbyExpired`, `error`.

Every message carrying a deadline also carries `serverNow`. Clients measure the
offset from it and render timestamps as differences — they never run a local
countdown loop, which is what lets a throttled or backgrounded tab converge
instead of finishing late.

## What the server refuses

Rooms are open to anyone with a code and there are no accounts, so every ceiling
is about the process rather than about a person: one connection must not be able
to become all of the memory. Messages over `ROOM_MAX_PAYLOAD` end that
connection; messages faster than the token bucket get an error, then a close;
rooms, players per room and rooms per connection all have a ceiling; and a
socket may only be opened from a page the server itself served, unless
`ROOM_ALLOWED_ORIGINS` says otherwise — which it will need to, if the games and
the rooms end up on different domains.

If room logic throws while handling a message, that one connection is answered
with `server-error` and closed. The process stays up, because it is holding
every other live match in memory; a fuse exits anyway if a single minute
produces ten failures, so a supervisor gets its chance to restart something
genuinely broken.

Static files carry an `ETag` and a `Cache-Control` lifetime, and text is gzipped
on the way out — the 103 KB word list travels as 45 KB, or as an empty 304 once
a browser has it. Pages themselves revalidate every time, so a deploy is never
invisible. Files beginning with `_` are development files and are not served at
all unless `PAREA_DEV=1`.

## Known limits

- **Rooms live in memory.** A restart ends matches gracefully and drops rooms.
  Persisting standings needs a store, which v1 does not have.
- **One process.** No horizontal scaling; rooms are not shareable across nodes.
- **No authentication.** A seat is held by a token in `sessionStorage`. Anyone
  with a room code can join, which is the intent for a party game.
- **Solve-rate tuning (§6.3) is not instrumented.** The hooks would be the match
  log, which already holds everything needed.

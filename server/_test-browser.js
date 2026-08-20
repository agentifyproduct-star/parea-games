/* End-to-end test of the room client in a real browser.

   Starts the server, launches headless Chrome on room/_test.html, and joins the
   same room from Node so the browser has a real opponent. Results are read out
   of the page over the DevTools protocol, which keeps every test hook out of the
   server itself.

   Run: node _test-browser.js */

process.env.ROOM_INTERSTITIAL_MS = '400';
process.env.PAREA_DEV = '1';          // this suite is served the harness it drives

const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const { server } = require('./index.js');
const { rooms } = require('./rooms.js');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(p => require('fs').existsSync(p));

const DEBUG_PORT = 9333;
const wait = ms => new Promise(r => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

/* A minimal DevTools client: enough to evaluate an expression in the page. */
class Devtools {
  constructor(wsUrl) {
    this.socket = new WebSocket(wsUrl, { perMessageDeflate: false });
    this.pending = new Map();
    this.nextId = 1;
    this.ready = new Promise(resolve => this.socket.once('open', resolve));
    this.socket.on('message', raw => {
      const msg = JSON.parse(raw);
      const resolver = this.pending.get(msg.id);
      if (resolver) { this.pending.delete(msg.id); resolver(msg); }
    });
  }

  async evaluate(expression) {
    await this.ready;
    const id = this.nextId++;
    const reply = new Promise(resolve => this.pending.set(id, resolve));
    this.socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true }
    }));
    const msg = await reply;
    if (msg.error) throw new Error(msg.error.message);
    if (msg.result && msg.result.exceptionDetails) {
      throw new Error(msg.result.exceptionDetails.text);
    }
    return msg.result.result.value;
  }

  close() { this.socket.close(); }
}

/* The browser's opponent: joins whatever room the page created, readies up, and
   solves the word properly so the scoreboard has something in it. */
async function playOpponent(port) {
  const room = await waitForRoom();
  const socket = new WebSocket(`ws://localhost:${port}/rooms`);
  await new Promise(resolve => socket.once('open', resolve));

  const send = msg => socket.send(JSON.stringify(msg));
  let joined = false;

  socket.on('message', raw => {
    const msg = JSON.parse(raw);

    if (msg.type === 'joined') joined = true;

    if (msg.type === 'room' && joined && msg.phase === 'lobby') {
      const me = msg.members.find(m => m.id === msg.members.find(x => x.name === 'Node')?.id);
      if (me && !me.ready) send({ type: 'ready', ready: true });
    }

    if (msg.type === 'gameStart') {
      /* This process is the server, so the opponent can simply know the answer —
         it is standing in for a player who solves it, not testing fair play. */
      const live = rooms.get(room.code);
      const slot = live.match.games[live.match.index];
      setTimeout(() => send({ type: 'submit', payload: { guess: slot.secret.answer } }), 600);
    }
  });

  send({ type: 'join', code: room.code, name: 'Node' });
  return socket;
}

async function waitForRoom() {
  for (let i = 0; i < 200; i++) {
    const first = [...rooms.values()][0];
    if (first) return first;
    await wait(100);
  }
  throw new Error('the browser never created a room');
}

/* ---------------- go ---------------- */

async function main() {
  if (!CHROME) {
    console.error('no Chrome or Edge found — skipping the browser test');
    process.exit(0);
  }

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`server on ${port}, driving ${CHROME.split('/').pop()}\n`);

  const profile = require('path').join(require('os').tmpdir(), 'room-browser-test');
  require('fs').rmSync(profile, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    `http://localhost:${port}/room/_test.html`
  ], { stdio: 'ignore' });

  let devtools = null;
  let opponent = null;
  let failures = 1;

  try {
    /* Wait for the page target to show up, then attach. */
    let target = null;
    for (let i = 0; i < 100 && !target; i++) {
      await wait(200);
      try {
        const list = await getJson(`http://localhost:${DEBUG_PORT}/json/list`);
        target = list.find(t => t.type === 'page' && t.url.includes('_test.html'));
      } catch { /* Chrome is still starting */ }
    }
    if (!target) throw new Error('could not attach to the page');

    devtools = new Devtools(target.webSocketDebuggerUrl);
    opponent = await playOpponent(port);

    /* Poll until the page says it is finished. */
    let done = false;
    for (let i = 0; i < 900 && !done; i++) {
      await wait(200);
      done = await devtools.evaluate('window.__done === true').catch(() => false);
    }

    const results = await devtools.evaluate('JSON.stringify(window.__results || [])');
    const lines = JSON.parse(results || '[]');
    lines.forEach(line => console.log(line));

    failures = lines.filter(l => l.startsWith('FAIL')).length;
    if (!done) { console.log('FAIL the page never finished'); failures += 1; }
    console.log(`\n${lines.filter(l => l.startsWith('PASS')).length} passed, ${failures} failed`);
  } catch (err) {
    console.error('browser test failed:', err.message);
  } finally {
    if (devtools) devtools.close();
    if (opponent) opponent.close();
    chrome.kill();
    server.close();
    setTimeout(() => process.exit(failures ? 1 : 0), 300);
  }
}

main();

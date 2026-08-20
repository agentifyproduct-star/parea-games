/* What a crawler sees.

   Two kinds of reader are being checked here. A search engine, which will run
   the page's JavaScript but wants titles, canonicals and structured data; and an
   answer engine, which mostly will not run anything and can only use what is in
   the HTML it fetched. So the strictest test in this file is the plainest one:
   the front page must name all three games with no script having run.

   Run: node _test-seo.js */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { SITE, GAMES, FAQ } = require('./_catalog.js');

const ROOT = __dirname;
const live = GAMES.filter(game => game.status === 'live');

let failures = 0;
const check = (name, condition, detail) => {
  const line = (condition ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '');
  if (!condition) failures++;
  console.log(line);
};

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const has = (html, needle) => html.includes(needle);

/* The bits of a page a crawler actually parses. */
function meta(html, attr, key) {
  const match = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  return match ? match[1] : null;
}
const canonical = html => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || null;
const title = html => (html.match(/<title>([^<]*)<\/title>/) || [])[1] || null;

function structuredData(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return blocks.map(b => JSON.parse(b[1]));
}

/* An absolute site URL, back to the file it should be served from. */
function localFor(url) {
  const rel = url.replace(SITE.origin, '').replace(/^\//, '');
  return rel.endsWith('/') || rel === '' ? path.join(ROOT, rel, 'index.html') : path.join(ROOT, rel);
}

/* What .vercelignore keeps off the site. */
const ignoreRules = read('.vercelignore')
  .split('\n').map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

function ships(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  return !ignoreRules.some(rule => {
    if (rule === '_*' || rule === '**/_*') return base.startsWith('_');
    if (rule.endsWith('/')) return rel.startsWith(rule);
    return rel === rule;
  });
}

/* ---------------- generated files are current ---------------- */

try {
  execFileSync(process.execPath, [path.join(ROOT, '_gen-site.js'), '--check'], { stdio: 'pipe' });
  check('every generated file matches _catalog.js', true);
} catch (err) {
  check('every generated file matches _catalog.js', false, 'run node _gen-site.js');
}

/* ---------------- the front page, with no JavaScript ---------------- */

const home = read('index.html');
const questions = FAQ.filter(item => (SITE.roomsLive ? !item.solo : !item.rooms));

/* The front page carries scripts again, so the guarantee has to be stated more
   carefully than "none". What matters is that no *content* waits for them: the
   games, their descriptions and the answers are all in the HTML above, checked
   by the tests either side of this one. What is allowed here is therefore the
   structured-data block, which is data rather than code; the host's deferred
   page counter; and our own enhancement scripts, which may only tick off a day
   that already happened and must sit at the end of the document where they
   cannot block a render. */
const scripts = [...home.matchAll(/<script([^>]*)>/g)].map(m => m[1]);
const executable = scripts.filter(attrs => !/application\/ld\+json/.test(attrs));
const sources = executable.map(attrs => (attrs.match(/src="([^"]+)"/) || [])[1] || '');

check('every script on the front page is one of ours or the host counter',
  sources.every(src => /^(assets\/|home\.js)/.test(src) || src === '/_vercel/insights/script.js'),
  sources.join(' | '));

check('nothing on the front page is fetched from another domain',
  !/src="https?:/.test(home));

check('the enhancement scripts sit after the page they enhance',
  home.lastIndexOf('</main>') < home.indexOf('<script src="home.js'));

check('the front page still names every game with no script having run',
  live.every(game => has(home.slice(0, home.indexOf('<script src="assets/daily.js')), game.title)));

questions.forEach(item => {
  check(`the page shows the answer to "${item.q}"`, has(home, item.a.slice(0, 50)));
});

/* ---------------- structured data ---------------- */

const graph = structuredData(home)[0]['@graph'];
const typed = type => graph.find(node => node['@type'] === type);

check('the front page declares one JSON-LD graph', structuredData(home).length === 1);
check('it identifies the site', !!typed('WebSite') && typed('WebSite').name === SITE.name);
check('it identifies the publisher', !!typed('Organization'));
check('it lists every live game', typed('ItemList').itemListElement.length === live.length);
check('it carries the questions', typed('FAQPage').mainEntity.length === questions.length);

/* Google's rule for FAQ markup: whatever the markup claims must be visible on
   the page. Generating both from one source is what keeps that true, and this
   is the test that says so. */
const marked = typed('FAQPage').mainEntity;
check('every marked-up answer is also visible on the page',
  marked.every(entry => has(home, entry.acceptedAnswer.text.slice(0, 50))));
check('every marked-up question is also visible on the page',
  marked.every(entry => has(home, entry.name.replace(/&/g, '&amp;'))));

/* ---------------- each game page ---------------- */

live.forEach(game => {
  const file = path.join('games', game.id, 'index.html');
  const html = read(file);
  const url = `${SITE.origin}/${game.path}`;

  check(`${game.title}: title names the game and the site`,
    (title(html) || '').includes(game.title) && (title(html) || '').includes(SITE.name));
  check(`${game.title}: description is the catalog's`,
    meta(html, 'name', 'description') === game.description.replace(/&/g, '&amp;'));
  check(`${game.title}: canonical points at its own page`, canonical(html) === url);
  check(`${game.title}: has a link preview`,
    !!meta(html, 'property', 'og:title') && !!meta(html, 'property', 'og:image') &&
    meta(html, 'name', 'twitter:card') === 'summary_large_image');
  check(`${game.title}: preview image exists`, fs.existsSync(localFor(meta(html, 'property', 'og:image'))));

  const data = structuredData(html)[0];
  check(`${game.title}: is marked up as a game`, data['@type'] === 'VideoGame' && data.name === game.title);
  check(`${game.title}: is marked up as free`, data.isAccessibleForFree === true && data.offers.price === '0');
  check(`${game.title}: says what it is, in the page`, has(html, game.description.slice(0, 50)));
});

/* ---------------- rooms are all-or-nothing ---------------- */

/* The one thing worse than a site without rooms is a site that offers rooms and
   then cannot reach a server, so the switch has to take every mention with it. */
if (SITE.roomsLive) {
  check('with rooms on, the front page offers them', has(home, 'href="room/index.html"'));
  check('with rooms on, the room page ships', ships('room/index.html'));
} else {
  check('with rooms off, the front page never links to one', !has(home, 'room/index.html'));
  check('with rooms off, the room page stays off the site', !ships('room/index.html'));
  check('with rooms off, nothing on the page promises them',
    !/start a room|play against friends|against each other/i.test(home));
  check('with rooms off, llms.txt does not mention them', !/room/i.test(read('llms.txt')));
}

/* ---------------- pages kept out of the index ---------------- */

['room/index.html', 'games/[redacted]/index.html'].forEach(file => {
  const html = read(file);
  check(`${file} is noindex`, (meta(html, 'name', 'robots') || '').startsWith('noindex'));
  check(`${file} still previews when pasted into a chat`, !!meta(html, 'property', 'og:title'));
});

/* ---------------- files for crawlers ---------------- */

const robots = read('robots.txt');
check('robots.txt points at the sitemap', has(robots, `Sitemap: ${SITE.origin}/sitemap.xml`));
check('robots.txt lets everything else through', /User-agent: \*\s*\nAllow: \//.test(robots));

const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
check('the sitemap lists the front page and every game', locs.length === live.length + 1);
check('every sitemap URL resolves to a file that exists', locs.every(loc => fs.existsSync(localFor(loc))));
check('the sitemap leaves rooms out', !locs.some(loc => loc.includes('/room')));
check('the sitemap leaves the retired game out', !locs.some(loc => loc.includes('[redacted]')));

const llms = read('llms.txt');
check('llms.txt says what the site is', has(llms, SITE.summary.slice(0, 40)));
check('llms.txt describes every game', live.every(game => has(llms, game.description.slice(0, 40))));
check('llms.txt answers the questions', questions.every(item => has(llms, item.q)));

check('the shared day record ships', ships('assets/today.js') && fs.existsSync(path.join(ROOT, 'assets/today.js')));
check('the front page enhancement ships', ships('home.js') && fs.existsSync(path.join(ROOT, 'home.js')));

/* today.js names the three games for itself, because it is read by pages that
   never see the catalog. Nothing stops the two drifting apart except this. */
const todaySource = read('assets/today.js');
check('the day record lists exactly the live games, in the same order',
  live.every(game => new RegExp(`id: '${game.id}', title: '${game.title}', path: '${game.path}'`).test(todaySource)) &&
  (todaySource.match(/\{ id: '/g) || []).length === live.length);

/* ---------------- the images those tags promise ---------------- */

function pngSize(file) {
  const head = fs.readFileSync(path.join(ROOT, file)).subarray(16, 24);
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}

['assets/brand/share.png', ...live.map(g => `assets/brand/share-${g.id}.png`)].forEach(file => {
  const exists = fs.existsSync(path.join(ROOT, file));
  const size = exists ? pngSize(file) : null;
  check(`${file} is a 1200x630 card`, exists && size.width === 1200 && size.height === 630,
    size ? `${size.width}x${size.height}` : 'missing');
});


/* ---------------- the deploy is not missing anything ---------------- */

/* .vercelignore keeps the workings off the internet. The risk in that is
   obvious: exclude one file a page actually loads and the site is broken in a
   way no local test would ever notice, because locally the file is right there.
   So the rules are read from the file itself and every link on every shipped
   page is checked against them. */

const pages = ['index.html', 'room/index.html', ...live.map(g => `games/${g.id}/index.html`)]
  .filter(ships);

check('the front page and every live game ship',
  ships('index.html') && live.every(g => ships(`games/${g.id}/index.html`)));
check('the room server is left behind', !ships('server/index.js') && !ships('server/pools.json'));
check('the test harnesses are left behind', !ships('games/shabda/_test.html') && !ships('_test-seo.js'));
check('the readable answer manifest is left behind', !ships('games/anagram/puzzles.json'));

pages.forEach(page => {
  const html = read(page);
  const dir = path.posix.dirname(page.split(path.sep).join('/'));
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(ref => !/^(https?:|mailto:|data:|#|\/)/.test(ref));

  refs.forEach(ref => {
    const rel = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, ref.split('#')[0].split('?')[0]));
    const onDisk = fs.existsSync(path.join(ROOT, rel));
    check(`${page} → ${ref} ships`, onDisk && ships(rel),
      !onDisk ? 'missing on disk' : (!ships(rel) ? 'excluded from the deploy' : ''));
  });
});

console.log(`\n${failures ? failures + ' failed' : 'all passed'}`);
process.exit(failures ? 1 : 0);

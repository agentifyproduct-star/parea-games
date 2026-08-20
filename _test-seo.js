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

/* ---------------- generated files are current ---------------- */

try {
  execFileSync(process.execPath, [path.join(ROOT, '_gen-site.js'), '--check'], { stdio: 'pipe' });
  check('every generated file matches _catalog.js', true);
} catch (err) {
  check('every generated file matches _catalog.js', false, 'run node _gen-site.js');
}

/* ---------------- the front page, with no JavaScript ---------------- */

const home = read('index.html');

check('the front page runs no JavaScript at all',
  !/<script(?![^>]*application\/ld\+json)/.test(home));

live.forEach(game => {
  check(`${game.title} is named in the HTML itself`, has(home, `>${game.title}</h3>`));
  check(`${game.title}'s description is in the HTML itself`, has(home, game.tagline.slice(0, 40)));
  check(`${game.title} is linked from the front page`, has(home, `href="${game.url}"`));
});

check('the one-sentence summary is on the page', has(home, SITE.summary.slice(0, 60)));
check('the site name is in the title', (title(home) || '').includes(SITE.name));
check('the front page has a description', (meta(home, 'name', 'description') || '').length > 60);
check('the front page is canonical to the bare domain', canonical(home) === `${SITE.origin}/`);

FAQ.forEach(item => {
  check(`the page shows the answer to "${item.q}"`, has(home, item.a.slice(0, 50)));
});

/* ---------------- structured data ---------------- */

const graph = structuredData(home)[0]['@graph'];
const typed = type => graph.find(node => node['@type'] === type);

check('the front page declares one JSON-LD graph', structuredData(home).length === 1);
check('it identifies the site', !!typed('WebSite') && typed('WebSite').name === SITE.name);
check('it identifies the publisher', !!typed('Organization'));
check('it lists every live game', typed('ItemList').itemListElement.length === live.length);
check('it carries the questions', typed('FAQPage').mainEntity.length === FAQ.length);

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
check('llms.txt answers the questions', FAQ.every(item => has(llms, item.q)));

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

const pages = ['index.html', 'room/index.html', ...live.map(g => `games/${g.id}/index.html`)]
  .filter(ships);

check('the front page and every live game ship', pages.length === live.length + 2);
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
    const rel = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, ref.split('#')[0]));
    const onDisk = fs.existsSync(path.join(ROOT, rel));
    check(`${page} → ${ref} ships`, onDisk && ships(rel),
      !onDisk ? 'missing on disk' : (!ships(rel) ? 'excluded from the deploy' : ''));
  });
});

console.log(`\n${failures ? failures + ' failed' : 'all passed'}`);
process.exit(failures ? 1 : 0);

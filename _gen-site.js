/* Writes everything that is derived from _catalog.js.

   The front page used to build itself in the browser, which meant the games only
   existed once JavaScript had run. Search engines mostly cope with that; the
   answer engines — the crawlers behind AI answers — mostly do not, and a page
   that cannot name its own games to them is a page that does not get mentioned.
   So the markup is generated here instead and shipped as plain HTML, and the
   front page now runs no JavaScript at all.

   Everything between a pair of <!-- name:start --> / <!-- name:end --> comments
   belongs to this script. Edit _catalog.js, run this, commit the result.

   Run: node _gen-site.js        (--check to verify without writing) */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SITE, GAMES, FAQ } = require('./_catalog.js');

const ROOT = __dirname;
const CHECK = process.argv.includes('--check');
const live = GAMES.filter(game => game.status === 'live');

/* Rooms need a running process. Until one is hosted, every part of the site
   that offers them is left out rather than left broken. */
const rooms = !!SITE.roomsLive;
const summary = rooms ? SITE.summary : SITE.summarySolo;
const heroNote = rooms ? SITE.heroNote : SITE.heroNoteSolo;
const questions = FAQ.filter(item => (rooms ? !item.solo : !item.rooms));
const analytics = !!SITE.analytics;

const abs = rel => `${SITE.origin}/${String(rel).replace(/^\/+/, '')}`;
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let wrote = [];
let stale = [];

function put(file, next) {
  const full = path.join(ROOT, file);
  const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  if (current === next) return;
  if (CHECK) { stale.push(file); return; }
  fs.writeFileSync(full, next);
  wrote.push(file);
}

/* Replaces a named block, or inserts one before `anchor` the first time. */
function block(html, name, body, anchor) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const built = `${start}\n${body}\n${end}`;
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from !== -1 && to !== -1) return html.slice(0, from) + built + html.slice(to + end.length);
  if (!anchor || !html.includes(anchor)) throw new Error(`no anchor for ${name}`);
  return html.replace(anchor, `${built}\n${anchor}`);
}


/* ---------------- cache stamps ---------------- */

/* Pages revalidate on every visit; stylesheets and scripts are cached for an
   hour. That combination can hand somebody new markup with old styles — which
   is how a fixed layout arrives broken. Every local .css and .js reference
   therefore carries a stamp taken from the file's own contents: change the
   file, change the URL, and the old copy in a browser cache is simply never
   asked for again. Unchanged files keep their stamp, so nothing is re-fetched
   for the sake of it. */
function stampAssets(html, pageFile) {
  const dir = path.dirname(path.join(ROOT, pageFile));

  return html.replace(/(src|href)="([^"?:]+\.(?:css|js))(\?v=[a-f0-9]+)?"/g, (whole, attr, ref) => {
    const target = path.resolve(dir, ref);
    if (!fs.existsSync(target)) return whole;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(target)).digest('hex').slice(0, 8);
    return `${attr}="${ref}?v=${hash}"`;
  });
}

/* ---------------- shared head markup ---------------- */

function socialTags({ title, description, url, image }) {
  return [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${image}" />`
  ].join('\n');
}

const jsonLd = data => `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;


/* Counted where the host counts it: no third party, no cookie, and deferred so
   it cannot hold up a single letter of the game. */
function analyticsMarkup() {
  return analytics
    ? '  <script defer src="/_vercel/insights/script.js"></script>'
    : '';
}

/* ---------------- the front page ---------------- */

function stripMarkup() {
  return live.map(game =>
    `        <a class="strip-item" data-game="${game.id}" href="${game.url}" aria-label="Play ${esc(game.title)}">` +
    `<img src="${game.art}" alt="${esc(game.alt)}" />` +
    `<span class="strip-label">${esc(game.title)}</span></a>`
  ).join('\n');
}

function featureMarkup() {
  return live.map((game, i) => `        <article class="feature" data-game="${game.id}">
          <a class="feature-art" href="${game.url}" tabindex="-1" aria-hidden="true"><img src="${game.art}" alt="" /></a>
          <div class="feature-copy">
            <span class="feature-index">Game ${String(i + 1).padStart(2, '0')}</span>
            <div class="feature-rule" style="background: ${game.accent};"></div>
            <h3>${esc(game.title)}</h3>
            <p>${esc(game.tagline)}</p>
            <ul class="feature-meta">${game.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
            <a class="btn btn-ink" href="${game.url}">Play ${esc(game.title)}</a>
          </div>
        </article>`).join('\n')
}

function navMarkup() {
  const links = [
    '      <a href="#games">Games</a>',
    rooms ? '      <a href="#rooms">Rooms</a>' : null,
    '      <a href="#about">About</a>',
    '      <a href="#questions">Questions</a>'
  ].filter(Boolean).join('\n');

  /* With rooms off, the header's one button would lead nowhere, so the games
     themselves become the call to action. */
  const button = rooms
    ? '    <a class="btn btn-ink" id="play-cta" href="room/index.html">Play together</a>'
    : `    <a class="btn btn-ink" id="play-cta" href="${live[0].url}">Play today's games</a>`;

  return `    <nav class="site-nav">\n${links}\n    </nav>\n${button}`;
}

function heroNoteMarkup() {
  return `      <p class="hero-note">${esc(heroNote)}</p>`;
}

function roomsMarkup() {
  if (!rooms) return '';
  return `    <section id="rooms" class="rooms">
      <div class="rooms-art">
        <img src="assets/art/rooms.svg" alt="Three players marked ready in a room, with a countdown running" />
      </div>
      <div class="rooms-copy">
        <p class="eyebrow"><span class="eyebrow-tag alt">Together</span></p>
        <h2>Same puzzle. Same second. May the best speller win.</h2>
        <p>
          Start a room, send your friends the four-letter code, and play any of the three games
          against each other. Nobody sees the words until the countdown hits zero &mdash; not even
          whoever started it.
        </p>
        <p class="fine">
          You score on how few guesses you needed first, and how quickly second.
        </p>
        <a class="btn btn-ink" href="room/index.html">Open a room &rarr;</a>
      </div>
    </section>`;
}

function faqMarkup() {
  return questions.map(item => `        <div class="faq">
          <h3>${esc(item.q)}</h3>
          <p>${esc(item.a)}</p>
        </div>`).join('\n');
}

function homeStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE.origin}/#organisation`,
        name: SITE.name,
        url: `${SITE.origin}/`,
        slogan: SITE.tagline,
        logo: { '@type': 'ImageObject', url: abs('assets/brand/icon-512.png'), width: 512, height: 512 }
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE.origin}/#website`,
        name: SITE.name,
        url: `${SITE.origin}/`,
        description: summary,
        inLanguage: 'en',
        publisher: { '@id': `${SITE.origin}/#organisation` }
      },
      {
        '@type': 'ItemList',
        name: 'Daily word games on Parea Games',
        numberOfItems: live.length,
        itemListElement: live.map((game, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: game.title,
          url: abs(game.path)
        }))
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE.origin}/#faq`,
        mainEntity: questions.map(item => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a }
        }))
      }
    ]
  };
}

function buildHome() {
  const file = 'index.html';
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');

  html = html.replace(/<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${esc(summary)}" />`);

  html = block(html, 'seo', [
    socialTags({
      title: `${SITE.name} — three word games, every day`,
      description: summary,
      url: `${SITE.origin}/`,
      image: abs('assets/brand/share.png')
    }),
    jsonLd(homeStructuredData())
  ].join('\n'), '</head>');

  html = block(html, 'nav', navMarkup());
  html = block(html, 'heronote', heroNoteMarkup());
  html = block(html, 'rooms', roomsMarkup());
  html = block(html, 'strip', stripMarkup());
  html = block(html, 'games', featureMarkup());
  html = block(html, 'faq', faqMarkup());
  html = block(html, 'summary', `        <p>${esc(summary)}</p>`);
  html = html.replace(/<span id="game-count">\d+<\/span>/, `<span id="game-count">${live.length}</span>`);
  html = block(html, 'home', [
    '  <script src="assets/daily.js"></script>',
    '  <script src="assets/today.js"></script>',
    '  <script src="home.js"></script>'
  ].join('\n'));
  html = block(html, 'analytics', analyticsMarkup(), '</body>');

  put(file, stampAssets(html, file));
}

/* ---------------- a game page ---------------- */

function gameStructuredData(game) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.title,
    url: abs(game.path),
    description: game.description,
    image: abs(`assets/brand/share-${game.id}.png`),
    genre: ['Word game', 'Puzzle'],
    gamePlatform: 'Web browser',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any modern web browser',
    playMode: ['SinglePlayer', 'MultiPlayer'],
    inLanguage: 'en',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    publisher: { '@type': 'Organization', name: SITE.name, url: `${SITE.origin}/` }
  };
}

function buildGame(game) {
  const file = path.join('games', game.id, 'index.html');
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');

  /* One description, from the catalog, rather than one here and one there. */
  html = html.replace(/<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${esc(game.description)}" />`);

  /* The how-to opens by saying what the game is, from the same sentence the
     markup and the front page use. */
  html = block(html, 'intro', `      <p class="lede">${esc(game.description)}</p>`);

  html = block(html, 'seo', [
    socialTags({
      title: `${game.title} — ${SITE.name}`,
      description: game.description,
      url: abs(game.path),
      image: abs(`assets/brand/share-${game.id}.png`)
    }),
    jsonLd(gameStructuredData(game))
  ].join('\n'), '</head>');

  html = block(html, 'analytics', analyticsMarkup(), '</body>');

  put(file, stampAssets(html, file));
}

/* ---------------- pages that stay out of the index ---------------- */

/* Rooms are made and thrown away in an evening and a code means nothing to
   anyone who was not sent it; the retired [redacted] page is kept for the archive
   but is not part of the site. Both still want a link preview, since both get
   pasted into a chat. */
function buildUnlisted(file, { title, description, follow }) {
  const full = path.join(ROOT, file);
  let html = fs.readFileSync(full, 'utf8');

  html = block(html, 'seo', [
    `<meta name="robots" content="noindex, ${follow ? 'follow' : 'nofollow'}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${abs('assets/brand/share.png')}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`
  ].join('\n'), '</head>');

  put(file, stampAssets(html, file));
}

/* ---------------- files for crawlers ---------------- */

function buildRobots() {
  put('robots.txt', [
    '# Everything here is meant to be read, by people and by machines alike.',
    'User-agent: *',
    'Allow: /',
    '',
    '# Nothing lives here that is worth a crawl: room codes expire the same evening.',
    'Disallow: /room/',
    '',
    `Sitemap: ${SITE.origin}/sitemap.xml`,
    ''
  ].join('\n'));
}

function buildSitemap() {
  const day = file => {
    const full = path.join(ROOT, file);
    return fs.statSync(full).mtime.toISOString().slice(0, 10);
  };

  const pages = [
    { loc: `${SITE.origin}/`, file: 'index.html', priority: '1.0', changefreq: 'daily' },
    ...live.map(game => ({
      loc: abs(game.path),
      file: path.join('games', game.id, 'index.html'),
      priority: '0.8',
      changefreq: 'daily'
    }))
  ];

  put('sitemap.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map(p => [
      '  <url>',
      `    <loc>${p.loc}</loc>`,
      `    <lastmod>${day(p.file)}</lastmod>`,
      `    <changefreq>${p.changefreq}</changefreq>`,
      `    <priority>${p.priority}</priority>`,
      '  </url>'
    ].join('\n')),
    '</urlset>',
    ''
  ].join('\n'));
}

/* The same facts as the FAQ, as plain text, for the crawlers that would rather
   read a document than parse a page. */
function buildLlmsTxt() {
  put('llms.txt', [
    `# ${SITE.name}`,
    '',
    `> ${summary}`,
    '',
    `A new puzzle for every game arrives at midnight New York time, at that same instant`,
    `everywhere in the world. Everything is free, nothing needs installing, and there is no`,
    `account to make. Streaks are kept in the browser, not on a server.`,
    '',
    '## Games',
    '',
    ...live.map(game => `- [${game.title}](${abs(game.path)}): ${game.description}`),
    '',
    ...(rooms ? [
      '## Playing together',
      '',
      `- [Rooms](${abs('room/')}): start a room, send friends the four-letter code, and everyone`,
      `  plays the same puzzles at the same second. Nobody sees the words until the countdown`,
      `  reaches zero. Scoring counts guesses used first and speed second.`,
      ''
    ] : []),
    '## Questions',
    '',
    ...questions.map(item => `### ${item.q}\n\n${item.a}\n`),
    ''
  ].join('\n'));
}

/* ---------------- go ---------------- */

buildHome();
live.forEach(buildGame);
if (rooms) buildUnlisted('room/index.html', {
  title: 'Play with your friends — Parea Games',
  description: 'Start a room, send the code, and play the same puzzles at the same second.',
  follow: true
});
buildUnlisted(path.join('games', '[redacted]', 'index.html'), {
  title: '[redacted] — Parea Games',
  description: 'An earlier game, kept for the archive.',
  follow: false
});
buildRobots();
buildSitemap();
buildLlmsTxt();

if (CHECK) {
  if (stale.length) {
    console.error('out of date with _catalog.js:\n  ' + stale.join('\n  '));
    process.exit(1);
  }
  console.log('every generated file matches _catalog.js');
} else {
  console.log(wrote.length ? 'wrote:\n  ' + wrote.join('\n  ') : 'nothing to change');
}

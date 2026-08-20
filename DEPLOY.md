# Putting Parea Games on pareagames.com

The site is three static games, a hub, and — separately — a Node process for
rooms. The two halves deploy differently, so this is in two phases. Phase one
puts the games on the domain. Rooms can follow whenever, without redoing any of
it.

## What ships

Everything except what `.vercelignore` names: the room server, every file
beginning with `_` (test harnesses, generators, the catalog), the retired [redacted]
page, and `games/anagram/puzzles.json` — the page loads `puzzles.js`, so the
readable copy of 200 days of answers has no reason to be on the internet.

## Phase 1 — the games, on Vercel

### 1. Make it a repository

```
cd c:\Agents\arcade
git init
git add .
git commit -m "Parea Games"
```

Push it to GitHub if you want deploys to happen on every push; skip it if you
would rather deploy from your machine with the CLI. Both work.

### 2. Check the generated files are current

```
node _gen-site.js --check     # markup matches _catalog.js
node _test-seo.js             # 70 checks: titles, canonicals, previews, sitemap
```

### 3. Deploy

**From GitHub:** in Vercel, *Add New → Project*, pick the repository. Framework
preset **Other**, build command **empty**, output directory **empty** (the repo
root is the site). Deploy.

**From your machine:** `npx vercel` once to link the project, then
`npx vercel --prod` to publish.

There is no build step. Vercel serves the files as they are, gzips and brotlis
text on the way out, and never lists a directory.

### 4. Point the domain at it

In the Vercel project: *Settings → Domains*, add `pareagames.com`, then add
`www.pareagames.com` and set it to redirect to the apex. Vercel will show the
exact DNS records it wants — **use those, not the ones written here**, since they
change. At the time of writing they are:

| Record | Name | Value |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

Add them at whichever registrar you bought the domain from. DNS usually takes
minutes; the TLS certificate is issued automatically once the records resolve.

The apex is the canonical form — every `<link rel="canonical">` on the site says
`https://pareagames.com/...` — so keep `www` as the redirect, not the other way
round.

### 5. Check it landed

- `https://pareagames.com/` loads, and so do all three games.
- `https://pareagames.com/robots.txt` and `/sitemap.xml` return the real files.
- View source on the front page: the three games are in the HTML, and there is
  no `<script>` except the JSON-LD block.
- Paste a game link into a chat and see the preview card.
- Submit the sitemap in Google Search Console.

## Phase 2 — rooms, when you want them

Rooms need a process that stays running, which Vercel's static hosting is not.
Two things to do, neither of them urgent:

1. **Host `server/` somewhere that runs Node** — Render's free web service is the
   obvious one. Set `ROOM_ALLOWED_ORIGINS=https://pareagames.com` so the socket
   only accepts our own pages, and leave `PAREA_DEV` unset so the test harnesses
   stay unreachable. Give it a subdomain, e.g. `rooms.pareagames.com`.

2. **Make the client's socket address configurable.** `room/room.js` currently
   builds the URL from `location.host`, which is right when one host serves
   everything and wrong the moment rooms live elsewhere. It needs to read an
   endpoint from a small config rather than assume.

Until then the Rooms section on the hub points at a page that will say it cannot
reach a server, which is honest but not much fun — worth hiding the section
until phase 2 lands.

## Costs

Vercel's Hobby tier is free and covers this comfortably: the whole site is about
200 KB compressed on a first visit, and near zero after that because everything
carries an ETag. The one condition is that Hobby is for non-commercial use — ads
or payments would mean Pro at $20/month.

## When the puzzles change

Regenerating word lists or the anagram manifest is a normal commit: run the
generator, run the tests, push. HTML is served `must-revalidate`, so a deploy is
visible immediately; the word lists carry an hour of cache and an ETag, so
returning players get a 304 rather than a download.

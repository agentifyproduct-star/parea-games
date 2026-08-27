/* What the site is, and what is on it.

   One list, used three ways: the front page is built from it, the search and
   answer-engine markup is generated from it, and the sitemap is written from it.
   Anything a person or a crawler is told about a game is written here once.

   To add a game: append an entry, draw an SVG for it in assets/art, create
   games/<id>/index.html, then run `node _gen-site.js`.

   Loads as a plain browser script and as a Node module, because the generator
   and the page need the same data. */

const SITE = {
  name: 'Parea Games',
  origin: 'https://pareagames.com',
  tagline: 'Your people, every day',

  /* Rooms need a process running somewhere, and until one has a home the site
     must not offer them: a front page that advertises a thing it cannot do is
     worse than one that says nothing. Everything room-shaped — the nav link,
     the button, the section, the question, the sentence in the summary — is
     generated, so this one word turns it all on together. */
  roomsLive: false,

  /* Vercel's web analytics: page views only, no cookies, nothing that follows
     anyone between sites. The script is served by the host itself, so it exists
     on the deployed site and 404s harmlessly anywhere else. */
  analytics: true,
  /* One sentence that says what this is, in the shape an answer engine can
     lift whole. */
  summary: 'Parea Games is a free daily word game site with three games — Shabda, ' +
    'Snowman and Anagram. Everyone gets the same puzzles each day, there is nothing to ' +
    'install and no account to make, and you can play against friends in a private room.',

  /* The same sentence with nothing in it we cannot deliver today. */
  summarySolo: 'Parea Games is a free daily word game site with three games — Shabda, ' +
    'Snowman and Anagram. Everyone in the world gets the same puzzles each day, there is ' +
    'nothing to install and no account to make.',

  heroNote: 'Short enough for the two minutes you actually have. Play on your own, or start ' +
    'a room and take on your friends at the very same puzzle.',
  heroNoteSolo: 'Short enough for the two minutes you actually have. A new puzzle for ' +
    'everybody at midnight, so today is the same day wherever you are playing from.'
};

const GAMES = [
  {
    id: 'shabda',
    title: 'Shabda',
    tagline: 'Six guesses, one hidden word. The board is four to seven letters, and it picks you.',
    description: 'Shabda is a free daily word game. Guess the hidden word in six tries on a ' +
      'board of four to seven letters — every correct letter lights up, and everyone in the ' +
      'world gets the same word each day.',
    art: 'assets/art/shabda.svg',
    icon: 'assets/art/icon-shabda.svg',
    alt: 'A grid of letter tiles with one row solved in teal',
    accent: '#2f9e8f',
    facts: ['New word daily', '6 guesses', '4 to 7 letters'],
    status: 'live',
    path: 'games/shabda/',
    url: 'games/shabda/index.html'
  },
  {
    id: 'snowman',
    title: 'Snowman',
    tagline: 'Hangman by another name. Call out letters before he melts away, with only the category to go on.',
    description: 'Snowman is a free daily word game — hangman by another name. Call out letters ' +
      'to find the hidden word before the snowman melts away, with only its category to go on. ' +
      'A new word every day, and unlimited words whenever you want more.',
    art: 'assets/art/snowman.svg',
    icon: 'assets/art/icon-snowman.svg',
    alt: 'A snowman that has lost its hat and scarf, beside a part-guessed word',
    accent: '#5a9e4f',
    facts: ['New word daily', '12 categories', 'Unlimited words'],
    status: 'live',
    path: 'games/snowman/',
    url: 'games/snowman/index.html'
  },
  {
    id: 'anagram',
    title: 'Anagram',
    tagline: 'One jumbled word a day. Everyone gets the same one, so you can compare notes.',
    description: 'Anagram is a free daily word game. Unscramble the day’s jumbled word, five ' +
      'to eight letters, in five tries — everyone in the world gets the same word, so you can ' +
      'compare notes with whoever else played today.',
    art: 'assets/art/anagram.svg',
    icon: 'assets/art/icon-anagram.svg',
    alt: 'Scattered letter tiles settling into a solved word',
    accent: '#6c74d8',
    facts: ['One word daily', '5 to 8 letters', '5 tries'],
    status: 'live',
    path: 'games/anagram/',
    url: 'games/anagram/index.html'
  }
];

/* The questions people actually ask, answered in one liftable paragraph each.
   These appear on the page and in the FAQ markup, from this one copy — the two
   are required to agree, and generating both is how they stay that way. */
const FAQ = [
  {
    q: 'What is Parea Games?',
    rooms: true,
    a: 'Parea Games is a free word game site with three daily games: Shabda, Snowman and ' +
       'Anagram. Everyone in the world gets the same puzzles each day, and you can play them ' +
       'on your own or against friends in a private room.'
  },
  {
    q: 'What is Parea Games?',
    solo: true,
    a: 'Parea Games is a free word game site with three daily games: Shabda, Snowman and ' +
       'Anagram. Everyone in the world gets the same puzzles each day, so whoever else played ' +
       'today played exactly what you played.'
  },
  {
    q: 'Is it free, and do I need an account?',
    a: 'It is free and there is no account. Nothing to install, no ads, and no sign-up — open ' +
       'the page and play. Your streaks are kept in your own browser, which means your phone ' +
       'and your laptop keep separate records.'
  },
  {
    q: 'When does the new puzzle arrive?',
    a: 'At midnight New York time, and at that same instant everywhere. A player in London, ' +
       'Mumbai or Sydney gets the new puzzles at the same moment as a player in New York, ' +
       'just at a different hour of their own day.'
  },
  {
    q: 'How do I play Shabda?',
    a: 'Guess the hidden word in six tries. Each guess has to be a real word; letters in the ' +
       'right place turn green, letters in the word but the wrong place turn amber, and ' +
       'letters that are not in the word go grey. You can play a four, five or six letter ' +
       'board.'
  },
  {
    q: 'How do I play Snowman?',
    a: 'Call out one letter at a time to uncover a hidden word, knowing only its category. ' +
       'Every wrong letter melts away a piece of the snowman, and you have six wrong guesses ' +
       'before he is a puddle.'
  },
  {
    q: 'How do I play Anagram?',
    a: 'One scrambled word arrives each day, between five and eight letters long. Unscramble ' +
       'it within five tries. Everyone gets the same word, so the day is the same puzzle for ' +
       'everybody, and a hint is there after three wrong tries if you want it.'
  },
  {
    q: 'Can I play against my friends?',
    rooms: true,
    a: 'Yes. Start a room, send the four-letter code to your friends, and everybody plays the ' +
       'same puzzles at the same second. Nobody sees the words until the countdown reaches ' +
       'zero, not even the person who started the room. You score on how few guesses you ' +
       'needed first, and how quickly second.'
  }
];

if (typeof module !== 'undefined' && module.exports) module.exports = { SITE, GAMES, FAQ };
if (typeof window !== 'undefined') { window.SITE = SITE; window.GAMES = GAMES; window.FAQ = FAQ; }

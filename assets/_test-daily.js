/* Tests for the daily clock: node _test-daily.js

   The thing being checked is that the puzzle turns over at midnight in New York
   for everybody — including on the two days a year that are 23 and 25 hours
   long, which is where naive "add 24 hours" logic goes wrong. */

global.window = {};
require('./daily.js');
const DAILY = window.window ? window.window.DAILY : window.DAILY;

let failures = 0;

function check(name, got, want) {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${got}${ok ? '' : `  (wanted ${want})`}`);
}

const at = iso => new Date(iso);
const rollover = iso => new Date(DAILY.nextRollover(at(iso).getTime())).toISOString();

console.log('named timezones available:', DAILY.zoneWorks, '\n');

/* Summer — New York runs four hours behind UTC. */
check('23:30 in New York is still yesterday', DAILY.key(at('2026-08-19T03:30:00Z')), '2026-08-18');
check('00:30 in New York is today', DAILY.key(at('2026-08-19T04:30:00Z')), '2026-08-19');

/* Winter — five hours behind. */
check('winter, 23:30 in New York', DAILY.key(at('2026-01-15T04:30:00Z')), '2026-01-14');
check('winter, 00:30 in New York', DAILY.key(at('2026-01-15T05:30:00Z')), '2026-01-15');

/* The point of the whole exercise: one instant, one puzzle, everywhere. */
check('the same instant gives the same day, wherever the device is set',
      DAILY.key(at('2026-08-19T12:00:00Z')), '2026-08-19');

check('summer rollover is 04:00 UTC', rollover('2026-08-19T10:00:00Z'), '2026-08-20T04:00:00.000Z');
check('winter rollover is 05:00 UTC', rollover('2026-01-15T10:00:00Z'), '2026-01-16T05:00:00.000Z');

/* 8 March 2026 is 23 hours long, 1 November 2026 is 25. Both still end at
   midnight in New York. */
check('the 23-hour day ends on time', rollover('2026-03-08T06:00:00Z'), '2026-03-09T04:00:00.000Z');
check('the 25-hour day ends on time', rollover('2026-11-01T06:00:00Z'), '2026-11-02T05:00:00.000Z');

check('counting days between two dates', DAILY.daysBetween('2026-02-16', '2026-08-19'), 184);
check('stepping back over a clock change', DAILY.shift('2026-03-09', -1), '2026-03-08');
check('a key turns into a date safely away from any boundary',
      DAILY.key(DAILY.keyToDate('2026-03-08')), '2026-03-08');

/* The whole point, proved from the outside: run the same calculation in five
   very different timezones and demand the same answer back. Node reads TZ once
   at startup, so each zone needs its own process. */
const { execFileSync } = require('child_process');
const instant = '2026-08-19T12:00:00Z';
const script = 'global.window={};require(' + JSON.stringify(require.resolve('./daily.js')) + ');' +
               "process.stdout.write(window.DAILY.key(new Date('" + instant + "')))";

const answers = {};
['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Kiritimati', 'UTC']
  .forEach(zone => {
    answers[zone] = execFileSync(process.execPath, ['-e', script], {
      env: Object.assign({}, process.env, { TZ: zone }),
      encoding: 'utf8'
    });
  });

console.log('  ' + Object.keys(answers).map(z => z.split('/').pop() + '=' + answers[z]).join('  '));
check('every timezone lands on the same puzzle day', new Set(Object.values(answers)).size, 1);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

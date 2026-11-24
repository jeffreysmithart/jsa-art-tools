// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/log.js'));
const LOG = globalThis.VST.log;

const day = (items) => ({ items: Object.fromEntries(items.map((e, i) => [`id${i}`, { id: `id${i}`, secs: 0, drawSecs: 0, rounds: 0, ...e }])) });

test('a day counts with a minute of study or a timed round', () => {
  assert.equal(LOG.practiced(day([{ secs: 59 }])), false);
  assert.equal(LOG.practiced(day([{ secs: 60 }])), true);
  assert.equal(LOG.practiced(day([{ secs: 5, rounds: 1 }])), true);
  assert.equal(LOG.practiced(undefined), false);
});

test('day keys step across month and year ends', () => {
  assert.equal(LOG.shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(LOG.shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(LOG.shiftDay('2028-02-28', 1), '2028-02-29', 'leap year');
});

test('streaks, week and month totals', () => {
  // Saturday 2026-11-07; week starts Monday 2026-11-02
  const days = {
    '2026-10-28': day([{ secs: 600 }]), // Wed, last week
    '2026-10-29': day([{ secs: 600 }]),
    '2026-10-30': day([{ secs: 600 }]),
    '2026-10-31': day([{ secs: 600 }]), // longest run: Oct 28-31 (4 days)
    '2026-11-03': day([{ secs: 1200, rounds: 2, drawSecs: 1200 }]), // Tue
    '2026-11-04': day([{ secs: 30 }]), // too little to count
    '2026-11-05': day([{ secs: 300 }]),
    '2026-11-06': day([{ secs: 900 }, { secs: 300 }]),
  };
  const s = LOG.stats(days, '2026-11-07');
  assert.equal(s.streak, 2, 'Nov 5-6, counting from yesterday since today has no practice yet');
  assert.equal(s.longest, 4);
  assert.equal(s.weekDays, 3, 'Nov 3, 5, 6');
  assert.equal(s.weekSecs, 1200 + 30 + 300 + 1200);
  assert.equal(s.monthDays, 3);
  assert.equal(s.totalDays, 7);
  // practicing today extends the streak
  days['2026-11-07'] = day([{ secs: 120 }]);
  assert.equal(LOG.stats(days, '2026-11-07').streak, 3);
  // a gap yesterday resets it
  assert.equal(LOG.stats(days, '2026-11-09').streak, 0);
});

test('totals for a day', () => {
  const t = LOG.totals(day([{ secs: 600, rounds: 1, drawSecs: 300 }, { secs: 5 }, { secs: 120 }]));
  assert.deepEqual(t, { secs: 725, drawSecs: 300, rounds: 1, memRounds: 0, memSecs: 0, images: 2 });
});

test('CSV has one row per studied image, with quoting', () => {
  const out = LOG.csv({ '2026-11-06': day([{ title: 'Evening, "Medfield"', artist: 'George Inness', museum: 'The Met', source: 'met', secs: 900, rounds: 2, drawSecs: 600, memRounds: 1, memSecs: 300 }, { title: 'glance', secs: 3 }]) });
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 2, 'header + one row (the 3-second glance is skipped)');
  assert.equal(lines[1], '2026-11-06,"Evening, ""Medfield""",George Inness,The Met,met,15.0,2,10.0,1,5.0');
});

test('memory rounds are logged as timed rounds and counted separately', () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = v) };
  const now = new Date(2026, 10, 7, 12).getTime();
  LOG.start({ id: 'x', title: 'Study' }, now);
  LOG.round(120, {}, now);
  LOG.round(60, { memory: true }, now);
  const day = LOG.days()['2026-11-07'];
  const e = day.items.x;
  assert.equal(e.rounds, 2);
  assert.equal(e.drawSecs, 180);
  assert.equal(e.memRounds, 1);
  assert.equal(e.memSecs, 60);
  assert.equal(LOG.totals(day).memRounds, 1);
  assert.match(LOG.csv(LOG.days()), /,2,3\.0,1,1\.0\n$/);
  LOG.start(null, now);
  delete globalThis.localStorage;
});

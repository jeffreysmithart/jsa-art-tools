// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/sync-merge.js'));
const M = globalThis.VST.syncMerge;

const item = (id, at, extra = {}) => ({ id, title: id, at, ...extra });
const set = (id, created, items = [], extra = {}) => ({ id, name: id, created, updated: created, items, removed: {}, ...extra });

/** The rules every merge has to keep: order doesn't matter, and repeating changes nothing. */
function laws(merge, a, b, c) {
  assert.deepEqual(merge(a, b), merge(b, a), 'order-independent');
  const ab = merge(a, b);
  assert.deepEqual(merge(ab, ab), ab, 'repeating changes nothing');
  assert.deepEqual(merge(ab, a), ab, 'merging an older copy again changes nothing');
  if (c) assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)), 'grouping doesn’t matter');
}

test('a new time is now, or just after the last one seen', () => {
  assert.equal(M.stamp(0, 1000), 1000);
  assert.equal(M.stamp(5000, 1000), 5001, 'a slow clock still moves forward');
});

test('sets: images added on two devices end up in both', () => {
  const ipad = { sets: [set('s1', 100, [item('a', 110), item('b', 120)])], deleted: {} };
  const mac = { sets: [set('s1', 100, [item('a', 110), item('c', 130)])], deleted: {} };
  const m = M.mergeSets(ipad, mac);
  assert.deepEqual(m.sets[0].items.map((i) => i.id), ['a', 'b', 'c']);
  laws(M.mergeSets, ipad, mac, { sets: [set('s1', 100, [item('d', 140)])], deleted: {} });
});

test('sets: removing an image on one device isn’t undone by the other', () => {
  const ipad = { sets: [set('s1', 100, [item('a', 110)], { removed: { b: 200 }, updated: 200 })], deleted: {} };
  const mac = { sets: [set('s1', 100, [item('a', 110), item('b', 120)])], deleted: {} };
  assert.deepEqual(M.mergeSets(ipad, mac).sets[0].items.map((i) => i.id), ['a']);
  laws(M.mergeSets, ipad, mac);
  // adding it back later wins over the removal
  const readd = { sets: [set('s1', 100, [item('a', 110), item('b', 300)])], deleted: {} };
  assert.deepEqual(M.mergeSets(ipad, readd).sets[0].items.map((i) => i.id), ['a', 'b']);
});

test('sets: a deleted set stays deleted, unless it was changed afterwards', () => {
  const ipad = { sets: [], deleted: { s1: 500 } };
  const mac = { sets: [set('s1', 100, [item('a', 110)], { updated: 110 })], deleted: {} };
  assert.equal(M.mergeSets(ipad, mac).sets.length, 0);
  laws(M.mergeSets, ipad, mac);
  const editedLater = { sets: [set('s1', 100, [item('a', 110), item('z', 600)], { updated: 600 })], deleted: {} };
  assert.equal(M.mergeSets(ipad, editedLater).sets.length, 1, 'an edit after the deletion keeps the set');
});

test('sets: the newest rename wins, and older data without times still merges', () => {
  const ipad = { sets: [set('s1', 100, [], { name: 'Inness', nameAt: 300 })], deleted: {} };
  const mac = { sets: [set('s1', 100, [], { name: 'Landscapes', nameAt: 200 })], deleted: {} };
  assert.equal(M.mergeSets(ipad, mac).sets[0].name, 'Inness');
  // a set saved before sync existed: no nameAt, items without `at`
  const old = { sets: [{ id: 's2', name: 'Old', created: 50, updated: 60, items: [{ id: 'x' }, { id: 'y', added: 55 }] }] };
  const m = M.mergeSets(old, { sets: [], deleted: {} });
  assert.deepEqual(m.sets[0].items.map((i) => i.id), ['x', 'y']);
  laws(M.mergeSets, old, mac);
});

test('sets are listed newest first', () => {
  const m = M.mergeSets({ sets: [set('old', 100)] }, { sets: [set('new', 900)] });
  assert.deepEqual(m.sets.map((s) => s.id), ['new', 'old']);
});

test('presets: the newest edit wins; deletions stick unless edited later', () => {
  const ipad = { presets: [{ id: 'p1', name: 'Soft 3', blur: 20, updated: 100 }], deleted: { p2: 300 } };
  const mac = { presets: [{ id: 'p1', name: 'Soft 3', blur: 40, updated: 200 }, { id: 'p2', name: 'Gone', updated: 150 }], deleted: {} };
  const m = M.mergePresets(ipad, mac);
  assert.deepEqual(m.presets.map((p) => [p.id, p.blur]), [['p1', 40]]);
  laws(M.mergePresets, ipad, mac);
});

test('history: combined, newest first, removals and clearing stick', () => {
  const ipad = { items: [{ id: 'a', viewed: 100 }, { id: 'b', viewed: 300 }], removed: { c: 250 }, clearedAt: 0 };
  const mac = { items: [{ id: 'a', viewed: 200 }, { id: 'c', viewed: 210 }, { id: 'd', viewed: 50 }], removed: {}, clearedAt: 60 };
  const m = M.mergeHistory(ipad, mac);
  assert.deepEqual(m.items.map((i) => [i.id, i.viewed]), [['b', 300], ['a', 200]], 'c removed, d from before the clear');
  laws(M.mergeHistory, ipad, mac);
  // it keeps the 60 most recent
  const many = { items: Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, viewed: 1000 + i })) };
  const more = { items: Array.from({ length: 50 }, (_, i) => ({ id: `y${i}`, viewed: 2000 + i })) };
  assert.equal(M.mergeHistory(many, more).items.length, 60);
});

test('log: each device’s time adds up, so a day used on two devices isn’t lost or doubled', () => {
  const ipad = { device: 'ipad', days: { '2026-11-08': { items: { a: { id: 'a', title: 'Inness', secs: 600, rounds: 1, drawSecs: 300 } } } } };
  const mac = { device: 'mac', days: { '2026-11-08': { items: { a: { id: 'a', secs: 120, rounds: 2, drawSecs: 600, memRounds: 1, memSecs: 300 } } }, '2026-11-07': { items: { b: { id: 'b', secs: 90 } } } } };
  const days = M.combineLogs([ipad, mac]);
  const e = days['2026-11-08'].items.a;
  assert.equal(e.secs, 720);
  assert.equal(e.rounds, 3);
  assert.equal(e.drawSecs, 900);
  assert.equal(e.memRounds, 1);
  assert.equal(e.title, 'Inness', 'details from whichever device had them');
  assert.equal(days['2026-11-07'].items.b.secs, 90);
  assert.deepEqual(M.combineLogs([mac, ipad])['2026-11-08'].items.a.secs, 720, 'order-independent');
});

test('log: clearing it on one device clears the others’ days up to then', () => {
  const clearedAt = new Date(2026, 10, 8, 12).getTime();
  const ipad = { device: 'ipad', days: { '2026-11-09': { items: { a: { id: 'a', secs: 60 } } } }, clearedAt };
  const mac = { device: 'mac', days: { '2026-11-01': { items: { b: { id: 'b', secs: 900 } } }, '2026-11-09': { items: { a: { id: 'a', secs: 30 } } } } };
  const days = M.combineLogs([ipad, mac]);
  assert.equal(days['2026-11-01'], undefined);
  assert.equal(days['2026-11-09'].items.a.secs, 90);
});

test('sets and history: the latest crop wins, and a synced photo name is kept', () => {
  const crop = (at, w) => ({ x: 0, y: 0, w, h: 1, preset: 'free', at });
  const ipad = { sets: [set('s1', 100, [item('a', 110, { crop: crop(500, 0.5) })])], deleted: {} };
  const mac = { sets: [set('s1', 100, [item('a', 110, { photo: 'f'.repeat(64), crop: crop(300, 0.8) })])], deleted: {} };
  const m = M.mergeSets(ipad, mac).sets[0].items[0];
  assert.equal(m.crop.w, 0.5, 'the iPad cropped later');
  assert.equal(m.photo, 'f'.repeat(64));
  laws(M.mergeSets, ipad, mac);
  const h = M.mergeHistory({ items: [{ id: 'a', viewed: 900 }] }, { items: [{ id: 'a', viewed: 100, crop: crop(200, 0.6) }] });
  assert.equal(h.items[0].crop.w, 0.6, 'a crop survives even when the other copy was viewed later');
});

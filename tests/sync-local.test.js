// Run with: node --test tests/
// The local stores record what syncing needs (times and removal markers),
// and two simulated devices that swap copies end up the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/** A fresh in-memory localStorage, standing in for one browser. */
function browser() {
  const mem = {};
  return { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k], mem };
}

require(path.join(__dirname, '../js/sync-merge.js'));
require(path.join(__dirname, '../js/library.js'));
require(path.join(__dirname, '../js/log.js'));
const { syncMerge: M, library: L, log: LOG } = globalThis.VST;

/** Runs `fn` as if on the device whose storage is `ls`. */
function on(ls, fn) {
  globalThis.localStorage = ls;
  try {
    return fn();
  } finally {
    delete globalThis.localStorage;
  }
}

test('sets record when names change, when images are added, and what was removed', () => {
  const ls = browser();
  on(ls, () => {
    const s = L.createSet('Inness');
    assert.ok(s.nameAt > 0 && s.removed && Array.isArray(s.items));
    L.addToSet(s.id, { id: 'aic-1', source: 'aic', title: 'Landscape' });
    assert.ok(L.getSet(s.id).items[0].at > 0, 'an added image has a time');
    L.removeFromSet(s.id, 'aic-1');
    assert.ok(L.getSet(s.id).removed['aic-1'] > 0, 'a removed image leaves a marker');
    L.deleteSet(s.id);
    assert.ok(L.setsDoc().deleted[s.id] > 0, 'a deleted set leaves a marker');
  });
});

test('two devices that swap their sets end up with the same sets', () => {
  const ipad = browser();
  const mac = browser();
  // the iPad makes a set; the Mac gets it by syncing
  const id = on(ipad, () => {
    const s = L.createSet('Inness');
    L.addToSet(s.id, { id: 'a', source: 'aic', title: 'A' });
    return s.id;
  });
  const fromIpad = on(ipad, () => L.setsDoc());
  on(mac, () => L.applySetsDoc(M.mergeSets(L.setsDoc(), fromIpad)));
  assert.equal(on(mac, () => L.getSet(id).name), 'Inness', 'the Mac got the set');
  // then each changes it differently
  on(ipad, () => L.addToSet(id, { id: 'b', source: 'aic', title: 'B' }));
  on(mac, () => {
    L.addToSet(id, { id: 'c', source: 'aic', title: 'C' });
    L.removeFromSet(id, 'a');
  });
  const merged = M.mergeSets(on(ipad, () => L.setsDoc()), on(mac, () => L.setsDoc()));
  on(ipad, () => L.applySetsDoc(merged));
  on(mac, () => L.applySetsDoc(merged));
  const ids = (ls) => on(ls, () => L.getSet(id).items.map((i) => i.id).sort());
  assert.deepEqual(ids(ipad), ['b', 'c']);
  assert.deepEqual(ids(mac), ['b', 'c']);
});

test('history: a removal or a clear on one device carries to the other', () => {
  const ipad = browser();
  const mac = browser();
  on(ipad, () => {
    L.record({ id: 'a', source: 'aic', title: 'A' });
    L.record({ id: 'b', source: 'aic', title: 'B' });
  });
  const shared = on(ipad, () => L.historyDoc());
  on(mac, () => L.applyHistoryDoc(shared));
  on(mac, () => L.removeFromHistory('a'));
  const merged = M.mergeHistory(on(ipad, () => L.historyDoc()), on(mac, () => L.historyDoc()));
  assert.deepEqual(merged.items.map((i) => i.id), ['b']);
  on(ipad, () => L.clearHistory());
  const cleared = M.mergeHistory(on(ipad, () => L.historyDoc()), on(mac, () => L.historyDoc()));
  assert.equal(cleared.items.length, 0);
});

test('log: this device’s own log, plus other devices’ added in', () => {
  const ls = browser();
  on(ls, () => {
    const now = new Date(2026, 10, 8, 12).getTime();
    LOG.start({ id: 'a', title: 'Inness' }, now);
    LOG.round(300, {}, now);
    const mine = LOG.syncDoc();
    assert.ok(mine.device && mine.device === LOG.deviceId(), 'the log says which device it is from');
    assert.equal(LOG.deviceId(), mine.device, 'the device id stays the same');
    LOG.setOthers({ 'd-mac': { device: 'd-mac', days: { '2026-11-08': { items: { a: { id: 'a', secs: 0, drawSecs: 600, rounds: 2 } } } } }, [mine.device]: mine });
    const e = LOG.days()['2026-11-08'].items.a;
    assert.equal(e.rounds, 3, 'rounds from both devices');
    assert.equal(e.drawSecs, 900);
    assert.equal(LOG.syncDoc().days['2026-11-08'].items.a.rounds, 1, 'this device’s own log is unchanged');
    LOG.start(null, now);
  });
});

test('log: clearing it records when, so the other devices can clear theirs', () => {
  const ls = browser();
  on(ls, () => {
    LOG.clear();
    assert.ok(LOG.syncDoc().clearedAt > 0);
  });
});

test('two quick changes keep their order, even in the same millisecond', () => {
  const ls = browser();
  on(ls, () => {
    const s = L.createSet('Quick');
    L.addToSet(s.id, { id: 'a', source: 'aic', title: 'A' });
    L.removeFromSet(s.id, 'a');
    L.addToSet(s.id, { id: 'a', source: 'aic', title: 'A' });
    const merged = M.mergeSets(L.setsDoc(), { sets: [], deleted: {} });
    assert.deepEqual(merged.sets[0].items.map((i) => i.id), ['a'], 'added back after removing: it stays');
  });
});

test('an image’s crop is saved with it, and reopening it keeps the crop', () => {
  const ls = browser();
  on(ls, () => {
    L.record({ id: 'aic-1', source: 'aic', title: 'A' });
    const s = L.createSet('S');
    L.addToSet(s.id, { id: 'aic-1', source: 'aic', title: 'A' });
    L.setCrop('aic-1', { x: 0.1, y: 0, w: 0.5, h: 1, preset: '8x10', landscape: false });
    assert.equal(L.cropFor('aic-1').w, 0.5);
    assert.equal(L.getSet(s.id).items[0].crop.preset, '8x10', 'on the copy in the set too');
    // opening it again (from a search result that knows nothing of the crop) keeps it
    L.record({ id: 'aic-1', source: 'aic', title: 'A' });
    assert.equal(L.history()[0].crop.w, 0.5);
  });
});

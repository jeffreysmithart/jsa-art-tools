// Run with: node --test tests/
// The app's sync (js/sync.js) end to end: two simulated devices, the real
// Worker (sync/worker.js), and an in-memory R2 bucket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import worker from '../sync/worker.js';
import { memoryBucket } from './r2-memory.mjs';

const require = createRequire(import.meta.url);
const SERVICE = 'https://sync.test';

/** A fresh in-memory localStorage, standing in for one browser. */
function browser() {
  const mem = {};
  return { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k], mem };
}

// the app's modules, shared by both "devices" (each device is its own localStorage)
globalThis.VST = { config: { syncService: SERVICE } };
for (const f of ['color', 'process', 'sync-merge', 'library', 'presets', 'saved', 'log']) require(`../js/${f}.js`);
/** A separate copy of the sync module per device, since it keeps its own state. */
function syncModule() {
  delete require.cache[require.resolve('../js/sync.js')];
  require('../js/sync.js');
  return globalThis.VST.sync;
}
const { library: L, presets: PR, myPalettes: MP, myMasks: MM, log: LOG } = globalThis.VST;

let env;
let requests = 0;
globalThis.fetch = async (url, init = {}) => {
  requests++;
  return worker.fetch(new Request(url, init), env);
};

/** Runs `fn` as the device whose storage is `ls` (one at a time, so nothing interleaves). */
async function as(ls, fn) {
  globalThis.localStorage = ls;
  try {
    return await fn();
  } finally {
    delete globalThis.localStorage;
  }
}

test('codes: 25 letters and digits, typed loosely, always the same keys', async () => {
  const S = syncModule();
  const code = S.newCode();
  assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
  assert.equal(S.normalize(code.toLowerCase().replace(/-/g, ' ')), code.replace(/-/g, ''), 'spaces and lowercase are fine');
  assert.equal(S.normalize('O0IL1'.repeat(5)), '00111'.repeat(5), 'O and 0, I/L and 1 are the same');
  assert.equal(S.normalize('too-short'), null);
  const a = await S.keysFor(code);
  const b = await S.keysFor(code.toLowerCase());
  assert.equal(a.id, b.id);
  assert.equal(a.token, b.token);
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.notEqual(a.id, a.token);
  const other = await S.keysFor(S.newCode());
  assert.notEqual(other.id, a.id);
});

test('encryption: only the same code opens it', async () => {
  const S = syncModule();
  const k1 = await S.keysFor(S.newCode());
  const k2 = await S.keysFor(S.newCode());
  const sealed = await S.seal(k1.key, { sets: [{ name: 'Inness' }] });
  assert.ok(!new TextDecoder().decode(sealed).includes('Inness'), 'the service sees no names');
  assert.deepEqual(await S.open(k1.key, sealed), { sets: [{ name: 'Inness' }] });
  await assert.rejects(S.open(k2.key, sealed));
});

test('two devices with the same code end up with the same sets, presets, history and log', async () => {
  env = { SYNC: memoryBucket() };
  const ipad = browser();
  const mac = browser();
  const A = syncModule();
  const B = syncModule();

  // the iPad makes a set and a preset, studies an image, then turns sync on
  const setId = await as(ipad, async () => {
    const s = L.createSet('Inness');
    L.addToSet(s.id, { id: 'aic-1', source: 'aic', title: 'Landscape 1' });
    PR.save({ name: 'Soft 3', tone: 'gray', bands: 3, blur: 30 });
    L.record({ id: 'aic-1', source: 'aic', title: 'Landscape 1' });
    LOG.start({ id: 'aic-1', title: 'Landscape 1' });
    LOG.round(600);
    LOG.start(null);
    await A.turnOn();
    assert.equal(A.status().error, '');
    return s.id;
  });
  // nothing readable on the server
  for (const [, o] of env.SYNC.store) assert.ok(!new TextDecoder().decode(o.bytes).includes('Inness'));

  // the Mac joins with the code (typed in lowercase) and gets everything
  const code = await as(ipad, () => A.status().code);
  await as(mac, async () => {
    await B.join(code.toLowerCase());
    assert.equal(B.status().error, '');
    assert.equal(L.getSet(setId).name, 'Inness');
    assert.deepEqual(L.getSet(setId).items.map((i) => i.id), ['aic-1']);
    assert.ok(PR.user().some((p) => p.name === 'Soft 3'));
    assert.equal(L.history()[0].id, 'aic-1');
    const day = LOG.days()[LOG.dayKey()];
    assert.equal(day.items['aic-1'].rounds, 1, 'the iPad’s practice shows on the Mac');
    assert.equal(B.status().devices, 2);
  });

  // each changes something; after both sync, they match
  await as(mac, async () => {
    L.addToSet(setId, { id: 'aic-2', source: 'aic', title: 'Landscape 2' });
    L.renameSet(setId, 'Inness, late');
    await B.syncNow();
  });
  await as(ipad, async () => {
    L.removeFromSet(setId, 'aic-1');
    await A.syncNow();
  });
  await as(mac, () => B.syncNow());
  const view = (ls) => as(ls, () => ({ name: L.getSet(setId).name, items: L.getSet(setId).items.map((i) => i.id) }));
  assert.deepEqual(await view(ipad), { name: 'Inness, late', items: ['aic-2'] });
  assert.deepEqual(await view(mac), await view(ipad));

  // with nothing new, a pass only asks what's there
  const before = requests;
  await as(mac, () => B.syncNow());
  assert.equal(requests - before, 1, 'one request when nothing changed');
});

test('a device that saved in between is merged with, not overwritten', async () => {
  env = { SYNC: memoryBucket() };
  const ipad = browser();
  const mac = browser();
  const A = syncModule();
  const B = syncModule();
  await as(ipad, () => A.turnOn());
  const code = await as(ipad, () => A.status().code);
  await as(mac, () => B.join(code));
  // the Mac saves a new set while the iPad's sync is about to save its own
  const ipadSet = await as(ipad, () => L.createSet('From the iPad').id);
  await as(mac, async () => {
    L.createSet('From the Mac');
    await B.syncNow();
  });
  await as(ipad, () => A.syncNow());
  await as(mac, () => B.syncNow());
  const names = (ls) => as(ls, () => L.sets().map((s) => s.name).sort());
  assert.deepEqual(await names(ipad), ['From the Mac', 'From the iPad']);
  assert.deepEqual(await names(mac), ['From the Mac', 'From the iPad']);
  assert.ok(ipadSet);
});

test('a wrong code is refused, and turning off can delete the synced copy', async () => {
  env = { SYNC: memoryBucket() };
  const ipad = browser();
  const A = syncModule();
  await as(ipad, async () => {
    await assert.rejects(A.join('nope'), /doesn’t look like a sync code/);
    await A.turnOn();
    assert.ok(env.SYNC.store.size > 0);
    await A.turnOff({ removeCopy: true });
    assert.equal(env.SYNC.store.size, 0, 'the synced copy is gone');
    assert.equal(A.status().on, false);
    assert.ok(L.sets() !== null, 'this device keeps its own data');
  });
});

test('photos: the device that has one uploads it; the other fetches it when it’s opened', async () => {
  env = { SYNC: memoryBucket() };
  const ipad = browser();
  const mac = browser();
  const A = syncModule();
  const B = syncModule();
  // the iPad has a photo (IndexedDB isn't in Node, so photos are held here)
  const photo = new Uint8Array(4096).map((_, i) => (i * 37) % 256);
  const held = { ipad: { 'up-1': new Blob([photo]) }, mac: {} };
  let who = 'ipad';
  const realPhotoBlob = L.photoBlob;
  L.photoBlob = async (blobId) => held[who][blobId] || null;
  try {
    const setId = await as(ipad, async () => {
      const s = L.createSet('Sketches');
      L.addToSet(s.id, { id: 'up-1', source: 'upload', title: 'My sketch', blobId: 'up-1' });
      await A.turnOn();
      return s.id;
    });
    const item = await as(ipad, () => L.getSet(setId).items[0]);
    assert.match(item.photo || '', /^[0-9a-f]{64}$/, 'the item records its synced photo name');
    const stored = [...env.SYNC.store.keys()].filter((k) => k.includes('/photo/'));
    assert.equal(stored.length, 1, 'the photo is stored once');
    const sealed = env.SYNC.store.get(stored[0]).bytes;
    assert.ok(sealed.byteLength > photo.byteLength && !Buffer.from(sealed).includes(Buffer.from(photo.slice(0, 64))), 'and only encrypted');
    // the Mac joins: the set arrives with the photo's name, and the photo is fetched when needed
    who = 'mac';
    const code = await as(ipad, () => A.status().code);
    const macItem = await as(mac, async () => {
      await B.join(code);
      return L.getSet(setId).items[0];
    });
    assert.equal(macItem.photo, item.photo);
    const blob = await as(mac, () => B.fetchPhoto(macItem));
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), photo, 'the same photo, decrypted');
    // a second pass doesn't upload it again
    who = 'ipad';
    const puts = env.SYNC.store.size;
    await as(ipad, () => A.syncNow());
    assert.equal(env.SYNC.store.size, puts);
    // once nothing uses it, it's removed, but only after a day
    await as(ipad, async () => {
      L.removeFromSet(setId, 'up-1');
      L.clearHistory();
      await A.syncNow();
    });
    assert.equal([...env.SYNC.store.keys()].filter((k) => k.includes('/photo/')).length, 1, 'kept for a day, in case another device just linked it');
    const key = [...env.SYNC.store.keys()].find((k) => k.includes('/photo/'));
    env.SYNC.store.get(key).uploaded = new Date(Date.now() - A.PHOTO_GRACE - 60000);
    await as(ipad, () => A.syncNow());
    assert.equal([...env.SYNC.store.keys()].filter((k) => k.includes('/photo/')).length, 0, 'then removed');
  } finally {
    L.photoBlob = realPhotoBlob;
  }
});

test('named palettes sync: saved, renamed and deleted on one device, the same on the other', async () => {
  env = { SYNC: memoryBucket() };
  const ipad = browser();
  const mac = browser();
  const A = syncModule();
  const B = syncModule();
  const ids = await as(ipad, async () => {
    const a = MP.save('Summer landscape', ['cadmium-lemon', 'ultramarine', 'titanium-white']);
    const b = MP.save('Portraits', ['yellow-ochre', 'vermilion', 'ivory-black', 'titanium-white']);
    await A.turnOn();
    return [a.id, b.id];
  });
  const code = await as(ipad, () => A.status().code);
  await as(mac, async () => {
    await B.join(code);
    assert.deepEqual(MP.all().map((p) => p.name), ['Portraits', 'Summer landscape']);
    assert.deepEqual(MP.get(ids[0]).paints, ['cadmium-lemon', 'ultramarine', 'titanium-white']);
    // the Mac renames one and changes its paints, and deletes the other
    MP.rename(ids[0], 'Summer, high key');
    MP.setPaints(ids[0], ['cadmium-lemon', 'cobalt-blue', 'titanium-white']);
    MP.remove(ids[1]);
    await B.syncNow();
  });
  await as(ipad, async () => {
    await A.syncNow();
    assert.deepEqual(MP.all().map((p) => p.name), ['Summer, high key'], 'the deletion sticks, the rename arrives');
    assert.deepEqual(MP.get(ids[0]).paints, ['cadmium-lemon', 'cobalt-blue', 'titanium-white']);
  });
  for (const [, o] of env.SYNC.store) assert.ok(!new TextDecoder().decode(o.bytes).includes('Summer'), 'palette names are encrypted too');
});

test('saved gamut masks sync too', async () => {
  env = { SYNC: memoryBucket() };
  const ipad = browser();
  const mac = browser();
  const A = syncModule();
  const B = syncModule();
  const id = await as(ipad, async () => {
    const m = MM.save('Warm triad', { shape: 'triad', points: [[40, 30], [-20, 25], [-10, -30]] });
    await A.turnOn();
    return m.id;
  });
  const code = await as(ipad, () => A.status().code);
  await as(mac, async () => {
    await B.join(code);
    assert.deepEqual(MM.all().map((m) => m.name), ['Warm triad']);
    assert.deepEqual(MM.get(id).points, [[40, 30], [-20, 25], [-10, -30]]);
    MM.setMask(id, { shape: 'custom', points: [[50, 30], [-20, 25], [-10, -30]] });
    await B.syncNow();
  });
  await as(ipad, async () => {
    await A.syncNow();
    assert.deepEqual(MM.get(id).points[0], [50, 30], 'a reshaped mask arrives');
    assert.equal(MM.get(id).shape, 'custom');
  });
});

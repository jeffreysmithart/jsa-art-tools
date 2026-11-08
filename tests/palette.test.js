// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/color.js'));
require(path.join(__dirname, '../js/palette.js'));
const spectral = require(path.join(__dirname, '../js/vendor/spectral.js'));
const { palette: PAL, color: C } = globalThis.VST;
const toLab = (r, g, b) => C.rgbToLab(r, g, b, [0, 0, 0]);
const lab = (hex) => toLab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));

test('compositions split parts among paints', () => {
  assert.deepEqual(PAL.compositions(3, 2), [[1, 2], [2, 1]]);
  assert.equal(PAL.compositions(6, 3).length, 10);
});

test('every preset uses known paints', () => {
  for (const p of PAL.PRESETS) for (const id of p.paints) assert.ok(PAL.byId.has(id), `${p.id}: ${id}`);
});

test('blue and yellow mix green, the way paint does', () => {
  const model = PAL.build(['prussian-blue', 'cadmium-yellow', 'titanium-white'], spectral, toLab);
  const green = lab('#4A7A3A');
  const { d } = PAL.nearest(model, ...green);
  assert.ok(d < 15, `a mid green is within reach (ΔE ${d.toFixed(1)})`);
  // and with only the yellow and white, it isn't
  const noBlue = PAL.build(['cadmium-yellow', 'titanium-white'], spectral, toLab);
  assert.ok(PAL.nearest(noBlue, ...green).d > 20);
});

test('the Zorn palette cannot reach a saturated blue', () => {
  const zorn = PAL.build(PAL.PRESETS.find((p) => p.id === 'zorn').paints, spectral, toLab);
  const blue = lab('#2050C0');
  assert.ok(PAL.nearest(zorn, ...blue).d > PAL.REACH);
  // but it does reach warm skin-like tones and grays
  assert.ok(PAL.nearest(zorn, ...lab('#D9A88A')).d < PAL.REACH);
  assert.ok(PAL.nearest(zorn, ...lab('#7F7F7F')).d < PAL.REACH);
});

test('the grid search finds the same mix as checking every one', () => {
  const model = PAL.build(['ultramarine', 'burnt-sienna', 'titanium-white'], spectral, toLab);
  for (const q of [[50, 0, 0], [30, 20, -40], [90, 5, 10], [10, 0, 0], [60, 60, 60]]) {
    let best = Infinity;
    for (const m of model.mixes) best = Math.min(best, Math.hypot(m.L - q[0], m.a - q[1], m.b - q[2]));
    assert.ok(Math.abs(PAL.nearest(model, ...q).d - best) < 1e-9, `query ${q}`);
  }
});

test('reach: share of a picture within the palette, and the hue of what is not', () => {
  const zorn = PAL.build(PAL.PRESETS.find((p) => p.id === 'zorn').paints, spectral, toLab);
  const [L1, a1, b1] = lab('#C08A5A');
  const [L2, a2, b2] = lab('#2050C0');
  const r = PAL.reach(zorn, [{ L: L1, a: a1, b: b1, share: 0.7 }, { L: L2, a: a2, b: b2, share: 0.3 }]);
  assert.ok(Math.abs(r.reached - 0.7) < 1e-9);
  assert.ok(r.outHue > 220 && r.outHue < 320, `out-of-reach hue is blue (${r.outHue})`);
});

test('recipes read like a painter would say them', () => {
  assert.equal(PAL.recipe([['yellow-ochre', 0.6], ['titanium-white', 0.3], ['vermilion', 0.1]]), 'mostly yellow ochre, some titanium white, a touch of vermilion');
  assert.equal(PAL.recipe([['ultramarine', 1]]), 'ultramarine blue');
});

test('painting with a palette uses its mixes and stripes only what it can’t reach', () => {
  const model = PAL.build(['yellow-ochre', 'vermilion', 'ivory-black', 'titanium-white'], spectral, toLab);
  const w = 40;
  const h = 40;
  const n = w * h;
  // left half an ochre-ish tan it can mix, right half a strong cyan it can't
  const tan = lab('#C9A46A');
  const cyan = lab('#00B5D8');
  const img = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
  for (let i = 0; i < n; i++) [img.L[i], img.A[i], img.B[i]] = i % w < w / 2 ? tan : cyan;
  const out = new Uint8ClampedArray(n * 4);
  const counts = PAL.paint(model, img, out, w, { mark: true });
  assert.equal([...counts.values()].reduce((s, v) => s + v, 0), n);
  const tanMix = model.mixes[PAL.nearest(model, ...tan).i].rgb;
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) assert.deepEqual([...out.slice((y * w + x) * 4, (y * w + x) * 4 + 3)], tanMix, 'the reachable half is just the mix');
  const right = new Set();
  for (let y = 0; y < h; y++) for (let x = w / 2; x < w; x++) right.add(out.slice((y * w + x) * 4, (y * w + x) * 4 + 3).join());
  assert.equal(right.size, 2, 'the unreachable half is its closest mix, striped');
  const plain = new Uint8ClampedArray(n * 4);
  PAL.paint(model, img, plain, w, { mark: false });
  const rightPlain = new Set();
  for (let x = w / 2; x < w; x++) rightPlain.add(plain.slice(x * 4, x * 4 + 3).join());
  assert.equal(rightPlain.size, 1, 'no stripes when not marking');
});

test('variations try each missing paint, and each own paint taken out', () => {
  const v = PAL.variations(['vermilion', 'titanium-white']);
  const adds = v.filter((x) => x.kind === 'add');
  const drops = v.filter((x) => x.kind === 'drop');
  assert.equal(adds.length, PAL.PIGMENTS.length - 2);
  assert.ok(adds.every((a) => a.ids.includes(a.id) && a.ids.length === 3));
  assert.deepEqual(drops.map((d) => d.ids), [['titanium-white'], ['vermilion']]);
  assert.equal(PAL.variations(['vermilion']).filter((x) => x.kind === 'drop').length, 0, 'a one-paint palette keeps its paint');
});

test('the paint a picture needs ranks first, and an unused one is least needed', () => {
  // a picture of greens and a little red, with a red-and-white palette plus a blue it doesn't need
  const cells = [
    { ...Object.fromEntries(['L', 'a', 'b'].map((k, i) => [k, lab('#4F7F3A')[i]])), share: 0.6 },
    { ...Object.fromEntries(['L', 'a', 'b'].map((k, i) => [k, lab('#E9E6DA')[i]])), share: 0.25 },
    { ...Object.fromEntries(['L', 'a', 'b'].map((k, i) => [k, lab('#C8443A')[i]])), share: 0.15 },
  ];
  const ids = ['vermilion', 'yellow-ochre', 'dioxazine-purple', 'titanium-white'];
  const base = PAL.reach(PAL.build(ids, spectral, toLab), cells);
  assert.ok(base.reached < 0.5, `the greens are out of reach (${base.reached})`);
  const tried = PAL.variations(ids).map((v) => ({ kind: v.kind, id: v.id, ...PAL.reach(PAL.build(v.ids, spectral, toLab), cells) }));
  const { adds, drops } = PAL.rank(base, tried);
  assert.ok(['sap-green', 'viridian', 'cerulean', 'phthalo-green', 'ultramarine', 'prussian-blue', 'phthalo-blue', 'ivory-black'].includes(adds[0].id), `a green or blue helps most (${adds[0].id})`);
  assert.ok(adds[0].gain >= 0.5 && adds[0].gained.length === 1, 'and it gains the greens');
  assert.ok(adds.every((a, i) => i === 0 || a.gain <= adds[i - 1].gain), 'adds are ranked by gain');
  assert.equal(drops[0].loss, 0);
  assert.ok(drops.filter((d) => d.loss === 0).some((d) => d.id === 'dioxazine-purple'), 'the purple isn’t needed');
  assert.ok(drops.find((d) => d.id === 'titanium-white').loss > 0.2, 'white is');
});

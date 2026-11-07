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

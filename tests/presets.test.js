// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/color.js'));
require(path.join(__dirname, '../js/process.js'));
require(path.join(__dirname, '../js/presets.js'));
const { process: P, presets: PR } = globalThis.VST;

// a 2-cluster image: half dark (L≈20), half light (L≈80)
function twoToneEntry() {
  const w = 20, h = 10, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = i % w < w / 2 ? 48 : 198;
    rgba.set([v, v, v, 255], i * 4);
  }
  return { w, h, lab0: P.computeLab(rgba, w * h) };
}

test('built-in presets are available without storage', () => {
  const all = PR.all();
  assert.ok(all.length >= 8);
  assert.ok(all.every((p) => p.builtin));
  assert.ok(PR.get('b-notan'));
});

test('splits: fit to each image, even, or fixed', () => {
  const hist = new Uint32Array(101);
  hist[20] = 100;
  hist[80] = 100;
  assert.deepEqual(PR.splitsFor({ bands: 2, splits: 'even' }, hist), [50]);
  const [auto] = PR.splitsFor({ bands: 2, splits: 'auto' }, hist);
  assert.ok(auto > 30 && auto < 70, `auto split between the clusters, got ${auto}`);
  assert.deepEqual(PR.splitsFor({ bands: 3, splits: 'fixed', thresholds: [30, 60] }, hist), [30, 60]);
});

test('render applies a preset to an image and reports value shares', () => {
  const e = twoToneEntry();
  const out = new Uint8ClampedArray(e.w * e.h * 4);
  const bands = PR.render(PR.get('b-notan'), e, out);
  assert.equal(bands.length, 2);
  assert.ok(Math.abs(bands[0].share - 0.5) < 1e-9 && Math.abs(bands[1].share - 0.5) < 1e-9);
  const grays = new Set();
  for (let i = 0; i < out.length; i += 4) grays.add(out[i]);
  assert.equal(grays.size, 2, 'notan paints exactly two values');
  // the original pseudo-preset and all-values presets report no bands
  assert.equal(PR.render({ id: 'original' }, e, out), null);
  assert.equal(PR.render(PR.get('b-gray'), e, out), null);
  // main colors
  assert.equal(PR.render(PR.get('b-main5'), e, out).length, 5);
});

test('describe explains a preset in plain words', () => {
  assert.equal(PR.describe(PR.get('b-squint3')), 'Grayscale · 3 values · fit to each image · squint');
  assert.equal(PR.describe(PR.get('b-4even')), 'Grayscale · 4 values · even splits · even steps');
  assert.equal(PR.describe(PR.get('b-main5')), '5 main colors');
});

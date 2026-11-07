// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/gamut.js'));
const G = globalThis.VST.gamut;

/** A Lab image made of [L, a, b, pixel count] patches. */
function image(patches) {
  const n = patches.reduce((s, p) => s + p[3], 0);
  const lab = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
  let i = 0;
  for (const [L, a, b, count] of patches) {
    for (let k = 0; k < count; k++, i++) {
      lab.L[i] = L;
      lab.A[i] = a;
      lab.B[i] = b;
    }
  }
  return lab;
}

test('convex hull drops inside points and keeps the corners', () => {
  const hull = G.convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [3, 7]]);
  assert.equal(hull.length, 4);
  assert.equal(G.polygonArea(hull), 100);
});

test('a gray picture is all neutral and has no main hue', () => {
  const r = G.analyze(image([[30, 0, 0, 500], [80, 1, -1, 500]]));
  assert.equal(r.stats.neutralShare, 1);
  assert.equal(r.stats.hue, null);
  assert.ok(r.stats.strongChroma <= 2);
});

test('cells keep the average color and share of their pixels', () => {
  const r = G.analyze(image([[50, 40, 0, 300], [70, 0, 60, 700]]));
  assert.equal(r.cells.length, 2);
  const red = r.cells.find((c) => c.a > 30);
  assert.ok(Math.abs(red.share - 0.3) < 1e-9);
  assert.ok(Math.abs(red.L - 50) < 1e-4);
});

test('a warm landscape reads as orange-ish with a moderate-to-strong range', () => {
  const r = G.analyze(image([[60, 20, 45, 600], [40, 10, 25, 300], [50, -5, -20, 100]]));
  assert.ok(['orange', 'yellow'].includes(r.stats.hueName), r.stats.hueName);
  assert.equal(G.strength(r.stats.strongChroma), 'moderate');
  assert.equal(r.hull.length, 3, 'three colors make a triangle');
  assert.ok(r.stats.area > 0 && r.stats.area < 0.2);
});

test('a few stray pixels do not stretch the gamut', () => {
  const big = image([[50, 10, 10, 100000], [50, -10, 10, 100000], [50, 0, -10, 100000], [50, 90, 0, 3]]);
  const r = G.analyze(big);
  assert.ok(r.hull.every(([a]) => a < 50), 'the 3-pixel red is left out of the outline');
  assert.ok(r.cells.some((c) => c.a > 80), 'but it is still drawn as a dot');
});

test('hue names go around the wheel', () => {
  assert.equal(G.hueName(40), 'red');
  assert.equal(G.hueName(90), 'yellow');
  assert.equal(G.hueName(150), 'green');
  assert.equal(G.hueName(250), 'blue');
  assert.equal(G.hueName(350), 'red-violet');
});

test('the value range runs from the darkest to the lightest few percent', () => {
  const r = G.analyze(image([[20, 0, 0, 500], [85, 0, 0, 500], [99, 0, 0, 5]]));
  assert.equal(r.stats.valueLow, 2);
  assert.equal(r.stats.valueHigh, 8.5);
});

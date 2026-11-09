// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/mask.js'));
const { mask: MK } = globalThis.VST;
const close = (p, q, eps = 1e-6) => Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;
const square = { shape: 'custom', points: [[0, 0], [10, 0], [10, 10], [0, 10]] };

test('inside, outside and on the edge', () => {
  assert.ok(MK.contains(square.points, 5, 5));
  assert.ok(!MK.contains(square.points, 15, 5));
  assert.ok(MK.contains(square.points, 10, 5), 'on an edge counts as inside');
  assert.ok(MK.contains(square.points, 0, 0), 'and a corner');
});

test('a color outside moves to the nearest color inside', () => {
  assert.ok(close(MK.nearestInside(square.points, 15, 5), [10, 5]), 'straight across to the edge');
  assert.ok(close(MK.nearestInside(square.points, 13, 14), [10, 10]), 'or to the corner');
  assert.ok(close(MK.nearestInside(square.points, 4, 6), [4, 6]), 'inside stays put');
});

test('moving a picture keeps every value and only moves colors outside', () => {
  const lab = { L: Float32Array.from([30, 60, 90]), A: Float32Array.from([5, 20, -8]), B: Float32Array.from([5, 5, 5]) };
  const full = MK.apply(lab, square);
  assert.equal(full.L, lab.L, 'value is untouched');
  assert.deepEqual([...full.A], [5, 10, 0]);
  assert.deepEqual([...full.B], [5, 5, 5]);
  const half = MK.apply(lab, square, 0.5);
  assert.deepEqual([...half.A], [5, 15, -4], 'half strength goes half way');
  assert.deepEqual([...MK.apply(lab, square, 0).A], [...lab.A], 'no strength, no change');
});

test('every shape is a proper mask around a point on the wheel', () => {
  for (const shape of Object.keys(MK.SHAPES)) {
    const m = MK.make(shape, 70, 60);
    assert.equal(m.shape, shape);
    assert.ok(MK.valid(m), shape);
    assert.ok(Math.abs(MK.heading(m) - 70) < 15 || shape === 'complement', `${shape} points at its hue (${MK.heading(m)})`);
  }
  assert.ok(MK.contains(MK.make('triad', 0, 60).points, 0, 0), 'a shifted triad covers gray');
  assert.ok(!MK.contains(MK.make('atmospheric', 0, 60).points, -40, 0), 'an atmospheric mask stays near its hue and gray');
});

test('turning, sizing, moving and reshaping', () => {
  const m = MK.make('triad', 0, 50);
  const turned = MK.rotate(m, 90);
  assert.ok(Math.abs(MK.heading(turned) - 90) < 1e-6, 'turned 90°');
  const big = MK.scale(m, 2);
  assert.ok(close(MK.centroid(big.points), MK.centroid(m.points)), 'grows around its own center');
  assert.ok(Math.abs(Math.hypot(...big.points[0].map((v, i) => v - MK.centroid(m.points)[i])) - 2 * Math.hypot(...m.points[0].map((v, i) => v - MK.centroid(m.points)[i]))) < 1e-6);
  assert.ok(close(MK.move(m, 3, -2).points[1], [m.points[1][0] + 3, m.points[1][1] - 2]));
  const reshaped = MK.setCorner(m, 2, 1, 2);
  assert.equal(reshaped.shape, 'custom');
  assert.ok(close(reshaped.points[2], [1, 2]) && close(reshaped.points[0], m.points[0]));
});

test('how much of a picture is outside the mask', () => {
  const cells = [{ a: 5, b: 5, share: 0.6 }, { a: 30, b: 5, share: 0.3 }, { a: -9, b: 2, share: 0.1 }];
  const o = MK.outside(square.points, cells);
  assert.ok(Math.abs(o.outShare - 0.4) < 1e-9);
  assert.equal(o.outCells.length, 2);
});

test('settings that aren’t a mask are refused', () => {
  assert.equal(MK.valid(null), null);
  assert.equal(MK.valid({ points: [[0, 0], [1, 1]] }), null, 'too few corners');
  assert.equal(MK.valid({ points: [[0, 0], [1, 1], ['x', 2]] }), null);
  assert.deepEqual(MK.valid(square).points, square.points);
});

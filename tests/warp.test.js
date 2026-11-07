// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/warp.js'));
const W = globalThis.VST.warp;

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('homography maps each corner exactly', () => {
  const from = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const to = [[12, 7], [95, 20], [88, 70], [5, 60]];
  const H = W.homography(from, to);
  for (let i = 0; i < 4; i++) {
    const [x, y] = W.applyH(H, from[i][0], from[i][1]);
    assert.ok(near(x, to[i][0]) && near(y, to[i][1]), `corner ${i}`);
  }
});

test('degenerate corners (all in a line) are rejected', () => {
  assert.equal(W.homography([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [1, 1], [0, 1]]), null);
  assert.equal(W.isValidQuad([[0, 0], [10, 0], [0, 10], [10, 10]]), false, 'crossed corners');
  assert.equal(W.isValidQuad([[0, 0], [10, 0], [10, 10], [0, 10]]), true);
});

test('squares up a tilted, perspective-distorted checkerboard', () => {
  // draw a 2x2 checkerboard (black/white) inside a skewed quad of a 200x160 photo
  const sw = 200, sh = 160;
  const quad = [[30, 20], [170, 35], [160, 140], [40, 125]];
  const H = W.homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad); // unit square -> photo
  const Hinv = W.homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]); // photo -> unit square
  assert.ok(H && Hinv);
  const src = new Uint8ClampedArray(sw * sh * 4).fill(128); // gray background
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const [u, v] = W.applyH(Hinv, x + 0.5, y + 0.5);
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    const black = (u < 0.5) !== (v < 0.5);
    const i = (y * sw + x) * 4;
    src[i] = src[i + 1] = src[i + 2] = black ? 0 : 255;
    src[i + 3] = 255;
  }
  const ow = 80, oh = 60;
  const out = W.warpQuad(src, sw, sh, quad, ow, oh);
  const at = (x, y) => out[(y * ow + x) * 4];
  // each quadrant's center should be solid black or white, with no gray background
  assert.ok(at(20, 15) > 230, 'top-left white');
  assert.ok(at(60, 15) < 25, 'top-right black');
  assert.ok(at(20, 45) < 25, 'bottom-left black');
  assert.ok(at(60, 45) > 230, 'bottom-right white');
  // and the split between quadrants lands in the middle
  assert.ok(at(38, 15) > 200 && at(42, 15) < 55, 'vertical split at the center');
});

test('estimates the drawing proportions from its corners', () => {
  assert.ok(near(W.estimateAspect([[0, 0], [160, 0], [160, 200], [0, 200]]), 0.8));
  const r = W.estimateAspect([[10, 10], [170, 30], [165, 230], [5, 205]]);
  assert.ok(r > 0.7 && r < 0.9, `about 4:5, got ${r}`);
});

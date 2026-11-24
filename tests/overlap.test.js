// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/color.js'));
require(path.join(__dirname, '../js/palette.js'));
require(path.join(__dirname, '../js/overlap.js'));
const spectral = require(path.join(__dirname, '../js/vendor/spectral.js'));
const { palette: PAL, color: C, overlap: OV } = globalThis.VST;
const toLab = (r, g, b) => C.rgbToLab(r, g, b, [0, 0, 0]);
const hexLab = (hex) => toLab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));

// a picture of a few flat colors, with given shares
function picture(parts, n = 2000) {
  const img = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
  let i = 0;
  for (const [hex, share] of parts) {
    const lab = hexLab(hex);
    for (let j = 0; j < Math.round(n * share); j++, i++) [img.L[i], img.A[i], img.B[i]] = lab;
  }
  return img;
}
const zorn = PAL.build(['yellow-ochre', 'vermilion', 'ivory-black', 'titanium-white'], spectral, toLab);
const near = (model) => (L, a, b) => PAL.nearest(model, L, a, b);
const cellOf = (o, [, a, b]) => {
  const size = (2 * o.scale) / o.n;
  return Math.floor((o.scale - b) / size) * o.n + Math.floor((a + o.scale) / size);
};

test('a color the palette can mix is the picture’s but not a gap; one it can’t is both', () => {
  const tan = '#C9A46A'; // ochre and white
  const cyan = '#00B5D8'; // no blue in Zorn
  const img = picture([[tan, 0.7], [cyan, 0.3]]);
  const o = OV.compute(img, zorn, near(zorn));
  const kt = cellOf(o, hexLab(tan));
  const kc = cellOf(o, hexLab(cyan));
  assert.ok(o.pic[kt] && !o.gap[kt], 'tan: in the picture, in reach');
  assert.ok(o.pic[kc] && o.gap[kc], 'cyan: in the picture, out of reach');
  assert.ok(o.pal[kt * 3] >= 0, 'the palette mixes the tan’s hue and chroma');
  assert.ok(o.pal[kc * 3] < 0, 'but nothing near the cyan');
  assert.ok(Math.abs(o.outShare - 0.3) < 0.01, `30% is out of reach (${o.outShare})`);
  assert.ok(Math.abs(o.share[kt] - 0.7) < 0.01 && Math.abs(o.share[kc] - 0.3) < 0.01, 'each cell knows its share');
  assert.equal(o.pic.reduce((s, v) => s + v, 0), 2, 'only those two cells');
});

test('a value band keeps only those values, of the picture and the palette', () => {
  const img = picture([['#2B2620', 0.5], ['#EFE6D2', 0.5]]); // a dark and a light
  const darks = OV.compute(img, zorn, near(zorn), { band: 'darks' });
  const lights = OV.compute(img, zorn, near(zorn), { band: 'lights' });
  assert.ok(Math.abs(darks.shareIn - 0.5) < 0.01 && Math.abs(lights.shareIn - 0.5) < 0.01);
  assert.equal(darks.pic.reduce((s, v) => s + v, 0), 1);
  const middles = OV.compute(img, zorn, near(zorn), { band: 'middles' });
  assert.equal(middles.shareIn, 0);
  assert.equal(middles.pic.reduce((s, v) => s + v, 0), 0, 'no middle values in the picture');
  assert.ok(middles.pal.some((v) => v >= 0), 'but the palette still mixes middle values');
});

test('the wheel reaches as far as the strongest colors, within limits', () => {
  const grayish = OV.compute(picture([['#8A8580', 1]]), PAL.build(['ivory-black', 'titanium-white'], spectral, toLab), near(PAL.build(['ivory-black', 'titanium-white'], spectral, toLab)));
  assert.equal(grayish.scale, 30, 'a gray picture and palette still get a readable wheel');
  const strong = OV.compute(picture([['#00B5D8', 1]]), zorn, near(zorn));
  assert.ok(strong.scale > 40 && strong.scale <= 115, `strong colors widen it (${strong.scale})`);
});

test('solid() fills holes inside a region but not open bays', () => {
  const n = 7;
  // a ring of cells around the middle (a hole at 3,3) plus a bay open to the edge
  const ring = new Set();
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) if (r === 1 || r === 5 || c === 1 || c === 5) ring.add(r * n + c);
  ring.delete(1 * n + 3); // a gap in the top edge, so the inside is open to the outside at one cell
  const open = OV.solid((k) => ring.has(k), n, 0);
  assert.equal(open[3 * n + 3], 0, 'an inside reachable from the outside stays empty');
  ring.add(1 * n + 3);
  const closed = OV.solid((k) => ring.has(k), n, 0);
  assert.equal(closed[3 * n + 3], 1, 'a closed hole is filled');
  assert.equal(closed[0], 0, 'the outside stays empty');
  const grown = OV.solid((k) => k === 3 * n + 3, n, 1);
  assert.deepEqual([grown[3 * n + 3], grown[2 * n + 3], grown[3 * n + 4], grown[2 * n + 2]], [1, 1, 1, 0], 'grown by one cell, across edges only');
});

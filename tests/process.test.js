// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/color.js'));
require(path.join(__dirname, '../js/process.js'));
const { color: C, process: P } = globalThis.VST;

test('L* of black, mid gray and white', () => {
  const t = [0, 0, 0];
  assert.ok(Math.abs(C.rgbToLab(0, 0, 0, t)[0]) < 0.01);
  assert.ok(Math.abs(C.rgbToLab(255, 255, 255, t)[0] - 100) < 0.01);
  // sRGB 119 is close to L* 50 (middle value)
  assert.ok(Math.abs(C.rgbToLab(119, 119, 119, t)[0] - 50) < 0.5);
});

test('gray for an L* round-trips', () => {
  const t = [0, 0, 0];
  for (const L of [10, 30, 50, 70, 90]) {
    const g = C.lToGray8(L);
    assert.ok(Math.abs(C.rgbToLab(g, g, g, t)[0] - L) < 0.6, `L=${L}`);
  }
});

test('Lab -> RGB keeps lightness when chroma must be reduced', () => {
  const t = [0, 0, 0];
  // a very saturated red forced to a high value is out of gamut
  const rgb = C.labToRgb8(90, 80, 70, [0, 0, 0]);
  assert.ok(Math.abs(C.rgbToLab(rgb[0], rgb[1], rgb[2], t)[0] - 90) < 1.5);
});

test('yellow and blue of different values land in different bands', () => {
  // a 2-pixel image: bright yellow, dark blue
  const rgba = new Uint8ClampedArray([255, 230, 0, 255, 20, 30, 120, 255]);
  const lab = P.computeLab(rgba, 2);
  const out = new Uint8ClampedArray(8);
  const levels = P.bandLevels('even', 2, [50], null);
  const share = P.renderValues(lab, [50], levels, false, out);
  assert.deepEqual(share, [0.5, 0.5]);
  assert.ok(out[0] > out[4], 'yellow should be the light band');
});

test('thresholds stay ordered and in range', () => {
  assert.deepEqual(P.sanitizeThresholds([80, 20, 50], 4), [80, 81, 82]);
  assert.deepEqual(P.sanitizeThresholds(null, 4), [25, 50, 75]);
  const t = P.sanitizeThresholds([0, 0, 0, 0, 0], 6);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
  assert.ok(t[0] >= 1 && t[t.length - 1] <= 99);
});

test('auto thresholds find the gap between two value clusters', () => {
  const hist = new Uint32Array(101);
  hist[20] = 500;
  hist[22] = 500;
  hist[78] = 500;
  hist[80] = 500;
  const [t] = P.autoThresholds(hist, 2);
  assert.ok(t > 30 && t < 70, `got ${t}`);
});

test('band average levels match pixel values', () => {
  const hist = new Uint32Array(101);
  hist[20] = 10;
  hist[80] = 10;
  const lv = P.bandLevels('average', 2, [50], hist);
  assert.deepEqual(lv.map(Math.round), [20, 80]);
});

test('blur smooths a hard edge and preserves the mean', () => {
  const w = 40, h = 20, L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = x < w / 2 ? 0 : 100;
  const b = P.gaussianBlur(L, w, h, 3);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.abs(mean(b) - mean(L)) < 0.5);
  const mid = b[10 * w + w / 2];
  assert.ok(mid > 20 && mid < 80, `edge value ${mid}`);
  assert.ok(b[10 * w] < 1 && b[10 * w + w - 1] > 99);
});

test('main colors finds the distinct colors in an image', () => {
  const colors = [[200, 30, 30], [30, 60, 200], [240, 240, 220]];
  const n = 300, rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) rgba.set([...colors[i % 3], 255], i * 4);
  const lab = P.computeLab(rgba, n);
  const cents = P.kmeans(lab, 3);
  assert.equal(cents.length, 3);
  for (let i = 1; i < 3; i++) assert.ok(cents[i][0] >= cents[i - 1][0], 'sorted dark to light');
  const out = new Uint8ClampedArray(n * 4);
  const share = P.renderPoster(lab, cents, true, out);
  share.forEach((s) => assert.ok(Math.abs(s - 1 / 3) < 1e-9));
  assert.ok(Math.abs(out[0] - 200) <= 2 && Math.abs(out[1] - 30) <= 2);
});

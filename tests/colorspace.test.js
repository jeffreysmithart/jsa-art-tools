// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/color.js'));
require(path.join(__dirname, '../js/colorspace.js'));
const { colorspace: CS, color: C } = globalThis.VST;

const lab = (rows) => ({ L: Float32Array.from(rows.map((r) => r[0])), A: Float32Array.from(rows.map((r) => r[1])), B: Float32Array.from(rows.map((r) => r[2])) });

test('colors are counted into 3D cells that keep value apart', () => {
  // same hue and chroma, different value: two cells, not one
  const cells = CS.sample(lab([[30, 20, 20], [30.5, 20.4, 19.8], [70, 20, 20], [70, 20, 20]]));
  assert.equal(cells.length, 2);
  const dark = cells.find((c) => c.L < 50);
  assert.equal(dark.share, 0.5);
  assert.ok(Math.abs(dark.L - 30.25) < 1e-4);
});

test('the screen solid has its corners: black, white and the primaries', () => {
  const shell = CS.solidShell((r, g, b) => C.rgbToLab(r, g, b, [0, 0, 0]), 4);
  const has = (rgb) => shell.some((p) => p.rgb.join() === rgb.join());
  for (const rgb of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]) assert.ok(has(rgb), rgb.join());
  // only the surface: no point strictly inside the cube
  assert.ok(shell.every((p) => p.rgb.some((v) => v === 0 || v === 255)));
  assert.equal(new Set(shell.map((p) => p.rgb.join())).size, shell.length, 'no duplicates');
});

test('Munsell-style readings: value, chroma and principal hue', () => {
  const gray = CS.munsell(52, 1, -1);
  assert.equal(gray.hue, 'N');
  assert.equal(gray.value, 5);
  assert.equal(gray.chroma, 0);
  const [L, a, b] = C.rgbToLab(200, 40, 30, [0, 0, 0]); // a strong red
  const red = CS.munsell(L, a, b);
  assert.equal(red.hue, 'R');
  assert.ok(red.chroma >= 10, `strong red chroma ${red.chroma}`);
  const [L2, a2, b2] = C.rgbToLab(60, 90, 200, [0, 0, 0]); // a blue
  assert.ok(['B', 'PB'].includes(CS.munsell(L2, a2, b2).hue));
  assert.equal(CS.munsell(...C.rgbToLab(230, 200, 40, [0, 0, 0])).hue, 'Y');
});

test('the camera: looking down shows yellow up, from the side value goes up', () => {
  const top = CS.projector({ yaw: 0, pitch: 90, zoom: 1 }, 500, 500);
  const [, yYellow] = top(50, 0, 60);
  const [, yBlue] = top(50, 0, -60);
  assert.ok(yYellow < yBlue, 'yellow above blue from the top');
  const side = CS.projector({ yaw: 0, pitch: 0, zoom: 1 }, 500, 500);
  assert.ok(side(90, 0, 0)[1] < side(10, 0, 0)[1], 'light above dark from the side');
  assert.equal(side(50, 0, 0)[0], 250, 'the gray axis is in the middle');
});

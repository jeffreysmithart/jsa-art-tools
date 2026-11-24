// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../js/compose.js'));
const CO = globalThis.VST.compose;

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

test('rule of thirds: two verticals and two horizontals', () => {
  const ls = CO.lines({ thirds: true }, 900, 600);
  assert.equal(ls.length, 4);
  assert.deepEqual(ls.filter((l) => l[0] === l[2]).map((l) => l[0]), [300, 600]);
  assert.deepEqual(ls.filter((l) => l[1] === l[3]).map((l) => l[1]), [200, 400]);
  assert.equal(CO.points({ thirds: true }, 900, 600).length, 4);
});

test('golden section lines sit at 0.382 and 0.618', () => {
  const xs = CO.lines({ golden: true }, 1000, 500).filter((l) => l[0] === l[2]).map((l) => l[0]);
  near(xs[0], 381.966, 'first', 1e-3);
  near(xs[1], 618.034, 'second', 1e-3);
});

test('reciprocals meet the diagonals at right angles and end on an edge', () => {
  const W = 900;
  const H = 600;
  const ls = CO.lines({ diag: true }, W, H);
  assert.equal(ls.length, 6, 'two diagonals and four reciprocals');
  const [, , ...recips] = ls;
  for (const [x1, y1, x2, y2] of recips) {
    const onEdge = [x2, y2].some((v, i) => Math.abs(v) < 1e-6 || Math.abs(v - (i ? H : W)) < 1e-6);
    assert.ok(onEdge, `ends on an edge (${x2}, ${y2})`);
    assert.ok(x2 >= -1e-6 && x2 <= W + 1e-6 && y2 >= -1e-6 && y2 <= H + 1e-6, 'stays inside');
  }
  // the reciprocal from the top-right corner is perpendicular to the main diagonal
  const [x1, y1, x2, y2] = recips[0];
  near((x2 - x1) * W + (y2 - y1) * H, 0, 'dot product with (W, H)');
});

test('crossing lines go through where reciprocals meet the diagonals', () => {
  const W = 900;
  const H = 600;
  const [a, b] = CO.crossFractions(W, H);
  near(a, (H * H) / (W * W + H * H), 'smaller fraction');
  near(a + b, 1, 'symmetric');
  // the foot of the perpendicular from (W, 0) onto the diagonal (0,0)-(W,H)
  const t = (W * W) / (W * W + H * H);
  const pts = CO.points({ cross: true }, W, H);
  assert.ok(pts.some(([x, y]) => Math.abs(x - W * t) < 1e-6 && Math.abs(y - H * t) < 1e-6));
  assert.equal(CO.lines({ cross: true }, W, H).length, 4);
  // a square collapses to the center lines
  assert.deepEqual(CO.lines({ cross: true }, 100, 100), [[50, 0, 50, 100], [0, 50, 100, 50]]);
});

test('nothing chosen draws nothing', () => {
  assert.equal(CO.any({}), false);
  assert.equal(CO.lines({}, 100, 100).length, 0);
  assert.equal(CO.any({ golden: true }), true);
});

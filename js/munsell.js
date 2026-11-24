/*
 * Munsell notation (hue value/chroma, e.g. 7.5R 5.2/14) from the Munsell
 * renotation data (data/munsell-renotation.js), instead of the Lab
 * approximation in js/colorspace.js.
 *
 * How a color is read:
 * - Lab (the app's D65 white) becomes CIE XYZ, then is adapted to
 *   Illuminant C (Bradford), the white the renotation data was measured
 *   under, and split into chromaticity x, y and luminance Y.
 * - Value comes from Y with the ASTM D1535 value function.
 * - Hue and chroma come from x, y: the data gives x, y for each hue (in
 *   2.5 steps) and chroma (in 2 steps) at values 1-9. Between them, points
 *   are interpolated around the white point (angle and distance), and
 *   between values in x, y. A short search finds the hue and chroma whose
 *   point matches the color.
 * - Beyond the data (values under 1 or over 9, or chroma past the last
 *   step a value has), the nearest plane is used or the last two steps
 *   are extended, so those readings are less exact.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const FAMILIES = [
    ['R', 'red'],
    ['YR', 'orange'],
    ['Y', 'yellow'],
    ['GY', 'yellow-green'],
    ['G', 'green'],
    ['BG', 'blue-green'],
    ['B', 'blue'],
    ['PB', 'purple-blue'],
    ['P', 'purple'],
    ['RP', 'red-purple'],
  ];
  const WHITE_C = [0.31006, 0.31616]; // Illuminant C chromaticity (2°)
  const XYZ_D65 = [0.95047, 1, 1.08883];
  const XYZ_C = [0.98074, 1, 1.18232];
  const NEUTRAL = 0.5; // chroma under this reads as N

  /* ---------- white adaptation (Bradford) ---------- */

  const M = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
  ];
  const mul = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const mmul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  function inv3(m) {
    const [a, b, c] = m[0];
    const [d, e, f] = m[1];
    const [g, h, i] = m[2];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ];
  }
  function adapter(from, to) {
    const s = mul(M, from);
    const d = mul(M, to);
    const D = [
      [d[0] / s[0], 0, 0],
      [0, d[1] / s[1], 0],
      [0, 0, d[2] / s[2]],
    ];
    return mmul(inv3(M), mmul(D, M));
  }
  const D65_TO_C = adapter(XYZ_D65, XYZ_C);
  const C_TO_D65 = adapter(XYZ_C, XYZ_D65);

  /* ---------- Lab <-> XYZ ---------- */

  const EPS = 216 / 24389;
  const KAPPA = 24389 / 27;
  const finv = (t) => (t * t * t > EPS ? t * t * t : (116 * t - 16) / KAPPA);
  const fwd = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  function labToXyz(L, a, b) {
    const fy = (L + 16) / 116;
    const y = L > 8 ? fy * fy * fy : L / KAPPA;
    return [finv(fy + a / 500) * XYZ_D65[0], y, finv(fy - b / 200) * XYZ_D65[2]];
  }
  function xyzToLab([X, Y, Z]) {
    const fx = fwd(X / XYZ_D65[0]);
    const fy = fwd(Y);
    const fz = fwd(Z / XYZ_D65[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /* ---------- value (ASTM D1535) ---------- */

  /** Luminance Y (white = 100) of Munsell value V. */
  function valueToY(V) {
    return V * (1.1914 + V * (-0.22533 + V * (0.23352 + V * (-0.020484 + V * 0.00081939))));
  }
  /** Munsell value of luminance Y (white = 100), by bisection. */
  function yToValue(Y) {
    if (Y <= 0) return 0;
    let lo = 0;
    let hi = 10.5;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (valueToY(mid) < Y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---------- the renotation data, around the white point ---------- */

  let planes = null; // per value: per hue: [[angle, distance], ...] for chroma 2, 4, ...
  let values = null;
  function load() {
    if (planes) return true;
    const d = VST.munsellData;
    if (!d) return false;
    values = d.values;
    planes = d.loci.map((plane) =>
      plane.map((pts) => {
        const out = [];
        for (let k = 0; k < pts.length; k += 2) {
          const dx = pts[k] / 10000 - WHITE_C[0];
          const dy = pts[k + 1] / 10000 - WHITE_C[1];
          out.push([Math.atan2(dy, dx), Math.hypot(dx, dy)]);
        }
        return out;
      })
    );
    return true;
  }

  const wrap = (t) => t - 2 * Math.PI * Math.round(t / (2 * Math.PI));

  /** [angle, distance] of hue index h at chroma C on one value plane. */
  function locus(plane, h, C) {
    const pts = plane[h];
    const k = C / 2; // 1 = the first step (chroma 2)
    if (k <= 1) return [pts[0][0], pts[0][1] * Math.max(0, k)];
    const n = pts.length;
    let i = Math.min(Math.floor(k), n - 1); // between steps i and i + 1 (1-based)
    if (i < 1) i = 1;
    const p = pts[i - 1];
    const q = pts[Math.min(i, n - 1)];
    if (n === 1) return [p[0], p[1] * k];
    const t = k - i;
    return [p[0] + wrap(q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  }

  /** x, y of hue H (0-100, Munsell hue number) and chroma C on one value plane. */
  function planeXy(plane, H, C) {
    const pos = (((H % 100) + 100) % 100) / 2.5;
    const i0 = Math.floor(pos) % 40;
    const i1 = (i0 + 1) % 40;
    const t = pos - Math.floor(pos);
    const a = locus(plane, i0, C);
    const b = locus(plane, i1, C);
    const ang = a[0] + wrap(b[0] - a[0]) * t;
    const dist = a[1] + (b[1] - a[1]) * t;
    return [WHITE_C[0] + dist * Math.cos(ang), WHITE_C[1] + dist * Math.sin(ang)];
  }

  /** x, y of Munsell H V/C (Illuminant C), interpolating between value planes. */
  function toXy(H, V, C) {
    const lo = values[0];
    const hi = values[values.length - 1];
    const v = Math.max(lo, Math.min(hi, V));
    const j = Math.min(values.length - 2, Math.floor(v - lo));
    const t = v - lo - j;
    const p = planeXy(planes[j], H, C);
    if (t <= 0) return p;
    const q = planeXy(planes[j + 1], H, C);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  }

  /** The hue and chroma whose point at value V is x, y. */
  function solve(x, y, V) {
    // a coarse look over the hue steps and even chromas, then Newton steps
    let best = null;
    let bestD = Infinity;
    for (let h = 0; h < 40; h++) {
      for (let C = 0; C <= 40; C += 2) {
        const [px, py] = toXy(h * 2.5, V, C);
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [h * 2.5, C];
        }
      }
    }
    let [H, C] = best;
    for (let it = 0; it < 40; it++) {
      C = Math.max(C, 0.05); // hue is undefined at the white point itself
      const [px, py] = toXy(H, V, C);
      const rx = x - px;
      const ry = y - py;
      if (rx * rx + ry * ry < 1e-14) break;
      const e = 1e-3;
      const [hx, hy] = toXy(H + e, V, C);
      const [cx, cy] = toXy(H, V, C + e);
      const j11 = (hx - px) / e;
      const j21 = (hy - py) / e;
      const j12 = (cx - px) / e;
      const j22 = (cy - py) / e;
      const det = j11 * j22 - j12 * j21;
      if (!det) break;
      let dH = (j22 * rx - j12 * ry) / det;
      let dC = (-j21 * rx + j11 * ry) / det;
      // don't jump more than a hue page or a few chroma steps at once
      const s = Math.min(1, 2.5 / Math.abs(dH || 1e-9), 4 / Math.abs(dC || 1e-9));
      H = (((H + dH * s) % 100) + 100) % 100;
      C = Math.max(0, C + dC * s);
    }
    return [H, C];
  }

  /* ---------- reading a color ---------- */

  /**
   * Munsell hue, value and chroma of a Lab color (the app's D65 white),
   * or null if the renotation data isn't loaded. hue is 0-100 (the Munsell
   * hue number: 2.5R = 2.5, 10R = 10, 2.5YR = 12.5, … 10RP = 100 = 0), or
   * null for a neutral.
   */
  function fromLab(L, a, b) {
    if (!load()) return null;
    const [X, Y, Z] = mul(D65_TO_C, labToXyz(L, a, b));
    const V = yToValue(Y * 100);
    const sum = X + Y + Z;
    if (!(sum > 0)) return { hue: null, value: 0, chroma: 0 };
    const x = X / sum;
    const y = Y / sum;
    if (Math.hypot(x - WHITE_C[0], y - WHITE_C[1]) < 1e-4) return { hue: null, value: V, chroma: 0 };
    const [H, C] = solve(x, y, V);
    if (C < NEUTRAL) return { hue: null, value: V, chroma: C };
    return { hue: H, value: V, chroma: C };
  }

  /** Lab (D65) of Munsell H V/C, or null without the data. */
  function toLab(H, V, C) {
    if (!load()) return null;
    const Y = valueToY(V) / 100;
    const [x, y] = C > 0 ? toXy(H, V, C) : WHITE_C;
    const XYZc = [(x * Y) / y, Y, ((1 - x - y) * Y) / y];
    return xyzToLab(mul(C_TO_D65, XYZc));
  }

  /** The hue family of hue number H: { code, name, step } with step in (0, 10]. */
  function family(H) {
    let h = Math.round(H * 10) / 10;
    if (h <= 0) h += 100;
    if (h > 100) h -= 100;
    const f = Math.ceil(h / 10) - 1;
    return { code: FAMILIES[f][0], name: FAMILIES[f][1], step: Math.round((h - f * 10) * 10) / 10 };
  }

  const trim = (n, d) => String(Math.round(n * 10 ** d) / 10 ** d);

  /** A reading as notation: "7.9R 5.2/14", or "N 5.2/" for a neutral. */
  function notation(m) {
    const v = trim(m.value, 1);
    if (m.hue == null) return `N ${v}/`;
    const f = family(m.hue);
    return `${trim(f.step, 1)}${f.code} ${v}/${trim(m.chroma, m.chroma < 2 ? 1 : 0)}`;
  }

  VST.munsellExact = { fromLab, toLab, notation, family, valueToY, yToValue, available: () => load(), FAMILIES };
})(typeof window !== 'undefined' ? window : globalThis);

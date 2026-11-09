/*
 * Gamut masks, the color-scheme technique James Gurney popularized: a
 * shape on the hue/chroma wheel (the CIE Lab a*b* plane, as in the gamut
 * overlap wheel), and the picture painted only with the colors inside it.
 * The shape's corners are the scheme's strongest colors.
 *
 * A mask is { shape, points: [[a, b], …] } (a polygon in Lab a, b; value
 * isn't part of it). Moving a color into the mask keeps its value (L*), so
 * value studies are unchanged; only hue and chroma move, to the nearest
 * color inside (or part of the way there, with `strength` under 1).
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const deg = (d) => (d * Math.PI) / 180;
  const at = (angle, r) => [Math.cos(deg(angle)) * r, Math.sin(deg(angle)) * r];

  /** The starting shapes: a name, and corners as [angle offset, share of the size]. */
  const SHAPES = {
    triad: { name: 'Shifted triad', corners: [[0, 1], [125, 0.6], [-125, 0.6]] },
    complement: { name: 'Complementary', corners: [[0, 1], [90, 0.22], [180, 1], [-90, 0.22]] },
    analogous: { name: 'Analogous wedge', corners: [[-32, 1], [0, 1.05], [32, 1], [180, 0.14]] },
    atmospheric: { name: 'Atmospheric', corners: [[0, 0.5], [130, 0.32], [-130, 0.32]] },
  };

  /** A mask of one of the shapes, pointing at Lab hue angle `angle`, `size` chroma out. */
  function make(shape = 'triad', angle = 60, size = 60) {
    const s = SHAPES[shape] || SHAPES.triad;
    return { shape: SHAPES[shape] ? shape : 'triad', points: s.corners.map(([d, k]) => at(angle + d, size * k)) };
  }

  /** Whether a, b is inside the polygon (even–odd rule; on an edge counts as inside). */
  function contains(points, a, b) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (onSegment(xi, yi, xj, yj, a, b)) return true;
      if (yi > b !== yj > b && a < ((xj - xi) * (b - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function onSegment(x1, y1, x2, y2, px, py) {
    const [qx, qy] = closestOnSegment(x1, y1, x2, y2, px, py);
    return Math.hypot(qx - px, qy - py) < 1e-9;
  }
  function closestOnSegment(x1, y1, x2, y2, px, py) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    return [x1 + t * dx, y1 + t * dy];
  }

  /** The nearest a, b inside the mask (itself if it's already inside). */
  function nearestInside(points, a, b) {
    if (contains(points, a, b)) return [a, b];
    let best = null;
    let bestD = Infinity;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const q = closestOnSegment(points[j][0], points[j][1], points[i][0], points[i][1], a, b);
      const d = (q[0] - a) ** 2 + (q[1] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best || [a, b];
  }

  /**
   * The picture moved into the mask: a new { L, A, B } (L shared, not
   * copied), each color outside moved `strength` (0–1) of the way to the
   * nearest color inside. Colors are worked out once per small a, b cell,
   * so a large picture is quick.
   */
  function apply(lab, mask, strength = 1) {
    const n = lab.L.length;
    const A = new Float32Array(n);
    const B = new Float32Array(n);
    const cache = new Map();
    const pts = mask.points;
    for (let i = 0; i < n; i++) {
      const a = lab.A[i];
      const b = lab.B[i];
      // a quarter-unit grid: far finer than a visible difference
      const key = Math.round(a * 4) * 4096 + Math.round(b * 4);
      let m = cache.get(key);
      if (!m) {
        const [na, nb] = nearestInside(pts, a, b);
        m = [na - a, nb - b];
        cache.set(key, m);
      }
      A[i] = a + m[0] * strength;
      B[i] = b + m[1] * strength;
    }
    return { L: lab.L, A, B };
  }

  /** How much of the picture's colors (cells: { a, b, share }) are outside the mask: { outShare, outCells }. */
  function outside(points, cells) {
    let outShare = 0;
    const outCells = [];
    for (const c of cells) {
      if (contains(points, c.a, c.b)) continue;
      outShare += c.share;
      outCells.push(c);
    }
    return { outShare, outCells };
  }

  /* ---------- reshaping ---------- */

  const centroid = (points) => [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];

  /** The mask turned `degrees` around the gray center (counterclockwise in a, b). */
  function rotate(mask, degrees) {
    const c = Math.cos(deg(degrees));
    const s = Math.sin(deg(degrees));
    return { ...mask, points: mask.points.map(([a, b]) => [a * c - b * s, a * s + b * c]) };
  }
  /** The mask grown or shrunk by `factor` around its own center. */
  function scale(mask, factor) {
    const [ca, cb] = centroid(mask.points);
    return { ...mask, points: mask.points.map(([a, b]) => [ca + (a - ca) * factor, cb + (b - cb) * factor]) };
  }
  /** The mask moved by da, db. */
  function move(mask, da, db) {
    return { ...mask, points: mask.points.map(([a, b]) => [a + da, b + db]) };
  }
  /** The mask with one corner moved to a, b. */
  function setCorner(mask, i, a, b) {
    return { ...mask, shape: 'custom', points: mask.points.map((p, k) => (k === i ? [a, b] : p)) };
  }
  /** The hue angle (Lab degrees) the mask points at: toward its strongest corner. */
  function heading(mask) {
    const p = mask.points.reduce((m, q) => (Math.hypot(q[0], q[1]) > Math.hypot(m[0], m[1]) ? q : m));
    return ((Math.atan2(p[1], p[0]) * 180) / Math.PI + 360) % 360;
  }
  /** A mask read back from settings, or null if it isn't one. */
  function valid(mask) {
    if (!mask || !Array.isArray(mask.points) || mask.points.length < 3 || mask.points.length > 12) return null;
    if (!mask.points.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v) && Math.abs(v) < 200))) return null;
    return { shape: typeof mask.shape === 'string' ? mask.shape : 'custom', points: mask.points.map((p) => [p[0], p[1]]) };
  }

  VST.mask = { SHAPES, make, contains, nearestInside, apply, outside, rotate, scale, move, setCorner, heading, centroid, valid };
})(typeof window !== 'undefined' ? window : globalThis);

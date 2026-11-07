/*
 * Color gamut view: where a picture's colors sit on a color wheel.
 *
 * The wheel is the CIE Lab a*b* plane seen from above: hue goes around
 * (yellow at the top, red to the right, blue at the bottom, green to the
 * left) and saturation (chroma) goes outward from neutral gray at the
 * center. Value (L*) isn't shown; the value study covers that.
 *
 * Colors are counted in a grid of small cells, so a large image draws
 * quickly. The gamut is the convex outline around the cells that cover a
 * meaningful share of the picture, so a few stray pixels don't stretch it.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const SCALE = 80; // chroma at the rim (stronger colors sit on the rim)
  const CELLS = 80; // grid cells across the wheel
  const MIN_SHARE = 0.0005; // a cell needs 0.05% of the picture to shape the gamut
  const NEUTRAL = 8; // chroma below this reads as gray

  /**
   * Counts the colors of a Lab image ({ L, A, B } arrays) into wheel cells.
   * Returns { cells, hull, stats }. Each cell: { a, b, L, share } with the
   * average color of its pixels.
   */
  function analyze(lab, { scale = SCALE, cells: n = CELLS, minShare = MIN_SHARE } = {}) {
    const len = lab.L.length;
    const size = (2 * scale) / n;
    const count = new Float64Array(n * n);
    const sumL = new Float64Array(n * n);
    const sumA = new Float64Array(n * n);
    const sumB = new Float64Array(n * n);
    const clampCell = (v) => Math.min(n - 1, Math.max(0, Math.floor((v + scale) / size)));
    // the chroma of every pixel, for the "most saturated" figure
    const chromaHist = new Float64Array(201);
    let neutral = 0;
    let hx = 0;
    let hy = 0;
    for (let i = 0; i < len; i++) {
      const a = lab.A[i];
      const b = lab.B[i];
      const k = clampCell(b) * n + clampCell(a);
      count[k]++;
      sumL[k] += lab.L[i];
      sumA[k] += a;
      sumB[k] += b;
      const c = Math.hypot(a, b);
      chromaHist[Math.min(200, Math.round(c))]++;
      if (c < NEUTRAL) neutral++;
      else {
        // hue average weighted by chroma, so strong colors count for more
        hx += a;
        hy += b;
      }
    }
    const cells = [];
    for (let k = 0; k < n * n; k++) {
      if (!count[k]) continue;
      cells.push({ a: sumA[k] / count[k], b: sumB[k] / count[k], L: sumL[k] / count[k], share: count[k] / len });
    }
    const hull = convexHull(cells.filter((c) => c.share >= minShare).map((c) => [c.a, c.b]));
    // the chroma that only 2% of the picture goes beyond
    let acc = 0;
    let p98 = 0;
    for (let c = 0; c <= 200; c++) {
      acc += chromaHist[c];
      if (acc >= len * 0.98) {
        p98 = c;
        break;
      }
    }
    const colored = len - neutral;
    const hue = colored > 0 && Math.hypot(hx, hy) > 1e-6 ? ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360 : null;
    return {
      cells,
      hull,
      stats: {
        neutralShare: len ? neutral / len : 0,
        strongChroma: p98,
        hue,
        hueName: hue == null ? null : hueName(hue),
        area: polygonArea(hull) / (Math.PI * scale * scale), // share of the wheel the gamut covers
      },
    };
  }

  /** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated end point. */
  function convexHull(points) {
    const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  function polygonArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  }

  /** A painter's name for a Lab hue angle (approximate). */
  function hueName(h) {
    const names = [
      [20, 'red-violet'],
      [45, 'red'],
      [70, 'orange'],
      [95, 'yellow'],
      [125, 'yellow-green'],
      [165, 'green'],
      [215, 'blue-green'],
      [285, 'blue'],
      [330, 'violet'],
      [360, 'red-violet'],
    ];
    return names.find(([max]) => h < max)[1];
  }

  /** A plain description of how strong the colors get. */
  function strength(chroma) {
    if (chroma < 15) return 'nearly gray';
    if (chroma < 30) return 'muted';
    if (chroma < 55) return 'moderate';
    return 'strong';
  }

  /**
   * Draws the wheel. `toRgb(L, a, b)` returns [r, g, b] 0–255.
   * Options: hull (outline the gamut), marks (main colors as { L, a, b }).
   */
  function draw(ctx, data, sizePx, toRgb, { scale = SCALE, hull = true, marks = [], dpr = 1 } = {}) {
    const ring = 10 * dpr; // the hue ring around the edge
    const cx = sizePx / 2;
    const cy = sizePx / 2;
    const R = sizePx / 2 - ring - 3 * dpr;
    const at = (a, b) => [cx + (a / scale) * R, cy - (b / scale) * R];
    ctx.clearRect(0, 0, sizePx, sizePx);
    // hue ring: each hue at a middle value and full strength
    for (let d = 0; d < 360; d += 2) {
      const t0 = (-(d - 1) * Math.PI) / 180;
      const t1 = (-(d + 1.5) * Math.PI) / 180;
      const h = (d * Math.PI) / 180;
      const [r, g, b] = toRgb(65, Math.cos(h) * 70, Math.sin(h) * 70);
      ctx.beginPath();
      ctx.arc(cx, cy, R + ring, t0, t1, true);
      ctx.arc(cx, cy, R + 1 * dpr, t1, t0, false);
      ctx.closePath();
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();
    }
    // neutral middle-gray disc, so both dark and light colors show
    const [gr] = toRgb(50, 0, 0);
    ctx.fillStyle = `rgb(${gr},${gr},${gr})`;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    // chroma rings at a quarter, half and three quarters of the way out
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1 * dpr;
    for (const c of [0.25, 0.5, 0.75].map((f) => f * scale)) {
      ctx.beginPath();
      ctx.arc(cx, cy, (c / scale) * R, 0, Math.PI * 2);
      ctx.stroke();
    }
    // colors: bigger dots for colors that cover more of the picture
    const maxShare = data.cells.reduce((m, c) => Math.max(m, c.share), 0) || 1;
    const cellPx = (2 * R) / CELLS;
    const sorted = data.cells.slice().sort((p, q) => p.share - q.share);
    for (const c of sorted) {
      const [x, y] = at(c.a, c.b);
      const k = Math.sqrt(c.share / maxShare);
      const r = Math.max(1.2 * dpr, cellPx * (0.6 + 2.6 * k));
      const [cr, cg, cb] = toRgb(c.L, c.a, c.b);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hull && data.hull.length >= 3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.beginPath();
      data.hull.forEach(([a, b], i) => {
        const [x, y] = at(a, b);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    for (const m of marks) {
      const [x, y] = at(m.a, m.b);
      const [mr, mg, mb] = toRgb(m.L, m.a, m.b);
      ctx.beginPath();
      ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, 8.5 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  VST.gamut = { analyze, convexHull, polygonArea, hueName, strength, draw, SCALE, NEUTRAL };
})(typeof window !== 'undefined' ? window : globalThis);

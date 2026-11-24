/*
 * Composition guides: lines that help place the big shapes when choosing a
 * crop or planning a painting. Separate from the grid, which is for
 * transferring a picture square by square.
 *
 *   thirds    the rule of thirds
 *   golden    golden-section lines (0.382 and 0.618 of each side)
 *   diag      both corner-to-corner diagonals, plus the reciprocals: from each
 *             other corner, the line at a right angle to a diagonal
 *   cross     verticals and horizontals through the four points where the
 *             reciprocals meet the diagonals (a classic way to find strong
 *             places for edges and the center of interest)
 *
 * All geometry is in the caller's pixels: a W x H rectangle at (x, y).
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const PHI = (Math.sqrt(5) - 1) / 2; // 0.618…
  const KINDS = ['thirds', 'golden', 'diag', 'cross'];

  /** Where a ray from (px, py) along (dx, dy) leaves the W x H rectangle. */
  function exitPoint(px, py, dx, dy, W, H) {
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (W - px) / dx);
    if (dx < 0) t = Math.min(t, -px / dx);
    if (dy > 0) t = Math.min(t, (H - py) / dy);
    if (dy < 0) t = Math.min(t, -py / dy);
    return [px + dx * t, py + dy * t];
  }

  /**
   * Where the reciprocals meet the diagonals, as fractions of each side.
   * For a W x H rectangle these are W²/(W²+H²) and H²/(W²+H²), along both axes.
   */
  function crossFractions(W, H) {
    const a = (W * W) / (W * W + H * H);
    return [Math.min(a, 1 - a), Math.max(a, 1 - a)];
  }

  /** Line segments [x1, y1, x2, y2] for the chosen guides, in a W x H box at the origin. */
  function lines(opts, W, H) {
    const out = [];
    const vh = (fx) => {
      for (const f of fx) {
        out.push([W * f, 0, W * f, H]);
        out.push([0, H * f, W, H * f]);
      }
    };
    if (opts.thirds) vh([1 / 3, 2 / 3]);
    if (opts.golden) vh([1 - PHI, PHI]);
    if (opts.diag) {
      out.push([0, 0, W, H], [W, 0, 0, H]);
      // reciprocals of the diagonal (0,0)-(W,H), from the other two corners
      out.push([W, 0, ...exitPoint(W, 0, -H, W, W, H)]);
      out.push([0, H, ...exitPoint(0, H, H, -W, W, H)]);
      // reciprocals of the diagonal (W,0)-(0,H)
      out.push([0, 0, ...exitPoint(0, 0, H, W, W, H)]);
      out.push([W, H, ...exitPoint(W, H, -H, -W, W, H)]);
    }
    if (opts.cross) {
      const f = crossFractions(W, H);
      // a square has a single crossing (the center); don't draw it twice
      vh(Math.abs(f[1] - f[0]) < 1e-6 ? [0.5] : f);
    }
    return out;
  }

  /** Points of interest [x, y]: where thirds, golden lines or diagonal crossings meet. */
  function points(opts, W, H) {
    const out = [];
    const grid = (fx) => {
      for (const fy of fx) for (const f of fx) out.push([W * f, H * fy]);
    };
    if (opts.thirds) grid([1 / 3, 2 / 3]);
    if (opts.golden) grid([1 - PHI, PHI]);
    if (opts.diag || opts.cross) {
      const [a, b] = crossFractions(W, H);
      // the four feet of the reciprocals on the diagonals
      out.push([W * a, H * a], [W * b, H * b], [W * b, H * a], [W * a, H * b]);
    }
    return out;
  }

  function any(opts) {
    return KINDS.some((k) => opts && opts[k]);
  }

  /**
   * Draws the guides into a rectangle. `color` is an "r,g,b" string,
   * `alpha` 0..1, `lineWidth` in canvas pixels.
   */
  function draw(ctx, opts, x, y, W, H, { color = '255,255,255', alpha = 0.7, lineWidth = 1, dots = true } = {}) {
    if (!any(opts)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = `rgba(${color},${alpha})`;
    ctx.fillStyle = `rgba(${color},${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines(opts, W, H)) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    if (dots) {
      const r = Math.max(2.5, lineWidth * 2.5);
      for (const [px, py] of points(opts, W, H)) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  VST.compose = { KINDS, lines, points, draw, any, crossFractions, exitPoint, PHI };
})(typeof window !== 'undefined' ? window : globalThis);

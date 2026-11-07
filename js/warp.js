/*
 * Perspective correction ("square up"): maps any four-cornered shape in a
 * photo (e.g. a sketchbook page shot at an angle) onto a straight rectangle.
 * Pure functions over typed arrays, so they run in the browser or in tests.
 *
 * Corners are always given in order: top-left, top-right, bottom-right,
 * bottom-left, each as [x, y] in source-image pixels.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  /** Solves A·x = b (n×n) by Gaussian elimination with partial pivoting. */
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      if (Math.abs(M[pivot][col]) < 1e-12) return null; // degenerate: corners in a line
      [M[col], M[pivot]] = [M[pivot], M[col]];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
      x[r] = s / M[r][r];
    }
    return x;
  }

  /** 3×3 homography (row-major, 9 numbers) taking the four `from` points to the four `to` points. */
  function homography(from, to) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = from[i];
      const [u, v] = to[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }
    const h = solve(A, b);
    return h ? [...h, 1] : null;
  }

  function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  /**
   * Warps the `quad` region of an RGBA image (sw × sh) into a straight
   * ow × oh rectangle, with bilinear sampling. Returns RGBA, or null if the
   * corners are degenerate.
   */
  function warpQuad(src, sw, sh, quad, ow, oh) {
    // map each output pixel back into the photo
    const H = homography(
      [
        [0, 0],
        [ow, 0],
        [ow, oh],
        [0, oh],
      ],
      quad
    );
    if (!H) return null;
    const out = new Uint8ClampedArray(ow * oh * 4);
    const maxX = sw - 1;
    const maxY = sh - 1;
    let o = 0;
    for (let y = 0; y < oh; y++) {
      const py = y + 0.5;
      for (let x = 0; x < ow; x++) {
        const px = x + 0.5;
        const w = H[6] * px + H[7] * py + H[8];
        let sx = (H[0] * px + H[1] * py + H[2]) / w - 0.5;
        let sy = (H[3] * px + H[4] * py + H[5]) / w - 0.5;
        if (sx < 0) sx = 0;
        else if (sx > maxX) sx = maxX;
        if (sy < 0) sy = 0;
        else if (sy > maxY) sy = maxY;
        const x0 = sx | 0;
        const y0 = sy | 0;
        const x1 = x0 < maxX ? x0 + 1 : x0;
        const y1 = y0 < maxY ? y0 + 1 : y0;
        const fx = sx - x0;
        const fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4;
        const i10 = (y0 * sw + x1) * 4;
        const i01 = (y1 * sw + x0) * 4;
        const i11 = (y1 * sw + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
          const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
          out[o + c] = top + (bot - top) * fy;
        }
        out[o + 3] = 255;
        o += 4;
      }
    }
    return out;
  }

  /** Rough width ÷ height of the drawing, from the average lengths of opposite edges. */
  function estimateAspect(quad) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const width = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2;
    const height = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
    return height > 0 ? width / height : 1;
  }

  /** True when the four corners make a proper (non-crossing, non-flat) shape. */
  function isValidQuad(quad) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = quad[i];
      const [bx, by] = quad[(i + 1) % 4];
      const [cx, cy] = quad[(i + 2) % 4];
      const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      if (Math.abs(cross) < 1e-6) return false;
      const s = Math.sign(cross);
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  }

  VST.warp = { homography, applyH, warpQuad, estimateAspect, isValidQuad };
})(typeof window !== 'undefined' ? window : globalThis);

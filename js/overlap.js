/*
 * Gamut overlap: the picture's colors and what a palette can mix, on one
 * flat hue/chroma wheel (the CIE Lab a*b* plane seen from above, like the
 * color space's Top view: yellow up, red to the right, gray in the middle).
 *
 * The wheel is a grid of small cells. A cell is the picture's if enough of
 * the picture falls in it, the palette's if a mix does, and a gap if part
 * of the picture there is out of the palette's reach. Reach is the same 3D
 * test as everywhere else (the nearest mix within ΔE 10), so a hue/chroma
 * the palette can mix at one value but not at the picture's is still a gap.
 * A value band (darks, middles, lights) narrows both to those values.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const BANDS = {
    all: [0, 101],
    darks: [0, 35], // values 0 to 3.5
    middles: [35, 65],
    lights: [65, 101],
  };
  const MIN_SHARE = 0.0003; // a cell needs this much of the picture (in the band) to count

  /**
   * lab: the picture ({ L, A, B }, a small copy is plenty); model: a palette
   * model (js/palette.js); nearest(L, a, b) -> { i, d } its nearest mix.
   * Returns { n, scale, pic, gap, pal, picRgb, shareIn, outShare } where pic and
   * gap are Uint8Array flags per cell, pal and picRgb are RGB per cell (pal
   * only where the palette mixes), cells indexed [row * n + col] with row 0
   * at the top (+b) and col 0 at the left (−a).
   */
  function compute(lab, model, nearest, { band = 'all', n = 72, reach = 10, toRgb } = {}) {
    const [lo, hi] = BANDS[band] || BANDS.all;
    // how far out to draw: what the picture and the palette reach, within limits
    let maxC = 0;
    for (const m of model.mixes) if (m.L >= lo && m.L < hi) maxC = Math.max(maxC, Math.hypot(m.a, m.b));
    const scale = Math.max(30, Math.min(115, Math.max(maxC, pictureChroma(lab, band)) * 1.08));
    const g = grid(lab, { band, n, scale, toRgb, outside: (L, a, b) => nearest(L, a, b).d > reach });
    const size = (2 * scale) / n;
    const cell = (a, b) => {
      const col = Math.floor((a + scale) / size);
      const row = Math.floor((scale - b) / size);
      return col < 0 || row < 0 || col >= n || row >= n ? -1 : row * n + col;
    };
    // the palette: every mix in the band, spread a little so the samples join up
    const pal = new Int16Array(n * n * 3).fill(-1);
    const best = new Float32Array(n * n).fill(-1);
    const r = Math.max(1, Math.ceil(3.5 / size));
    for (const m of model.mixes) {
      if (m.L < lo || m.L >= hi) continue;
      const k0 = cell(m.a, m.b);
      if (k0 < 0) continue;
      const row = Math.floor(k0 / n);
      const col = k0 % n;
      // each cell shows its strongest mix, so the wheel reads by hue and chroma
      const c = Math.hypot(m.a, m.b);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const y = row + dy;
          const x = col + dx;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const k = y * n + x;
          const w = c - Math.hypot(dx, dy) * 0.01; // the mix's own cell wins ties
          if (w <= best[k]) continue;
          best[k] = w;
          pal[k * 3] = m.rgb[0];
          pal[k * 3 + 1] = m.rgb[1];
          pal[k * 3 + 2] = m.rgb[2];
        }
      }
    }
    return { ...g, pal };
  }

  /** The chroma that only the strongest 0.5% of the picture (in the band) goes beyond. */
  function pictureChroma(lab, band = 'all') {
    const [lo, hi] = BANDS[band] || BANDS.all;
    const chroma = [];
    for (let i = 0; i < lab.L.length; i += 7) if (lab.L[i] >= lo && lab.L[i] < hi) chroma.push(Math.hypot(lab.A[i], lab.B[i]));
    chroma.sort((p, q) => p - q);
    return chroma.length ? chroma[Math.floor(chroma.length * 0.995)] : 0;
  }

  /**
   * The picture on the wheel's grid: which cells it uses (pic), how much
   * (share), their average color (picRgb), and which have part of the
   * picture that `outside(L, a, b)` says is out (gap). Also the band's share
   * of the picture (shareIn) and the share of it that's out (outShare).
   * Returns { n, scale, pic, gap, share, picRgb, pal (none), shareIn, outShare }.
   */
  function grid(lab, { band = 'all', n = 72, scale = 60, toRgb, outside }) {
    const [lo, hi] = BANDS[band] || BANDS.all;
    const len = lab.L.length;
    const size = (2 * scale) / n;
    const cell = (a, b) => {
      const col = Math.floor((a + scale) / size);
      const row = Math.floor((scale - b) / size);
      return col < 0 || row < 0 || col >= n || row >= n ? -1 : row * n + col;
    };
    const count = new Float64Array(n * n);
    const out = new Float64Array(n * n);
    const sum = new Float64Array(n * n * 3);
    let inBand = 0;
    let outAll = 0;
    for (let i = 0; i < len; i++) {
      const L = lab.L[i];
      if (L < lo || L >= hi) continue;
      inBand++;
      const k = cell(lab.A[i], lab.B[i]);
      const far = outside ? outside(L, lab.A[i], lab.B[i]) : false;
      if (far) outAll++;
      if (k < 0) continue;
      count[k]++;
      if (far) out[k]++;
      sum[k * 3] += L;
      sum[k * 3 + 1] += lab.A[i];
      sum[k * 3 + 2] += lab.B[i];
    }
    const pic = new Uint8Array(n * n);
    const gap = new Uint8Array(n * n);
    const share = new Float32Array(n * n);
    const picRgb = new Uint8ClampedArray(n * n * 3);
    const min = Math.max(1, inBand * MIN_SHARE);
    for (let k = 0; k < n * n; k++) {
      if (count[k] < min) continue;
      pic[k] = 1;
      share[k] = count[k] / inBand;
      if (out[k] >= min) gap[k] = 1;
      if (toRgb) {
        const c = count[k];
        picRgb.set(toRgb(sum[k * 3] / c, sum[k * 3 + 1] / c, sum[k * 3 + 2] / c), k * 3);
      }
    }
    return { n, scale, pic, gap, share, picRgb, pal: new Int16Array(n * n * 3).fill(-1), shareIn: len ? inBand / len : 0, outShare: inBand ? outAll / inBand : 0 };
  }

  /** Where the wheel sits on a canvas: its center, radius and pixel ratio, and a, b to canvas pixels. */
  function geometry(canvas, o) {
    const dpr = root.devicePixelRatio || 1;
    const W = canvas.width;
    const pad = 22 * dpr;
    const R = W / 2 - pad;
    const cx = W / 2;
    return { cx, R, dpr, toPx: (a, b) => [cx + (a / o.scale) * R, cx - (b / o.scale) * R], toAb: (x, y) => [((x - cx) / R) * o.scale, ((cx - y) / R) * o.scale] };
  }

  /**
   * Draws a computed overlap on a canvas: the palette's mixes as color, the
   * picture's colors outlined in white, and the gaps striped over the
   * picture's own color. `hues` is [[code, name, labAngle], …] for labels.
   */
  function draw(canvas, o, hues) {
    const dpr = root.devicePixelRatio || 1;
    const css = canvas.clientWidth || 300;
    const W = Math.round(css * dpr);
    if (canvas.width !== W || canvas.height !== W) {
      canvas.width = W;
      canvas.height = W;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, W);
    const pad = 22 * dpr;
    const R = W / 2 - pad; // pixels for `scale` chroma
    const cx = W / 2;
    const px = (R * 2) / o.n; // pixels per cell
    const x0 = cx - R;
    const cellRect = (k) => [x0 + (k % o.n) * px, x0 + Math.floor(k / o.n) * px];
    // chroma rings and the gray center
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = dpr;
    for (const c of [20, 40, 60, 80, 100]) {
      if (c > o.scale) break;
      ctx.beginPath();
      ctx.arc(cx, cx, (c / o.scale) * R, 0, Math.PI * 2);
      ctx.stroke();
    }
    // what the palette can mix
    for (let k = 0; k < o.n * o.n; k++) {
      if (o.pal[k * 3] < 0) continue;
      const [x, y] = cellRect(k);
      ctx.fillStyle = `rgb(${o.pal[k * 3]},${o.pal[k * 3 + 1]},${o.pal[k * 3 + 2]})`;
      ctx.fillRect(x, y, Math.ceil(px), Math.ceil(px));
    }
    // dim it, so the picture's outline and the gaps read on top
    ctx.fillStyle = 'rgba(30,30,30,0.35)';
    ctx.beginPath();
    ctx.rect(0, 0, W, W);
    ctx.fill();
    // the gaps: the picture's own color, striped
    const stripe = document.createElement('canvas');
    const sp = Math.max(4, Math.round(6 * dpr));
    stripe.width = stripe.height = sp;
    const sc = stripe.getContext('2d');
    sc.strokeStyle = 'rgba(255,255,255,0.9)';
    sc.lineWidth = Math.max(1, dpr * 1.2);
    sc.beginPath();
    sc.moveTo(0, sp);
    sc.lineTo(sp, 0);
    sc.moveTo(-1, 1);
    sc.lineTo(1, -1);
    sc.moveTo(sp - 1, sp + 1);
    sc.lineTo(sp + 1, sp - 1);
    sc.stroke();
    const hatch = ctx.createPattern(stripe, 'repeat');
    // the picture's colors as dots in their own color, bigger where it covers
    // more (largest first, so small ones stay visible); what it can't mix striped
    let maxShare = 0;
    const cells = [];
    for (let k = 0; k < o.n * o.n; k++) {
      if (!o.pic[k]) continue;
      cells.push(k);
      maxShare = Math.max(maxShare, o.share[k]);
    }
    cells.sort((p, q) => o.share[q] - o.share[p]);
    for (const k of cells) {
      const [x, y] = cellRect(k);
      const rad = px * 0.55 + px * 3 * Math.sqrt(o.share[k] / (maxShare || 1));
      ctx.beginPath();
      ctx.arc(x + px / 2, y + px / 2, rad, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${o.picRgb[k * 3]},${o.picRgb[k * 3 + 1]},${o.picRgb[k * 3 + 2]})`;
      ctx.fill();
      if (o.gap[k]) {
        ctx.fillStyle = hatch;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2 * dpr;
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 0.8 * dpr;
      }
      ctx.stroke();
    }
    // the picture's range: an outline around its cells
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    const on = (row, col) => row >= 0 && col >= 0 && row < o.n && col < o.n && o.pic[row * o.n + col];
    for (let row = 0; row < o.n; row++) {
      for (let col = 0; col < o.n; col++) {
        if (!o.pic[row * o.n + col]) continue;
        const x = x0 + col * px;
        const y = x0 + row * px;
        if (!on(row - 1, col)) (ctx.moveTo(x, y), ctx.lineTo(x + px, y));
        if (!on(row + 1, col)) (ctx.moveTo(x, y + px), ctx.lineTo(x + px, y + px));
        if (!on(row, col - 1)) (ctx.moveTo(x, y), ctx.lineTo(x, y + px));
        if (!on(row, col + 1)) (ctx.moveTo(x + px, y), ctx.lineTo(x + px, y + px));
      }
    }
    ctx.stroke();
    // the gray center and hue letters around the outside
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(cx, cx, 2 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${Math.round(10.5 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [code, , ang] of hues || []) {
      const t = (ang * Math.PI) / 180;
      ctx.fillText(code, cx + Math.cos(t) * (R + 11 * dpr), cx - Math.sin(t) * (R + 11 * dpr));
    }
  }

  VST.overlap = { compute, grid, draw, geometry, pictureChroma, BANDS };
})(typeof window !== 'undefined' ? window : globalThis);

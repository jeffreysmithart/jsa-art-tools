/*
 * Image processing for value studies. Pure functions over typed arrays so they
 * can run at preview size, at export size, or in tests.
 *
 * Pipeline: RGBA -> Lab (computeLab) -> optional squint blur (blurLab)
 *           -> one of: grayscale, value bands (gray or color), main colors.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});
  const C = VST.color;

  /* ---------- Lab conversion ---------- */

  function computeLab(rgba, n) {
    const L = new Float32Array(n);
    const A = new Float32Array(n);
    const B = new Float32Array(n);
    const t = [0, 0, 0];
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      C.rgbToLab(rgba[j], rgba[j + 1], rgba[j + 2], t);
      L[i] = t[0];
      A[i] = t[1];
      B[i] = t[2];
    }
    return { L, A, B };
  }

  /* ---------- Gaussian blur (three box passes) ---------- */

  function boxesForGauss(sigma, n) {
    const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(wIdeal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal);
    const sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }

  function boxBlurH(scl, tcl, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < h; i++) {
      let ti = i * w;
      let li = ti;
      let ri = ti + r;
      const fv = scl[ti];
      const lv = scl[ti + w - 1];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += scl[ti + j];
      for (let j = 0; j <= r; j++) {
        val += scl[ri++] - fv;
        tcl[ti++] = val * iarr;
      }
      for (let j = r + 1; j < w - r; j++) {
        val += scl[ri++] - scl[li++];
        tcl[ti++] = val * iarr;
      }
      for (let j = w - r; j < w; j++) {
        val += lv - scl[li++];
        tcl[ti++] = val * iarr;
      }
    }
  }

  function boxBlurT(scl, tcl, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < w; i++) {
      let ti = i;
      let li = ti;
      let ri = ti + r * w;
      const fv = scl[ti];
      const lv = scl[ti + w * (h - 1)];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += scl[ti + j * w];
      for (let j = 0; j <= r; j++) {
        val += scl[ri] - fv;
        tcl[ti] = val * iarr;
        ri += w;
        ti += w;
      }
      for (let j = r + 1; j < h - r; j++) {
        val += scl[ri] - scl[li];
        tcl[ti] = val * iarr;
        li += w;
        ri += w;
        ti += w;
      }
      for (let j = h - r; j < h; j++) {
        val += lv - scl[li];
        tcl[ti] = val * iarr;
        li += w;
        ti += w;
      }
    }
  }

  function boxBlur(scl, tcl, w, h, r) {
    tcl.set(scl);
    boxBlurH(tcl, scl, w, h, r);
    boxBlurT(scl, tcl, w, h, r);
  }

  /** Returns a blurred copy of a single-channel Float32Array. */
  function gaussianBlur(channel, w, h, sigma) {
    const maxR = Math.floor((Math.min(w, h) - 2) / 2);
    const src = new Float32Array(channel);
    const dst = new Float32Array(channel.length);
    if (sigma < 0.3 || maxR < 1) return src;
    const boxes = boxesForGauss(sigma, 3);
    let cur = src;
    let out = dst;
    for (let k = 0; k < 3; k++) {
      const r = Math.min(maxR, Math.max(0, (boxes[k] - 1) >> 1));
      if (r < 1) continue;
      boxBlur(cur, out, w, h, r);
      const t = cur;
      cur = out;
      out = t;
    }
    return cur;
  }

  function blurLab(lab, w, h, sigma) {
    if (!(sigma >= 0.3)) return lab;
    return {
      L: gaussianBlur(lab.L, w, h, sigma),
      A: gaussianBlur(lab.A, w, h, sigma),
      B: gaussianBlur(lab.B, w, h, sigma),
    };
  }

  /* ---------- Value histogram and thresholds ---------- */

  /** 101-bin histogram of L* (0..100). */
  function histogram(L) {
    const hist = new Uint32Array(101);
    for (let i = 0; i < L.length; i++) {
      let b = Math.round(L[i]);
      if (b < 0) b = 0;
      else if (b > 100) b = 100;
      hist[b]++;
    }
    return hist;
  }

  /** n bands -> n-1 evenly spaced breaks on the 0..100 scale. */
  function evenThresholds(n) {
    const t = [];
    for (let i = 1; i < n; i++) t.push(Math.round((100 * i) / n));
    return t;
  }

  /**
   * Finds natural breaks in this image's values (1-D k-means on the
   * histogram), so each band captures a real cluster of lights or darks.
   */
  function autoThresholds(hist, n) {
    let total = 0;
    for (let i = 0; i <= 100; i++) total += hist[i];
    if (!total) return evenThresholds(n);
    // start centers at evenly spaced percentiles
    const centers = [];
    let acc = 0;
    let k = 0;
    for (let i = 0; i <= 100 && k < n; i++) {
      acc += hist[i];
      while (k < n && acc >= ((k + 0.5) / n) * total) {
        centers.push(i);
        k++;
      }
    }
    while (centers.length < n) centers.push(100);
    for (let iter = 0; iter < 40; iter++) {
      const sum = new Float64Array(n);
      const cnt = new Float64Array(n);
      for (let i = 0; i <= 100; i++) {
        if (!hist[i]) continue;
        let best = 0;
        let bd = Infinity;
        for (let c = 0; c < n; c++) {
          const d = Math.abs(i - centers[c]);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        sum[best] += i * hist[i];
        cnt[best] += hist[i];
      }
      let moved = false;
      for (let c = 0; c < n; c++) {
        if (!cnt[c]) continue;
        const nc = sum[c] / cnt[c];
        if (Math.abs(nc - centers[c]) > 0.01) moved = true;
        centers[c] = nc;
      }
      if (!moved) break;
    }
    centers.sort((a, b) => a - b);
    return sanitizeThresholds(
      centers.slice(1).map((c, i) => Math.round((centers[i] + c) / 2)),
      n
    );
  }

  /** Keeps n-1 breaks strictly increasing within 1..99. */
  function sanitizeThresholds(t, n) {
    const out = [];
    const src = Array.isArray(t) && t.length === n - 1 ? t : evenThresholds(n);
    for (let i = 0; i < n - 1; i++) {
      const min = (i === 0 ? 0 : out[i - 1]) + 1;
      const max = 99 - (n - 2 - i);
      let v = Math.round(Number(src[i]));
      if (!Number.isFinite(v)) v = Math.round((100 * (i + 1)) / n);
      out.push(Math.min(max, Math.max(min, v)));
    }
    return out;
  }

  const EVEN_LO = 6;
  const EVEN_HI = 97;

  /**
   * The L* each band is painted with.
   *  even    - evenly spaced from near-black to near-white
   *  average - the true average value of the pixels in that band
   *  custom  - user values (e.g. to match a marker set)
   */
  function bandLevels(mode, n, thresholds, hist, custom) {
    const even = [];
    for (let i = 0; i < n; i++) even.push(n === 1 ? 50 : EVEN_LO + ((EVEN_HI - EVEN_LO) * i) / (n - 1));
    if (mode === 'custom' && Array.isArray(custom) && custom.length === n) {
      return custom.map((v, i) => (Number.isFinite(+v) ? Math.min(100, Math.max(0, +v)) : even[i]));
    }
    if (mode === 'average' && hist) {
      const edges = [0, ...thresholds, 101];
      return even.map((fallback, b) => {
        let s = 0;
        let c = 0;
        for (let i = Math.ceil(edges[b]); i < edges[b + 1] && i <= 100; i++) {
          s += i * hist[i];
          c += hist[i];
        }
        return c ? s / c : (edges[b] + Math.min(100, edges[b + 1])) / 2 || fallback;
      });
    }
    return even;
  }

  /** Lookup L*×10 -> band index. */
  function bandLut(thresholds) {
    const lut = new Uint8Array(1001);
    let b = 0;
    for (let i = 0; i <= 1000; i++) {
      while (b < thresholds.length && i / 10 >= thresholds[b]) b++;
      lut[i] = b;
    }
    return lut;
  }

  function lIndex(L) {
    let k = (L * 10 + 0.5) | 0;
    if (k < 0) k = 0;
    else if (k > 1000) k = 1000;
    return k;
  }

  /* ---------- Renderers (write RGBA into `out`) ---------- */

  function renderGray(lab, out) {
    const L = lab.L;
    const lut = new Uint8ClampedArray(1001);
    for (let i = 0; i <= 1000; i++) lut[i] = C.lToGray8(i / 10);
    for (let i = 0, j = 0; i < L.length; i++, j += 4) {
      const g = lut[lIndex(L[i])];
      out[j] = out[j + 1] = out[j + 2] = g;
      out[j + 3] = 255;
    }
  }

  /** Full-range color (used to show the squinted image in color). */
  function renderColor(lab, out) {
    const { L, A, B } = lab;
    const rgb = [0, 0, 0];
    for (let i = 0, j = 0; i < L.length; i++, j += 4) {
      C.labToRgb8(L[i], A[i], B[i], rgb);
      out[j] = rgb[0];
      out[j + 1] = rgb[1];
      out[j + 2] = rgb[2];
      out[j + 3] = 255;
    }
  }

  /**
   * Value bands. In gray mode each band is a flat gray; in color mode each
   * pixel keeps its hue and chroma but takes its band's value.
   * Returns the share of the image (0..1) in each band.
   */
  function renderValues(lab, thresholds, levels, color, out) {
    const { L, A, B } = lab;
    const n = levels.length;
    const lut = bandLut(thresholds);
    const counts = new Float64Array(n);
    const grays = levels.map((v) => C.lToGray8(v));
    const rgb = [0, 0, 0];
    for (let i = 0, j = 0; i < L.length; i++, j += 4) {
      const b = lut[lIndex(L[i])];
      counts[b]++;
      if (color) {
        C.labToRgb8(levels[b], A[i], B[i], rgb);
        out[j] = rgb[0];
        out[j + 1] = rgb[1];
        out[j + 2] = rgb[2];
      } else {
        out[j] = out[j + 1] = out[j + 2] = grays[b];
      }
      out[j + 3] = 255;
    }
    return Array.from(counts, (c) => c / (L.length || 1));
  }

  /* ---------- Main colors (k-means in Lab) ---------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Finds the k colors that best summarize the image. Seeded, so the same
   * image and settings always give the same palette. Sorted dark -> light.
   */
  function kmeans(lab, k, seed = 7, maxSamples = 12000) {
    const { L, A, B } = lab;
    const n = L.length;
    const rand = mulberry32(seed);
    const m = Math.min(n, maxSamples);
    const sL = new Float32Array(m);
    const sA = new Float32Array(m);
    const sB = new Float32Array(m);
    const step = n / m;
    for (let i = 0; i < m; i++) {
      const idx = Math.min(n - 1, Math.floor(i * step + rand() * step));
      sL[i] = L[idx];
      sA[i] = A[idx];
      sB[i] = B[idx];
    }
    // k-means++ initialisation
    const cents = [];
    const first = Math.floor(rand() * m);
    cents.push([sL[first], sA[first], sB[first]]);
    const d2 = new Float64Array(m).fill(Infinity);
    while (cents.length < k) {
      const c = cents[cents.length - 1];
      let sum = 0;
      for (let i = 0; i < m; i++) {
        const dl = sL[i] - c[0];
        const da = sA[i] - c[1];
        const db = sB[i] - c[2];
        const d = dl * dl + da * da + db * db;
        if (d < d2[i]) d2[i] = d;
        sum += d2[i];
      }
      if (sum === 0) {
        cents.push(c.slice());
        continue;
      }
      let r = rand() * sum;
      let pick = m - 1;
      for (let i = 0; i < m; i++) {
        r -= d2[i];
        if (r <= 0) {
          pick = i;
          break;
        }
      }
      cents.push([sL[pick], sA[pick], sB[pick]]);
    }
    const assign = new Uint8Array(m);
    for (let iter = 0; iter < 20; iter++) {
      const acc = cents.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < m; i++) {
        let best = 0;
        let bd = Infinity;
        for (let c = 0; c < k; c++) {
          const dl = sL[i] - cents[c][0];
          const da = sA[i] - cents[c][1];
          const db = sB[i] - cents[c][2];
          const d = dl * dl + da * da + db * db;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        assign[i] = best;
        const a = acc[best];
        a[0] += sL[i];
        a[1] += sA[i];
        a[2] += sB[i];
        a[3]++;
      }
      let shift = 0;
      for (let c = 0; c < k; c++) {
        const a = acc[c];
        if (!a[3]) continue;
        const nl = a[0] / a[3];
        const na = a[1] / a[3];
        const nb = a[2] / a[3];
        shift += Math.abs(nl - cents[c][0]) + Math.abs(na - cents[c][1]) + Math.abs(nb - cents[c][2]);
        cents[c] = [nl, na, nb];
      }
      if (shift < 0.05) break;
    }
    return cents.sort((p, q) => p[0] - q[0]);
  }

  /** Paints each pixel with its nearest main color (or that color's value). */
  function renderPoster(lab, centroids, color, out) {
    const { L, A, B } = lab;
    const k = centroids.length;
    const counts = new Float64Array(k);
    const paint = centroids.map((c) => {
      if (color) return C.labToRgb8(c[0], c[1], c[2], [0, 0, 0]);
      const g = C.lToGray8(c[0]);
      return [g, g, g];
    });
    for (let i = 0, j = 0; i < L.length; i++, j += 4) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const cc = centroids[c];
        const dl = L[i] - cc[0];
        const da = A[i] - cc[1];
        const db = B[i] - cc[2];
        const d = dl * dl + da * da + db * db;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      counts[best]++;
      const p = paint[best];
      out[j] = p[0];
      out[j + 1] = p[1];
      out[j + 2] = p[2];
      out[j + 3] = 255;
    }
    return Array.from(counts, (c) => c / (L.length || 1));
  }

  VST.process = {
    computeLab,
    gaussianBlur,
    blurLab,
    histogram,
    evenThresholds,
    autoThresholds,
    sanitizeThresholds,
    bandLevels,
    renderGray,
    renderColor,
    renderValues,
    kmeans,
    renderPoster,
  };
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Color math for value studies.
 *
 * Values are measured as CIE L* (perceptual lightness, 0 = black, 100 = white),
 * which tracks how bright a color *looks* far better than averaging RGB.
 * The UI shows L* / 10, i.e. a 0–10 value scale similar to Munsell value.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  // sRGB 8-bit -> linear light
  const toLinear = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    toLinear[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  // linear light -> sRGB 8-bit (lookup table)
  const LUT_SIZE = 4096;
  const toSrgb8 = new Uint8ClampedArray(LUT_SIZE + 1);
  for (let i = 0; i <= LUT_SIZE; i++) {
    const v = i / LUT_SIZE;
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    toSrgb8[i] = Math.round(c * 255);
  }
  function linearTo8(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return toSrgb8[(v * LUT_SIZE + 0.5) | 0];
  }

  // D65 white point
  const Xn = 0.95047;
  const Zn = 1.08883;
  const EPS = 216 / 24389;
  const KAPPA = 24389 / 27;

  function f(t) {
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  }
  function finv(t) {
    const t3 = t * t * t;
    return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
  }
  function lToY(L) {
    return L > 8 ? Math.pow((L + 16) / 116, 3) : L / KAPPA;
  }

  /** sRGB 8-bit -> [L, a, b]; writes into `out` and returns it. */
  function rgbToLab(r, g, b, out) {
    const R = toLinear[r];
    const G = toLinear[g];
    const B = toLinear[b];
    const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / Xn;
    const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
    const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / Zn;
    const fy = f(y);
    out[0] = 116 * fy - 16;
    out[1] = 500 * (f(x) - fy);
    out[2] = 200 * (fy - f(z));
    return out;
  }

  const tmp = new Float64Array(3);
  function labToLinear(L, a, b, out) {
    const fy = (L + 16) / 116;
    const x = finv(fy + a / 500) * Xn;
    const y = lToY(L);
    const z = finv(fy - b / 200) * Zn;
    out[0] = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    out[1] = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
    out[2] = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  }
  function inGamut(c) {
    const lo = -1e-4;
    const hi = 1 + 1e-4;
    return c[0] >= lo && c[0] <= hi && c[1] >= lo && c[1] <= hi && c[2] >= lo && c[2] <= hi;
  }

  /**
   * Lab -> sRGB 8-bit. If the color is outside the screen gamut, chroma is
   * reduced (hue and lightness kept) until it fits, so the value stays true.
   */
  function labToRgb8(L, a, b, out) {
    labToLinear(L, a, b, tmp);
    if (!inGamut(tmp)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        labToLinear(L, a * mid, b * mid, tmp);
        if (inGamut(tmp)) lo = mid;
        else hi = mid;
      }
      labToLinear(L, a * lo, b * lo, tmp);
    }
    out[0] = linearTo8(tmp[0]);
    out[1] = linearTo8(tmp[1]);
    out[2] = linearTo8(tmp[2]);
    return out;
  }

  /** Neutral gray (8-bit) with the given L*. */
  function lToGray8(L) {
    return linearTo8(lToY(L));
  }

  VST.color = { rgbToLab, labToRgb8, lToGray8, lToY };
})(typeof window !== 'undefined' ? window : globalThis);

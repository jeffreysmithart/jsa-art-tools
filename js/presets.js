/*
 * Presets: named study settings you can apply with one tap, like Lightroom
 * presets, and try on across a whole study set.
 *
 * A preset holds the look of a study (never the crop):
 *   tone: 'gray' | 'color' | 'poster' | 'palette'
 *   bands: 0 (all values) or 2..6       posterK: number of main colors
 *   splits: 'auto' (fit to each image) | 'even' | 'fixed' (thresholds below)
 *   thresholds, levelsMode, customLevels, blur
 * and, when you choose to keep them when saving:
 *   palette: [paint ids] (with the Palette tone)
 *   grid: { on, cols, rows, diag, color, opacity }
 *   compose: { on, thirds, golden, diag, cross, color }
 *   view: 'both' | 'study' | 'original'
 * Anything a preset doesn't hold is left as it is when it's applied.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});
  const P = VST.process;
  const C = VST.color;
  const KEY = 'value-study:presets';
  const DELETED_KEY = 'value-study:presets-deleted'; // { [presetId]: time }, for syncing

  const BUILTIN = [
    { id: 'b-notan', name: 'Notan (2 values)', tone: 'gray', bands: 2, splits: 'auto', levelsMode: 'even', blur: 0 },
    { id: 'b-3', name: '3 values', tone: 'gray', bands: 3, splits: 'auto', levelsMode: 'average', blur: 0 },
    { id: 'b-4even', name: '4 values, even steps', tone: 'gray', bands: 4, splits: 'even', levelsMode: 'even', blur: 0 },
    { id: 'b-5', name: '5 values', tone: 'gray', bands: 5, splits: 'auto', levelsMode: 'average', blur: 0 },
    { id: 'b-squint3', name: 'Squint, 3 values', tone: 'gray', bands: 3, splits: 'auto', levelsMode: 'average', blur: 45 },
    { id: 'b-color4', name: 'Color poster, 4 values', tone: 'color', bands: 4, splits: 'auto', levelsMode: 'average', blur: 0 },
    { id: 'b-main5', name: '5 main colors', tone: 'poster', posterK: 5, blur: 0 },
    { id: 'b-gray', name: 'Grayscale (all values)', tone: 'gray', bands: 0, blur: 0 },
  ].map((p) => ({ ...p, builtin: true }));

  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      /* storage unavailable */
    }
  }

  function user() {
    return read();
  }
  function all() {
    return [...BUILTIN, ...read()];
  }
  function get(id) {
    return all().find((p) => p.id === id) || null;
  }

  /** Saves a preset under a unique name; returns it. */
  function save(preset) {
    const list = read();
    const taken = new Set(all().map((p) => p.name.toLowerCase()));
    const base = (preset.name || 'My preset').trim().slice(0, 50) || 'My preset';
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i})`;
    const p = { ...preset, name, id: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, builtin: false, updated: Date.now() };
    list.push(p);
    write(list);
    return p;
  }
  function remove(id) {
    write(read().filter((p) => p.id !== id));
    try {
      const deleted = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}') || {};
      deleted[id] = Date.now();
      localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
    } catch (e) {
      /* storage unavailable */
    }
  }

  /* for syncing: what this device holds, and taking in a merged copy */
  function syncDoc() {
    let deleted = {};
    try {
      deleted = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}') || {};
    } catch (e) {
      /* fall through */
    }
    return { presets: read(), deleted };
  }
  function applySyncDoc(doc) {
    write((doc.presets || []).map((p) => ({ ...p, builtin: false })));
    try {
      localStorage.setItem(DELETED_KEY, JSON.stringify(doc.deleted || {}));
    } catch (e) {
      /* storage unavailable */
    }
  }

  /** Where this preset splits the values of an image with this histogram. */
  function splitsFor(p, hist) {
    const n = p.bands;
    if (p.splits === 'auto') return hist ? P.autoThresholds(hist, n) : P.evenThresholds(n);
    if (p.splits === 'even') return P.evenThresholds(n);
    return P.sanitizeThresholds(p.thresholds, n);
  }

  /** A short description, e.g. "Grayscale · 3 values · fit to each image · squint". */
  function describe(p) {
    const paints = Array.isArray(p.palette) ? p.palette.length : 0;
    const parts = [{ gray: 'Grayscale', color: 'Color', poster: `${p.posterK || 5} main colors`, palette: `Palette of ${paints} paints` }[p.tone] || 'Grayscale'];
    if (p.tone !== 'poster') {
      if (p.bands >= 2) {
        parts.push(`${p.bands} values`);
        parts.push({ auto: 'fit to each image', even: 'even splits', fixed: 'fixed splits' }[p.splits || 'fixed']);
        if (p.levelsMode === 'even') parts.push('even steps');
        if (p.levelsMode === 'custom') parts.push('custom values');
      } else parts.push('all values');
    }
    if (p.blur) parts.push('squint');
    if (p.grid) parts.push(p.grid.on ? `grid ${p.grid.cols} × ${p.grid.rows}` : 'no grid');
    if (p.compose) parts.push(p.compose.on ? 'guides' : 'no guides');
    if (p.view) parts.push(`view: ${{ both: 'both', study: 'study', original: 'original' }[p.view] || p.view}`);
    return parts.join(' · ');
  }

  /**
   * Renders an image (prepared as { w, h, lab0, cache }) with a preset into
   * `out` (RGBA). Returns band info for a value bar, or null. The 'original'
   * pseudo-preset shows the image as is.
   */
  function render(p, entry, out) {
    const { w, h } = entry;
    entry.cache = entry.cache || {};
    const sigma = ((p.blur || 0) / 100) * 0.02 * Math.max(w, h);
    const bkey = `b${sigma.toFixed(2)}`;
    if (!entry.cache[bkey]) {
      const lab = P.blurLab(entry.lab0, w, h, sigma);
      entry.cache[bkey] = { lab, hist: P.histogram(lab.L) };
    }
    const { lab, hist } = entry.cache[bkey];
    if (p.id === 'original') {
      P.renderColor(lab, out);
      return null;
    }
    if (p.tone === 'poster') {
      const k = p.posterK || 5;
      const ckey = `${bkey}k${k}`;
      if (!entry.cache[ckey]) entry.cache[ckey] = P.kmeans(lab, k);
      const cents = entry.cache[ckey];
      const shares = P.renderPoster(lab, cents, true, out);
      return cents.map((c, i) => ({ L: c[0], rgb: C.labToRgb8(c[0], c[1], c[2], [0, 0, 0]), share: shares[i] }));
    }
    if (p.tone === 'palette') return renderPalette(p, entry, lab, hist, out);
    const color = p.tone === 'color';
    if (!(p.bands >= 2)) {
      if (color) P.renderColor(lab, out);
      else P.renderGray(lab, out);
      return null;
    }
    const t = splitsFor(p, hist);
    const levels = P.bandLevels(p.levelsMode || 'average', p.bands, t, hist, p.customLevels);
    const shares = P.renderValues(lab, t, levels, color, out);
    return levels.map((L, i) => ({ L, share: shares[i] }));
  }

  // palettes are mixed once and kept (the mixing is the slow part)
  const models = new Map();
  function paletteModel(ids) {
    const PAL = VST.palette;
    if (!PAL || !root.spectral || !Array.isArray(ids) || !ids.length) return null;
    const key = ids.join(',');
    if (!models.has(key)) {
      if (models.size >= 12) models.delete(models.keys().next().value);
      models.set(key, PAL.build(ids, root.spectral, (r, g, b) => C.rgbToLab(r, g, b, [0, 0, 0])));
    }
    return models.get(key);
  }

  /** A palette preset: the picture painted with its paints, with its values grouped when it has a number. */
  function renderPalette(p, entry, lab, hist, out) {
    const PAL = VST.palette;
    const model = paletteModel(p.palette);
    if (!model) {
      P.renderColor(lab, out);
      return null;
    }
    if (!(p.bands >= 2)) {
      PAL.paint(model, lab, out, entry.w, { mark: true });
      return null;
    }
    const t = splitsFor(p, hist);
    const levels = P.bandLevels(p.levelsMode || 'average', p.bands, t, hist, p.customLevels);
    const flat = P.flattenValues(lab, t, levels);
    const rgbs = PAL.paintValues(model, flat, levels, out);
    return levels.map((L, i) => ({ L, rgb: rgbs[i], share: flat.shares[i] }));
  }

  VST.presets = { all, user, get, save, remove, splitsFor, describe, render, BUILTIN, syncDoc, applySyncDoc };
})(typeof window !== 'undefined' ? window : globalThis);

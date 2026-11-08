/*
 * Presets: named study settings you can apply with one tap, like Lightroom
 * presets, and try on across a whole study set.
 *
 * A preset holds the look of a study (not the grid or crop):
 *   tone: 'gray' | 'color' | 'poster'
 *   bands: 0 (all values) or 2..6       posterK: number of main colors
 *   splits: 'auto' (fit to each image) | 'even' | 'fixed' (thresholds below)
 *   thresholds, levelsMode, customLevels, blur
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
    const parts = [{ gray: 'Grayscale', color: 'Color', poster: `${p.posterK || 5} main colors` }[p.tone] || 'Grayscale'];
    if (p.tone !== 'poster') {
      if (p.bands >= 2) {
        parts.push(`${p.bands} values`);
        parts.push({ auto: 'fit to each image', even: 'even splits', fixed: 'fixed splits' }[p.splits || 'fixed']);
        if (p.levelsMode === 'even') parts.push('even steps');
        if (p.levelsMode === 'custom') parts.push('custom values');
      } else parts.push('all values');
    }
    if (p.blur) parts.push('squint');
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

  VST.presets = { all, user, get, save, remove, splitsFor, describe, render, BUILTIN, syncDoc, applySyncDoc };
})(typeof window !== 'undefined' ? window : globalThis);

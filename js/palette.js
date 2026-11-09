/*
 * Limited palette: what a handful of paints can mix, and how much of a
 * picture they reach.
 *
 * Mixing uses spectral.js (Kubelka–Munk theory over 38 bands of the
 * spectrum, MIT license, in js/vendor/), so blue and yellow make green
 * the way paint does. Each paint is a typical masstone color with a
 * tinting strength tuned so its tints behave roughly like the real paint
 * (a little Prussian blue goes a long way). Brands vary; this is a guide.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  // id, name, masstone color, tinting strength, and role ('white' / 'black' / color)
  const PIGMENTS = [
    { id: 'titanium-white', name: 'Titanium white', hex: '#F4F3EE', ts: 1, role: 'white' },
    { id: 'ivory-black', name: 'Ivory black', hex: '#1C1B1A', ts: 4, role: 'black' },
    { id: 'cadmium-yellow', name: 'Cadmium yellow', hex: '#F4C430', ts: 1.3 },
    { id: 'naples-yellow', name: 'Naples yellow', hex: '#E9C77B', ts: 1 },
    { id: 'yellow-ochre', name: 'Yellow ochre', hex: '#C79A3B', ts: 1.4 },
    { id: 'cadmium-orange', name: 'Cadmium orange', hex: '#ED872D', ts: 1.4 },
    { id: 'cadmium-red', name: 'Cadmium red light', hex: '#D9381E', ts: 1.6 },
    { id: 'vermilion', name: 'Vermilion', hex: '#E34234', ts: 1.5 },
    { id: 'alizarin', name: 'Alizarin crimson', hex: '#8F1D21', ts: 3 },
    { id: 'quinacridone-rose', name: 'Quinacridone rose', hex: '#C32148', ts: 2 },
    { id: 'indian-red', name: 'Indian red', hex: '#8F3B32', ts: 2.5 },
    { id: 'burnt-sienna', name: 'Burnt sienna', hex: '#8A3324', ts: 2.2 },
    { id: 'raw-umber', name: 'Raw umber', hex: '#63513D', ts: 2.5 },
    { id: 'burnt-umber', name: 'Burnt umber', hex: '#5A3A28', ts: 3 },
    { id: 'dioxazine-purple', name: 'Dioxazine purple', hex: '#3E2253', ts: 6 },
    { id: 'ultramarine', name: 'Ultramarine blue', hex: '#2A3F9D', ts: 3 },
    { id: 'prussian-blue', name: 'Prussian blue', hex: '#0B2A4A', ts: 6 },
    { id: 'phthalo-blue', name: 'Phthalo blue', hex: '#12267A', ts: 8 },
    { id: 'cerulean', name: 'Cerulean blue', hex: '#2E7FB8', ts: 1.6 },
    { id: 'viridian', name: 'Viridian', hex: '#40826D', ts: 2 },
    { id: 'phthalo-green', name: 'Phthalo green', hex: '#0B4F3C', ts: 7 },
    { id: 'sap-green', name: 'Sap green', hex: '#507D2A', ts: 2.5 },
    // added for the artists' palettes (typical masstones; tinting strengths by eye, like the rest)
    { id: 'cadmium-lemon', name: 'Cadmium lemon', hex: '#EFE22F', ts: 1.2 },
    { id: 'cadmium-yellow-pale', name: 'Cadmium yellow pale', hex: '#F6DA3A', ts: 1.2 },
    { id: 'cadmium-yellow-light', name: 'Cadmium yellow light', hex: '#F5CF2E', ts: 1.3 },
    { id: 'cadmium-yellow-deep', name: 'Cadmium yellow deep', hex: '#EFA322', ts: 1.4 },
    { id: 'naples-yellow-deep', name: 'Naples yellow deep', hex: '#E6B460', ts: 1 },
    { id: 'yellow-ochre-pale', name: 'Yellow ochre pale', hex: '#D6AA55', ts: 1.3 },
    { id: 'green-gold', name: 'Green gold', hex: '#A39A22', ts: 2 },
    { id: 'cadmium-scarlet', name: 'Cadmium scarlet', hex: '#E2471F', ts: 1.6 },
    { id: 'cadmium-red-medium', name: 'Cadmium red', hex: '#C9291E', ts: 1.7 },
    { id: 'permanent-red', name: 'Permanent red', hex: '#D8322B', ts: 1.6 },
    { id: 'winsor-red', name: 'Winsor red', hex: '#CC2029', ts: 1.8 },
    { id: 'terra-rosa', name: 'Terra rosa', hex: '#A44A3A', ts: 2 },
    { id: 'venetian-red', name: 'Venetian red', hex: '#9C3B2D', ts: 2.2 },
    { id: 'transparent-oxide-red', name: 'Transparent oxide red', hex: '#8E3A1C', ts: 2.2 },
    { id: 'transparent-oxide-brown', name: 'Transparent oxide brown', hex: '#5E3A22', ts: 2.5 },
    { id: 'permanent-magenta', name: 'Permanent magenta', hex: '#8A2B60', ts: 2.5 },
    { id: 'ruby-violet', name: 'Ruby violet', hex: '#6E1F42', ts: 3 },
    { id: 'ultramarine-deep', name: 'Ultramarine blue deep', hex: '#243392', ts: 3 },
    { id: 'cobalt-blue', name: 'Cobalt blue', hex: '#2F57A6', ts: 1.8 },
    { id: 'manganese-blue', name: 'Manganese blue', hex: '#1E8CB2', ts: 2 },
    { id: 'permanent-green-light', name: 'Permanent green light', hex: '#5DAA3C', ts: 1.8 },
    { id: 'neutral-grey', name: 'Neutral grey', hex: '#6F6E6B', ts: 1.5 },
    { id: 'raw-sienna-light', name: 'Raw sienna light', hex: '#C68A3F', ts: 1.6 },
    { id: 'english-red', name: 'English red', hex: '#A6402E', ts: 2.2 },
    { id: 'naples-yellow-light', name: 'Naples yellow light', hex: '#EEDAA2', ts: 0.9 },
    { id: 'emerald-green', name: 'Emerald green', hex: '#1F9A6C', ts: 2 },
    { id: 'viridian-deep', name: 'Viridian deep', hex: '#2C6550', ts: 2.2 },
    { id: 'cobalt-violet', name: 'Cobalt violet', hex: '#8B4FA6', ts: 1.2 },
    { id: 'lead-white', name: 'Lead white', hex: '#F1EDE2', ts: 0.8, role: 'white' },
  ];

  const PRESETS = [
    { id: 'pov', name: 'Prussian blue, yellow ochre, vermilion', paints: ['prussian-blue', 'yellow-ochre', 'vermilion', 'ivory-black', 'titanium-white'] },
    { id: 'zorn', name: 'Zorn (ochre, vermilion, black)', paints: ['yellow-ochre', 'vermilion', 'ivory-black', 'titanium-white'] },
    { id: 'primaries', name: 'Warm primaries (cad yellow, cad red, ultramarine)', paints: ['cadmium-yellow', 'cadmium-red', 'ultramarine', 'titanium-white'] },
    { id: 'cool-primaries', name: 'Cool primaries (cad yellow, quin rose, phthalo blue)', paints: ['cadmium-yellow', 'quinacridone-rose', 'phthalo-blue', 'titanium-white'] },
    { id: 'earth', name: 'Earth palette (ochre, sienna, umber, ultramarine)', paints: ['yellow-ochre', 'burnt-sienna', 'burnt-umber', 'ultramarine', 'titanium-white'] },
    { id: 'split', name: 'Split primaries (two yellows, two reds, two blues)', paints: ['cadmium-yellow', 'yellow-ochre', 'cadmium-red', 'alizarin', 'ultramarine', 'phthalo-blue', 'titanium-white'] },
    // artists' palettes, as each artist lists them; `source` says where (brands vary, so the
    // paints are typical colors, and two alizarins or similar duplicates count once)
    { id: 'schmid', group: 'artist', name: 'Richard Schmid', source: 'His main palette, as listed on richardschmid.com (Tools & Materials).', paints: ['cadmium-lemon', 'cadmium-yellow-light', 'cadmium-yellow-deep', 'cadmium-orange', 'cadmium-red-medium', 'alizarin', 'terra-rosa', 'yellow-ochre-pale', 'transparent-oxide-red', 'transparent-oxide-brown', 'viridian', 'phthalo-green', 'cobalt-blue', 'ultramarine-deep', 'titanium-white'] },
    { id: 'keys', group: 'artist', name: 'Daniel Keys', source: 'As listed on his supply list (danieljkeys.com). Permanent rose is shown as quinacridone rose.', paints: ['alizarin', 'cadmium-red-medium', 'cadmium-yellow-pale', 'quinacridone-rose', 'permanent-magenta', 'terra-rosa', 'yellow-ochre-pale', 'green-gold', 'cadmium-lemon', 'cadmium-yellow-deep', 'cadmium-orange', 'transparent-oxide-red', 'transparent-oxide-brown', 'ultramarine-deep', 'viridian', 'titanium-white'] },
    { id: 'klein', group: 'artist', name: 'Michael Klein', source: 'As shown on his palette in a video.', paints: ['cadmium-yellow-pale', 'raw-sienna-light', 'cadmium-orange', 'burnt-sienna', 'alizarin', 'raw-umber', 'burnt-umber', 'cobalt-blue', 'ultramarine', 'cobalt-violet', 'viridian-deep', 'ivory-black', 'titanium-white'] },
    { id: 'gennari', group: 'artist', name: 'Jennifer Gennari', source: 'As listed for her 2026 animal painting workshop (nataliafabia.com).', paints: ['naples-yellow-light', 'yellow-ochre', 'english-red', 'vermilion', 'alizarin', 'cobalt-blue', 'viridian', 'emerald-green', 'ivory-black', 'lead-white'] },
    { id: 'christensen-start', group: 'artist', name: 'Scott Christensen, starter set', source: 'The colors he suggests starting with, from his Adventure of Painting supply list (Vasari).', paints: ['permanent-red', 'venetian-red', 'cadmium-lemon', 'yellow-ochre', 'cobalt-blue', 'ultramarine', 'titanium-white'] },
    { id: 'christensen', group: 'artist', name: 'Scott Christensen', source: 'His foundational palette, from his Adventure of Painting supply list (Vasari). His eight premixed grays aren’t included; the palette can mix them.', paints: ['permanent-red', 'venetian-red', 'ruby-violet', 'cadmium-lemon', 'cadmium-yellow-deep', 'yellow-ochre', 'cobalt-blue', 'ultramarine', 'viridian', 'titanium-white'] },
    { id: 'christensen-gouache', group: 'artist', name: 'Scott Christensen, gouache', source: 'His gouache palette, from his Adventure of Painting supply list (Winsor & Newton). Mixed the same way as oils, so a rougher guide.', paints: ['winsor-red', 'venetian-red', 'alizarin', 'naples-yellow-deep', 'cadmium-yellow-pale', 'permanent-green-light', 'cobalt-blue', 'ultramarine', 'phthalo-blue', 'viridian', 'neutral-grey', 'titanium-white'] },
    { id: 'macpherson', group: 'artist', name: 'Kevin Macpherson', source: 'As he describes it in an Artists Network interview (found by search, not yet read directly).', paints: ['cadmium-yellow-light', 'cadmium-red', 'alizarin', 'ultramarine', 'phthalo-green', 'titanium-white'] },
    { id: 'paquet', group: 'artist', name: 'Joe Paquet', source: 'His plein air palette, as described in Artists Network (found by search, not yet read directly).', paints: ['cadmium-yellow-light', 'cadmium-yellow', 'cadmium-orange', 'cadmium-scarlet', 'cadmium-red-medium', 'alizarin', 'manganese-blue', 'cobalt-blue', 'ultramarine', 'ivory-black', 'lead-white'] },
    { id: 'hanson', group: 'artist', name: 'Marc Hanson, three colors', source: 'His three-color plein air palette, as reported by another painter (secondhand).', paints: ['cadmium-yellow-light', 'permanent-red', 'ultramarine', 'titanium-white'] },
  ];

  const REACH = 10; // ΔE (Lab distance) within which a mix counts as a match
  const byId = new Map(PIGMENTS.map((p) => [p.id, p]));

  /** The palette's paints, in a stable order (colors first, then black and white). */
  function paintsFor(ids) {
    const order = (p) => (p.role === 'white' ? 2 : p.role === 'black' ? 1 : 0);
    return ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((p, q) => order(p) - order(q) || PIGMENTS.indexOf(p) - PIGMENTS.indexOf(q));
  }

  /** Every way to split `total` parts among `k` paints, each getting at least one. */
  function compositions(total, k) {
    if (k === 1) return [[total]];
    const out = [];
    for (let first = 1; first <= total - k + 1; first++) {
      for (const rest of compositions(total - first, k - 1)) out.push([first, ...rest]);
    }
    return out;
  }

  function subsets(arr, maxSize) {
    const out = [];
    const walk = (start, cur) => {
      if (cur.length) out.push(cur.slice());
      if (cur.length === maxSize) return;
      for (let i = start; i < arr.length; i++) {
        cur.push(arr[i]);
        walk(i + 1, cur);
        cur.pop();
      }
    };
    walk(0, []);
    return out;
  }

  // finer to coarser sampling, picked by palette size so large palettes stay quick
  const LEVELS = [
    { whites: [0, 0.04, 0.1, 0.18, 0.28, 0.4, 0.52, 0.64, 0.76, 0.86, 0.94], blacks: [0, 0.04, 0.1, 0.2, 0.35, 0.55], pair: [0.02, 0.05, 0.09, 0.14, 0.2, 0.28, 0.37, 0.5, 0.63, 0.72, 0.8, 0.86, 0.91, 0.95, 0.98], parts: 8 },
    { whites: [0, 0.06, 0.16, 0.3, 0.46, 0.62, 0.78, 0.9], blacks: [0, 0.08, 0.25, 0.5], pair: [0.04, 0.12, 0.25, 0.4, 0.6, 0.75, 0.88, 0.96], parts: 6 },
    { whites: [0, 0.1, 0.3, 0.55, 0.8, 0.92], blacks: [0, 0.15, 0.45], pair: [0.08, 0.25, 0.5, 0.75, 0.92], parts: 5 },
    { whites: [0, 0.15, 0.45, 0.75, 0.9], blacks: [0, 0.3], pair: [0.15, 0.5, 0.85], parts: 4 },
  ];
  const BUDGET = 40000; // about how many mixes to work out (a 6-color palette at the finest level)

  /** The finest sampling whose number of mixes fits the budget. */
  function levelFor(k, hasWhite, hasBlack) {
    const c2 = (k * (k - 1)) / 2;
    const c3 = (k * (k - 1) * (k - 2)) / 6;
    for (const lv of LEVELS) {
      const tints = (hasWhite ? lv.whites.length : 1) * (hasBlack ? lv.blacks.length : 1);
      const n = (k + c2 * lv.pair.length + c3 * compositions(lv.parts, 3).length) * tints;
      if (n <= BUDGET) return lv;
    }
    return LEVELS[LEVELS.length - 1];
  }

  /**
   * Samples what the palette can mix: up to three colors at a time, in
   * several proportions, each lightened with white and darkened with black
   * where the palette has them. Larger palettes are sampled more coarsely
   * (they overlap more, and stay quick). Returns a model for nearest-mix
   * lookups. `spectral` is the spectral.js module; `toLab(r, g, b)` returns
   * [L, a, b]. With `include`, only the mixes that use that paint are made
   * (what adding it would bring, for gain()).
   */
  function build(ids, spectral, toLab, { include } = {}) {
    const paints = paintsFor(ids);
    const colors = paints.filter((p) => !p.role);
    const white = paints.find((p) => p.role === 'white');
    const black = paints.find((p) => p.role === 'black');
    const sp = new Map();
    for (const p of paints) {
      const c = new spectral.Color(p.hex);
      c.tintingStrength = p.ts;
      sp.set(p.id, c);
    }
    const lv = levelFor(colors.length, !!white, !!black);
    const whites = white ? lv.whites : [0];
    const blacks = black ? lv.blacks : [0];
    // pairs get fine steps, closer together at the ends, where a touch of a
    // strong paint already changes a lot; three-color mixes get coarser steps
    const PAIR = lv.pair;
    const triples = compositions(lv.parts, 3);
    const bases = [];
    for (const set of subsets(colors, 3)) {
      if (set.length === 1) bases.push([[set[0].id, 1]]);
      else if (set.length === 2) for (const f of PAIR) bases.push([[set[0].id, f], [set[1].id, 1 - f]]);
      else {
        for (const parts of triples) {
          const sum = parts.reduce((s, v) => s + v, 0);
          bases.push(set.map((p, i) => [p.id, parts[i] / sum]));
        }
      }
    }
    if (!bases.length) bases.push([]); // only black and/or white: grays
    const mixes = [];
    const seen = new Set();
    const add = (parts) => {
      const used = parts.filter(([, f]) => f > 0);
      if (!used.length) return;
      if (include && !used.some(([id]) => id === include)) return;
      const c = used.length === 1 ? sp.get(used[0][0]) : spectral.mix(...used.map(([id, f]) => [sp.get(id), f]));
      const rgb = c.sRGB.map((v) => Math.max(0, Math.min(255, Math.round(v))));
      const [L, a, b] = toLab(rgb[0], rgb[1], rgb[2]);
      const key = `${Math.round(L)}|${Math.round(a)}|${Math.round(b)}`;
      if (seen.has(key)) return;
      seen.add(key);
      mixes.push({ L, a, b, rgb, parts: used });
    };
    for (const base of bases) {
      for (const w of whites) {
        for (const k of blacks) {
          if (w + k >= 1) continue;
          const rest = 1 - w - k;
          const parts = base.map(([id, f]) => [id, f * rest]);
          if (white && w) parts.push([white.id, w]);
          if (black && k) parts.push([black.id, k]);
          add(parts);
        }
      }
    }
    // grays from black and white alone
    if (white && black) for (const k of [0.02, 0.05, 0.1, 0.2, 0.35, 0.55, 0.8]) add([[black.id, k], [white.id, 1 - k]]);
    return { ids: paints.map((p) => p.id), mixes, grid: makeGrid(mixes), cache: new Map() };
  }

  /* ---------- nearest mix, with a coarse 3D grid to search quickly ---------- */

  const CELL = 6;
  const gkey = (x, y, z) => (x + 50) * 10000 + (y + 50) * 100 + (z + 50);

  function makeGrid(mixes) {
    const grid = new Map();
    mixes.forEach((m, i) => {
      const k = gkey(Math.floor(m.L / CELL), Math.floor(m.a / CELL), Math.floor(m.b / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    return grid;
  }

  /**
   * The closest mix to a Lab color: { i, d } (index into model.mixes, ΔE
   * distance). `skip(mix)`, if given, leaves some mixes out (for example
   * those that use a paint, to see the palette without it).
   */
  function nearest(model, L, a, b, skip) {
    const gx = Math.floor(L / CELL);
    const gy = Math.floor(a / CELL);
    const gz = Math.floor(b / CELL);
    let best = -1;
    let bestD2 = Infinity;
    for (let r = 0; r <= 2; r++) {
      // look at the shell of cells r away
      for (let x = gx - r; x <= gx + r; x++) {
        for (let y = gy - r; y <= gy + r; y++) {
          for (let z = gz - r; z <= gz + r; z++) {
            if (Math.max(Math.abs(x - gx), Math.abs(y - gy), Math.abs(z - gz)) !== r) continue;
            const list = model.grid.get(gkey(x, y, z));
            if (!list) continue;
            for (const i of list) {
              const m = model.mixes[i];
              if (skip && skip(m)) continue;
              const d2 = (m.L - L) ** 2 + (m.a - a) ** 2 + (m.b - b) ** 2;
              if (d2 < bestD2) {
                bestD2 = d2;
                best = i;
              }
            }
          }
        }
      }
      // anything in a farther shell is at least r * CELL away
      if (best >= 0 && Math.sqrt(bestD2) <= r * CELL) return { i: best, d: Math.sqrt(bestD2) };
    }
    // far from every mix (out of the palette's reach): check them all
    for (let i = 0; i < model.mixes.length; i++) {
      const m = model.mixes[i];
      if (skip && skip(m)) continue;
      const d2 = (m.L - L) ** 2 + (m.a - a) ** 2 + (m.b - b) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return { i: best, d: Math.sqrt(bestD2) };
  }

  /**
   * Whether some mix is within `limit` (ΔE) of a Lab color. Faster than
   * nearest() for colors out of reach: it only looks as far as `limit`.
   */
  function within(model, L, a, b, limit = REACH, skip) {
    const gx = Math.floor(L / CELL);
    const gy = Math.floor(a / CELL);
    const gz = Math.floor(b / CELL);
    const r = Math.ceil(limit / CELL);
    const lim2 = limit * limit;
    for (let x = gx - r; x <= gx + r; x++) {
      for (let y = gy - r; y <= gy + r; y++) {
        for (let z = gz - r; z <= gz + r; z++) {
          const list = model.grid.get(gkey(x, y, z));
          if (!list) continue;
          for (const i of list) {
            const m = model.mixes[i];
            if (skip && skip(m)) continue;
            if ((m.L - L) ** 2 + (m.a - a) ** 2 + (m.b - b) ** 2 <= lim2) return true;
          }
        }
      }
    }
    return false;
  }

  /** nearest(), remembered for colors within about 2 units (ΔE under 2), for whole images. */
  function nearestCached(model, L, a, b) {
    const key = (Math.round(L / 2) + 10) * 1000000 + (Math.round(a / 2) + 200) * 1000 + (Math.round(b / 2) + 200);
    let hit = model.cache.get(key);
    if (!hit) {
      hit = nearest(model, L, a, b);
      model.cache.set(key, hit);
    }
    return hit;
  }

  /**
   * How much of a picture (its color cells, { L, a, b, share }) the palette
   * reaches. Returns { reached, outShare, outCells, outHue (Lab angle or null) }.
   * `skip` leaves some mixes out, as in nearest().
   */
  function reach(model, cells, limit = REACH, skip) {
    let reached = 0;
    let ox = 0;
    let oy = 0;
    const outCells = new Set();
    for (const c of cells) {
      if (within(model, c.L, c.a, c.b, limit, skip)) reached += c.share;
      else {
        outCells.add(c);
        ox += c.a * c.share;
        oy += c.b * c.share;
      }
    }
    const outHue = Math.hypot(ox, oy) > 1e-3 ? ((Math.atan2(oy, ox) * 180) / Math.PI + 360) % 360 : null;
    return { reached, outShare: Math.max(0, 1 - reached), outCells, outHue };
  }

  /**
   * Repaints a Lab image ({ L, A, B }) with the palette's nearest mixes into
   * RGBA bytes `out`. With `mark`, thin diagonal lines (sized to the image,
   * light on dark mixes and dark on light ones) stripe what it can't reach.
   * Returns how many pixels each mix covers (Map: mix index -> count).
   */
  function paint(model, lab, out, width, { mark = true } = {}) {
    const n = lab.L.length;
    const counts = new Map();
    const w = width || n;
    const period = Math.max(8, Math.round(w / 70));
    const line = Math.max(2, Math.round(period * 0.28));
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const hit = nearestCached(model, lab.L[i], lab.A[i], lab.B[i]);
      const m = model.mixes[hit.i];
      counts.set(hit.i, (counts.get(hit.i) || 0) + 1);
      let r = m.rgb[0];
      let g = m.rgb[1];
      let b = m.rgb[2];
      if (mark && hit.d > REACH && ((i % w) + ((i / w) | 0)) % period < line) {
        const ink = m.L > 55 ? 0 : 255;
        r = r * 0.35 + ink * 0.65;
        g = g * 0.35 + ink * 0.65;
        b = b * 0.35 + ink * 0.65;
      }
      out[j] = r;
      out[j + 1] = g;
      out[j + 2] = b;
      out[j + 3] = 255;
    }
    return counts;
  }

  /**
   * The palettes to try for "which paint would help": the palette with each
   * paint it doesn't have added, and (if it has more than one) with each of
   * its paints taken out. [{ kind: 'add' | 'drop', id, ids }]
   */
  /**
   * What adding a paint would reach: `base` is the palette's reach() and
   * `extra` a build() with `include` (only the mixes that use the new paint).
   * Only the colors out of reach can gain. Returns { reached, outCells } like reach().
   */
  function gain(base, extra, limit = REACH) {
    const outCells = new Set();
    let reached = base.reached;
    for (const c of base.outCells) {
      if (within(extra, c.L, c.a, c.b, limit)) reached += c.share;
      else outCells.add(c);
    }
    return { reached, outCells };
  }

  /** A skip rule for nearest() and reach(): leave out every mix that uses this paint. */
  const without = (id) => (m) => m.parts.some(([p]) => p === id);

  function variations(ids) {
    const have = paintsFor(ids).map((p) => p.id);
    const out = [];
    for (const p of PIGMENTS) if (!have.includes(p.id)) out.push({ kind: 'add', id: p.id, ids: [...have, p.id] });
    if (have.length > 1) for (const id of have) out.push({ kind: 'drop', id, ids: have.filter((x) => x !== id) });
    return out;
  }

  /**
   * Ranks tried variations against the palette's own reach: the paints that
   * add the most, and the ones it needs least. `tried` is
   * [{ kind, id, reached, outCells }]; `base` is the palette's reach().
   * Returns { adds: [{ id, gain, gained (cells newly reached) }], drops: [{ id, loss }] },
   * adds by gain and drops by loss, both largest effect first for adds and
   * smallest loss first for drops.
   */
  function rank(base, tried) {
    const adds = tried
      .filter((t) => t.kind === 'add')
      .map((t) => ({ id: t.id, gain: t.reached - base.reached, gained: [...base.outCells].filter((c) => !t.outCells.has(c)) }))
      .sort((p, q) => q.gain - p.gain || PIGMENTS.indexOf(byId.get(p.id)) - PIGMENTS.indexOf(byId.get(q.id)));
    const drops = tried
      .filter((t) => t.kind === 'drop')
      .map((t) => ({ id: t.id, loss: Math.max(0, base.reached - t.reached) }))
      .sort((p, q) => p.loss - q.loss);
    return { adds, drops };
  }

  /** "mostly yellow ochre and titanium white, a touch of vermilion" (roughly; paint brands vary). */
  function recipe(parts) {
    const total = parts.reduce((s, [, f]) => s + f, 0) || 1;
    const named = parts
      .map(([id, f]) => [byId.get(id) ? byId.get(id).name.toLowerCase() : id, f / total])
      .sort((p, q) => q[1] - p[1]);
    if (named.length === 1) return named[0][0];
    const mostly = named.filter(([, f]) => f >= 0.4).map(([n]) => n);
    const some = named.filter(([, f]) => f >= 0.15 && f < 0.4).map(([n]) => n);
    const touch = named.filter(([, f]) => f < 0.15).map(([n]) => n);
    const join = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]);
    const out = [];
    if (mostly.length) out.push(`mostly ${join(mostly)}`);
    if (some.length) out.push(`${mostly.length ? 'some ' : ''}${join(some)}`);
    if (touch.length) out.push(`a touch of ${join(touch)}`);
    return out.join(', ');
  }

  VST.palette = { PIGMENTS, PRESETS, REACH, byId, paintsFor, compositions, build, nearest, nearestCached, reach, within, gain, without, paint, variations, rank, recipe };
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Value Study: UI wiring. Image loading, the study pipeline, grid overlay,
 * downloads, the museum library and the session timer.
 */
(function () {
  'use strict';
  const VST = window.VST;
  const P = VST.process;
  const C = VST.color;
  const T = VST.timer;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const WORK_MAX = 1400; // preview processing size (long side, px)
  const EXPORT_MAX = 2400; // download size (long side, px)

  /* ================= Settings (remembered in this browser) ================= */

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(`value-study:${key}`);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`value-study:${key}`, JSON.stringify(value));
      } catch (e) {
        /* private mode or storage full: settings just won't persist */
      }
    },
  };

  const DEFAULTS = {
    mode: 'reference',
    view: 'both',
    flip: false,
    style: 'values',
    bands: 4,
    thresholds: {}, // per number of values, e.g. { 4: [25, 50, 75] }
    levelsMode: 'even',
    customLevels: {}, // per number of values, L* 0..100
    valuesColor: false,
    posterColor: true,
    posterK: 5,
    blur: 0,
    grid: { on: false, cols: 3, rows: 3, diag: false, color: 'black', opacity: 70 },
    exportFormat: 'png',
    exportGrid: true,
    timerVisible: false,
    minutes: 10,
    rounds: 1,
    breakSec: 10,
    chime: true,
    paintingsOnly: true,
  };

  function loadSettings() {
    const saved = store.get('settings', {}) || {};
    const s = { ...DEFAULTS, ...saved };
    s.grid = { ...DEFAULTS.grid, ...(saved.grid || {}) };
    return s;
  }
  const S = loadSettings();
  let saveTimer = 0;
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    store.set('settings', S);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 250);
  }
  // don't lose the last changes when the tab is closed, reloaded or backgrounded
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });

  /* ================= State ================= */

  const img = { el: null, w: 0, h: 0, crop: null, cropPreset: 'free', cropLandscape: null, meta: null, name: 'reference', url: null };
  const work = { w: 0, h: 0, rgba: null, lab0: null, lab: null, blurKey: null, hist: null, centroids: null, centroidKey: null, shares: [] };

  const cvOrig = $('#cv-original');
  const cvStudy = $('#cv-study');
  const ctxOrig = cvOrig.getContext('2d', { willReadFrequently: true });
  const ctxStudy = cvStudy.getContext('2d');

  /* ================= Small helpers ================= */

  let toastTimer = 0;
  function toast(text, isError = false) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.toggle('error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), isError ? 6500 : 3500);
  }

  function setBusy(on, text = 'Loading…') {
    const el = $('#busy');
    el.textContent = text;
    el.hidden = !on;
  }

  function slug(s) {
    return (
      String(s || 'study')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'study'
    );
  }

  function valueLabel(L) {
    return (Math.round(L / 5) / 2).toFixed(1); // 0–10 scale, half steps
  }

  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    if (t.tagName === 'INPUT') return /^(text|search|url|number|email|password)$/i.test(t.type);
    return t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }

  function setSeg(seg, attr, value) {
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === String(value))));
  }

  /* ================= Loading images ================= */

  function loadImageElement(src, { cors }) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      if (cors) el.crossOrigin = 'anonymous';
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('load'));
      el.src = src;
    });
  }

  function canReadPixels(el) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const x = c.getContext('2d');
      x.drawImage(el, 0, 0, 1, 1);
      x.getImageData(0, 0, 1, 1);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function loadFromFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i.test(file.name || '')) {
      toast('That file isn’t an image.', true);
      return;
    }
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const el = await loadImageElement(url, { cors: false });
      setImage(el, { name: (file.name || 'pasted image').replace(/\.[^.]+$/, ''), objectUrl: url });
    } catch (e) {
      URL.revokeObjectURL(url);
      toast('This browser couldn’t open that image. Try a JPG or PNG.', true);
    } finally {
      setBusy(false);
    }
  }

  const CORS_HELP =
    'That site doesn’t let other pages use its images. Save the image to your device and choose it here, or copy and paste it instead.';

  async function loadFromUrl(url, { meta = null, fallback = null } = {}) {
    setBusy(true);
    try {
      let el;
      try {
        el = await loadImageElement(url, { cors: true });
      } catch (e) {
        if (!fallback) throw e;
        el = await loadImageElement(fallback, { cors: true });
      }
      if (!canReadPixels(el)) throw new Error('cors');
      setImage(el, {
        name: meta ? `${meta.artist} ${meta.title}` : decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.[^.]+$/, ''),
        meta,
      });
      return true;
    } catch (e) {
      const msg = meta
        ? 'Couldn’t load that painting from the museum. Check your connection and try again.'
        : `${CORS_HELP} (Also check that the link points straight to an image file.)`;
      if (!meta) showUrlMsg(msg, true);
      toast(msg, true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function showUrlMsg(text, isError) {
    const el = $('#url-msg');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function setImage(el, { name, meta = null, objectUrl = null }) {
    if (img.url) URL.revokeObjectURL(img.url);
    img.el = el;
    img.w = el.naturalWidth;
    img.h = el.naturalHeight;
    img.crop = null;
    img.cropPreset = 'free';
    img.cropLandscape = null;
    img.meta = meta;
    img.name = name || 'reference';
    img.url = objectUrl;
    showUrlMsg('');
    renderCredit();
    buildSource();
  }

  /* ================= Pipeline ================= */

  function cropRect() {
    return img.crop || { x: 0, y: 0, w: img.w, h: img.h };
  }

  function sizeFor(r, max) {
    const s = Math.min(1, max / Math.max(r.w, r.h));
    return { w: Math.max(1, Math.round(r.w * s)), h: Math.max(1, Math.round(r.h * s)) };
  }

  /** Draws the cropped source into a canvas of the given size and returns its pixels. */
  function drawSource(ctx, w, h) {
    const r = cropRect();
    ctx.canvas.width = w;
    ctx.canvas.height = h;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.el, r.x, r.y, r.w, r.h, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  function buildSource() {
    if (!img.el) return;
    const { w, h } = sizeFor(cropRect(), WORK_MAX);
    let rgba;
    try {
      rgba = drawSource(ctxOrig, w, h);
    } catch (e) {
      toast(CORS_HELP, true);
      return;
    }
    cvStudy.width = w;
    cvStudy.height = h;
    Object.assign(work, { w, h, rgba, lab0: P.computeLab(rgba, w * h), lab: null, blurKey: null, hist: null, centroids: null, centroidKey: null });
    $('#panels').classList.remove('is-empty');
    layout();
    renderStudy();
  }

  /** Blur strength as a Gaussian sigma, relative to image size. */
  function blurSigma(w, h) {
    return (S.blur / 100) * 0.02 * Math.max(w, h);
  }

  function ensureLab() {
    const key = S.blur;
    if (work.lab && work.blurKey === key) return;
    work.lab = P.blurLab(work.lab0, work.w, work.h, blurSigma(work.w, work.h));
    work.blurKey = key;
    work.hist = P.histogram(work.lab.L);
    work.centroids = null;
  }

  function currentThresholds() {
    const t = P.sanitizeThresholds(S.thresholds[S.bands], S.bands);
    S.thresholds[S.bands] = t;
    return t;
  }

  function currentLevels(hist) {
    return P.bandLevels(S.levelsMode, S.bands, currentThresholds(), hist, S.customLevels[S.bands]);
  }

  function ensureCentroids() {
    const key = `${work.blurKey}|${S.posterK}`;
    if (work.centroids && work.centroidKey === key) return;
    work.centroids = P.kmeans(work.lab, S.posterK);
    work.centroidKey = key;
  }

  /** Renders the study for a Lab image into `out` (RGBA). Returns band info. */
  function produceStudy(lab, hist, out) {
    if (S.style === 'gray') {
      P.renderGray(lab, out);
      return null;
    }
    if (S.style === 'poster') {
      const shares = P.renderPoster(lab, work.centroids, S.posterColor, out);
      return work.centroids.map((c, i) => ({ L: c[0], rgb: C.labToRgb8(c[0], c[1], c[2], [0, 0, 0]), share: shares[i] }));
    }
    const levels = currentLevels(hist);
    const shares = P.renderValues(lab, currentThresholds(), levels, S.valuesColor, out);
    return levels.map((L, i) => ({ L, share: shares[i] }));
  }

  function renderStudy() {
    if (!work.rgba) return;
    ensureLab();
    if (S.style === 'poster') ensureCentroids();
    const imageData = ctxStudy.createImageData(work.w, work.h);
    const bands = produceStudy(work.lab, work.hist, imageData.data);
    ctxStudy.putImageData(imageData, 0, 0);
    renderSwatches(bands);
    drawHistogram();
    save();
  }

  let raf = 0;
  function requestStudy() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderStudy();
    });
  }

  /* ================= Layout and grid overlay ================= */

  function layout() {
    const panels = $('#panels');
    panels.dataset.view = S.view;
    if (!work.w) return;
    const ar = work.w / work.h;
    $$('.panel').forEach((panel) => {
      const wrap = panel.querySelector('.frame-wrap');
      const frame = panel.querySelector('.frame');
      const box = wrap.getBoundingClientRect();
      const availH = box.height - 28; // room for the caption
      if (!box.width || availH <= 0) return;
      let w = box.width;
      let h = w / ar;
      if (h > availH) {
        h = availH;
        w = h * ar;
      }
      frame.style.width = `${Math.floor(w)}px`;
      frame.style.height = `${Math.floor(h)}px`;
      frame.classList.toggle('flipped', S.flip);
    });
    drawOverlays();
  }

  const GRID_COLORS = { black: '0,0,0', white: '255,255,255', red: '226,56,56' };

  function drawGrid(ctx, W, H, lineWidth) {
    const g = S.grid;
    if (!g.on) return;
    ctx.save();
    ctx.strokeStyle = `rgba(${GRID_COLORS[g.color] || GRID_COLORS.black},${g.opacity / 100})`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    const cols = Math.max(1, g.cols | 0);
    const rows = Math.max(1, g.rows | 0);
    for (let c = 1; c < cols; c++) {
      const x = Math.round((W * c) / cols) + (lineWidth % 2 ? 0.5 : 0);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let r = 1; r < rows; r++) {
      const y = Math.round((H * r) / rows) + (lineWidth % 2 ? 0.5 : 0);
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    if (g.diag) {
      ctx.moveTo(0, 0);
      ctx.lineTo(W, H);
      ctx.moveTo(W, 0);
      ctx.lineTo(0, H);
    }
    ctx.stroke();
    ctx.strokeRect(lineWidth / 2, lineWidth / 2, W - lineWidth, H - lineWidth);
    ctx.restore();
  }

  function drawOverlays() {
    const dpr = window.devicePixelRatio || 1;
    $$('.frame .overlay').forEach((ov) => {
      const frame = ov.parentElement;
      const W = Math.max(1, Math.round(frame.clientWidth * dpr));
      const H = Math.max(1, Math.round(frame.clientHeight * dpr));
      if (ov.width !== W) ov.width = W;
      if (ov.height !== H) ov.height = H;
      const ctx = ov.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      drawGrid(ctx, W, H, Math.max(1, Math.round(dpr)));
    });
    $('#btn-grid').setAttribute('aria-pressed', String(S.grid.on));
    $('#grid-on').checked = S.grid.on;
  }

  new ResizeObserver(() => layout()).observe($('#panels'));

  /* ================= Study controls ================= */

  function syncStudyControls() {
    setSeg($('#style-seg'), 'style', S.style);
    setSeg($('#bands-seg'), 'n', S.bands);
    setSeg($('#k-seg'), 'k', S.posterK);
    $('#values-ctl').hidden = S.style !== 'values';
    $('#poster-ctl').hidden = S.style !== 'poster';
    $('#color-ctl').hidden = S.style === 'gray';
    $('#keep-color').checked = S.style === 'poster' ? S.posterColor : S.valuesColor;
    $('#keep-color-label').textContent = S.style === 'poster' ? 'Show in color' : 'Keep color (values only change)';
    $('#levels-mode').value = S.levelsMode;
    $('#blur').value = S.blur;
    $('#blur-out').textContent = S.blur ? `${S.blur}` : 'Off';
    const names = { gray: 'Grayscale', values: `${S.bands} values${S.bands === 2 ? ' (notan)' : ''}`, poster: `${S.posterK} main colors` };
    $('#study-caption').textContent = names[S.style] + (S.blur ? ' · squint' : '');
    buildThresholdSliders();
  }

  function buildThresholdSliders() {
    const box = $('#thresholds');
    box.innerHTML = '';
    if (S.style !== 'values') return;
    const t = currentThresholds();
    t.forEach((v, i) => {
      const label = document.createElement('label');
      label.innerHTML = `<span>Split ${i + 1}</span><input type="range" min="1" max="99" step="1"><output></output>`;
      const input = label.querySelector('input');
      const out = label.querySelector('output');
      input.value = v;
      input.setAttribute('aria-label', `Split ${i + 1} between value ${i + 1} and ${i + 2}`);
      out.textContent = valueLabel(v);
      input.addEventListener('input', () => setThreshold(i, +input.value));
      box.appendChild(label);
    });
  }

  function setThreshold(i, v) {
    const t = currentThresholds().slice();
    const min = i === 0 ? 1 : t[i - 1] + 1;
    const max = i === t.length - 1 ? 99 : t[i + 1] - 1;
    t[i] = Math.min(max, Math.max(min, Math.round(v)));
    S.thresholds[S.bands] = t;
    const row = $('#thresholds').children[i];
    if (row) {
      row.querySelector('input').value = t[i];
      row.querySelector('output').textContent = valueLabel(t[i]);
    }
    requestStudy();
  }

  function renderSwatches(bands) {
    const box = $('#swatches');
    box.innerHTML = '';
    $('#swatch-hint').hidden = !bands;
    if (!bands) return;
    const editable = S.style === 'values' && S.levelsMode === 'custom';
    bands.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'swatch';
      const rgb = b.rgb && S.posterColor ? b.rgb : null;
      const g = C.lToGray8(b.L);
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.style.background = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : `rgb(${g},${g},${g})`;
      chip.title = `Value ${valueLabel(b.L)}`;
      el.appendChild(chip);
      if (editable) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '10';
        input.step = '0.5';
        input.value = valueLabel(b.L);
        input.setAttribute('aria-label', `Value for band ${i + 1}`);
        input.addEventListener('change', () => {
          const lv = (S.customLevels[S.bands] || currentLevels(work.hist)).slice();
          lv[i] = Math.min(10, Math.max(0, +input.value || 0)) * 10;
          S.customLevels[S.bands] = lv;
          requestStudy();
        });
        el.appendChild(input);
      } else {
        const v = document.createElement('div');
        v.className = 'v';
        v.textContent = valueLabel(b.L);
        el.appendChild(v);
      }
      const pct = document.createElement('div');
      pct.textContent = `${Math.round(b.share * 100)}%`;
      el.appendChild(pct);
      box.appendChild(el);
    });
  }

  /* Histogram of the image's values with the splits drawn on top. */
  const histCanvas = $('#histogram');
  function drawHistogram() {
    if (S.style !== 'values') return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(histCanvas.clientWidth * dpr));
    const H = Math.max(1, Math.round(histCanvas.clientHeight * dpr));
    histCanvas.width = W;
    histCanvas.height = H;
    const ctx = histCanvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const t = currentThresholds();
    const levels = currentLevels(work.hist);
    const edges = [0, ...t, 100];
    // band backgrounds in their painted values
    for (let b = 0; b < levels.length; b++) {
      const g = C.lToGray8(levels[b]);
      ctx.fillStyle = `rgba(${g},${g},${g},0.55)`;
      ctx.fillRect((edges[b] / 100) * W, 0, ((edges[b + 1] - edges[b]) / 100) * W, H);
    }
    if (work.hist) {
      let max = 0;
      for (let i = 0; i <= 100; i++) max = Math.max(max, work.hist[i]);
      ctx.fillStyle = 'rgba(216,180,106,0.9)';
      const bw = W / 101;
      for (let i = 0; i <= 100; i++) {
        const hgt = max ? Math.sqrt(work.hist[i] / max) * (H - 4) : 0;
        ctx.fillRect(i * bw, H - hgt, Math.max(1, bw - 0.5), hgt);
      }
    }
    ctx.fillStyle = '#fff';
    t.forEach((v) => ctx.fillRect(Math.round((v / 100) * W) - dpr, 0, 2 * dpr, H));
  }

  let histDrag = -1;
  function histValue(e) {
    const r = histCanvas.getBoundingClientRect();
    return Math.min(99, Math.max(1, ((e.clientX - r.left) / r.width) * 100));
  }
  histCanvas.addEventListener('pointerdown', (e) => {
    const v = histValue(e);
    const t = currentThresholds();
    let best = 0;
    t.forEach((tv, i) => {
      if (Math.abs(tv - v) < Math.abs(t[best] - v)) best = i;
    });
    histDrag = best;
    histCanvas.setPointerCapture(e.pointerId);
    setThreshold(best, v);
  });
  histCanvas.addEventListener('pointermove', (e) => {
    if (histDrag >= 0) setThreshold(histDrag, histValue(e));
  });
  ['pointerup', 'pointercancel'].forEach((ev) => histCanvas.addEventListener(ev, () => (histDrag = -1)));

  $('#style-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.style = b.dataset.style;
    syncStudyControls();
    requestStudy();
  });
  $('#bands-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setBands(+b.dataset.n);
  });
  function setBands(n) {
    S.bands = n;
    if (S.style !== 'values') S.style = 'values';
    syncStudyControls();
    requestStudy();
  }
  $('#k-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.posterK = +b.dataset.k;
    syncStudyControls();
    requestStudy();
  });
  $('#btn-auto').addEventListener('click', () => {
    if (!work.hist) return toast('Load an image first.');
    S.thresholds[S.bands] = P.autoThresholds(work.hist, S.bands);
    buildThresholdSliders();
    requestStudy();
  });
  $('#btn-even').addEventListener('click', () => {
    S.thresholds[S.bands] = P.evenThresholds(S.bands);
    buildThresholdSliders();
    requestStudy();
  });
  $('#levels-mode').addEventListener('change', (e) => {
    const mode = e.target.value;
    if (mode === 'custom' && !(S.customLevels[S.bands] && S.customLevels[S.bands].length === S.bands)) {
      S.customLevels[S.bands] = currentLevels(work.hist).map((L) => Math.round(L / 5) * 5);
    }
    S.levelsMode = mode;
    requestStudy();
  });
  $('#keep-color').addEventListener('change', (e) => {
    if (S.style === 'poster') S.posterColor = e.target.checked;
    else S.valuesColor = e.target.checked;
    requestStudy();
  });
  $('#blur').addEventListener('input', (e) => {
    S.blur = +e.target.value;
    $('#blur-out').textContent = S.blur ? `${S.blur}` : 'Off';
    $('#study-caption').textContent = $('#study-caption').textContent.replace(/ · squint$/, '') + (S.blur ? ' · squint' : '');
    requestStudy();
  });

  /* ================= Grid controls ================= */

  function syncGridControls() {
    const g = S.grid;
    $('#grid-on').checked = g.on;
    $('#grid-cols').value = g.cols;
    $('#grid-rows').value = g.rows;
    $('#grid-diag').checked = g.diag;
    $('#grid-color').value = g.color;
    $('#grid-opacity').value = g.opacity;
  }
  function gridChanged() {
    drawOverlays();
    save();
  }
  function toggleGrid(on = !S.grid.on) {
    S.grid.on = on;
    gridChanged();
  }
  $('#grid-on').addEventListener('change', (e) => toggleGrid(e.target.checked));
  $('#btn-grid').addEventListener('click', () => toggleGrid());
  $('#grid-cols').addEventListener('input', (e) => {
    S.grid.cols = Math.min(24, Math.max(1, +e.target.value || 1));
    S.grid.on = true;
    gridChanged();
  });
  $('#grid-rows').addEventListener('input', (e) => {
    S.grid.rows = Math.min(24, Math.max(1, +e.target.value || 1));
    S.grid.on = true;
    gridChanged();
  });
  $('#grid-diag').addEventListener('change', (e) => {
    S.grid.diag = e.target.checked;
    S.grid.on = true;
    gridChanged();
  });
  $('#grid-color').addEventListener('change', (e) => {
    S.grid.color = e.target.value;
    gridChanged();
  });
  $('#grid-opacity').addEventListener('input', (e) => {
    S.grid.opacity = +e.target.value;
    gridChanged();
  });
  $$('[data-grid]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.grid;
      if (v === 'square') {
        // square cells: keep the count along the short side, fit the long side
        const ar = work.w && work.h ? work.w / work.h : 1;
        const short = Math.max(2, Math.min(S.grid.cols, S.grid.rows));
        if (ar >= 1) {
          S.grid.rows = short;
          S.grid.cols = Math.max(1, Math.round(short * ar));
        } else {
          S.grid.cols = short;
          S.grid.rows = Math.max(1, Math.round(short / ar));
        }
      } else {
        S.grid.cols = S.grid.rows = +v;
      }
      S.grid.on = true;
      syncGridControls();
      gridChanged();
    })
  );

  /* ================= View, flip, crop ================= */

  function setView(v) {
    S.view = v;
    setSeg($('#view-seg'), 'view', v);
    layout();
    save();
  }
  $('#view-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setView(b.dataset.view);
  });

  function toggleFlip() {
    S.flip = !S.flip;
    $('#btn-flip').setAttribute('aria-pressed', String(S.flip));
    layout();
    save();
  }
  $('#btn-flip').addEventListener('click', toggleFlip);

  const cropper = VST.crop.create({
    modal: $('#crop-modal'),
    canvas: $('#crop-canvas'),
    preset: $('#crop-preset'),
    orient: $('#crop-orient'),
    info: $('#crop-info'),
    apply: $('#crop-apply'),
    cancel: $('#crop-cancel'),
    reset: $('#crop-reset'),
  });
  function openCrop() {
    if (!img.el) return toast('Load an image first.');
    cropper.open({
      image: img.el,
      rect: img.crop,
      presetId: img.cropPreset,
      landscape: img.cropLandscape,
      onApply(rect, { presetId, landscape }) {
        img.crop = rect;
        img.cropPreset = presetId;
        img.cropLandscape = landscape;
        buildSource();
      },
    });
  }
  $('#btn-crop').addEventListener('click', openCrop);

  /* ================= Downloads ================= */

  function canvasFrom(rgbaOrCanvas, w, h) {
    if (rgbaOrCanvas instanceof HTMLCanvasElement) return rgbaOrCanvas;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(new ImageData(rgbaOrCanvas, w, h), 0, 0);
    return c;
  }

  /** Re-runs the pipeline at download size so files are sharper than the preview. */
  function renderForExport() {
    const { w, h } = sizeFor(cropRect(), EXPORT_MAX);
    const src = document.createElement('canvas');
    const sctx = src.getContext('2d', { willReadFrequently: true });
    const rgba = drawSource(sctx, w, h);
    const lab = P.blurLab(P.computeLab(rgba, w * h), w, h, blurSigma(w, h));
    const hist = P.histogram(lab.L);
    ensureLab();
    if (S.style === 'poster') ensureCentroids(); // same palette as the preview
    const out = new Uint8ClampedArray(w * h * 4);
    const bands = produceStudy(lab, hist, out);
    return { w, h, original: src, study: canvasFrom(out, w, h), bands };
  }

  /** Applies flip and (optionally) the grid, returning a new canvas. */
  function finish(source, withGrid) {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext('2d');
    if (S.flip) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (withGrid) drawGrid(ctx, c.width, c.height, Math.max(2, Math.round(Math.max(c.width, c.height) / 900)));
    return c;
  }

  function download(canvas, name) {
    const type = S.exportFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = S.exportFormat === 'jpeg' ? 'jpg' : 'png';
    let target = canvas;
    if (type === 'image/jpeg') {
      // JPG has no transparency: flatten onto white
      target = document.createElement('canvas');
      target.width = canvas.width;
      target.height = canvas.height;
      const ctx = target.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.drawImage(canvas, 0, 0);
    }
    target.toBlob(
      (blob) => {
        if (!blob) return toast('Couldn’t create the file.', true);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      },
      type,
      0.92
    );
  }

  function studyName() {
    const parts = { gray: 'grayscale', values: `${S.bands}-values`, poster: `${S.posterK}-colors` };
    return `${slug(img.name)}-${parts[S.style]}`;
  }

  function exportGuard() {
    if (!img.el) {
      toast('Load an image first.');
      return false;
    }
    return true;
  }

  function downloadStudy() {
    if (!exportGuard()) return;
    try {
      const r = renderForExport();
      download(finish(r.study, S.exportGrid && S.grid.on), studyName());
    } catch (e) {
      toast(CORS_HELP, true);
    }
  }

  function downloadOriginal() {
    if (!exportGuard()) return;
    try {
      const r = renderForExport();
      download(finish(r.original, S.exportGrid && S.grid.on), `${slug(img.name)}-reference`);
    } catch (e) {
      toast(CORS_HELP, true);
    }
  }

  /** Letter-size landscape sheet: original and study side by side, values below. */
  function downloadSheet() {
    if (!exportGuard()) return;
    let r;
    try {
      r = renderForExport();
    } catch (e) {
      return toast(CORS_HELP, true);
    }
    const withGrid = S.exportGrid && S.grid.on;
    const W = 3300;
    const H = 2550;
    const m = 120;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#222';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const title = img.meta ? `${img.meta.title}` : img.name;
    ctx.fillText(title.length > 80 ? `${title.slice(0, 79)}…` : title, m, m + 30);
    ctx.font = '36px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillStyle = '#555';
    const sub = img.meta ? `${img.meta.artist}${img.meta.date ? `, ${img.meta.date}` : ''} · ${img.meta.credit}` : $('#study-caption').textContent;
    ctx.fillText(sub, m, m + 90);

    const top = m + 150;
    const swatchH = r.bands ? 210 : 0;
    const boxW = (W - m * 3) / 2;
    const boxH = H - top - m - swatchH;
    const place = (canvas, x0) => {
      const s = Math.min(boxW / canvas.width, boxH / canvas.height);
      const w = canvas.width * s;
      const h = canvas.height * s;
      const x = x0 + (boxW - w) / 2;
      const y = top + (boxH - h) / 2;
      ctx.drawImage(canvas, x, y, w, h);
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
    };
    place(finish(r.original, withGrid), m);
    place(finish(r.study, withGrid), m * 2 + boxW);

    if (r.bands) {
      const y = H - m - swatchH + 50;
      const sw = Math.min(260, (W - m * 2) / r.bands.length - 20);
      ctx.font = '34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      r.bands.forEach((b, i) => {
        const x = m + i * (sw + 20);
        const g = C.lToGray8(b.L);
        const rgb = b.rgb && S.posterColor ? b.rgb : [g, g, g];
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(x, y, sw, 90);
        ctx.strokeStyle = '#bbb';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, sw, 90);
        ctx.fillStyle = '#333';
        ctx.fillText(`Value ${valueLabel(b.L)} · ${Math.round(b.share * 100)}%`, x, y + 140);
      });
    }
    download(c, `${studyName()}-sheet`);
  }

  $('#btn-dl-study').addEventListener('click', downloadStudy);
  $('#btn-download').addEventListener('click', downloadStudy);
  $('#btn-dl-original').addEventListener('click', downloadOriginal);
  $('#btn-dl-sheet').addEventListener('click', downloadSheet);
  $('#export-format').addEventListener('change', (e) => {
    S.exportFormat = e.target.value;
    save();
  });
  $('#export-grid').addEventListener('change', (e) => {
    S.exportGrid = e.target.checked;
    save();
  });

  /* ================= Credit line ================= */

  function renderCredit() {
    const el = $('#credit');
    el.textContent = '';
    if (!img.meta) return;
    const m = img.meta;
    const a = document.createElement('a');
    a.href = m.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = m.title;
    el.append(a, `, ${m.artist}${m.date ? ` (${m.date})` : ''} · ${m.credit}`);
  }

  /* ================= Modes ================= */

  function setMode(mode) {
    S.mode = mode;
    $$('.tabs [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
    $('#sec-reference').hidden = mode !== 'reference';
    $('#sec-master').hidden = mode !== 'master';
    $('#empty-reference').hidden = mode !== 'reference';
    $('#empty-master').hidden = mode !== 'master';
    updateTimerUi();
    save();
  }
  $$('.tabs [role="tab"]').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

  /* ================= Reference mode inputs ================= */

  $('#file-input').addEventListener('change', (e) => {
    loadFromFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#file-input-2').addEventListener('change', (e) => {
    loadFromFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#url-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#url-input').value.trim();
    if (!/^https?:\/\//i.test(url)) return showUrlMsg('Enter a link starting with https://', true);
    showUrlMsg('Loading…');
    loadFromUrl(url);
  });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
    const fileItem = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (fileItem) {
      e.preventDefault();
      loadFromFile(fileItem.getAsFile());
      return;
    }
    if (isTyping(e)) return;
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (text && /^https?:\/\/\S+$/i.test(text.trim())) {
      e.preventDefault();
      $('#url-input').value = text.trim();
      loadFromUrl(text.trim());
    }
  });

  const stage = $('#stage');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    stage.classList.add('drag-over');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) stage.classList.remove('drag-over');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    stage.classList.remove('drag-over');
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files[0]) return loadFromFile(dt.files[0]);
    const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0].trim();
    if (/^https?:\/\//i.test(uri)) loadFromUrl(uri);
  });

  /* ================= Master Copy: library ================= */

  const museum = VST.museum.sources.aic;
  let queue = (store.get('queue', []) || []).filter((q) => q && q.image);
  const search = { q: '', page: 0, totalPages: 0, items: [], controller: null };

  function setSearchMsg(text, isError) {
    const el = $('#search-msg');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  async function runSearch(q, more = false) {
    q = q.trim();
    if (!q) return;
    if (search.controller) search.controller.abort();
    const controller = new AbortController();
    search.controller = controller;
    if (!more) {
      Object.assign(search, { q, page: 0, totalPages: 1, items: [] });
      $('#results').innerHTML = '';
    }
    setSearchMsg('Searching…');
    $('#btn-more').hidden = true;
    let added = 0;
    try {
      // keep fetching pages until there is something to show
      for (let tries = 0; tries < 4 && search.page < search.totalPages && added < 8; tries++) {
        const res = await museum.search(q, search.page + 1, controller.signal);
        search.page = res.page;
        search.totalPages = res.totalPages;
        const fresh = res.items.filter((it) => !S.paintingsOnly || /painting/i.test(it.type));
        search.items.push(...fresh);
        fresh.forEach(addResultCard);
        added += fresh.length;
      }
      if (controller !== search.controller) return;
      setSearchMsg(
        search.items.length
          ? `${search.items.length} public-domain ${S.paintingsOnly ? 'paintings' : 'works'} for “${q}”.`
          : `No public-domain ${S.paintingsOnly ? 'paintings' : 'works'} found for “${q}”${S.paintingsOnly ? '. Try turning off “Paintings only”.' : '.'}`
      );
      $('#btn-more').hidden = search.page >= search.totalPages;
      $('#btn-add-all').hidden = !search.items.length;
    } catch (e) {
      if (e.name === 'AbortError') return;
      setSearchMsg('Couldn’t reach the museum. Check your connection and try again.', true);
    }
  }

  function addResultCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;
    card.innerHTML = `
      <button class="thumb" title="Study this painting"><img loading="lazy" alt=""></button>
      <div class="meta"><b></b><span></span></div>
      <div class="acts"><button class="btn" data-act="study">Study</button><button class="btn" data-act="queue">+ Session</button></div>`;
    card.querySelector('img').src = item.thumb;
    card.querySelector('img').alt = `${item.title}, ${item.artist}`;
    card.querySelector('b').textContent = item.title;
    card.querySelector('.meta span').textContent = [item.artist, item.date].filter(Boolean).join(', ');
    card.querySelector('.thumb').addEventListener('click', () => studyItem(item));
    card.querySelector('[data-act="study"]').addEventListener('click', () => studyItem(item));
    card.querySelector('[data-act="queue"]').addEventListener('click', () => toggleQueued(item));
    $('#results').appendChild(card);
    markQueued(card);
  }

  function markQueued(card) {
    const inQ = queue.some((q) => q.id === card.dataset.id);
    card.classList.toggle('in-queue', inQ);
    card.querySelector('[data-act="queue"]').textContent = inQ ? '✓ Added' : '+ Session';
  }

  function studyItem(item) {
    return loadFromUrl(item.image, { meta: item, fallback: item.imageFallback });
  }

  function toggleQueued(item) {
    const i = queue.findIndex((q) => q.id === item.id);
    if (i >= 0) queue.splice(i, 1);
    else queue.push(item);
    queueChanged();
  }

  function queueChanged() {
    store.set('queue', queue);
    renderQueue();
    $$('#results .card').forEach(markQueued);
  }

  function renderQueue() {
    const ol = $('#queue');
    ol.innerHTML = '';
    queue.forEach((item, i) => {
      const li = document.createElement('li');
      if (flow.session && flow.index === i) li.classList.add('current');
      li.innerHTML = `<img alt=""><button class="q-title"><b></b><span></span></button><button class="q-x" aria-label="Remove">×</button>`;
      li.querySelector('img').src = item.thumb;
      li.querySelector('b').textContent = item.title;
      li.querySelector('span').textContent = item.artist;
      li.querySelector('.q-title').addEventListener('click', () => studyItem(item));
      li.querySelector('.q-x').addEventListener('click', () => {
        queue.splice(i, 1);
        if (flow.session && i < flow.index) flow.index--;
        queueChanged();
      });
      ol.appendChild(li);
    });
    $('#queue-count').textContent = queue.length ? `· ${queue.length} painting${queue.length === 1 ? '' : 's'}` : '';
    $('#queue-empty').hidden = queue.length > 0;
    $('#btn-shuffle').disabled = queue.length < 2;
    $('#btn-clear').disabled = !queue.length;
  }

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch($('#search-input').value);
  });
  $('#btn-more').addEventListener('click', () => runSearch(search.q, true));
  $('#btn-add-all').addEventListener('click', () => {
    search.items.forEach((it) => {
      if (!queue.some((q) => q.id === it.id)) queue.push(it);
    });
    queueChanged();
  });
  $('#paintings-only').addEventListener('change', (e) => {
    S.paintingsOnly = e.target.checked;
    save();
    if (search.q) runSearch(search.q);
  });
  $('#btn-shuffle').addEventListener('click', () => {
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    queueChanged();
  });
  $('#btn-clear').addEventListener('click', () => {
    if (flow.session) stopFlow();
    queue = [];
    queueChanged();
  });
  VST.museum.suggestions.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.addEventListener('click', () => {
      $('#search-input').value = s;
      runSearch(s);
    });
    $('#search-chips').appendChild(b);
  });

  /* ================= Timer and sessions ================= */

  /*
   * One flow covers both modes:
   *   draw (minutes) -> [break] -> next round of the same image, or
   *   in a Master Copy session, the next painting in the queue.
   */
  const flow = { session: false, index: 0, round: 1, phase: 'draw', pending: null };

  const countdown = new T.Countdown({
    onTick(ms, running) {
      $('#timer-clock').textContent = T.format(ms);
      $('#timer-clock').classList.toggle('break', flow.phase === 'break');
      $('#timerbar').classList.toggle('ending', flow.phase === 'draw' && running && ms <= 10000);
      $('#t-play').textContent = running ? 'Pause' : ms < countdown.duration * 1000 && ms > 0 ? 'Resume' : 'Start';
    },
    onEnd: onPhaseEnd,
  });

  function drawSeconds() {
    return Math.round(S.minutes * 60);
  }

  function updateTimerUi() {
    const visible = S.timerVisible || flow.session;
    $('#timerbar').hidden = !visible;
    $('#btn-timer').setAttribute('aria-pressed', String(visible));
    const parts = [];
    if (flow.phase === 'break') {
      parts.push(flow.pending === 'image' ? 'Break · next painting' : flow.pending === 'round' ? `Break · round ${flow.round + 1} next` : 'Break');
    } else {
      if (S.rounds > 1) parts.push(`Round ${flow.round} of ${S.rounds}`);
      parts.push(countdown.running ? 'Drawing' : 'Ready');
    }
    if (flow.session) parts.unshift(`Painting ${flow.index + 1} of ${queue.length}`);
    $('#timer-status').textContent = parts.join(' · ');
    $('#t-skip').hidden = !(flow.session || S.rounds > 1 || flow.phase === 'break');
    $('#btn-session').textContent = flow.session ? 'Stop session' : 'Start timed session';
    requestAnimationFrame(layout);
  }

  function startDraw() {
    flow.phase = 'draw';
    flow.pending = null;
    countdown.set(drawSeconds());
    countdown.start();
    T.keepAwake(true);
    updateTimerUi();
  }

  function onPhaseEnd() {
    if (flow.phase === 'break') {
      if (flow.pending === 'round') flow.round++;
      startDraw();
      return;
    }
    let next = null;
    if (flow.round < S.rounds) next = 'round';
    else if (flow.session && flow.index < queue.length - 1) next = 'image';
    if (!next) {
      if (S.chime) T.chime('done');
      finishFlow();
      return;
    }
    if (S.chime) T.chime('end');
    if (next === 'image') {
      flow.index++;
      flow.round = 1;
      studyItem(queue[flow.index]);
      renderQueue();
    }
    if (S.breakSec > 0) {
      flow.phase = 'break';
      flow.pending = next;
      countdown.set(S.breakSec);
      countdown.start();
      updateTimerUi();
    } else {
      if (next === 'round') flow.round++;
      startDraw();
    }
  }

  function finishFlow() {
    const wasSession = flow.session;
    Object.assign(flow, { session: false, index: 0, round: 1, phase: 'draw', pending: null });
    countdown.set(drawSeconds());
    T.keepAwake(false);
    updateTimerUi();
    renderQueue();
    $('#timer-status').textContent = wasSession ? 'Session complete. Nice work.' : 'Done';
  }

  function stopFlow() {
    finishFlow();
    $('#timer-status').textContent = 'Ready';
  }

  async function startSession() {
    if (!queue.length) return toast('Add some paintings to the session first.');
    T.unlockAudio();
    Object.assign(flow, { session: true, index: 0, round: 1, phase: 'draw', pending: null });
    S.timerVisible = true;
    renderQueue();
    updateTimerUi();
    const ok = await studyItem(queue[0]);
    if (!ok || !flow.session) return;
    startDraw();
  }

  $('#btn-session').addEventListener('click', () => (flow.session ? stopFlow() : startSession()));
  $('#btn-timer').addEventListener('click', () => {
    if (flow.session) return;
    S.timerVisible = !S.timerVisible;
    if (!S.timerVisible) stopFlow();
    updateTimerUi();
    save();
  });
  function playPause() {
    T.unlockAudio();
    if (!countdown.running && countdown.remainingMs <= 0) countdown.set(drawSeconds());
    countdown.toggle();
    T.keepAwake(countdown.running);
    updateTimerUi();
  }
  $('#t-play').addEventListener('click', playPause);
  $('#t-restart').addEventListener('click', () => {
    countdown.restart();
    updateTimerUi();
  });
  $('#t-skip').addEventListener('click', () => countdown.finish());
  $('#t-stop').addEventListener('click', stopFlow);

  function syncTimerControls() {
    $('#t-minutes').value = String(S.minutes);
    $('#t-rounds').value = String(S.rounds);
    $('#t-break').value = String(S.breakSec);
    $('#t-chime').checked = S.chime;
  }
  $('#t-minutes').addEventListener('change', (e) => {
    S.minutes = +e.target.value;
    if (flow.phase === 'draw' && !countdown.running) countdown.set(drawSeconds());
    save();
  });
  $('#t-rounds').addEventListener('change', (e) => {
    S.rounds = +e.target.value;
    updateTimerUi();
    save();
  });
  $('#t-break').addEventListener('change', (e) => {
    S.breakSec = +e.target.value;
    save();
  });
  $('#t-chime').addEventListener('change', (e) => {
    S.chime = e.target.checked;
    if (S.chime) {
      T.unlockAudio();
      T.chime('soft');
    }
    save();
  });

  /* ================= Keyboard shortcuts ================= */

  document.addEventListener('keydown', (e) => {
    if (cropper.isOpen() || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'g') toggleGrid();
    else if (k === 'f') toggleFlip();
    else if (k === 'c') openCrop();
    else if (k === 't') $('#btn-timer').click();
    else if (k === 'v') {
      const order = ['both', 'study', 'original'];
      setView(order[(order.indexOf(S.view) + 1) % order.length]);
    } else if (/^[2-6]$/.test(k)) setBands(+k);
    else if (k === ' ' && !$('#timerbar').hidden) {
      e.preventDefault();
      playPause();
    } else return;
  });

  /* ================= Start up ================= */

  syncStudyControls();
  syncGridControls();
  syncTimerControls();
  setSeg($('#view-seg'), 'view', S.view);
  $('#btn-flip').setAttribute('aria-pressed', String(S.flip));
  $('#paintings-only').checked = S.paintingsOnly;
  $('#export-format').value = S.exportFormat;
  $('#export-grid').checked = S.exportGrid;
  $('#panels').classList.add('is-empty');
  countdown.set(drawSeconds());
  renderQueue();
  setMode(S.mode);
  window.addEventListener('resize', () => drawHistogram());

  // exposed for automated tests
  VST.app = { settings: S, work, img, loadFromUrl, setImage, flow, countdown };
})();

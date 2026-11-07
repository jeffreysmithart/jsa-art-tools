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
    tone: 'gray', // 'gray' | 'color' | 'poster' (main colors)
    bands: 4, // 0 = all values (no grouping), else 2..6
    thresholds: {}, // per number of values, e.g. { 4: [25, 50, 75] }
    levelsMode: 'average', // true to the image's light key
    customLevels: {}, // per number of values, L* 0..100
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
    museum: 'all', // 'all' or a museum id: 'aic', 'met', 'cma'
    cropCustom: { w: 18, h: 36 }, // last custom canvas size in the crop tool
    currentSet: null, // the study set shown in the sidebar
    splitSource: {}, // per number of values: 'auto' (fit to image), 'even' or 'fixed' (dragged)
    panel: 'images', // sidebar tab: 'images' | 'study' | 'canvas'
    minePaper: true, // compare: correct the photographed paper to white
    mineOverlay: false, // compare: lay my study over the reference
    mineOpacity: 50,
    settingsVersion: 3,
  };

  function loadSettings() {
    const saved = store.get('settings', {}) || {};
    const s = { ...DEFAULTS, ...saved };
    s.grid = { ...DEFAULTS.grid, ...(saved.grid || {}) };
    // settings saved by the first version used a single "style" choice
    if (saved.style && !saved.tone) {
      if (saved.style === 'gray') {
        s.tone = 'gray';
        s.bands = 0;
      } else if (saved.style === 'poster') {
        s.tone = 'poster';
      } else {
        s.tone = saved.valuesColor ? 'color' : 'gray';
      }
    }
    // the second version kept "main colors" as a separate method
    if (saved.method === 'poster') s.tone = 'poster';
    if (!['gray', 'color', 'poster'].includes(s.tone)) s.tone = 'gray';
    // earlier versions defaulted to even steps; the default is now the image's average
    if ((saved.settingsVersion || 1) < 3 && s.levelsMode === 'even') s.levelsMode = 'average';
    s.settingsVersion = DEFAULTS.settingsVersion;
    delete s.style;
    delete s.valuesColor;
    delete s.posterColor;
    delete s.method;
    if (![0, 2, 3, 4, 5, 6].includes(s.bands)) s.bands = 4;
    return s;
  }
  const S = loadSettings();
  if (S.view === 'compare') S.view = 'both'; // the study photo isn't kept between visits
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

  let presenting = false; // Present mode: controls hidden
  const img = { item: null, el: null, w: 0, h: 0, crop: null, cropPreset: 'free', cropLandscape: null, meta: null, name: 'reference', url: null };
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
      setPanel('study');
      // keep a copy in this browser so it can be reopened from History or a set
      L.saveUpload(file, el)
        .then((item) => img.el === el && remember(item))
        .catch(() => {
          /* storage unavailable (e.g. private browsing): the image still works now */
        });
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
      const name = meta ? `${meta.artist} ${meta.title}` : decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.[^.]+$/, '');
      setImage(el, { name, meta });
      remember(meta ? L.clean(meta) : { id: `link-${url}`, source: 'link', title: name || 'Image link', image: url, thumb: url, added: Date.now() });
      if (!meta) setPanel('study');
      return true;
    } catch (e) {
      const msg = meta
        ? meta.needsRelay
          ? 'Couldn’t load that painting through the image relay. Check that the relay is set up (relay/README.md) and try again.'
          : 'Couldn’t load that painting from the museum. Check your connection and try again.'
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

  function setImage(el, { name, meta = null, objectUrl = null, item = null }) {
    if (img.url) URL.revokeObjectURL(img.url);
    img.item = item;
    img.el = el;
    img.w = el.naturalWidth;
    img.h = el.naturalHeight;
    img.crop = null;
    img.cropPreset = 'free';
    img.cropLandscape = null;
    img.meta = meta;
    img.name = name || 'reference';
    img.url = objectUrl;
    if (mine.el) clearMine(); // the old study photo belonged to the previous reference
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
    Object.assign(work, { w, h, rgba, lab0: P.computeLab(rgba, w * h), lab: null, blurKey: null, hist: null, centroids: null, centroidKey: null, refit: true });
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

  /** True when the study is grouped into a set number of values. */
  function grouped() {
    return S.tone !== 'poster' && S.bands >= 2;
  }

  function currentThresholds() {
    const t = P.sanitizeThresholds(S.thresholds[S.bands], S.bands);
    S.thresholds[S.bands] = t;
    return t;
  }

  function currentLevels(hist) {
    const t = currentThresholds();
    if (S.levelsMode === 'custom') {
      const c = S.customLevels[S.bands];
      if (!(Array.isArray(c) && c.length === S.bands)) S.customLevels[S.bands] = averageLevels(t, hist);
    }
    return P.bandLevels(S.levelsMode, S.bands, t, hist, S.customLevels[S.bands]);
  }

  /** This image's average value per group, rounded to half steps (a starting point for Custom). */
  function averageLevels(thresholds, hist) {
    return P.bandLevels('average', S.bands, thresholds, hist).map((L) => Math.round(L / 5) * 5);
  }

  function ensureCentroids() {
    const key = `${work.blurKey}|${S.posterK}`;
    if (work.centroids && work.centroidKey === key) return;
    work.centroids = P.kmeans(work.lab, S.posterK);
    work.centroidKey = key;
  }

  /** Renders the study for a Lab image into `out` (RGBA). Returns band info. */
  function produceStudy(lab, hist, out) {
    if (S.tone === 'poster') {
      const shares = P.renderPoster(lab, work.centroids, true, out);
      return work.centroids.map((c, i) => ({ L: c[0], rgb: C.labToRgb8(c[0], c[1], c[2], [0, 0, 0]), share: shares[i] }));
    }
    const color = S.tone === 'color';
    if (!grouped()) {
      if (color) P.renderColor(lab, out);
      else P.renderGray(lab, out);
      return null;
    }
    const levels = currentLevels(hist);
    const shares = P.renderValues(lab, currentThresholds(), levels, color, out);
    return levels.map((L, i) => ({ L, share: shares[i] }));
  }

  function renderStudy() {
    if (!work.rgba) return;
    ensureLab();
    // splits set with "Fit to image" (or a preset that fits) follow each new image
    if (work.refit) {
      work.refit = false;
      if (grouped() && S.splitSource[S.bands] === 'auto') {
        S.thresholds[S.bands] = P.autoThresholds(work.hist, S.bands);
        buildThresholdSliders();
      }
    }
    if (S.tone === 'poster') ensureCentroids();
    const imageData = ctxStudy.createImageData(work.w, work.h);
    const bands = produceStudy(work.lab, work.hist, imageData.data);
    ctxStudy.putImageData(imageData, 0, 0);
    renderSwatches(bands);
    renderMine();
    drawHistogram();
    renderPresetSelect();
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
    $$('.panel').forEach((panel) => {
      const wrap = panel.querySelector('.frame-wrap');
      const frame = panel.querySelector('.frame');
      const cv = frame.querySelector('canvas');
      const ar = cv.width && cv.height ? cv.width / cv.height : work.w / work.h;
      const box = wrap.getBoundingClientRect();
      const availH = box.height - (presenting ? 0 : 28); // room for the caption
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
    setSeg($('#tone-seg'), 'tone', S.tone);
    setSeg($('#bands-seg'), 'n', S.bands);
    setSeg($('#k-seg'), 'k', S.posterK);
    $('#values-ctl').hidden = S.tone === 'poster';
    $('#poster-ctl').hidden = S.tone !== 'poster';
    $('#split-ctl').hidden = !grouped();
    $('#levels-ctl').hidden = !grouped();
    $('#levels-mode').value = S.levelsMode;
    $('#blur').value = S.blur;
    $('#blur-out').textContent = S.blur ? `${S.blur}` : 'Off';
    updateCaption();
    buildThresholdSliders();
  }

  function updateCaption() {
    let text = { gray: 'Grayscale', color: 'Color', poster: `${S.posterK} main colors` }[S.tone];
    if (grouped()) text += ` · ${S.bands} values${S.bands === 2 ? ' (notan)' : ''}`;
    if (S.blur) text += ' · squint';
    const comparing = S.view === 'compare' && mine.el;
    const overlay = comparing && S.mineOverlay;
    $('#study-caption').textContent = overlay ? `Reference with my study on top · ${text}` : comparing ? `Reference · ${text}` : text;
    $('#mine-caption').textContent = `My study · ${text}`;
  }

  function buildThresholdSliders() {
    const box = $('#thresholds');
    box.innerHTML = '';
    if (!grouped()) return;
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
    S.splitSource[S.bands] = 'fixed';
    const row = $('#thresholds').children[i];
    if (row) {
      row.querySelector('input').value = t[i];
      row.querySelector('output').textContent = valueLabel(t[i]);
    }
    requestStudy();
  }

  function renderSwatches(bands, box = $('#swatches')) {
    const forMine = box.id === 'swatches-mine';
    box.innerHTML = '';
    if (!forMine) $('#swatch-hint').hidden = !bands;
    if (forMine) $('#swatches-mine-wrap').hidden = !bands;
    if (!bands) return;
    const editable = !forMine && grouped() && S.levelsMode === 'custom';
    // bars are scaled to the largest share so differences are easy to see;
    // the percentage above each bar gives the true share of the picture
    const maxShare = Math.max(...bands.map((b) => b.share)) || 1;
    const top = bands.findIndex((b) => b.share === maxShare);
    box.setAttribute('role', 'img');
    box.setAttribute(
      'aria-label',
      bands.map((b) => `value ${valueLabel(b.L)}: ${Math.round(b.share * 100)}%`).join(', ')
    );
    bands.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'swatch' + (i === top ? ' dominant' : '');
      const rgb = b.rgb;
      const g = C.lToGray8(b.L);
      const pct = document.createElement('div');
      pct.className = 'pct';
      pct.textContent = `${Math.round(b.share * 100)}%`;
      el.appendChild(pct);
      const track = document.createElement('div');
      track.className = 'track';
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = b.share > 0 ? `max(3px, ${(b.share / maxShare) * 100}%)` : '0';
      bar.style.background = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : `rgb(${g},${g},${g})`;
      bar.title = `Value ${valueLabel(b.L)} · ${Math.round(b.share * 100)}% of the picture`;
      track.appendChild(bar);
      el.appendChild(track);
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
      box.appendChild(el);
    });
  }

  /* Histogram of the image's values with the splits drawn on top. */
  const histCanvas = $('#histogram');
  function drawHistogram() {
    if (!grouped()) return;
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

  function setTone(tone) {
    S.tone = tone;
    syncStudyControls();
    requestStudy();
  }
  $('#tone-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setTone(b.dataset.tone);
  });
  $('#bands-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setBands(+b.dataset.n);
  });
  function setBands(n) {
    S.bands = n;
    if (S.tone === 'poster') S.tone = 'color'; // values apply to grayscale or color
    if (S.splitSource[n] === 'auto') work.refit = true;
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
    S.splitSource[S.bands] = 'auto';
    buildThresholdSliders();
    requestStudy();
  });
  $('#btn-even').addEventListener('click', () => {
    S.thresholds[S.bands] = P.evenThresholds(S.bands);
    S.splitSource[S.bands] = 'even';
    buildThresholdSliders();
    requestStudy();
  });
  $('#levels-mode').addEventListener('change', (e) => {
    const mode = e.target.value;
    // Custom starts from this image's averages, then you adjust from there
    if (mode === 'custom') S.customLevels[S.bands] = averageLevels(currentThresholds(), work.hist);
    S.levelsMode = mode;
    requestStudy();
  });
  $('#blur').addEventListener('input', (e) => {
    S.blur = +e.target.value;
    $('#blur-out').textContent = S.blur ? `${S.blur}` : 'Off';
    updateCaption();
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
    if (v === 'compare' && !mine.el) v = 'both';
    S.view = v;
    setSeg($('#view-seg'), 'view', v);
    syncMineUi();
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
    customBox: $('#crop-custom'),
    customW: $('#crop-cw'),
    customH: $('#crop-ch'),
  });
  function openCrop() {
    if (!img.el) return toast('Load an image first.');
    cropper.open({
      image: img.el,
      rect: img.crop,
      presetId: img.cropPreset,
      landscape: img.cropLandscape,
      custom: S.cropCustom,
      onApply(rect, { presetId, landscape, custom }) {
        img.crop = rect;
        img.cropPreset = presetId;
        img.cropLandscape = landscape;
        S.cropCustom = custom; // remembered for the next image
        save();
        buildSource();
      },
    });
  }
  $('#btn-crop').addEventListener('click', openCrop);


  /* ================= Compare my study ================= */

  /*
   * A photo of the painter's own sketch, squared up (perspective-corrected)
   * to the reference's shape, then run through the same value settings:
   * same splits, same painted values, same squint, so the two compare fairly.
   */
  const mine = { el: null, url: null, quad: null, mode: 'match', aspect: 1, w: 0, h: 0, lab0: null, p95: 100, lab: null, labKey: null, hist: null };
  const MINE_SOURCE_MAX = 2400; // photos are downscaled to this before straightening
  const cvMine = $('#cv-mine');
  const ctxMine = cvMine.getContext('2d');
  const cvMineOverlay = $('#cv-mine-overlay');

  const squarer = VST.squareup.create({
    modal: $('#square-modal'),
    canvas: $('#square-canvas'),
    aspect: $('#square-aspect'),
    rotate: $('#square-rotate'),
    reset: $('#square-reset'),
    cancel: $('#square-cancel'),
    apply: $('#square-apply'),
    info: $('#square-info'),
  });

  function hasMine() {
    return !!(mine.el && mine.lab0);
  }

  async function loadMineFile(file) {
    if (!file) return;
    if (!img.el) return toast('Load a reference or master painting first, then add your study.');
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i.test(file.name || '')) return toast('That file isn’t an image.', true);
    const url = URL.createObjectURL(file);
    try {
      const el = await loadImageElement(url, { cors: false });
      openSquare(el, url, null);
    } catch (e) {
      URL.revokeObjectURL(url);
      toast('This browser couldn’t open that photo. Try a JPG or PNG.', true);
    }
  }

  function openSquare(el, url, quad) {
    squarer.open({
      image: el,
      quad,
      mode: mine.mode,
      refAspect: work.w / work.h,
      onApply({ quad: q, mode, aspect }) {
        if (url && mine.url && mine.url !== url) URL.revokeObjectURL(mine.url);
        Object.assign(mine, { el, url: url || mine.url, quad: q, mode, aspect });
        buildMine();
        setView('compare');
      },
    });
  }

  /** Straightens the photo into the study's pixel grid and measures its paper. */
  function buildMine() {
    if (!mine.el || !work.w) return;
    // output size: the reference's grid when matching its shape, else the drawing's own proportions
    let w = work.w;
    let h = work.h;
    if (mine.mode === 'drawn') {
      const long = Math.max(work.w, work.h);
      if (mine.aspect >= 1) {
        w = long;
        h = Math.max(1, Math.round(long / mine.aspect));
      } else {
        h = long;
        w = Math.max(1, Math.round(long * mine.aspect));
      }
    }
    const nw = mine.el.naturalWidth;
    const nh = mine.el.naturalHeight;
    const s = Math.min(1, MINE_SOURCE_MAX / Math.max(nw, nh));
    const sw = Math.max(1, Math.round(nw * s));
    const sh = Math.max(1, Math.round(nh * s));
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(mine.el, 0, 0, sw, sh);
    const src = tctx.getImageData(0, 0, sw, sh).data;
    const rgba = VST.warp.warpQuad(src, sw, sh, mine.quad.map(([x, y]) => [x * s, y * s]), w, h);
    if (!rgba) return toast('Those corners don’t make a four-sided shape. Try squaring up again.', true);
    cvMine.width = w;
    cvMine.height = h;
    mine.w = w;
    mine.h = h;
    mine.lab0 = P.computeLab(rgba, w * h);
    // the paper is the bright end of the photo: 95th percentile of its values
    const hist = P.histogram(mine.lab0.L);
    let acc = 0;
    let p95 = 100;
    for (let i = 0; i <= 100; i++) {
      acc += hist[i];
      if (acc >= 0.95 * w * h) {
        p95 = i;
        break;
      }
    }
    mine.p95 = Math.max(1, p95);
    mine.labKey = null;
    syncMineUi();
    layout();
    renderStudy();
  }

  function ensureMineLab() {
    const key = `${S.blur}|${S.minePaper}`;
    if (mine.lab && mine.labKey === key) return;
    let lab = mine.lab0;
    if (S.minePaper) {
      // scale values so the paper reads as white (96), like the paper in hand
      const f = Math.min(2.5, 96 / mine.p95);
      const L = new Float32Array(lab.L.length);
      for (let i = 0; i < L.length; i++) L[i] = Math.min(100, lab.L[i] * f);
      lab = { L, A: lab.A, B: lab.B };
    }
    mine.lab = P.blurLab(lab, mine.w, mine.h, blurSigma(mine.w, mine.h));
    mine.labKey = key;
  }

  /** Renders my study with the reference's settings: same splits, levels and palette. */
  function renderMine() {
    if (!hasMine() || !work.lab) return;
    ensureMineLab();
    const imageData = ctxMine.createImageData(mine.w, mine.h);
    const bands = produceStudy(mine.lab, work.hist, imageData.data);
    ctxMine.putImageData(imageData, 0, 0);
    if (S.mineOverlay) {
      cvMineOverlay.width = mine.w;
      cvMineOverlay.height = mine.h;
      cvMineOverlay.getContext('2d').drawImage(cvMine, 0, 0);
    }
    mine.bands = bands;
    renderSwatches(bands, $('#swatches-mine'));
  }

  function clearMine() {
    if (mine.url) URL.revokeObjectURL(mine.url);
    Object.assign(mine, { el: null, url: null, quad: null, lab0: null, lab: null, labKey: null, w: 0, h: 0 });
    if (S.view === 'compare') S.view = 'both';
    syncMineUi();
  }

  function syncMineUi() {
    const has = hasMine();
    $('#mine-ctl').hidden = !has;
    $('#mine-add-label').textContent = has ? 'Replace photo…' : 'Add a photo of my study…';
    $('#mine-hint').hidden = has;
    $('#view-compare').disabled = !has;
    $('#view-compare').title = has ? 'My study next to the reference' : 'Compare with my study (add a photo first)';
    $('#swatches-mine-wrap').hidden = !has;
    $('#swatches-master-label').hidden = !has;
    $('#mine-paper').checked = S.minePaper;
    $('#mine-overlay').checked = S.mineOverlay;
    $('#mine-opacity').value = S.mineOpacity;
    $('#mine-opacity-out').textContent = `${S.mineOpacity}%`;
    $('#mine-opacity-field').hidden = !S.mineOverlay;
    cvMineOverlay.hidden = !(has && S.mineOverlay && S.view === 'compare');
    cvMineOverlay.style.opacity = String(S.mineOpacity / 100);
    $('#panels').classList.toggle('overlaying', has && S.mineOverlay);
    setSeg($('#view-seg'), 'view', S.view);
    updateCaption();
  }

  function setOverlay(on) {
    S.mineOverlay = on;
    syncMineUi();
    layout();
    renderStudy();
  }

  $('#mine-input').addEventListener('change', (e) => {
    loadMineFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#mine-square').addEventListener('click', () => mine.el && openSquare(mine.el, null, mine.quad));
  $('#mine-remove').addEventListener('click', () => {
    clearMine();
    layout();
    renderStudy();
  });
  $('#mine-paper').addEventListener('change', (e) => {
    S.minePaper = e.target.checked;
    requestStudy();
  });
  $('#mine-overlay').addEventListener('change', (e) => setOverlay(e.target.checked));
  $('#mine-opacity').addEventListener('input', (e) => {
    S.mineOpacity = +e.target.value;
    $('#mine-opacity-out').textContent = `${S.mineOpacity}%`;
    cvMineOverlay.style.opacity = String(S.mineOpacity / 100);
    save();
  });


  /* ================= Sidebar tabs: Images / Study / Canvas ================= */

  const PANELS = ['images', 'study', 'canvas'];

  function setPanel(name) {
    if (!PANELS.includes(name)) name = 'images';
    S.panel = name;
    PANELS.forEach((p) => {
      const on = p === name;
      $(`#panel-${p}`).hidden = !on;
      const tab = $(`#ptab-${p}`);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    if (name === 'study') drawHistogram(); // it can't be measured while hidden
    save();
  }

  $$('.side-tabs [role="tab"]').forEach((tab) => {
    tab.addEventListener('click', () => {
      setPanel(tab.dataset.panel);
      $('.sidebar').scrollTop = 0;
    });
    // arrow keys move between tabs, as in any tab list
    tab.addEventListener('keydown', (e) => {
      const i = PANELS.indexOf(tab.dataset.panel);
      const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? PANELS.length - 1 : null;
      if (next == null) return;
      e.preventDefault();
      const p = PANELS[(next + PANELS.length) % PANELS.length];
      setPanel(p);
      $(`#ptab-${p}`).focus();
    });
  });

  /* Pop-up screens: move keyboard focus in when they open and back to where it was when they close. */
  function manageFocus(modal) {
    let returnTo = null;
    new MutationObserver(() => {
      if (!modal.hidden) {
        returnTo = document.activeElement;
        const first = modal.querySelector('.btn.primary:not([disabled])') || modal.querySelector('button:not([disabled]), select');
        if (first) first.focus({ preventScroll: true });
      } else if (returnTo && document.contains(returnTo)) {
        returnTo.focus({ preventScroll: true });
        returnTo = null;
      }
    }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  }
  ['#crop-modal', '#square-modal', '#tryon-modal'].forEach((sel) => manageFocus($(sel)));

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
    if (S.tone === 'poster') ensureCentroids(); // same palette as the preview
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
    const parts = [{ gray: 'grayscale', color: 'color', poster: `${S.posterK}-main-colors` }[S.tone]];
    if (grouped()) parts.push(`${S.bands}-values`);
    return `${slug(img.name)}-${parts.join('-')}`;
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
    const comparing = S.view === 'compare' && hasMine();
    let sub = img.meta ? `${img.meta.artist}${img.meta.date ? `, ${img.meta.date}` : ''} · ${img.meta.credit}` : $('#study-caption').textContent;
    if (comparing) sub = `Reference and my study · ${$('#mine-caption').textContent.replace(/^My study · /, '')}${img.meta ? ` · ${img.meta.artist}` : ''}`;
    ctx.fillText(sub.length > 140 ? `${sub.slice(0, 139)}…` : sub, m, m + 90);

    const top = m + 150;
    const swatchH = r.bands ? 360 : 0;
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
    // in Compare view: the reference's study beside mine; otherwise original beside study
    const labelAbove = (text, x0) => {
      ctx.font = '600 38px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillStyle = '#333';
      ctx.fillText(text, x0, top - 18);
    };
    if (comparing) {
      place(finish(r.study, withGrid), m);
      place(finish(cvMine, withGrid), m * 2 + boxW);
      labelAbove('Reference', m);
      labelAbove('My study', m * 2 + boxW);
    } else {
      place(finish(r.original, withGrid), m);
      place(finish(r.study, withGrid), m * 2 + boxW);
    }

    // bar chart of how much of the picture each value covers
    const drawBars = (bands, x0, width) => {
      const barMax = swatchH - 130;
      const base = H - m - 60; // bottom of the bars
      const gap = 24;
      const sw = Math.min(200, width / bands.length - gap);
      const maxShare = Math.max(...bands.map((b) => b.share)) || 1;
      ctx.textAlign = 'center';
      bands.forEach((b, i) => {
        const x = x0 + i * (sw + gap);
        const g = C.lToGray8(b.L);
        const rgb = b.rgb || [g, g, g];
        const h = b.share > 0 ? Math.max(4, (b.share / maxShare) * barMax) : 0;
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(x, base - h, sw, h);
        ctx.strokeStyle = '#bbb';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, base - h, sw, h);
        ctx.fillStyle = '#222';
        ctx.font = `${b.share === maxShare ? '700' : '500'} 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.fillText(`${Math.round(b.share * 100)}%`, x + sw / 2, base - h - 14);
        ctx.font = '30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.fillStyle = '#555';
        ctx.fillText(`Value ${valueLabel(b.L)}`, x + sw / 2, base + 42);
      });
      // baseline under the bars
      ctx.fillStyle = '#888';
      ctx.fillRect(x0 - 10, base, bands.length * (sw + gap) - 4, 3);
      ctx.textAlign = 'left';
    };
    if (r.bands && comparing && mine.bands) {
      drawBars(r.bands, m, boxW);
      drawBars(mine.bands, m * 2 + boxW, boxW);
    } else if (r.bands) {
      drawBars(r.bands, m, W - m * 2);
    }
    download(c, `${studyName()}-${comparing ? 'comparison' : 'sheet'}`);
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

  const M = VST.museum;
  let queue = (store.get('queue', []) || []).filter((q) => q && (q.image || q.blobId));
  const search = { q: '', items: [], perSource: {}, controller: null };

  /** The museums to search, from the filter (falls back to all available). */
  function activeSources() {
    const av = M.available();
    if (S.museum !== 'all') {
      const one = av.find((s) => s.id === S.museum);
      if (one) return [one];
    }
    return av;
  }

  function buildMuseumFilter() {
    const sel = $('#museum-filter');
    sel.innerHTML = '';
    const av = M.available();
    const add = (value, text, disabled) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      o.disabled = !!disabled;
      sel.appendChild(o);
    };
    add('all', av.length > 1 ? 'All museums' : 'All available');
    M.all.forEach((s) => {
      const ok = av.includes(s);
      add(s.id, ok ? s.name : `${s.name} (needs setup)`, !ok);
    });
    if (S.museum !== 'all' && !av.some((s) => s.id === S.museum)) S.museum = 'all';
    sel.value = S.museum;
    $('#museum-setup').hidden = !!M.relayBase();
    const names = av.map((s) => s.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    $('#museum-credit').textContent = `Public-domain images (CC0) from the ${list} open-access collections.`;
  }

  function setSearchMsg(text, isError) {
    const el = $('#search-msg');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  // a museum that hasn't answered by then is skipped (Cleveland can be very slow on a new search)
  const SOURCE_TIMEOUT = (VST.config && VST.config.searchTimeoutMs) || 20000;

  /** Runs one museum's search, giving up after SOURCE_TIMEOUT. */
  function searchWithTimeout(source, q, page, parentSignal) {
    const c = new AbortController();
    let timedOut = false;
    const stop = () => c.abort();
    parentSignal.addEventListener('abort', stop);
    const timer = setTimeout(() => {
      timedOut = true;
      c.abort();
    }, SOURCE_TIMEOUT);
    return source
      .search(q, page, c.signal, { paintingsOnly: S.paintingsOnly })
      .catch((e) => {
        if (timedOut) {
          const t = new Error('timed out');
          t.name = 'TimeoutError';
          throw t;
        }
        throw e;
      })
      .finally(() => {
        clearTimeout(timer);
        parentSignal.removeEventListener('abort', stop);
      });
  }

  async function runSearch(q, more = false) {
    q = q.trim();
    if (!q) return;
    if (search.controller) search.controller.abort();
    const controller = new AbortController();
    search.controller = controller;
    const isCurrent = () => controller === search.controller && !controller.signal.aborted;
    const sources = activeSources();
    if (!more) {
      search.q = q;
      search.items = [];
      search.round = 0;
      search.perSource = {};
      sources.forEach((s) => (search.perSource[s.id] = { page: 0, totalPages: 1, failed: false, slow: false, busy: false }));
      $('#results').innerHTML = '';
    }
    $('#btn-more').hidden = true;
    const hasMore = (s) => {
      const st = search.perSource[s.id];
      return st && !st.failed && st.page < st.totalPages;
    };
    const showProgress = () => {
      const waiting = sources.filter((s) => search.perSource[s.id].busy).map((s) => s.short);
      if (!waiting.length) return;
      const sofar = search.items.length ? `${search.items.length} found so far. ` : '';
      setSearchMsg(`${sofar}Searching ${waiting.join(', ')}…`);
    };
    let added = 0;
    // keep fetching pages until there is something to show
    for (let tries = 0; tries < 3 && added < 8; tries++) {
      const pending = sources.filter(hasMore);
      if (!pending.length) break;
      const round = search.round++;
      pending.forEach((s) => (search.perSource[s.id].busy = true));
      showProgress();
      // each museum's results appear as soon as it answers
      await Promise.all(
        pending.map(async (s) => {
          const st = search.perSource[s.id];
          const slot = sources.indexOf(s);
          try {
            const res = await searchWithTimeout(s, q, st.page + 1, controller.signal);
            if (!isCurrent()) return;
            st.page = res.page;
            st.totalPages = res.totalPages;
            const seen = new Set(search.items.map((it) => it.id));
            res.items.forEach((it, i) => {
              if (seen.has(it.id)) return;
              seen.add(it.id);
              // the CSS order keeps the museums interleaved however fast each one answers
              it._order = (round * 1000 + i) * sources.length + slot;
              search.items.push(it);
              addResultCard(it).style.order = String(it._order);
              added++;
            });
          } catch (e) {
            if (!isCurrent()) return;
            st.failed = true;
            st.slow = e.name === 'TimeoutError';
          } finally {
            st.busy = false;
            if (isCurrent()) showProgress();
          }
        })
      );
      if (!isCurrent()) return;
    }
    search.items.sort((a, b) => a._order - b._order);
    const failedSources = sources.filter((s) => search.perSource[s.id].failed);
    const slow = failedSources.filter((s) => search.perSource[s.id].slow).map((s) => s.short);
    const unreachable = failedSources.filter((s) => !search.perSource[s.id].slow).map((s) => s.short);
    const what = S.paintingsOnly ? 'paintings' : 'works';
    const answered = sources.filter((s) => !search.perSource[s.id].failed);
    const where = answered.length > 1 ? ` from ${answered.length} museums` : answered.length ? ` from ${answered[0].short}` : '';
    let msg = search.items.length
      ? `${search.items.length} public-domain ${what}${where} for “${q}”.`
      : `No public-domain ${what} found for “${q}”${S.paintingsOnly ? '. Try turning off “Paintings only”.' : '.'}`;
    if (slow.length) msg += ` ${slow.join(' and ')} took too long to answer; try again in a moment.`;
    if (unreachable.length) msg += ` Couldn’t reach ${unreachable.join(' or ')}.`;
    setSearchMsg(msg, failedSources.length > 0 && !search.items.length);
    $('#btn-more').hidden = !sources.some(hasMore);
    $('#btn-add-all').hidden = !search.items.length;
  }

  function addResultCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;
    card.innerHTML = `
      <button class="thumb" title="Study this painting"><img loading="lazy" alt=""></button>
      <div class="meta"><b></b><span></span><i></i></div>
      <div class="acts"><button class="btn" data-act="study">Study</button><button class="btn" data-act="queue">+ Session</button></div>`;
    card.querySelector('img').src = item.thumb;
    card.querySelector('img').alt = `${item.title}, ${item.artist}`;
    card.querySelector('b').textContent = item.title;
    card.querySelector('.meta span').textContent = [item.artist, item.date].filter(Boolean).join(', ');
    card.querySelector('.meta i').textContent = M.available().length > 1 ? item.museum || '' : '';
    card.querySelector('.thumb').addEventListener('click', () => studyItem(item));
    card.querySelector('[data-act="study"]').addEventListener('click', () => studyItem(item));
    card.querySelector('[data-act="queue"]').addEventListener('click', () => toggleQueued(item));
    $('#results').appendChild(card);
    markQueued(card);
    return card;
  }

  function markQueued(card) {
    const inQ = queue.some((q) => q.id === card.dataset.id);
    card.classList.toggle('in-queue', inQ);
    card.querySelector('[data-act="queue"]').textContent = inQ ? '✓ Added' : '+ Session';
  }

  function studyItem(item) {
    const url = M.imageUrl(item);
    if (!url) {
      toast(`${item.museum || 'This museum'}’s images need the image relay set up first (see relay/README.md).`, true);
      return Promise.resolve(false);
    }
    const fallback = item.imageFallback ? M.imageUrl(item, item.imageFallback) : null;
    return loadFromUrl(url, { meta: item, fallback });
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
      li.querySelector('.q-title').addEventListener('click', () => openItem(item));
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
  $('#museum-filter').addEventListener('change', (e) => {
    S.museum = e.target.value;
    save();
    if (search.q) runSearch(search.q);
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


  /* ================= Study sets and history ================= */

  const L = VST.library;

  /** Opens any saved item: a museum painting, an uploaded photo or a link. */
  async function openItem(item) {
    if (!item) return false;
    if (item.source === 'upload') {
      setBusy(true);
      try {
        const blob = await L.loadUpload(item);
        const url = URL.createObjectURL(blob);
        const el = await loadImageElement(url, { cors: false });
        setImage(el, { name: item.title, objectUrl: url, item });
        L.record(item);
        renderLibrary();
        return true;
      } catch (e) {
        toast('That photo is no longer stored in this browser.', true);
        return false;
      } finally {
        setBusy(false);
      }
    }
    if (item.source === 'link') return loadFromUrl(item.image);
    return studyItem(item);
  }

  /** Remembers what's being studied, for history and "Add current image". */
  function remember(item) {
    img.item = item;
    L.record(item);
    VST.log.start(item);
    renderLibrary();
  }

  function currentSet() {
    return (S.currentSet && L.getSet(S.currentSet)) || null;
  }

  function tile(item, { onRemove, onAdd, removeLabel }) {
    const el = document.createElement('div');
    el.className = 'tile' + (img.item && img.item.id === item.id ? ' current' : '');
    el.dataset.id = item.id;
    el.innerHTML = '<button class="tile-open" type="button"><img alt="" loading="lazy"></button><span class="tile-title"></span><button class="tile-x" type="button">×</button>';
    const label = [item.title, item.artist].filter(Boolean).join(', ');
    el.querySelector('img').src = item.thumb || item.image || '';
    el.querySelector('img').alt = label;
    el.querySelector('.tile-open').title = `Study ${label}`;
    el.querySelector('.tile-title').textContent = item.title || 'Untitled';
    el.querySelector('.tile-open').addEventListener('click', () => openItem(item));
    const x = el.querySelector('.tile-x');
    x.setAttribute('aria-label', removeLabel);
    x.title = removeLabel;
    x.addEventListener('click', onRemove);
    if (onAdd) {
      const add = document.createElement('button');
      add.className = 'tile-add';
      add.type = 'button';
      add.textContent = '+';
      add.title = 'Add to the current set';
      add.setAttribute('aria-label', `Add ${label} to the current set`);
      add.addEventListener('click', onAdd);
      el.appendChild(add);
    }
    return el;
  }

  function renderLibrary() {
    const all = L.sets();
    if (S.currentSet && !all.some((s) => s.id === S.currentSet)) S.currentSet = all.length ? all[0].id : null;
    if (!S.currentSet && all.length) S.currentSet = all[0].id;
    const sel = $('#set-select');
    sel.innerHTML = '';
    if (!all.length) {
      const o = document.createElement('option');
      o.textContent = 'No sets yet';
      o.value = '';
      sel.appendChild(o);
    }
    all.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = `${s.name} (${s.items.length})`;
      sel.appendChild(o);
    });
    sel.value = S.currentSet || '';
    sel.disabled = !all.length;
    const set = currentSet();
    ['set-rename', 'set-delete', 'set-export'].forEach((id) => ($(`#${id}`).disabled = !set));
    $('#set-session').disabled = !set || !set.items.length;
    $('#set-tryon').disabled = !set || !set.items.length;
    const box = $('#set-items');
    box.innerHTML = '';
    if (set) {
      set.items.forEach((it) =>
        box.appendChild(
          tile(it, {
            removeLabel: 'Remove from this set',
            onRemove: () => {
              L.removeFromSet(set.id, it.id);
              renderLibrary();
            },
          })
        )
      );
    }
    $('#set-empty').hidden = !!(set && set.items.length);
    $('#set-empty').textContent = set
      ? 'This set is empty. Study an image, then choose “+ Add current image”, or use + on an image in History.'
      : 'Make a set, then add images to it: museum paintings or your own photos. Sets are saved in this browser.';
    // history
    const hist = L.history();
    const hbox = $('#history-items');
    hbox.innerHTML = '';
    hist.forEach((it) =>
      hbox.appendChild(
        tile(it, {
          removeLabel: 'Remove from history',
          onRemove: () => {
            L.removeFromHistory(it.id);
            renderLibrary();
          },
          onAdd: () => addToCurrentSet(it),
        })
      )
    );
    $('#history-count').textContent = hist.length ? `· ${hist.length}` : '';
    $('#history-empty').hidden = hist.length > 0;
    $('#history-clear').hidden = !hist.length;
    save();
  }

  function ensureSet() {
    let set = currentSet();
    if (set) return set;
    const name = prompt('Name your first study set:', 'My study set');
    if (name == null) return null;
    set = L.createSet(name);
    S.currentSet = set.id;
    return set;
  }

  function addToCurrentSet(item) {
    const set = ensureSet();
    if (!set) return;
    if (L.addToSet(set.id, item)) toast(`Added to “${set.name}”.`);
    else toast(`Already in “${set.name}”.`);
    renderLibrary();
  }

  $('#set-select').addEventListener('change', (e) => {
    S.currentSet = e.target.value || null;
    renderLibrary();
  });
  $('#set-new').addEventListener('click', () => {
    const name = prompt('Name the new study set:', 'New study set');
    if (name == null) return;
    const set = L.createSet(name);
    S.currentSet = set.id;
    renderLibrary();
    toast(`Created “${set.name}”.`);
  });
  $('#set-rename').addEventListener('click', () => {
    const set = currentSet();
    if (!set) return;
    const name = prompt('Rename this set:', set.name);
    if (name == null || !name.trim()) return;
    L.renameSet(set.id, name);
    renderLibrary();
  });
  $('#set-delete').addEventListener('click', () => {
    const set = currentSet();
    if (!set || !confirm(`Delete the set “${set.name}”? Its images stay in History.`)) return;
    L.deleteSet(set.id);
    S.currentSet = null;
    renderLibrary();
  });
  function addCurrentImage() {
    if (!img.item) return toast(img.el ? 'Still saving this image; try again in a moment.' : 'Load an image first.');
    addToCurrentSet(img.item);
  }
  $('#set-add-current').addEventListener('click', addCurrentImage);
  $('#btn-save-set').addEventListener('click', addCurrentImage);
  $('#set-session').addEventListener('click', () => {
    const set = currentSet();
    if (!set || !set.items.length) return;
    if (flow.session) stopFlow();
    queue = set.items.map((it) => ({ ...it }));
    queueChanged();
    setMode('master');
    startSession();
  });
  $('#set-export').addEventListener('click', async () => {
    const set = currentSet();
    if (!set) return;
    try {
      const blob = await L.exportSet(set.id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug(set.name)}.valuestudy.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      toast('Couldn’t export that set.', true);
    }
  });
  $('#set-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const set = await L.importSet(await file.text());
      S.currentSet = set.id;
      renderLibrary();
      toast(`Imported “${set.name}” (${set.items.length} image${set.items.length === 1 ? '' : 's'}).`);
    } catch (err) {
      toast(err.message || 'Couldn’t import that file.', true);
    }
  });
  $('#history-clear').addEventListener('click', () => {
    if (!confirm('Clear your study history? Images in your sets are kept.')) return;
    L.clearHistory();
    renderLibrary();
  });


  /* ================= Presets ================= */

  const PR = VST.presets;

  /** The current study settings as a preset. */
  function currentPreset(name) {
    const p = { name, tone: S.tone, posterK: S.posterK, blur: S.blur, bands: S.tone === 'poster' ? 0 : S.bands };
    if (S.tone !== 'poster' && S.bands >= 2) {
      p.splits = S.splitSource[S.bands] || 'fixed';
      p.thresholds = currentThresholds().slice();
      p.levelsMode = S.levelsMode;
      if (S.levelsMode === 'custom') p.customLevels = (S.customLevels[S.bands] || []).slice();
    }
    return p;
  }

  /** True when the current settings are exactly this preset. */
  function presetMatches(p) {
    if (p.tone !== S.tone || (p.blur || 0) !== S.blur) return false;
    if (p.tone === 'poster') return (p.posterK || 5) === S.posterK;
    if ((p.bands || 0) !== (S.bands >= 2 ? S.bands : 0)) return false;
    if (!(p.bands >= 2)) return true;
    if ((p.levelsMode || 'average') !== S.levelsMode) return false;
    const src = S.splitSource[S.bands] || 'fixed';
    if ((p.splits || 'fixed') !== src) return false;
    if (src === 'fixed' && String(P.sanitizeThresholds(p.thresholds, p.bands)) !== String(currentThresholds())) return false;
    if (S.levelsMode === 'custom' && String(p.customLevels || []) !== String(S.customLevels[S.bands] || [])) return false;
    return true;
  }

  function applyPreset(p) {
    S.tone = p.tone || 'gray';
    S.blur = p.blur || 0;
    if (p.posterK) S.posterK = p.posterK;
    if (S.tone !== 'poster') {
      S.bands = p.bands >= 2 ? p.bands : 0;
      if (S.bands >= 2) {
        S.levelsMode = p.levelsMode || 'average';
        S.splitSource[S.bands] = p.splits || 'fixed';
        if (p.splits === 'even') S.thresholds[S.bands] = P.evenThresholds(S.bands);
        else if (p.splits === 'fixed') S.thresholds[S.bands] = P.sanitizeThresholds(p.thresholds, S.bands);
        else work.refit = true; // fit to this image once the squint is applied
        if (S.levelsMode === 'custom' && Array.isArray(p.customLevels)) S.customLevels[S.bands] = p.customLevels.slice();
      }
    }
    syncStudyControls();
    requestStudy();
  }

  function renderPresetSelect() {
    const sel = $('#preset-select');
    const all = PR.all();
    const match = all.find(presetMatches);
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Custom settings';
    sel.appendChild(ph);
    const group = (label, list) => {
      if (!list.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      list.forEach((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        g.appendChild(o);
      });
      sel.appendChild(g);
    };
    group('Built-in', all.filter((p) => p.builtin));
    group('My presets', all.filter((p) => !p.builtin));
    sel.value = match ? match.id : '';
    $('#preset-delete').disabled = !match || match.builtin;
    $('#preset-desc').textContent = match ? PR.describe(match) : '';
  }

  $('#preset-select').addEventListener('change', (e) => {
    const p = PR.get(e.target.value);
    if (p) applyPreset(p);
    else renderPresetSelect();
  });
  $('#preset-save').addEventListener('click', () => {
    const name = prompt('Name this preset:', '');
    if (name == null) return;
    const p = PR.save(currentPreset(name));
    renderPresetSelect();
    toast(`Saved preset “${p.name}”.`);
  });
  $('#preset-delete').addEventListener('click', () => {
    const p = PR.get($('#preset-select').value);
    if (!p || p.builtin || !confirm(`Delete the preset “${p.name}”?`)) return;
    PR.remove(p.id);
    renderPresetSelect();
  });

  /* ---------- try presets on a set ---------- */

  const TRY_MAX = 520; // contact-sheet images are processed at this size
  const tryon = { set: null, preset: null, entries: new Map(), token: 0 };
  const ORIGINAL = { id: 'original', name: 'Original' };

  /** Loads a saved item as an image without making it the current study. */
  async function loadItemImage(item) {
    if (item.source === 'upload') {
      const url = URL.createObjectURL(await L.loadUpload(item));
      try {
        return await loadImageElement(url, { cors: false });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    }
    // the smaller museum size is plenty here (and much lighter than the full image)
    const raw = item.source === 'link' ? item.image : item.imageFallback || item.image;
    const url = item.source === 'link' ? raw : M.imageUrl(item, raw);
    if (!url) throw new Error('relay');
    return loadImageElement(url, { cors: true });
  }

  async function tryonEntry(item) {
    if (tryon.entries.has(item.id)) return tryon.entries.get(item.id);
    const pending = (async () => {
      const el = await loadItemImage(item);
      const s = Math.min(1, TRY_MAX / Math.max(el.naturalWidth, el.naturalHeight));
      const w = Math.max(1, Math.round(el.naturalWidth * s));
      const h = Math.max(1, Math.round(el.naturalHeight * s));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingQuality = 'high';
      x.drawImage(el, 0, 0, w, h);
      return { w, h, lab0: P.computeLab(x.getImageData(0, 0, w, h).data, w * h), cache: {} };
    })();
    tryon.entries.set(item.id, pending);
    pending.catch(() => tryon.entries.delete(item.id));
    return pending;
  }

  function renderTryonChips() {
    const box = $('#tryon-presets');
    box.innerHTML = '';
    [ORIGINAL, ...PR.all()].forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.id = p.id;
      b.textContent = p.name;
      b.setAttribute('aria-checked', String(tryon.preset && tryon.preset.id === p.id));
      b.addEventListener('click', () => {
        tryon.preset = p;
        renderTryonChips();
        renderTryonGrid();
      });
      box.appendChild(b);
    });
    $('#tryon-desc').textContent = tryon.preset && tryon.preset.id !== 'original' ? PR.describe(tryon.preset) : 'The images as they are.';
  }

  function valueBar(bands) {
    const bar = document.createElement('div');
    bar.className = 'tt-bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', bands.map((b) => `value ${valueLabel(b.L)}: ${Math.round(b.share * 100)}%`).join(', '));
    bands.forEach((b) => {
      const seg = document.createElement('span');
      const g = C.lToGray8(b.L);
      const rgb = b.rgb || [g, g, g];
      seg.style.width = `${b.share * 100}%`;
      seg.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      seg.title = `Value ${valueLabel(b.L)} · ${Math.round(b.share * 100)}%`;
      bar.appendChild(seg);
    });
    return bar;
  }

  function renderTryonGrid() {
    const grid = $('#tryon-grid');
    const token = ++tryon.token;
    const preset = tryon.preset;
    grid.innerHTML = '';
    const tiles = tryon.set.items.map((item) => {
      const fig = document.createElement('figure');
      fig.className = 'tryon-tile';
      fig.tabIndex = 0;
      fig.dataset.id = item.id;
      fig.innerHTML = '<div class="tt-img"><span class="tt-msg">Loading…</span></div><figcaption></figcaption>';
      fig.querySelector('figcaption').textContent = [item.title, item.artist].filter(Boolean).join(', ');
      const open = async () => {
        closeTryon();
        const ok = await openItem(item);
        if (ok && preset.id !== 'original') applyPreset(preset);
      };
      fig.addEventListener('click', open);
      fig.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()));
      grid.appendChild(fig);
      return { item, fig };
    });
    // a few at a time, so the first images appear quickly
    let next = 0;
    const worker = async () => {
      while (next < tiles.length) {
        const { item, fig } = tiles[next++];
        try {
          const entry = await tryonEntry(item);
          if (token !== tryon.token) return;
          const c = document.createElement('canvas');
          c.width = entry.w;
          c.height = entry.h;
          const data = c.getContext('2d').createImageData(entry.w, entry.h);
          const bands = PR.render(preset, entry, data.data);
          c.getContext('2d').putImageData(data, 0, 0);
          const box = fig.querySelector('.tt-img');
          box.innerHTML = '';
          box.appendChild(c);
          if (bands) fig.appendChild(valueBar(bands));
          fig.classList.add('ready');
        } catch (e) {
          if (token !== tryon.token) return;
          fig.querySelector('.tt-msg').textContent = e.message === 'relay' ? 'Needs the image relay' : 'Couldn’t load this image';
        }
      }
    };
    for (let i = 0; i < 4; i++) worker();
  }

  function openTryon() {
    const set = currentSet();
    if (!set || !set.items.length) return toast('Add some images to this set first.');
    tryon.set = set;
    const match = PR.all().find(presetMatches);
    tryon.preset = match || PR.get('b-3');
    $('#tryon-title').textContent = `Try presets on “${set.name}”`;
    $('#tryon-modal').hidden = false;
    renderTryonChips();
    renderTryonGrid();
  }
  function closeTryon() {
    $('#tryon-modal').hidden = true;
    tryon.token++;
  }
  $('#set-tryon').addEventListener('click', openTryon);
  $('#tryon-close').addEventListener('click', closeTryon);
  window.addEventListener('keydown', (e) => {
    if (!$('#tryon-modal').hidden && e.key === 'Escape') closeTryon();
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
      VST.log.setTimerRunning(running && flow.phase === 'draw');
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

  function onPhaseEnd(natural) {
    if (natural && flow.phase === 'draw') VST.log.round(countdown.duration);
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
      openItem(queue[flow.index]);
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
    T.keepAwake(presenting);
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
    const ok = await openItem(queue[0]);
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
    T.keepAwake(presenting || countdown.running);
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

  /* ================= Present mode ================= */

  /*
   * Hides every control so only the image(s) show, like Photoshop's
   * presentation mode. Goes full screen where the browser allows it and
   * keeps the screen awake. Shortcuts (G, F, V, K, 2-6, Space) still work.
   */
  let exitHideTimer = 0;
  function showExitButton() {
    if (!presenting) return;
    const b = $('#btn-present-exit');
    b.classList.add('show');
    clearTimeout(exitHideTimer);
    exitHideTimer = setTimeout(() => b.classList.remove('show'), 2500);
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function setPresenting(on) {
    if (on && !img.el) return toast('Load an image first.');
    if (on === presenting) return;
    presenting = on;
    document.body.classList.toggle('presenting', on);
    $('#btn-present-exit').hidden = !on;
    const root = document.documentElement;
    try {
      if (on && !fullscreenElement()) {
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        const p = req && req.call(root);
        if (p && p.catch) p.catch(() => {});
      } else if (!on && fullscreenElement()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const p = exit && exit.call(document);
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {
      /* full screen isn't available here; the controls are still hidden */
    }
    T.keepAwake(presenting || countdown.running);
    if (on) showExitButton();
    else $('#btn-present-exit').classList.remove('show');
    requestAnimationFrame(layout);
  }

  $('#btn-present').addEventListener('click', () => setPresenting(true));
  $('#btn-present-exit').addEventListener('click', () => setPresenting(false));
  // leaving full screen (e.g. the browser's own Esc) also leaves Present mode
  let enteredFullscreen = false;
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) =>
    document.addEventListener(ev, () => {
      if (presenting && !fullscreenElement() && enteredFullscreen) setPresenting(false);
      enteredFullscreen = !!fullscreenElement();
    })
  );
  ['pointermove', 'pointerdown'].forEach((ev) => document.addEventListener(ev, showExitButton, { passive: true }));
  // the browser drops the wake lock when the tab is hidden; take it back on return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (presenting || countdown.running)) T.keepAwake(true);
  });

  /* ================= Keyboard shortcuts ================= */

  document.addEventListener('keydown', (e) => {
    if (cropper.isOpen() || squarer.isOpen() || !$('#tryon-modal').hidden || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' && presenting) setPresenting(false);
    else if (k === 'p') setPresenting(!presenting);
    else if (k === 'g') toggleGrid();
    else if (k === 'f') toggleFlip();
    else if (k === 'c') openCrop();
    else if (k === 't') $('#btn-timer').click();
    else if (k === 'v') {
      const order = mine.el ? ['both', 'study', 'original', 'compare'] : ['both', 'study', 'original'];
      setView(order[(order.indexOf(S.view) + 1) % order.length]);
    } else if (/^[02-6]$/.test(k)) setBands(+k);
    else if (k === 's') addCurrentImage();
    else if (k === 'o' && mine.el) {
      if (S.view !== 'compare') setView('compare');
      setOverlay(!S.mineOverlay);
    } else if (k === 'k') setTone({ gray: 'color', color: 'poster', poster: 'gray' }[S.tone]);
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
  buildMuseumFilter();
  renderLibrary();
  renderPresetSelect();
  $('#export-format').value = S.exportFormat;
  $('#export-grid').checked = S.exportGrid;
  $('#panels').classList.add('is-empty');
  countdown.set(drawSeconds());
  renderQueue();
  setMode(S.mode);
  setPanel(S.panel);
  syncMineUi();
  window.addEventListener('resize', () => drawHistogram());

  // exposed for automated tests
  VST.app = { settings: S, work, img, loadFromUrl, setImage, flow, countdown, isPresenting: () => presenting, squarer, mine, openItem, setPanel };
})();

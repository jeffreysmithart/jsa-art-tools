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
  const CO = VST.compose;
  const G = VST.gamut;
  const PAL = VST.palette;

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
    tone: 'gray', // 'gray' | 'color' | 'poster' (main colors) | 'palette' (limited palette)
    bands: 4, // 0 = all values (no grouping), else 2..6
    thresholds: {}, // per number of values, e.g. { 4: [25, 50, 75] }
    levelsMode: 'average', // true to the image's light key
    customLevels: {}, // per number of values, L* 0..100
    posterK: 5,
    blur: 0,
    grid: { on: false, cols: 3, rows: 3, diag: false, color: 'black', opacity: 70 },
    // composition guides; the chosen kinds also show in Crop, even when hidden here
    compose: { on: false, thirds: true, golden: false, diag: false, cross: false, color: 'white' },
    exportFormat: 'png',
    exportGrid: true,
    timerVisible: false,
    minutes: 10,
    rounds: 1,
    breakSec: 10,
    memorySec: 0, // memory mode: look this long, then draw with the image hidden (0 = off)
    memoryLast: 30, // the look time M turns back on
    revealSeq: '', // staged reveal during timed rounds, e.g. '2,3,full' ('' = off)
    revealLast: '2,3,full', // the stages the Reveal button and R use
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
    spaceUnused: false, // color space: also show the colors the picture doesn't use
    palette: ['prussian-blue', 'yellow-ochre', 'vermilion', 'ivory-black', 'titanium-white'], // limited palette paints
    palMark: true, // Palette study: stripe what the palette can't reach
    palShow: false, // color space: show the palette's range and fade what it can't mix (off unless asked)
    overlapBand: 'all', // gamut overlap wheel: 'all' | 'darks' | 'middles' | 'lights'
    palMine: null, // the palette of your own last chosen or saved, so changes to it can be saved back
    mask: null, // gamut mask: { shape, points: [[a, b], …] } (made when first shown)
    maskOn: false, // paint the study inside the mask
    maskStrength: 100, // how far colors outside move toward the mask (percent)
    maskShowPal: false, // gamut mask wheel: outline what the palette can mix
    maskMine: null, // the saved mask last chosen or saved, so changes to it can be saved back
    maskTarget: 'picture', // paints for the mask: 'picture' (the picture moved into it) or 'whole' (every color inside it)
    spaceMatch: 0, // color space: how close a color must be to count as the tapped one (ΔE; 0 = that dot only)
    settingsVersion: 3,
  };

  function loadSettings() {
    const saved = store.get('settings', {}) || {};
    const s = { ...DEFAULTS, ...saved };
    s.grid = { ...DEFAULTS.grid, ...(saved.grid || {}) };
    s.compose = { ...DEFAULTS.compose, ...(saved.compose || {}) };
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
    if (!['gray', 'color', 'poster', 'palette'].includes(s.tone)) s.tone = 'gray';
    if (!Array.isArray(s.palette) || !s.palette.length) s.palette = DEFAULTS.palette.slice();
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
  // on a phone, two stacked images are small: start on the study alone
  if (!(store.get('settings', {}) || {}).view && window.matchMedia && matchMedia('(max-width: 600px)').matches) S.view = 'study';
  if (S.view === 'compare') S.view = 'both'; // the study photo isn't kept between visits
  let saveTimer = 0;
  /*
   * Staged reveal: the study steps through a few values (2, then 3, …) and
   * ends on the original. It borrows the view, tone and number of values,
   * so `snapshot` holds the painter's own, which are what get saved.
   */
  const reveal = { active: false, stages: [], index: -1, snapshot: null, timed: false, skipRound: false };
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    store.set('settings', reveal.snapshot ? { ...S, ...reveal.snapshot } : S);
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

  /*
   * An image's crop is saved with it (in sets and history, as fractions of
   * the image, so it fits whatever size the image loads at), so it comes
   * back when the image is opened again, on this device or another.
   */
  function rememberCrop() {
    if (!img.item || !img.item.id || !img.w) return;
    const r = img.crop || { x: 0, y: 0, w: img.w, h: img.h };
    const crop = { x: r.x / img.w, y: r.y / img.h, w: r.w / img.w, h: r.h / img.h, preset: img.cropPreset, landscape: img.cropLandscape };
    img.item.crop = L.setCrop(img.item.id, crop);
  }
  function restoreCrop(item) {
    const c = item && item.id ? L.cropFor(item.id) || item.crop : null;
    if (!c || !img.w) return;
    const full = c.x <= 0.0005 && c.y <= 0.0005 && c.w >= 0.9995 && c.h >= 0.9995;
    img.crop = full
      ? null
      : {
          x: Math.round(c.x * img.w),
          y: Math.round(c.y * img.h),
          w: Math.max(1, Math.min(img.w - Math.round(c.x * img.w), Math.round(c.w * img.w))),
          h: Math.max(1, Math.min(img.h - Math.round(c.y * img.h), Math.round(c.h * img.h))),
        };
    img.cropPreset = c.preset || 'free';
    img.cropLandscape = c.landscape == null ? null : c.landscape;
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
    restoreCrop(item);
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
    return (S.tone === 'gray' || S.tone === 'color') && S.bands >= 2;
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

  /*
   * The gamut mask, applied to the study: each color outside the mask
   * moves toward the nearest color inside, at the same value. Only the
   * study (and its downloads) change; the analysis tools see the picture.
   */
  const MK = VST.mask;
  /** What the mask does to the study right now, as a key ('' when it does nothing). */
  function maskKey() {
    if (!S.maskOn || !MK.valid(S.mask) || S.tone === 'gray') return '';
    return `${JSON.stringify(S.mask.points)}|${S.maskStrength}`;
  }
  function masked(lab) {
    return maskKey() ? MK.apply(lab, S.mask, S.maskStrength / 100) : lab;
  }
  const maskCache = { lab: null, key: '', out: null };
  /** The picture the study is painted from: the working picture, moved into the mask when that's on. */
  function studyLab() {
    const key = maskKey();
    if (!key) return work.lab;
    if (maskCache.lab !== work.lab || maskCache.key !== key) Object.assign(maskCache, { lab: work.lab, key, out: masked(work.lab) });
    return maskCache.out;
  }

  function ensureCentroids() {
    const key = `${work.blurKey}|${S.posterK}|${maskKey()}`;
    if (work.centroids && work.centroidKey === key) return;
    work.centroids = P.kmeans(studyLab(), S.posterK);
    work.centroidKey = key;
  }

  /** Renders the study for a Lab image into `out` (RGBA). Returns band info. */
  function produceStudy(lab, hist, out, width) {
    if (S.tone === 'palette') return renderPalette(lab, out, width);
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
    const bands = produceStudy(studyLab(), work.hist, imageData.data, work.w);
    ctxStudy.putImageData(imageData, 0, 0);
    renderSwatches(bands);
    renderMine();
    drawHistogram();
    renderPresetSelect();
    if (S.panel === 'color') renderGamut();
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

  /** Composition guides over a picture (rule of thirds, golden section, diagonals). */
  function drawCompose(ctx, W, H, lineWidth) {
    const g = S.compose;
    if (!g.on) return;
    CO.draw(ctx, g, 0, 0, W, H, { color: GRID_COLORS[g.color] || GRID_COLORS.white, alpha: 0.8, lineWidth });
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
      drawCompose(ctx, W, H, Math.max(1, Math.round(dpr)));
    });
    $('#btn-grid').setAttribute('aria-pressed', String(S.grid.on));
    $('#grid-on').checked = S.grid.on;
    $('#compose-on').checked = S.compose.on;
  }

  new ResizeObserver(() => layout()).observe($('#panels'));

  /* ================= Study controls ================= */

  function syncStudyControls() {
    setSeg($('#tone-seg'), 'tone', S.tone);
    setSeg($('#bands-seg'), 'n', S.bands);
    setSeg($('#k-seg'), 'k', S.posterK);
    $('#values-ctl').hidden = S.tone === 'poster' || S.tone === 'palette';
    $('#poster-ctl').hidden = S.tone !== 'poster';
    $('#palette-ctl').hidden = S.tone !== 'palette';
    $('#pal-mark').checked = S.palMark;
    $('#palette-name').textContent = paletteName();
    const dots = $('#palette-dots');
    dots.innerHTML = '';
    for (const p of PAL.paintsFor(S.palette)) {
      const d = document.createElement('i');
      d.style.background = p.hex;
      d.title = p.name;
      dots.appendChild(d);
    }
    $('#split-ctl').hidden = !grouped();
    $('#levels-ctl').hidden = !grouped();
    $('#levels-mode').value = S.levelsMode;
    $('#blur').value = S.blur;
    $('#blur-out').textContent = S.blur ? `${S.blur}` : 'Off';
    updateCaption();
    buildThresholdSliders();
  }

  function updateCaption() {
    let text = { gray: 'Grayscale', color: 'Color', poster: `${S.posterK} main colors`, palette: `Palette · ${paletteName()}` }[S.tone];
    if (grouped()) text += ` · ${S.bands} values${S.bands === 2 ? ' (notan)' : ''}`;
    if (S.blur) text += ' · squint';
    if (maskKey()) text += ' · in a gamut mask';
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
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.style.background = bar.style.background;
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
    if (S.tone === 'poster' || S.tone === 'palette') S.tone = 'color'; // values apply to grayscale or color
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

  /* ================= Composition guides ================= */

  function syncComposeControls() {
    const g = S.compose;
    $('#compose-on').checked = g.on;
    $$('[data-compose]').forEach((el) => (el.checked = !!g[el.dataset.compose]));
    $$('[data-guide]').forEach((b) => b.setAttribute('aria-pressed', String(!!g[b.dataset.guide])));
    $('#compose-color').value = g.color;
  }
  function composeChanged() {
    syncComposeControls();
    drawOverlays();
    if (cropper.isOpen()) cropper.redraw();
    save();
  }
  function toggleCompose(on = !S.compose.on) {
    S.compose.on = on;
    // showing guides with none chosen would show nothing: start with thirds
    if (on && !CO.any(S.compose)) S.compose.thirds = true;
    composeChanged();
  }
  /** Turns one kind of guide on or off. Choosing one in the Canvas tab also shows the guides. */
  function setGuide(kind, on, show = true) {
    S.compose[kind] = on;
    if (on && show) S.compose.on = true;
    composeChanged();
  }
  $('#compose-on').addEventListener('change', (e) => toggleCompose(e.target.checked));
  $$('[data-compose]').forEach((el) => el.addEventListener('change', () => setGuide(el.dataset.compose, el.checked)));
  $('#compose-color').addEventListener('change', (e) => {
    S.compose.color = e.target.value;
    composeChanged();
  });
  // the same choices inside Crop (they don't turn the guides on over the study)
  $$('[data-guide]').forEach((b) => b.addEventListener('click', () => setGuide(b.dataset.guide, !S.compose[b.dataset.guide], false)));

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
    // the composition guides chosen in the Canvas tab, over the crop
    drawGuides(ctx, x, y, w, h) {
      CO.draw(ctx, S.compose, x, y, w, h, { alpha: 0.6, lineWidth: 1 });
    },
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
        rememberCrop();
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
    const bands = produceStudy(mine.lab, work.hist, imageData.data, mine.w);
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

  const PANELS = ['images', 'study', 'color', 'canvas', 'log'];

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
    if (name === 'color') renderGamut();
    if (name === 'log') {
      LG.tick();
      LG.flush();
      renderLog();
    }
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
  ['#crop-modal', '#square-modal', '#tryon-modal', '#space-modal', '#palcmp-modal'].forEach((sel) => manageFocus($(sel)));


  /* ================= Color tab: the color space ================= */

  /*
   * The picture's colors in a Munsell-style 3D space (value up the middle,
   * hue around, chroma outward), small in the sidebar and large in a
   * full-screen view you can turn, zoom, slice by value and tap to read.
   */
  const CS = VST.colorspace;
  const MX = VST.munsellExact;

  /**
   * A color in Munsell terms: from the renotation data when it's loaded
   * (exact notation, e.g. 7.8R 5.2/20), else the Lab approximation.
   */
  function munsellOf(L, a, b) {
    const m = MX && MX.fromLab(L, a, b);
    if (!m) {
      const r = CS.munsell(L, a, b);
      return { exact: false, neutral: r.hue === 'N', code: r.hue, name: r.hueName, value: r.value, chroma: r.chroma };
    }
    const f = m.hue == null ? null : MX.family(m.hue);
    return {
      exact: true,
      neutral: !f,
      code: f ? f.code : 'N',
      name: f ? f.name : 'neutral gray',
      hue: f ? MX.notation(m).split(' ')[0] : null, // e.g. 7.8R
      value: Math.round(m.value * 10) / 10,
      chroma: Math.round(m.chroma),
      notation: MX.notation(m),
    };
  }
  const toRgb = (L, a, b) => C.labToRgb8(L, a, b, [0, 0, 0]);
  const colorCache = { lab: null, stats: null, cells: null };
  let shell = null; // the rest of the color space, made once when first shown
  const spaceSmall = CS.createView($('#space-small'), { toRgb });
  const spaceBig = CS.createView($('#space-big'), { toRgb, interactive: true, onPick: showReading });

  function colorData() {
    if (!work.lab) return null;
    if (colorCache.lab !== work.lab) {
      colorCache.lab = work.lab;
      colorCache.stats = G.analyze(work.lab).stats;
      colorCache.cells = CS.sample(work.lab);
    }
    const marks = S.tone === 'poster' && work.centroids ? work.centroids.map((c) => ({ L: c[0], a: c[1], b: c[2] })) : [];
    if (S.spaceUnused && !shell) shell = CS.solidShell((r, g, b) => C.rgbToLab(r, g, b, [0, 0, 0]));
    const pal = paletteReach();
    return {
      cells: colorCache.cells,
      shell: S.spaceUnused ? shell : [],
      marks,
      stats: colorCache.stats,
      palette: S.palShow && pal ? ensurePalette().mixes : [],
      out: S.palShow && pal ? pal.outCells : null,
    };
  }

  /** The strongest colors' chroma in Munsell steps, at the main hue and a middle value. */
  function strongMunsell(st) {
    const t = ((st.hue == null ? 0 : st.hue) * Math.PI) / 180;
    const m = munsellOf(50, st.strongChroma * Math.cos(t), st.strongChroma * Math.sin(t));
    return m.exact ? m.chroma : Math.round(st.strongChroma / 5);
  }

  function renderGamut() {
    if (!$('#space-small').clientWidth) return; // hidden
    renderPaletteUi();
    renderMask();
    const d = colorData();
    $('#gamut-empty').hidden = !!d;
    spaceSmall.setShowUnused(S.spaceUnused);
    spaceSmall.setData(d || {});
    const box = $('#gamut-stats');
    if (!d) {
      box.innerHTML = '';
      return;
    }
    const st = d.stats;
    const stat = (big, small) => `<div class="stat"><b>${big}</b><span>${small}</span></div>`;
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    // the main hue in the same Munsell terms as the 3D view
    const t = st.hue == null ? null : (st.hue * Math.PI) / 180;
    const mh = t == null ? null : munsellOf(50, 20 * Math.cos(t), 20 * Math.sin(t));
    box.innerHTML =
      stat(mh && !mh.neutral ? `${cap(mh.name)} (${mh.exact ? mh.hue : mh.code})` : 'Gray', 'main hue') +
      stat(cap(G.strength(st.strongChroma)), `strongest colors · chroma ≈ ${strongMunsell(st)}`) +
      stat(`${Math.round(st.neutralShare * 100)}%`, 'near gray') +
      stat(`${st.valueLow}–${st.valueHigh}`, 'value range');
    $('#space-open').setAttribute(
      'aria-label',
      `Open the color space larger. Main hue ${mh && !mh.neutral ? mh.name : 'none (gray)'}; strongest colors ${G.strength(st.strongChroma)}; ${Math.round(st.neutralShare * 100)}% near gray; values ${st.valueLow} to ${st.valueHigh}.`
    );
    $('#gamut-marks-hint').hidden = !d.marks.length;
    $('#pal-out-hint').hidden = !(d.out && d.out.size);
    if (!$('#space-modal').hidden) spaceBig.setData(d);
  }

  function setSpaceUnused(on) {
    S.spaceUnused = on;
    $('#space-unused').checked = on;
    $('#space-unused-big').checked = on;
    const d = colorData();
    spaceSmall.setShowUnused(on);
    spaceBig.setShowUnused(on);
    if (d) {
      spaceSmall.setData(d);
      spaceBig.setData(d);
    }
    save();
  }
  $('#space-unused').addEventListener('change', (e) => setSpaceUnused(e.target.checked));
  $('#space-unused-big').addEventListener('change', (e) => setSpaceUnused(e.target.checked));

  /** What the tapped color is, in Munsell-style terms, and where it is in the picture. */
  function showReading(cell) {
    const box = $('#space-readout');
    box.hidden = !cell;
    showWhere(cell);
    if (!cell) return;
    const m = munsellOf(cell.L, cell.a, cell.b);
    const [r, g, b] = toRgb(cell.L, cell.a, cell.b);
    box.querySelector('.sw').style.background = `rgb(${r},${g},${b})`;
    if (m.exact) {
      box.querySelector('b').textContent = `${m.notation} · ${m.name}`;
      box.querySelector('.mun').textContent = m.neutral ? `Munsell value ${m.value}, no chroma` : `Munsell hue ${m.hue}, value ${m.value}, chroma ${m.chroma}`;
    } else {
      box.querySelector('b').textContent = m.neutral ? `Value ${m.value} · neutral gray` : `Value ${m.value} · chroma ≈ ${m.chroma} · hue ≈ ${m.code} (${m.name})`;
      box.querySelector('.mun').textContent = '';
    }
    const model = ensurePalette();
    const hit = model && PAL.nearest(model, cell.L, cell.a, cell.b);
    const near = hit && model.mixes[hit.i];
    $('#space-palette').textContent = !near
      ? ''
      : hit.d <= PAL.REACH
        ? `Your palette: ${PAL.recipe(near.parts)} (ΔE ${Math.round(hit.d)})`
        : `Out of your palette’s reach: the closest mix is ${Math.round(hit.d)} ΔE away (${PAL.recipe(near.parts)})`;
    const pct = cell.share * 100;
    box.querySelector('.share').textContent = pct < 0.1 ? 'under 0.1% of the picture' : `${pct >= 1 ? Math.round(pct) : pct.toFixed(1)}% of the picture`;
  }

  /*
   * Where the tapped color is: a copy of the picture beside the space with
   * the matching pixels in color and the rest in faded gray. Tapping the
   * picture finds that pixel's color in the space.
   */
  const MATCHES = [0, 6, 12, 20];
  let whereCell = null;
  function showWhere(cell) {
    whereCell = cell;
    const panel = $('#space-pic');
    const was = !panel.hidden;
    panel.hidden = !cell || !work.lab;
    if (was !== !panel.hidden) spaceBig.request(); // the space's room changed
    if (panel.hidden) return;
    const cv = $('#space-pic-canvas');
    if (cv.width !== work.w || cv.height !== work.h) {
      cv.width = work.w;
      cv.height = work.h;
    }
    cv.classList.toggle('flipped', S.flip);
    const within = MATCHES.includes(S.spaceMatch) ? S.spaceMatch : 0;
    $('#space-match').value = String(within);
    const { mask, share } = CS.matchMask(work.lab, cell, within);
    const ctx = cv.getContext('2d');
    const out = ctx.createImageData(work.w, work.h);
    // the white edge is about 1.5 screen pixels wide however large the picture is shown
    const shownW = cv.getBoundingClientRect().width || 400;
    CS.paintMatch(work.lab, mask, out.data, toRgb, { width: work.w, edge: Math.max(1, Math.round((1.5 * work.w) / shownW)) });
    ctx.putImageData(out, 0, 0);
    const pct = share * 100;
    $('#space-pic-share').textContent = !share
      ? 'Not in the picture at these settings.'
      : `${pct < 0.1 ? 'Under 0.1%' : `${pct >= 1 ? Math.round(pct) : pct.toFixed(1)}%`} of the picture${within ? `, within ${within} ΔE of this color` : ''}.`;
  }
  $('#space-match').addEventListener('change', (e) => {
    S.spaceMatch = +e.target.value;
    save();
    if (whereCell) showWhere(whereCell);
  });
  $('#space-pic-clear').addEventListener('click', () => spaceBig.pick(null));
  $('#space-pic-canvas').addEventListener('click', (e) => {
    const cv = e.currentTarget;
    const r = cv.getBoundingClientRect();
    if (!work.lab || !r.width || !r.height) return;
    let x = Math.floor(((e.clientX - r.left) / r.width) * cv.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * cv.height);
    if (S.flip) x = cv.width - 1 - x; // shown mirrored, like the study
    if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
    const i = y * cv.width + x;
    const key = CS.cellKey(work.lab.L[i], work.lab.A[i], work.lab.B[i]);
    const cell = (colorCache.cells || []).find((c) => c.key === key);
    if (cell) spaceBig.pick(cell);
  });

  function openSpace() {
    const d = colorData();
    if (!d) return toast('Load an image first.');
    $('#space-modal').hidden = false;
    $('#space-unused-big').checked = S.spaceUnused;
    spaceBig.setShowUnused(S.spaceUnused);
    spaceBig.setData(d);
    spaceBig.pick(null);
    requestAnimationFrame(() => spaceBig.render());
  }
  function closeSpace() {
    $('#space-modal').hidden = true;
  }
  $('#space-open').addEventListener('click', openSpace);
  $('#space-close').addEventListener('click', closeSpace);
  $('#space-top').addEventListener('click', () => spaceBig.view('top'));
  $('#space-side').addEventListener('click', () => spaceBig.view('side'));
  $('#space-reset').addEventListener('click', () => {
    $('#space-slice').value = '';
    spaceBig.setSlice(null);
    spaceBig.view('default');
  });
  $('#space-slice').addEventListener('change', (e) => {
    spaceBig.setSlice(e.target.value);
    // one value at a time reads best from above, like a page of a Munsell book
    if (e.target.value !== '') spaceBig.view('top');
  });
  window.addEventListener('resize', () => {
    if (!$('#space-modal').hidden) spaceBig.request();
  });
  window.addEventListener('keydown', (e) => {
    if ($('#space-modal').hidden) return;
    const k = e.key;
    if (k === 'Escape') closeSpace();
    else if (e.target.tagName === 'SELECT') return;
    else if (k === 'ArrowLeft') spaceBig.turn(-10, 0);
    else if (k === 'ArrowRight') spaceBig.turn(10, 0);
    else if (k === 'ArrowUp') spaceBig.turn(0, 8);
    else if (k === 'ArrowDown') spaceBig.turn(0, -8);
    else if (k === '+' || k === '=') spaceBig.zoomBy(1.2);
    else if (k === '-') spaceBig.zoomBy(1 / 1.2);
    else return;
    e.preventDefault();
  });

  /* ================= Limited palette ================= */

  /*
   * A few paints, what they can mix (simulated with spectral.js), how much
   * of the picture that reaches, and a Palette study that repaints the
   * picture with the nearest mixes, striping what's out of reach.
   */
  const palState = { key: '', model: null, reachKey: '', reach: null };

  // what each palette mixes, kept for the palettes tried lately (suggestions and the compare sheet)
  const palModels = new Map();
  function paletteModel(ids) {
    if (!window.spectral) return null;
    const key = PAL.paintsFor(ids).map((p) => p.id).join(',');
    let m = palModels.get(key);
    if (m) {
      palModels.delete(key); // most recent last
    } else {
      m = PAL.build(ids, window.spectral, (r, g, b) => C.rgbToLab(r, g, b, [0, 0, 0]));
      if (palModels.size >= 48) palModels.delete(palModels.keys().next().value);
    }
    palModels.set(key, m);
    return m;
  }

  function ensurePalette() {
    const key = S.palette.join(',');
    if (palState.key !== key) {
      palState.key = key;
      palState.model = paletteModel(S.palette);
      palState.reachKey = '';
    }
    return palState.model;
  }

  /** "Blue-greens and blues": the one or two hue families that make up most of some colors. */
  function hueFamilies(cells) {
    const families = new Map();
    let total = 0;
    for (const c of cells) {
      const m = CS.munsell(c.L, c.a, c.b);
      const name = m.hue === 'N' ? (c.L < 50 ? 'dark grays' : 'light grays') : `${m.hueName}s`;
      families.set(name, (families.get(name) || 0) + c.share);
      total += c.share;
    }
    const ranked = [...families.entries()].sort((p, q) => q[1] - p[1]);
    return ranked.filter(([, v], i) => i === 0 || (i === 1 && v >= total * 0.25)).map(([n]) => n).join(' and ');
  }
  const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const pctLabel = (v) => (v > 0 && v < 0.01 ? '<1' : Math.round(v * 100));

  /** How much of the current picture the palette reaches (cached per image and palette). */
  function paletteReach() {
    const model = ensurePalette();
    if (!model || !work.lab) return null;
    if (colorCache.lab !== work.lab) colorData();
    const key = `${palState.key}|${work.blurKey}|${work.w}x${work.h}`;
    if (palState.reachKey !== key || !palState.reach) {
      palState.reach = PAL.reach(model, colorCache.cells);
      palState.reachKey = key;
    }
    return palState.reach;
  }

  function samePaints(a, b) {
    return a.length === b.length && a.every((id) => b.includes(id));
  }
  const MP = VST.myPalettes;
  /** Your own palette with exactly these paints, if any (preferred over a preset of the same paints). */
  const myMatch = (ids) => MP.all().find((x) => samePaints(PAL.paintsFor(x.paints).map((p) => p.id), PAL.paintsFor(ids).map((p) => p.id))) || null;
  function paletteName() {
    const mine = myMatch(S.palette);
    if (mine) return mine.name;
    const p = PAL.PRESETS.find((x) => samePaints(x.paints, S.palette));
    return p ? p.name.replace(/ \(.*\)$/, '') : 'my palette';
  }

  /** The study, repainted with the palette's nearest mixes. */
  function renderPalette(lab, out, width) {
    const model = ensurePalette();
    const n = lab.L.length;
    if (!model) {
      P.renderColor(lab, out);
      return null;
    }
    const counts = PAL.paint(model, lab, out, width, { mark: S.palMark });
    // swatches: the mixes that cover the most, light to dark
    return [...counts.entries()]
      .sort((p, q) => q[1] - p[1])
      .slice(0, 6)
      .map(([i, c]) => ({ L: model.mixes[i].L, rgb: model.mixes[i].rgb, share: c / n }))
      .sort((p, q) => p.L - q.L);
  }

  function renderPaletteUi() {
    const sel = $('#pal-preset');
    const mine = myMatch(S.palette);
    if (mine) S.palMine = mine.id;
    const match = mine ? null : PAL.PRESETS.find((x) => samePaints(x.paints, S.palette));
    sel.value = mine ? `mine:${mine.id}` : match ? match.id : 'custom';
    $('#pal-source').hidden = !(match && match.source);
    $('#pal-source').textContent = match && match.source ? match.source : '';
    $('#pal-rename').hidden = !mine;
    $('#pal-delete').hidden = !mine;
    // changed the paints of one of yours: offer to save them back to it
    const edited = !mine && S.palMine ? MP.get(S.palMine) : null;
    $('#pal-update').hidden = !edited;
    if (edited) $('#pal-update').textContent = `Save these paints to “${edited.name}”`;
    const box = $('#pal-paints');
    box.innerHTML = '';
    for (const p of PAL.paintsFor(S.palette)) {
      const chip = document.createElement('span');
      chip.className = 'pal-chip';
      chip.innerHTML = '<i></i><span></span><button type="button" class="pal-remove">×</button>';
      chip.querySelector('i').style.background = p.hex;
      chip.querySelector('span').textContent = p.name;
      const rm = chip.querySelector('button');
      rm.setAttribute('aria-label', `Remove ${p.name}`);
      rm.title = `Remove ${p.name}`;
      rm.disabled = S.palette.length <= 1;
      rm.addEventListener('click', () => setPalette(S.palette.filter((id) => id !== p.id)));
      box.appendChild(chip);
    }
    const add = $('#pal-add');
    add.innerHTML = '<option value="">+ Add a paint…</option>';
    for (const p of [...PAL.PIGMENTS].sort((x, y) => x.name.localeCompare(y.name))) {
      if (S.palette.includes(p.id)) continue;
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      add.appendChild(o);
    }
    $('#pal-range').checked = S.palShow;
    $('#space-pal').checked = S.palShow;
    renderStandins();
    const stats = $('#pal-stats');
    const r = paletteReach();
    if (!r) {
      stats.innerHTML = '';
      $('#pal-suggest').hidden = true;
      sugg.token++;
      return;
    }
    const stat = (big, small) => `<div class="stat"><b>${big}</b><span>${small}</span></div>`;
    // name the one or two hue families that make up most of what's out of reach
    // (an average hue of, say, greens and blues would name neither)
    const outLabel = r.outShare >= 0.005 ? capFirst(hueFamilies(r.outCells)) : 'Nothing';
    stats.innerHTML = stat(`${pctLabel(r.reached)}%`, 'of the picture it can mix') + stat(outLabel, r.outShare >= 0.005 ? `can’t mix (${pctLabel(r.outShare)}%)` : 'it can’t mix');
    renderOverlap();
    suggestPaints(r);
  }

  /*
   * What stands in for each hue: the palette's strongest color in each of
   * the ten hue families, with how strong it is and, tapped, its recipe and
   * Munsell notation. Shows what a palette (say, phthalo green, dioxazine
   * violet and cad orange) uses for its red, yellow and blue.
   */
  const stand = { key: '', list: null, pick: null };
  function renderStandins() {
    const box = $('#pal-standins');
    const model = ensurePalette();
    box.hidden = !model;
    if (!model) return;
    if (stand.key !== palState.key) {
      stand.key = palState.key;
      stand.list = PAL.standIns(model, CS.HUES);
      stand.pick = null;
    }
    const grid = $('#standin-grid');
    grid.innerHTML = '';
    for (const st of stand.list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'standin';
      b.setAttribute('aria-pressed', String(stand.pick === st.code));
      const munsellChroma = st.mix ? munsellOf(st.mix.L, st.mix.a, st.mix.b).chroma : 0;
      b.innerHTML = `<span class="sw${st.mix ? '' : ' none'}"></span><span class="bar"><i></i></span><span class="cd"></span>`;
      if (st.mix) b.querySelector('.sw').style.background = `rgb(${st.mix.rgb.join(',')})`;
      b.querySelector('.bar i').style.width = `${Math.min(100, (munsellChroma / 16) * 100)}%`;
      b.querySelector('.cd').textContent = st.code;
      b.setAttribute('aria-label', st.mix ? `${st.name}: chroma ${munsellChroma}` : `${st.name}: none`);
      b.addEventListener('click', () => {
        stand.pick = stand.pick === st.code ? null : st.code;
        renderStandins();
      });
      grid.appendChild(b);
    }
    $('#standin-detail').textContent = standinText();
    renderContrast();
  }

  /*
   * Contrast check: the tapped stand-in as the same small square on three
   * grounds (a gray of the same value, the palette's own complement, and
   * the picture as this palette would paint it), so simultaneous contrast
   * shows on screen: a weak red reads redder inside its green.
   */
  const contrastPic = { key: '', canvas: null };
  function renderContrast() {
    const box = $('#standin-contrast');
    const pick = stand.list && stand.list.find((s) => s.code === stand.pick);
    box.hidden = !pick || !pick.mix;
    if (box.hidden) return;
    const mix = pick.mix;
    const rgb = (m) => `rgb(${m.rgb.join(',')})`;
    box.querySelectorAll('.cc-chip').forEach((c) => (c.style.background = rgb(mix)));
    const gray = C.lToGray8(mix.L);
    $('#cc-gray').style.background = `rgb(${gray},${gray},${gray})`;
    const comp = PAL.complementOf(ensurePalette(), mix);
    const g = $('#cc-comp');
    g.classList.toggle('none', !comp);
    g.style.background = comp ? rgb(comp) : '';
    $('#cc-comp-cap').textContent = comp ? 'In its complement' : 'No complement in this palette';
    g.title = comp ? `The palette’s opposite: ${PAL.recipe(comp.parts)}` : '';
    // the picture, painted with this palette (no stripes), under the square
    const fig = $('#cc-pic-fig');
    fig.hidden = !work.lab;
    if (!work.lab) return;
    const small = smallLab();
    const key = `${palState.key}|${small.w}x${small.h}|${work.blurKey}|${S.flip}`;
    const cv = $('#cc-pic canvas');
    if (contrastPic.key !== key || contrastPic.small !== small) {
      cv.width = small.w;
      cv.height = small.h;
      const ctx = cv.getContext('2d');
      const data = ctx.createImageData(small.w, small.h);
      PAL.paint(ensurePalette(), small.lab, data.data, small.w, { mark: false });
      ctx.putImageData(data, 0, 0);
      cv.style.transform = S.flip ? 'scaleX(-1)' : '';
      Object.assign(contrastPic, { key, small });
    }
  }
  function standinText() {
    const list = stand.list;
    const pick = list.find((s) => s.code === stand.pick);
    if (pick) {
      if (!pick.mix) return `${capFirst(pick.name)}: nothing. The palette can’t mix a ${pick.name} with any strength; the colors around it would have to suggest one.`;
      const m = munsellOf(pick.mix.L, pick.mix.a, pick.mix.b);
      const weak = m.chroma < 4 ? ' A weak stand-in: let the colors around it push it.' : '';
      return `${capFirst(pick.name)}: ${PAL.recipe(pick.mix.parts)} (${m.exact ? m.notation : `chroma ≈ ${m.chroma}`}, ${m.name}).${weak}`;
    }
    const ranked = list.map((s) => ({ ...s, c: s.mix ? munsellOf(s.mix.L, s.mix.a, s.mix.b).chroma : 0 })).sort((p, q) => q.c - p.c);
    const names = (xs) => xs.map((x) => `${x.name}s`).join(' and ');
    const none = ranked.filter((x) => !x.c);
    const weakest = none.length ? none.slice(0, 2) : ranked.slice(-2).reverse();
    return `Strongest: ${names(ranked.slice(0, 2))}. ${none.length ? 'None' : 'Weakest'}: ${names(weakest)}. Tap a hue for its mix.`;
  }

  /*
   * The gamut overlap wheel: the picture's colors (outlined) over what the
   * palette can mix (in color), with what it needs but can't mix striped,
   * for all values or just the darks, middles or lights.
   */
  const OV = VST.overlap;
  const ov = { model: null, small: null, band: '', data: null };
  const BAND_NAMES = { darks: 'darks', middles: 'middle values', lights: 'lights' };
  function renderOverlap() {
    const box = $('#pal-overlap');
    const model = ensurePalette();
    box.hidden = !model || !work.lab;
    if (box.hidden) return;
    const band = OV.BANDS[S.overlapBand] ? S.overlapBand : 'all';
    setSeg($('#overlap-band'), 'band', band);
    const small = smallLab();
    if (ov.model !== model || ov.small !== small || ov.band !== band) {
      ov.data = OV.compute(small.lab, model, (L, a, b) => PAL.nearestCached(model, L, a, b), { band, reach: PAL.REACH, toRgb: (L, a, b) => toRgb(L, a, b) });
      Object.assign(ov, { model, small, band });
    }
    const o = ov.data;
    OV.draw($('#overlap-wheel'), o, CS.HUES);
    const pct = (v) => `${pctLabel(v)}%`;
    let note;
    if (band === 'all') note = o.outShare >= 0.005 ? `Striped: colors the picture needs that this palette can’t mix (${pct(o.outShare)} of the picture).` : 'The palette can mix all of the picture’s colors.';
    else if (o.shareIn < 0.01) note = `Almost none of the picture is in the ${BAND_NAMES[band]}.`;
    else note = `The ${BAND_NAMES[band]} are ${pct(o.shareIn)} of the picture; the palette ${o.outShare >= 0.005 ? `can’t mix ${pct(o.outShare)} of them` : 'can mix them all'}.`;
    $('#overlap-note').textContent = note;
    $('#overlap-wheel').setAttribute('aria-label', `Hue and chroma wheel of the picture’s colors and what ${paletteName()} can mix. ${note}`);
  }
  $('#overlap-band').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.overlapBand = b.dataset.band;
    save();
    renderOverlap();
  });
  window.addEventListener('resize', () => {
    if (ov.data && $('#overlap-wheel').clientWidth) OV.draw($('#overlap-wheel'), ov.data, CS.HUES);
  });

  /*
   * Gamut mask (Color tab): the picture's colors on the wheel with the mask
   * over them, filled with the colors it allows; drag a corner to reshape,
   * inside to move, outside to turn. The study can be painted inside it.
   */
  const mk = { o: null, small: null, scale: 0, drag: null };
  const MM = VST.myMasks;

  /* ---------- saved masks (they sync, with sync on) ---------- */

  const samePoints = (p, q) => p.length === q.length && p.every((x, i) => Math.abs(x[0] - q[i][0]) < 0.05 && Math.abs(x[1] - q[i][1]) < 0.05);
  /** The saved mask with exactly this shape, if any. */
  const maskMatch = (m) => MM.all().find((x) => samePoints(x.points, m.points)) || null;

  function renderMaskSaved() {
    const sel = $('#mask-saved');
    const m = ensureMask();
    const list = MM.all();
    const mine = maskMatch(m);
    if (mine) S.maskMine = mine.id;
    sel.innerHTML = '';
    const opt = (value, text, disabled) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      o.disabled = !!disabled;
      sel.appendChild(o);
    };
    opt('', list.length ? (mine ? 'Saved masks' : 'This mask isn’t saved') : 'No saved masks yet', true);
    for (const x of list) opt(x.id, x.name);
    sel.value = mine ? mine.id : '';
    sel.disabled = !list.length;
    $('#mask-rename').hidden = !mine;
    $('#mask-delete').hidden = !mine;
    const edited = !mine && S.maskMine ? MM.get(S.maskMine) : null;
    $('#mask-update').hidden = !edited;
    if (edited) $('#mask-update').textContent = `Save this shape to “${edited.name}”`;
  }
  $('#mask-saved').addEventListener('change', (e) => {
    const x = MM.get(e.target.value);
    if (!x) return;
    S.maskMine = x.id;
    setMask({ shape: x.shape, points: x.points.map((p) => [p[0], p[1]]) });
  });
  $('#mask-save').addEventListener('click', () => {
    const shapeName = MK.SHAPES[ensureMask().shape] ? MK.SHAPES[ensureMask().shape].name : 'My mask';
    const name = prompt('Name this mask:', maskMatch(S.mask) ? '' : shapeName);
    if (name == null) return;
    const x = MM.save(name, S.mask);
    S.maskMine = x.id;
    save();
    renderMaskSaved();
    toast(`Saved the mask “${x.name}”.`);
  });
  $('#mask-update').addEventListener('click', () => {
    const x = S.maskMine && MM.setMask(S.maskMine, S.mask);
    if (!x) return;
    renderMaskSaved();
    toast(`Saved the shape to “${x.name}”.`);
  });
  $('#mask-rename').addEventListener('click', () => {
    const x = maskMatch(S.mask);
    if (!x) return;
    const name = prompt('Rename this mask:', x.name);
    if (name == null || !name.trim()) return;
    MM.rename(x.id, name);
    renderMaskSaved();
  });
  $('#mask-delete').addEventListener('click', () => {
    const x = maskMatch(S.mask);
    if (!x || !confirm(`Delete the saved mask “${x.name}”? The mask on the wheel stays.`)) return;
    MM.remove(x.id);
    S.maskMine = null;
    save();
    renderMaskSaved();
  });
  function ensureMask() {
    S.mask = MK.valid(S.mask) || MK.make('triad', 60, 60);
    return S.mask;
  }
  const maskReach = (m) => Math.max(...m.points.map(([a, b]) => Math.hypot(a, b)));

  function renderMask() {
    const cv = $('#mask-wheel');
    if (!cv.clientWidth) return; // hidden
    const m = ensureMask();
    setSeg($('#mask-shape'), 'shape', m.shape);
    $('#mask-on').checked = S.maskOn;
    $('#mask-strength-ctl').hidden = !S.maskOn;
    $('#mask-strength').value = S.maskStrength;
    $('#mask-strength-out').textContent = `${S.maskStrength}%`;
    const reachNow = Math.round(maskReach(m));
    $('#mask-size').value = Math.max(15, Math.min(110, reachNow));
    $('#mask-size-out').textContent = `chroma ≈ ${Math.round(reachNow / 5)}`;
    const have = work.lab ? smallLab() : null;
    // the wheel's extent: the picture's strongest colors or the mask, whichever reaches further
    // (kept while dragging, so the wheel doesn't change under the pointer)
    const palModel = S.maskShowPal ? ensurePalette() : null;
    const palReach = palModel ? palModel.mixes.reduce((mx, x) => Math.max(mx, Math.hypot(x.a, x.b)), 0) : 0;
    if (!mk.drag) mk.scale = Math.max(40, Math.min(115, Math.max(have ? OV.pictureChroma(have.lab) : 0, reachNow, palReach) * 1.1));
    const scale = mk.scale;
    const empty = { L: new Float32Array(0), A: new Float32Array(0), B: new Float32Array(0) };
    const o = OV.grid(have ? have.lab : empty, { scale, toRgb: (L, a, b) => toRgb(L, a, b), outside: (L, a, b) => !MK.contains(m.points, a, b) });
    // inside the mask: the colors it allows, at a middle value
    const size = (2 * scale) / o.n;
    for (let k = 0; k < o.n * o.n; k++) {
      const a = -scale + ((k % o.n) + 0.5) * size;
      const b = scale - (Math.floor(k / o.n) + 0.5) * size;
      if (!MK.contains(m.points, a, b)) continue;
      const rgb = toRgb(62, a, b);
      o.pal[k * 3] = rgb[0];
      o.pal[k * 3 + 1] = rgb[1];
      o.pal[k * 3 + 2] = rgb[2];
    }
    mk.o = o;
    OV.draw(cv, o, CS.HUES);
    $('#mask-pal').checked = S.maskShowPal;
    if (palModel) {
      // the palette's range: kept per palette and wheel size, so dragging stays quick
      const key = `${palState.key}|${scale}|${o.n}`;
      if (mk.palKey !== key) {
        const cells = OV.paletteCells(palModel, { n: o.n, scale });
        Object.assign(mk, { palKey: key, palRegion: OV.solid((k) => cells[k * 3] >= 0, o.n) });
      }
      OV.outline(cv, o, (k) => mk.palRegion[k]);
    }
    drawMaskShape(cv, o, m);
    let note = 'Load an image to see how its colors fit.';
    if (have) {
      if (colorCache.lab !== work.lab) colorData();
      const out = MK.outside(m.points, colorCache.cells || []);
      note = out.outShare < 0.005 ? 'All of the picture’s colors are inside this mask.' : `${pctLabel(out.outShare)}% of the picture is outside this mask (mostly ${hueFamilies(out.outCells)}).`;
    }
    if (palModel) note += ` Dashed gold: what ${paletteName()} can mix.`;
    $('#mask-note').textContent = note;
    if (!mk.drag) {
      renderMaskSaved();
      renderMaskFit();
    }
    cv.setAttribute('aria-label', `Gamut mask: ${MK.SHAPES[m.shape] ? MK.SHAPES[m.shape].name : 'your own shape'}, pointing at ${CS.munsell(50, 20 * Math.cos((MK.heading(m) * Math.PI) / 180), 20 * Math.sin((MK.heading(m) * Math.PI) / 180)).hueName}. ${note} Arrow keys turn it.`);
  }

  /*
   * Paints for the mask: how much of the picture, moved into the mask (what
   * you'd paint), your palette can mix; which paints to add or take out; and
   * a palette built for it, a paint at a time.
   */
  const maskFit = { key: '', cells: null, sugg: { key: '', token: 0, result: null }, buildToken: 0, built: null };
  /** What paints for the mask aim at: the picture in it, or (with no picture, or by choice) the whole mask. */
  const maskAim = () => (work.lab && S.maskTarget !== 'whole' ? 'picture' : 'whole');
  const AIM_TEXT = { picture: 'the picture in this mask', whole: 'the colors in this mask' };
  /** A color a screen can show (so a paint could plausibly match it). */
  function realColor(L, a, b) {
    const rgb = C.labToRgb8(L, a, b, [0, 0, 0]);
    const back = C.rgbToLab(rgb[0], rgb[1], rgb[2], [0, 0, 0]);
    return Math.hypot(back[0] - L, back[1] - a, back[2] - b) < 3;
  }
  /**
   * The colors paints for the mask aim at, as cells: the picture moved into
   * the mask (at the strength in use, from the small copy), or every color
   * a screen can show inside the mask, at a range of values.
   */
  function maskCells() {
    if (maskAim() === 'whole') {
      const key = `whole|${JSON.stringify(S.mask.points)}`;
      if (maskFit.key !== key) {
        Object.assign(maskFit, { key, small: null, cells: MK.sampleInside(S.mask.points, { real: realColor }) });
        if (maskFit.built && maskFit.built.key !== key) maskFit.built = null;
      }
      return maskFit.cells;
    }
    const small = smallLab();
    const strength = S.maskOn ? S.maskStrength / 100 : 1;
    const key = `${JSON.stringify(S.mask.points)}|${strength}|${small.w}x${small.h}|${work.blurKey}`;
    if (maskFit.key !== key || maskFit.small !== small) {
      Object.assign(maskFit, { key, small, cells: CS.sample(MK.apply(small.lab, S.mask, strength)) });
      if (maskFit.built && maskFit.built.key !== key) maskFit.built = null;
    }
    return maskFit.cells;
  }

  function renderMaskFit() {
    const box = $('#mask-fit');
    const model = ensurePalette();
    box.hidden = !model;
    if (box.hidden) return;
    const aim = maskAim();
    setSeg($('#mask-aim'), 'aim', aim);
    $('#mask-aim [data-aim="picture"]').disabled = !work.lab;
    const m = S.mask;
    const cells = maskCells();
    if (!cells.length) {
      $('#mask-fit-note').textContent = 'This mask is too small to hold any colors.';
      $('#mask-suggest').hidden = true;
      return;
    }
    const base = PAL.reach(model, cells);
    $('#mask-fit-note').textContent = `${capFirst(paletteName())} can mix ${pctLabel(base.reached)}% of ${AIM_TEXT[aim]}${base.outShare >= 0.005 ? `; not ${hueFamilies(base.outCells)}` : ''}.`;
    suggestFor(maskFit.sugg, { box: $('#mask-suggest'), key: `${maskFit.key}|${palState.key}`, base, cells, what: 'this mask', inside: (a, b) => MK.contains(m.points, a, b) });
    renderMaskBuilt();
  }

  function renderMaskBuilt() {
    const out = $('#mask-build-out');
    const b = maskFit.built;
    out.hidden = !b;
    if (!b) return;
    out.innerHTML = '';
    if (b.working) {
      out.innerHTML = `<p class="pal-sg-wait">Trying paints… ${b.working}</p>`;
      return;
    }
    const paints = document.createElement('div');
    paints.className = 'mb-paints';
    for (const p of PAL.paintsFor(b.ids)) {
      const span = document.createElement('span');
      span.innerHTML = `<i style="background:${p.hex}"></i>`;
      span.append(p.name);
      paints.appendChild(span);
    }
    const steps = document.createElement('p');
    steps.className = 'mb-steps hint';
    steps.textContent = `Mixes ${pctLabel(b.reached)}% of ${AIM_TEXT[b.aim] || AIM_TEXT.picture}. ` + b.steps.map((s) => `+ ${PAL.byId.get(s.id).name.toLowerCase()} ${pctLabel(s.reached)}%`).join(' → ');
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'btn tiny';
    use.textContent = samePaints(b.ids, PAL.paintsFor(S.palette).map((p) => p.id)) ? 'This is your palette' : 'Use this palette';
    use.disabled = samePaints(b.ids, PAL.paintsFor(S.palette).map((p) => p.id));
    use.addEventListener('click', () => {
      S.palMine = null;
      setPalette(b.ids);
      toast('Palette chosen. Save… keeps it under My palettes.');
    });
    out.append(paints, steps, use);
  }

  $('#mask-pal').addEventListener('change', (e) => {
    S.maskShowPal = e.target.checked;
    save();
    renderMask();
  });

  $('#mask-aim').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    S.maskTarget = b.dataset.aim;
    save();
    renderMaskFit();
  });

  $('#mask-build').addEventListener('click', () => {
    if (!window.spectral) return toast('Mixing isn’t available in this browser.');
    const colors = +$('#mask-build-n').value;
    const aim = maskAim();
    const m = ensureMask();
    const cells = maskCells();
    const key = maskFit.key;
    const token = ++maskFit.buildToken;
    const g = PAL.grow(cells, { colors, spectral: window.spectral, toLab: (r, gg, b) => C.rgbToLab(r, gg, b, [0, 0, 0]), inside: (a, b) => MK.contains(m.points, a, b) });
    let tried = 0;
    const per = PAL.PIGMENTS.length;
    maskFit.built = { key, working: 'paint 1' };
    renderMaskBuilt();
    const step = () => {
      if (token !== maskFit.buildToken || maskFit.key !== key) return;
      const t0 = performance.now();
      let r;
      while (performance.now() - t0 < 25) {
        r = g.next();
        if (r.done) break;
        tried++;
      }
      if (!r.done) {
        maskFit.built = { key, working: `paint ${Math.min(colors, Math.floor(tried / per) + 1)} of ${colors}` };
        renderMaskBuilt();
        return setTimeout(step, 0);
      }
      maskFit.built = { key, aim, ...r.value };
      renderMaskBuilt();
    };
    setTimeout(step, 30);
  });

  function drawMaskShape(cv, o, m) {
    const ctx = cv.getContext('2d');
    const g = OV.geometry(cv, o);
    const px = m.points.map(([a, b]) => g.toPx(a, b));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.beginPath();
    px.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4 * g.dpr;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * g.dpr;
    ctx.stroke();
    for (const [x, y] of px) {
      ctx.beginPath();
      ctx.arc(x, y, 6 * g.dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 1.5 * g.dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A changed mask: redraw it, and the study if it's painted inside the mask. */
  function setMask(m) {
    S.mask = m;
    renderMask();
    if (S.maskOn) requestStudy();
    save();
  }

  {
    const cv = $('#mask-wheel');
    const toAb = (e) => {
      const r = cv.getBoundingClientRect();
      const g = OV.geometry(cv, mk.o);
      return g.toAb(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height);
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!mk.o) return;
      const m = ensureMask();
      const [a, b] = toAb(e);
      const g = OV.geometry(cv, mk.o);
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * cv.width;
      const y = ((e.clientY - r.top) / r.height) * cv.height;
      // a corner within reach of a finger, else move (inside) or turn (outside)
      const reach = (e.pointerType === 'touch' ? 22 : 12) * g.dpr;
      let corner = -1;
      let best = reach;
      m.points.forEach(([pa, pb], i) => {
        const [px, py] = g.toPx(pa, pb);
        const d = Math.hypot(px - x, py - y);
        if (d < best) {
          best = d;
          corner = i;
        }
      });
      const kind = corner >= 0 ? 'corner' : MK.contains(m.points, a, b) ? 'move' : 'turn';
      mk.drag = { kind, corner, start: [a, b], mask: m, angle: Math.atan2(b, a) };
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!mk.drag) return;
      const [a, b] = toAb(e);
      const d = mk.drag;
      const lim = (v) => Math.max(-mk.scale, Math.min(mk.scale, v));
      if (d.kind === 'corner') S.mask = MK.setCorner(d.mask, d.corner, lim(a), lim(b));
      else if (d.kind === 'move') S.mask = MK.move(d.mask, a - d.start[0], b - d.start[1]);
      else S.mask = MK.rotate(d.mask, ((Math.atan2(b, a) - d.angle) * 180) / Math.PI);
      renderMask();
    });
    const end = () => {
      if (!mk.drag) return;
      mk.drag = null;
      setMask(S.mask);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('keydown', (e) => {
      const turn = { ArrowLeft: 10, ArrowRight: -10, ArrowUp: 10, ArrowDown: -10 }[e.key];
      if (!turn) return;
      e.preventDefault();
      setMask(MK.rotate(ensureMask(), e.shiftKey ? turn / 5 : turn));
    });
  }
  $('#mask-shape').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const m = ensureMask();
    setMask(MK.make(b.dataset.shape, MK.heading(m), Math.max(30, maskReach(m))));
  });
  $('#mask-size').addEventListener('input', (e) => {
    const m = ensureMask();
    const now = maskReach(m) || 1;
    S.mask = MK.scale(m, +e.target.value / now);
    renderMask();
  });
  $('#mask-size').addEventListener('change', () => setMask(S.mask));
  $('#mask-on').addEventListener('change', (e) => {
    S.maskOn = e.target.checked;
    // the mask changes colors, not values: show it in color if the study is in grays
    if (S.maskOn && S.tone === 'gray') setTone('color');
    renderMask();
    syncStudyControls();
    requestStudy();
    save();
  });
  $('#mask-strength').addEventListener('input', (e) => {
    S.maskStrength = +e.target.value;
    $('#mask-strength-out').textContent = `${S.maskStrength}%`;
    requestStudy();
    save();
  });
  window.addEventListener('resize', () => {
    if (mk.o && $('#mask-wheel').clientWidth) renderMask();
  });

  /*
   * Which paint would help this picture: the palette is tried with each
   * other paint added and each of its own taken out, a few at a time so the
   * page stays responsive, and the biggest gains and smallest losses shown.
   */
  const sugg = { key: '', token: 0, result: null };
  function suggestPaints(base) {
    suggestFor(sugg, { box: $('#pal-suggest'), key: palState.reachKey, base, cells: colorCache.cells, what: 'this picture' });
  }

  /**
   * Which paints to add or take out, for some colors (`cells`) the palette
   * reaches as `base`: tried a few at a time so the page stays responsive,
   * remembered under `key` in `st`, and shown in `box`. With `inside(a, b)`
   * (a gamut mask), paints whose mixes mostly fall outside it are flagged.
   */
  function suggestFor(st, { box, key, base, cells, what, inside }) {
    if (st.key === key && st.result) return renderSuggestions(st, box, what);
    const token = ++st.token;
    box.hidden = false;
    box.innerHTML = `<p class="pal-sg-wait">Trying other paints on ${what}…</p>`;
    const model = ensurePalette();
    // a paint taken out: the palette's own mixes without it (no new mixing needed);
    // a paint added: mixed afresh, unless the palette already mixes nearly everything
    const vars = PAL.variations(S.palette).filter((v) => v.kind === 'drop' || base.reached < 0.98);
    const tried = [];
    const stray = new Map();
    let i = 0;
    const step = () => {
      if (token !== st.token) return;
      const t0 = performance.now();
      while (i < vars.length && performance.now() - t0 < 25) {
        const v = vars[i++];
        let rr;
        if (v.kind === 'drop') rr = PAL.reach(model, cells, PAL.REACH, PAL.without(v.id));
        else {
          const extra = PAL.build(v.ids, window.spectral, (r, g, b) => C.rgbToLab(r, g, b, [0, 0, 0]), { include: v.id });
          rr = PAL.gain(base, extra);
          if (inside) stray.set(v.id, PAL.strayShare(extra, inside));
        }
        tried.push({ kind: v.kind, id: v.id, reached: rr.reached, outCells: rr.outCells });
      }
      if (i < vars.length) return setTimeout(step, 0);
      st.key = key;
      st.full = base.reached >= 0.98;
      st.result = PAL.rank(base, tried);
      st.stray = stray;
      renderSuggestions(st, box, what);
    };
    setTimeout(step, 50);
  }

  function renderSuggestions(st, box, what) {
    const { adds, drops } = st.result;
    box.hidden = false;
    box.innerHTML = '';
    const row = (label, list, empty) => {
      const div = document.createElement('div');
      div.className = 'pal-sg-row';
      div.innerHTML = `<span class="pal-sg-label">${label}</span>`;
      if (!list.length) {
        const p = document.createElement('span');
        p.className = 'pal-sg-none';
        p.textContent = empty;
        div.appendChild(p);
      }
      for (const { id, text, why, title, apply } of list) {
        const p = PAL.byId.get(id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pal-sg';
        b.title = title;
        b.innerHTML = `<i style="background:${p.hex}"></i><span class="nm"></span>${text ? '<b></b>' : ''}${why ? '<small></small>' : ''}`;
        b.querySelector('.nm').textContent = p.name;
        if (text) b.querySelector('b').textContent = text;
        if (why) b.querySelector('small').textContent = why;
        b.addEventListener('click', apply);
        div.appendChild(b);
      }
      box.appendChild(div);
    };
    const strays = (id) => st.stray && st.stray.get(id) > 0.6;
    const useful = adds.filter((a) => a.gain >= 0.01).slice(0, 3);
    row(
      `Add for ${what}`,
      useful.map((a) => ({
        id: a.id,
        text: `+${pctLabel(a.gain)}%`,
        why: [a.gained.length ? hueFamilies(a.gained) : '', strays(a.id) ? 'mostly mixes outside the mask' : ''].filter(Boolean).join(' · '),
        title: `Add ${PAL.byId.get(a.id).name.toLowerCase()}: it would reach ${pctLabel(a.gain)}% more of ${what}${strays(a.id) ? '; but most of its mixes fall outside the mask, which makes it easy to stray from the scheme' : ''}`,
        apply: () => setPalette([...S.palette, a.id]),
      })),
      st.full ? `It already mixes nearly all of ${what}.` : `No one paint adds much to ${what}.`
    );
    if (S.palette.length > 1) {
      const spare = drops.filter((d) => d.loss < 0.03).slice(0, 2);
      row(
        'Least needed here',
        spare.map((d) => ({
          id: d.id,
          text: d.loss < 0.005 ? '' : `−${pctLabel(d.loss)}%`,
          why: d.loss < 0.005 ? 'not needed here' : '',
          title: `Take out ${PAL.byId.get(d.id).name.toLowerCase()}: the palette would reach ${d.loss < 0.005 ? 'about the same' : `${pctLabel(d.loss)}% less`} of ${what}`,
          apply: () => setPalette(S.palette.filter((x) => x !== d.id)),
        })),
        'Every paint is doing work here.'
      );
    }
  }

  /** A new set of paints: rebuild what it mixes and repaint what shows it. */
  function setPalette(ids) {
    S.palette = ids.slice();
    ensurePalette();
    renderPaletteUi();
    syncStudyControls();
    if (S.tone === 'palette') requestStudy();
    renderGamut();
    save();
  }
  $('#pal-preset').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v.startsWith('mine:')) {
      const mine = MP.get(v.slice(5));
      if (mine) {
        S.palMine = mine.id;
        setPalette(mine.paints);
      }
      return;
    }
    const p = PAL.PRESETS.find((x) => x.id === v);
    if (p) {
      S.palMine = null;
      setPalette(p.paints);
    }
  });

  /* your own named palettes (they sync, with sync on) */
  $('#pal-save').addEventListener('click', () => {
    const suggestion = myMatch(S.palette) ? '' : paletteName() === 'my palette' ? '' : `${paletteName()}, mine`;
    const name = prompt('Name this palette:', suggestion);
    if (name == null) return;
    const p = MP.save(name, PAL.paintsFor(S.palette).map((x) => x.id));
    S.palMine = p.id;
    save();
    buildPaletteSelect();
    renderPaletteUi();
    toast(`Saved the palette “${p.name}”.`);
  });
  $('#pal-update').addEventListener('click', () => {
    const p = S.palMine && MP.setPaints(S.palMine, PAL.paintsFor(S.palette).map((x) => x.id));
    if (!p) return;
    buildPaletteSelect();
    renderPaletteUi();
    toast(`Saved the paints to “${p.name}”.`);
  });
  $('#pal-rename').addEventListener('click', () => {
    const mine = myMatch(S.palette);
    if (!mine) return;
    const name = prompt('Rename this palette:', mine.name);
    if (name == null || !name.trim()) return;
    MP.rename(mine.id, name);
    buildPaletteSelect();
    renderPaletteUi();
  });
  $('#pal-delete').addEventListener('click', () => {
    const mine = myMatch(S.palette);
    if (!mine || !confirm(`Delete the palette “${mine.name}”? The paints stay chosen.`)) return;
    MP.remove(mine.id);
    S.palMine = null;
    save();
    buildPaletteSelect();
    renderPaletteUi();
  });
  $('#pal-add').addEventListener('change', (e) => {
    if (e.target.value) setPalette([...S.palette, e.target.value]);
  });
  /** Shows or hides the palette in the color space (in the Color tab and the large view). */
  function setPalShow(on) {
    S.palShow = on;
    $('#pal-range').checked = on;
    $('#space-pal').checked = on;
    const d = colorData();
    if (d && !$('#space-modal').hidden) spaceBig.setData(d);
  }
  $('#space-pal').addEventListener('change', (e) => {
    setPalShow(e.target.checked);
    renderGamut();
    save();
  });
  $('#pal-range').addEventListener('change', (e) => {
    setPalShow(e.target.checked);
    renderGamut();
    save();
  });
  $('#pal-mark').addEventListener('change', (e) => {
    S.palMark = e.target.checked;
    requestStudy();
    save();
  });
  $('#pal-study').addEventListener('click', () => {
    if (!img.el) return toast('Load an image first.');
    setTone('palette');
    setPanel('study');
  });
  $('#pal-choose').addEventListener('click', () => setPanel('color'));

  /*
   * Compare palettes: this picture painted with each palette (yours and the
   * presets), how much of it each reaches and what it can't mix, the one
   * that reaches the most first. Tap one to paint the study with it.
   */
  const palcmp = { token: 0, small: null, smallFor: null };

  /** The working image at a tile's size (Lab averaged over blocks), made once per image. */
  function smallLab(max = 360) {
    if (palcmp.smallFor === work.lab) return palcmp.small;
    const k = Math.max(1, Math.ceil(Math.max(work.w, work.h) / max));
    const w = Math.max(1, Math.floor(work.w / k));
    const h = Math.max(1, Math.floor(work.h / k));
    const L = new Float32Array(w * h);
    const A = new Float32Array(w * h);
    const B = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sl = 0;
        let sa = 0;
        let sb = 0;
        for (let dy = 0; dy < k; dy++) {
          const row = (y * k + dy) * work.w + x * k;
          for (let dx = 0; dx < k; dx++) {
            sl += work.lab.L[row + dx];
            sa += work.lab.A[row + dx];
            sb += work.lab.B[row + dx];
          }
        }
        const i = y * w + x;
        const n = k * k;
        L[i] = sl / n;
        A[i] = sa / n;
        B[i] = sb / n;
      }
    }
    palcmp.small = { lab: { L, A, B }, w, h };
    palcmp.smallFor = work.lab;
    return palcmp.small;
  }

  function comparePalettes() {
    const mine = PAL.paintsFor(S.palette).map((p) => p.id);
    const list = [];
    const preset = PAL.PRESETS.find((x) => samePaints(x.paints, mine));
    const own = MP.all().map((p) => ({ name: p.name, ids: PAL.paintsFor(p.paints).map((x) => x.id) }));
    if (!preset && !own.some((p) => samePaints(p.ids, mine))) list.push({ name: 'My palette', ids: mine });
    list.push(...own);
    for (const p of PAL.PRESETS) list.push({ name: p.name.replace(/ \(.*\)$/, ''), full: p.name, ids: PAL.paintsFor(p.paints).map((x) => x.id) });
    return list.map((p) => ({ ...p, current: samePaints(p.ids, mine) }));
  }

  function renderPalCompare() {
    const grid = $('#palcmp-grid');
    const token = ++palcmp.token;
    grid.innerHTML = '<p class="pal-sg-wait">Mixing each palette…</p>';
    const list = comparePalettes();
    const small = smallLab();
    let i = 0;
    // build and measure a palette at a time, so the page stays responsive
    const step = () => {
      if (token !== palcmp.token) return;
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < 30) {
        const p = list[i++];
        p.model = paletteModel(p.ids);
        p.reach = PAL.reach(p.model, colorCache.cells);
      }
      if (i < list.length) return setTimeout(step, 0);
      list.sort((p, q) => q.reach.reached - p.reach.reached);
      grid.innerHTML = '';
      for (const p of list) grid.appendChild(palTile(p, small));
    };
    setTimeout(step, 30);
  }

  function palTile(p, small) {
    const fig = document.createElement('figure');
    fig.className = 'tryon-tile pal-tile' + (p.current ? ' current' : '');
    fig.tabIndex = 0;
    fig.setAttribute('role', 'button');
    const c = document.createElement('canvas');
    c.width = small.w;
    c.height = small.h;
    if (S.flip) c.style.transform = 'scaleX(-1)';
    const ctx = c.getContext('2d');
    const data = ctx.createImageData(small.w, small.h);
    PAL.paint(p.model, small.lab, data.data, small.w, { mark: S.palMark });
    ctx.putImageData(data, 0, 0);
    const box = document.createElement('div');
    box.className = 'tt-img';
    box.appendChild(c);
    fig.appendChild(box);
    const cap = document.createElement('figcaption');
    const name = document.createElement('div');
    name.className = 'pt-name';
    name.textContent = p.name;
    if (p.full) name.title = p.full;
    const dots = document.createElement('div');
    dots.className = 'pt-dots';
    for (const paint of PAL.paintsFor(p.ids)) {
      const d = document.createElement('i');
      d.style.background = paint.hex;
      d.title = paint.name;
      dots.appendChild(d);
    }
    if (p.current) {
      const tag = document.createElement('span');
      tag.className = 'pt-yours';
      tag.textContent = 'Yours';
      dots.appendChild(tag);
    }
    const reach = document.createElement('div');
    reach.className = 'pt-reach';
    const r = p.reach;
    reach.innerHTML = `<b>${pctLabel(r.reached)}%</b> `;
    reach.append(r.outShare >= 0.005 ? `· can’t mix ${hueFamilies(r.outCells)}` : '· mixes it all');
    cap.append(name, dots, reach);
    fig.appendChild(cap);
    const names = PAL.paintsFor(p.ids).map((x) => x.name.toLowerCase()).join(', ');
    fig.setAttribute('aria-label', `${p.name}${p.current ? ' (your palette)' : ''}: ${names}. Reaches ${pctLabel(r.reached)}% of the picture.`);
    const use = () => {
      closePalCompare();
      setPalette(p.ids);
      setTone('palette');
    };
    fig.addEventListener('click', use);
    fig.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), use()));
    return fig;
  }

  function openPalCompare() {
    if (!img.el || !work.lab) return toast('Load an image first.');
    if (!ensurePalette()) return toast('Mixing isn’t available in this browser.');
    if (colorCache.lab !== work.lab) colorData();
    $('#palcmp-mark').checked = S.palMark;
    $('#palcmp-modal').hidden = false;
    renderPalCompare();
  }
  function closePalCompare() {
    $('#palcmp-modal').hidden = true;
    palcmp.token++;
  }
  $('#pal-compare').addEventListener('click', openPalCompare);
  $('#palcmp-close').addEventListener('click', closePalCompare);
  $('#palcmp-mark').addEventListener('change', (e) => {
    S.palMark = e.target.checked;
    $('#pal-mark').checked = S.palMark;
    if (S.tone === 'palette') requestStudy();
    save();
    renderPalCompare();
  });
  window.addEventListener('keydown', (e) => {
    if (!$('#palcmp-modal').hidden && e.key === 'Escape') closePalCompare();
  });
  /** The palette menu: your palettes, the presets, the artists' palettes, and "My palette" for any other mix. */
  function buildPaletteSelect() {
    const sel = $('#pal-preset');
    sel.innerHTML = '';
    const group = (label) => {
      const g = document.createElement('optgroup');
      g.label = label;
      sel.appendChild(g);
      return g;
    };
    const option = (parent, value, text) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      parent.appendChild(o);
      return o;
    };
    const mine = MP.all();
    if (mine.length) {
      const g = group('My palettes');
      for (const p of mine) option(g, `mine:${p.id}`, p.name);
    }
    const groups = { '': group('Palettes'), artist: group('Artists’ palettes') };
    for (const p of PAL.PRESETS) option(groups[p.group || ''], p.id, p.name);
    option(sel, 'custom', 'My palette').disabled = true;
  }
  buildPaletteSelect();

  /* ================= Log tab ================= */

  const LG = VST.log;
  const logView = { month: LG.dayKey().slice(0, 7), selected: LG.dayKey() };

  /** 45 s · 12 min · 1 h 05 min */
  function fmtDur(secs) {
    secs = Math.round(secs || 0);
    if (secs < 60) return `${secs} s`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
  }

  function dayLevel(day) {
    if (!LG.practiced(day)) return 0;
    const m = LG.totals(day).secs / 60;
    return m < 10 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function renderLog() {
    const days = LG.days();
    const today = LG.dayKey();
    const st = LG.stats(days, today);
    // summary
    const stat = (big, small) => `<div class="stat"><b>${big}</b><span>${small}</span></div>`;
    $('#log-stats').innerHTML =
      stat(fmtDur(st.weekSecs), `this week · ${plural(st.weekDays, 'day')}`) +
      stat(plural(st.streak, 'day'), `streak · best ${st.longest}`) +
      stat(plural(st.monthDays, 'day'), 'this month') +
      stat(fmtDur(st.totalSecs), `all time · ${plural(st.totalDays, 'day')}`);
    // month calendar (weeks start on Monday)
    const [y, m] = logView.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7;
    const count = new Date(y, m, 0).getDate();
    $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('#cal-next').disabled = logView.month >= today.slice(0, 7);
    const cal = $('#cal');
    cal.innerHTML = '';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d) => {
      const el = document.createElement('div');
      el.className = 'dow';
      el.textContent = d;
      el.setAttribute('aria-hidden', 'true');
      cal.appendChild(el);
    });
    for (let i = 0; i < lead; i++) cal.appendChild(document.createElement('span'));
    for (let d = 1; d <= count; d++) {
      const key = `${logView.month}-${String(d).padStart(2, '0')}`;
      const day = days[key];
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d;
      b.dataset.day = key;
      const lv = dayLevel(day);
      if (lv) b.classList.add(`lv${lv}`);
      if (key === today) b.classList.add('today');
      if (key === logView.selected) b.classList.add('selected');
      b.disabled = key > today;
      const t = LG.totals(day);
      const date = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      b.setAttribute('aria-label', lv ? `${date}: ${fmtDur(t.secs)}, ${plural(t.images, 'image')}` : `${date}: no practice`);
      b.setAttribute('aria-pressed', String(key === logView.selected));
      b.addEventListener('click', () => {
        logView.selected = key;
        renderLog();
      });
      cal.appendChild(b);
    }
    renderLogDay(days);
  }

  function renderLogDay(days) {
    const box = $('#log-day');
    const key = logView.selected;
    const day = days[key];
    const [y, m, d] = key.split('-').map(Number);
    const title = key === LG.dayKey() ? 'Today' : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const entries = day ? Object.values(day.items).filter((e) => e.secs >= 10 || e.rounds).sort((a, b) => b.secs - a.secs) : [];
    box.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    const sum = document.createElement('p');
    sum.className = 'day-sum';
    if (!entries.length) {
      sum.textContent = Object.keys(days).length
        ? 'No practice logged on this day.'
        : 'Nothing logged yet. Open an image and study: your time and timed rounds show up here automatically.';
      box.appendChild(sum);
      return;
    }
    const t = LG.totals(day);
    sum.textContent =
      `${fmtDur(t.secs)} · ${plural(t.images, 'image')}` +
      (t.rounds ? ` · ${plural(t.rounds, 'timed round')} (${fmtDur(t.drawSecs)})` : '') +
      (t.memRounds ? `, ${t.memRounds} from memory` : '');
    box.appendChild(sum);
    const ul = document.createElement('ul');
    ul.className = 'log-list';
    for (const e of entries) {
      const saved = L.findItem(e.id);
      const item = saved || e;
      const li = document.createElement('li');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'log-row';
      const thumb = (saved && saved.thumb) || e.thumb;
      row.innerHTML = `${thumb ? '<img alt="" loading="lazy">' : '<span class="ph"></span>'}<span class="lr-text"><b></b><span></span></span><span class="lr-time"></span>`;
      if (thumb) row.querySelector('img').src = thumb;
      row.querySelector('b').textContent = e.title || 'Untitled';
      row.querySelector('.lr-text span').textContent = [e.artist, e.museum || (e.source === 'upload' ? 'My photo' : '')].filter(Boolean).join(' · ');
      row.querySelector('.lr-time').textContent = fmtDur(e.secs) + (e.rounds ? ` · ${e.rounds}×` : '') + (e.memRounds ? ` · ${e.memRounds} from memory` : '');
      row.title = `Study ${e.title || 'this image'} again`;
      row.addEventListener('click', () => openItem(item));
      li.appendChild(row);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  let logRaf = 0;
  LG.onChange(() => {
    if (S.panel !== 'log' || logRaf) return;
    logRaf = requestAnimationFrame(() => {
      logRaf = 0;
      renderLog();
    });
  });

  $('#cal-prev').addEventListener('click', () => {
    const [y, m] = logView.month.split('-').map(Number);
    logView.month = LG.dayKey(new Date(y, m - 2, 1).getTime()).slice(0, 7);
    renderLog();
  });
  $('#cal-next').addEventListener('click', () => {
    const [y, m] = logView.month.split('-').map(Number);
    logView.month = LG.dayKey(new Date(y, m, 1).getTime()).slice(0, 7);
    renderLog();
  });
  $('#log-export').addEventListener('click', () => {
    LG.flush();
    const blob = new Blob([LG.csv(LG.days())], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `value-study-log-${LG.dayKey()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('#log-clear').addEventListener('click', () => {
    if (!confirm('Clear your whole practice log? This can’t be undone. (Your sets and history are kept.)')) return;
    LG.clear();
    renderLog();
  });

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
    const lab = masked(P.blurLab(P.computeLab(rgba, w * h), w, h, blurSigma(w, h)));
    const hist = P.histogram(lab.L);
    ensureLab();
    if (S.tone === 'poster') ensureCentroids(); // same palette as the preview
    const out = new Uint8ClampedArray(w * h * 4);
    const bands = produceStudy(lab, hist, out, w);
    return { w, h, original: src, study: canvasFrom(out, w, h), bands };
  }

  /** Downloads include the grid and guides that are showing, if asked to. */
  function exportLines() {
    return S.exportGrid && (S.grid.on || S.compose.on);
  }

  /** Applies flip and (optionally) the grid and guides, returning a new canvas. */
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
    if (withGrid) {
      const lw = Math.max(2, Math.round(Math.max(c.width, c.height) / 900));
      drawGrid(ctx, c.width, c.height, lw);
      drawCompose(ctx, c.width, c.height, lw);
    }
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
      download(finish(r.study, exportLines()), studyName());
    } catch (e) {
      toast(CORS_HELP, true);
    }
  }

  function downloadOriginal() {
    if (!exportGuard()) return;
    try {
      const r = renderForExport();
      download(finish(r.original, exportLines()), `${slug(img.name)}-reference`);
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
    const withGrid = exportLines();
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
        toast(
          SY.status().on && item.photo
            ? 'Couldn’t get that photo from your synced copy. Check the connection and try again.'
            : SY.status().on
              ? 'That photo hasn’t synced yet: open the app on the device it was added on, and it will upload.'
              : 'That photo is no longer stored in this browser.',
          true
        );
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
    if (img.crop) {
      rememberCrop(); // cropped before the image was saved: keep that crop with it
    } else {
      restoreCrop(item); // seen before (here or, with sync, elsewhere): bring its crop back
      if (img.crop) buildSource();
    }
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
    $('#preset-delete').hidden = !match || match.builtin;
    $('#preset-desc').textContent = match ? PR.describe(match) : '';
  }

  $('#preset-select').addEventListener('change', (e) => {
    const p = PR.get(e.target.value);
    if (p) applyPreset(p);
    else renderPresetSelect();
  });
  $('#preset-save').addEventListener('click', () => {
    if (S.tone === 'palette') return toast('Presets don’t include palettes yet: choose Grayscale, Color or Main colors to save one.');
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
   *   [look] -> draw (minutes) -> [break] -> next round of the same image, or
   *   in a Master Copy session, the next painting in the queue.
   * In memory mode each round starts with a look phase (the image shows for
   * S.memorySec), then the image is hidden while you draw, and comes back
   * when the round ends so you can compare.
   */
  const flow = { session: false, index: 0, round: 1, phase: 'draw', pending: null, memory: false, peeked: false };

  const countdown = new T.Countdown({
    onTick(ms, running) {
      VST.log.setTimerRunning(running && flow.phase === 'draw');
      $('#timer-clock').textContent = T.format(ms);
      $('#timer-clock').classList.toggle('break', flow.phase === 'break');
      $('#timer-clock').classList.toggle('look', flow.phase === 'look');
      $('#timerbar').classList.toggle('ending', flow.phase === 'draw' && running && ms <= 10000);
      $('#t-play').textContent = running ? 'Pause' : ms < countdown.duration * 1000 && ms > 0 ? 'Resume' : 'Start';
      timedReveal(ms, running);
    },
    onEnd: onPhaseEnd,
  });

  /*
   * Time is one length for every round (e.g. 10), or a list for rounds that
   * get shorter (e.g. '10,5,2': 10 minutes, then 5, then 2). A list sets
   * the number of rounds itself.
   */
  function timeList() {
    const list = String(S.minutes).split(',').map(Number).filter((m) => m > 0);
    return list.length ? list : [10];
  }
  function totalRounds() {
    const list = timeList();
    return list.length > 1 ? list.length : S.rounds;
  }
  function drawSeconds(round = flow.round) {
    const list = timeList();
    return Math.round(list[Math.min(Math.max(1, round), list.length) - 1] * 60);
  }

  /** Hidden while drawing from memory, unless you chose to peek. */
  function memoryHiding() {
    return flow.phase === 'draw' && flow.memory && !flow.peeked;
  }

  function updateTimerUi() {
    const visible = S.timerVisible || flow.session;
    $('#timerbar').hidden = !visible;
    $('#btn-timer').setAttribute('aria-pressed', String(visible));
    const fresh = countdown.remainingMs >= countdown.duration * 1000;
    const parts = [];
    if (flow.phase === 'break') {
      parts.push(flow.pending === 'image' ? 'Break · next painting' : flow.pending === 'round' ? `Break · round ${flow.round + 1} next` : 'Break');
      if (flow.memory) parts.push('compare with the reference');
    } else {
      if (totalRounds() > 1) parts.push(`Round ${flow.round} of ${totalRounds()}`);
      if (flow.phase === 'look') parts.push(countdown.running ? 'Look and remember' : fresh ? 'Ready · look first, then draw from memory' : 'Paused · looking');
      else if (memoryHiding()) parts.push(countdown.running ? 'Drawing from memory' : 'Paused');
      else if (flow.reveal && fresh && !countdown.running) parts.push('Ready · reveals in stages');
      else parts.push(countdown.running ? 'Drawing' : fresh ? 'Ready' : 'Paused');
      if (reveal.active && flow.phase === 'draw') parts.push(stageLabel(reveal.stages[reveal.index]));
    }
    if (flow.session) parts.unshift(`Painting ${flow.index + 1} of ${queue.length}`);
    $('#timer-status').textContent = parts.join(' · ');
    $('#t-skip').hidden = !(flow.session || totalRounds() > 1 || flow.phase === 'break' || flow.phase === 'look' || flow.memory);
    $('#btn-session').textContent = flow.session ? 'Stop session' : 'Start timed session';
    const hide = memoryHiding();
    $('#memory-cover').hidden = !hide;
    $('#panels').classList.toggle('memory-hidden', hide);
    requestAnimationFrame(layout);
  }

  /** Get the first phase of a round ready (look in memory mode, else draw) without starting it. */
  function armRound() {
    flow.memory = S.memorySec > 0;
    flow.peeked = false;
    flow.pending = null;
    flow.phase = flow.memory ? 'look' : 'draw';
    flow.reveal = !!S.revealSeq && !flow.memory;
    reveal.skipRound = false;
    countdown.set(flow.memory ? S.memorySec : drawSeconds());
  }

  function startRound() {
    armRound();
    countdown.start();
    T.keepAwake(true);
    updateTimerUi();
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
    if (flow.phase === 'look') {
      // time's up for looking: hide the image and draw
      if (S.chime) T.chime('soft');
      startDraw();
      return;
    }
    if (natural && flow.phase === 'draw') VST.log.round(countdown.duration, { memory: flow.memory && !flow.peeked });
    if (flow.phase === 'draw') endReveal(); // the break (or the end) shows your usual view to compare
    if (flow.phase === 'break') {
      if (flow.pending === 'round') flow.round++;
      startRound();
      return;
    }
    let next = null;
    if (flow.round < totalRounds()) next = 'round';
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
      startRound();
    }
  }

  function finishFlow() {
    const wasSession = flow.session;
    const wasMemory = flow.memory;
    endReveal();
    Object.assign(flow, { session: false, index: 0, round: 1, phase: 'draw', pending: null });
    armRound();
    T.keepAwake(presenting);
    updateTimerUi();
    renderQueue();
    $('#timer-status').textContent = (wasSession ? 'Session complete. Nice work.' : 'Done') + (wasMemory ? ' Compare with the reference.' : '');
  }

  function stopFlow() {
    finishFlow();
    updateTimerUi();
  }

  async function startSession() {
    if (!queue.length) return toast('Add some paintings to the session first.');
    T.unlockAudio();
    Object.assign(flow, { session: true, index: 0, round: 1, phase: 'draw', pending: null, memory: false, peeked: false });
    S.timerVisible = true;
    renderQueue();
    updateTimerUi();
    const ok = await openItem(queue[0]);
    if (!ok || !flow.session) return;
    startRound();
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
    if (!countdown.running && countdown.remainingMs <= 0) armRound();
    countdown.toggle();
    T.keepAwake(presenting || countdown.running);
    updateTimerUi();
  }
  $('#t-play').addEventListener('click', playPause);
  $('#t-restart').addEventListener('click', () => {
    countdown.restart();
    if (reveal.active && reveal.timed && flow.phase === 'draw') showStage(0);
    updateTimerUi();
  });
  $('#t-skip').addEventListener('click', () => {
    T.unlockAudio();
    countdown.finish();
  });
  $('#t-stop').addEventListener('click', stopFlow);
  $('#memory-peek').addEventListener('click', () => {
    // seeing the image again means this round no longer counts as from memory
    flow.peeked = true;
    updateTimerUi();
  });

  /** Memory mode: look for `sec` seconds before each round (0 = off). */
  function setMemory(sec) {
    S.memorySec = sec;
    if (sec) S.memoryLast = sec;
    if (sec && S.revealSeq) S.revealSeq = ''; // a hidden image can't also be revealed in stages
    $('#t-practice').value = practiceValue();
    // a round that hasn't started yet picks up the change
    if (!countdown.running && flow.phase !== 'break' && countdown.remainingMs >= countdown.duration * 1000 && !memoryHiding()) armRound();
    updateTimerUi();
    save();
  }
  /** The Practice menu's value for the current settings: '', 'm30' (memory) or 'r2,3,full' (reveal). */
  function practiceValue() {
    if (S.memorySec > 0) return `m${S.memorySec}`;
    if (S.revealSeq) return `r${S.revealSeq}`;
    return '';
  }
  $('#t-practice').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v.startsWith('m')) setMemory(+v.slice(1));
    else if (v.startsWith('r')) setReveal(v.slice(1));
    else {
      setMemory(0);
      setReveal('');
    }
  });
  function toggleMemory() {
    const on = !(S.memorySec > 0);
    if (on && !S.timerVisible && !flow.session) {
      S.timerVisible = true;
    }
    setMemory(on ? S.memoryLast || 30 : 0);
    toast(on ? `Memory mode: look for ${T.format(S.memorySec * 1000)}, then draw with the image hidden.` : 'Memory mode off.');
  }

  function syncTimerControls() {
    $('#t-minutes').value = String(S.minutes);
    $('#t-rounds').value = String(S.rounds);
    syncRoundsControl();
    $('#t-break').value = String(S.breakSec);
    $('#t-practice').value = practiceValue();
    $('#t-chime').checked = S.chime;
  }
  /** Shorter-and-shorter times set the rounds themselves. */
  function syncRoundsControl() {
    const fixed = timeList().length > 1;
    $('#t-rounds').disabled = fixed;
    $('#t-rounds').title = fixed ? 'Set by the time: one round per length' : 'Draw the same image more than once';
    if (fixed) $('#t-rounds').value = String(timeList().length);
    else $('#t-rounds').value = String(S.rounds);
  }
  $('#t-minutes').addEventListener('change', (e) => {
    S.minutes = e.target.value.includes(',') ? e.target.value : +e.target.value;
    syncRoundsControl();
    if (flow.phase === 'draw' && !countdown.running) countdown.set(drawSeconds());
    updateTimerUi();
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

  /* ================= Staged reveal ================= */

  /*
   * Commit to the big masses first: the study shows 2 values, then 3 (and
   * so on), and finally the original. Step through by hand (Reveal button,
   * R, or tapping the image), or set Reveal in the timer to spread the
   * stages evenly over each drawing round.
   */
  const parseStages = (seq) => String(seq || '2,3,full').split(',').map((x) => (x === 'full' ? 'full' : +x));
  const stageLabel = (st) => (st === 'full' ? 'Full image' : `${st} values`);

  function beginReveal(timed) {
    if (reveal.active || !img.el) return false;
    reveal.stages = parseStages(timed ? S.revealSeq : S.revealSeq || S.revealLast);
    reveal.snapshot = { view: S.view, bands: S.bands, tone: S.tone };
    reveal.active = true;
    reveal.timed = !!timed;
    reveal.index = -1;
    showStage(0);
    return true;
  }

  function showStage(i) {
    i = Math.max(0, Math.min(reveal.stages.length - 1, i));
    if (!reveal.active || i === reveal.index) return;
    reveal.index = i;
    const st = reveal.stages[i];
    if (st === 'full') {
      setView('original');
    } else {
      const tone = reveal.snapshot.tone;
      S.tone = tone === 'gray' || tone === 'color' ? tone : 'gray'; // main colors and palette have no values to step through
      S.bands = st;
      if (S.splitSource[st] === 'auto') work.refit = true;
      syncStudyControls();
      requestStudy();
      if (S.view !== 'study') setView('study');
    }
    updateRevealUi();
  }

  /** Back to your own view and settings. */
  function endReveal() {
    if (!reveal.active) return;
    const s = reveal.snapshot;
    reveal.active = false;
    reveal.snapshot = null;
    reveal.index = -1;
    S.tone = s.tone;
    S.bands = s.bands;
    if (S.tone !== 'poster' && S.splitSource[S.bands] === 'auto') work.refit = true;
    syncStudyControls();
    requestStudy();
    setView(s.view);
    updateRevealUi();
  }

  /** Ended by hand: a timed round doesn't start it again. */
  function stopReveal() {
    if (reveal.timed) reveal.skipRound = true;
    endReveal();
  }

  /** Reveal button, R, or a tap on the image: start, step, then finish. */
  function nextStage() {
    if (!reveal.active) {
      if (!img.el) return toast('Load an image first.');
      beginReveal(false);
      return;
    }
    if (reveal.index < reveal.stages.length - 1) showStage(reveal.index + 1);
    else if (!reveal.timed) endReveal();
  }

  /** In a timed round, the stage follows the clock (tapping can still move ahead). */
  function timedReveal(ms, running) {
    if (flow.phase !== 'draw' || !flow.reveal || reveal.skipRound || !img.el) return;
    const total = countdown.duration * 1000;
    if (!running && ms >= total) return; // not started yet
    if (!reveal.active) beginReveal(true);
    else reveal.timed = true; // a reveal you started by hand joins the clock
    const n = reveal.stages.length;
    const due = Math.min(n - 1, Math.floor((1 - ms / total) * n));
    if (due > reveal.index) {
      showStage(due);
      if (S.chime && running) T.chime('soft');
      updateTimerUi();
    }
  }

  function updateRevealUi() {
    const chip = $('#reveal-chip');
    chip.hidden = !reveal.active;
    $('#btn-reveal').setAttribute('aria-pressed', String(reveal.active));
    if (!reveal.active) return;
    const n = reveal.stages.length;
    const last = reveal.index === n - 1;
    $('#reveal-stage').textContent = `${stageLabel(reveal.stages[reveal.index])} · ${reveal.index + 1} of ${n}`;
    $('#reveal-hint').textContent = reveal.timed ? (last ? '' : 'Tap to move ahead') : last ? 'Tap to finish' : 'Tap for the next stage';
  }

  $('#btn-reveal').addEventListener('click', nextStage);
  $('#reveal-end').addEventListener('click', (e) => {
    e.stopPropagation();
    stopReveal();
  });
  $('#panels').addEventListener('click', (e) => {
    if (!reveal.active || e.target.closest('button, a, input, label')) return;
    nextStage();
  });

  /** Reveal during timed rounds: a list of stages, or '' for off. */
  function setReveal(seq) {
    S.revealSeq = seq;
    if (seq) S.revealLast = seq;
    $('#t-practice').value = practiceValue();
    if (seq && S.memorySec) setMemory(0);
    $('#t-practice').value = practiceValue();
    if (!countdown.running && flow.phase !== 'break' && countdown.remainingMs >= countdown.duration * 1000 && !memoryHiding()) armRound();
    updateTimerUi();
    save();
  }

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
    if (cropper.isOpen() || squarer.isOpen() || !$('#tryon-modal').hidden || !$('#space-modal').hidden || !$('#palcmp-modal').hidden || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // changing the study by hand ends a staged reveal (and gives back your settings) first
    if (reveal.active && (/^[02-6]$/.test(k) || k === 'k' || k === 'v' || (k === 'escape' && !presenting))) stopReveal();
    if (k === 'escape' && presenting) setPresenting(false);
    else if (k === 'escape') return;
    else if (k === 'r') nextStage();
    else if (k === 'p') setPresenting(!presenting);
    else if (k === 'g') toggleGrid();
    else if (k === 'l') toggleCompose();
    else if (k === 'f') toggleFlip();
    else if (k === 'c') openCrop();
    else if (k === 't') $('#btn-timer').click();
    else if (k === 'm') toggleMemory();
    else if (k === 'v') {
      const order = mine.el ? ['both', 'study', 'original', 'compare'] : ['both', 'study', 'original'];
      setView(order[(order.indexOf(S.view) + 1) % order.length]);
    } else if (/^[02-6]$/.test(k)) setBands(+k);
    else if (k === 's') addCurrentImage();
    else if (k === 'o' && mine.el) {
      if (S.view !== 'compare') setView('compare');
      setOverlay(!S.mineOverlay);
    } else if (k === 'k') setTone({ gray: 'color', color: 'poster', poster: 'gray', palette: 'gray' }[S.tone]);
    else if (k === ' ' && !$('#timerbar').hidden) {
      e.preventDefault();
      playPause();
    } else return;
  });

  /* ================= Sync ================= */

  const SY = VST.sync;

  /** "just now", "12 min ago", "at 3:42 PM", or a date. */
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    const d = new Date(t);
    if (d.toDateString() === new Date().toDateString()) return `at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    return `on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }

  /** A link that opens the app and offers to join with this code (the code is after #, so it's never sent to a server). */
  function joinLink(code) {
    return `${location.origin}${location.pathname}#sync=${code}`;
  }

  /** Draws the join link as a QR code: dark modules on white, with a quiet margin. */
  function drawSyncQr(code) {
    const cv = $('#sync-qr');
    if (!window.qrcode || !code) return;
    const q = window.qrcode(0, 'M');
    q.addData(joinLink(code));
    q.make();
    const n = q.getModuleCount();
    const margin = 4;
    const cell = Math.max(4, Math.floor(336 / (n + margin * 2)));
    cv.width = cv.height = (n + margin * 2) * cell;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    cv.dataset.code = code;
  }

  function renderSync(st = SY.status()) {
    $('#sec-sync').hidden = !st.available;
    $('#sync-off').hidden = st.on;
    $('#sync-on-box').hidden = !st.on;
    if (!st.on) {
      $('#sync-code-box').hidden = true;
      $('#sync-show').setAttribute('aria-expanded', 'false');
      return;
    }
    const line = $('#sync-status');
    line.classList.toggle('busy', st.busy);
    line.classList.toggle('error', !!st.error && !st.busy);
    const devices = st.devices > 1 ? ` · ${st.devices} devices` : '';
    $('#sync-status-text').textContent = st.busy
      ? 'Syncing…'
      : st.error
        ? st.error
        : st.lastSync
          ? `Synced ${ago(st.lastSync)}${devices}`
          : 'Not synced yet';
    if ($('#sync-qr').dataset.code !== st.code) drawSyncQr(st.code);
    // one group per line break at most: wrap only between groups, never inside one
    const codeEl = $('#sync-code');
    codeEl.innerHTML = '';
    st.code.split('-').forEach((g, i, all) => {
      const span = document.createElement('span');
      span.className = 'code-group';
      span.textContent = i < all.length - 1 ? `${g}-` : g;
      codeEl.appendChild(span);
    });
    $('#sync-now').disabled = st.busy;
  }
  SY.onStatus(renderSync);
  // keep "synced 3 min ago" current
  setInterval(() => SY.status().on && renderSync(), 30000);

  // what another device changed: show it
  SY.onApplied((changed) => {
    if (changed.includes('sets') || changed.includes('history')) renderLibrary();
    if (changed.includes('presets')) renderPresetSelect();
    if (changed.includes('masks') && $('#mask-wheel').clientWidth) renderMaskSaved();
    if (changed.includes('palettes')) {
      buildPaletteSelect();
      renderPaletteUi();
    }
    if (S.panel === 'log' && (changed.includes('log') || changed.includes('history'))) renderLog();
  });

  function syncMsg(text, isError = false) {
    const m = $('#sync-msg');
    m.textContent = text;
    m.classList.toggle('error', isError);
  }

  $('#sync-turn-on').addEventListener('click', async () => {
    syncMsg('');
    try {
      await SY.turnOn();
      // show the new code straight away: it's needed on the other devices
      $('#sync-code-box').hidden = false;
      $('#sync-show').setAttribute('aria-expanded', 'true');
      syncMsg('Sync is on. Scan the QR code with your other devices, or enter the code there.');
    } catch (e) {
      syncMsg(e.message, true);
    }
  });
  $('#sync-join-open').addEventListener('click', () => {
    const form = $('#sync-join');
    form.hidden = !form.hidden;
    $('#sync-join-open').setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) $('#sync-code-input').focus();
  });
  $('#sync-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    syncMsg('');
    const input = $('#sync-code-input');
    if (!SY.normalize(input.value)) {
      input.classList.add('invalid');
      return syncMsg('That doesn’t look like a sync code: it has 25 letters and digits, in five groups.', true);
    }
    input.classList.remove('invalid');
    try {
      await SY.join(input.value);
      input.value = '';
      $('#sync-join').hidden = true;
      const st = SY.status();
      syncMsg(st.error ? '' : 'Joined. This device now has everything from your other devices.');
    } catch (err) {
      syncMsg(err.message, true);
    }
  });
  $('#sync-code-input').addEventListener('input', (e) => e.target.classList.remove('invalid'));
  $('#sync-now').addEventListener('click', () => SY.syncNow());
  $('#sync-show').addEventListener('click', () => {
    const box = $('#sync-code-box');
    box.hidden = !box.hidden;
    $('#sync-show').setAttribute('aria-expanded', String(!box.hidden));
  });
  $('#sync-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SY.status().code);
      toast('Sync code copied.');
    } catch (e) {
      toast('Couldn’t copy; select the code and copy it instead.', true);
    }
  });
  if (navigator.share) $('#sync-share').hidden = false;
  $('#sync-share').addEventListener('click', () => {
    const code = SY.status().code;
    navigator.share({ title: 'Value Study sync', text: `Sync code: ${code}`, url: joinLink(code) }).catch(() => {});
  });

  /*
   * Opened from the QR code (or a shared link): #sync=<code>. Take the code
   * out of the address bar right away, so it isn't left in history, then
   * offer to join.
   */
  async function joinFromLink() {
    const m = location.hash.match(/(?:^#|&)sync=([^&]+)/);
    if (!m) return;
    const code = decodeURIComponent(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    if (!SY.status().available) return;
    if (!SY.normalize(code)) return toast('That link’s sync code isn’t complete. Ask for the code again.', true);
    const st = SY.status();
    if (st.on && SY.normalize(st.code) === SY.normalize(code)) return toast('This device is already syncing with that code.');
    const ask = st.on
      ? 'Switch this device to the sync code from the link? It stops syncing with its current code; everything stays on this device.'
      : 'Join sync with the code from this link? This device will get the study sets, presets, history and log from your other devices.';
    if (!confirm(ask)) return;
    if (st.on) await SY.turnOff();
    setPanel('images');
    try {
      await SY.join(code);
      syncMsg(SY.status().error ? '' : 'Joined. This device now has everything from your other devices.');
      toast('Sync is on.');
    } catch (e) {
      syncMsg(e.message, true);
    }
  }
  $('#sync-stop').addEventListener('click', async () => {
    if (!confirm('Stop syncing on this device? Everything stays on this device, and your other devices keep syncing.')) return;
    await SY.turnOff();
    syncMsg('Sync is off on this device.');
  });
  $('#sync-delete').addEventListener('click', async () => {
    if (!confirm('Delete the synced copy for every device? Each device keeps what it has, but they’ll stop staying in step until sync is turned on again.')) return;
    try {
      await SY.turnOff({ removeCopy: true });
      syncMsg('The synced copy is deleted, and sync is off on this device.');
    } catch (e) {
      syncMsg(`Couldn’t delete it: ${e.message}`, true);
    }
  });

  /* ================= Start up ================= */

  syncStudyControls();
  syncGridControls();
  syncComposeControls();
  syncTimerControls();
  setSeg($('#view-seg'), 'view', S.view);
  $('#btn-flip').setAttribute('aria-pressed', String(S.flip));
  $('#paintings-only').checked = S.paintingsOnly;
  buildMuseumFilter();
  renderLibrary();
  renderPresetSelect();
  renderSync();
  SY.resume().then(joinFromLink);
  $('#export-format').value = S.exportFormat;
  $('#export-grid').checked = S.exportGrid;
  $('#panels').classList.add('is-empty');
  armRound();
  renderQueue();
  setMode(S.mode);
  setPanel(S.panel);
  syncMineUi();
  window.addEventListener('resize', () => {
    drawHistogram();
    if (S.panel === 'color') renderGamut();
  });
  $('#space-unused').checked = S.spaceUnused;

  // exposed for automated tests
  VST.app = { settings: S, work, img, loadFromUrl, setImage, flow, countdown, isPresenting: () => presenting, squarer, mine, openItem, setPanel };
})();

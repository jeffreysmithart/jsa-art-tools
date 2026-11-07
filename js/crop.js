/*
 * Crop tool with canvas-size presets. Works with mouse, pen and touch.
 * All rectangles are in source-image pixels.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const PRESETS = [
    { id: 'free', label: 'Free' },
    { id: 'original', label: 'Original image' },
    { id: '1x1', label: 'Square', w: 1, h: 1 },
    { id: '5x7', label: '5 × 7 in', w: 5, h: 7 },
    { id: '6x8', label: '6 × 8 in', w: 6, h: 8 },
    { id: '8x10', label: '8 × 10 in', w: 8, h: 10 },
    { id: '9x12', label: '9 × 12 in', w: 9, h: 12 },
    { id: '11x14', label: '11 × 14 in', w: 11, h: 14 },
    { id: '12x16', label: '12 × 16 in', w: 12, h: 16 },
    { id: '16x20', label: '16 × 20 in', w: 16, h: 20 },
    { id: '18x24', label: '18 × 24 in', w: 18, h: 24 },
    { id: '24x36', label: '24 × 36 in', w: 24, h: 36 },
    { id: '12x24', label: '12 × 24 in', w: 12, h: 24 },
  ];

  const HANDLE = 22; // touch-friendly hit radius in CSS px
  const MIN = 16; // minimum crop size in image px

  function presetById(id) {
    return PRESETS.find((p) => p.id === id) || PRESETS[0];
  }

  /** Width / height for a preset, or null for free. */
  function aspectFor(preset, landscape, imgW, imgH) {
    if (preset.id === 'free') return null;
    if (preset.id === 'original') return imgW / imgH;
    const long = Math.max(preset.w, preset.h);
    const short = Math.min(preset.w, preset.h);
    return landscape ? long / short : short / long;
  }

  /** Largest rect with the given aspect, centred in the image. */
  function fitRect(ar, imgW, imgH) {
    if (!ar) return { x: 0, y: 0, w: imgW, h: imgH };
    let w = imgW;
    let h = w / ar;
    if (h > imgH) {
      h = imgH;
      w = h * ar;
    }
    return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
  }

  function create(els) {
    const { modal, canvas, preset: presetSel, orient, info, apply, cancel, reset } = els;
    const ctx = canvas.getContext('2d');
    let image = null;
    let imgW = 0;
    let imgH = 0;
    let rect = null;
    let presetId = 'free';
    let landscape = false;
    let onApply = null;
    let view = { scale: 1, ox: 0, oy: 0 };
    let drag = null;

    PRESETS.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      presetSel.appendChild(o);
    });

    function ar() {
      return aspectFor(presetById(presetId), landscape, imgW, imgH);
    }

    function layout() {
      const area = canvas.parentElement.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(area.width * dpr));
      canvas.height = Math.max(1, Math.round(area.height * dpr));
      canvas.style.width = `${area.width}px`;
      canvas.style.height = `${area.height}px`;
      const pad = 24;
      const s = Math.min((area.width - pad * 2) / imgW, (area.height - pad * 2) / imgH);
      view = { scale: s, ox: (area.width - imgW * s) / 2, oy: (area.height - imgH * s) / 2 };
      draw();
    }

    function draw() {
      if (!image) return;
      const dpr = root.devicePixelRatio || 1;
      const { scale: s, ox, oy } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, ox, oy, imgW * s, imgH * s);
      const rx = ox + rect.x * s;
      const ry = oy + rect.y * s;
      const rw = rect.w * s;
      const rh = rect.h * s;
      // shade outside the crop
      ctx.fillStyle = 'rgba(20,20,20,0.62)';
      ctx.beginPath();
      ctx.rect(ox, oy, imgW * s, imgH * s);
      ctx.rect(rx, ry, rw, rh);
      ctx.fill('evenodd');
      // rule-of-thirds guides
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(rx + (rw * i) / 3, ry);
        ctx.lineTo(rx + (rw * i) / 3, ry + rh);
        ctx.moveTo(rx, ry + (rh * i) / 3);
        ctx.lineTo(rx + rw, ry + (rh * i) / 3);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
      // corner handles
      ctx.fillStyle = '#fff';
      for (const [hx, hy] of corners(rx, ry, rw, rh)) {
        ctx.fillRect(hx - 6, hy - 6, 12, 12);
      }
      const w = Math.round(rect.w);
      const h = Math.round(rect.h);
      const p = presetById(presetId);
      let shape = `${(w / h).toFixed(2)} : 1`;
      if (p.w && p.w !== p.h) {
        const long = Math.max(p.w, p.h);
        const short = Math.min(p.w, p.h);
        shape = landscape ? `${long} × ${short} proportions` : `${short} × ${long} proportions`;
      } else if (p.w) shape = 'square';
      info.textContent = `${w} × ${h} px · ${shape}`;
    }

    function corners(x, y, w, h) {
      return [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ];
    }

    function toImage(e) {
      const b = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - b.left - view.ox) / view.scale,
        y: (e.clientY - b.top - view.oy) / view.scale,
        cx: e.clientX - b.left,
        cy: e.clientY - b.top,
      };
    }

    function clampPoint(p) {
      return { x: Math.min(imgW, Math.max(0, p.x)), y: Math.min(imgH, Math.max(0, p.y)) };
    }

    /** Rect from a fixed anchor corner to the pointer, respecting the aspect. */
    function rectFromAnchor(ax, ay, px, py) {
      const a = ar();
      const sx = px >= ax ? 1 : -1;
      const sy = py >= ay ? 1 : -1;
      let w = Math.abs(px - ax);
      let h = Math.abs(py - ay);
      if (a) {
        if (w / Math.max(h, 1e-6) > a) h = w / a;
        else w = h * a;
      }
      const maxW = sx > 0 ? imgW - ax : ax;
      const maxH = sy > 0 ? imgH - ay : ay;
      if (w > maxW) {
        w = maxW;
        if (a) h = w / a;
      }
      if (h > maxH) {
        h = maxH;
        if (a) w = h * a;
      }
      w = Math.max(w, Math.min(MIN, maxW));
      h = Math.max(h, Math.min(MIN, maxH));
      return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
    }

    function onDown(e) {
      if (!image) return;
      canvas.setPointerCapture(e.pointerId);
      const p = toImage(e);
      const s = view.scale;
      const cs = corners(view.ox + rect.x * s, view.oy + rect.y * s, rect.w * s, rect.h * s);
      const anchors = corners(rect.x, rect.y, rect.w, rect.h);
      for (let i = 0; i < 4; i++) {
        if (Math.hypot(p.cx - cs[i][0], p.cy - cs[i][1]) <= HANDLE) {
          const opp = anchors[3 - i];
          drag = { type: 'resize', ax: opp[0], ay: opp[1] };
          return;
        }
      }
      if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) {
        drag = { type: 'move', dx: p.x - rect.x, dy: p.y - rect.y };
        return;
      }
      const c = clampPoint(p);
      drag = { type: 'resize', ax: c.x, ay: c.y };
    }

    function onMove(e) {
      if (!drag) {
        if (!image) return;
        const p = toImage(e);
        const s = view.scale;
        const cs = corners(view.ox + rect.x * s, view.oy + rect.y * s, rect.w * s, rect.h * s);
        const nearCorner = cs.some(([x, y]) => Math.hypot(p.cx - x, p.cy - y) <= HANDLE);
        const inside = p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
        canvas.style.cursor = nearCorner ? 'nwse-resize' : inside ? 'move' : 'crosshair';
        return;
      }
      const p = toImage(e);
      if (drag.type === 'move') {
        rect.x = Math.min(imgW - rect.w, Math.max(0, p.x - drag.dx));
        rect.y = Math.min(imgH - rect.h, Math.max(0, p.y - drag.dy));
      } else {
        const c = clampPoint(p);
        rect = rectFromAnchor(drag.ax, drag.ay, c.x, c.y);
      }
      draw();
    }

    function onUp() {
      drag = null;
    }

    function setPreset(id, refit = true) {
      presetId = id;
      presetSel.value = id;
      const p = presetById(id);
      orient.disabled = !p.w || p.w === p.h;
      orient.textContent = landscape ? 'Landscape' : 'Portrait';
      if (refit) rect = fitRect(ar(), imgW, imgH);
      draw();
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    presetSel.addEventListener('change', () => setPreset(presetSel.value));
    orient.addEventListener('click', () => {
      landscape = !landscape;
      setPreset(presetId);
    });
    reset.addEventListener('click', () => {
      landscape = imgW > imgH;
      setPreset('free');
    });
    cancel.addEventListener('click', close);
    apply.addEventListener('click', () => {
      const r = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.max(1, Math.round(rect.w)),
        h: Math.max(1, Math.round(rect.h)),
      };
      r.w = Math.min(r.w, imgW - r.x);
      r.h = Math.min(r.h, imgH - r.y);
      const cb = onApply;
      const full = r.x === 0 && r.y === 0 && r.w === imgW && r.h === imgH;
      close();
      cb && cb(full ? null : r, { presetId, landscape });
    });
    root.addEventListener('resize', () => {
      if (!modal.hidden) layout();
    });
    root.addEventListener('keydown', (e) => {
      if (!modal.hidden && e.key === 'Escape') close();
    });

    function open(opts) {
      image = opts.image;
      imgW = image.naturalWidth || image.width;
      imgH = image.naturalHeight || image.height;
      onApply = opts.onApply;
      landscape = opts.landscape != null ? opts.landscape : imgW > imgH;
      modal.hidden = false;
      rect = opts.rect ? { ...opts.rect } : fitRect(null, imgW, imgH);
      setPreset(opts.presetId || 'free', !opts.rect);
      requestAnimationFrame(layout);
    }

    function close() {
      modal.hidden = true;
      drag = null;
      onApply = null;
    }

    return { open, close, isOpen: () => !modal.hidden };
  }

  VST.crop = { create, PRESETS, aspectFor, fitRect };
})(typeof window !== 'undefined' ? window : globalThis);

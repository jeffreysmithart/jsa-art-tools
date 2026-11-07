/*
 * "Square up" screen: drag four dots onto the corners of a drawing in a
 * photo, so it can be straightened (see warp.js). Touch-friendly: a
 * magnifier shows the area under your finger while you drag.
 * Corners are in source-image pixels, ordered top-left, top-right,
 * bottom-right, bottom-left (the "top" edge is marked on screen).
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const HIT = 44; // touch-friendly hit radius, CSS px
  const ACCENT = '#d8b46a';

  function create(els) {
    const { modal, canvas, aspect, rotate, reset, cancel, apply, info } = els;
    const ctx = canvas.getContext('2d');
    let image = null;
    let imgW = 0;
    let imgH = 0;
    let quad = null;
    let refAspect = 1;
    let onApply = null;
    let view = { scale: 1, ox: 0, oy: 0 };
    let drag = -1;
    let pointer = null;

    function defaultQuad() {
      const ix = imgW * 0.12;
      const iy = imgH * 0.12;
      return [
        [ix, iy],
        [imgW - ix, iy],
        [imgW - ix, imgH - iy],
        [ix, imgH - iy],
      ];
    }

    function layout() {
      const area = canvas.parentElement.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(area.width * dpr));
      canvas.height = Math.max(1, Math.round(area.height * dpr));
      canvas.style.width = `${area.width}px`;
      canvas.style.height = `${area.height}px`;
      const pad = 28;
      const s = Math.min((area.width - pad * 2) / imgW, (area.height - pad * 2) / imgH);
      view = { scale: s, ox: (area.width - imgW * s) / 2, oy: (area.height - imgH * s) / 2 };
      draw();
    }

    const toScreen = ([x, y]) => [view.ox + x * view.scale, view.oy + y * view.scale];

    function draw() {
      if (!image) return;
      const dpr = root.devicePixelRatio || 1;
      const { scale: s, ox, oy } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, ox, oy, imgW * s, imgH * s);
      const pts = quad.map(toScreen);
      // shade everything outside the drawing
      ctx.fillStyle = 'rgba(20,20,20,0.55)';
      ctx.beginPath();
      ctx.rect(ox, oy, imgW * s, imgH * s);
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill('evenodd');
      // outline, with the top edge marked
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = ACCENT;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.stroke();
      const mx = (pts[0][0] + pts[1][0]) / 2;
      const my = (pts[0][1] + pts[1][1]) / 2;
      ctx.font = '600 12px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(20,20,20,0.75)';
      ctx.fillRect(mx - 18, my - 26, 36, 18);
      ctx.fillStyle = ACCENT;
      ctx.fillText('TOP', mx, my - 13);
      // corner dots
      pts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, i === drag ? 13 : 11, 0, Math.PI * 2);
        ctx.fillStyle = i === drag ? ACCENT : 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1d1d1d';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#1d1d1d';
        ctx.fill();
      });
      if (drag >= 0 && pointer) drawLoupe(pts[drag]);
      const ok = VST.warp.isValidQuad(quad);
      apply.disabled = !ok;
      info.textContent = ok ? 'Drag the dots onto the corners of your drawing.' : 'The corners cross over; drag them into a four-sided shape.';
      info.classList.toggle('error', !ok);
    }

    /** Magnified view of the corner being dragged, kept clear of the finger. */
    function drawLoupe([x, y]) {
      const R = 58;
      const Z = 3;
      const cw = canvas.width / (root.devicePixelRatio || 1);
      let lx = x;
      let ly = y - R - 48;
      if (ly - R < 4) ly = y + R + 48;
      lx = Math.min(cw - R - 4, Math.max(R + 4, lx));
      const [ix, iy] = quad[drag];
      const srcR = R / (view.scale * Z);
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
      ctx.clip();
      ctx.drawImage(image, ix - srcR, iy - srcR, srcR * 2, srcR * 2, lx - R, ly - R, R * 2, R * 2);
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(lx - 10, ly);
      ctx.lineTo(lx + 10, ly);
      ctx.moveTo(lx, ly - 10);
      ctx.lineTo(lx, ly + 10);
      ctx.stroke();
    }

    function localPoint(e) {
      const b = canvas.getBoundingClientRect();
      return { cx: e.clientX - b.left, cy: e.clientY - b.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!image) return;
      const p = localPoint(e);
      const pts = quad.map(toScreen);
      let best = -1;
      let bd = HIT;
      pts.forEach(([x, y], i) => {
        const d = Math.hypot(p.cx - x, p.cy - y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best < 0) return;
      drag = best;
      pointer = p;
      // keep the corner where it is; drag by the offset from where you touched
      pointer.dx = pts[best][0] - p.cx;
      pointer.dy = pts[best][1] - p.cy;
      canvas.setPointerCapture(e.pointerId);
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = localPoint(e);
      if (drag < 0) {
        const near = quad.map(toScreen).some(([x, y]) => Math.hypot(p.cx - x, p.cy - y) < HIT);
        canvas.style.cursor = near ? 'grab' : 'default';
        return;
      }
      const sx = p.cx + pointer.dx;
      const sy = p.cy + pointer.dy;
      quad[drag] = [
        Math.min(imgW, Math.max(0, (sx - view.ox) / view.scale)),
        Math.min(imgH, Math.max(0, (sy - view.oy) / view.scale)),
      ];
      pointer = { ...pointer, cx: p.cx, cy: p.cy };
      draw();
    });
    const end = () => {
      drag = -1;
      pointer = null;
      draw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    rotate.addEventListener('click', () => {
      // the corner that was bottom-left becomes top-left: the result turns 90° clockwise
      quad = [quad[3], quad[0], quad[1], quad[2]];
      draw();
    });
    reset.addEventListener('click', () => {
      quad = defaultQuad();
      draw();
    });
    cancel.addEventListener('click', close);
    apply.addEventListener('click', () => {
      if (!VST.warp.isValidQuad(quad)) return;
      const mode = aspect.value;
      const cb = onApply;
      const result = { quad: quad.map((p) => p.slice()), mode, aspect: mode === 'drawn' ? VST.warp.estimateAspect(quad) : refAspect };
      close();
      cb && cb(result);
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
      refAspect = opts.refAspect || 1;
      quad = opts.quad ? opts.quad.map((p) => p.slice()) : defaultQuad();
      aspect.value = opts.mode || 'match';
      onApply = opts.onApply;
      modal.hidden = false;
      requestAnimationFrame(layout);
    }

    function close() {
      modal.hidden = true;
      drag = -1;
      onApply = null;
    }

    return { open, close, isOpen: () => !modal.hidden, getQuad: () => quad && quad.map((p) => p.slice()) };
  }

  VST.squareup = { create };
})(typeof window !== 'undefined' ? window : globalThis);

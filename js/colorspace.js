/*
 * A 3D color space, laid out like the Munsell solid: value (light to dark)
 * runs up the middle, hue goes around, chroma (strength) goes outward from
 * the gray axis. Positions are CIE Lab (value = L* ÷ 10, as elsewhere in the
 * app), so hue names and chroma numbers are close to Munsell, not exact.
 *
 * Drawn with a plain 2D canvas: points are projected with a turnable,
 * tiltable orthographic camera and painted back to front.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  /* ---------- data ---------- */

  /**
   * The picture's colors counted into small 3D cells (L in `lStep`,
   * a and b in `abStep`), each with its average color and share.
   */
  function sample(lab, { lStep = 5, abStep = 5 } = {}) {
    const n = lab.L.length;
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const L = lab.L[i];
      const a = lab.A[i];
      const b = lab.B[i];
      const key = (Math.round(L / lStep) * 1000 + Math.round(a / abStep) + 500) * 1000 + Math.round(b / abStep) + 500;
      let c = map.get(key);
      if (!c) map.set(key, (c = { n: 0, L: 0, a: 0, b: 0 }));
      c.n++;
      c.L += L;
      c.a += a;
      c.b += b;
    }
    const cells = [];
    for (const c of map.values()) cells.push({ L: c.L / c.n, a: c.a / c.n, b: c.b / c.n, share: c.n / n });
    return cells;
  }

  /**
   * Points on the surface of all the colors a screen can show (the sRGB
   * solid), with their Lab and RGB: the "rest of the color space".
   * `toLab(r, g, b)` returns [L, a, b].
   */
  function solidShell(toLab, steps = 22) {
    const pts = [];
    const seen = new Set();
    const v = (i) => Math.round((255 * i) / steps);
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        for (const [r, g, b] of [
          [0, v(i), v(j)],
          [255, v(i), v(j)],
          [v(i), 0, v(j)],
          [v(i), 255, v(j)],
          [v(i), v(j), 0],
          [v(i), v(j), 255],
        ]) {
          const key = (r << 16) | (g << 8) | b;
          if (seen.has(key)) continue;
          seen.add(key);
          const [L, A, B] = toLab(r, g, b);
          pts.push({ L, a: A, b: B, rgb: [r, g, b] });
        }
      }
    }
    return pts;
  }

  /* ---------- Munsell-style reading ---------- */

  // Lab hue angles of the ten Munsell principal hues (5R, 5YR, …), approximate
  const HUES = [
    ['R', 'red', 25],
    ['YR', 'orange', 60],
    ['Y', 'yellow', 95],
    ['GY', 'yellow-green', 125],
    ['G', 'green', 160],
    ['BG', 'blue-green', 195],
    ['B', 'blue', 235],
    ['PB', 'purple-blue', 280],
    ['P', 'purple', 315],
    ['RP', 'red-purple', 350],
  ];

  /** Value 0–10, chroma (≈ Munsell steps: Lab chroma ÷ 5) and the nearest principal hue. */
  function munsell(L, a, b) {
    const C = Math.hypot(a, b);
    const value = Math.round(L / 5) / 2; // half steps, like the value scale elsewhere
    if (C < 4) return { value, chroma: 0, hue: 'N', hueName: 'neutral gray', labChroma: C };
    const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    let best = HUES[0];
    let bestD = 999;
    for (const hue of HUES) {
      const d = Math.min(Math.abs(h - hue[2]), 360 - Math.abs(h - hue[2]));
      if (d < bestD) {
        bestD = d;
        best = hue;
      }
    }
    return { value, chroma: Math.max(1, Math.round(C / 5)), hue: best[0], hueName: best[1], labChroma: C, angle: h };
  }

  /* ---------- the view ---------- */

  const VIEWS = {
    default: { yaw: -35, pitch: 22 },
    side: { yaw: -35, pitch: 0 },
    top: { yaw: 0, pitch: 90 },
  };

  /**
   * Projects Lab to the screen. World: x = a, y = L − 50 (value up),
   * z = −b, so looking straight down shows yellow (+b) at the top.
   */
  function projector(cam, W, H) {
    const yaw = (cam.yaw * Math.PI) / 180;
    const pitch = (cam.pitch * Math.PI) / 180;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const k = (cam.zoom * Math.min(W, H)) / 250;
    const ox = W / 2 + (cam.panX || 0);
    const oy = H / 2 + (cam.panY || 0);
    return (L, a, b) => {
      const x = a;
      const y = L - 50;
      const z = -b;
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      return [ox + x1 * k, oy - y2 * k, z2, k];
    };
  }

  /**
   * A drawable, optionally interactive view on a canvas.
   * opts: { interactive, toRgb(L, a, b) -> [r, g, b], onPick(cell|null) }
   */
  function createView(canvas, opts) {
    const ctx = canvas.getContext('2d');
    // zoom follows the picture (`userZoom` false) until you zoom by hand
    const cam = { ...VIEWS.default, zoom: 1, userZoom: false, panX: 0, panY: 0 };
    let data = { cells: [], shell: [], marks: [] };
    let showUnused = false;
    let slice = null; // a value 0–10 to show one level, or null for all
    let picked = null;
    let raf = 0;
    let drawn = []; // screen positions of the picture's colors, for picking

    function size() {
      const dpr = root.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      return { w, h, dpr };
    }

    const inSlice = (L) => slice == null || Math.abs(L / 10 - slice) <= 0.5;

    /**
     * Zoom that fits the picture's colors: most photos stay well inside the
     * screen's range, so they'd be a small cluster at zoom 1. Looking down
     * there's no value height to fit, so it can zoom in further. Showing the
     * whole color space fits that instead.
     */
    function autoZoom() {
      if (showUnused) return 1;
      const fit = 100 / (Math.max(data.fitChroma || 0, 12) * 1.5);
      return Math.max(1, Math.min(cam.pitch > 80 ? 3.5 : 1.8, fit));
    }
    function zoom() {
      return cam.userZoom ? cam.zoom : autoZoom();
    }

    function render() {
      raf = 0;
      const { w, h, dpr } = size();
      const P = projector({ ...cam, zoom: zoom() }, w, h);
      ctx.clearRect(0, 0, w, h);
      // the value axis: a gray line from black to white, with 0–10 ticks
      const [x0, y0] = P(0, 0, 0);
      const [x1, y1] = P(100, 0, 0);
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgb(20,20,20)');
      grad.addColorStop(1, 'rgb(245,245,245)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const font = Math.round(10.5 * dpr);
      ctx.font = `${font}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textBaseline = 'middle';
      if (opts.interactive && cam.pitch < 80) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'right';
        for (let v = 0; v <= 10; v += 2) {
          const [tx, ty] = P(v * 10, 0, 0);
          ctx.fillText(String(v), tx - 8 * dpr, ty);
        }
      }
      // the slice: a ring on the floor of that value, to read it like a page
      const ringL = slice == null ? 50 : slice * 10;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1 * dpr;
      for (const c of [25, 50, 75, 100]) {
        ctx.beginPath();
        for (let d = 0; d <= 360; d += 6) {
          const t = (d * Math.PI) / 180;
          const [px, py] = P(ringL, Math.cos(t) * c, Math.sin(t) * c);
          if (d) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      // hue letters around the outside, pulled in when zoomed so they stay on screen
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      const [, , , k] = P(50, 0, 0);
      const labelR = Math.min(112, (Math.min(w, h) / 2 - 16 * dpr) / k);
      for (const [code, , ang] of HUES) {
        const t = (ang * Math.PI) / 180;
        const [hx, hy] = P(ringL, Math.cos(t) * labelR, Math.sin(t) * labelR);
        ctx.fillText(code, hx, hy);
      }

      // everything to draw, back to front
      const items = [];
      // what the palette can mix, as a ghost (a little stronger than the screen solid)
      for (const p of data.palette) {
        if (!inSlice(p.L)) continue;
        const [sx, sy, z] = P(p.L, p.a, p.b);
        items.push({ z, sx, sy, ghost: true, rgb: p.rgb, alpha: 0.32 });
      }
      if (showUnused) {
        for (const p of data.shell) {
          if (!inSlice(p.L)) continue;
          const [sx, sy, z] = P(p.L, p.a, p.b);
          items.push({ z, sx, sy, ghost: true, rgb: p.rgb });
        }
      }
      const maxShare = data.cells.reduce((m, c) => Math.max(m, c.share), 0) || 1;
      for (const c of data.cells) {
        if (!inSlice(c.L)) continue;
        const [sx, sy, z] = P(c.L, c.a, c.b);
        items.push({ z, sx, sy, cell: c, r: Math.sqrt(c.share / maxShare) });
      }
      items.sort((p, q) => q.z - p.z);
      const zoomR = Math.sqrt(zoom()) * (Math.min(w, h) / (300 * dpr)) ** 0.5;
      drawn = [];
      for (const it of items) {
        if (it.ghost) {
          ctx.globalAlpha = it.alpha || 0.22;
          ctx.fillStyle = `rgb(${it.rgb[0]},${it.rgb[1]},${it.rgb[2]})`;
          ctx.beginPath();
          ctx.arc(it.sx, it.sy, 2.6 * dpr * zoomR, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }
        const c = it.cell;
        const rad = (1.6 + 6 * it.r) * dpr * zoomR;
        const [r, g, b] = opts.toRgb(c.L, c.a, c.b);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(it.sx, it.sy, rad, 0, Math.PI * 2);
        ctx.fill();
        if (data.out && data.out.has(c)) {
          // a color the palette can't mix: ringed
          ctx.lineWidth = 1.5 * dpr;
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.beginPath();
          ctx.arc(it.sx, it.sy, rad + 2 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
        drawn.push({ x: it.sx, y: it.sy, rad, cell: c });
      }
      for (const m of data.marks) {
        if (!inSlice(m.L)) continue;
        const [sx, sy] = P(m.L, m.a, m.b);
        const [r, g, b] = opts.toRgb(m.L, m.a, m.b);
        ctx.beginPath();
        ctx.arc(sx, sy, 7 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.stroke();
      }
      if (picked) {
        const [sx, sy] = P(picked.L, picked.a, picked.b);
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx, sy, 11 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.arc(sx, sy, 13 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function request() {
      if (!raf) raf = requestAnimationFrame(render);
    }

    /** The picture's color nearest a point on the canvas (CSS px), or null. */
    function pickAt(cssX, cssY) {
      const dpr = root.devicePixelRatio || 1;
      const x = cssX * dpr;
      const y = cssY * dpr;
      let best = null;
      let bestD = 16 * dpr;
      // later in `drawn` = nearer the viewer, so prefer those on ties
      for (let i = drawn.length - 1; i >= 0; i--) {
        const d = Math.hypot(drawn[i].x - x, drawn[i].y - y) - drawn[i].rad;
        if (d < bestD) {
          bestD = d;
          best = drawn[i].cell;
        }
      }
      return best;
    }

    function pick(cell) {
      picked = cell;
      opts.onPick && opts.onPick(cell);
      request();
    }

    if (opts.interactive) {
      const pointers = new Map();
      let start = null;
      let moved = false;
      let pinch = null;
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = false;
        start = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
        if (pointers.size === 2) {
          const [p, q] = [...pointers.values()];
          pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), zoom: zoom() };
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && pinch) {
          const [p, q] = [...pointers.values()];
          cam.zoom = clampZoom((pinch.zoom * Math.hypot(p.x - q.x, p.y - q.y)) / Math.max(1, pinch.d));
          cam.userZoom = true;
          moved = true;
          request();
          return;
        }
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > 4) moved = true;
        if (!moved) return;
        cam.yaw = start.yaw + dx * 0.5;
        cam.pitch = Math.max(-10, Math.min(90, start.pitch + dy * 0.4));
        request();
      });
      const up = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!moved && pointers.size === 0 && e.type === 'pointerup') {
          const b = canvas.getBoundingClientRect();
          pick(pickAt(e.clientX - b.left, e.clientY - b.top));
        }
        if (pointers.size === 1) {
          const [p] = [...pointers.values()];
          start = { x: p.x, y: p.y, yaw: cam.yaw, pitch: cam.pitch };
        }
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          cam.zoom = clampZoom(zoom() * Math.exp(-e.deltaY * 0.0015));
          cam.userZoom = true;
          request();
        },
        { passive: false }
      );
    }

    function clampZoom(z) {
      return Math.max(0.6, Math.min(5, z));
    }

    return {
      setData(d) {
        data = {
          cells: d.cells || [],
          shell: d.shell || [],
          marks: d.marks || [],
          palette: d.palette || [],
          out: d.out || null,
          fitChroma: d.stats ? d.stats.strongChroma : 0,
        };
        if (picked && !data.cells.includes(picked)) pick(null);
        request();
      },
      setShowUnused(on) {
        showUnused = !!on;
        request();
      },
      setSlice(v) {
        slice = v == null || v === '' ? null : +v;
        request();
      },
      view(name) {
        Object.assign(cam, VIEWS[name] || VIEWS.default);
        if (name === 'default') Object.assign(cam, { zoom: 1, userZoom: false, panX: 0, panY: 0 });
        request();
      },
      turn(dYaw, dPitch) {
        cam.yaw += dYaw;
        cam.pitch = Math.max(-10, Math.min(90, cam.pitch + dPitch));
        request();
      },
      zoomBy(f) {
        cam.zoom = clampZoom(zoom() * f);
        cam.userZoom = true;
        request();
      },
      pick,
      pickAt,
      render,
      request,
      camera: () => ({ ...cam, zoom: zoom() }),
    };
  }

  VST.colorspace = { sample, solidShell, munsell, projector, createView, HUES, VIEWS };
})(typeof window !== 'undefined' ? window : globalThis);

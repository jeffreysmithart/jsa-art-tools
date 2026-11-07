/*
 * Practice log: what you studied, on which days, and for how long.
 * Kept in this browser (localStorage). The Log view reads it; this module
 * only records.
 *
 * Shape: { version: 1, days: { 'YYYY-MM-DD': { items: { [itemId]: {
 *   id, title, artist, museum, source, secs, drawSecs, rounds } } } } }
 *   secs      time the image was on screen (while the page was visible and
 *             someone was around: 30 idle minutes stop the clock unless a
 *             timer is running)
 *   drawSecs  time in completed timed drawing rounds
 *   rounds    completed timed rounds
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});
  const KEY = 'value-study:log';
  const IDLE_MS = 30 * 60 * 1000;
  const MAX_STEP_MS = 90 * 1000; // a longer gap between ticks means the device slept

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && v.days) return v;
    } catch (e) {
      /* fall through */
    }
    return { version: 1, days: {} };
  }
  function store(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* storage unavailable or full */
    }
  }

  function dayKey(t = Date.now()) {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function entryFor(data, item, t) {
    const day = (data.days[dayKey(t)] = data.days[dayKey(t)] || { items: {} });
    const e = (day.items[item.id] = day.items[item.id] || { id: item.id, secs: 0, drawSecs: 0, rounds: 0 });
    // keep the details current (titles can arrive after the first record)
    for (const k of ['title', 'artist', 'museum', 'source']) if (item[k]) e[k] = item[k];
    return e;
  }

  const state = { item: null, last: 0, activity: Date.now(), timerRunning: false, pendingMs: 0 };

  /** Adds on-screen time for the current image since the last tick. */
  function tick(now = Date.now()) {
    if (!state.item) return;
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const idle = !state.timerRunning && now - state.activity > IDLE_MS;
    const step = now - state.last;
    state.last = now;
    if (!visible || idle || step <= 0 || step > MAX_STEP_MS) return;
    state.pendingMs += step;
    if (state.pendingMs >= 5000) flush(now);
  }

  function flush(now = Date.now()) {
    if (!state.item || state.pendingMs < 1000) return;
    const data = load();
    entryFor(data, state.item, now).secs += Math.round(state.pendingMs / 1000);
    state.pendingMs = 0;
    store(data);
  }

  /** The image now being studied (an item from the library). */
  function start(item, now = Date.now()) {
    if (state.item) {
      tick(now);
      flush(now);
    }
    state.item = item && item.id ? item : null;
    state.last = now;
    state.pendingMs = 0;
    if (state.item) {
      const data = load();
      entryFor(data, state.item, now);
      store(data);
    }
  }

  /** A timed drawing round on the current image ran to the end. */
  function round(seconds, now = Date.now()) {
    if (!state.item) return;
    const data = load();
    const e = entryFor(data, state.item, now);
    e.drawSecs += Math.round(seconds);
    e.rounds += 1;
    store(data);
  }

  function activity(now = Date.now()) {
    state.activity = now;
  }
  function setTimerRunning(on) {
    state.timerRunning = !!on;
  }

  function days() {
    return load().days;
  }

  if (typeof window !== 'undefined') {
    setInterval(() => tick(), 15000);
    ['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, () => activity(), { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        tick();
        flush();
      } else {
        state.last = Date.now(); // don't count the time away
      }
    });
    window.addEventListener('pagehide', () => {
      tick();
      flush();
    });
  }

  VST.log = { start, round, tick, flush, activity, setTimerRunning, days, dayKey };
})(typeof window !== 'undefined' ? window : globalThis);

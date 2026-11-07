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
 *   memRounds those of the rounds drawn from memory (memory mode), a subset
 *             of `rounds`; memSecs is their drawing time (part of drawSecs)
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
  const listeners = [];
  function store(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* storage unavailable or full */
    }
    listeners.forEach((fn) => fn());
  }
  function onChange(fn) {
    listeners.push(fn);
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
    for (const k of ['title', 'artist', 'museum', 'source', 'date', 'image', 'imageFallback', 'link', 'credit', 'needsRelay', 'blobId']) {
      if (item[k] !== undefined && item[k] !== '') e[k] = item[k];
    }
    if (item.thumb && !String(item.thumb).startsWith('data:')) e.thumb = item.thumb;
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

  /**
   * A timed drawing round on the current image ran to the end.
   * `memory` is true when it was drawn from memory with the image hidden.
   */
  function round(seconds, { memory = false } = {}, now = Date.now()) {
    if (!state.item) return;
    const data = load();
    const e = entryFor(data, state.item, now);
    e.drawSecs += Math.round(seconds);
    e.rounds += 1;
    if (memory) {
      e.memRounds = (e.memRounds || 0) + 1;
      e.memSecs = (e.memSecs || 0) + Math.round(seconds);
    }
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

  /* ---------- reading the log ---------- */

  /** A day counts as practice with at least a minute of study or one timed round. */
  function practiced(day) {
    if (!day) return false;
    return Object.values(day.items).some((e) => e.secs >= 60 || e.rounds > 0);
  }

  function totals(day) {
    const t = { secs: 0, drawSecs: 0, rounds: 0, memRounds: 0, memSecs: 0, images: 0 };
    if (!day) return t;
    for (const e of Object.values(day.items)) {
      t.secs += e.secs || 0;
      t.drawSecs += e.drawSecs || 0;
      t.rounds += e.rounds || 0;
      t.memRounds += e.memRounds || 0;
      t.memSecs += e.memSecs || 0;
      if ((e.secs || 0) >= 10 || e.rounds) t.images += 1;
    }
    return t;
  }

  function shiftDay(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + n).getTime());
  }

  /**
   * Summary numbers. `today` is a day key. Weeks start on Monday.
   * The current streak counts back from today (or from yesterday, so a
   * streak isn't "broken" before you've had the chance to practice today).
   */
  function stats(daysMap, today = dayKey()) {
    const keys = Object.keys(daysMap).filter((k) => practiced(daysMap[k])).sort();
    const set = new Set(keys);
    const [y, m, d] = today.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = Monday
    const weekStart = shiftDay(today, -dow);
    const monthPrefix = today.slice(0, 7);
    let weekSecs = 0;
    let weekDays = 0;
    let monthDays = 0;
    let totalSecs = 0;
    for (const k of Object.keys(daysMap)) {
      const t = totals(daysMap[k]);
      totalSecs += t.secs;
      if (k >= weekStart && k <= today) {
        weekSecs += t.secs;
        if (set.has(k)) weekDays += 1;
      }
      if (k.startsWith(monthPrefix) && set.has(k)) monthDays += 1;
    }
    let streak = 0;
    let cursor = set.has(today) ? today : shiftDay(today, -1);
    while (set.has(cursor)) {
      streak += 1;
      cursor = shiftDay(cursor, -1);
    }
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const k of keys) {
      run = prev && shiftDay(prev, 1) === k ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = k;
    }
    return { weekSecs, weekDays, monthDays, streak, longest, totalSecs, totalDays: keys.length };
  }

  /** One row per image per day, for a spreadsheet. */
  function csv(daysMap) {
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [['date', 'title', 'artist', 'museum', 'source', 'study_minutes', 'timed_rounds', 'timed_minutes', 'memory_rounds', 'memory_minutes']];
    for (const k of Object.keys(daysMap).sort()) {
      for (const e of Object.values(daysMap[k].items)) {
        if (!(e.secs >= 10 || e.rounds)) continue;
        rows.push([k, e.title, e.artist, e.museum, e.source, (e.secs / 60).toFixed(1), e.rounds, ((e.drawSecs || 0) / 60).toFixed(1), e.memRounds || 0, ((e.memSecs || 0) / 60).toFixed(1)]);
      }
    }
    return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
  }

  function clear() {
    state.pendingMs = 0;
    store({ version: 1, days: {} });
    if (state.item) start(state.item);
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

  VST.log = { start, round, tick, flush, activity, setTimerRunning, days, dayKey, onChange, practiced, totals, stats, csv, clear, shiftDay };
})(typeof window !== 'undefined' ? window : globalThis);

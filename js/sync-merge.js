/*
 * Merge rules for syncing across devices. Plain functions, no network:
 * given what two devices hold, they return what both should hold. Every
 * merge is order-independent (merge(a, b) equals merge(b, a)) and safe to
 * repeat (merging the result again changes nothing), so devices can sync in
 * any order, any number of times, and end up the same.
 *
 * Deletions leave a small "removed" marker (a tombstone) with the time, so
 * a deletion on one device isn't undone by a device that still has the
 * thing. An edit made after a deletion wins over it.
 *
 * Documents:
 *   sets     { sets: [set], deleted: { [setId]: time } }
 *            set: { id, name, nameAt, created, updated, items: [item], removed: { [itemId]: time } }
 *            item: { id, ..., at }  (at = when it was added or last changed)
 *   presets  { presets: [preset], deleted: { [presetId]: time } }  preset: { id, ..., updated }
 *   history  { items: [item], removed: { [itemId]: time }, clearedAt }  item: { id, ..., viewed }
 *   log      one document per device: { device, days, clearedAt } (see js/log.js)
 *
 * Older data without these times counts as time 0: it still merges, and any
 * later change or deletion wins over it.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  /**
   * A time for a new change: now, but always later than any time already
   * seen, so a device whose clock runs slow can't lose its edits.
   */
  function stamp(lastSeen = 0, now = Date.now()) {
    return Math.max(now, lastSeen + 1);
  }

  /** The larger time for each key of two { key: time } maps. */
  function maxMap(a = {}, b = {}) {
    const out = { ...a };
    for (const [k, t] of Object.entries(b)) out[k] = Math.max(out[k] || 0, t || 0);
    return out;
  }

  const byId = (list) => new Map((list || []).filter((x) => x && x.id).map((x) => [x.id, x]));

  /**
   * The newer of two versions of the same thing by `field`; on a tie, the
   * one whose JSON sorts first, so both devices pick the same one.
   */
  function newer(a, b, field) {
    if (!a) return b;
    if (!b) return a;
    const ta = a[field] || 0;
    const tb = b[field] || 0;
    if (ta !== tb) return ta > tb ? a : b;
    return JSON.stringify(a) <= JSON.stringify(b) ? a : b;
  }

  /**
   * An uploaded photo's synced name (`photo`) is added by the device that
   * has the photo; keep it whichever device's copy of the item wins.
   */
  function withPhoto(item, x, y) {
    const photo = item.photo || (x && x.photo) || (y && y.photo);
    return photo ? { ...item, photo } : item;
  }

  /* ---------- study sets ---------- */

  const itemTime = (it, set) => it.at || it.added || (set && set.created) || 0;

  /** A set with every time filled in, so older data merges like new. */
  function normalizeSet(s) {
    const removed = { ...(s.removed || {}) };
    const items = (s.items || [])
      .map((it) => ({ ...it, at: itemTime(it, s) }))
      .filter((it) => it.at > (removed[it.id] || 0))
      .sort((p, q) => p.at - q.at || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    return { ...s, nameAt: s.nameAt || s.created || 0, items, removed };
  }

  function mergeSet(a, b) {
    if (!a || !b) return normalizeSet(a || b);
    a = normalizeSet(a);
    b = normalizeSet(b);
    const named = newer({ name: a.name, nameAt: a.nameAt || a.created || 0 }, { name: b.name, nameAt: b.nameAt || b.created || 0 }, 'nameAt');
    const removed = maxMap(a.removed, b.removed);
    const ia = byId(a.items);
    const ib = byId(b.items);
    const items = [];
    for (const id of new Set([...ia.keys(), ...ib.keys()])) {
      const x = ia.get(id);
      const y = ib.get(id);
      const pick = !x ? y : !y ? x : itemTime(x, a) === itemTime(y, b) ? newer(x, y, 'at') : itemTime(x, a) > itemTime(y, b) ? x : y;
      const at = Math.max(x ? itemTime(x, a) : 0, y ? itemTime(y, b) : 0);
      if (at > (removed[id] || 0)) items.push(withPhoto({ ...pick, at }, x, y));
    }
    // oldest first, as they were added; ties by id so both devices agree
    items.sort((p, q) => p.at - q.at || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    return {
      ...newer(a, b, 'updated'),
      name: named.name,
      nameAt: named.nameAt,
      created: Math.min(a.created || 0, b.created || 0) || a.created || b.created || 0,
      updated: Math.max(a.updated || 0, b.updated || 0),
      items,
      removed,
    };
  }

  function mergeSets(a = {}, b = {}) {
    const deleted = maxMap(a.deleted, b.deleted);
    const sa = byId(a.sets);
    const sb = byId(b.sets);
    const sets = [];
    for (const id of new Set([...sa.keys(), ...sb.keys()])) {
      const set = mergeSet(sa.get(id), sb.get(id));
      if ((set.updated || set.created || 0) > (deleted[id] || 0)) sets.push(set);
    }
    // newest first, as the Images tab lists them
    sets.sort((p, q) => (q.created || 0) - (p.created || 0) || (p.id < q.id ? -1 : 1));
    return { sets, deleted };
  }

  /* ---------- presets ---------- */

  function mergePresets(a = {}, b = {}) {
    const deleted = maxMap(a.deleted, b.deleted);
    const pa = byId(a.presets);
    const pb = byId(b.presets);
    const presets = [];
    for (const id of new Set([...pa.keys(), ...pb.keys()])) {
      const p = newer(pa.get(id), pb.get(id), 'updated');
      if ((p.updated || 0) > (deleted[id] || 0) || !(id in deleted)) presets.push(p);
    }
    presets.sort((p, q) => (p.updated || 0) - (q.updated || 0) || (p.id < q.id ? -1 : 1));
    return { presets, deleted };
  }

  /* ---------- history ---------- */

  const HISTORY_MAX = 60;

  function mergeHistory(a = {}, b = {}, max = HISTORY_MAX) {
    const removed = maxMap(a.removed, b.removed);
    const clearedAt = Math.max(a.clearedAt || 0, b.clearedAt || 0);
    const ha = byId(a.items);
    const hb = byId(b.items);
    const items = [];
    for (const id of new Set([...ha.keys(), ...hb.keys()])) {
      const x = ha.get(id);
      const y = hb.get(id);
      const pick = newer(x, y, 'viewed');
      const viewed = Math.max((x && x.viewed) || 0, (y && y.viewed) || 0);
      if (viewed > clearedAt && viewed > (removed[id] || 0)) items.push(withPhoto({ ...pick, viewed }, x, y));
    }
    items.sort((p, q) => q.viewed - p.viewed || (p.id < q.id ? -1 : 1));
    return { items: items.slice(0, max), removed, clearedAt };
  }

  /* ---------- the practice log ---------- */

  const COUNTS = ['secs', 'drawSecs', 'rounds', 'memRounds', 'memSecs'];

  function dayKey(t) {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * One log from every device's own log, added up per day and image. Each
   * device writes only its own log, so there's nothing to conflict. If the
   * log was cleared on one device, the others' days up to that day are left
   * out too.
   */
  function combineLogs(docs) {
    const list = (docs || []).filter(Boolean);
    const clearedAt = list.reduce((m, d) => Math.max(m, d.clearedAt || 0), 0);
    const cutoff = clearedAt ? dayKey(clearedAt) : '';
    const days = {};
    for (const doc of list) {
      const stale = (doc.clearedAt || 0) < clearedAt;
      for (const [k, day] of Object.entries(doc.days || {})) {
        if (stale && k <= cutoff) continue;
        const into = (days[k] = days[k] || { items: {} });
        for (const [id, e] of Object.entries(day.items || {})) {
          const cur = into.items[id];
          if (!cur) {
            into.items[id] = { ...e };
            continue;
          }
          for (const f of COUNTS) cur[f] = (cur[f] || 0) + (e[f] || 0);
          // details (title, artist, …): keep any the first device was missing
          for (const [f, v] of Object.entries(e)) if (!COUNTS.includes(f) && (cur[f] === undefined || cur[f] === '')) cur[f] = v;
        }
      }
    }
    return days;
  }

  VST.syncMerge = { stamp, maxMap, mergeSets, mergePresets, mergeHistory, combineLogs, HISTORY_MAX };
})(typeof window !== 'undefined' ? window : globalThis);

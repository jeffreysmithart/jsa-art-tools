/*
 * Things you name and save, kept in this browser and, with sync on, on your
 * other devices: your palettes (VST.myPalettes) and your gamut masks
 * (VST.myMasks).
 *
 * Each item is { id, name, …its own fields, updated }. Deleting one leaves a
 * marker (in the deleted key) so another device's copy doesn't bring it
 * back, unless that copy was changed after the deletion.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});
  const MAX_NAME = 50;

  let last = 0; // times never repeat or go backwards here, so quick changes keep their order
  function now() {
    last = VST.syncMerge ? VST.syncMerge.stamp(last) : Math.max(Date.now(), last + 1);
    return last;
  }

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable */
    }
  }

  /**
   * A store of named things. `key` and `deletedKey` are localStorage keys,
   * `listName` the name of the list in the sync document, `prefix` starts
   * each id, `fallbackName` names an unnamed one, and `valid(item)` says
   * whether a stored item is usable.
   */
  function namedStore({ key, deletedKey, listName, prefix, fallbackName, valid }) {
    function read() {
      const v = readJson(key, []);
      return Array.isArray(v) ? v.filter((p) => p && p.id && typeof p.name === 'string' && valid(p)) : [];
    }
    const write = (list) => writeJson(key, list);

    /** All of them, by name. */
    function all() {
      return read().sort((p, q) => p.name.localeCompare(q.name));
    }
    function get(id) {
      return read().find((p) => p.id === id) || null;
    }

    /** A name no other one has (adds " (2)" and so on), trimmed to a length. */
    function uniqueName(name, exceptId) {
      const base = String(name || '').trim().slice(0, MAX_NAME) || fallbackName;
      const taken = new Set(read().filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
      let n = base;
      for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} (${i})`;
      return n;
    }

    /** Saves a new one with these fields; returns it. */
    function add(name, fields) {
      const list = read();
      const p = { ...fields, id: `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: uniqueName(name), updated: now() };
      list.push(p);
      write(list);
      return p;
    }
    /** Changes some fields of one; returns it, or null. */
    function change(id, fields) {
      const list = read();
      const p = list.find((x) => x.id === id);
      if (!p) return null;
      Object.assign(p, fields, { updated: now() });
      write(list);
      return p;
    }
    /** Renames one (keeping names unique); returns it, or null. */
    function rename(id, name) {
      return change(id, { name: uniqueName(name, id) });
    }
    function remove(id) {
      write(read().filter((p) => p.id !== id));
      const deleted = readJson(deletedKey, {}) || {};
      deleted[id] = now();
      writeJson(deletedKey, deleted);
    }

    /* for syncing: what this device holds, and taking in a merged copy */
    function syncDoc() {
      return { [listName]: read(), deleted: readJson(deletedKey, {}) || {} };
    }
    function applySyncDoc(doc) {
      write((doc[listName] || []).filter((p) => p && p.id && valid(p)));
      writeJson(deletedKey, doc.deleted || {});
    }

    return { all, get, add, change, rename, remove, syncDoc, applySyncDoc, MAX_NAME };
  }

  /* ---------- your palettes: { paints: [paint ids] } ---------- */

  const palettes = namedStore({
    key: 'value-study:palettes',
    deletedKey: 'value-study:palettes-deleted',
    listName: 'palettes',
    prefix: 'pal',
    fallbackName: 'My palette',
    valid: (p) => Array.isArray(p.paints),
  });
  VST.myPalettes = {
    ...palettes,
    /** Saves the paints as a new palette; returns it. */
    save: (name, paints) => palettes.add(name, { paints: paints.slice() }),
    /** Replaces a palette's paints; returns it, or null. */
    setPaints: (id, paints) => palettes.change(id, { paints: paints.slice() }),
  };

  /* ---------- your gamut masks: { shape, points: [[a, b], …] } ---------- */

  const okPoints = (pts) => Array.isArray(pts) && pts.length >= 3 && pts.length <= 12 && pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v) && Math.abs(v) < 200));
  const masks = namedStore({
    key: 'value-study:masks',
    deletedKey: 'value-study:masks-deleted',
    listName: 'masks',
    prefix: 'mask',
    fallbackName: 'My mask',
    valid: (p) => okPoints(p.points),
  });
  const copy = (mask) => ({ shape: typeof mask.shape === 'string' ? mask.shape : 'custom', points: mask.points.map((p) => [p[0], p[1]]) });
  VST.myMasks = {
    ...masks,
    /** Saves a mask ({ shape, points }) under a name; returns it. */
    save: (name, mask) => masks.add(name, copy(mask)),
    /** Replaces a saved mask's shape; returns it, or null. */
    setMask: (id, mask) => masks.change(id, copy(mask)),
  };

  VST.namedStore = namedStore;
})(typeof window !== 'undefined' ? window : globalThis);

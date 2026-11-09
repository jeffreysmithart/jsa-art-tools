/*
 * My palettes: limited palettes you've named and saved, kept in this browser
 * and, with sync on, on your other devices.
 *
 * Each is { id, name, paints: [paint ids], updated }. Deleting one leaves a
 * marker (in DELETED_KEY) so another device's copy doesn't bring it back,
 * unless that copy was changed after the deletion.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});
  const KEY = 'value-study:palettes';
  const DELETED_KEY = 'value-study:palettes-deleted'; // { [paletteId]: time }, for syncing
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
  function read() {
    const v = readJson(KEY, []);
    return Array.isArray(v) ? v.filter((p) => p && p.id && Array.isArray(p.paints)) : [];
  }
  const write = (list) => writeJson(KEY, list);

  /** Your palettes, by name. */
  function all() {
    return read().sort((p, q) => p.name.localeCompare(q.name));
  }
  function get(id) {
    return read().find((p) => p.id === id) || null;
  }

  /** A name no other palette of yours has (adds " (2)" and so on), trimmed to a length. */
  function uniqueName(name, exceptId) {
    const base = String(name || '').trim().slice(0, MAX_NAME) || 'My palette';
    const taken = new Set(read().filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    let n = base;
    for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} (${i})`;
    return n;
  }

  /** Saves the paints as a new palette; returns it. */
  function save(name, paints) {
    const list = read();
    const p = { id: `pal-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: uniqueName(name), paints: paints.slice(), updated: now() };
    list.push(p);
    write(list);
    return p;
  }

  function change(id, fields) {
    const list = read();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, fields, { updated: now() });
    write(list);
    return p;
  }
  /** Renames a palette (keeping names unique); returns it, or null. */
  function rename(id, name) {
    return change(id, { name: uniqueName(name, id) });
  }
  /** Replaces a palette's paints; returns it, or null. */
  function setPaints(id, paints) {
    return change(id, { paints: paints.slice() });
  }

  function remove(id) {
    write(read().filter((p) => p.id !== id));
    const deleted = readJson(DELETED_KEY, {}) || {};
    deleted[id] = now();
    writeJson(DELETED_KEY, deleted);
  }

  /* for syncing: what this device holds, and taking in a merged copy */
  function syncDoc() {
    return { palettes: read(), deleted: readJson(DELETED_KEY, {}) || {} };
  }
  function applySyncDoc(doc) {
    write((doc.palettes || []).filter((p) => p && p.id && Array.isArray(p.paints)));
    writeJson(DELETED_KEY, doc.deleted || {});
  }

  VST.myPalettes = { all, get, save, rename, setPaints, remove, syncDoc, applySyncDoc, MAX_NAME };
})(typeof window !== 'undefined' ? window : globalThis);

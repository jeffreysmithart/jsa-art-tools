/*
 * Study sets and history, kept in this browser.
 *
 * Small records (sets, history, item details) live in localStorage; uploaded
 * photos live in IndexedDB, which can hold much more. Both stay on this
 * device only; Export / Import moves a set between devices.
 *
 * An item is one image to study:
 *   museum painting: { id, source: 'aic' | 'met' | ..., title, artist, image, thumb, ... }
 *   uploaded photo:  { id, source: 'upload', title, blobId, thumb (small data URL) }
 *   image link:      { id, source: 'link', title, image, thumb }
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const SETS_KEY = 'value-study:sets';
  const HISTORY_KEY = 'value-study:history';
  const QUEUE_KEY = 'value-study:queue';
  const HISTORY_MAX = 60;
  const UPLOAD_MAX = 2400; // uploads are stored at most this many px on the long side

  /* ---------- small records (localStorage) ---------- */

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- uploaded photos (IndexedDB) ---------- */

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!root.indexedDB) return reject(new Error('This browser can’t store photos.'));
        const req = indexedDB.open('value-study', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('blobs');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((e) => {
        dbPromise = null;
        throw e;
      });
    }
    return dbPromise;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('blobs', mode);
      const store = t.objectStore('blobs');
      let result;
      Promise.resolve(fn(store)).then((r) => (result = r));
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const reqP = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

  function putBlob(id, blob) {
    return tx('readwrite', (s) => s.put(blob, id));
  }
  async function getBlob(id) {
    const d = await db();
    return reqP(d.transaction('blobs').objectStore('blobs').get(id));
  }
  async function blobIds() {
    const d = await db();
    return reqP(d.transaction('blobs').objectStore('blobs').getAllKeys());
  }
  function deleteBlob(id) {
    return tx('readwrite', (s) => s.delete(id));
  }

  /** Ask the browser not to clear this site's storage when space runs low. */
  let askedPersist = false;
  function keep() {
    if (askedPersist) return;
    askedPersist = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) {
      /* not supported */
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function scaledCanvas(el, max) {
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(el, 0, 0, c.width, c.height);
    return c;
  }

  /** A small square-ish thumbnail as a data URL, for quick lists. */
  function thumbnail(el) {
    return scaledCanvas(el, 240).toDataURL('image/jpeg', 0.8);
  }

  /**
   * Saves an uploaded photo (already loaded as an <img>) and returns its item.
   * Large photos are stored at UPLOAD_MAX px; the same file isn't stored twice.
   */
  async function saveUpload(file, el) {
    keep();
    const name = (file && file.name ? file.name : 'pasted image').replace(/\.[^.]+$/, '');
    const sig = file ? `${file.name || 'pasted'}-${file.size}-${file.lastModified || 0}` : `pasted-${Date.now()}`;
    const id = `up-${hash(sig)}`;
    const existing = findItem(id);
    if (existing) return existing;
    const big = Math.max(el.naturalWidth, el.naturalHeight) > UPLOAD_MAX;
    const plain = file && /^image\/(jpeg|png|webp)$/.test(file.type);
    const blob = !big && plain ? file : await canvasToBlob(scaledCanvas(el, UPLOAD_MAX), 'image/jpeg', 0.9);
    await putBlob(id, blob);
    return { id, source: 'upload', title: name, blobId: id, thumb: thumbnail(el), added: Date.now() };
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  /** The stored photo for an uploaded item, as a Blob. */
  async function loadUpload(item) {
    const blob = await getBlob(item.blobId);
    if (!blob) throw new Error('missing');
    return blob;
  }

  /** Only the fields worth keeping (drops temporary ones like _order). */
  function clean(item) {
    const out = {};
    for (const k of ['id', 'source', 'museum', 'title', 'artist', 'date', 'type', 'thumb', 'image', 'imageFallback', 'link', 'credit', 'needsRelay', 'blobId', 'added']) {
      if (item[k] !== undefined && item[k] !== '') out[k] = item[k];
    }
    return out;
  }

  /* ---------- sets ---------- */

  function sets() {
    const s = read(SETS_KEY, []);
    return Array.isArray(s) ? s : [];
  }
  function saveSets(list) {
    write(SETS_KEY, list);
  }
  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  function uniqueName(name, list = sets()) {
    const base = (name || 'Untitled set').trim().slice(0, 60) || 'Untitled set';
    let n = base;
    for (let i = 2; list.some((s) => s.name.toLowerCase() === n.toLowerCase()); i++) n = `${base} (${i})`;
    return n;
  }
  function createSet(name) {
    const list = sets();
    const set = { id: uid('set'), name: uniqueName(name, list), created: Date.now(), updated: Date.now(), items: [] };
    list.unshift(set);
    saveSets(list);
    return set;
  }
  function getSet(id) {
    return sets().find((s) => s.id === id) || null;
  }
  function updateSet(id, fn) {
    const list = sets();
    const set = list.find((s) => s.id === id);
    if (!set) return null;
    fn(set);
    set.updated = Date.now();
    saveSets(list);
    return set;
  }
  function renameSet(id, name) {
    const others = sets().filter((s) => s.id !== id);
    return updateSet(id, (s) => (s.name = uniqueName(name, others)));
  }
  function deleteSet(id) {
    saveSets(sets().filter((s) => s.id !== id));
    return cleanup();
  }
  /** Adds an item; returns false if it was already in the set. */
  function addToSet(id, item) {
    let added = false;
    updateSet(id, (s) => {
      if (s.items.some((it) => it.id === item.id)) return;
      s.items.push(clean(item));
      added = true;
    });
    if (added) keep();
    return added;
  }
  function removeFromSet(id, itemId) {
    updateSet(id, (s) => (s.items = s.items.filter((it) => it.id !== itemId)));
    return cleanup();
  }

  /* ---------- history ---------- */

  function history() {
    const h = read(HISTORY_KEY, []);
    return Array.isArray(h) ? h : [];
  }
  /** Records that an item was studied (most recent first, no duplicates). */
  function record(item) {
    const list = history().filter((it) => it.id !== item.id);
    list.unshift({ ...clean(item), viewed: Date.now() });
    const dropped = list.splice(HISTORY_MAX);
    write(HISTORY_KEY, list);
    if (dropped.some((it) => it.blobId)) cleanup();
  }
  function removeFromHistory(itemId) {
    write(HISTORY_KEY, history().filter((it) => it.id !== itemId));
    return cleanup();
  }
  function clearHistory() {
    write(HISTORY_KEY, []);
    return cleanup();
  }

  /** Any saved copy of an item (from a set or history), by id. */
  function findItem(id) {
    for (const s of sets()) {
      const it = s.items.find((x) => x.id === id);
      if (it) return it;
    }
    return history().find((x) => x.id === id) || null;
  }

  /** Deletes stored photos nothing refers to any more. */
  async function cleanup() {
    const used = new Set();
    const note = (it) => it && it.blobId && used.add(it.blobId);
    sets().forEach((s) => s.items.forEach(note));
    history().forEach(note);
    (read(QUEUE_KEY, []) || []).forEach(note);
    try {
      const ids = await blobIds();
      await Promise.all(ids.filter((id) => !used.has(id)).map(deleteBlob));
    } catch (e) {
      /* storage unavailable */
    }
  }

  /* ---------- export / import ---------- */

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  /** A set as a self-contained file (uploaded photos included). */
  async function exportSet(id) {
    const set = getSet(id);
    if (!set) throw new Error('missing set');
    const items = [];
    for (const it of set.items) {
      if (it.source === 'upload') {
        try {
          items.push({ ...it, data: await blobToDataUrl(await loadUpload(it)) });
        } catch (e) {
          /* photo missing on this device: skip it */
        }
      } else items.push(it);
    }
    const json = JSON.stringify({ format: 'value-study-set', version: 1, name: set.name, exported: new Date().toISOString(), items });
    return new Blob([json], { type: 'application/json' });
  }

  /** Reads an exported set file and adds it as a new set. */
  async function importSet(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('That file isn’t a study set.');
    }
    if (!data || data.format !== 'value-study-set' || !Array.isArray(data.items)) throw new Error('That file isn’t a study set.');
    keep();
    const set = createSet(data.name || 'Imported set');
    for (const raw of data.items) {
      if (!raw || !raw.id) continue;
      const it = { ...raw };
      if (it.source === 'upload') {
        if (!it.data) continue;
        const blob = await (await fetch(it.data)).blob();
        await putBlob(it.blobId || it.id, blob);
        delete it.data;
      }
      addToSet(set.id, it);
    }
    return getSet(set.id);
  }

  VST.library = {
    sets,
    getSet,
    createSet,
    renameSet,
    deleteSet,
    addToSet,
    removeFromSet,
    history,
    record,
    removeFromHistory,
    clearHistory,
    saveUpload,
    loadUpload,
    findItem,
    exportSet,
    importSet,
    cleanup,
    clean,
  };
})(typeof window !== 'undefined' ? window : globalThis);

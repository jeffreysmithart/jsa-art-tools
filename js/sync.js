/*
 * Syncing across devices with a sync code (see PLAN.md, "Syncing across
 * devices", and sync/README.md for the service).
 *
 * The code is the key: from it each device derives a storage id, a write
 * token and an encryption key (HKDF over SHA-256, in Web Crypto).
 * Everything is encrypted on the device (AES-GCM) before it's sent, so the
 * service only ever stores scrambled bytes.
 *
 * This device's own storage stays the source of truth, so the app works
 * offline. A sync pass pulls each document, merges it with what's here
 * (js/sync-merge.js), keeps the result, and pushes it back if it changed.
 * If another device saved in between, the service refuses the write, and
 * the pass pulls, merges and tries again.
 *
 * Documents: sets, presets, history, and log/<deviceId> (each device's own
 * practice log; the others are only read).
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  /* ---------- the code ---------- */

  // Crockford's base 32: no I, L, O or U, so the code is easy to read out and type
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const CODE_LEN = 25; // 125 bits, shown as five groups of five

  /** A new random sync code, e.g. "K7QMX-2V9TD-…". */
  function newCode() {
    const bytes = new Uint8Array(CODE_LEN);
    root.crypto.getRandomValues(bytes);
    const raw = [...bytes].map((b) => ALPHABET[b & 31]).join('');
    return format(raw);
  }

  /** The code without spaces or dashes, with look-alike letters fixed; null if it isn't a code. */
  function normalize(input) {
    const s = String(input || '')
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1')
      .replace(/U/g, 'V');
    if (s.length !== CODE_LEN || [...s].some((c) => !ALPHABET.includes(c))) return null;
    return s;
  }

  function format(raw) {
    return raw.match(/.{1,5}/g).join('-');
  }

  /* ---------- keys and encryption ---------- */

  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  /** The storage id, write token and encryption key a code stands for. */
  async function keysFor(code) {
    const subtle = root.crypto.subtle;
    const base = await subtle.importKey('raw', enc.encode(normalize(code)), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('value-study-sync-v1'), info: enc.encode(info) });
    const id = hex(await subtle.deriveBits(params('storage id'), base, 256));
    const token = hex(await subtle.deriveBits(params('write token'), base, 256));
    const key = await subtle.deriveKey(params('encryption key'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { id, token, key };
  }

  /** A value as encrypted bytes: a 12-byte nonce, then the sealed JSON. */
  async function seal(key, value) {
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const data = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
    const out = new Uint8Array(12 + data.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(data), 12);
    return out;
  }

  async function open(key, bytes) {
    const b = new Uint8Array(bytes);
    const data = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
    return JSON.parse(new TextDecoder().decode(data));
  }

  /** JSON with object keys in a fixed order, so the same data always compares equal. */
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  /* ---------- the service ---------- */

  function service(base, keys) {
    const url = (path) => `${base.replace(/\/$/, '')}/v1/${keys.id}${path}`;
    const auth = { Authorization: `Bearer ${keys.token}` };
    const fail = async (r) => {
      let msg = `The sync service answered ${r.status}.`;
      try {
        msg = (await r.json()).error || msg;
      } catch (e) {
        /* not JSON */
      }
      const err = new Error(msg);
      err.status = r.status;
      return err;
    };
    return {
      async list() {
        const r = await fetch(url(''), { headers: auth, cache: 'no-store' });
        if (!r.ok) throw await fail(r);
        const out = {};
        for (const d of (await r.json()).docs) out[d.name] = d.version;
        return out;
      },
      async get(name) {
        const r = await fetch(url(`/doc/${name}`), { headers: auth, cache: 'no-store' });
        if (r.status === 404) return null;
        if (!r.ok) throw await fail(r);
        return { bytes: await r.arrayBuffer(), version: r.headers.get('ETag') };
      },
      /** Saves; returns the new version, or { conflict } if another device saved first. */
      async put(name, bytes, version) {
        const r = await fetch(url(`/doc/${name}`), {
          method: 'PUT',
          headers: { ...auth, 'Content-Type': 'application/octet-stream', ...(version ? { 'If-Match': version } : { 'If-None-Match': '*' }) },
          body: bytes,
        });
        if (r.status === 412) return { conflict: true };
        if (!r.ok) throw await fail(r);
        return { version: (await r.json()).version };
      },
      async removeAll() {
        const r = await fetch(url(''), { method: 'DELETE', headers: auth });
        if (!r.ok) throw await fail(r);
      },
    };
  }

  /* ---------- what syncs ---------- */

  /** The shared documents: how to read them here, merge them, and keep a merged copy. */
  function documents() {
    const L = VST.library;
    const PR = VST.presets;
    const M = VST.syncMerge;
    return [
      { name: 'sets', local: () => L.setsDoc(), merge: M.mergeSets, apply: (d) => L.applySetsDoc(d), empty: { sets: [], deleted: {} } },
      { name: 'presets', local: () => PR.syncDoc(), merge: M.mergePresets, apply: (d) => PR.applySyncDoc(d), empty: { presets: [], deleted: {} } },
      { name: 'history', local: () => L.historyDoc(), merge: M.mergeHistory, apply: (d) => L.applyHistoryDoc(d), empty: { items: [], removed: {}, clearedAt: 0 } },
    ];
  }

  /** A short name for this device, shown to the other devices. */
  function deviceName() {
    const ua = (root.navigator && navigator.userAgent) || '';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && root.navigator && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'Browser';
  }

  /* ---------- state on this device ---------- */

  const KEY = 'value-study:sync';
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.code) return s;
    } catch (e) {
      /* fall through */
    }
    return null;
  }
  function saveState(s) {
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch (e) {
      /* storage unavailable */
    }
  }

  let state = null; // { code, since, seen: { [name]: { version, hash } }, lastSync, devices, error }
  let keys = null;
  let running = null;
  let again = false;
  const listeners = [];

  function emit() {
    listeners.forEach((fn) => fn(status()));
  }
  function onStatus(fn) {
    listeners.push(fn);
  }
  let applied = () => {};
  function onApplied(fn) {
    applied = fn;
  }

  function base() {
    return (VST.config && VST.config.syncService) || '';
  }

  function status() {
    return {
      on: !!state,
      busy: !!running,
      code: state ? format(state.code) : null,
      lastSync: state ? state.lastSync || 0 : 0,
      devices: state ? state.devices || 1 : 0,
      error: state ? state.error || '' : '',
      available: !!base(),
    };
  }

  /* ---------- a sync pass ---------- */

  async function pass() {
    const api = service(base(), keys);
    const versions = await api.list();
    const seen = state.seen || (state.seen = {});
    const changed = [];

    for (const doc of documents()) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const here = doc.local();
        const hereHash = stable(here);
        const before = seen[doc.name];
        // nothing new on either side since the last pass: skip
        if (before && before.version === versions[doc.name] && before.hash === hereHash) break;
        let remote = null;
        let version = null;
        if (versions[doc.name]) {
          const got = await api.get(doc.name);
          if (got) {
            remote = await open(keys.key, got.bytes);
            version = got.version;
          }
        }
        const merged = doc.merge(here, remote || doc.empty);
        const mergedHash = stable(merged);
        if (mergedHash !== hereHash) {
          doc.apply(merged);
          changed.push(doc.name);
        }
        const keptHash = stable(doc.local());
        if (remote && stable(remote) === mergedHash) {
          seen[doc.name] = { version, hash: keptHash };
          break;
        }
        const put = await api.put(doc.name, await seal(keys.key, merged), version);
        if (put.conflict) {
          // another device saved in between: pull again and merge with that
          const fresh = await api.list();
          versions[doc.name] = fresh[doc.name];
          continue;
        }
        seen[doc.name] = { version: put.version, hash: keptHash };
        versions[doc.name] = put.version;
        break;
      }
    }

    // this device's own practice log
    const LG = VST.log;
    const mine = { ...LG.syncDoc(), name: deviceName() };
    const logName = `log/${mine.device}`;
    const mineHash = stable(mine);
    if (!seen[logName] || seen[logName].hash !== mineHash || seen[logName].version !== versions[logName]) {
      let put = await api.put(logName, await seal(keys.key, mine), versions[logName] || null);
      if (put.conflict) {
        // only this device writes its log; take over whatever is there
        const fresh = await api.list();
        put = await api.put(logName, await seal(keys.key, mine), fresh[logName] || null);
      }
      if (!put.conflict) seen[logName] = { version: put.version, hash: mineHash };
    }

    // the other devices' logs
    const others = {};
    const cache = state.otherLogs || {};
    let logsChanged = false;
    for (const [name, version] of Object.entries(versions)) {
      if (!name.startsWith('log/') || name === logName) continue;
      if (cache[name] && cache[name].version === version) {
        others[name.slice(4)] = cache[name].doc;
        continue;
      }
      const got = await api.get(name);
      if (!got) continue;
      const doc = await open(keys.key, got.bytes);
      cache[name] = { version: got.version, doc };
      others[name.slice(4)] = doc;
      logsChanged = true;
    }
    for (const name of Object.keys(cache)) {
      if (!(name in versions)) {
        delete cache[name];
        logsChanged = true;
      }
    }
    state.otherLogs = cache;
    if (logsChanged) {
      LG.setOthers(others);
      changed.push('log');
    }
    state.devices = 1 + Object.keys(others).length;
    return changed;
  }

  /** Runs a sync pass now (or right after the one that's running). */
  function syncNow() {
    if (!state || !keys || !base()) return Promise.resolve([]);
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      emit();
      let changed = [];
      try {
        changed = await pass();
        state.lastSync = Date.now();
        state.error = '';
        lastLocal = localHash(); // what's here now is synced: no need for another pass
      } catch (e) {
        state.error = e && e.status === 403 ? 'This sync code doesn’t match the one stored for it.' : e && e.message && !/fetch|network/i.test(e.message) ? e.message : 'Couldn’t reach the sync service; will try again.';
      }
      saveState(state);
      running = null;
      if (changed.length) applied(changed);
      emit();
      if (again && state) {
        again = false;
        return syncNow();
      }
      return changed;
    })();
    return running;
  }

  /* ---------- turning it on and off ---------- */

  async function start(code) {
    const c = normalize(code);
    if (!c) throw new Error('That doesn’t look like a sync code: it has 25 letters and digits, like K7QMX-2V9TD-….');
    keys = await keysFor(c);
    state = { code: c, since: Date.now(), seen: {}, lastSync: 0, devices: 1, error: '' };
    saveState(state);
    emit();
    return syncNow();
  }

  /** Turns sync on with a new code. */
  function turnOn() {
    return start(newCode());
  }

  /** Joins the devices that already use this code. */
  function join(code) {
    return start(code);
  }

  /** Stops syncing on this device. With `removeCopy`, also deletes the synced copy for every device. */
  async function turnOff({ removeCopy = false } = {}) {
    if (removeCopy && keys && base()) await service(base(), keys).removeAll();
    state = null;
    keys = null;
    saveState(null);
    VST.log.setOthers({});
    emit();
  }

  /* ---------- when to sync ---------- */

  let timer = 0;
  let watch = 0;
  let lastLocal = '';
  function localHash() {
    try {
      return stable(documents().map((d) => d.local())) + stable(VST.log.syncDoc());
    } catch (e) {
      return '';
    }
  }
  function soon(ms = 2500) {
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms);
  }

  async function resume() {
    state = loadState();
    if (!state || !base()) {
      emit();
      return;
    }
    keys = await keysFor(state.code);
    lastLocal = localHash();
    emit();
    syncNow();
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // a change here: sync a moment later; and pull every few minutes while open
    let tick = 0;
    watch = setInterval(() => {
      if (!state) return;
      const now = localHash();
      if (now !== lastLocal) {
        lastLocal = now;
        soon();
      } else if (++tick % 36 === 0) syncNow(); // about every 3 minutes
    }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state) syncNow();
    });
    window.addEventListener('online', () => state && syncNow());
  }

  VST.sync = { newCode, normalize, format, keysFor, seal, open, stable, deviceName, status, onStatus, onApplied, resume, syncNow, turnOn, join, turnOff, CODE_LEN };
})(typeof window !== 'undefined' ? window : globalThis);

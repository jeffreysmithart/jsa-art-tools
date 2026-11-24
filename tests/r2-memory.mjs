// An in-memory stand-in for a Cloudflare R2 bucket: just the parts the sync
// Worker uses (get, head, put with onlyIf.etagMatches, delete, list).
import { createHash } from 'node:crypto';

export function memoryBucket() {
  const store = new Map(); // key -> { bytes, etag, uploaded }
  let n = 0;
  const view = (key, o, withBody) => {
    if (!o) return null;
    const obj = { key, size: o.bytes.byteLength, etag: o.etag, httpEtag: `"${o.etag}"`, uploaded: o.uploaded };
    if (withBody) {
      obj.body = new Response(o.bytes).body;
      obj.text = async () => new TextDecoder().decode(o.bytes);
      obj.arrayBuffer = async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength);
    }
    return obj;
  };
  const bucket = {
    store,
    /** Lets a test change an object between the Worker's check and its write. */
    beforePut: null,
    async get(key) {
      return view(key, store.get(key), true);
    },
    async head(key) {
      return view(key, store.get(key), false);
    },
    async put(key, value, opts = {}) {
      if (bucket.beforePut) await bucket.beforePut(key);
      const cur = store.get(key);
      if (opts.onlyIf && opts.onlyIf.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
      const etag = createHash('md5').update(bytes).update(String(++n)).digest('hex');
      store.set(key, { bytes, etag, uploaded: new Date() });
      return view(key, store.get(key), false);
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list({ prefix = '' } = {}) {
      const objects = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => view(k, store.get(k), false));
      return { objects, truncated: false };
    },
  };
  return bucket;
}

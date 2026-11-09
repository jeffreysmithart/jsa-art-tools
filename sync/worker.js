/*
 * Value Study sync service: a Cloudflare Worker with R2 storage.
 *
 * It stores what devices send and hands it back. It never sees anything
 * readable: devices encrypt everything with a key made from the sync code
 * before sending it (see PLAN.md, "Syncing across devices"). All it knows
 * is a storage id and a hash of the write token, both made from the code.
 *
 *   GET    /v1/<id>                 what's stored: [{ name, version, size }]
 *   GET    /v1/<id>/doc/<name>      one document (encrypted bytes), with its version in ETag
 *   PUT    /v1/<id>/doc/<name>      store a document; say which version it replaces
 *                                   (If-Match: <version>) or that it's new (If-None-Match: *).
 *                                   If it changed meanwhile: 412, and the device pulls,
 *                                   merges and tries again.
 *   GET    /v1/<id>/photo/<name>    one photo (encrypted bytes)
 *   PUT    /v1/<id>/photo/<name>    store a photo; photos never change, so a second
 *                                   upload of the same name just says it's there
 *   DELETE /v1/<id>/photo/<name>    remove a photo nothing uses any more
 *   DELETE /v1/<id>                 delete everything for this id (turning sync off)
 *
 * Every request needs "Authorization: Bearer <token>". The first write to
 * an id records a hash of its token; after that, the token must match.
 *
 * Document names: sets, presets, history, palettes, or log/<deviceId>. Photo names are
 * 64 hex characters, made on the device from the photo and the sync code's
 * key, so they say nothing about the photo.
 * Bindings: SYNC (an R2 bucket). Optional: ALLOWED_ORIGINS (comma-separated).
 */

// the app's addresses: its own domain, the GitHub Pages address, and local testing
const DEFAULT_ORIGINS = [
  'https://jeffreysmithdesigner.com',
  'https://www.jeffreysmithdesigner.com',
  'https://jeffreysmithart.github.io',
  'http://localhost:8000',
  'http://localhost:8765',
];
const MAX_DOC = 5 * 1024 * 1024; // 5 MB per document
const MAX_PHOTO = 15 * 1024 * 1024; // 15 MB per photo
const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // 2 GB per id
const RATE = { perMinute: 120 }; // requests per id per minute (per Worker instance)

const ID = /^[0-9a-f]{64}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const NAME = /^(sets|presets|history|palettes|log\/d-[a-z0-9-]{1,40})$/;
const PHOTO = /^[0-9a-f]{64}$/;

function origins(env) {
  const extra = env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return extra.length ? extra : DEFAULT_ORIGINS;
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(status, body, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings of the same length. */
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* A simple per-instance limit, so a runaway loop can't run up usage. */
const hits = new Map();
export function rateLimited(id, now = Date.now()) {
  const minute = Math.floor(now / 60000);
  const h = hits.get(id);
  if (!h || h.minute !== minute) {
    hits.set(id, { minute, n: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n += 1;
  return h.n > RATE.perMinute;
}

const etagOf = (obj) => (obj && (obj.httpEtag || (obj.etag ? `"${obj.etag}"` : null))) || null;
const bare = (v) => (v || '').replace(/^W\//, '').replace(/^"|"$/g, '');

async function listAll(bucket, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Checks the token; claims the id on its first write. Returns null if allowed, else a Response. */
async function authorize(env, id, request, origin, { claim }) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!TOKEN.test(token)) return json(401, { error: 'A sync token is needed.' }, origin);
  const metaKey = `u/${id}/meta`;
  const metaObj = await env.SYNC.get(metaKey);
  const tokenHash = await sha256Hex(token);
  if (!metaObj) {
    if (!claim) return 'empty';
    await env.SYNC.put(metaKey, JSON.stringify({ tokenHash, created: new Date().toISOString() }), {
      httpMetadata: { contentType: 'application/json' },
    });
    return null;
  }
  const meta = JSON.parse(await metaObj.text());
  if (!sameHex(meta.tokenHash, tokenHash)) return json(403, { error: 'That sync token doesn’t match.' }, origin);
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = !origin || origins(env).includes(origin);
    const echo = allowed && origin ? origin : null;
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: corsHeaders(echo) });
    if (!allowed) return json(403, { error: 'This site can’t use the sync service.' }, null);
    if (!env || !env.SYNC) return json(500, { error: 'Storage isn’t set up (missing SYNC bucket).' }, echo);

    const url = new URL(request.url);
    const m = url.pathname.match(/^\/v1\/([^/]+)(?:\/(doc|photo)\/(.+))?\/?$/);
    if (!m) return json(404, { error: 'Not found.' }, echo);
    const id = m[1];
    const kind = m[2] || null;
    const name = m[3] ? decodeURIComponent(m[3]) : null;
    if (!ID.test(id)) return json(400, { error: 'Bad id.' }, echo);
    if (kind === 'doc' && !NAME.test(name)) return json(400, { error: 'Bad document name.' }, echo);
    if (kind === 'photo' && !PHOTO.test(name)) return json(400, { error: 'Bad photo name.' }, echo);
    if (rateLimited(id)) return json(429, { error: 'Too many requests; try again in a minute.' }, echo, { 'Retry-After': '60' });

    const method = request.method;
    const isWrite = method === 'PUT';
    const denied = await authorize(env, id, request, echo, { claim: isWrite });
    const prefix = `u/${id}/doc/`;
    const photos = `u/${id}/photo/`;

    // what's stored
    if (method === 'GET' && name === null) {
      if (denied === 'empty') return json(200, { docs: [], photos: [] }, echo);
      if (denied) return denied;
      const objs = await listAll(env.SYNC, `u/${id}/`);
      return json(
        200,
        {
          docs: objs.filter((o) => o.key.startsWith(prefix)).map((o) => ({ name: o.key.slice(prefix.length), version: etagOf(o), size: o.size })),
          photos: objs
            .filter((o) => o.key.startsWith(photos))
            .map((o) => ({ name: o.key.slice(photos.length), size: o.size, uploaded: o.uploaded ? new Date(o.uploaded).toISOString() : null })),
        },
        echo
      );
    }

    // photos: stored once, read back, removed when nothing uses them
    if (kind === 'photo') {
      if (denied === 'empty') return json(404, { error: 'Not found.' }, echo);
      if (denied) return denied;
      const key = photos + name;
      if (method === 'GET') {
        const obj = await env.SYNC.get(key);
        if (!obj) return json(404, { error: 'Not found.' }, echo);
        return new Response(obj.body, {
          status: 200,
          headers: { ...corsHeaders(echo), 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' },
        });
      }
      if (method === 'PUT') {
        const len = Number(request.headers.get('Content-Length') || 0);
        if (len > MAX_PHOTO) return json(413, { error: 'That photo is too large to sync.' }, echo);
        if (await env.SYNC.head(key)) return json(200, { stored: true, already: true }, echo);
        const body = await request.arrayBuffer();
        if (body.byteLength > MAX_PHOTO) return json(413, { error: 'That photo is too large to sync.' }, echo);
        const objs = await listAll(env.SYNC, `u/${id}/`);
        const total = objs.reduce((s, o) => s + o.size, 0);
        if (total + body.byteLength > MAX_TOTAL) return json(507, { error: 'Your synced copy is full.' }, echo);
        await env.SYNC.put(key, body, { httpMetadata: { contentType: 'application/octet-stream' } });
        return json(200, { stored: true }, echo);
      }
      if (method === 'DELETE') {
        await env.SYNC.delete(key);
        return json(200, { deleted: 1 }, echo);
      }
      return json(405, { error: 'Not allowed.' }, echo);
    }

    // one document
    if (method === 'GET' && name !== null) {
      if (denied === 'empty') return json(404, { error: 'Not found.' }, echo);
      if (denied) return denied;
      const obj = await env.SYNC.get(prefix + name);
      if (!obj) return json(404, { error: 'Not found.' }, echo);
      return new Response(obj.body, {
        status: 200,
        headers: { ...corsHeaders(echo), 'Content-Type': 'application/octet-stream', ETag: etagOf(obj), 'Cache-Control': 'no-store' },
      });
    }

    // store a document
    if (method === 'PUT' && name !== null) {
      if (denied) return denied;
      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > MAX_DOC) return json(413, { error: 'That’s too large to sync.' }, echo);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_DOC) return json(413, { error: 'That’s too large to sync.' }, echo);
      const key = prefix + name;
      const current = await env.SYNC.head(key);
      const ifMatch = request.headers.get('If-Match');
      const ifNone = request.headers.get('If-None-Match');
      if (!ifMatch && ifNone !== '*') return json(428, { error: 'Say which version this replaces (If-Match) or that it’s new (If-None-Match: *).' }, echo);
      if (ifNone === '*' && current) return json(412, { error: 'It changed on another device.', version: etagOf(current) }, echo);
      if (ifMatch && (!current || bare(ifMatch) !== bare(etagOf(current)))) {
        return json(412, { error: 'It changed on another device.', version: current ? etagOf(current) : null }, echo);
      }
      // stay under the per-id total
      const objs = await listAll(env.SYNC, `u/${id}/`);
      const total = objs.reduce((s, o) => s + (o.key === key ? 0 : o.size), 0);
      if (total + body.byteLength > MAX_TOTAL) return json(507, { error: 'Your synced copy is full.' }, echo);
      const opts = { httpMetadata: { contentType: 'application/octet-stream' } };
      // R2 checks the version again as it writes, so two devices can't both win
      if (current) opts.onlyIf = { etagMatches: bare(etagOf(current)) };
      const put = await env.SYNC.put(key, body, opts);
      if (!put) {
        const now = await env.SYNC.head(key);
        return json(412, { error: 'It changed on another device.', version: etagOf(now) }, echo);
      }
      return json(200, { version: etagOf(put) }, echo, { ETag: etagOf(put) });
    }

    // delete everything (turning sync off)
    if (method === 'DELETE' && name === null) {
      if (denied === 'empty') return json(200, { deleted: 0 }, echo);
      if (denied) return denied;
      const objs = await listAll(env.SYNC, `u/${id}/`);
      // the meta record last, so the id stays claimed until everything else is gone
      const keys = objs.map((o) => o.key).sort((p, q) => (p.endsWith('/meta') ? 1 : q.endsWith('/meta') ? -1 : 0));
      for (let i = 0; i < keys.length; i += 1000) await env.SYNC.delete(keys.slice(i, i + 1000));
      return json(200, { deleted: keys.length }, echo);
    }

    return json(405, { error: 'Not allowed.' }, echo);
  },
};

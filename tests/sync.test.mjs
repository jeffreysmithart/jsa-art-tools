// Run with: node --test tests/
// The sync Worker (sync/worker.js) against an in-memory R2 bucket.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { rateLimited } from '../sync/worker.js';
import { memoryBucket } from './r2-memory.mjs';

const BASE = 'https://value-study-sync.example.workers.dev';
const SITE = 'https://jeffreysmithart.github.io';
const hex = (c) => c.repeat(64);
const ID = hex('a');
const TOKEN = hex('b');

function call(env, method, path, { token = TOKEN, origin = SITE, body, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (token) h.Authorization = `Bearer ${token}`;
  return worker.fetch(new Request(BASE + path, { method, headers: h, body }), env);
}

test('only the site (and local testing) can use it', async () => {
  const env = { SYNC: memoryBucket() };
  const ok = await call(env, 'OPTIONS', `/v1/${ID}`);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  assert.match(ok.headers.get('access-control-allow-headers'), /If-Match/);
  const other = await call(env, 'GET', `/v1/${ID}`, { origin: 'https://evil.example' });
  assert.equal(other.status, 403);
  for (const site of ['https://jeffreysmithdesigner.com', 'https://www.jeffreysmithdesigner.com']) {
    const own = await call(env, 'OPTIONS', `/v1/${ID}`, { origin: site });
    assert.equal(own.status, 204, `the app's own domain: ${site}`);
    assert.equal(own.headers.get('access-control-allow-origin'), site);
  }
  const local = await call(env, 'GET', `/v1/${ID}`, { origin: 'http://localhost:8000' });
  assert.equal(local.status, 200);
  const custom = await call({ ...env, ALLOWED_ORIGINS: 'https://mine.example' }, 'GET', `/v1/${ID}`, { origin: 'https://mine.example' });
  assert.equal(custom.status, 200);
});

test('the first write claims the id; after that the token must match', async () => {
  const env = { SYNC: memoryBucket() };
  assert.equal((await call(env, 'GET', `/v1/${ID}`, { token: null })).status, 401, 'no token');
  assert.deepEqual(await (await call(env, 'GET', `/v1/${ID}`)).json(), { docs: [], photos: [] }, 'nothing stored yet');
  const put = await call(env, 'PUT', `/v1/${ID}/doc/sets`, { body: 'cipher-1', headers: { 'If-None-Match': '*' } });
  assert.equal(put.status, 200);
  assert.equal((await call(env, 'GET', `/v1/${ID}`, { token: hex('c') })).status, 403, 'another token can’t read it');
  assert.equal((await call(env, 'PUT', `/v1/${ID}/doc/presets`, { token: hex('c'), body: 'x', headers: { 'If-None-Match': '*' } })).status, 403, 'or write');
  // the server keeps only a hash of the token
  const meta = await env.SYNC.store.get(`u/${ID}/meta`);
  assert.ok(!new TextDecoder().decode(meta.bytes).includes(TOKEN));
});

test('documents round-trip with versions, and stale writes are refused', async () => {
  const env = { SYNC: memoryBucket() };
  const first = await call(env, 'PUT', `/v1/${ID}/doc/sets`, { body: new Uint8Array([1, 2, 3]), headers: { 'If-None-Match': '*' } });
  const v1 = (await first.json()).version;
  assert.ok(v1);
  const got = await call(env, 'GET', `/v1/${ID}/doc/sets`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('etag'), v1);
  assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [1, 2, 3]);
  // a second "new" write loses: something is already there
  const again = await call(env, 'PUT', `/v1/${ID}/doc/sets`, { body: 'x', headers: { 'If-None-Match': '*' } });
  assert.equal(again.status, 412);
  assert.equal((await again.json()).version, v1, 'and says which version is there now');
  // replacing the right version works
  const second = await call(env, 'PUT', `/v1/${ID}/doc/sets`, { body: 'v2', headers: { 'If-Match': v1 } });
  assert.equal(second.status, 200);
  const v2 = (await second.json()).version;
  assert.notEqual(v2, v1);
  // replacing an old version doesn't
  assert.equal((await call(env, 'PUT', `/v1/${ID}/doc/sets`, { body: 'v3', headers: { 'If-Match': v1 } })).status, 412);
  // a write has to say which it is
  assert.equal((await call(env, 'PUT', `/v1/${ID}/doc/sets`, { body: 'v3' })).status, 428);
  const list = await (await call(env, 'GET', `/v1/${ID}`)).json();
  assert.deepEqual(list.docs.map((d) => [d.name, d.version]), [['sets', v2]]);
});

test('two devices writing at the same moment: only one wins', async () => {
  const env = { SYNC: memoryBucket() };
  const v1 = (await (await call(env, 'PUT', `/v1/${ID}/doc/history`, { body: 'a', headers: { 'If-None-Match': '*' } })).json()).version;
  // another device's write lands between this write's check and its save
  let sneaked = false;
  env.SYNC.beforePut = async (key) => {
    if (sneaked || !key.endsWith('/doc/history')) return;
    sneaked = true;
    env.SYNC.beforePut = null;
    await env.SYNC.put(key, 'from the other device');
  };
  const r = await call(env, 'PUT', `/v1/${ID}/doc/history`, { body: 'b', headers: { 'If-Match': v1 } });
  assert.equal(r.status, 412);
  const now = await (await call(env, 'GET', `/v1/${ID}/doc/history`)).text();
  assert.equal(now, 'from the other device', 'the other device’s write is kept');
});

test('names, ids and sizes are checked', async () => {
  const env = { SYNC: memoryBucket() };
  const put = (path, body = 'x') => call(env, 'PUT', path, { body, headers: { 'If-None-Match': '*' } });
  assert.equal((await put(`/v1/${ID}/doc/log/d-mac-1`)).status, 200, 'a device log');
  assert.equal((await put(`/v1/${ID}/doc/secrets`)).status, 400, 'unknown name');
  assert.equal((await put(`/v1/${ID}/doc/..%2Fmeta`)).status, 400, 'no escaping the folder');
  assert.equal((await put(`/v1/not-an-id/doc/sets`)).status, 400);
  assert.equal((await put(`/v1/${ID}/doc/presets`, new Uint8Array(5 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await call(env, 'POST', `/v1/${ID}`)).status, 405);
});

test('turning sync off deletes everything for the id', async () => {
  const env = { SYNC: memoryBucket() };
  for (const n of ['sets', 'presets', 'log/d-ipad']) await call(env, 'PUT', `/v1/${ID}/doc/${n}`, { body: 'x', headers: { 'If-None-Match': '*' } });
  await call(env, 'PUT', `/v1/${hex('d')}/doc/sets`, { body: 'someone else', headers: { 'If-None-Match': '*' } });
  assert.equal((await call(env, 'DELETE', `/v1/${ID}`, { token: hex('c') })).status, 403, 'only with the right token');
  const del = await call(env, 'DELETE', `/v1/${ID}`);
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, 4, 'three documents and the claim');
  assert.deepEqual(await (await call(env, 'GET', `/v1/${ID}`)).json(), { docs: [], photos: [] });
  assert.ok([...env.SYNC.store.keys()].some((k) => k.startsWith(`u/${hex('d')}/`)), 'other ids are untouched');
});

test('a runaway loop is slowed down', () => {
  const t = Date.UTC(2026, 10, 8, 12, 0, 0);
  let limited = false;
  for (let i = 0; i < 121; i++) limited = rateLimited('loop', t);
  assert.equal(limited, true);
  assert.equal(rateLimited('loop', t + 60000), false, 'a minute later it’s fine again');
});

test('photos: stored once, read back, listed, and removed', async () => {
  const env = { SYNC: memoryBucket() };
  const P = hex('e');
  const put = (body) => call(env, 'PUT', `/v1/${ID}/photo/${P}`, { body });
  assert.equal((await put(new Uint8Array([9, 8, 7]))).status, 200);
  const again = await put(new Uint8Array([1]));
  assert.equal((await again.json()).already, true, 'a second upload of the same name changes nothing');
  const got = await call(env, 'GET', `/v1/${ID}/photo/${P}`);
  assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [9, 8, 7]);
  const list = await (await call(env, 'GET', `/v1/${ID}`)).json();
  assert.deepEqual(list.photos.map((p) => [p.name, p.size]), [[P, 3]]);
  assert.ok(list.photos[0].uploaded, 'with when it was uploaded');
  assert.equal(list.docs.length, 0, 'photos aren’t listed as documents');
  assert.equal((await call(env, 'GET', `/v1/${ID}/photo/${P}`, { token: hex('c') })).status, 403, 'another token can’t read it');
  assert.equal((await call(env, 'PUT', `/v1/${ID}/photo/not-a-name`, { body: 'x' })).status, 400);
  assert.equal((await call(env, 'PUT', `/v1/${ID}/photo/${hex('f')}`, { body: new Uint8Array(15 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await call(env, 'DELETE', `/v1/${ID}/photo/${P}`)).status, 200);
  assert.equal((await call(env, 'GET', `/v1/${ID}/photo/${P}`)).status, 404);
});

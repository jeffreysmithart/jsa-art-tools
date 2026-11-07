// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { checkTarget } from '../relay/worker.js';

const base = 'https://value-study-relay.example.workers.dev/';
const ask = (u) => checkTarget(`${base}?url=${encodeURIComponent(u)}`);

test('allows museum image URLs', () => {
  const t = ask('https://images.metmuseum.org/CRDImages/ad/original/DT11918.jpg');
  assert.ok(t instanceof URL);
  assert.equal(t.hostname, 'images.metmuseum.org');
  assert.ok(ask('https://openaccess-cdn.clevelandart.org/1927.388/1927.388_web.jpg') instanceof URL);
  assert.ok(ask('https://img.artsmia.org/web_objects_cache/012000/900/30/12936/mia_25108b_full.jpg') instanceof URL);
});

test('refuses anything else', async () => {
  for (const [u, status] of [
    ['https://example.com/cat.jpg', 403], // not a museum
    ['http://images.metmuseum.org/x.jpg', 403], // not https
    ['https://images.metmuseum.org.evil.com/x.jpg', 403], // look-alike host
    ['https://openaccess-cdn.clevelandart.org/1927.388/1927.388_full.tif', 403], // huge TIFF
    ['not a url', 400],
  ]) {
    const r = ask(u);
    assert.ok(r instanceof Response, u);
    assert.equal(r.status, status, u);
    assert.equal(r.headers.get('access-control-allow-origin'), '*', 'errors are readable by the page too');
  }
  assert.equal(checkTarget(base).status, 400, 'missing ?url');
});

test('answers preflight and rejects other methods', async () => {
  const pre = await worker.fetch(new Request(base, { method: 'OPTIONS' }), {}, {});
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  const post = await worker.fetch(new Request(`${base}?url=x`, { method: 'POST' }), {}, {});
  assert.equal(post.status, 405);
});

test('relays an image with the permission header added', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://images.metmuseum.org/CRDImages/ad/original/DT11918.jpg');
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '3' } });
  };
  try {
    const r = await worker.fetch(new Request(`${base}?url=${encodeURIComponent('https://images.metmuseum.org/CRDImages/ad/original/DT11918.jpg')}`), {}, {});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.equal((await r.arrayBuffer()).byteLength, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('passes on museum errors and refuses non-images', async () => {
  const realFetch = globalThis.fetch;
  const url = `${base}?url=${encodeURIComponent('https://images.metmuseum.org/CRDImages/x.jpg')}`;
  try {
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    assert.equal((await worker.fetch(new Request(url), {}, {})).status, 404);
    globalThis.fetch = async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    assert.equal((await worker.fetch(new Request(url), {}, {})).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/*
 * Value Study image relay: a Cloudflare Worker.
 *
 * Some museums (The Met, Cleveland) serve public-domain images without the
 * header that lets a web page read their pixels, which the value tools
 * need. This relay fetches the image from the museum and passes it on with
 * that header added.
 *
 * It only relays images from the museum image servers listed below, so it
 * can't be used as a general-purpose proxy. Images are cached for a day.
 *
 * Use: https://<your-worker>.workers.dev/?url=<museum image URL>
 * Setup steps: see relay/README.md
 */

const ALLOWED_HOSTS = [
  'images.metmuseum.org', // The Metropolitan Museum of Art
  'openaccess-cdn.clevelandart.org', // Cleveland Museum of Art
];

const MAX_BYTES = 25 * 1024 * 1024; // refuse anything larger than 25 MB
const CACHE_SECONDS = 86400; // one day

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function reply(status, message) {
  return new Response(message, {
    status,
    headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Returns the museum image URL to fetch, or an error Response. */
export function checkTarget(requestUrl) {
  const raw = new URL(requestUrl).searchParams.get('url');
  if (!raw) return reply(400, 'Add ?url=<museum image URL>');
  let target;
  try {
    target = new URL(raw);
  } catch (e) {
    return reply(400, 'That is not a valid URL.');
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.includes(target.hostname)) {
    return reply(403, 'Only museum image servers are allowed.');
  }
  if (!/\.(jpe?g|png|webp)$/i.test(target.pathname)) {
    return reply(403, 'Only JPG, PNG or WebP images are allowed.');
  }
  return target;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, 'Only GET is allowed.');

    const target = checkTarget(request.url);
    if (target instanceof Response) return target;

    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(target.toString(), { method: 'GET' });
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        headers: { Accept: 'image/*' },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
      });
    } catch (e) {
      return reply(502, 'Could not reach the museum.');
    }
    if (!upstream.ok) return reply(upstream.status === 404 ? 404 : 502, `The museum returned ${upstream.status}.`);

    const type = upstream.headers.get('Content-Type') || '';
    if (!type.startsWith('image/')) return reply(502, 'The museum did not return an image.');
    const size = Number(upstream.headers.get('Content-Length') || 0);
    if (size > MAX_BYTES) return reply(413, 'That image is too large.');

    const response = new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': type,
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      },
    });
    if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return request.method === 'HEAD' ? new Response(null, { status: 200, headers: response.headers }) : response;
  },
};

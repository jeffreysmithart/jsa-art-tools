/*
 * Museum collection sources. Each source returns items in one shape:
 *   { id, source, museum, title, artist, date, type, thumb, image,
 *     imageFallback, link, credit, needsRelay }
 * and only public-domain (CC0) works are returned.
 *
 *  aic  Art Institute of Chicago  https://api.artic.edu/docs/
 *  met  The Met                   https://metmuseum.github.io/  (search v1.1)
 *  cma  Cleveland Museum of Art   https://openaccess-api.clevelandart.org/
 *
 * The Met's and Cleveland's image servers don't allow web pages to read
 * pixels, so their study images go through the image relay (relay/README.md).
 * Thumbnails are only displayed, so they load directly.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});
  const PAGE = 20;

  function relayBase() {
    const r = (VST.config && VST.config.imageRelay) || '';
    return r.replace(/\/+$/, '');
  }

  /** URL to load a study image from, going through the relay when needed. */
  function imageUrl(item, url = item.image) {
    if (!url) return url;
    if (!item.needsRelay) return url;
    const base = relayBase();
    return base ? `${base}/?url=${encodeURIComponent(url)}` : null;
  }

  async function getJson(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function firstLine(s) {
    return s ? String(s).split('\n')[0] : '';
  }

  /* ---------- Art Institute of Chicago ---------- */

  const AIC_FIELDS = 'id,title,artist_title,artist_display,date_display,image_id,artwork_type_title,is_public_domain';
  const aic = {
    id: 'aic',
    name: 'Art Institute of Chicago',
    short: 'Art Institute',
    needsRelay: false,
    async search(q, page, signal, { paintingsOnly }) {
      const params = new URLSearchParams({
        q,
        'query[term][is_public_domain]': 'true',
        fields: AIC_FIELDS,
        limit: '40',
        page: String(page),
      });
      const json = await getJson(`https://api.artic.edu/api/v1/artworks/search?${params}`, signal);
      const iiif = (json.config && json.config.iiif_url) || 'https://www.artic.edu/iiif/2';
      const items = (json.data || [])
        .filter((d) => d.image_id && d.is_public_domain !== false)
        .filter((d) => !paintingsOnly || /painting/i.test(d.artwork_type_title || ''))
        .map((d) => ({
          id: `aic-${d.id}`,
          source: 'aic',
          museum: 'Art Institute',
          title: d.title || 'Untitled',
          artist: d.artist_title || firstLine(d.artist_display) || 'Unknown artist',
          date: d.date_display || '',
          type: d.artwork_type_title || '',
          thumb: `${iiif}/${d.image_id}/full/200,/0/default.jpg`,
          image: `${iiif}/${d.image_id}/full/1686,/0/default.jpg`,
          imageFallback: `${iiif}/${d.image_id}/full/843,/0/default.jpg`,
          link: `https://www.artic.edu/artworks/${d.id}`,
          credit: 'Art Institute of Chicago, CC0',
          needsRelay: false,
        }));
      const pg = json.pagination || {};
      return { items, page, totalPages: Math.min(pg.total_pages || 1, 25) };
    },
  };

  /* ---------- The Met ---------- */

  const MET_API = 'https://collectionapi.metmuseum.org/public/collection';
  const metRecords = new Map(); // object ID -> record, so repeat searches skip refetching

  function metRecord(id, signal) {
    if (metRecords.has(id)) return Promise.resolve(metRecords.get(id));
    return getJson(`${MET_API}/v1/objects/${id}`, signal).then((o) => {
      if (o && o.objectID) metRecords.set(id, o);
      return o;
    });
  }
  const met = {
    id: 'met',
    name: 'The Metropolitan Museum of Art',
    short: 'The Met',
    needsRelay: true,
    async search(q, page, signal, { paintingsOnly }) {
      const params = new URLSearchParams({ q, hasImages: 'true', limit: String(PAGE), offset: String((page - 1) * PAGE) });
      if (paintingsOnly) params.set('medium', 'Paintings');
      const found = await getJson(`${MET_API}/v1.1/search?${params}`, signal);
      const ids = found.objectIDs || [];
      // the search returns only ID numbers; fetch each record (some IDs are stale, so failures are skipped)
      const records = await Promise.all(
        ids.map((id) => metRecord(id, signal).catch((e) => (e.name === 'AbortError' ? Promise.reject(e) : null)))
      );
      const items = records
        .filter((o) => o && o.objectID && o.isPublicDomain && o.primaryImage)
        .map((o) => ({
          id: `met-${o.objectID}`,
          source: 'met',
          museum: 'The Met',
          title: o.title || 'Untitled',
          artist: o.artistDisplayName || o.culture || 'Unknown artist',
          date: o.objectDate || '',
          type: o.objectName || o.classification || '',
          thumb: o.primaryImageSmall || o.primaryImage,
          image: o.primaryImage,
          imageFallback: o.primaryImageSmall || '',
          link: o.objectURL || `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
          credit: 'The Metropolitan Museum of Art, CC0',
          needsRelay: true,
        }));
      return { items, page, totalPages: Math.min(Math.ceil((found.total || 0) / PAGE), 25) };
    },
  };

  /* ---------- Cleveland Museum of Art ---------- */

  const cma = {
    id: 'cma',
    name: 'Cleveland Museum of Art',
    short: 'Cleveland',
    needsRelay: true,
    async search(q, page, signal, { paintingsOnly }) {
      const params = new URLSearchParams({
        q,
        cc0: '1',
        has_image: '1',
        limit: String(PAGE),
        skip: String((page - 1) * PAGE),
        fields: 'id,title,creators,creation_date,type,url,images,culture,accession_number',
      });
      if (paintingsOnly) params.set('type', 'Painting');
      const json = await getJson(`https://openaccess-api.clevelandart.org/api/artworks/?${params}`, signal);
      const items = (json.data || [])
        .filter((a) => a.images && a.images.web && a.images.web.url)
        .map((a) => {
          const creator = (a.creators || [])[0];
          const artist = creator && creator.description ? creator.description.replace(/\s*\(.*$/, '') : a.culture && a.culture[0];
          return {
            id: `cma-${a.id}`,
            source: 'cma',
            museum: 'Cleveland',
            title: a.title || 'Untitled',
            artist: artist || 'Unknown artist',
            date: a.creation_date || '',
            type: a.type || '',
            thumb: a.images.web.url,
            image: a.images.web.url,
            imageFallback: '',
            link: a.url || `https://clevelandart.org/art/${a.accession_number || ''}`,
            credit: 'Cleveland Museum of Art, CC0',
            needsRelay: true,
          };
        });
      const total = (json.info && json.info.total) || items.length;
      return { items, page, totalPages: Math.min(Math.ceil(total / PAGE), 25) };
    },
  };

  const all = [aic, met, cma];

  /* Remember recent results so repeating a search or switching the filter is instant. */
  const results = new Map();
  all.forEach((source) => {
    const search = source.search.bind(source);
    source.search = async (q, page, signal, opts = {}) => {
      const key = [source.id, q.trim().toLowerCase(), page, !!opts.paintingsOnly].join('|');
      if (results.has(key)) return results.get(key);
      const r = await search(q, page, signal, opts);
      results.set(key, r);
      if (results.size > 200) results.delete(results.keys().next().value);
      return r;
    };
  });

  /** Sources that can be used right now (the relay ones need it configured). */
  function available() {
    return all.filter((s) => !s.needsRelay || relayBase());
  }

  /** Artists and subjects to get started; all are well represented in these collections. */
  const suggestions = [
    'George Inness',
    'Claude Monet',
    'John Singer Sargent',
    'Winslow Homer',
    'Camille Corot',
    'Thomas Cole',
    'Frederic Edwin Church',
    'Landscape',
    'Still life flowers',
    'Portrait',
  ];

  VST.museum = { sources: { aic, met, cma }, all, available, imageUrl, relayBase, suggestions };
})(typeof window !== 'undefined' ? window : globalThis);

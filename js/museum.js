/*
 * Museum collection sources. Each source returns items in one shape:
 *   { id, source, museum, title, artist, date, type, thumb, image,
 *     imageFallback, link, credit, needsRelay }
 * and only public-domain (CC0) works are returned.
 *
 *  aic  Art Institute of Chicago   https://api.artic.edu/docs/
 *  met  The Met                    https://metmuseum.github.io/  (search v1.1)
 *  nga  National Gallery of Art    prebuilt index (tools/build_nga_index.py)
 *  mia  Minneapolis Institute of Art  https://search.artsmia.org/
 *  cma  Cleveland Museum of Art    https://openaccess-api.clevelandart.org/
 *  ngl  The National Gallery, London  https://data.ng.ac.uk/es/public/
 *
 * The Met's, Mia's and Cleveland's image servers don't allow web pages to read
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

  /* ---------- National Gallery of Art, Washington ---------- */
  // No live search: the app searches a prebuilt index of its open-access paintings
  // (data/nga-paintings.json, made by tools/build_nga_index.py). Images need no relay.

  function fold(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '');
  }

  let ngaIndex = null;
  function loadNgaIndex(signal) {
    if (!ngaIndex) {
      const url = (VST.config && VST.config.ngaIndexUrl) || 'data/nga-paintings.json';
      ngaIndex = getJson(url, signal)
        .then((rows) => rows.map((r) => ({ r, artist: fold(r[2]), text: fold(`${r[1]} ${r[2]} ${r[3]}`) })))
        .catch((e) => {
          ngaIndex = null; // try again next time
          throw e;
        });
    }
    return ngaIndex;
  }

  const nga = {
    id: 'nga',
    name: 'National Gallery of Art, Washington',
    short: 'NGA Washington',
    needsRelay: false,
    async search(q, page, signal) {
      const index = await loadNgaIndex(signal);
      const terms = fold(q).split(/\s+/).filter(Boolean);
      const hits = index.filter((e) => terms.every((t) => e.text.includes(t)));
      // works by a matching artist first, then titles and dates
      const byArtist = (e) => (terms.every((t) => e.artist.includes(t)) ? 0 : 1);
      hits.sort((a, b) => byArtist(a) - byArtist(b));
      const items = hits.slice((page - 1) * PAGE, page * PAGE).map(({ r }) => {
        const [id, title, artist, date, uuid, side] = r;
        const base = `https://api.nga.gov/iiif/${uuid}`;
        return {
          id: `nga-${id}`,
          source: 'nga',
          museum: 'NGA Washington',
          title: title || 'Untitled',
          artist: artist || 'Unknown artist',
          date: date || '',
          type: 'Painting',
          thumb: `${base}/full/!200,200/0/default.jpg`,
          image: side && side < 1686 ? `${base}/full/max/0/default.jpg` : `${base}/full/!1686,1686/0/default.jpg`,
          imageFallback: `${base}/full/!843,843/0/default.jpg`,
          link: `https://www.nga.gov/collection/art-object-page.${id}.html`,
          credit: 'National Gallery of Art, Washington, open access (CC0)',
          needsRelay: false,
        };
      });
      return { items, page, totalPages: Math.min(Math.ceil(hits.length / PAGE), 25) };
    },
  };

  /* ---------- Minneapolis Institute of Art (Mia) ---------- */
  // Search: search.artsmia.org (Elasticsearch). Images: img.artsmia.org, through the relay.

  const mia = {
    id: 'mia',
    name: 'Minneapolis Institute of Art (Mia)',
    short: 'Mia',
    needsRelay: true,
    async search(q, page, signal, { paintingsOnly }) {
      // keep only words: Mia's search reads ":" "(" etc. as query syntax
      const words = q.replace(/[:"()[\]{}^~*?\\/!<>=&|+-]/g, ' ').trim();
      let query = `${words} rights_type:"Public Domain" image:valid`;
      if (paintingsOnly) query += ' classification:Paintings';
      const json = await getJson(`https://search.artsmia.org/${encodeURIComponent(query)}?size=${PAGE}&from=${(page - 1) * PAGE}`, signal);
      const hits = (json.hits && json.hits.hits) || [];
      const items = hits
        .map((h) => h._source || {})
        .filter((s) => s.id && s.rights_type === 'Public Domain' && s.image === 'valid' && s.Cache_Location && s.Primary_RenditionNumber)
        .map((s) => {
          const folder = String(s.Cache_Location).replace(/\\/g, '/');
          const file = String(s.Primary_RenditionNumber).replace(/\.jpe?g$/i, '');
          const base = `https://img.artsmia.org/web_objects_cache/${folder}/${file}`;
          const side = Math.max(+s.image_width || 0, +s.image_height || 0);
          return {
            id: `mia-${s.id}`,
            source: 'mia',
            museum: 'Mia',
            title: s.title || 'Untitled',
            artist: s.artist || s.culture || 'Unknown artist',
            date: s.dated || '',
            type: s.classification || '',
            thumb: `${base}_400.jpg`,
            // full size unless it is huge (some are 7 MB); 800 px otherwise
            image: side && side <= 4000 ? `${base}_full.jpg` : `${base}_800.jpg`,
            imageFallback: `${base}_800.jpg`,
            link: `https://collections.artsmia.org/art/${s.id}`,
            credit: 'Minneapolis Institute of Art, public domain',
            needsRelay: true,
          };
        });
      const total = json.hits && json.hits.total;
      const count = typeof total === 'number' ? total : (total && total.value) || items.length;
      return { items, page, totalPages: Math.min(Math.ceil(count / PAGE), 25) };
    },
  };

  /* ---------- The National Gallery, London ---------- */
  // Search: data.ng.ac.uk Elasticsearch. Images: its IIIF server (public images are
  // at most about 800 px). Images are CC BY-NC-ND 4.0: fine for private study, but
  // altered versions (like a value study) shouldn't be shared.

  const NGL_FIELDS = '@admin.uid,summary.title,creation.date.value,creation.attribution.value,multimedia.@admin.uid';
  function luceneWords(q) {
    return q.replace(/[+\-=&|><!(){}[\]^"~*?:\\/@]/g, ' ').trim();
  }
  const ngl = {
    id: 'ngl',
    name: 'The National Gallery, London',
    short: 'National Gallery London',
    needsRelay: false,
    async search(q, page, signal, { paintingsOnly }) {
      let query = `(${luceneWords(q) || '*'}) AND \\@datatype.base:object AND access.media.public_image:true`;
      if (paintingsOnly) query += ' AND classification.value:Picture';
      const params = new URLSearchParams({
        q: query,
        default_operator: 'AND',
        size: String(PAGE),
        from: String((page - 1) * PAGE),
        _source: NGL_FIELDS,
      });
      const json = await getJson(`https://data.ng.ac.uk/es/public/_search?${params}`, signal);
      const hits = (json.hits && json.hits.hits) || [];
      const items = hits
        .map((h) => h._source || {})
        .filter((s) => s.multimedia && s.multimedia[0] && s.multimedia[0]['@admin'] && s.multimedia[0]['@admin'].uid)
        .map((s) => {
          const pid = s.multimedia[0]['@admin'].uid;
          const c = (s.creation && s.creation[0]) || {};
          const uid = (s['@admin'] && s['@admin'].uid) || pid;
          return {
            id: `ngl-${uid}`,
            source: 'ngl',
            museum: 'National Gallery London',
            title: (s.summary && s.summary.title) || 'Untitled',
            artist: (c.attribution && c.attribution[0] && c.attribution[0].value) || 'Unknown artist',
            date: (c.date && c.date[0] && c.date[0].value) || '',
            type: 'Painting',
            thumb: `https://data.ng.ac.uk/iiif/3/${pid}/full/200,/0/default.jpg`,
            image: `https://data.ng.ac.uk/iiif/3/${pid}/full/max/0/default.jpg`,
            imageFallback: '',
            link: `https://data.ng.ac.uk/${uid}`,
            credit: 'The National Gallery, London, CC BY-NC-ND 4.0 (personal study only; please don’t share altered versions)',
            needsRelay: false,
          };
        });
      const total = json.hits && json.hits.total;
      const count = typeof total === 'number' ? total : (total && total.value) || items.length;
      return { items, page, totalPages: Math.min(Math.ceil(count / PAGE), 25) };
    },
  };

  const all = [aic, met, nga, mia, cma, ngl];

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

  VST.museum = { sources: { aic, met, nga, mia, cma, ngl }, all, available, imageUrl, relayBase, suggestions };
})(typeof window !== 'undefined' ? window : globalThis);

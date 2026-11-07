/*
 * Museum collection sources. Each source returns items in one shape:
 *   { id, source, title, artist, date, type, thumb, image, imageFallback,
 *     link, credit }
 * so more museums can be added later (see PLAN.md, v2).
 *
 * v1 source: Art Institute of Chicago public API (https://api.artic.edu/docs/).
 * Only public-domain works are requested; their images are CC0. The API and
 * its IIIF image server both allow cross-origin use, which the value tools
 * need in order to read pixels.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  const AIC_API = 'https://api.artic.edu/api/v1/artworks/search';
  const AIC_IIIF = 'https://www.artic.edu/iiif/2';
  const FIELDS = [
    'id',
    'title',
    'artist_title',
    'artist_display',
    'date_display',
    'image_id',
    'artwork_type_title',
    'is_public_domain',
  ].join(',');

  const aic = {
    id: 'aic',
    name: 'Art Institute of Chicago',

    async search(q, page = 1, signal) {
      const params = new URLSearchParams({
        q,
        'query[term][is_public_domain]': 'true',
        fields: FIELDS,
        limit: '40',
        page: String(page),
      });
      const res = await fetch(`${AIC_API}?${params}`, { signal });
      if (!res.ok) throw new Error(`The museum search returned an error (${res.status}).`);
      const json = await res.json();
      const iiif = (json.config && json.config.iiif_url) || AIC_IIIF;
      const items = (json.data || [])
        .filter((d) => d.image_id && d.is_public_domain !== false)
        .map((d) => ({
          id: `aic-${d.id}`,
          source: 'aic',
          title: d.title || 'Untitled',
          artist: d.artist_title || firstLine(d.artist_display) || 'Unknown artist',
          date: d.date_display || '',
          type: d.artwork_type_title || '',
          thumb: `${iiif}/${d.image_id}/full/200,/0/default.jpg`,
          image: `${iiif}/${d.image_id}/full/1686,/0/default.jpg`,
          imageFallback: `${iiif}/${d.image_id}/full/843,/0/default.jpg`,
          link: `https://www.artic.edu/artworks/${d.id}`,
          credit: 'Art Institute of Chicago, CC0',
        }));
      const pg = json.pagination || {};
      return {
        items,
        page,
        totalPages: Math.min(pg.total_pages || 1, 25),
        total: pg.total || items.length,
      };
    },
  };

  function firstLine(s) {
    return s ? String(s).split('\n')[0] : '';
  }

  /** Artists and subjects to get started; all are well represented at the AIC. */
  const suggestions = [
    'George Inness',
    'Claude Monet',
    'John Singer Sargent',
    'Winslow Homer',
    'Camille Corot',
    'Thomas Cole',
    'Jules Breton',
    'Landscape',
    'Still life flowers',
    'Portrait',
  ];

  VST.museum = { sources: { aic }, suggestions };
})(typeof window !== 'undefined' ? window : globalThis);

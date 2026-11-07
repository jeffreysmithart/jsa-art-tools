/*
 * Site settings.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  VST.config = {
    /*
     * Address of your Cloudflare image relay (see relay/README.md), e.g.
     * 'https://value-study-relay.yourname.workers.dev'
     * The Met and Cleveland need it; leave empty to use only the
     * Art Institute of Chicago.
     */
    imageRelay: 'https://value-study-relay.jeffrey-63e.workers.dev',
  };
})(typeof window !== 'undefined' ? window : globalThis);

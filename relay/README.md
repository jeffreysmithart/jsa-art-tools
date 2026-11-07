# Image relay (Cloudflare Worker)

The Met, the Minneapolis Institute of Art (Mia) and the Cleveland Museum of Art share their public-domain images freely, but their image servers don't include the header that lets a web page read an image's pixels, which the value tools need. This small relay fetches those images and passes them on with that header added.

- It only relays images from The Met's, Mia's and Cleveland's image servers, so nobody can use it for anything else.
- Images are cached for a day, so repeat views are fast.
- It fits easily within Cloudflare's free Workers plan (100,000 requests a day).

The Art Institute of Chicago, the National Gallery of Art (Washington) and the National Gallery (London) don't need the relay.

## Current deployment

The relay runs at `https://value-study-relay.jeffrey-63e.workers.dev`, and that address is set in `js/config.js`. To change the relay (for example, to allow another museum's image server), edit `worker.js`, then paste it into the Worker's code editor in the Cloudflare dashboard and deploy, or ask Claude to redeploy it.

## Set it up (about 10 minutes)

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. In the left menu, open **Compute (Workers)** → **Workers & Pages**. Older dashboards call it just **Workers & Pages**.
3. Choose **Create** → **Create Worker** (or **Start with Hello World!**).
4. Name it `value-study-relay`, then choose **Deploy**.
5. Choose **Edit code**. Delete everything in the editor, paste in the full contents of [`worker.js`](worker.js), and choose **Deploy**.
6. Copy the worker's address. It looks like `https://value-study-relay.<your-subdomain>.workers.dev`.

## Check that it works

Open this in your browser, with your own address in place of the first part:

```
https://value-study-relay.<your-subdomain>.workers.dev/?url=https://images.metmuseum.org/CRDImages/ad/original/DT11918.jpg
```

You should see George Inness's *Evening at Medfield, Massachusetts*.

## Connect it to the app

Put the address in `js/config.js`:

```js
imageRelay: 'https://value-study-relay.<your-subdomain>.workers.dev',
```

Or send the address to Claude and ask for it to be added. The Met and Cleveland then appear in the museum filter.

## Adding another museum later

If another museum has the same problem, add its image server's host name to `ALLOWED_HOSTS` at the top of `worker.js` and deploy again.

# Sync service (Cloudflare Worker + R2)

Keeps study sets, presets, history, your named palettes and the practice log in step across your devices. See PLAN.md, "Syncing across devices", for how it works.

- **It never sees anything readable.** Devices encrypt everything with a key made from the sync code before sending it. The service stores encrypted bytes, a storage id and a hash of the write token, all made from the code.
- **Only the app's site can use it** (`https://jeffreysmithdesigner.com`, with or without `www.`, and `https://jeffreysmithart.github.io`, plus `localhost` for testing). Change the list with an `ALLOWED_ORIGINS` variable, comma-separated.
- **Limits:**
  - 5 MB per document and 2 GB per sync code.
  - 120 requests a minute per sync code.
  - Each write says which version it replaces, so two devices can't overwrite each other.
- **Cost:** it fits Cloudflare's free plan (R2: 10 GB stored; Workers: 100,000 requests a day).

## Current deployment

- **Service:** runs at `https://value-study-sync.jeffrey-63e.workers.dev`, as the Worker `value-study-sync`, with the R2 bucket `value-study-sync` bound as `SYNC`. It was deployed on 2026-11-08 through the Cloudflare API, with `sync/worker.js` unchanged.
- **Checked live:**
  - a request from the site with nothing stored gets an empty list;
  - other sites are refused;
  - a store and a read-back match;
  - a wrong token is refused;
  - a stale write is refused;
  - turning sync off deletes the data.

  The test data was deleted afterwards.
- **To update it:** edit `worker.js`, then paste it into the Worker's editor in the dashboard and deploy, or ask Claude to redeploy it (the binding stays).

## API

| Request | What it does |
|---|---|
| `GET /v1/<id>` | What's stored: `{ docs: [{ name, version, size }] }` |
| `GET /v1/<id>/doc/<name>` | One document (encrypted bytes); its version is in `ETag` |
| `PUT /v1/<id>/doc/<name>` | Store a document. Send `If-Match: <version>` to replace one, or `If-None-Match: *` for a new one. If it changed meanwhile: `412` with the current version. |
| `DELETE /v1/<id>` | Delete everything for this sync code (turning sync off) |

Every request needs `Authorization: Bearer <token>`. Names: `sets`, `presets`, `history`, `palettes`, `log/<deviceId>`.

## Set it up

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **R2 Object Storage** and create a bucket named `value-study-sync`. R2 may ask you to turn it on first; the free plan is enough.
2. In **Workers & Pages**, create a Worker named `value-study-sync`, choose **Edit code**, replace everything with [`worker.js`](worker.js), and deploy.
3. In the Worker's **Settings** → **Bindings**, add an **R2 bucket** binding named `SYNC` pointing at `value-study-sync`, and deploy again.
4. Copy the Worker's address (`https://value-study-sync.<your-subdomain>.workers.dev`) and put it in `js/config.js` as `syncService`.

Claude can also do steps 1–3 through the Cloudflare API with the token saved in the cloud environment, after asking.

`wrangler.toml` here has the same settings, for deploying with Wrangler instead (`npx wrangler deploy` in this folder).

## Try it locally

```sh
node tests/sync-dev.mjs        # runs the Worker on http://localhost:8788, storage in memory
node --test tests/sync.test.mjs
```

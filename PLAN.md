# Value Study: Plan and Handoff

A browser-based practice tool for painters. It turns any reference image into simplified value and color studies, and runs timed master-copy sessions from public-domain museum collections. It's built for deliberate practice: big shapes and the light key first, before you can overthink it.

Live at **https://jeffreysmithdesigner.com/** (the owner's domain, served by GitHub Pages from `main`; the GitHub address `https://jeffreysmithart.github.io/jsa-art-tools/` also works). Anything that checks the site's address, like the sync service's allowed sites, needs the domain, not just the GitHub address. [README.md](README.md) describes every feature in detail; this file covers where things stand, what's next, and how to work on it.

## Inspiration

This project was sparked by two tools that are genuinely useful and interesting:

- **[Proko's value tool](https://www.proko.com/values)**: simplifying a reference into a few clear values.
- **[The Massa Art drawing timer](https://drawingtimer.com/)**: structured, timed drawing sessions.

We admire both and build on their *ideas*, not their design, layout, wording or branding. This tool has its own look and feel.

## Goals

- Practice seeing values quickly (gesture drawing, but for landscapes, portraits and florals).
- Prepare clean, simplified references for your own paintings.
- Study specific artists in depth from openly licensed collections.

## Where things stand

v1, v2, the v3 color tools and syncing across devices are complete (27 merged pull requests). The sidebar has five tabs:

- **Images:** upload, paste or link an image; search six museums (Art Institute of Chicago, The Met, National Gallery of Art in Washington, Mia in Minneapolis, Cleveland, and The National Gallery in London); **study sets** that mix museum paintings and your own photos, with export/import; a **history** of everything studied; and **Sync**, which keeps sets, presets, named palettes, history, the log and your own photos the same across devices with a sync code (or by scanning its QR code).
- **Study** (ordered by how often things are used):
  - **presets** (built-in and your own);
  - Gray / Color / Main colors / Palette;
  - All or 2–6 values;
  - **squint**;
  - the value bars;
  - splits (fit to image, even, or dragged) and how values are painted (area average by default, even steps, or custom marker values);
  - **Compare my study**, which photographs a sketch, squares it up with four corner points, and compares it through the same settings, with an overlay option.
- **Color:** the picture's colors in a Munsell-style 3D color space (value up the middle, hue around, chroma outward; positions are CIE Lab, so close to Munsell, not exact). Optional ghost of the colors not in the picture, main colors ringed, and a large view to turn, zoom, slice by value and tap a color to read it and see where it is in the picture (matches in color, ringed in white, the rest in faded gray; **Match** widens it to close or similar colors; tap the picture to find a spot's color in the space). Figures: main hue, strongest colors, share near gray, value range.
- **Limited palette** (Color tab): presets or your own paints; how much of the picture it can mix and what it can't; optionally its range in the color space (colors it can't mix are faded); rough recipes; and a **Palette** study tone that repaints with the nearest mixes and stripes what's out of reach.
- **Canvas:** composition guides (rule of thirds, golden section, diagonals with their reciprocals, and lines through the crossings), also shown in Crop for framing reference photos; grid (any columns × rows, square cells, diagonals); and downloads (study, cropped original, side-by-side or comparison sheet).
- **Log:** practice time this week, streaks, a month calendar shaded by time, and per-day detail of what was studied. Downloads as CSV.

Also: crop with canvas presets and custom sizes (each image keeps its crop, and it syncs), flip, a timer with rounds, breaks and timed sessions through a list or a set, **memory mode** (look, then draw with the image hidden; logged separately), **staged reveal** (2 values, then 3, then the full image, by tap or over a timed round), **Present** mode, **Try presets** across a whole set, keyboard shortcuts, and touch sizing for iPad.

## What's next

Nothing is in progress. The owner picks what's next; these are the ideas so far, roughly in the order they came up as wanted:

1. **Real accounts** for sync (the last step of the sync plan): probably Supabase, through the same adapter in `js/sync.js`. See [Real accounts, later](#real-accounts-later).
2. **Diagonal construction grid** (below), once the composition guides have been tried on real photos.
3. **Palette follow-ups,** refocused by the owner on exploring how a limited palette fits a particular painting:
   - **Done:** which paint to add or drop for this picture; **Compare palettes** (the picture painted with every palette, by reach); and the **gamut overlap wheel** (`js/overlap.js`: the palette's mixes in color, the picture's colors as dots sized by share inside an outline of its range, what it can't mix striped; all values or darks, middles, lights; reach is the same 3D test, so the wheel's gap matches "can't mix").
   - **Done too:** artists' palettes (in `PRESETS` with `group: 'artist'` and a `source`; 29 paints added for them). Read directly: Schmid (richardschmid.com), Keys (danieljkeys.com), Gennari (her 2026 workshop list on nataliafabia.com), Christensen (his supply-list PDF), Klein (his palette in a video, from the owner). Still from search summaries, labeled so: Macpherson, Paquet, Hanson. Large palettes are sampled more coarsely (`LEVELS`/`BUDGET` in `js/palette.js`), "least needed" reuses the palette's own mixes (`without`), and "add" makes only the new paint's mixes (`build(..., { include })` + `gain`), so a 16-paint palette's suggestions take about 3 s, not 25.
   - **Done too:** your own named palettes (`js/my-palettes.js`; **My palettes** in the palette menu with Save…, Rename…, Delete and "Save these paints to …"). They sync as a `palettes` document (merge rules as for presets), which the sync Worker accepts from this change on; the Worker has to be redeployed before the app, or the live service would refuse the new document.
   - **Done too:** **What stands in for each hue** (`PAL.standIns`: the palette's strongest mix in each hue family; tap for recipe and Munsell notation), for exploring unconventional palettes the owner likes, such as a secondary triad of phthalo green, dioxazine violet and cad orange (now a preset, with ultramarine and burnt sienna).
   - **Done too:** the **contrast check** (tap a stand-in: the same square on a gray of the same value, inside the palette's own complement, `PAL.complementOf`, and inside the picture as the palette would paint it; the screen shows simultaneous contrast, no modeling). Glazing is left out: spectral.js models paint mixed together, not a transparent layer over a dry one.
   - **Dropped for now:** a mixing chart and matching paints to a brand (the owner mixes by eye well; not worth the complexity).
   - **Where the artists' palettes come from** (the `source` on each in `js/palette.js` says the same):
     - **Read from the artist's own list:** Richard Schmid (main palette, richardschmid.com Tools & Materials; his extra colors, not included: cadmium orange deep, cadmium scarlet, Venetian red, cobalt violet light and deep), Daniel Keys (danieljkeys.com/supply-list), Jennifer Gennari (her February 2026 workshop list on nataliafabia.com), Scott Christensen (his Adventure of Painting supply-list PDF, from the owner: oil starter set, full oil set and gouache; his eight premixed Vasari grays are left out, since the palette can mix them), and Michael Klein (his palette as labeled in a video, from the owner).
     - **From search summaries only, labeled so:** Kevin Macpherson (Artists Network interview), Joe Paquet (Artists Network, "11 Tips for Painting en Plein Air"), and Marc Hanson's three-color palette (secondhand). Worth checking against a primary source when one turns up.
     - **Adding another:** find the artist's own list, add any missing paints to `PIGMENTS` (a typical masstone and a tinting strength judged by eye), and add an entry to `PRESETS` with `group: 'artist'` and a `source`. The cloud environment allows the hosts used so far (danieljkeys.com, richardschmid.com, nataliafabia.com); other sites need the owner's OK to add.
4. **Color space follow-ups:** the gamut mask is done (`js/mask.js`, the Gamut mask section of the Color tab, and "Paint the study inside the mask", which moves colors to the nearest inside at the same value, with a strength; it applies to the study and its downloads only, not to the analysis tools). **Paints for this mask** is done too: coverage of the masked picture by your palette, add/drop suggestions aimed at it (paints that mostly mix outside the mask are flagged, via `PAL.strayShare`), and **Build** (`PAL.grow`: from white, the paint that reaches most at each step, with straying paints losing close calls). It can aim at **the whole mask** too (`MK.sampleInside`: a grid inside the shape at nine values, keeping only colors a screen can show, evenly weighted), which is what it uses with no image loaded. Ideas for later: show the palette's range on the mask wheel, and saved masks.

Done, for reference:

- **Color gamut view:** done (the Color tab, as a 3D color space). Tap a color to see where it is in the picture: done. Exact Munsell notation: done (below). The gamut mask is done too.
- **Munsell notation:** readings use the Munsell renotation data (Newhall, Nickerson & Judd, JOSA 33(7), 1943; `real.dat` from RIT's Munsell Color Science Laboratory), built into `data/munsell-renotation.js` by `tools/build_munsell.py`. No license is stated on the data. It's a table of measured values from a 1943 scientific report, and it's redistributed freely (colour-science, BSD; the R `munsell` package, MIT), so the owner OK'd using it with a credit line. Don't confuse it with the 2021 "re-renotation" on IEEE DataPort, which is CC BY-NC-SA. `js/munsell.js` is written for this app: Lab is adapted from D65 to Illuminant C (Bradford), value comes from Y by ASTM D1535 (so the file's 1/0.975 Y scaling doesn't matter), and hue and chroma are found by searching the data's x, y loci. Values under 1 or over 9, and chroma past the data, are extended, so they're less exact. The 3D layout itself stays CIE Lab.
- **Limited-palette recolor:** done. Mixing uses spectral.js 3.0.0 (MIT), vendored unchanged in `js/vendor/`. Each paint is a typical masstone color with a tinting strength tuned by eye so its tints behave roughly like the real paint (in `js/palette.js`). Ideas for later: let a painter adjust a paint's color or strength to match their brand; save palettes by name; show recipes for the study's swatches; a mixing chart of the palette.

Composition, next step:

- **Diagonal construction grid** (inspired by the "Magic Grid" idea painters such as Kevin Macpherson teach): draw diagonals across the canvas and its rectangles, then verticals and horizontals through where lines cross, so the picture gets a web of connected, unequal shapes to fit the subject to. Every grid comes out different, so it would have a **New grid** button, and the download would mark where each line meets the edge (as a fraction, or in inches for a custom canvas size) so the same grid can be drawn on the panel. Build only after trying the composition guides on real photos. Keep its name generic ("Diagonal grid"), not "Magic Grid".

Smaller ideas raised along the way:

- **Grid in presets:** an "include grid" option, since presets currently skip the grid and crop on purpose.
- **Syncing across devices:** done, see [Syncing across devices](#syncing-across-devices) below.
- **More museums:** Rijksmuseum, Harvard Art Museums and the Smithsonian need free API keys.

## Syncing across devices

**Status:** done and in use on the owner's Mac and iPad (a beta). Steps 1–4 are built: merge rules, the service (deployed at `https://value-study-sync.jeffrey-63e.workers.dev`), the app's Sync section, and photos and QR codes. Crops sync too (each image keeps its crop in sets and history). Real accounts are the remaining step, later.

### Why

Sets, presets, the practice log and uploaded photos live in each browser's own storage, so work on the iPad doesn't show up on the Mac. iPad and iPhone Safari can also clear a site's storage after about seven days without a visit. A synced copy fixes both.

### Decisions so far

- **Who:** just the owner for now.
- **Devices:** iPad, Mac, sometimes iPhone.
- **Sign-in:** a **sync code**, no accounts yet.
- **Photos:** a fast follow, right after the rest works.
- **QR codes** for joining a device: a fast follow too. The first version shares the code by copy or AirDrop.
- **Accounts later:** probably Supabase (see below). WordPress isn't needed: there's no existing site to join.

### What syncs

Today's storage: `localStorage` holds `value-study:sets`, `:history`, `:queue`, `:presets`, `:log` and `:settings`; IndexedDB (`value-study` → `blobs`) holds uploaded photos. Set items carry a small data-URL thumbnail, so lists show before a photo arrives.

| Data | Syncs? | How two devices merge |
|---|---|---|
| Study sets | yes | By set. Each set and each item in it carries an `updated` time; removals leave a small "removed" marker (a tombstone) so a deletion on one device isn't undone by the other. Renames: the newest wins. |
| Your presets | yes | By preset id; the newest edit wins; deletions leave tombstones. |
| History | yes | Combine both lists by image, keep the latest study time, newest first, cap 60. |
| Practice log | yes | **Each device keeps its own log**, and the Log tab adds them up. No merging conflicts, and nothing is counted twice or lost when both devices were used on the same day. |
| Uploaded photos | fast follow | Stored once per photo (by a hash of its contents), downloaded on another device the first time it's opened. |
| Settings (view, values, timer, palette paints) | no | Each device keeps its own: a phone and a laptop often want different views. Palette paints may sync later with named palettes. |
| Session queue | no | It's a working list for one sitting. |

Merge rules live in their own module (`js/sync-merge.js`) as plain functions, with unit tests and no network, so they work the same whatever server sits behind them. Times use the device clock, nudged to be later than the last time seen from the server, so a device with a slow clock can't lose edits.

### The sync code

- **Turning it on:** "Turn on sync" on the first device makes a random code (128 bits, shown as five groups of letters and digits, e.g. `K7QM-…`). It can be copied, or shared with AirDrop through the browser's share sheet. **QR code (fast follow):** the first device shows the code as a QR code, and the other scans it with the camera. Showing one needs a small QR library, vendored like spectral.js (check its license first, and ask before adding outside code). Scanning can use the phone's camera app, by putting the code in a link that opens the site and fills it in, so no scanning library is needed. The code goes after a `#` in that link (e.g. `…/jsa-art-tools/#sync=K7QM-…`), which browsers never send to a server, and the app removes it from the address bar as soon as it's read, so it doesn't linger in history.
- **Joining:** "Join with a code" on another device takes the code, and from then on the devices stay in step.
- **Keys:** from the code, the device derives a storage id, a write token, and an encryption key, with Web Crypto (HKDF over SHA-256).
- **Encryption:** everything is encrypted on the device (AES-GCM) before it's sent, so the server, and anyone who gets into the Cloudflare account, sees only scrambled data.
- **What the code means:** the code is the key. Lose it, and the synced copy can't be read, though each device still has its own data. Anyone with the code can read the data. "Show my code" on a synced device lets you see it again.

### The service (Cloudflare, like the image relay)

- **Worker:** a new Worker, `value-study-sync`, in `sync/`, deployed to the same Cloudflare account as the relay. It only accepts requests from the GitHub Pages site and `localhost`.
- **Storage:** R2. R2 reads are always up to date and it supports conditional writes, which sync needs. KV can show stale data for up to a minute, so it's not used.
  - Objects: `u/<id>/doc/<name>` for each data type, `u/<id>/log/<deviceId>` per device, and later `u/<id>/photo/<hash>`.
- **API** (small and versioned):
  - `GET /v1/<id>`: list what's stored, with versions.
  - `GET` / `PUT /v1/<id>/doc/<name>`: read and write one data type. Writes say which version they replace, and fail if it changed meanwhile (the device then pulls, merges, and tries again).
  - Later, `GET` / `PUT /v1/<id>/photo/<hash>`, write once.
- **Write token:** the first write to an id records a hash of its write token; later writes must match it, so knowing an id alone isn't enough to overwrite data.
- **Limits, even for one person:**
  - 5 MB per data file and 15 MB per photo.
  - A total cap per id (2 GB to start).
  - A simple request rate limit.
- **Cost:** a personal library fits in Cloudflare's free tier (R2: 10 GB stored; Workers: 100,000 requests a day).

### When the app syncs

The device's own storage stays the source of truth, so the app works offline as before. Sync then:
1. pulls on load;
2. pushes a few seconds after a change;
3. pulls again when the page comes back into view, and every few minutes while open.

Each pass pulls, merges, and pushes only what changed. A small status line in a new **Sync** section (Images tab, under History) shows "Synced 2 min ago · 3 devices", or what went wrong.

### Photos (the fast follow)

- **Upload:** each uploaded photo gets a content hash; set items keep their `blobId`, and a small map links each one to its hash. The encrypted photo uploads once.
- **On another device:** the item shows its thumbnail right away, and the full photo downloads when it's opened.
- **Clean-up:** a photo no set or history entry uses is removed from the server too.

### Real accounts, later

The client talks to the service through one small adapter (`pull`, `push`, `photo get` / `put`), so the backend can change without touching the rest of the app.

| Option | Good | Watch out for |
|---|---|---|
| **Supabase** (recommended) | Built for this: sign-in by emailed link, a Postgres database, private photo storage with per-user rules, a free tier. The owner may already have an account. | Free projects can pause when idle for a while; a paid plan avoids that. Another service to look after. |
| Cloudflare Zero Trust | Same account as the relay; free for up to 50 people; emails a one-time code. | Made for teams, not public sign-up; fine for a few beta testers. |
| WordPress | Accounts, emails and a media library built in. | Media files are public by default; needs a custom plugin and upkeep. Only worth it next to an existing site, and there isn't one. |

Moving from the sync code to an account would be one step: sign in on a synced device, and it copies the data from the code's storage to the account. Whether the data stays encrypted with a key only the devices hold is a decision for then.

### Build steps

1. **Merge rules and local changes, no network.** Done:
   - `js/sync-merge.js` holds the rules. Tests in `tests/sync-merge.test.js` check that the sync order doesn't matter and that repeating a merge changes nothing, and `tests/sync-local.test.js` has two simulated devices swap copies.
   - New local records:
     - `value-study:sets-deleted`, `:history-removed` and `:presets-deleted` (removal markers);
     - `nameAt` and per-item `at` times in sets, and `updated` on presets;
     - `value-study:device` (this browser's id) and `:log-others` (other devices' logs, which `VST.log.days()` adds in);
     - `clearedAt` on a cleared log.
   - Times never repeat or go backwards within a session.
   - Nothing is migrated: older data counts as time 0.
   - Originally planned for this step:
   - `js/sync-merge.js` with unit tests.
   - Tombstones and `updated` times in sets and presets.
   - The log split into this device's own log plus other devices' logs, which the Log tab adds up.
   - Existing data migrates on first load.
2. **The service.** Built: `sync/worker.js` (with `sync/README.md` and `sync/wrangler.toml`), tested in `tests/sync.test.mjs` against an in-memory R2 bucket (`tests/r2-memory.mjs`); `node tests/sync-dev.mjs` runs it locally. Deployed on 2026-11-08 (R2 bucket and Worker `value-study-sync`, with the owner's OK) and checked live. As planned:
   - `sync/worker.js` with tests against an in-memory R2 stand-in, like `tests/relay-dev.mjs`.
   - Deploying it is outward-facing: ask the owner first.
3. **The client:** done.
   - `js/sync.js` handles the code (Crockford base 32, 25 characters), the keys (HKDF), AES-GCM encryption, and the sync passes. A pass skips anything unchanged on both sides, and retries with a fresh merge if another device saved in between.
   - The Sync section in the Images tab has Turn on, Join with a code, the status line, Show my code (Copy, Share), Stop syncing, and Delete the synced copy.
   - The code is kept on each synced device (`value-study:sync`) so it can keep syncing and show the code again.
   - Tests: `tests/sync-client.test.mjs` has two simulated devices against the real Worker and an in-memory bucket, and the browser test has two browsers against `tests/sync-dev.mjs`. A live check against the deployed service also passed, and its test data was deleted.
   - Originally planned: sync code, encryption, the sync loop, the Sync section in the Images tab, and browser tests with a stand-in server.
4. **Photos and QR codes:** done.
   - **Photos:** a device that has one encrypts it and stores it once, named by an HMAC of its bytes with the code's naming key. Items record that name as `photo`, and the merge rules keep it whichever copy wins. Other devices fetch it when it's opened, and photos nobody uses are removed after a day.
   - **QR codes:** qrcode-generator 2.0.4 (MIT) is vendored unchanged as `js/vendor/qrcode.js`, after the owner's OK and a check for network or storage calls. The QR code holds a link with `#sync=<code>`; opening it asks before joining and removes the code from the address bar.
   - **Deployment:** the Worker was redeployed with photo storage (the owner's OK; the existing synced copy was untouched).
5. **Accounts, later:** a Supabase adapter.

## Notes for a new session

**Environment.** Start cloud sessions on the **jsa-art-tools** environment, not Default.
- **Allowed hosts:** the museum APIs and image servers, the image relay and the sync service (`*.jeffrey-63e.workers.dev`, listed by name), `raw.githubusercontent.com` (for refreshing the NGA index) and `aiforui.vercel.app`.
- **Cloudflare API token:** saved in the environment and sent only to `api.cloudflare.com`. It's used for redeploying the relay and the sync Worker, and for reading the R2 bucket's object list.
- **Not reachable:** the app's own domain (jeffreysmithdesigner.com) can't be fetched from a session, so live site checks are the owner's.

**Cloudflare services** (account `jeffrey-63e`). Both are plain Workers in this repo, deployed by uploading the file unchanged through the API:
- **Image relay:** `relay/worker.js` at `value-study-relay.jeffrey-63e.workers.dev`.
- **Sync service:** `sync/worker.js` at `value-study-sync.jeffrey-63e.workers.dev`, with the R2 bucket `value-study-sync` bound as `SYNC`.
- **How to deploy:**
  - `PUT /accounts/<id>/workers/scripts/<name>` as multipart, with metadata `{"main_module":"worker.js","compatibility_date":"2026-11-01","bindings":[…]}` (for sync, the `r2_bucket` binding) and the file as `application/javascript+module`.
  - Then check the live service with `curl` and a throwaway id.
- **Ask the owner before every deploy.** The session's safety check also blocks deploys without an explicit OK in the conversation.
- **The bucket holds the owner's encrypted sync data.** Never delete objects a session didn't create itself. Live tests use throwaway ids and remove their data afterwards; check the object list before and after.
- **Allowed sites:** the sync service accepts only the app's own domain (with and without `www.`), the GitHub Pages address and `localhost`. If the site moves, update `DEFAULT_ORIGINS` in `sync/worker.js` and redeploy.

**Museums.**
- **The Art Institute, NGA and London** send images browsers can read directly. NGA has no search API, so the app searches `data/nga-paintings.json`, which `tools/build_nga_index.py` builds from the Gallery's published catalog.
- **The Met, Mia and Cleveland** don't allow pixel reading, so their study images go through the **image relay**, a Cloudflare Worker (`relay/worker.js`, deployed at `value-study-relay.jeffrey-63e.workers.dev` and set in `js/config.js`). It only relays those three museums' image hosts. To add a host, edit `ALLOWED_HOSTS` and redeploy, either through the Cloudflare dashboard or the API with the saved token.
- **The Met** uses its search **v1.1** (v1 was retired on 2026-10-01).
- **London's images** are CC BY-NC-ND: fine for personal study, but altered versions shouldn't be shared. Results carry that note.
- **Not possible:** MFA Boston and the National Galleries of Scotland have no public search API, and both block automated access.
- **The Art Institute's bot check** blocks automated browsers from cloud machines. Its live search can't be tested from a cloud session, though it works in normal browsers.

**Testing.**
- **Unit tests:** `node --test tests/*.test.js tests/*.test.mjs` runs all 83. They cover image processing, warp, presets, the log, the relay, composition guides, the color space, the palette, and sync:
  - `sync-merge` (the merge rules);
  - `sync-local` (two simulated devices' storage);
  - `sync.test.mjs` (the Worker against an in-memory R2 bucket in `tests/r2-memory.mjs`);
  - `sync-client.test.mjs` (two devices, the real Worker, end to end).
- **Browser test:** run `python3 -m http.server 8765 &`, then `node tests/smoke.e2e.js`.
  - Museum responses are simulated, and an `aware()` helper opens the right sidebar tab before using a control.
  - It starts its own local sync service (`tests/sync-dev.mjs`, port 8799), so it never touches the live one.
- **Local sync service:** `node tests/sync-dev.mjs [port]` runs the sync Worker with in-memory storage, for trying sync by hand.
- **Write screenshots and downloads outside the repo,** using the `OUT` environment variable.
- **Every change should keep both suites passing.**

**Working style.**
- **One pull request per feature,** on the session's branch. The owner reviews and merges; never push to `main`.
- **Restarting the branch:** after a merge, restart it from the updated `main`. First check that the last pull request really is merged; if it isn't, keep building on the branch.
- **Explain in plain language** with a clear recommendation, and ask before anything outward-facing, such as environment changes, deploys or installs.
- **Outside code:** ask the owner before adding any. Check its license and look through it (no network, storage or `eval` calls) before running or vendoring it. It goes in `js/vendor/`, unchanged, with its license. So far: spectral.js (MIT) and qrcode-generator (MIT).
- **The owner tests on an iPad and a Mac.** Screenshots from them are the best bug reports; there's no access to their devices from a session.

**Design principles.**
- **Grays stay truly neutral** (chroma 0), so the surroundings don't bias how values read.
- **Colors are OKLCH tokens** in `css/app.css`, with contrast checked with APCA (Lc 60+ for small text).
- **Touch devices:** controls at least 44 px, text fields 16 px.
- **Values are CIE L\*,** shown on a 0–10 scale.
- **"Fit to image" splits refit** to each new image; even and hand-dragged splits stay put.
- **Plain HTML, CSS and JS** with no build step.
- **Bump the `?v=` version** on the stylesheet and script tags in `index.html` (all of them, to the same date-based value) whenever CSS or JS changes. Otherwise browsers can pair the new page with old cached scripts, and new buttons do nothing.

**Emil Kowalski UI skills.** These were used for the UI reviews (`emil-ui-review`, `emil-design-foundations`, `emil-color`, `emil-ui-polish`, `emil-touch-and-accessibility`, …). They're paid, per-user content, so they're deliberately **not** in this public repo.
- **Cloud sessions:** reinstall with the owner's aiforui.dev install command using `--global`, or upload the skill folders to claude.ai account skills, which sync to all sessions.
- **Locally:** the owner's global install already works.

## UI refinement pass (after the palette)

Reviewed with the `emil-ui-review` skill after memory mode, reveal, the color space and the palette had each added controls. Changes:
- **Study tab, ordered by use:** presets as one compact row (Delete only shows for your own presets); Color (Gray, Color, Main colors, Palette, on one line); Number of values; **Squint** moved up; the value bars; then the finer controls (where values split, how each value is painted, with shorter choices).
- **Value bars:** an outline for the empty part and a sample of each value under its bar, so a small dark share isn't lost against the dark panel.
- **Palette mode:** the paints as color dots beside the palette's name, with Change… and "Mark what it can't mix".
- **Timer:** Memory and Reveal are one **Practice** menu; the status sits above the clock; Time, Rounds and Break name themselves ("10 min", "2 rounds", "10 sec break"), so the bar fits one row at a 1400 px window.
- **Phones:** the view switcher and Present share a row, the tools take the next; on a first visit the study opens alone at full width.
- **Color tab:** one sentence under the color space, the rest behind "How to read this"; the same for how mixing is worked out.
- **Canvas tab:** keyboard shortcuts as a list behind a toggle, instead of a run-on line.

## Decisions and risks

- **Pinterest:** dropped. Its developer access is restrictive, and museum collections plus uploaded sets replace it.
- **Artist coverage:** varies with what each museum releases openly. Some painters (e.g. Edgar Payne) have few open-access images, so uploaded sets fill the gap.
- **Storage:** sets, presets, history and the log live in localStorage, with uploaded photos in IndexedDB. Without sync they're per browser, and Safari may clear site storage after about 7 days without a visit. With sync, the synced copy brings them back.
- **The sync code is the key.** Everything is encrypted with it on the device, so a lost code means the synced copy can't be read (each device keeps its own data). The code is kept on each synced device so it can keep syncing and be shown again.
- **Sync service limits:** 5 MB per document, 15 MB per photo, 2 GB per sync code, 120 requests a minute. Personal use fits Cloudflare's free tier.
- **Originality:** match the *ideas* of the Proko value tool and Massa Art timer, not their design or branding.

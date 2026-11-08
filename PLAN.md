# Value Study: Plan and Handoff

A browser-based practice tool for painters. It turns any reference image into simplified value and color studies, and runs timed master-copy sessions from public-domain museum collections. It's built for deliberate practice: big shapes and the light key first, before you can overthink it.

Live at **https://jeffreysmithart.github.io/jsa-art-tools/** (GitHub Pages, built from `main`). [README.md](README.md) describes every feature in detail; this file covers where things stand, what's next, and how to work on it.

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

v1 and v2 are complete (17 merged pull requests), and v3 is well along: the 3D color space and the limited palette. The sidebar has five tabs:

- **Images:** upload, paste or link an image; search six museums (Art Institute of Chicago, The Met, National Gallery of Art in Washington, Mia in Minneapolis, Cleveland, and The National Gallery in London); **study sets** that mix museum paintings and your own photos, with export/import; and a **history** of everything studied.
- **Study:** **presets** (built-in and your own); Grayscale / Color / Main colors; 2–6 values with adjustable splits (fit to image, even, or dragged); how values are painted (area average by default, even steps, or custom marker values); squint; and **Compare my study**, which photographs a sketch, squares it up with four corner points, and compares it through the same settings, with an overlay option.
- **Color:** the picture's colors in a Munsell-style 3D color space (value up the middle, hue around, chroma outward; positions are CIE Lab, so close to Munsell, not exact). Optional ghost of the colors not in the picture, main colors ringed, and a large view to turn, zoom, slice by value and tap a color to read it. Figures: main hue, strongest colors, share near gray, value range.
- **Limited palette** (Color tab): presets or your own paints; how much of the picture it can mix and what it can't; its range and the unreachable colors in the color space; rough recipes; and a **Palette** study tone that repaints with the nearest mixes and stripes what's out of reach.
- **Canvas:** composition guides (rule of thirds, golden section, diagonals with their reciprocals, and lines through the crossings), also shown in Crop for framing reference photos; grid (any columns × rows, square cells, diagonals); and downloads (study, cropped original, side-by-side or comparison sheet).
- **Log:** practice time this week, streaks, a month calendar shaded by time, and per-day detail of what was studied. Downloads as CSV.

Also: crop with canvas presets and custom sizes, flip, a timer with rounds, breaks and timed sessions through a list or a set, **memory mode** (look, then draw with the image hidden; logged separately), **staged reveal** (2 values, then 3, then the full image, by tap or over a timed round), **Present** mode, **Try presets** across a whole set, keyboard shortcuts, and touch sizing for iPad.

## What's next

v2 is complete: decreasing-time rounds ("Shorter each round" in the timer's Time menu) was the last item.

v3, a larger project to scope on its own:

- **Color gamut view:** done (the Color tab, as a 3D color space). Ideas for later: tap a color to highlight where it is in the picture; true Munsell notation from the Munsell renotation data instead of the Lab approximation; a gamut mask.
- **Limited-palette recolor:** done. Mixing uses spectral.js 3.0.0 (MIT), vendored unchanged in `js/vendor/`. Each paint is a typical masstone color with a tinting strength tuned by eye so its tints behave roughly like the real paint (in `js/palette.js`). Ideas for later: let a painter adjust a paint's color or strength to match their brand; save palettes by name; show recipes for the study's swatches; a mixing chart of the palette.

Composition, next step:

- **Diagonal construction grid** (inspired by the "Magic Grid" idea painters such as Kevin Macpherson teach): draw diagonals across the canvas and its rectangles, then verticals and horizontals through where lines cross, so the picture gets a web of connected, unequal shapes to fit the subject to. Every grid comes out different, so it would have a **New grid** button, and the download would mark where each line meets the edge (as a fraction, or in inches for a custom canvas size) so the same grid can be drawn on the panel. Build only after trying the composition guides on real photos. Keep its name generic ("Diagonal grid"), not "Magic Grid".

Smaller ideas raised along the way:

- **Grid in presets:** an "include grid" option, since presets currently skip the grid and crop on purpose.
- **Syncing across devices:** planned, see [Syncing across devices](#syncing-across-devices) below.
- **More museums:** Rijksmuseum, Harvard Art Museums and the Smithsonian need free API keys.

## Syncing across devices

**Status:** planned, not built. For the owner's own iPad, Mac and iPhone first (a beta), with real accounts designed for but not built yet.

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

- **Turning it on:** "Turn on sync" on the first device makes a random code (128 bits, shown as five groups of letters and digits, e.g. `K7QM-…`). It can be copied, or shared with AirDrop through the browser's share sheet. **QR code (fast follow):** the first device shows the code as a QR code, and the other scans it with the camera. Showing one needs a small QR library, vendored like spectral.js (check its license first, and ask before adding outside code). Scanning can use the phone's camera app, by putting the code in a link that opens the site and fills it in, so no scanning library is needed.
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

1. **Merge rules and local changes, no network.**
   - `js/sync-merge.js` with unit tests.
   - Tombstones and `updated` times in sets and presets.
   - The log split into this device's own log plus other devices' logs, which the Log tab adds up.
   - Existing data migrates on first load.
2. **The service.**
   - `sync/worker.js` with tests against an in-memory R2 stand-in, like `tests/relay-dev.mjs`.
   - Deploying it is outward-facing: ask the owner first.
3. **The client:** sync code, encryption, the sync loop, the Sync section in the Images tab, and browser tests with a stand-in server.
4. **Photos and QR codes** (fast follows).
5. **Accounts, later:** a Supabase adapter.

## Notes for a new session

**Environment.** Start cloud sessions on the **jsa-art-tools** environment, not Default. It allows the museum APIs and image servers, the relay, `raw.githubusercontent.com` (for refreshing the NGA index) and `aiforui.vercel.app`. It also holds a saved Cloudflare API token, sent only to `api.cloudflare.com`, for redeploying the relay.

**Museums.**
- **The Art Institute, NGA and London** send images browsers can read directly. NGA has no search API, so the app searches `data/nga-paintings.json`, which `tools/build_nga_index.py` builds from the Gallery's published catalog.
- **The Met, Mia and Cleveland** don't allow pixel reading, so their study images go through the **image relay**, a Cloudflare Worker (`relay/worker.js`, deployed at `value-study-relay.jeffrey-63e.workers.dev` and set in `js/config.js`). It only relays those three museums' image hosts. To add a host, edit `ALLOWED_HOSTS` and redeploy, either through the Cloudflare dashboard or the API with the saved token.
- **The Met** uses its search **v1.1** (v1 was retired on 2026-10-01).
- **London's images** are CC BY-NC-ND: fine for personal study, but altered versions shouldn't be shared. Results carry that note.
- **Not possible:** MFA Boston and the National Galleries of Scotland have no public search API, and both block automated access.
- **The Art Institute's bot check** blocks automated browsers from cloud machines. Its live search can't be tested from a cloud session, though it works in normal browsers.

**Testing.**
- `node --test tests/*.test.js tests/*.test.mjs` runs the unit tests: image processing, warp, presets, log and relay.
- `python3 -m http.server 8765 &` then `node tests/smoke.e2e.js` runs the browser test. Museum responses are simulated, and an `aware()` helper opens the right sidebar tab before using a control.
- **Write screenshots and downloads outside the repo,** using the `OUT` environment variable.
- **Every change should keep both suites passing.**

**Working style.**
- **One pull request per feature,** on the session's branch. The owner reviews and merges; never push to `main`.
- **Explain in plain language** with a clear recommendation, and ask before anything outward-facing, such as environment changes, deploys or installs.

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
- **Storage is per browser:** sets, presets, history and the log live in localStorage, with uploaded photos in IndexedDB. Safari may clear site storage after about 7 days without a visit, so exporting important sets is wise.
- **Originality:** match the *ideas* of the Proko value tool and Massa Art timer, not their design or branding.

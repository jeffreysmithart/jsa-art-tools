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

v1 is complete, and most of v2 is too (12 merged pull requests, plus memory mode). The sidebar has four tabs:

- **Images:** upload, paste or link an image; search six museums (Art Institute of Chicago, The Met, National Gallery of Art in Washington, Mia in Minneapolis, Cleveland, and The National Gallery in London); **study sets** that mix museum paintings and your own photos, with export/import; and a **history** of everything studied.
- **Study:** **presets** (built-in and your own); Grayscale / Color / Main colors; 2–6 values with adjustable splits (fit to image, even, or dragged); how values are painted (area average by default, even steps, or custom marker values); squint; and **Compare my study**, which photographs a sketch, squares it up with four corner points, and compares it through the same settings, with an overlay option.
- **Canvas:** composition guides (rule of thirds, golden section, diagonals with their reciprocals, and lines through the crossings), also shown in Crop for framing reference photos; grid (any columns × rows, square cells, diagonals); and downloads (study, cropped original, side-by-side or comparison sheet).
- **Log:** practice time this week, streaks, a month calendar shaded by time, and per-day detail of what was studied. Downloads as CSV.

Also: crop with canvas presets and custom sizes, flip, a timer with rounds, breaks and timed sessions through a list or a set, **memory mode** (look, then draw with the image hidden; logged separately), **Present** mode, **Try presets** across a whole set, keyboard shortcuts, and touch sizing for iPad.

## What's next

Remaining from v2:

1. **Staged reveal:** show 2 values, then 3, then the full image, so you commit to the big masses first. Could run on the timer or step on tap. The timer's phase flow (`armRound` / `startRound` / `onPhaseEnd` in `js/app.js`, which memory mode added a look phase to) is the place to hook it in.
2. **Decreasing-time rounds:** the same image at 10, then 5, then 2 minutes. Today's rounds all have the same length.

v3, a larger project to scope on its own:

- **Color gamut view:** plot an image's colors on a color wheel.
- **Limited-palette recolor:** for example Prussian blue, yellow ocher, vermillion, black and white, using pigment-mixing simulation (check the license of any mixing library), and flag colors the palette can't reach.

Composition, next step:

- **Diagonal construction grid** (inspired by the "Magic Grid" idea painters such as Kevin Macpherson teach): draw diagonals across the canvas and its rectangles, then verticals and horizontals through where lines cross, so the picture gets a web of connected, unequal shapes to fit the subject to. Every grid comes out different, so it would have a **New grid** button, and the download would mark where each line meets the edge (as a fraction, or in inches for a custom canvas size) so the same grid can be drawn on the panel. Build only after trying the composition guides on real photos. Keep its name generic ("Diagonal grid"), not "Magic Grid".

Smaller ideas raised along the way:

- **Grid in presets:** an "include grid" option, since presets currently skip the grid and crop on purpose.
- **Syncing across devices:** sets, presets and the log are per browser today. Cloud sync would need an online store; the existing Cloudflare account could host one.
- **More museums:** Rijksmuseum, Harvard Art Museums and the Smithsonian need free API keys.

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

**Emil Kowalski UI skills.** These were used for the UI reviews (`emil-ui-review`, `emil-design-foundations`, `emil-color`, `emil-ui-polish`, `emil-touch-and-accessibility`, …). They're paid, per-user content, so they're deliberately **not** in this public repo.
- **Cloud sessions:** reinstall with the owner's aiforui.dev install command using `--global`, or upload the skill folders to claude.ai account skills, which sync to all sessions.
- **Locally:** the owner's global install already works.

## Decisions and risks

- **Pinterest:** dropped. Its developer access is restrictive, and museum collections plus uploaded sets replace it.
- **Artist coverage:** varies with what each museum releases openly. Some painters (e.g. Edgar Payne) have few open-access images, so uploaded sets fill the gap.
- **Storage is per browser:** sets, presets, history and the log live in localStorage, with uploaded photos in IndexedDB. Safari may clear site storage after about 7 days without a visit, so exporting important sets is wise.
- **Originality:** match the *ideas* of the Proko value tool and Massa Art timer, not their design or branding.

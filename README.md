# Value Study

A browser-based practice tool for painters. It turns any reference into simplified value and color studies, and runs timed master-copy sessions from public-domain museum paintings. See [PLAN.md](PLAN.md) for the full plan and roadmap.

Inspired by [Proko's value tool](https://www.proko.com/values) and the [Massa Art drawing timer](https://drawingtimer.com/). It builds on their ideas, not their design.

## What's in v1

**Layout:** the sidebar has five tabs:
- **Images** is for finding what to study: **Upload** your own image or a link, search the **Museums**, or open a study set or something from History.
- **Study** holds the value study settings and My study.
- **Color** shows the picture's colors in a 3D **color space** laid out like the Munsell color solid: **value** runs up the middle from black (0) to white (10), **hue** goes around (R, YR, Y, GY, G, BG, B, PB, P, RP), and **chroma** gets stronger away from the gray center. Each dot is a color in the picture, bigger where it covers more; in Main colors the main colors are ringed. **Show colors not in the picture** adds the rest of the colors a screen can show as a faint ghost, so you can see what the picture leaves out. Tap the view to open it large: drag to turn it, scroll or pinch to zoom (arrow keys and +/− work too), **Top** and **Side** views, a **Value** menu to see one level at a time like a page of a Munsell book, and tap a dot to read its value, chroma, hue and share of the picture. Tapping a dot also shows **where that color is in the picture**: a copy of the picture beside the view (below it on phones) keeps the matching areas in color, ringed in white, with everything else in faded gray. **Match** widens it from that exact color to close colors, similar colors or a broad range, and the share updates. Tap the picture to find any spot's color in the space; **Clear** puts the view back on its own. Below the view: the main hue, how strong the strongest colors are, how much is near gray, and the value range. Positions are CIE Lab (value = L\* ÷ 10, chroma ≈ Lab chroma ÷ 5), so hue and chroma are close to Munsell, not exact. Squint smooths out noise first.
- **Limited palette** (also in the Color tab): choose a palette (Prussian blue, yellow ochre and vermilion; Zorn; warm or cool primaries; an earth palette; split primaries) or build your own from 22 common paints, with or without white and black. The app simulates everything those paints can mix and shows how much of the picture they reach and which colors they can't (for example "yellow-greens and purple-blues"). Turn on **Show it in the color space** (or **My palette** in the large view) to see the palette's range as a faint cloud, with the picture's colors it can't mix faded; tapping a color gives a rough recipe ("mostly yellow ochre, some titanium white, a touch of vermilion") or how far out of reach it is. **Paint the study with this palette** switches the study to **Palette**, which repaints the picture with the nearest mixes and stripes what the palette can't mix. Mixing uses [spectral.js](https://github.com/rvanwijnen/spectral.js) (Kubelka–Munk, MIT license) from typical colors of each paint; brands vary, so treat it as a guide.
- **Canvas** holds the composition guides, the grid and downloads.
- **Log** shows your practice: time this week, current and best streak, days this month, and all-time totals; a month calendar with practiced days shaded by time; and, for any day, what you studied, for how long, and how many timed rounds (and memory rounds) you drew (tap an image to reopen it). **Download log** saves it as a spreadsheet (CSV).

The study image and its toolbar stay in view whichever tab is open. Choosing your own image switches to Study automatically. On touch devices, controls are at least 44 px and text fields 16 px, so iPad Safari doesn't zoom.

**Finding images**
- **Upload:** choose, drop or paste an image, or load one from a link.
- **Museums:** search public-domain paintings by artist or subject across six museums (the **Art Institute of Chicago**, **The Met**, the **National Gallery of Art** in Washington, the **Minneapolis Institute of Art (Mia)**, the **Cleveland Museum of Art** and **The National Gallery, London**), or pick one with the **Museum** filter. Study a painting, or build a timed session from several. The Met, Mia and Cleveland need the free image relay; see [Museum image relay](#museum-image-relay).

**Study tools**
- **Color:** Gray, Color, Main colors, or Palette.
- **Number of values** (Grayscale or Color): **All** (the full range) or 2–6 values (2 is notan). In Color the hues stay and only the values are flattened, for a color poster study.
- **Main colors:** repaints the image with the 2–8 colors that best summarize it.
- **Palette:** repaints the image with what your limited palette can mix (see the Color tab), striping what it can't.
- **Value bar chart:** a bar for each value (or main color) shows how much of the picture it covers, with the largest highlighted, so you can see at a glance which value dominates. It also appears on the side-by-side sheet.
- **Value splits:** drag the splits on the histogram or the sliders, use **Fit to image** to find natural breaks, or **Even** to reset.
- **Paint each value as:** the **average** of each area (the default, true to the image's light key), **even steps** from dark to light (most contrast), or **custom**, which starts from the averages so you can adjust each value to match your markers (0 = black, 10 = white).
- **Squint** (blur), **Flip**, and a **grid** (any columns × rows, square cells, diagonals, black/white/red).
- **Composition guides** (`L`), separate from the grid: **Rule of thirds**, **Golden section** (lines at 0.382 and 0.618), **Diagonals** (corner to corner, plus the reciprocals: the lines at right angles to them from the other corners), and **Lines through the crossings** (verticals and horizontals through where the reciprocals meet the diagonals). Dots mark where lines meet. The guides you choose also show in **Crop**, with toggles there, so you can frame a reference photo with the horizon and big shapes on them. Downloads include them with **Include grid and guides**.
- **Crop** with canvas-size presets (5×7 to 36×48, panoramic 12×24 and 18×36, square, original), portrait or landscape, or **Custom size**: type your canvas's width × height (any unit, decimals allowed) and the crop locks to those proportions. Your last custom size is remembered. Each image keeps its crop: reopen it (from History or a set, or on another device with sync) and the crop is still there.
- **Study sets:** named collections that mix museum paintings and your own photos. Add the image you're studying with **+ Set** in the toolbar (or `S`). Open any image with a tap, or run a **Timed session** through a set. Rename, delete, and **Export / Import** a set as a file, with photos included, to back it up or move it to another device.
- **Presets:** one-tap study settings, like Lightroom presets. The built-in ones are Notan, 3 values, 4 values with even steps, 5 values, Squint with 3 values, Color poster with 4 values, 5 main colors, and Grayscale. **Save…** stores your current settings as your own preset. A preset remembers how its splits were set: **Fit to image** splits refit to each new image, while **Even** or hand-dragged splits stay put. The menu shows the matching preset, or "Custom settings".
- **Try presets on a set:** a contact sheet of every image in a study set rendered with one preset, each with a value-balance bar. Tap through the presets to compare, or tap an image to study it with that preset.
- **History:** every image you study is listed (up to 60, newest first), even after a refresh. Tap to reopen, or **+** to add it to the current set.
- **Compare my study:** photograph your sketch (on a phone or iPad, the picker offers the camera), then **square it up** by dragging four dots onto its corners, with a magnifier for precision. **Rotate 90°** fixes a sideways shot, and the result fits the reference's shape (or keeps the drawing's own with **As drawn**). **Compare** view shows the reference's value study beside yours through the *same* settings, with a second bar chart of your value balance. **Overlay** (`O`) lays your study on the reference at adjustable strength. **Correct paper to white** (on by default) undoes the gray cast phone photos give paper. In Compare view, the side-by-side sheet becomes a comparison sheet.
- **Present:** hides every control so only the image or images show, as large as the screen allows, for painting from the screen. It goes full screen where the browser allows and keeps the screen awake. Shortcuts still work; press `Esc` or `P`, or tap and choose **Exit presentation**, to bring the controls back.
- **Download** the study or the cropped original as PNG or JPG, with or without the grid, or a letter-size **side-by-side sheet** with the value scale.

**Timer (optional)**
- 30 seconds to 60 minutes, 1–5 rounds of the same image, and a break between rounds or paintings to turn the page.
- **Shorter each round:** the same image at, say, 10, then 5, then 2 minutes (also 2 → 1 min → 30 sec, 5 → 2 → 1 and 20 → 10 → 5), so each pass has to be simpler than the last. These set the number of rounds themselves.
- In a Master Copy session it moves through the queue automatically. A chime plays at the end of each round, and the screen stays awake while the timer runs.
- **Memory mode** (`M`, or **Practice** in the timer): each round starts with a look of 15 seconds to 90 seconds, then the image is hidden while you draw from memory. It comes back when the round ends (and during the break) so you can compare. **Peek at the reference** shows it again if you're stuck; that round then counts as a regular timed round. It works with rounds, breaks and timed sessions, and the Log counts memory rounds separately.
- **Staged reveal** (**Reveal** in the toolbar, or `R`): commit to the big masses first. The study shows 2 values, then 3, then the full image. Tap the image, the button or `R` to step; one more step after the full image (or **End**, or `Esc`) brings back your own view and settings, which the reveal never saves over. It keeps Grayscale or Color as you have it (Main colors steps in grayscale). In the timer's **Practice** menu, **Reveal** (2 → 3 → full, 2 → 3 → 4 → full, or 2 → 4 → 6 → full) spreads the stages evenly over each drawing round, with a soft chime at each step; tapping can still move ahead, and the break shows your usual view to compare. Memory and Reveal share the timer's **Practice** menu, so it's one or the other.

Keyboard (also listed under **Keyboard shortcuts** at the bottom of the Canvas tab): `G` grid, `L` composition guides, `F` flip, `V` view, `C` crop, `T` timer, `K` cycle grayscale / color / main colors, `P` present, `O` overlay my study, `S` add to set, `M` memory mode, `R` staged reveal, `0` all values, `2`–`6` number of values, `Space` start/pause.

Settings, study sets, history, the session list and a practice log (which images you studied, on which days, for how long, and completed timed rounds) are remembered in this browser (uploaded photos are stored too). They stay on this device unless you turn on **Sync**. Some browsers clear a site's storage after long disuse (Safari after about 7 days without visiting), and a synced copy brings it back.

**Sync** (Images tab): keeps study sets, your presets, history and the practice log the same on your devices.
- **Turn on sync:** gives you a sync code (25 letters and digits) and a QR code. Scan the QR code with another device's camera (it opens the app and asks to join), or choose **Join with a code** there and enter it. From then on they stay in step by themselves: a few seconds after a change, when you come back to the page, and every few minutes.
- **Encrypted on your device:** everything is encrypted with a key made from the code before it's sent, so the sync service (`sync/`, on Cloudflare) only stores scrambled data. Keep the code private, and don't lose it: it can't be recovered. **Show my code** brings it back on any synced device.
- **The practice log:** each device keeps its own, and the Log tab adds them up.
- **Your own photos sync too:** each is encrypted and uploaded once, and another device fetches it the first time it's opened there. Photos no set or history entry uses are removed from the synced copy after a day.
- **What doesn't sync:** settings such as the view and timer.
- **Stopping:** **Stop syncing** keeps everything on the device. **Delete the synced copy** removes the online copy for every device.

Export / Import still moves a single set by hand.

## Running it

No install or build step. Either:
- open `index.html` in a browser, or
- serve the folder: `python3 -m http.server 8000`, then visit http://localhost:8000

**To publish it free on GitHub Pages:** in the repository's Settings → Pages, choose *Deploy from a branch*, pick `main` and `/ (root)`, and save. The site appears at `https://<username>.github.io/jsa-art-tools/`.

## Notes and limits

- **Loading from a link** only works when the other site allows its images to be used by other pages. Many don't. Saving the image and choosing it, or copying and pasting it, always works.
- **Museum coverage** depends on what each museum holds and has released as public domain. "Paintings only" hides prints, drawings and photographs; turn it off to see everything.
- **MFA Boston** and the **National Galleries of Scotland** aren't included: neither offers a public collection search for apps. Saving an image from their websites and choosing it in Reference mode works.
- **The National Gallery, London** shares its images under CC BY-NC-ND 4.0, and public images are at most about 800 px. They're fine for private study, but please don't share altered versions, such as downloaded value studies, of its paintings.
- **The National Gallery of Art (Washington)** has no live search, so the app searches a built-in index of its 2,926 open-access paintings (`data/nga-paintings.json`). To refresh it from the Gallery's published catalog, run `python3 tools/build_nga_index.py`.

## Museum image relay

The Met's, Mia's and Cleveland's image servers don't let web pages read image pixels, which the value tools need, so their images pass through a small relay you run on Cloudflare's free plan. It only relays images from those museums' image servers. Setup takes about 10 minutes: see [relay/README.md](relay/README.md). Then put its address in `js/config.js`. Until then, those three show "needs setup" and the app uses the other museums.
- **Value numbers** are CIE L\* ÷ 10, close to the Munsell value scale. Marker brands number their grays differently, so use **Custom** to type the values your markers actually have.

## Tests

```sh
node --test tests/*.test.js tests/*.test.mjs   # image-processing and relay unit tests
python3 -m http.server 8765 &        # then, with Playwright installed:
node tests/smoke.e2e.js              # browser test of both modes (museum responses are simulated)
```

## Files

- `index.html`, `css/app.css`: the page
- `js/color.js`: color and value math (sRGB ↔ CIE Lab)
- `js/process.js`: blur, value bands, main colors
- `js/crop.js`: crop tool and canvas presets
- `js/compose.js`: composition guides (thirds, golden section, diagonals and their crossings)
- `js/colorspace.js`: the 3D color space (colors counted into cells, the screen's color solid, Munsell-style readings, where a color is in the picture, and the turnable view)
- `js/gamut.js`: the Color tab's figures (main hue, strongest colors, near gray, value range)
- `js/palette.js`: the limited palette (paints, presets, sampling what they mix, nearest mix, reach and recipes)
- `js/vendor/spectral.js`: [spectral.js](https://github.com/rvanwijnen/spectral.js) 3.0.0 by Ronald van Wijnen, unchanged, MIT license (`js/vendor/spectral.LICENSE`)
- `js/warp.js`, `js/squareup.js`: perspective correction and the square-up screen for study photos
- `js/timer.js`: countdown, chime, screen wake lock
- `js/presets.js`: built-in and saved presets, and rendering an image with a preset
- `js/log.js`: the practice log (records study time and timed rounds per day)
- `js/sync-merge.js`: merge rules for syncing across devices (study sets, presets, history, and each device's log)
- `js/sync.js`: syncing with a sync code (keys, encryption, the sync passes, photos); the Sync section and QR code are in `js/app.js`
- `js/vendor/qrcode.js`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, unchanged, MIT license (`js/vendor/qrcode.LICENSE`)
- `js/library.js`: study sets and history (localStorage, with uploaded photos in IndexedDB)
- `js/museum.js`: museum collection search for all six museums (more sources can be added here)
- `data/nga-paintings.json`, `tools/build_nga_index.py`: the National Gallery of Art paintings index and the script that builds it
- `js/config.js`: site settings (the image relay address)
- `sync/`: the sync service (a Cloudflare Worker with R2 storage, at `value-study-sync.jeffrey-63e.workers.dev`; `node tests/sync-dev.mjs` runs it locally), set in `js/config.js` as `syncService`
- `relay/`: the Cloudflare image relay and its setup steps (`node tests/relay-dev.mjs` runs it locally)
- `js/app.js`: the interface

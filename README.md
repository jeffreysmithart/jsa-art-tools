# Value Study

A browser-based practice tool for painters. It turns any reference into simplified value and color studies, and runs timed master-copy sessions from public-domain museum paintings. See [PLAN.md](PLAN.md) for the full plan and roadmap.

Inspired by [Proko's value tool](https://www.proko.com/values) and the [Massa Art drawing timer](https://drawingtimer.com/). It builds on their ideas, not their design.

## What's in v1

**Layout:** the sidebar has four tabs:
- **Images** is for finding what to study: **Upload** your own image or a link, search the **Museums**, or open a study set or something from History.
- **Study** holds the value study settings and My study.
- **Canvas** holds the composition guides, the grid and downloads.
- **Log** shows your practice: time this week, current and best streak, days this month, and all-time totals; a month calendar with practiced days shaded by time; and, for any day, what you studied, for how long, and how many timed rounds (and memory rounds) you drew (tap an image to reopen it). **Download log** saves it as a spreadsheet (CSV).

The study image and its toolbar stay in view whichever tab is open. Choosing your own image switches to Study automatically. On touch devices, controls are at least 44 px and text fields 16 px, so iPad Safari doesn't zoom.

**Finding images**
- **Upload:** choose, drop or paste an image, or load one from a link.
- **Museums:** search public-domain paintings by artist or subject across six museums (the **Art Institute of Chicago**, **The Met**, the **National Gallery of Art** in Washington, the **Minneapolis Institute of Art (Mia)**, the **Cleveland Museum of Art** and **The National Gallery, London**), or pick one with the **Museum** filter. Study a painting, or build a timed session from several. The Met, Mia and Cleveland need the free image relay; see [Museum image relay](#museum-image-relay).

**Study tools**
- **Color:** Grayscale, Color, or Main colors.
- **Number of values** (Grayscale or Color): **All** (the full range) or 2–6 values (2 is notan). In Color the hues stay and only the values are flattened, for a color poster study.
- **Main colors:** repaints the image with the 2–8 colors that best summarize it.
- **Value bar chart:** a bar for each value (or main color) shows how much of the picture it covers, with the largest highlighted, so you can see at a glance which value dominates. It also appears on the side-by-side sheet.
- **Value splits:** drag the splits on the histogram or the sliders, use **Fit to image** to find natural breaks, or **Even** to reset.
- **Paint each value as:** the **average** of each area (the default, true to the image's light key), **even steps** from dark to light (most contrast), or **custom**, which starts from the averages so you can adjust each value to match your markers (0 = black, 10 = white).
- **Squint (blur)**, **Flip**, and a **grid** (any columns × rows, square cells, diagonals, black/white/red).
- **Composition guides** (`L`), separate from the grid: **Rule of thirds**, **Golden section** (lines at 0.382 and 0.618), **Diagonals** (corner to corner, plus the reciprocals: the lines at right angles to them from the other corners), and **Lines through the crossings** (verticals and horizontals through where the reciprocals meet the diagonals). Dots mark where lines meet. The guides you choose also show in **Crop**, with toggles there, so you can frame a reference photo with the horizon and big shapes on them. Downloads include them with **Include grid and guides**.
- **Crop** with canvas-size presets (5×7 to 36×48, panoramic 12×24 and 18×36, square, original), portrait or landscape, or **Custom size**: type your canvas's width × height (any unit, decimals allowed) and the crop locks to those proportions. Your last custom size is remembered.
- **Study sets:** named collections that mix museum paintings and your own photos. Add the image you're studying with **+ Set** in the toolbar (or `S`). Open any image with a tap, or run a **Timed session** through a set. Rename, delete, and **Export / Import** a set as a file, with photos included, to back it up or move it to another device.
- **Presets:** one-tap study settings, like Lightroom presets. The built-in ones are Notan, 3 values, 4 values with even steps, 5 values, Squint with 3 values, Color poster with 4 values, 5 main colors, and Grayscale. **Save…** stores your current settings as your own preset. A preset remembers how its splits were set: **Fit to image** splits refit to each new image, while **Even** or hand-dragged splits stay put. The menu shows the matching preset, or "Custom settings".
- **Try presets on a set:** a contact sheet of every image in a study set rendered with one preset, each with a value-balance bar. Tap through the presets to compare, or tap an image to study it with that preset.
- **History:** every image you study is listed (up to 60, newest first), even after a refresh. Tap to reopen, or **+** to add it to the current set.
- **Compare my study:** photograph your sketch (on a phone or iPad, the picker offers the camera), then **square it up** by dragging four dots onto its corners, with a magnifier for precision. **Rotate 90°** fixes a sideways shot, and the result fits the reference's shape (or keeps the drawing's own with **As drawn**). **Compare** view shows the reference's value study beside yours through the *same* settings, with a second bar chart of your value balance. **Overlay** (`O`) lays your study on the reference at adjustable strength. **Correct paper to white** (on by default) undoes the gray cast phone photos give paper. In Compare view, the side-by-side sheet becomes a comparison sheet.
- **Present:** hides every control so only the image or images show, as large as the screen allows, for painting from the screen. It goes full screen where the browser allows and keeps the screen awake. Shortcuts still work; press `Esc` or `P`, or tap and choose **Exit presentation**, to bring the controls back.
- **Download** the study or the cropped original as PNG or JPG, with or without the grid, or a letter-size **side-by-side sheet** with the value scale.

**Timer (optional)**
- 30 seconds to 60 minutes, 1–5 rounds of the same image, and a break between rounds or paintings to turn the page.
- In a Master Copy session it moves through the queue automatically. A chime plays at the end of each round, and the screen stays awake while the timer runs.
- **Memory mode** (`M`, or **Memory** in the timer): each round starts with a look of 15 seconds to 90 seconds, then the image is hidden while you draw from memory. It comes back when the round ends (and during the break) so you can compare. **Peek at the reference** shows it again if you're stuck; that round then counts as a regular timed round. It works with rounds, breaks and timed sessions, and the Log counts memory rounds separately.
- **Staged reveal** (**Reveal** in the toolbar, or `R`): commit to the big masses first. The study shows 2 values, then 3, then the full image. Tap the image, the button or `R` to step; one more step after the full image (or **End**, or `Esc`) brings back your own view and settings, which the reveal never saves over. It keeps Grayscale or Color as you have it (Main colors steps in grayscale). In the timer, **Reveal** (2 → 3 → full, 2 → 3 → 4 → full, or 2 → 4 → 6 → full) spreads the stages evenly over each drawing round, with a soft chime at each step; tapping can still move ahead, and the break shows your usual view to compare. Reveal and Memory mode are one or the other.

Keyboard: `G` grid, `L` composition guides, `F` flip, `V` view, `C` crop, `T` timer, `K` cycle grayscale / color / main colors, `P` present, `O` overlay my study, `S` add to set, `M` memory mode, `R` staged reveal, `0` all values, `2`–`6` number of values, `Space` start/pause.

Settings, study sets, history, the session list and a practice log (which images you studied, on which days, for how long, and completed timed rounds) are remembered in this browser (uploaded photos are stored too). They don't sync between devices; use Export / Import to move a set. Some browsers clear a site's storage after long disuse (Safari after about 7 days without visiting), so export sets you care about, or add the site to your Home Screen.

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
- `js/warp.js`, `js/squareup.js`: perspective correction and the square-up screen for study photos
- `js/timer.js`: countdown, chime, screen wake lock
- `js/presets.js`: built-in and saved presets, and rendering an image with a preset
- `js/log.js`: the practice log (records study time and timed rounds per day)
- `js/library.js`: study sets and history (localStorage, with uploaded photos in IndexedDB)
- `js/museum.js`: museum collection search for all six museums (more sources can be added here)
- `data/nga-paintings.json`, `tools/build_nga_index.py`: the National Gallery of Art paintings index and the script that builds it
- `js/config.js`: site settings (the image relay address)
- `relay/`: the Cloudflare image relay and its setup steps (`node tests/relay-dev.mjs` runs it locally)
- `js/app.js`: the interface

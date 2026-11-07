# Value Study

A browser-based practice tool for painters. It turns any reference into simplified value and color studies, and runs timed master-copy sessions from public-domain museum paintings. See [PLAN.md](PLAN.md) for the full plan and roadmap.

Inspired by [Proko's value tool](https://www.proko.com/values) and the [Massa Art drawing timer](https://drawingtimer.com/). It builds on their ideas, not their design.

## What's in v1

**Two modes**
- **Reference:** choose, drop or paste an image, or load one from a link.
- **Master Copy:** search public-domain paintings by artist or subject across the **Art Institute of Chicago**, **The Met** and the **Cleveland Museum of Art**, or pick one museum with the **Museum** filter. Study a painting, or build a timed session from several. The Met and Cleveland need the free image relay; see [Museum image relay](#museum-image-relay).

**Study tools (both modes)**
- **Color:** Grayscale, Color, or Main colors.
- **Number of values** (Grayscale or Color): **All** (the full range) or 2–6 values (2 is notan). In Color the hues stay and only the values are flattened, for a color poster study.
- **Main colors:** repaints the image with the 2–8 colors that best summarize it.
- **Value bar chart:** a bar for each value (or main color) shows how much of the picture it covers, with the largest highlighted, so you can see at a glance which value dominates. It also appears on the side-by-side sheet.
- **Value splits:** drag the splits on the histogram or the sliders, use **Fit to image** to find natural breaks, or **Even** to reset.
- **Paint each value as:** the **average** of each area (the default, true to the image's light key), **even steps** from dark to light (most contrast), or **custom**, which starts from the averages so you can adjust each value to match your markers (0 = black, 10 = white).
- **Squint (blur)**, **Flip**, and a **grid** (any columns × rows, square cells, diagonals, black/white/red).
- **Crop** with canvas-size presets (5×7 to 36×48, panoramic 12×24 and 18×36, square, original), portrait or landscape, or **Custom size**: type your canvas's width × height (any unit, decimals allowed) and the crop locks to those proportions. Your last custom size is remembered.
- **Present:** hides every control so only the image or images show, as large as the screen allows, for painting from the screen. It goes full screen where the browser allows and keeps the screen awake. Shortcuts still work; press `Esc` or `P`, or tap and choose **Exit presentation**, to bring the controls back.
- **Download** the study or the cropped original as PNG or JPG, with or without the grid, or a letter-size **side-by-side sheet** with the value scale.

**Timer (optional)**
- 30 seconds to 60 minutes, 1–5 rounds of the same image, and a break between rounds or paintings to turn the page.
- In a Master Copy session it moves through the queue automatically. A chime plays at the end of each round, and the screen stays awake while the timer runs.

Keyboard: `G` grid, `F` flip, `V` view, `C` crop, `T` timer, `K` cycle grayscale / color / main colors, `P` present, `0` all values, `2`–`6` number of values, `Space` start/pause.

Settings and the session queue are remembered in your browser.

## Running it

No install or build step. Either:
- open `index.html` in a browser, or
- serve the folder: `python3 -m http.server 8000`, then visit http://localhost:8000

**To publish it free on GitHub Pages:** in the repository's Settings → Pages, choose *Deploy from a branch*, pick `main` and `/ (root)`, and save. The site appears at `https://<username>.github.io/jsa-art-tools/`.

## Notes and limits

- **Loading from a link** only works when the other site allows its images to be used by other pages. Many don't. Saving the image and choosing it, or copying and pasting it, always works.
- **Museum coverage** depends on what each museum holds and has released as public domain. "Paintings only" hides prints, drawings and photographs; turn it off to see everything.
- **MFA Boston** isn't included: it doesn't offer a public collection search for apps. Saving an image from its website and choosing it in Reference mode works.

## Museum image relay

The Met's and Cleveland's image servers don't let web pages read image pixels, which the value tools need, so their images pass through a small relay you run on Cloudflare's free plan. It only relays images from those museums' image servers. Setup takes about 10 minutes: see [relay/README.md](relay/README.md). Then put its address in `js/config.js`. Until then, the app uses only the Art Institute of Chicago, and the other two show "needs setup".
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
- `js/timer.js`: countdown, chime, screen wake lock
- `js/museum.js`: museum collection search: Art Institute of Chicago, The Met, Cleveland (more sources can be added here)
- `js/config.js`: site settings (the image relay address)
- `relay/`: the Cloudflare image relay and its setup steps (`node tests/relay-dev.mjs` runs it locally)
- `js/app.js`: the interface

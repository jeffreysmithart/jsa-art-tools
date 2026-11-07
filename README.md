# Value Study

A browser-based practice tool for painters. It turns any reference into simplified value and color studies, and runs timed master-copy sessions from public-domain museum paintings. See [PLAN.md](PLAN.md) for the full plan and roadmap.

Inspired by [Proko's value tool](https://www.proko.com/values) and the [Massa Art drawing timer](https://drawingtimer.com/). It builds on their ideas, not their design.

## What's in v1

**Two modes**
- **Reference:** choose, drop or paste an image, or load one from a link.
- **Master Copy:** search the Art Institute of Chicago's public-domain collection by artist or subject, study a painting, or build a timed session from several.

**Study tools (both modes)**
- **Grayscale or Color:** every study option works in either.
- **Simplify by Value:** **All** (the full range) or 2–6 values (2 is notan). In color, the hues stay and only the values are flattened, for a color poster study.
- **Simplify by Main colors:** the 2–8 colors that best summarize the image, shown in color or as their values.
- **Value splits:** drag the splits on the histogram or the sliders, use **Fit to image** to find natural breaks, or **Even** to reset.
- **Paint each value as:** even steps, the area's true average, or **custom** values to match your markers (0 = black, 10 = white).
- **Squint (blur)**, **Flip**, and a **grid** (any columns × rows, square cells, diagonals, black/white/red).
- **Crop** with canvas-size presets (5×7 to 24×36, square, original), portrait or landscape.
- **Download** the study or the cropped original as PNG or JPG, with or without the grid, or a letter-size **side-by-side sheet** with the value scale.

**Timer (optional)**
- 30 seconds to 60 minutes, 1–5 rounds of the same image, and a break between rounds or paintings to turn the page.
- In a Master Copy session it moves through the queue automatically. A chime plays at the end of each round, and the screen stays awake while the timer runs.

Keyboard: `G` grid, `F` flip, `V` view, `C` crop, `T` timer, `K` grayscale/color, `0` all values, `2`–`6` number of values, `Space` start/pause.

Settings and the session queue are remembered in your browser.

## Running it

No install or build step. Either:
- open `index.html` in a browser, or
- serve the folder: `python3 -m http.server 8000`, then visit http://localhost:8000

**To publish it free on GitHub Pages:** in the repository's Settings → Pages, choose *Deploy from a branch*, pick `main` and `/ (root)`, and save. The site appears at `https://<username>.github.io/jsa-art-tools/`.

## Notes and limits

- **Loading from a link** only works when the other site allows its images to be used by other pages. Many don't. Saving the image and choosing it, or copying and pasting it, always works.
- **Museum coverage** depends on what the Art Institute of Chicago holds and has released as public domain. "Paintings only" hides prints, drawings and photographs; turn it off to see everything.
- **Value numbers** are CIE L\* ÷ 10, close to the Munsell value scale. Marker brands number their grays differently, so use **Custom** to type the values your markers actually have.

## Tests

```sh
node --test tests/*.test.js          # image-processing unit tests
python3 -m http.server 8765 &        # then, with Playwright installed:
node tests/smoke.e2e.js              # browser test of both modes (museum responses are simulated)
```

## Files

- `index.html`, `css/app.css`: the page
- `js/color.js`: color and value math (sRGB ↔ CIE Lab)
- `js/process.js`: blur, value bands, main colors
- `js/crop.js`: crop tool and canvas presets
- `js/timer.js`: countdown, chime, screen wake lock
- `js/museum.js`: museum collection search (more sources can be added here)
- `js/app.js`: the interface

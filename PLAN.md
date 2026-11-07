# Value Study Tool: One-Page Plan

A browser-based practice tool for painters. It turns any reference image into simplified value and color studies, and runs timed master-copy sessions from public-domain museum collections. It is built for deliberate practice: big shapes and the light key first, before you can overthink it.

## Goals

- Practice seeing values quickly (gesture drawing, but for landscapes, portraits and florals).
- Prepare clean, simplified references for your own paintings.
- Study specific artists in depth from openly licensed collections.

## Two modes

**1. Master Copy mode (timed)**
- Pull images from open-access museum collections (Met, Art Institute of Chicago, Rijksmuseum, Cleveland Museum of Art, National Gallery of Art).
- Search by artist (e.g. Inness, Corot, Sargent) and save favorites into study sets.
- Built-in curated sets (e.g. Hudson River School, Tonalist landscapes, Dutch florals), optionally tagged by light key.
- Optional timer that advances through images, with session presets (e.g. 10 / 5 / 2 min).

**2. Reference mode (untimed by default)**
- Upload, drag-and-drop or paste an image; load from a URL where the host allows it.
- Crop with canvas-size presets (8×10, 9×12, 11×14, 12×16, 16×20, square, custom).
- Timer available but off by default.

## Shared value tools (both modes)

- Original and processed image side by side.
- Value grouping into 2–5+ values with adjustable cutoffs, in **grayscale or color** (simple grouping, or a dominant-color "poster" study).
- Notan (2-value) view with adjustable cutoff.
- Value bands that can match your marker set (e.g. N1/N3/N5/N7/N9).
- Blur/squint slider, horizontal flip, grid overlay toggle (3×3, 4×4, custom, diagonals).
- Download the result as PNG/JPG, plus an optional side-by-side print sheet.

## Practice features

- **Repetition rounds:** the same image at decreasing times (10, then 5, then 2 min).
- **Memory mode:** view for 30–60 seconds, hide the image, then draw.
- **Staged reveal:** 2 values, then 3, then the full image.
- **Compare:** photograph your sketchbook study and view it through the same value filter next to the master.
- **Session log:** what you studied and for how long.

## Roadmap

| Version | Scope | Rough effort |
|---|---|---|
| **v1** | Reference mode, crop presets, value grouping (gray and color), notan, blur, grid, flip, download, optional timer, 1–2 museum sources with artist search | 1–2 weeks |
| **v2** | More museums, saved study sets, compare-your-study, memory and staged-reveal exercises, session log | A few weeks, on and off |
| **v3** | Color gamut view (plot image colors on a color wheel); recolor into a limited palette (e.g. Prussian blue, yellow ocher, vermillion, black and white) using pigment-mixing simulation; flag colors the palette can't reach | A real project; scope separately |

## Technical approach

- Runs entirely in the browser (no server needed for v1); host free (e.g. GitHub Pages).
- Works well on an iPad or tablet beside the sketchbook.
- Image processing on the device; settings saved in the browser.
- URL loading may need a small fetch proxy later, since some sites block it; upload and paste always work.

## Risks and decisions

- **Pinterest:** dropped for now. Its developer access is restrictive and scraping breaks its terms. Museum collections and your own uploaded sets replace it.
- **Artist coverage:** varies with what each museum releases openly. Some painters (e.g. Edgar Payne) may have few open-access images, so uploaded sets fill the gap.
- **Pigment mixing (v3):** check the license of any color-mixing library before using it.
- **Originality:** match the *ideas* of the Proko value tool and Massa Art timer, not their design or branding.

## First step for a build session

Start with Reference mode and the value tools (upload, crop, value grouping, grid, download); everything else builds on that.

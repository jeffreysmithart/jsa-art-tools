# Value Study: brief for a design and UX review

This brief is for a fresh review session. It lists what the app is for, the workflows it should support, every tool that has been built with the goal behind it, and the tensions noticed so far. The reviewer's job is to **make the good features work together and be discoverable**, and to propose other ways the tool could be used. It is **not** to add more color features.

Read [README.md](../../README.md) for how each control works and [PLAN.md](../../PLAN.md) for the working notes: environment, tests, working style and design principles. This brief doesn't repeat those.

## Who it's for

- **The owner:** a working painter, mostly landscapes, en plein air and in the studio. He uses an **iPad** (at the easel, touch) and a **Mac** (planning, studying), sometimes an iPhone.
- **The way he paints:**
  - deliberate practice: big shapes and the light key first, value before color;
  - master copies of painters he admires (Edgar Payne, George Inness, Scott Christensen, Richard Schmid and others);
  - limited and unconventional palettes, e.g. a secondary triad of phthalo green, dioxazine violet and cadmium orange, where he has to work out what stands in for the missing primaries and let simultaneous contrast and glazing do some of the work.
- **Inspirations,** for ideas only and not design: Proko's value tool, the Massa Art drawing timer, and James Gurney's *Color and Light*, for gamut masks.

## The intended workflows

Each is a hypothesis about how the tools combine. The interview should confirm or correct them.

1. **Quick value practice (gesture drawing for values):**
   - Load a reference (upload, museum search or a study set).
   - Pick 2–4 values or a preset, and start the timer with rounds, perhaps shorter each round, or memory mode.
   - Paint thumbnails.
   - The Log records it.
2. **Preparing a reference for a painting:**
   - Upload a photo and crop it to the canvas size.
   - Look at the value study, squinted, and adjust the splits.
   - Add a grid or composition guides to check or transfer the design.
   - Download the study, the original and the side-by-side sheet.
   - Paint from the screen in **Present** mode, or from a print.
3. **Master copy sessions:**
   - Search museums for an artist and queue paintings into a study set.
   - Run a timed session through the set, with breaks.
   - Use **Try presets** on the set to see the whole set at, say, 3 values.
4. **Checking my study against the reference:**
   - Photograph the sketch and square it up with four corners.
   - **Compare** and **Overlay** it against the reference, through the same value settings.
   - The value bars show where the light key is off.
5. **Staged commitment:** **Reveal** steps 2 values → 3 → full image, by tap or over a timed round, so the big masses are committed first.
6. **Understanding a picture's color:**
   - Use the Color tab's 3D color space, and tap a color to see where it is in the picture.
   - Read Munsell notation, and the main hue, strength, share near gray and value range.
7. **Choosing a limited palette for a painting:**
   - Pick a preset, an artist's palette or your own.
   - Read how much of the picture it can mix and what it can't.
   - Use the paints to add or drop, and **Compare palettes** across all palettes.
   - Check the gamut overlap wheel (all values or darks, middles, lights).
   - Look at what stands in for each hue, and use the contrast check.
   - Paint the study with the palette (Palette tone).
   - Save it as your own palette.
8. **Designing a color scheme (gamut mask):**
   - Pick and shape a mask on the wheel, and see how the picture fits.
   - Paint the study inside the mask (values kept).
   - Find paints for the mask: suggestions, and **Build a palette for this mask**, for the picture in it or for the whole mask, even with no image.
   - Show your palette's range on the mask wheel.
   - Save the mask.
9. **Across devices:** turn on Sync, or join by QR code. Sets, presets, palettes, masks, history, the log, own photos and crops follow you between the iPad and the Mac.

## What has been built, and why

Grouped by where it lives. "Origin" is the reason it was asked for, as the building sessions understood it.

### Always on screen: the image area and toolbar
| Tool | Goal / origin |
|---|---|
| View switcher: Both, Study, Original, Compare | See the study beside the reference, alone, or beside my own study |
| Crop, with canvas presets and custom sizes; each image keeps its crop (synced) | Match the reference to the canvas proportions |
| Flip, Grid, composition guides (`L`) | Fresh eyes on the design; transfer to the canvas |
| **+ Set** | Collect references while browsing |
| **Reveal** (staged 2 → 3 → full) | Commit to big masses first |
| **Present** | Paint from the screen: nothing but the image, screen kept awake |
| **Timer:** rounds, shorter each round, breaks, Practice menu (memory mode, reveal per round), sessions through a set | Massa-style timed practice; memory drawing; master copy sessions |
| Value bar chart, swatches, histogram with draggable splits | See the light key and which value dominates |
| Keyboard shortcuts (Canvas tab lists them) | Speed on the Mac |

### Images tab
| Tool | Goal / origin |
|---|---|
| Upload (choose, drop, paste, link) | Own references |
| Museum search across six museums (AIC, Met, NGA, Mia, Cleveland, London), "Paintings only"; image relay for three | Open-access master paintings to copy |
| Study sets: create, rename, export/import, timed session, **Try presets** | Curated practice material; replaces Pinterest boards |
| History (last 60) | Get back to recent images |
| **Sync**: code, QR code, status, stop, delete synced copy | iPad ↔ Mac; protects against Safari clearing storage |

### Study tab
| Tool | Goal / origin |
|---|---|
| Presets: built-in, your own (synced), Save…, Delete | One-tap settings, like Lightroom presets. **They cover only study settings, not grid, crop, palette or mask.** |
| Color: Gray, Color, Main colors, Palette | Value study, color poster study, color simplification, limited-palette painting |
| Number of values (All, 2–6) | Notan up to 6 values |
| Squint | Simplify before judging |
| Value splits (Fit to image, Even, drag); Paint each value as (average, even steps, custom marker values) | Control where values break and what they're painted as, including matching marker sets |
| **Compare my study:** photo, square-up with magnifier, rotate, paper to white, Compare view, Overlay | Check a sketch against the reference |

### Color tab (the longest panel)
| Tool | Goal / origin |
|---|---|
| 3D color space (Munsell-style), large view (turn, zoom, value slice), tap a color to see where it is in the picture, exact Munsell notation | Understand a picture's color structure |
| Figures: main hue, strongest colors, near gray, value range | Quick read of the color key |
| **Limited palette:** menu (presets, two unconventional palettes, ten artists' palettes with sources, My palettes), paint chips, add a paint (51 paints) | Paint a picture with a chosen palette |
| Reach figures; **What stands in for each hue** (with **contrast check**); gamut overlap wheel (All, Darks, Middles, Lights); **Add for this picture / Least needed here**; Show it in the color space; Paint the study with this palette; **Compare palettes…** | Which palette fits this picture, and how to fix it. The owner said he finds the add/drop suggestions with percentages *super helpful*. |
| **Gamut mask:** shapes, drag, turn and reshape, size, saved masks (synced), picture's colors against the mask, Show my palette on the wheel, Paint the study inside the mask (strength), **Paints for this mask** (coverage, suggestions, Build a palette for the picture in it or the whole mask) | Gurney's gamut masks: choose a color scheme first, then find the paints |

### Canvas tab
| Tool | Goal / origin |
|---|---|
| Composition guides: thirds, golden section, diagonals and reciprocals, crossings; also shown in Crop | Design check, and framing photos |
| Grid: columns × rows, square cells, diagonals, color, opacity | Transfer to the canvas |
| Downloads: study, original, PNG/JPG, with grid, side-by-side or comparison sheet | Print or keep |
| Keyboard shortcuts list | Discoverability |

### Log tab
| Tool | Goal / origin |
|---|---|
| Time this week, streaks, month calendar, per-day detail (tap to reopen), memory rounds counted separately, CSV download | Motivation and a record of practice; syncs per device |

## Cross-cutting systems

- **Settings persistence:** almost every control is remembered locally. Settings don't sync, but sets, presets, palettes, masks, history, the log, photos and crops do.
- **Presets** cover study settings only. The Study tab refuses to save a preset while in Palette tone ("Presets don't include palettes yet").
- **Modes that change other controls:**
  - Reveal borrows the view, tone and values, and restores them afterward.
  - Turning on "Paint the study inside the mask" switches Grayscale to Color.
  - Palette tone hides the values controls.
  - Present hides everything.
- **Large views (modals):** crop, square-up, Try presets, the color space, Compare palettes.

## Tensions noticed so far

These are hypotheses for the reviewer to test, not decisions.

1. **The Color tab is very long.** In order, it holds: the color space, figures, the limited palette (menu, chips, add, reach, stand-ins with contrast check, overlap wheel, suggestions, buttons), then the gamut mask (shapes, saved masks, wheel, palette outline, size, note, Paints for this mask with suggestions and builder, study toggle, strength). On a phone this is a lot of scrolling, and the two wheels and two suggestion boxes look alike.
2. **"How the study looks" is spread across tabs.**
   - The Study tab sets tone and values.
   - The Color tab sets the palette and "paint inside the mask".
   - The Canvas tab sets the grid and guides.
   - Presets capture only the first.

   This is where the owner's idea of **broader presets / workflow modes** comes in: one choice that sets tone, values, palette, mask, grid and timer for, say, "Notan thumbnail", "Plein air limited palette" or "Master copy session".
3. **Features could be suppressed by mode:**
   - Is the 3D color space needed while doing value practice?
   - Are museum search and sets needed while painting?
4. **Discoverability:**
   - Several strong tools are behind buttons or taps that are easy to miss: Try presets, Compare palettes, tap a color in the large color space, tap a stand-in, Build.
   - Keyboard shortcuts are listed at the bottom of the Canvas tab.
5. **Two similar wheels:** the gamut overlap wheel (palette vs picture) and the mask wheel (mask vs picture, with the palette outline). Could they be one wheel with layers?
6. **Explanations live in many "How to read this" / "How it's worked out" boxes** of varying length.
7. **Touch:** the owner tests on an iPad. Controls are meant to be at least 44 px, and some dense rows (chips, segmented controls with four options) need checking at iPad and phone sizes.
8. **First run:** with no image loaded, what does a new visitor see and do first?

## Interview: questions for the owner

Ask these, one or two at a time, before auditing. Record his answers in the findings.

1. Walk through your most common session from opening the app to closing it. Which device, which tabs, which tools?
2. For each workflow above: is it right? What's missing or wrong? Which do you actually do weekly?
3. For each Color tab tool:
   - What did you hope it would let you do?
   - Does it?
   - Have you used it on a real painting yet?
4. Which tools have you not found, or forgotten exist?
5. What would a "mode" or broader preset mean to you? Name two or three you'd use.
6. Does anything get in the way at the easel, on the iPad, with paint on your hands?
7. Are there other people you'd want to use this (students, workshop attendees)? Would that change anything?
8. What would you remove if you had to?

## How to run the review

1. **Read** this brief, the README and PLAN.md.
2. **Interview** the owner, as above. Keep it conversational, and follow up on surprises.
3. **Use the app:**
   - Serve it locally: `python3 -m http.server 8765`.
   - Drive it with Playwright at iPad (1180 × 820 and portrait), Mac (1400 × 900) and phone (390 × 844) sizes.
   - Run each workflow with a real-looking reference; the smoke test builds one in the browser.
   - Take screenshots at `deviceScaleFactor: 2`, written outside the repo.
   - The owner's UI review skills (`emil-ui-review` and others) are useful if installed in the session. They're paid, per-user content and not in this repo; see PLAN.md.
4. **Audit against the workflows and the owner's answers:**
   - discoverability;
   - flow between tabs;
   - what each mode needs on screen;
   - consistency;
   - touch and phone layout;
   - first run;
   - the design principles in PLAN.md (true neutral grays, OKLCH tokens, APCA contrast, 44 px touch targets).
5. **Write findings** to `docs/ux-review/FINDINGS.md`:
   - Ranked by impact.
   - Each with the workflow it affects, what's wrong, and a concrete proposal, with mockup screenshots where helpful.
   - Separate "quick wins" from "structural changes" (modes, merging wheels, reorganizing tabs).
   - Include **new ways the tool could be used** that the existing features already make possible.
6. **Don't change the app in the review session.** Agree the plan with the owner first; then each change goes in its own pull request, per PLAN.md's working style.

## Where things are in the code

- **The page and tabs:** `index.html`. Sidebar panels: `#panel-images`, `#panel-study`, `#panel-color`, `#panel-canvas`, `#panel-log`.
- **Styles:** `css/app.css`.
- **App logic:** `js/app.js`, a single file of about 4,500 lines, grouped by headed sections.
- **Modules:**
  - `js/palette.js`: mixing, reach, suggestions, builder, stand-ins;
  - `js/mask.js`: gamut masks;
  - `js/overlap.js`: wheels;
  - `js/colorspace.js` and `js/munsell.js`: color space and notation;
  - `js/presets.js`: presets;
  - `js/saved.js`: your palettes and masks;
  - `js/sync*.js`: sync.
- **Tests:** `node --test tests/*.test.js tests/*.test.mjs` (118 unit tests), and `node tests/smoke.e2e.js` (the browser test, which needs the local server).

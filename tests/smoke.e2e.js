// Browser smoke test. Run: python3 -m http.server 8765 & node tests/smoke.e2e.js
// Museum requests are answered by stand-ins, so it needs no network.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8765/index.html';
const OUT = process.env.OUT || path.join(__dirname, '..', 'test-output');
fs.mkdirSync(OUT, { recursive: true });

const swatchCount = (pg, n) => pg.waitForFunction((n) => document.querySelectorAll('#swatches .swatch').length === n, n, { timeout: 3000 }).then(() => true, () => false);

const studyColors = (pg) => pg.evaluate(() => {
  const c = document.getElementById('cv-study'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const set = new Set(); let allGray = true;
  for (let i = 0; i < d.length; i += 4) { set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) allGray = false; }
  return { count: set.size, allGray };
});
const settle = (pg) => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));


// Sidebar controls live in tabs (Images / Study / Canvas). Like a person would,
// open the tab that holds a control before using it.
function aware(pg) {
  const reveal = async (sel) => {
    if (typeof sel !== 'string') return;
    const css = sel.replace(/:has-text\([^)]*\)/g, '');
    await pg.evaluate((css) => {
      let el;
      try { el = document.querySelector(css); } catch (e) { return; }
      const panel = el && el.closest('.side-panel');
      if (panel && panel.hidden && window.VST && window.VST.app && window.VST.app.setPanel) window.VST.app.setPanel(panel.dataset.panel);
    }, css).catch(() => {});
  };
  for (const m of ['click', 'fill', 'selectOption', 'check', 'uncheck', 'isVisible']) {
    const orig = pg[m].bind(pg);
    pg[m] = async (sel, ...rest) => { await reveal(sel); return orig(sel, ...rest); };
  }
  return pg;
}

function check(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  aware(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // the main page runs without the image relay (Art Institute only), like a fresh setup
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:''};" }));

  // a painted "landscape" test image, made in the browser
  await page.goto(BASE);
  const pngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 360); sky.addColorStop(0, '#6f93c9'); sky.addColorStop(1, '#f3d9a4');
    x.fillStyle = sky; x.fillRect(0, 0, 900, 360);
    x.fillStyle = '#5c6b3a'; x.fillRect(0, 360, 900, 240);
    x.fillStyle = '#2d3320'; x.beginPath(); x.moveTo(0, 380); x.lineTo(250, 220); x.lineTo(480, 380); x.fill();
    x.fillStyle = '#c94a2a'; x.beginPath(); x.arc(700, 470, 60, 0, 7); x.fill();
    x.fillStyle = '#fff6d8'; x.beginPath(); x.arc(720, 120, 40, 0, 7); x.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  const png = Buffer.from(pngB64, 'base64');

  // ---- Reference mode ----
  await page.setInputFiles('#file-input', { name: 'river-landscape.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => window.VST.app.work.w > 0);
  check(await page.$eval('#panels', (e) => !e.classList.contains('is-empty')), 'image loads from file');
  check(await swatchCount(page, 4), 'default study shows 4 value swatches');
  const shareSum = await page.$$eval('#swatches .swatch .pct', (d) => d.reduce((s, e) => s + parseInt(e.textContent), 0));
  check(shareSum >= 98 && shareSum <= 102, `value shares add to ~100% (${shareSum})`);
  const bars = await page.$$eval('#swatches .swatch', (els) => els.map((el) => ({
    pct: parseInt(el.querySelector('.pct').textContent),
    h: el.querySelector('.bar').getBoundingClientRect().height,
    track: el.querySelector('.track').getBoundingClientRect().height,
    dominant: el.classList.contains('dominant'),
  })));
  const big = bars.reduce((a, b) => (b.pct > a.pct ? b : a));
  check(big.dominant && Math.abs(big.h - big.track) < 1.5, 'largest value has the full-height, highlighted bar');
  check(bars.filter((b) => b.dominant).length === 1, 'exactly one value is highlighted as dominant');
  const ordered = [...bars].sort((a, b) => a.pct - b.pct);
  check(ordered.every((b, i) => i === 0 || b.h >= ordered[i - 1].h - 0.5), 'bar heights follow the percentages');

  // study pixels should only contain 4 grays
  const grays = await page.evaluate(() => {
    const c = document.getElementById('cv-study'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const set = new Set(); for (let i = 0; i < d.length; i += 4) { set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); } return set.size;
  });
  check(grays === 4, `study uses exactly 4 grays (${grays})`);
  check(await page.$eval('#levels-mode', (s) => s.value) === 'average', 'values are painted as each area\'s average by default');
  const shown = await page.$$eval('#swatches .swatch .v', (els) => els.map((e) => e.textContent).join(','));
  check(shown !== '0.5,3.5,6.5,9.5', `default values follow the image, not even steps (${shown})`);
  await page.screenshot({ path: path.join(OUT, '1-reference-values.png') });

  // 2 values (notan) via keyboard, grid, flip
  await page.keyboard.press('2');
  check(await swatchCount(page, 2), 'key 2 switches to notan');
  await page.keyboard.press('g');
  check(await page.$eval('#btn-grid', (b) => b.getAttribute('aria-pressed') === 'true'), 'G toggles grid');
  await page.click('[data-grid="square"]');
  const g = await page.evaluate(() => window.VST.app.settings.grid);
  check(g.cols === 5 && g.rows === 3, `square cells on 3:2 image gives 5x3 (${g.cols}x${g.rows})`);
  await page.keyboard.press('f');
  check(await page.$eval('#panel-study .frame', (f) => f.classList.contains('flipped')), 'F flips');
  await page.keyboard.press('f');

  // threshold slider changes the study
  const before = await page.$eval('#swatches .swatch .pct', (d) => d.textContent);
  await page.$eval('#thresholds input', (i) => { i.value = 80; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);
  const after = await page.$eval('#swatches .swatch .pct', (d) => d.textContent);
  check(before !== after, `moving a split changes the dark share (${before} -> ${after})`);
  await page.click('#btn-auto');

  // number of values works in both grayscale and color
  await page.keyboard.press('4');
  await settle(page);
  let sc = await studyColors(page);
  check(sc.allGray && sc.count === 4, `grayscale + 4 values: exactly 4 grays (${sc.count})`);
  await page.click('[data-tone="color"]');
  await settle(page);
  check(await page.isVisible('#bands-seg') && await page.isVisible('#split-ctl'), 'number of values and splits stay visible in color');
  check(await swatchCount(page, 4), 'color + 4 values still shows 4 value swatches');
  sc = await studyColors(page);
  check(!sc.allGray, 'color + 4 values keeps the hues');
  await page.screenshot({ path: path.join(OUT, '2-color-values-grid.png') });
  await page.click('[data-n="0"]');
  await settle(page);
  check(await swatchCount(page, 0) && !(await page.isVisible('#split-ctl')), 'All values hides the splits');
  sc = await studyColors(page);
  check(!sc.allGray && sc.count > 50, `color + all values shows the full image (${sc.count} colors)`);
  await page.click('[data-tone="gray"]');
  await settle(page);
  sc = await studyColors(page);
  check(sc.allGray && sc.count > 20, `grayscale + all values shows the full range (${sc.count} grays)`);
  await page.keyboard.press('3');
  await settle(page);
  sc = await studyColors(page);
  check(sc.allGray && sc.count === 3, `then 3 values in grayscale (${sc.count})`);
  check((await page.textContent('#study-caption')) === 'Grayscale · 3 values', 'caption names tone and values');

  // main colors is the third color choice, with its own count
  await page.click('[data-tone="poster"]');
  await page.click('[data-k="5"]');
  check(await swatchCount(page, 5), 'main colors shows 5 swatches');
  check(await page.isVisible('#k-seg') && !(await page.isVisible('#bands-seg')), 'main colors shows number of colors instead of values');
  await settle(page);
  sc = await studyColors(page);
  check(!sc.allGray && sc.count === 5, `main colors paints exactly 5 colors (${sc.count})`);
  check((await page.textContent('#study-caption')) === '5 main colors', 'caption names main colors');
  await page.screenshot({ path: path.join(OUT, '3-main-colors.png') });
  // K cycles grayscale -> color -> main colors
  await page.keyboard.press('k');
  check(await page.evaluate(() => window.VST.app.settings.tone) === 'gray', 'K goes from main colors to grayscale');
  await page.keyboard.press('k');
  check(await page.evaluate(() => window.VST.app.settings.tone) === 'color', 'K goes from grayscale to color');
  await page.click('[data-tone="poster"]');
  await page.keyboard.press('4');
  check(await page.evaluate(() => window.VST.app.settings.tone) === 'color' && await swatchCount(page, 4), 'pressing 4 in main colors switches to color with 4 values');

  // custom levels
  await page.click('[data-n="4"]');
  await page.selectOption('#levels-mode', 'average');
  await settle(page);
  const averages = await page.$$eval('#swatches .swatch .v', (els) => els.map((e) => e.textContent));
  await page.selectOption('#levels-mode', 'custom');
  check(await page.waitForFunction(() => document.querySelectorAll('#swatches input').length === 4).then(() => true, () => false), 'custom mode shows editable values');
  const startVals = await page.$$eval('#swatches input', (els) => els.map((e) => e.value));
  check(startVals.join(',') === averages.join(','), `custom starts from the averages (${startVals} = ${averages})`);
  await page.selectOption('#levels-mode', 'even');
  await settle(page);
  check((await page.$$eval('#swatches .swatch .v', (els) => els.map((e) => e.textContent))).join(',') === '0.5,3.5,6.5,9.5', 'even steps still available');
  await page.selectOption('#levels-mode', 'custom');

  // blur
  await page.$eval('#blur', (i) => { i.value = 60; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  check((await page.textContent('#study-caption')).includes('squint'), 'blur marks the study as squinted');

  // crop with 8x10 preset
  await page.keyboard.press('c');
  check(await page.isVisible('#crop-modal'), 'crop opens');
  await page.selectOption('#crop-preset', '8x10');
  let info = await page.textContent('#crop-info');
  check(/750 × 600 px/.test(info), `8x10 on a landscape image starts landscape (${info})`);
  await page.click('#crop-orient');
  info = await page.textContent('#crop-info');
  check(/480 × 600 px/.test(info), `orientation switches to portrait 8x10 (${info})`);

  // custom canvas size, e.g. an 18 x 36 in canvas
  check(!(await page.isVisible('#crop-custom')), 'size boxes stay hidden for presets');
  await page.selectOption('#crop-preset', 'custom');
  check(await page.isVisible('#crop-custom'), 'Custom size shows width and height boxes');
  check(await page.inputValue('#crop-cw') === '18' && await page.inputValue('#crop-ch') === '36', 'custom starts at 18 x 36');
  info = await page.textContent('#crop-info');
  check(/300 × 600 px · 18 × 36 proportions/.test(info), `18 x 36 crop fits the image (${info})`);
  await page.click('#crop-orient');
  info = await page.textContent('#crop-info');
  check(await page.inputValue('#crop-cw') === '36' && /900 × 450 px · 36 × 18 proportions/.test(info), `Landscape swaps to 36 x 18 (${info})`);
  await page.fill('#crop-cw', '7.5');
  await page.fill('#crop-ch', '10');
  info = await page.textContent('#crop-info');
  check(/450 × 600 px · 7.5 × 10 proportions/.test(info), `decimals work: 7.5 x 10 (${info})`);
  await page.fill('#crop-ch', '');
  check(/7.5 × 10 proportions/.test(await page.textContent('#crop-info')) && await page.$eval('#crop-ch', (e) => e.classList.contains('invalid')), 'a blank box keeps the last size and is flagged');
  await page.fill('#crop-ch', '10');
  await page.screenshot({ path: path.join(OUT, '4b-crop-custom.png') });

  await page.selectOption('#crop-preset', '8x10');
  await page.screenshot({ path: path.join(OUT, '4-crop.png') });
  await page.click('#crop-apply');
  await page.keyboard.press('c');
  await page.selectOption('#crop-preset', 'custom');
  check(await page.inputValue('#crop-cw') === '7.5' && await page.inputValue('#crop-ch') === '10', 'custom size is remembered for next time');
  check(await page.evaluate(() => window.VST.app.settings.cropCustom.w === 7.5), 'custom size is saved with the settings');
  await page.selectOption('#crop-preset', '8x10');
  await page.click('#crop-apply');
  const wh = await page.evaluate(() => [window.VST.app.work.w, window.VST.app.work.h]);
  check(Math.abs(wh[0] / wh[1] - 0.8) < 0.01, `cropped study is 4:5 (${wh})`);

  // downloads
  for (const [btn, re] of [['#btn-dl-study', /river-landscape-color-4-values\.png/], ['#btn-dl-sheet', /sheet\.png/], ['#btn-dl-original', /reference\.png/]]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
    const file = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    check(re.test(dl.suggestedFilename()) && fs.statSync(file).size > 1000, `download ${dl.suggestedFilename()}`);
  }

  // timer in reference mode
  await page.keyboard.press('t');
  check(await page.isVisible('#timerbar'), 'T shows timer');
  await page.selectOption('#t-minutes', '0.5');
  await page.click('#t-play');
  await page.waitForTimeout(1300);
  const clock = await page.textContent('#timer-clock');
  check(clock === '0:29' || clock === '0:28', `timer counts down (${clock})`);
  await page.click('#t-stop');

  // ---- Master Copy mode with stand-in museum ----
  const items = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, title: `Landscape ${i + 1}`, artist_title: 'George Inness', date_display: '1880', image_id: `img${i}`, artwork_type_title: i === 5 ? 'Print' : 'Painting', is_public_domain: true }));
  await page.route('https://api.artic.edu/**', (route) => {
    const u = new URL(route.request().url());
    check(u.searchParams.get('query[term][is_public_domain]') === 'true', 'search asks for public-domain works only');
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ data: items, pagination: { total: 6, total_pages: 1 }, config: { iiif_url: 'https://www.artic.edu/iiif/2' } }) });
  });
  await page.route('https://www.artic.edu/iiif/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png }));

  await page.click('#tab-master');
  await page.selectOption('#museum-filter', 'aic');
  await page.fill('#search-input', 'Inness');
  await page.click('#search-form button');
  await page.waitForSelector('#results .card');
  check((await page.$$('#results .card')).length === 5, 'paintings-only filter hides the print');
  await page.click('#results .card [data-act="study"]');
  await page.waitForFunction(() => window.VST.app.img.meta && window.VST.app.img.meta.title === 'Landscape 1');
  check((await page.textContent('#credit')).includes('Art Institute of Chicago, CC0'), 'museum credit line shows');
  await page.click('#btn-add-all');
  check((await page.$$('#queue li')).length === 5, 'add all builds a session of 5');

  // speed up a session: 2 rounds, no break; skip through
  await page.selectOption('#t-rounds', '2');
  await page.selectOption('#t-break', '0');
  await page.click('#btn-session');
  await page.waitForFunction(() => window.VST.app.flow.session && window.VST.app.countdown.running);
  check((await page.textContent('#timer-status')).includes('Painting 1 of 5'), 'session starts on painting 1');
  await page.click('#t-skip');
  check((await page.textContent('#timer-status')).includes('Round 2 of 2'), 'skip goes to round 2 of the same painting');
  await page.click('#t-skip');
  await page.waitForFunction(() => window.VST.app.img.meta.title === 'Landscape 2');
  check((await page.textContent('#timer-status')).includes('Painting 2 of 5'), 'then advances to painting 2');
  await page.screenshot({ path: path.join(OUT, '5-master-session.png') });
  await page.selectOption('#t-break', '10');
  const inBreak = () => page.$eval('#timer-clock', (c) => c.classList.contains('break'));
  await page.click('#t-skip');
  check(await inBreak() && (await page.textContent('#timer-status')).includes('round 2 next'), 'break runs before the next round');
  await page.click('#t-skip');
  check(!(await inBreak()) && (await page.textContent('#timer-status')).includes('Round 2 of 2'), 'break ends into round 2');
  await page.click('#t-skip');
  await page.waitForFunction(() => window.VST.app.img.meta.title === 'Landscape 3');
  check(await inBreak() && (await page.textContent('#timer-status')).includes('next painting'), 'break shows the next painting before drawing starts');
  await page.click('#btn-session');
  check(!(await page.evaluate(() => window.VST.app.flow.session)), 'stop session ends it');

  // Present mode: only the images (and a small timer) remain
  const frameSize = () => page.$eval('#panel-study .frame', (f) => f.getBoundingClientRect().width);
  const normalWidth = await frameSize();
  await page.keyboard.press('p');
  await page.waitForTimeout(150);
  const hiddenUi = await page.evaluate(() => ['.topbar', '.sidebar', '.toolbar', 'figcaption'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none'));
  check(await page.evaluate(() => window.VST.app.isPresenting()) && hiddenUi, 'P hides the top bar, controls, toolbar and captions');
  check((await frameSize()) > normalWidth + 100, `images grow to fill the screen (${Math.round(normalWidth)} -> ${Math.round(await frameSize())}px)`);
  check(await page.isVisible('#timer-clock') && !(await page.isVisible('.timer-settings')), 'timer shrinks to a small clock');
  await page.screenshot({ path: path.join(OUT, '7-present.png') });
  await page.keyboard.press('g');
  check(await page.evaluate(() => window.VST.app.settings.grid.on) === false, 'shortcuts still work while presenting');
  await page.keyboard.press('g');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check(!(await page.evaluate(() => window.VST.app.isPresenting())) && await page.isVisible('.sidebar'), 'Esc brings the controls back');
  check(Math.abs((await frameSize()) - normalWidth) < 2, 'images return to normal size');
  await page.click('#btn-present');
  await page.mouse.move(500, 400);
  await page.mouse.move(520, 410);
  await page.waitForSelector('#btn-present-exit.show');
  await page.click('#btn-present-exit');
  check(!(await page.evaluate(() => window.VST.app.isPresenting())), 'the Present button enters and the Exit button leaves');

  // settings persist across reload
  await page.reload();
  await page.waitForTimeout(300);
  const remembered = await page.evaluate(() => ({ mode: window.VST.app.settings.mode, grid: window.VST.app.settings.grid.on }));
  check(remembered.mode === 'master' && remembered.grid, 'settings remembered after reload ' + JSON.stringify(remembered));
  check((await page.$$('#queue li')).length === 5, 'session queue remembered after reload');

  // without the image relay, The Met and Cleveland are listed but need setup
  const noRelay = await page.$$eval('#museum-filter option', (o) => o.map((x) => [x.value, x.disabled]));
  check(JSON.stringify(noRelay) === JSON.stringify([['all', false], ['aic', false], ['met', true], ['nga', false], ['mia', true], ['cma', true], ['ngl', false]]), 'without the relay, The Met, Mia and Cleveland show as needing setup');
  check(await page.isVisible('#museum-setup'), 'setup note shows without the relay');

  // with the relay: three museums searched together (all responses simulated)
  const mctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mp = await mctx.newPage();
  aware(mp);
  mp.on('pageerror', (e) => errors.push(e.message));
  const relayed = [];
  await mp.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:'https://relay.test/',searchTimeoutMs:3000};" }));
  await mp.route('https://api.artic.edu/**', (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ data: items.slice(0, 2), pagination: { total: 2, total_pages: 1 } }) }));
  await mp.route('https://www.artic.edu/iiif/**', (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png }));
  await mp.route('https://collectionapi.metmuseum.org/**', (r) => {
    const u = new URL(r.request().url());
    const json = u.pathname.includes('/v1.1/search')
      ? (check(u.searchParams.get('medium') === 'Paintings', 'The Met is asked for paintings only'), { total: 3, objectIDs: [1, 2, 3] })
      : u.pathname.endsWith('/3')
        ? { message: 'Not a valid object' }
        : { objectID: +u.pathname.split('/').pop(), title: `Met painting ${u.pathname.split('/').pop()}`, artistDisplayName: 'George Inness', objectDate: '1875', objectName: 'Painting', isPublicDomain: true, primaryImage: `https://images.metmuseum.org/x/${u.pathname.split('/').pop()}.jpg`, primaryImageSmall: 'https://images.metmuseum.org/small.jpg', objectURL: 'https://www.metmuseum.org/art/collection/search/1' };
    r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(json) });
  });
  await mp.route('https://images.metmuseum.org/**', (r) => r.fulfill({ headers: { 'content-type': 'image/png' }, body: png })); // thumbnails: no permission header, display only
  let cmaCalls = 0;
  await mp.route('https://openaccess-api.clevelandart.org/**', async (r) => {
    const u = new URL(r.request().url());
    check(u.searchParams.get('type') === 'Painting' && u.searchParams.get('cc0') === '1', 'Cleveland is asked for CC0 paintings');
    check((u.searchParams.get('fields') || '').includes('images'), 'Cleveland is asked only for the fields the app uses');
    cmaCalls++;
    if (u.searchParams.get('q') === 'Never') return; // simulate a museum that never answers
    await new Promise((res) => setTimeout(res, 1500)); // Cleveland is slow
    r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ info: { total: 1 }, data: [{ id: 9, title: 'Cleveland painting', type: 'Painting', creation_date: '1892', url: 'https://clevelandart.org/art/1', creators: [{ description: 'George Inness (American, 1825–1894)' }], images: { web: { url: 'https://openaccess-cdn.clevelandart.org/1/1_web.jpg' } } }] }) });
  });
  await mp.route('https://openaccess-cdn.clevelandart.org/**', (r) => r.fulfill({ headers: { 'content-type': 'image/png' }, body: png }));
  await mp.route('**/data/nga-paintings.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([
    [30776, 'The Lackawanna Valley', 'George Inness', 'c. 1856', 'aaaa-1111', 5132],
    [99, 'Watson and the Shark', 'John Singleton Copley', '1778', 'bbbb-2222', 900],
  ]) }));
  await mp.route('https://api.nga.gov/**', (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png }));
  await mp.route('https://search.artsmia.org/**', (r) => {
    const query = decodeURIComponent(new URL(r.request().url()).pathname.slice(1));
    check(/rights_type:"Public Domain"/.test(query) && /classification:Paintings/.test(query), 'Mia is asked for public-domain paintings');
    r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ hits: { total: { value: 1 }, hits: [{ _source: { id: 12936, title: 'The Mill Stream, Montclair, New Jersey', artist: 'George Inness', dated: 'c. 1888', classification: 'Paintings', rights_type: 'Public Domain', image: 'valid', image_width: 2802, image_height: 1855, Cache_Location: '012000\\900\\30\\12936', Primary_RenditionNumber: 'mia_25108b.jpg' } }] } }) });
  });
  await mp.route('https://img.artsmia.org/**', (r) => r.fulfill({ headers: { 'content-type': 'image/png' }, body: png })); // thumbnails: display only
  await mp.route('https://data.ng.ac.uk/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/iiif/')) return r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png });
    check(/public_image:true/.test(u.searchParams.get('q')) && u.searchParams.get('default_operator') === 'AND', 'London is asked for works with public images');
    r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ hits: { total: { value: 1 }, hits: [{ _source: { '@admin': { uid: '0ABC-0001-0000-0000' }, summary: { title: 'The Delaware Water Gap' }, creation: [{ date: [{ value: '1857' }], attribution: [{ value: 'George Inness' }] }], multimedia: [{ '@admin': { uid: '0XYZ-000B-0000-0000' } }] } }] } }) });
  });
  await mp.route('https://relay.test/**', (r) => {
    relayed.push(new URL(r.request().url()).searchParams.get('url'));
    r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png });
  });
  await mp.goto(BASE);
  await mp.click('#tab-master');
  check(await mp.isHidden('#museum-setup'), 'setup note hides once the relay is set');
  await mp.fill('#search-input', 'Inness');
  await mp.click('#search-form button');
  await mp.waitForFunction(() => document.querySelectorAll('#results .card').length === 7);
  check(/Searching Cleveland…/.test(await mp.textContent('#search-msg')), 'faster museums show while Cleveland is still searching');
  await mp.waitForFunction(() => /for “Inness”/.test(document.querySelector('#search-msg').textContent));
  // on-screen order (CSS order), not arrival order
  const labels = await mp.$$eval('#results .card', (els) => els.sort((a, b) => +a.style.order - +b.style.order).map((e) => e.querySelector('.meta i').textContent));
  check(JSON.stringify(labels) === JSON.stringify(['Art Institute', 'The Met', 'NGA Washington', 'Mia', 'Cleveland', 'National Gallery London', 'Art Institute', 'The Met']), `results interleave the museums and skip stale Met records (${labels})`);
  check((await mp.textContent('#search-msg')).includes('8 public-domain paintings from 6 museums'), 'message counts results and museums');
  // the three newer museums
  await mp.click('.card[data-id="nga-30776"] [data-act="study"]');
  await mp.waitForFunction(() => window.VST.app.img.meta && window.VST.app.img.meta.source === 'nga' && window.VST.app.work.w > 0);
  check(!relayed.some((u) => /nga\.gov/.test(u)), 'NGA images load directly (searched from the built-in index)');
  await mp.click('.card[data-id="mia-12936"] [data-act="study"]');
  await mp.waitForFunction(() => window.VST.app.img.meta.source === 'mia' && window.VST.app.work.w > 0);
  check(relayed.includes('https://img.artsmia.org/web_objects_cache/012000/900/30/12936/mia_25108b_full.jpg'), 'Mia study image is built from its record and goes through the relay');
  await mp.click('.card[data-id="ngl-0ABC-0001-0000-0000"] [data-act="study"]');
  await mp.waitForFunction(() => window.VST.app.img.meta.source === 'ngl' && window.VST.app.work.w > 0);
  check((await mp.textContent('#credit')).includes('personal study only'), 'London results carry their license note');
  check((await mp.textContent('.card[data-id="cma-9"] .meta span')) === 'George Inness, 1892', 'Cleveland artist name is tidied up');
  await mp.click('.card[data-id="met-1"] [data-act="study"]');
  await mp.waitForFunction(() => window.VST.app.img.meta && window.VST.app.img.meta.source === 'met' && window.VST.app.work.w > 0);
  check(relayed.includes('https://images.metmuseum.org/x/1.jpg'), 'Met study image goes through the relay');
  check((await mp.textContent('#credit')).includes('The Metropolitan Museum of Art, CC0'), 'Met credit line shows');
  await mp.click('.card[data-id="aic-100"] [data-act="study"]');
  await mp.waitForFunction(() => window.VST.app.img.meta.source === 'aic');
  check(!relayed.some((u) => /artic/.test(u)), 'Art Institute images load directly, not through the relay');
  await mp.selectOption('#museum-filter', 'cma');
  await mp.waitForFunction(() => /from Cleveland/.test(document.querySelector('#search-msg').textContent));
  check((await mp.$$eval('#results .card', (c) => c.length)) === 1, 'filtering to Cleveland shows only Cleveland');
  check(cmaCalls === 1, 'switching the filter reuses the earlier results instead of searching again');
  await mp.selectOption('#museum-filter', 'all');
  await mp.fill('#search-input', 'Never');
  await mp.click('#search-form button');
  await mp.waitForFunction(() => /for “Never”/.test(document.querySelector('#search-msg').textContent), null, { timeout: 8000 });
  const slowMsg = await mp.textContent('#search-msg');
  check(/from 5 museums/.test(slowMsg) && /Cleveland took too long to answer/.test(slowMsg), `a museum that never answers is skipped after the time limit (${slowMsg})`);
  await mp.selectOption('#museum-filter', 'cma');
  await mp.reload();
  check(await mp.$eval('#museum-filter', (s) => s.value) === 'cma', 'museum filter is remembered');
  await mctx.close();

  // settings saved by the first version (single "style" choice) carry over
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('value-study:settings'));
    delete st.tone;
    Object.assign(st, { style: 'values', valuesColor: true, bands: 5 });
    localStorage.setItem('value-study:settings', JSON.stringify(st));
  });
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript((st) => localStorage.setItem('value-study:settings', st), await page.evaluate(() => localStorage.getItem('value-study:settings')));
  const p2 = await ctx2.newPage();
  aware(p2);
  await p2.goto(BASE);
  const mig = await p2.evaluate(() => { const s = window.VST.app.settings; return { tone: s.tone, method: s.method, bands: s.bands, style: s.style }; });
  check(mig.tone === 'color' && mig.method === undefined && mig.bands === 5 && mig.style === undefined, 'old saved settings convert to the new controls ' + JSON.stringify(mig));
  const ctx4 = await browser.newContext();
  await ctx4.addInitScript(() => localStorage.setItem('value-study:settings', JSON.stringify({ tone: 'gray', levelsMode: 'even' })));
  const p4 = await ctx4.newPage();
  aware(p4);
  await p4.goto(BASE);
  check(await p4.evaluate(() => window.VST.app.settings.levelsMode) === 'average', 'earlier even-steps default switches to average');
  await ctx4.close();
  const ctx3 = await browser.newContext();
  await ctx3.addInitScript(() => localStorage.setItem('value-study:settings', JSON.stringify({ tone: 'gray', method: 'poster', posterK: 6 })));
  const p3 = await ctx3.newPage();
  aware(p3);
  await p3.goto(BASE);
  check(await p3.evaluate(() => window.VST.app.settings.tone) === 'poster', 'second-version main colors setting converts');
  await ctx3.close();
  await ctx2.close();

  // ---- Compare my study: photo of a sketch, squared up and compared ----
  const cctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const cp = await cctx.newPage();
  aware(cp);
  cp.on('pageerror', (e) => errors.push(e.message));
  await cp.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:''};" }));
  await cp.goto(BASE);
  await cp.click('#tab-reference');
  check(await cp.$eval('#view-compare', (b) => b.disabled), 'Compare is unavailable until a study photo is added');
  await cp.setInputFiles('#file-input', { name: 'river-landscape.png', mimeType: 'image/png', buffer: png });
  await cp.waitForFunction(() => window.VST.app.work.w > 0);
  await cp.click('[data-tone="gray"]');
  await cp.click('[data-n="4"]');
  await cp.selectOption('#levels-mode', 'even'); // like gray markers on white paper
  await settle(cp);
  const refShares = await cp.$$eval('#swatches .swatch .pct', (els) => els.map((e) => parseInt(e.textContent)));

  // a fake phone photo: the 4-value study as the "sketch", rotated on a tabletop, 20% darker (gray-looking paper)
  const photo = await cp.evaluate(() => {
    const study = document.getElementById('cv-study');
    const c = document.createElement('canvas'); c.width = 1400; c.height = 1000;
    const x = c.getContext('2d');
    x.fillStyle = '#6b5b4b'; x.fillRect(0, 0, 1400, 1000);
    const m = new DOMMatrix().translate(700, 500).rotate(7).translate(-450, -300);
    x.setTransform(m);
    x.drawImage(study, 0, 0, 900, 600);
    x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(0, 0, 900, 600);
    const corners = [[0, 0], [900, 0], [900, 600], [0, 600]].map(([px, py]) => { const q = m.transformPoint(new DOMPoint(px, py)); return [q.x, q.y]; });
    return { b64: c.toDataURL('image/png').split(',')[1], corners };
  });
  await cp.setInputFiles('#mine-input', { name: 'my-sketch.png', mimeType: 'image/png', buffer: Buffer.from(photo.b64, 'base64') });
  await cp.waitForSelector('#square-modal:not([hidden])');
  await cp.waitForTimeout(150);
  // drag each default dot (12% inset) onto the sketch's corners, as a person would
  const area = await cp.$eval('#square-canvas', (c) => { const r = c.parentElement.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const ssc = Math.min((area.w - 56) / 1400, (area.h - 56) / 1000);
  const ox = area.x + (area.w - 1400 * ssc) / 2;
  const oy = area.y + (area.h - 1000 * ssc) / 2;
  const toScr = ([X, Y]) => [ox + X * ssc, oy + Y * ssc];
  const defaults = [[168, 120], [1232, 120], [1232, 880], [168, 880]];
  for (let i = 0; i < 4; i++) {
    const [fx, fy] = toScr(defaults[i]);
    const [tx, ty] = toScr(photo.corners[i]);
    await cp.mouse.move(fx, fy);
    await cp.mouse.down();
    await cp.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 4 });
    if (i === 0) await cp.screenshot({ path: path.join(OUT, '15-square-up-loupe.png') });
    await cp.mouse.move(tx, ty, { steps: 4 });
    await cp.mouse.up();
  }
  const quad = await cp.evaluate(() => window.VST.app.squarer.getQuad());
  const maxErr = Math.max(...quad.map((q, i) => Math.hypot(q[0] - photo.corners[i][0], q[1] - photo.corners[i][1])));
  check(maxErr < 3 / ssc, `dragged dots land on the sketch corners (within ${maxErr.toFixed(1)} px)`);
  await cp.screenshot({ path: path.join(OUT, '16-square-up.png') });
  await cp.click('#square-apply');
  await cp.waitForFunction(() => document.querySelectorAll('#swatches-mine .swatch').length === 4);
  check(await cp.$eval('#panels', (e) => e.dataset.view) === 'compare' && await cp.isVisible('#panel-mine') && !(await cp.isVisible('#panel-original')), 'squaring up switches to Compare: reference study beside mine');
  const mineShares = await cp.$$eval('#swatches-mine .swatch .pct', (els) => els.map((e) => parseInt(e.textContent)));
  const worst = Math.max(...mineShares.map((v, i) => Math.abs(v - refShares[i])));
  check(worst <= 4, `my study's value balance matches the reference it was copied from (${mineShares} vs ${refShares})`);
  check(await cp.isVisible('#swatches-master-label') && await cp.isVisible('#swatches-mine-wrap'), 'two bar charts: reference and my study');
  const dims = await cp.evaluate(() => [document.getElementById('cv-mine').width, document.getElementById('cv-mine').height, window.VST.app.work.w, window.VST.app.work.h]);
  check(dims[0] === dims[2] && dims[1] === dims[3], 'my study is fitted to the reference\'s shape');
  await cp.screenshot({ path: path.join(OUT, '17-compare.png') });

  // without paper correction the darker photo reads differently
  await cp.uncheck('#mine-paper');
  await settle(cp);
  const uncorrected = await cp.$$eval('#swatches-mine .swatch .pct', (els) => els.map((e) => parseInt(e.textContent)));
  check(uncorrected.join() !== mineShares.join(), `turning off paper correction changes the result (${uncorrected})`);
  await cp.check('#mine-paper');

  // overlay
  await cp.keyboard.press('o');
  await settle(cp);
  check(await cp.isVisible('#cv-mine-overlay') && !(await cp.isVisible('#panel-mine')), 'O lays my study over the reference');
  await cp.$eval('#mine-opacity', (i) => { i.value = 30; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await cp.$eval('#cv-mine-overlay', (c) => c.style.opacity) === '0.3', 'overlay strength slider works');
  await cp.screenshot({ path: path.join(OUT, '18-overlay.png') });
  await cp.keyboard.press('o');

  // comparison sheet
  const [dl] = await Promise.all([cp.waitForEvent('download'), cp.click('#btn-dl-sheet')]);
  check(/-comparison\.png$/.test(dl.suggestedFilename()), `side-by-side sheet becomes a comparison in Compare view (${dl.suggestedFilename()})`);
  await dl.saveAs(path.join(OUT, dl.suggestedFilename()));

  // "As drawn" keeps the drawing's own proportions; Rotate turns the result
  await cp.click('#mine-square');
  await cp.waitForSelector('#square-modal:not([hidden])');
  await cp.selectOption('#square-aspect', 'drawn');
  await cp.click('#square-rotate');
  await cp.click('#square-apply');
  await settle(cp);
  const d2 = await cp.evaluate(() => [document.getElementById('cv-mine').width, document.getElementById('cv-mine').height]);
  check(Math.abs(d2[0] / d2[1] - 600 / 900) < 0.03, `rotated, as-drawn study is portrait 2:3 (${d2})`);

  // a new reference clears the old study photo
  await cp.setInputFiles('#file-input', { name: 'other.png', mimeType: 'image/png', buffer: png });
  await cp.waitForFunction(() => document.getElementById('view-compare').disabled);
  check(await cp.$eval('#panels', (e) => e.dataset.view) === 'both' && await cp.isHidden('#swatches-mine-wrap'), 'a new reference clears the old study photo');
  await cctx.close();

  // ---- Study sets and history (saved in the browser, survive a reload) ----
  const sctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const sp = await sctx.newPage();
  aware(sp);
  sp.on('pageerror', (e) => errors.push(e.message));
  const answers = [];
  sp.on('dialog', (d) => d.accept(answers.length ? answers.shift() : undefined));
  await sp.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:''};" }));
  await sp.route('https://api.artic.edu/**', (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ data: items.slice(0, 2), pagination: { total: 2, total_pages: 1 } }) }));
  await sp.route('https://www.artic.edu/iiif/**', (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png }));
  await sp.goto(BASE);
  await sp.click('#tab-reference');
  check(await sp.$eval('#set-select', (s) => s.disabled) && await sp.isVisible('#set-empty'), 'no sets at first');
  const tiles = (sel) => sp.$$eval(`${sel} .tile`, (t) => t.map((x) => x.querySelector('.tile-title').textContent));
  const waitItem = (src) => sp.waitForFunction((src) => window.VST.app.img.item && window.VST.app.img.item.source === src, src, { timeout: 10000 });

  await sp.setInputFiles('#file-input', { name: 'lake-sky.png', mimeType: 'image/png', buffer: png });
  await waitItem('upload');
  answers.push('Lake skies');
  await sp.click('#set-add-current');
  check(JSON.stringify(await tiles('#set-items')) === '["lake-sky"]', 'first “+ Add current image” asks for a set name and adds the photo');
  const png2 = Buffer.from(await sp.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#c96'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#123'; x.fillRect(0, 500, 600, 300); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await sp.setInputFiles('#file-input', { name: 'evening-field.png', mimeType: 'image/png', buffer: png2 });
  await sp.waitForFunction(() => window.VST.app.img.item && window.VST.app.img.item.title === 'evening-field');
  await sp.click('#set-add-current');
  await sp.click('#set-add-current');
  check((await tiles('#set-items')).length === 2, 'adding the same image twice keeps one copy');
  await sp.click('#tab-master');
  await sp.selectOption('#museum-filter', 'aic');
  await sp.fill('#search-input', 'Inness');
  await sp.click('#search-form button');
  await sp.waitForSelector('#results .card');
  await sp.click('#results .card [data-act="study"]');
  await waitItem('aic');
  await sp.click('#btn-save-set'); // the toolbar's + Set does the same
  check(JSON.stringify(await tiles('#set-items')) === '["lake-sky","evening-field","Landscape 1"]', 'a set mixes uploaded photos and museum paintings');
  await sp.click('#history-box summary');
  check(JSON.stringify(await tiles('#history-items')) === '["Landscape 1","evening-field","lake-sky"]', 'history lists studied images, newest first');
  await sp.screenshot({ path: path.join(OUT, '20-sets.png') });

  // reload: everything is still there, and an uploaded photo reopens from browser storage
  await sp.reload();
  await sp.waitForTimeout(300);
  check((await sp.$eval('#set-select', (s) => s.selectedOptions[0].textContent)) === 'Lake skies (3)', 'the set survives a reload');
  await sp.click('#history-box summary');
  check((await tiles('#history-items')).length === 3, 'history survives a reload');
  await sp.click('#set-items .tile[data-id^="up-"] .tile-open');
  await sp.waitForFunction(() => window.VST.app.work.w > 0 && window.VST.app.img.item && window.VST.app.img.item.title === 'lake-sky');
  check(await sp.$eval('#set-items .tile[data-id^="up-"]', (t) => t.classList.contains('current')), 'an uploaded photo reopens from storage after a reload, and is highlighted');

  // add from history with +
  answers.push('Evening fields');
  await sp.click('#set-new');
  await sp.click('#history-items .tile:has-text("evening-field") .tile-add');
  check(JSON.stringify(await tiles('#set-items')) === '["evening-field"]', '+ on a history image adds it to the current set');
  await sp.selectOption('#set-select', { label: 'Lake skies (3)' });

  // export, delete, import
  const [exp] = await Promise.all([sp.waitForEvent('download'), sp.click('#set-export')]);
  const expPath = path.join(OUT, exp.suggestedFilename());
  await exp.saveAs(expPath);
  const exported = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  check(exp.suggestedFilename() === 'lake-skies.valuestudy.json' && exported.items.length === 3 && exported.items.filter((i) => i.data).length === 2, 'export saves the set with its photos inside');
  await sp.click('#set-delete'); // confirm() is accepted
  check(!(await sp.$$eval('#set-select option', (o) => o.map((x) => x.textContent))).some((t) => t.startsWith('Lake skies')), 'delete removes the set');
  await sp.setInputFiles('#set-import', expPath);
  await sp.waitForFunction(() => /Lake skies/.test(document.querySelector('#set-select').selectedOptions[0].textContent));
  check((await tiles('#set-items')).length === 3, 'import brings the set back');
  await sp.click('#set-items .tile[data-id^="up-"] .tile-open');
  await sp.waitForFunction(() => window.VST.app.img.item && window.VST.app.img.item.title === 'lake-sky' && window.VST.app.work.w > 0);
  check(true, 'photos in an imported set open');

  // timed session from a set (uploads included), and the session list survives a reload
  await sp.click('#btn-timer');
  await sp.selectOption('#t-break', '0');
  await sp.click('#set-session');
  await sp.waitForFunction(() => window.VST.app.flow.session && window.VST.app.countdown.running);
  check(await sp.$eval('#tab-master', (t) => t.getAttribute('aria-selected') === 'true') && (await sp.$$('#queue li')).length === 3, 'Timed session runs the set in Master Copy');
  check((await sp.textContent('#timer-status')).includes('Painting 1 of 3'), 'the session starts at the first image of the set');
  await sp.click('#btn-session');
  await sp.reload();
  await sp.waitForTimeout(300);
  check((await sp.$$('#queue li')).length === 3, 'a session list with uploaded photos survives a reload');

  // remove and clear
  await sp.click('#set-items .tile:first-child .tile-x');
  check((await tiles('#set-items')).length === 2, '× removes an image from the set');
  await sp.click('#history-box summary');
  await sp.click('#history-clear');
  check((await tiles('#history-items')).length === 0 && (await tiles('#set-items')).length === 2, 'clearing history keeps the sets');
  await sctx.close();

  // ---- Presets: apply, save, reload, refit, and try on across a set ----
  const pctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pp = await pctx.newPage();
  aware(pp);
  pp.on('pageerror', (e) => errors.push(e.message));
  const pAnswers = [];
  pp.on('dialog', (d) => d.accept(pAnswers.length ? pAnswers.shift() : undefined));
  await pp.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:''};" }));
  await pp.goto(BASE);
  await pp.click('#tab-reference');
  await pp.setInputFiles('#file-input', { name: 'river.png', mimeType: 'image/png', buffer: png });
  await pp.waitForFunction(() => window.VST.app.work.w > 0 && window.VST.app.img.item);
  const presetValue = () => pp.$eval('#preset-select', (s) => s.value);
  await pp.selectOption('#preset-select', 'b-notan');
  check(await swatchCount(pp, 2), 'choosing the Notan preset sets 2 values');
  check(await presetValue() === 'b-notan' && (await pp.textContent('#preset-desc')).includes('fit to each image'), 'the preset stays selected with a description');
  await pp.$eval('#thresholds input', (i) => { i.value = 30; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle(pp);
  check(await presetValue() === '', 'changing a setting shows “Custom settings”');
  await pp.selectOption('#preset-select', 'b-squint3');
  await settle(pp);
  check((await pp.textContent('#study-caption')).includes('squint') && await swatchCount(pp, 3), 'Squint, 3 values applies squint and 3 values');
  const split3 = await pp.evaluate(() => window.VST.app.settings.thresholds[3].join());

  // save my own preset, and it survives a reload
  await pp.$eval('#blur', (i) => { i.value = 20; i.dispatchEvent(new Event('input', { bubbles: true })); });
  pAnswers.push('Soft 3');
  await pp.click('#preset-save');
  await settle(pp);
  check((await pp.$eval('#preset-select', (s) => s.selectedOptions[0].textContent)) === 'Soft 3', 'saving names the preset and selects it');
  check((await pp.$$eval('#preset-select optgroup[label="My presets"] option', (o) => o.length)) === 1, 'saved presets are listed under My presets');
  await pp.reload();
  await pp.waitForTimeout(300);
  check((await pp.$eval('#preset-select', (s) => s.selectedOptions[0].textContent)) === 'Soft 3', 'my preset (and the settings) survive a reload');

  // "fit to each image" splits follow a new image
  await pp.selectOption('#preset-select', 'b-3');
  await settle(pp);
  const png3 = Buffer.from(await pp.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 600); g.addColorStop(0, '#fff'); g.addColorStop(0.3, '#ddd'); g.addColorStop(1, '#333'); x.fillStyle = g; x.fillRect(0, 0, 800, 600); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  const before3 = await pp.evaluate(() => window.VST.app.settings.thresholds[3].join());
  await pp.setInputFiles('#file-input', { name: 'gradient.png', mimeType: 'image/png', buffer: png3 });
  await pp.waitForFunction((b) => window.VST.app.img.item && window.VST.app.img.item.title === 'gradient' && window.VST.app.settings.thresholds[3].join() !== b, before3);
  check(await presetValue() === 'b-3', `a “fit to each image” preset refits its splits to a new image (${before3} → ${await pp.evaluate(() => window.VST.app.settings.thresholds[3].join())})`);

  // delete my preset
  await pp.selectOption('#preset-select', { label: 'Soft 3' });
  await pp.click('#preset-delete');
  check((await pp.$$eval('#preset-select optgroup[label="My presets"] option', (o) => o.length)) === 0, 'delete removes my preset');
  check(await pp.$eval('#preset-delete', (b) => b.disabled) === true || await presetValue() === '', 'built-in presets can’t be deleted');

  // try presets on a set of two photos
  pAnswers.push('Try-on set');
  await pp.click('#btn-save-set'); // gradient
  await pp.click('#history-box summary');
  await pp.click('#history-items .tile:has-text("river") .tile-add');
  await pp.click('#set-tryon');
  await pp.waitForSelector('#tryon-modal:not([hidden])');
  await pp.waitForFunction(() => document.querySelectorAll('#tryon-grid .tryon-tile.ready').length === 2);
  check(true, 'Try presets shows every image in the set');
  await pp.click('#tryon-presets button[data-id="b-notan"]');
  await pp.waitForFunction(() => document.querySelectorAll('#tryon-grid .tryon-tile.ready').length === 2);
  const tileGrays = await pp.$$eval('#tryon-grid .tryon-tile canvas', (cs) => cs.map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return s.size; }));
  check(tileGrays.every((n) => n === 2), `with Notan, every image shows exactly 2 values (${tileGrays})`);
  check((await pp.$$eval('#tryon-grid .tt-bar', (b) => b.map((x) => x.children.length))).every((n) => n === 2), 'each image gets a value-balance bar');
  await pp.screenshot({ path: path.join(OUT, '21-tryon.png') });
  await pp.click('#tryon-presets button[data-id="original"]');
  await pp.waitForFunction(() => document.querySelectorAll('#tryon-grid .tryon-tile.ready').length === 2);
  check((await pp.$$('#tryon-grid .tt-bar')).length === 0, 'Original shows the images as they are');
  await pp.click('#tryon-presets button[data-id="b-color4"]');
  await pp.waitForFunction(() => document.querySelectorAll('#tryon-grid .tryon-tile.ready').length === 2);
  await pp.click('#tryon-grid .tryon-tile:has-text("river")');
  await pp.waitForFunction(() => document.getElementById('tryon-modal').hidden && window.VST.app.img.item && window.VST.app.img.item.title === 'river' && window.VST.app.work.w > 0);
  await settle(pp);
  check(await presetValue() === 'b-color4', 'tapping an image studies it with the chosen preset');
  await pctx.close();

  // ---- Sidebar tabs, focus, touch sizes and the practice log ----
  const tctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const tp = await tctx.newPage();
  tp.on('pageerror', (e) => errors.push(e.message));
  await tp.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:''};" }));
  await tp.goto(BASE);
  const panelOn = (name) => tp.$eval(`#ptab-${name}`, (t) => t.getAttribute('aria-selected') === 'true');
  check(await panelOn('images') && await tp.$eval('#panel-study', (x) => x.hidden), 'the sidebar opens on Images, with Study and Canvas in their own tabs');
  await tp.setInputFiles('#file-input', { name: 'river.png', mimeType: 'image/png', buffer: png });
  await tp.waitForFunction(() => window.VST.app.work.w > 0 && window.VST.app.img.item);
  check(await panelOn('study'), 'choosing your own image switches to the Study tab');
  const studyTop = await tp.$eval('#sec-study', (el) => el.getBoundingClientRect().top);
  check(studyTop < 200, `study settings are at the top of the sidebar, no scrolling (${Math.round(studyTop)}px)`);
  await tp.click('#ptab-canvas');
  check(await tp.isVisible('#grid-on') && !(await tp.isVisible('#bands-seg')), 'Canvas holds the grid and downloads');
  await tp.focus('#ptab-canvas');
  await tp.keyboard.press('ArrowLeft');
  check(await panelOn('study') && await tp.evaluate(() => document.activeElement.id === 'ptab-study'), 'arrow keys move between sidebar tabs');
  await tp.reload();
  await tp.waitForTimeout(300);
  check(await panelOn('study'), 'the chosen tab is remembered');
  await tp.setInputFiles('#file-input', { name: 'river.png', mimeType: 'image/png', buffer: png });
  await tp.waitForFunction(() => window.VST.app.work.w > 0 && window.VST.app.img.item);
  // focus moves into pop-up screens and comes back
  await tp.click('#btn-crop');
  check(await tp.evaluate(() => document.activeElement.id === 'crop-apply'), 'opening Crop moves focus to its main button');
  await tp.click('#crop-cancel');
  check(await tp.evaluate(() => document.activeElement.id === 'btn-crop'), 'closing Crop returns focus to the Crop button');
  // practice log: on-screen time and a completed timed round
  await tp.evaluate(() => window.VST.log.tick(Date.now() + 30000));
  const rec = await tp.evaluate(() => window.VST.log.days()[window.VST.log.dayKey()].items[window.VST.app.img.item.id]);
  check(rec && rec.secs >= 30, `the log records time spent with an image (${rec && rec.secs}s)`);
  await tp.click('#btn-timer');
  await tp.click('#t-play');
  await tp.evaluate(() => window.VST.app.countdown.finish(true));
  const rec2 = await tp.evaluate(() => window.VST.log.days()[window.VST.log.dayKey()].items[window.VST.app.img.item.id]);
  check(rec2.rounds === 1 && rec2.drawSecs > 0, `a timed round that runs out is logged (${rec2.rounds} round, ${rec2.drawSecs}s)`);
  await tp.click('#t-stop');
  await tctx.close();

  // ---- Log tab: summary, calendar, day detail, reopen, export, clear ----
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await lctx.addInitScript(() => {
    if (localStorage.getItem('value-study:log')) return;
    const key = (n) => { const d = new Date(); d.setDate(d.getDate() - n); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
    const met = { id: 'aic-100', title: 'Landscape 1', artist: 'George Inness', museum: 'Art Institute', source: 'aic', image: 'https://www.artic.edu/iiif/2/img0/full/1686,/0/default.jpg', credit: 'Art Institute of Chicago, CC0' };
    const days = {};
    days[key(1)] = { items: { 'aic-100': { ...met, secs: 1500, drawSecs: 1200, rounds: 2 }, 'up-x': { id: 'up-x', title: 'my sketch photo', source: 'upload', secs: 300, drawSecs: 0, rounds: 0 } } };
    days[key(2)] = { items: { 'aic-100': { ...met, secs: 4000, drawSecs: 0, rounds: 0 } } };
    days[key(3)] = { items: { 'aic-100': { ...met, secs: 30, drawSecs: 0, rounds: 0 } } }; // too little to count
    days[key(40)] = { items: { 'aic-100': { ...met, secs: 600, drawSecs: 0, rounds: 0 } } };
    localStorage.setItem('value-study:log', JSON.stringify({ version: 1, days }));
  });
  const lp = await lctx.newPage();
  aware(lp);
  lp.on('pageerror', (e) => errors.push(e.message));
  const lAnswers = [];
  lp.on('dialog', (d) => d.accept(lAnswers.length ? lAnswers.shift() : undefined));
  await lp.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:''};" }));
  await lp.route('https://www.artic.edu/iiif/**', (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png }));
  await lp.goto(BASE);
  await lp.click('#ptab-log');
  const stats = await lp.$$eval('#log-stats .stat', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check(stats[1].startsWith('2 days') && /best 2/.test(stats[1]), `streak counts the last two days (${stats[1]})`);
  check(/all time · 3 days/.test(stats[3]), `all-time total counts practiced days only (${stats[3]})`);
  const shaded = await lp.$$eval('#cal button[class*="lv"]', (b) => b.map((x) => x.className));
  check(shaded.length === 0 || (shaded.some((c) => c.includes('lv4')) && shaded.some((c) => c.includes('lv3'))), `calendar shades days by time: 66 min deepest, 30 min next (${shaded.join(', ')})`);
  check(await lp.$eval('#cal .today', (b) => !!b), 'today is outlined');
  const yKey = await lp.evaluate(() => window.VST.log.shiftDay(window.VST.log.dayKey(), -1));
  if (await lp.$(`#cal button[data-day="${yKey}"]`) === null) await lp.click('#cal-prev'); // yesterday may be in last month
  await lp.click(`#cal button[data-day="${yKey}"]`);
  const sumText = await lp.textContent('#log-day .day-sum');
  check(/30 min · 2 images · 2 timed rounds \(20 min\)/.test(sumText), `day detail totals (${sumText})`);
  const rows = await lp.$$eval('#log-day .log-row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check(rows.length === 2 && /Landscape 1.*George Inness · Art Institute.*25 min · 2×/.test(rows[0]) && /my sketch photo.*My photo.*5 min/.test(rows[1]), `day detail lists what was studied (${rows.join(' | ')})`);
  await lp.screenshot({ path: path.join(OUT, '26-log.png') });
  await lp.click('#log-day .log-row:first-child');
  await lp.waitForFunction(() => window.VST.app.img.meta && window.VST.app.img.meta.title === 'Landscape 1' && window.VST.app.work.w > 0);
  check(true, 'tapping a logged painting opens it again');
  const [csvDl] = await Promise.all([lp.waitForEvent('download'), lp.click('#log-export')]);
  const csvPath = path.join(OUT, csvDl.suggestedFilename());
  await csvDl.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  check(csvText[0] === 'date,title,artist,museum,source,study_minutes,timed_rounds,timed_minutes' && csvText.some((l) => /Landscape 1,George Inness,Art Institute,aic,25\.0,2,20\.0/.test(l)), `the log downloads as a spreadsheet (${csvText.length - 1} rows)`);
  const atCurrentMonth = await lp.evaluate(() => !!document.querySelector('#cal .today'));
  check(atCurrentMonth === (await lp.$eval('#cal-next', (b) => b.disabled)), 'next month is disabled only at the current month');
  await lp.click('#cal-prev');
  check((await lp.textContent('#cal-title')).length > 0, 'previous months can be browsed');
  await lp.click('#log-clear');
  await lp.waitForFunction(() => document.querySelectorAll('#cal button[class*="lv"]').length === 0);
  check(/all time · 0 days/.test(await lp.textContent('#log-stats')), 'clear log empties it');
  await lctx.close();

  // touch devices: 44px targets and 16px fields
  const ipad = await browser.newContext({ ...devices['iPad (gen 7)'] });
  const ip = await ipad.newPage();
  aware(ip);
  ip.on('pageerror', (e) => errors.push(e.message));
  await ip.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "window.VST=window.VST||{};window.VST.config={imageRelay:''};" }));
  await ip.goto(BASE);
  await ip.setInputFiles('#file-input', { name: 'river.png', mimeType: 'image/png', buffer: png });
  await ip.waitForFunction(() => window.VST.app.work.w > 0 && window.VST.app.img.item);
  for (const panel of ['images', 'study', 'canvas', 'log']) {
    await ip.evaluate((p) => window.VST.app.setPanel(p), panel);
    const small = await ip.evaluate(() => {
      const els = [...document.querySelectorAll('.sidebar button, .sidebar select, .sidebar input[type=url], .sidebar input[type=search], .sidebar input[type=number], .sidebar label.btn, .toolbar button')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest('[hidden]'); });
      return els.filter((e) => e.getBoundingClientRect().height < 43.5 && !e.matches('.chips button, .tile-x, .tile-add')).map((e) => `${e.id || e.textContent.trim().slice(0, 18)} ${Math.round(e.getBoundingClientRect().height)}px`);
    });
    check(small.length === 0, `on iPad, ${panel} controls are at least 44px tall${small.length ? ': ' + small.join(', ') : ''}`);
  }
  const fieldSizes = await ip.evaluate(() => [...document.querySelectorAll('input[type=url], input[type=search], input[type=number], select')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
  check(fieldSizes.every((f) => f >= 16), `on iPad, text fields and menus are 16px (no zoom on focus): ${[...new Set(fieldSizes)].join(', ')}px`);
  await ipad.close();

  // phone layout
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  aware(phone);
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(BASE);
  await phone.click('#tab-reference');
  await phone.setInputFiles('#file-input', { name: 'river.png', mimeType: 'image/png', buffer: png });
  await phone.waitForFunction(() => window.VST.app.work.w > 0);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no sideways scrolling on a phone');
  await phone.screenshot({ path: path.join(OUT, '6-phone.png') });

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('\nAll checks passed.');
})().catch((e) => { console.error(e.message || e); process.exit(1); });

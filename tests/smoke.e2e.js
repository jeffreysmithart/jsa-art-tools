// Browser smoke test. Run: python3 -m http.server 8765 & node tests/smoke.e2e.js
// Museum requests are answered by stand-ins, so it needs no network.
const { chromium } = require('playwright');
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

function check(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
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
  check(JSON.stringify(noRelay) === JSON.stringify([['all', false], ['aic', false], ['met', true], ['cma', true]]), 'without the relay, The Met and Cleveland show as needing setup');
  check(await page.isVisible('#museum-setup'), 'setup note shows without the relay');

  // with the relay: three museums searched together (all responses simulated)
  const mctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mp = await mctx.newPage();
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
  await mp.route('https://relay.test/**', (r) => {
    relayed.push(new URL(r.request().url()).searchParams.get('url'));
    r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: png });
  });
  await mp.goto(BASE);
  await mp.click('#tab-master');
  check(await mp.isHidden('#museum-setup'), 'setup note hides once the relay is set');
  await mp.fill('#search-input', 'Inness');
  await mp.click('#search-form button');
  await mp.waitForFunction(() => document.querySelectorAll('#results .card').length === 4);
  check(/Searching Cleveland…/.test(await mp.textContent('#search-msg')), 'faster museums show while Cleveland is still searching');
  await mp.waitForFunction(() => /for “Inness”/.test(document.querySelector('#search-msg').textContent));
  // on-screen order (CSS order), not arrival order
  const labels = await mp.$$eval('#results .card', (els) => els.sort((a, b) => +a.style.order - +b.style.order).map((e) => e.querySelector('.meta i').textContent));
  check(JSON.stringify(labels) === JSON.stringify(['Art Institute', 'The Met', 'Cleveland', 'Art Institute', 'The Met']), `results interleave the museums and skip stale Met records (${labels})`);
  check((await mp.textContent('#search-msg')).includes('5 public-domain paintings from 3 museums'), 'message counts results and museums');
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
  check(/from 2 museums/.test(slowMsg) && /Cleveland took too long to answer/.test(slowMsg), `a museum that never answers is skipped after the time limit (${slowMsg})`);
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
  await p2.goto(BASE);
  const mig = await p2.evaluate(() => { const s = window.VST.app.settings; return { tone: s.tone, method: s.method, bands: s.bands, style: s.style }; });
  check(mig.tone === 'color' && mig.method === undefined && mig.bands === 5 && mig.style === undefined, 'old saved settings convert to the new controls ' + JSON.stringify(mig));
  const ctx4 = await browser.newContext();
  await ctx4.addInitScript(() => localStorage.setItem('value-study:settings', JSON.stringify({ tone: 'gray', levelsMode: 'even' })));
  const p4 = await ctx4.newPage();
  await p4.goto(BASE);
  check(await p4.evaluate(() => window.VST.app.settings.levelsMode) === 'average', 'earlier even-steps default switches to average');
  await ctx4.close();
  const ctx3 = await browser.newContext();
  await ctx3.addInitScript(() => localStorage.setItem('value-study:settings', JSON.stringify({ tone: 'gray', method: 'poster', posterK: 6 })));
  const p3 = await ctx3.newPage();
  await p3.goto(BASE);
  check(await p3.evaluate(() => window.VST.app.settings.tone) === 'poster', 'second-version main colors setting converts');
  await ctx3.close();
  await ctx2.close();

  // phone layout
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
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

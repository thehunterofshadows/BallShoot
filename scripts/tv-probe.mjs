/* Renders TV mode across the complete aspect-ratio matrix and arbitrary viewports,
   checks uniform scaling, 16:9 stage aspect, background paint outside the stage,
   critical UI inside the safe area, Screen Fit calibration, live resize invariance
   including the minimum viewport pause/notice, and fullscreen transitions.
   Run: docker compose run --rm --no-deps screens node scripts/tv-probe.mjs */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'screenshots');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.webp':'image/webp', '.json':'application/json' };
const VIEWPORTS = [
  { name:'tv-1080p',     width:1920, height:1080 },
  { name:'tv-1440p',     width:2560, height:1440 },
  { name:'tv-4k',        width:3840, height:2160 },
  { name:'tv-16x10',     width:1920, height:1200 },
  { name:'tv-21x9-wide', width:2560, height:1080 },
  { name:'tv-21x9',      width:3440, height:1440 },
  { name:'tv-4x3',       width:1600, height:1200 },
  { name:'tv-arb-1366',  width:1366, height:768 },
  { name:'tv-arb-1280',  width:1280, height:1024 },
  { name:'tv-arb-2200',  width:2200, height:900 },
];

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await mkdir(outDir, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const shots = [];
let failed = false;

/* Section 1: Matrix viewports */
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode: 'tv' })));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
  await page.waitForTimeout(200);

  // Two humans on one field: the couch co-op layout.
  await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g.settings.players = 2; g.settings.human = [true, true, false, false]; g.resetGame();
  });
  const game = page.locator('coop-bubbles');
  await game.locator('.localPlay').click(); await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); if (g._padPickActive) g.finishPadPick(true); if (g._profilePickActive) { g._pp.panels.forEach(p => { p.choice = { type: 'guest' }; p.view = 'ready'; }); g.ppStart(); } }); // Player Select (#18): everyone as Guest
  await game.locator('.start').click();
  await page.waitForTimeout(900);

  const probe = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    const col = sh.querySelector('.gameCol').getBoundingClientRect();
    const rootEl = sh.querySelector('.root');
    const s = col.width / 1920;
    const rel = el => { const r = el.getBoundingClientRect();
      return { x: Math.round((r.left - col.left) / s), y: Math.round((r.top - col.top) / s), w: Math.round(r.width / s), h: Math.round(r.height / s) }; };
    const rootCs = getComputedStyle(rootEl);
    const colCs = getComputedStyle(sh.querySelector('.gameCol'));
    const pf = sh.querySelector('canvas').getBoundingClientRect();
    return {
      tv: rootEl.classList.contains('tvMode'), layout: g.tvLay?.key, scale: s,
      stage: { x: Math.round(col.left), y: Math.round(col.top), w: Math.round(col.width), h: Math.round(col.height) },
      playfield: rel(sh.querySelector('canvas')),
      pfAspect: pf.width / pf.height,
      worldAspect: 640 / g.H,
      critical: ['.tvScore', '.tvRound', '.tvPower', '.fullscreenButton', '.gear', '.tvCard']
        .flatMap(q => [...sh.querySelectorAll(q)]).map(el => ({ q: el.className, ...rel(el) })),
      rootBg: rootCs.backgroundImage,
      colBg: colCs.backgroundColor,
    };
  });
  const pngBuffer = await page.screenshot({ path: join(outDir, `${vp.name}-play.png`) });

  const expectedScale = Math.min(vp.width / 1920, vp.height / 1080);
  const expectedW = Math.round(1920 * expectedScale);
  const expectedH = Math.round(1080 * expectedScale);
  const expectedX = Math.round((vp.width - expectedW) / 2);
  const expectedY = Math.round((vp.height - expectedH) / 2);

  const stageOk = Math.abs(probe.scale - expectedScale) <= 0.005 &&
    Math.abs(probe.stage.w - expectedW) <= 1 &&
    Math.abs(probe.stage.h - expectedH) <= 1 &&
    Math.abs(probe.stage.x - expectedX) <= 1 &&
    Math.abs(probe.stage.y - expectedY) <= 1 &&
    Math.abs(probe.stage.w / probe.stage.h - 16 / 9) <= 0.01;

  const outside = probe.critical.filter(r => r.x < 96 || r.y < 54 || r.x + r.w > 1824 || r.y + r.h > 1026);
  const aspectOk = Math.abs(probe.pfAspect - probe.worldAspect) < 0.01;
  const bgOk = probe.rootBg && probe.rootBg !== 'none' && probe.rootBg.includes('url(');

  let paintOk = true;
  let paintedPixels = [];
  if (expectedX > 10 || expectedY > 10) {
    const points = [];
    if (expectedX > 10) {
      points.push([Math.floor(expectedX * 0.5), Math.floor(vp.height * 0.25)]);
      points.push([Math.floor(expectedX * 0.5), Math.floor(vp.height * 0.5)]);
      points.push([Math.floor(vp.width - expectedX * 0.5), Math.floor(vp.height * 0.5)]);
    }
    if (expectedY > 10) {
      points.push([Math.floor(vp.width * 0.25), Math.floor(expectedY * 0.5)]);
      points.push([Math.floor(vp.width * 0.5), Math.floor(expectedY * 0.5)]);
      points.push([Math.floor(vp.width * 0.5), Math.floor(vp.height - expectedY * 0.5)]);
    }
    paintedPixels = await page.evaluate(async ({ dataUrl, points }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => {
        const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        return [p[0], p[1], p[2], p[3]];
      });
    }, { dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`, points });

    const FLAT_BAR_RGB = [7, 10, 34];
    paintOk = paintedPixels.length > 0 && paintedPixels.every(p => {
      const isOpaque = p[3] === 255;
      const isNotFlat = !(p[0] === FLAT_BAR_RGB[0] && p[1] === FLAT_BAR_RGB[1] && p[2] === FLAT_BAR_RGB[2]);
      const isNotBlack = p[0] > 0 || p[1] > 0 || p[2] > 0;
      return isOpaque && isNotFlat && isNotBlack;
    });
  }

  const ok = probe.tv && probe.layout === 'coop2' && stageOk && aspectOk && bgOk && paintOk && !outside.length && !errors.length;
  if (!ok) failed = true;
  shots.push({ name: vp.name, probe });
  console.log(`${vp.name.padEnd(13)} ${ok ? 'ok ' : 'BAD'} stage ${probe.stage.w}x${probe.stage.h}@${probe.stage.x},${probe.stage.y} ` +
    `x${probe.scale.toFixed(3)} field ${JSON.stringify(probe.playfield)}` +
    (outside.length ? ` outside-safe ${JSON.stringify(outside)}` : '') +
    (!stageOk ? ` stageMismatch(exp ${expectedW}x${expectedH}@${expectedX},${expectedY})` : '') +
    (!bgOk ? ' missingRootBg' : '') +
    (!paintOk ? ' unpaintedBars' : '') +
    (errors.length ? ` errors ${errors.join(' | ')}` : ''));
  await context.close();
}

// Same logical composition at every resolution.
const key = p => JSON.stringify([p.playfield, p.critical.map(({ q, ...r }) => r)]);
const ref = key(shots[0].probe);
for (const s of shots.slice(1)) if (key(s.probe) !== ref) {
  const a = JSON.parse(ref), b = JSON.parse(key(s.probe));
  const drift = a.flat().some((r, i) => { const o = b.flat()[i]; return !o || ['x','y','w','h'].some(k => Math.abs(r[k] - o[k]) > 2); });
  if (drift) { failed = true; console.log(`${s.name}: composition differs from ${shots[0].name}`); }
}

/* Section 2: Screen Fit calibration at 4K */
{
  const fit = { top: 0.1, right: 0, bottom: 0.02, left: 0.08 };
  const safe = { x: Math.round(1920 * fit.left), y: Math.round(1080 * fit.top) };
  safe.r = 1920 - Math.round(1920 * fit.right); safe.b = 1080 - Math.round(1080 * fit.bottom);
  const context = await browser.newContext({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
  await context.addInitScript(f => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode: 'tv', screenFit: f })), fit);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const home = await page.evaluate(() => { const sh = document.querySelector('coop-bubbles').shadowRoot;
    return { focus: sh.activeElement?.className || '', prompts: !sh.querySelector('.tvPrompts').hidden, text: sh.querySelector('.tvPrompts').textContent }; });
  await page.screenshot({ path: join(outDir, 'tv-fit-home.png') });
  await page.evaluate(() => { const g = document.querySelector('coop-bubbles');
    g.settings.players = 2; g.settings.human = [true, true, false, false]; g.resetGame(); });
  const game = page.locator('coop-bubbles');
  await game.locator('.localPlay').click(); await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); if (g._padPickActive) g.finishPadPick(true); if (g._profilePickActive) { g._pp.panels.forEach(p => { p.choice = { type: 'guest' }; p.view = 'ready'; }); g.ppStart(); } }); // Player Select (#18): everyone as Guest
  await game.locator('.start').click();
  await page.waitForTimeout(900);
  const play = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot, col = sh.querySelector('.gameCol').getBoundingClientRect(), s = col.width / 1920;
    const rel = el => { const r = el.getBoundingClientRect();
      return { q: el.className, x: Math.round((r.left - col.left) / s), y: Math.round((r.top - col.top) / s), r: Math.round((r.right - col.left) / s), b: Math.round((r.bottom - col.top) / s) }; };
    const fonts = ['.tvScoreVal', '.tvRoundVal', '.tvRoundLabel', '.tvWho', '.tvStatus', '.tvPush']
      .flatMap(q => [...sh.querySelectorAll(q)]).filter(el => el.textContent)
      .map(el => ({ q: el.className, px: parseFloat(getComputedStyle(el).fontSize) }));
    const pf = sh.querySelector('canvas').getBoundingClientRect();
    return { critical: ['.tvScore', '.tvRound', '.tvPower', '.fullscreenButton', '.gear', '.tvCard'].flatMap(q => [...sh.querySelectorAll(q)]).map(rel),
      fonts, aspect: pf.width / pf.height, world: 640 / g.H };
  });
  await page.screenshot({ path: join(outDir, 'tv-fit-play.png') });
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  await game.locator('.pause .sfOpen').click();
  await page.waitForTimeout(300);
  const sf = await page.evaluate(() => { const sh = document.querySelector('coop-bubbles').shadowRoot, col = sh.querySelector('.gameCol').getBoundingClientRect(), s = col.width / 1920;
    const f = sh.querySelector('.sfFrame').getBoundingClientRect();
    return { focus: sh.activeElement?.className || '', text: sh.querySelector('.tvPrompts').textContent,
      frame: { x: Math.round((f.left - col.left) / s), y: Math.round((f.top - col.top) / s), r: Math.round((f.right - col.left) / s), b: Math.round((f.bottom - col.top) / s) } }; });
  await page.screenshot({ path: join(outDir, 'tv-fit-screenfit.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => document.querySelector('coop-bubbles').shadowRoot.querySelector('.screenFit').style.display);
  const outside = play.critical.filter(r => r.x < safe.x - 1 || r.y < safe.y - 1 || r.r > safe.r + 1 || r.b > safe.b + 1);
  const small = play.fonts.filter(f => f.px < 28 - 0.5); // the HUD layer is authored in logical px and scaled whole
  const frameOk = Math.abs(sf.frame.x - safe.x) <= 2 && Math.abs(sf.frame.y - safe.y) <= 2 && Math.abs(sf.frame.r - safe.r) <= 2 && Math.abs(sf.frame.b - safe.b) <= 2;
  const ok = home.focus.includes('localPlay') && home.prompts && sf.focus.includes('sfRange') && /Cancel/.test(sf.text)
    && frameOk && closed === 'none' && !outside.length && !small.length && Math.abs(play.aspect - play.world) < 0.01 && !errors.length;
  if (!ok) failed = true;
  console.log(`tv-fit        ${ok ? 'ok ' : 'BAD'} home focus ${home.focus} · prompts "${home.text}" · screen fit focus ${sf.focus} frame ${JSON.stringify(sf.frame)}` +
    ` · field aspect ${play.aspect.toFixed(4)} (world ${play.world.toFixed(4)}) · min HUD font ${Math.min(...play.fonts.map(f => f.px))}px · fit prompts "${sf.text}"` +
    (outside.length ? ` outside-fit ${JSON.stringify(outside)}` : '') + (small.length ? ` small ${JSON.stringify(small)}` : '') + (errors.length ? ` errors ${errors.join(' | ')}` : ''));
  await context.close();
}

/* Section 3: Live resize sequence & too-small handling */
{
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode: 'tv' })));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
  await page.waitForTimeout(200);

  // Start 2-player match
  await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g.settings.players = 2; g.settings.human = [true, true, false, false]; g.resetGame();
  });
  const game = page.locator('coop-bubbles');
  await game.locator('.localPlay').click(); await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); if (g._padPickActive) g.finishPadPick(true); if (g._profilePickActive) { g._pp.panels.forEach(p => { p.choice = { type: 'guest' }; p.view = 'ready'; }); g.ppStart(); } }); // Player Select (#18): everyone as Guest
  await game.locator('.start').click();
  await page.waitForTimeout(900);

  // Set match baseline state
  const initial = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g.score = 750;
    return {
      score: g.score,
      gridCount: g.grid.size,
      level: g.settings.level,
      H: g.H,
      launchY: g.LAUNCH_Y,
      dangerY: g.DANGER_Y,
      state: g.state,
    };
  });

  // Resize through 4 diverse viewports
  const resizeSteps = [
    { w: 2560, h: 1440 },
    { w: 3440, h: 1440 },
    { w: 1600, h: 1200 },
    { w: 1920, h: 1200 },
  ];
  let resizeOk = true;
  for (const step of resizeSteps) {
    await page.setViewportSize({ width: step.w, height: step.h });
    await page.waitForTimeout(100);
    const snap = await page.evaluate(() => {
      const g = document.querySelector('coop-bubbles');
      return { score: g.score, gridCount: g.grid.size, level: g.settings.level, H: g.H, launchY: g.LAUNCH_Y, dangerY: g.DANGER_Y };
    });
    if (snap.score !== initial.score || snap.gridCount !== initial.gridCount || snap.level !== initial.level ||
        snap.H !== initial.H || snap.launchY !== initial.launchY || snap.dangerY !== initial.dangerY) {
      resizeOk = false;
    }
  }

  // Drop below minimum (800x450 < 960x540)
  await page.setViewportSize({ width: 800, height: 450 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, 'tv-resize-too-small.png') });
  const tooSmallProbe = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    const rootEl = sh.querySelector('.root');
    const notice = sh.querySelector('.tvSmall');
    const cs = getComputedStyle(notice);
    const fsBtn = notice?.querySelector('.tvFullscreen');
    const dBtn = notice?.querySelector('.tvSmallDesktop');
    return {
      hasCls: rootEl.classList.contains('tvTooSmall'),
      noticeVisible: cs.display !== 'none',
      hasFsBtn: !!fsBtn,
      hasDBtn: !!dBtn,
      state: g.state,
      score: g.score,
      gridCount: g.grid.size,
      level: g.settings.level,
      H: g.H,
    };
  });

  const tooSmallOk = tooSmallProbe.hasCls && tooSmallProbe.noticeVisible &&
    tooSmallProbe.hasFsBtn && tooSmallProbe.hasDBtn &&
    tooSmallProbe.state === 'paused' &&
    tooSmallProbe.score === initial.score &&
    tooSmallProbe.gridCount === initial.gridCount &&
    tooSmallProbe.level === initial.level &&
    tooSmallProbe.H === initial.H;

  // Verify Start / P cannot resume while too-small notice is open
  await page.keyboard.press('p');
  const padStartBlocked = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g.padStart();
    return g.state === 'paused';
  });
  const lockOk = padStartBlocked;

  // Restore to 1920x1080
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, 'tv-resize-restored.png') });
  const restoredProbe = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    const rootEl = sh.querySelector('.root');
    const notice = sh.querySelector('.tvSmall');
    const cs = getComputedStyle(notice);
    return {
      hasCls: rootEl.classList.contains('tvTooSmall'),
      noticeVisible: cs.display !== 'none',
      state: g.state,
      score: g.score,
      gridCount: g.grid.size,
      level: g.settings.level,
      H: g.H,
    };
  });

  const restoredOk = !restoredProbe.hasCls && !restoredProbe.noticeVisible &&
    restoredProbe.state === 'paused' && // remains paused, no auto-resume
    restoredProbe.score === initial.score &&
    restoredProbe.gridCount === initial.gridCount &&
    restoredProbe.level === initial.level &&
    restoredProbe.H === initial.H;

  // Resume with padStart once restored above minimum
  const resumedOk = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g.padStart();
    return g.state === 'play';
  });

  // Mode round trip: drop below minimum, choose Desktop layout, resume, and switch back to TV
  await page.setViewportSize({ width: 800, height: 450 });
  await page.waitForTimeout(200);

  // Click "Use Desktop layout" on the too-small notice
  await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    sh.querySelector('.tvSmallDesktop').click();
  });
  await page.waitForTimeout(100);

  const desktopProbe = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    return {
      tvActive: g.tvActive,
      displayMode: g.settings.displayMode,
      hasTooSmallCls: sh.querySelector('.root').classList.contains('tvTooSmall'),
      hasTvModeCls: sh.querySelector('.root').classList.contains('tvMode'),
      state: g.state,
    };
  });

  // Resume offline match in Desktop layout
  await page.keyboard.press('p');
  await page.waitForTimeout(50);
  const desktopPlayOk = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    return g.state === 'play';
  });

  // Switch back to TV at the same small size (< 960x540) with fullscreen unavailable / declined
  await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g._fsDeclined = true;
    g.setDisplayMode('tv');
  });
  await page.waitForTimeout(200);

  const roundTripTvProbe = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    const rootEl = sh.querySelector('.root');
    const notice = sh.querySelector('.tvSmall');
    const cs = getComputedStyle(notice);
    return {
      tvActive: g.tvActive,
      displayMode: g.settings.displayMode,
      hasTooSmallCls: rootEl.classList.contains('tvTooSmall'),
      noticeVisible: cs.display !== 'none',
      state: g.state,
    };
  });

  const roundTripOk = !desktopProbe.tvActive && !desktopProbe.hasTooSmallCls &&
    desktopPlayOk &&
    roundTripTvProbe.tvActive && roundTripTvProbe.hasTooSmallCls &&
    roundTripTvProbe.noticeVisible && roundTripTvProbe.state === 'paused';

  const liveResizePass = resizeOk && tooSmallOk && lockOk && restoredOk && resumedOk && roundTripOk && !errors.length;
  if (!liveResizePass) failed = true;
  console.log(`tv-resize     ${liveResizePass ? 'ok ' : 'BAD'} multi-resize ${resizeOk ? 'ok' : 'DRIFT'} ` +
    `· too-small notice ${tooSmallProbe.noticeVisible ? 'visible' : 'HIDDEN'} & paused ${tooSmallProbe.state === 'paused'} ` +
    `· pause-locked ${lockOk} · restored notice ${!restoredProbe.noticeVisible ? 'hidden' : 'VISIBLE'} & stays paused ${restoredProbe.state === 'paused'} ` +
    `· resumed with Start ${resumedOk} · desktop/tv round-trip ${roundTripOk ? 'ok' : 'FAIL'}` +
    (!tooSmallOk ? ` tooSmallFail(${JSON.stringify(tooSmallProbe)})` : '') +
    (!restoredOk ? ` restoredFail(${JSON.stringify(restoredProbe)})` : '') +
    (!roundTripOk ? ` roundTripFail(desktop:${JSON.stringify(desktopProbe)},resumed:${desktopPlayOk},tv:${JSON.stringify(roundTripTvProbe)})` : '') +
    (errors.length ? ` errors ${errors.join(' | ')}` : ''));
  await context.close();
}

/* Section 4: Fullscreen enter / exit check */
{
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode: 'tv' })));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
  await page.waitForTimeout(200);

  // Start 2-player match
  await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g.settings.players = 2; g.settings.human = [true, true, false, false]; g.resetGame();
  });
  const game = page.locator('coop-bubbles');
  await game.locator('.localPlay').click(); await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); if (g._padPickActive) g.finishPadPick(true); if (g._profilePickActive) { g._pp.panels.forEach(p => { p.choice = { type: 'guest' }; p.view = 'ready'; }); g.ppStart(); } }); // Player Select (#18): everyone as Guest
  await game.locator('.start').click();
  await page.waitForTimeout(900);

  const fsCheck = await page.evaluate(async () => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    const btn = sh.querySelector('.fullscreenButton');
    const rootEl = sh.querySelector('.root');
    const initialH = g.H;
    const initialScore = g.score;

    // If already in fullscreen (e.g. from tvFullscreenNudge), exit first to start from known windowed state
    if (g.isFullscreen()) {
      await g.toggleFullscreen();
    }

    // Check initial windowed state
    const windowed = {
      isFs: g.isFullscreen(),
      btnClass: btn.classList.contains('isFullscreen'),
      rootClass: rootEl.classList.contains('isFullscreen'),
      label: btn.getAttribute('aria-label') || btn.title,
    };

    // Simulate or execute enterFullscreen
    let simulated = false;
    try {
      await g.enterFullscreen();
    } catch (_) {}
    if (!g.isFullscreen()) {
      simulated = true;
      g.isFullscreen = () => true;
      g._syncFullscreen();
    }

    const entered = {
      isFs: g.isFullscreen(),
      btnClass: btn.classList.contains('isFullscreen'),
      rootClass: rootEl.classList.contains('isFullscreen'),
      label: btn.getAttribute('aria-label') || btn.title,
    };

    // Exit fullscreen
    if (simulated) {
      g.isFullscreen = () => false;
      g._syncFullscreen();
    } else {
      await g.toggleFullscreen();
    }

    const exited = {
      isFs: g.isFullscreen(),
      btnClass: btn.classList.contains('isFullscreen'),
      rootClass: rootEl.classList.contains('isFullscreen'),
      label: btn.getAttribute('aria-label') || btn.title,
      declined: g._fsDeclined,
      preservedH: g.H === initialH,
      preservedScore: g.score === initialScore,
    };

    return { windowed, entered, exited, simulated };
  });

  const fsOk = !fsCheck.windowed.btnClass && !fsCheck.windowed.rootClass && fsCheck.windowed.label === 'Enter fullscreen' &&
    fsCheck.entered.btnClass && fsCheck.entered.rootClass && fsCheck.entered.label === 'Exit fullscreen' &&
    !fsCheck.exited.btnClass && !fsCheck.exited.rootClass && fsCheck.exited.label === 'Enter fullscreen' &&
    fsCheck.exited.declined === true && fsCheck.exited.preservedH && fsCheck.exited.preservedScore &&
    !errors.length;

  if (!fsOk) failed = true;
  console.log(`tv-fullscreen ${fsOk ? 'ok ' : 'BAD'} enter [btn:${fsCheck.entered.btnClass}, root:${fsCheck.entered.rootClass}, "${fsCheck.entered.label}"] ` +
    `· exit [btn:${fsCheck.exited.btnClass}, root:${fsCheck.exited.rootClass}, "${fsCheck.exited.label}", declined:${fsCheck.exited.declined}]` +
    (errors.length ? ` errors ${errors.join(' | ')}` : ''));
  await context.close();
}

await browser.close();
server.close();
console.log(failed ? 'TV probe FAILED' : 'TV probe passed: full matrix ok, same composition, safe area respected, resize & fullscreen verified');
process.exitCode = failed ? 1 : 0;

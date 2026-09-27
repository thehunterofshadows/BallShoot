/* Renders TV mode at 1080p, 4K and two off-16:9 screens, and checks that the composition
   is the same logical picture everywhere with every critical box inside the safe area; then
   repeats at 4K with a calibrated Screen Fit and opens the Screen Fit screen.
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
  { name:'tv-1080p', width:1920, height:1080 },
  { name:'tv-4k',    width:3840, height:2160 },
  { name:'tv-21x9',  width:3440, height:1440 },
  { name:'tv-4x3',   width:1600, height:1200 },
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

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode: 'tv' })));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${vp.name}-home.png`) });
  // Two humans on one field: the couch co-op layout.
  await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles');
    g.settings.players = 2; g.settings.human = [true, true, false, false]; g.resetGame();
  });
  const game = page.locator('coop-bubbles');
  await game.locator('.localPlay').click();
  await game.locator('.start').click();
  await page.waitForTimeout(900);
  const probe = await page.evaluate(() => {
    const g = document.querySelector('coop-bubbles'), sh = g.shadowRoot;
    const col = sh.querySelector('.gameCol').getBoundingClientRect();
    const s = col.width / 1920;
    const rel = el => { const r = el.getBoundingClientRect();
      return { x: Math.round((r.left - col.left) / s), y: Math.round((r.top - col.top) / s), w: Math.round(r.width / s), h: Math.round(r.height / s) }; };
    return {
      tv: sh.querySelector('.root').classList.contains('tvMode'), layout: g.tvLay?.key, scale: s,
      stage: { x: Math.round(col.left), y: Math.round(col.top), w: Math.round(col.width), h: Math.round(col.height) },
      playfield: rel(sh.querySelector('canvas')),
      critical: ['.tvScore', '.tvRound', '.tvPower', '.fullscreenButton', '.gear', '.tvCard']
        .flatMap(q => [...sh.querySelectorAll(q)]).map(el => ({ q: el.className, ...rel(el) })),
    };
  });
  await page.screenshot({ path: join(outDir, `${vp.name}-play.png`) });
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, `${vp.name}-pause.png`) });
  const outside = probe.critical.filter(r => r.x < 96 || r.y < 54 || r.x + r.w > 1824 || r.y + r.h > 1026);
  const ok = probe.tv && probe.layout === 'coop2' && !outside.length && !errors.length;
  if (!ok) failed = true;
  shots.push({ name: vp.name, probe });
  console.log(`${vp.name.padEnd(9)} ${ok ? 'ok ' : 'BAD'} stage ${probe.stage.w}x${probe.stage.h}@${probe.stage.x},${probe.stage.y} ` +
    `x${probe.scale.toFixed(3)} field ${JSON.stringify(probe.playfield)}` +
    (outside.length ? ` outside-safe ${JSON.stringify(outside)}` : '') + (errors.length ? ` errors ${errors.join(' | ')}` : ''));
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

/* Issue #7: a calibrated Screen Fit moves every critical box, the Screen Fit screen and the
   controller legend render, focus starts on each screen's default, and no critical HUD text
   is smaller than TV.minHudFontPx (28 logical px). */
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
  await game.locator('.localPlay').click();
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
  console.log(`tv-fit    ${ok ? 'ok ' : 'BAD'} home focus ${home.focus} · prompts "${home.text}" · screen fit focus ${sf.focus} frame ${JSON.stringify(sf.frame)}` +
    ` · field aspect ${play.aspect.toFixed(4)} (world ${play.world.toFixed(4)}) · min HUD font ${Math.min(...play.fonts.map(f => f.px))}px · fit prompts "${sf.text}"` +
    (outside.length ? ` outside-fit ${JSON.stringify(outside)}` : '') + (small.length ? ` small ${JSON.stringify(small)}` : '') + (errors.length ? ` errors ${errors.join(' | ')}` : ''));
  await context.close();
}
await browser.close();
server.close();
console.log(failed ? 'TV probe FAILED' : 'TV probe passed: same composition, safe area respected, no page errors');
process.exitCode = failed ? 1 : 0;

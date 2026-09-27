/* Renders TV mode at 1080p, 4K and two off-16:9 screens, and checks that the composition
   is the same logical picture everywhere with every critical box inside the safe area.
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
await browser.close();
server.close();
console.log(failed ? 'TV probe FAILED' : 'TV probe passed: same composition, safe area respected, no page errors');
process.exitCode = failed ? 1 : 0;

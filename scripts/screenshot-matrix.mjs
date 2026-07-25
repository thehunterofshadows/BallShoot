/* Renders the game across the device shapes that broke the old fixed 640x1080 layout and
   writes one PNG per case, so an off-aspect regression is visible rather than inferred.
   Run: docker compose run --rm --no-deps screens */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'screenshots');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.webp':'image/webp', '.json':'application/json' };

/* Widths and heights are CSS px as the device actually reports them. The foldables are the
   point of the exercise: a Fold cover panel is far taller than 640x1080, an unfolded Fold
   is nearly square, and a Flip cover panel is both tiny and short. */
const VIEWPORTS = [
  { name:'iphone-se',            width:320,  height:568 },
  { name:'fold6-cover',          width:344,  height:882 },
  { name:'fold7-cover',          width:412,  height:960 },
  { name:'flip-cover',           width:360,  height:374 },
  { name:'iphone-16-pro-max',    width:440,  height:956 },
  { name:'fold7-inner-portrait', width:984,  height:1092 },
  { name:'fold7-inner-landscape',width:1092, height:984 },
  { name:'phone-landscape',      width:882,  height:344 },
  { name:'desktop',              width:1440, height:900 },
];

const server = createServer(async (req, res) => {
  /* index.html ships with __GAME_VERSION__ cache-busting placeholders in its query strings,
     which resolve fine unsubstituted, so a plain static serve is enough. */
  const path = (req.url || '/').split('?')[0];
  // Resolve first, then type: '/' has no extension, and serving the shell as
  // application/octet-stream makes Chromium download it instead of rendering it.
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
// The Playwright image runs as root, where Chromium's sandbox cannot initialise.
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const report = [];

for (const vp of VIEWPORTS) {
  // Two passes: the coarse-pointer branch swaps in the overlay aim zones, and that branch
  // only ever runs on the devices this matrix exists to check.
  for (const touch of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: touch, isMobile: touch, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const game = document.querySelector('x-dc')?.querySelector?.('coop-bubbles')
        || document.querySelector('coop-bubbles');
      return game?.shadowRoot?.querySelector('canvas')?.width > 0;
    }, null, { timeout: 15000 });
    await page.waitForTimeout(400); // let the first relayout settle

    /* Step through home -> tutorial -> play. The point of the matrix is the field, the
       HUD and the launcher at each shape, not the home card. */
    const game = page.locator('coop-bubbles');
    await game.locator('.localPlay').click();
    await game.locator('.start').click();
    await page.waitForTimeout(900); // a few frames of real play

    const probe = await page.evaluate(() => {
      const game = document.querySelector('coop-bubbles')
        || document.querySelector('x-dc').querySelector('coop-bubbles');
      const sh = game.shadowRoot, col = sh.querySelector('.gameCol'), root = sh.querySelector('.root');
      const box = col.getBoundingClientRect();
      return {
        viewH: game.H, launchY: game.LAUNCH_Y, dangerY: game.DANGER_Y,
        boardW: Math.round(box.width), boardH: Math.round(box.height),
        wideLayout: root.classList.contains('wideLayout'),
        sidePanel: getComputedStyle(sh.querySelector('.side')).display !== 'none',
        pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });

    const label = `${vp.name}${touch ? '-touch' : ''}`;
    await page.screenshot({ path: join(outDir, `${label}.png`) });
    const fillW = probe.boardW / vp.width, fillH = probe.boardH / vp.height;
    report.push({ label, viewport: `${vp.width}x${vp.height}`, ...probe,
      fill: `${Math.round(Math.min(fillW, fillH) * 100)}% of the limiting axis` });
    console.log(`${label.padEnd(28)} board ${probe.boardW}x${probe.boardH}  world 640x${probe.viewH}` +
      `  ${Math.round(fillW * 100)}%w ${Math.round(fillH * 100)}%h` +
      `${probe.wideLayout ? '  wideLayout' : ''}${probe.sidePanel ? '  side' : ''}` +
      `${probe.pageScrollsX ? '  !! H-SCROLL' : ''}`);
    await context.close();
  }
}

await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
const scrollers = report.filter(r => r.pageScrollsX);
console.log(`\n${report.length} shots in ${outDir}`);
if (scrollers.length) {
  console.error(`horizontal overflow on: ${scrollers.map(r => r.label).join(', ')}`);
  process.exitCode = 1;
}

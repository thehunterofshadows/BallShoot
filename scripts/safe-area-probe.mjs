/* Check the default viewport background and bounded content inset, including live resize.
   Run: docker compose run --rm --no-deps screens node scripts/safe-area-probe.mjs */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const close = async () => { await browser.close(); server.close(); };

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0);
  for (const [w, h] of [[1920, 1080], [1920, 1200], [3440, 1440], [3840, 2160], [1600, 1200]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(100);
    const p = await page.evaluate(() => {
      const game = document.querySelector('coop-bubbles'), sh = game.shadowRoot;
      const root = sh.querySelector('.root'), css = getComputedStyle(root);
      const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
      return { tv: root.classList.contains('tvMode'), root: box(root), field: box(sh.querySelector('canvas')),
        pad: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft].map(parseFloat),
        background: css.backgroundImage, size: css.backgroundSize };
    });
    const x = Math.min(80, Math.max(24, w * .05)), y = Math.min(80, Math.max(24, h * .05));
    const near = (a, b) => Math.abs(a - b) < 1.1;
    const ok = !p.tv && near(p.root.x, 0) && near(p.root.y, 0) && near(p.root.right, w) && near(p.root.bottom, h)
      && p.pad.every((v, i) => near(v, i % 2 ? x : y))
      && p.field.x >= x - 1 && p.field.right <= w - x + 1
      && p.field.y >= y - 1 && p.field.bottom <= h - y + 1
      && p.background.includes('fantasy-night.webp') && p.size.split(',').some(s => s.trim() === 'cover');
    console.log(`default ${w}x${h}: ${ok ? 'ok' : 'BAD'} inset ${p.pad.join('/')} background ${p.size}`);
    if (!ok) throw new Error(`Default layout failed at ${w}x${h}: ${JSON.stringify(p)}`);
  }

  // The existing TV-fit path remains an explicit alternate with its own calibrated stage.
  await page.evaluate(() => document.querySelector('coop-bubbles').setDisplayMode('tv'));
  await page.waitForTimeout(100);
  const tv = await page.evaluate(() => {
    const sh = document.querySelector('coop-bubbles').shadowRoot;
    const root = sh.querySelector('.root'), stage = sh.querySelector('.gameCol').getBoundingClientRect();
    return { active: root.classList.contains('tvMode'), rootPadding: getComputedStyle(root).padding,
      stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
      background: getComputedStyle(root).backgroundImage };
  });
  if (!tv.active || tv.rootPadding !== '0px' || Math.abs(tv.stage.w / tv.stage.h - 16 / 9) > .001
      || !tv.background.includes('fantasy-night.webp')) throw new Error(`TV override failed: ${JSON.stringify(tv)}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log('TV-fit override: ok');
} finally { await close(); }

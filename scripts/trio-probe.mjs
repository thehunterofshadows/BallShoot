/* Browser smoke check for issue #9's two- and three-player TV layouts.
   Run: docker compose run --rm --no-deps screens node scripts/trio-probe.mjs */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html':'text/html', '.js':'text/javascript', '.webp':'image/webp' };
const server = createServer(async (req, res) => {
  const name = (req.url || '/').split('?')[0].slice(1) || 'index.html';
  try { const body = await readFile(join(root, name)); res.writeHead(200, { 'content-type':types[extname(name)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ args:['--no-sandbox'] });
try {
  for (const n of [2,3]) {
    const context = await browser.newContext({ viewport:{ width:1920, height:1080 } });
    await context.addInitScript(() => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode:'tv' })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil:'load' });
    await page.waitForFunction(() => document.querySelector('coop-bubbles')?.settings?.players);
    await page.evaluate(count => {
      const g = document.querySelector('coop-bubbles');
      g.settings.players = count; g.settings.human = [true,true,count === 3,false]; g.resetGame();
    }, n);
    await page.locator('coop-bubbles').locator('.localPlay').click();
    await page.locator('coop-bubbles').locator('.start').click();
    await page.waitForTimeout(300);
    if (n === 3) { await mkdir(join(root, 'screenshots'), { recursive:true });
      await page.screenshot({ path:join(root, 'screenshots', 'trio-play.png') }); }
    const state = await page.evaluate(() => {
      const g = document.querySelector('coop-bubbles');
      return { layout:g.tvLay?.key, cards:g.tvCards?.length, positions:g.players.map(p => p.x), WW:g.WW,
        leftPass:g.passLeftBtn?.classList.contains('on'), rightPass:g.passBtn?.classList.contains('on'),
        power:g.powerBtn?.classList.contains('on'), score:g.shadowRoot.querySelector('.tvScoreVal')?.textContent };
    });
    const expected = n === 2 ? 'coop2' : 'coop3';
    if (errors.length || state.layout !== expected || state.cards !== (n === 2 ? 2 : 0) || !state.rightPass || !state.power || state.leftPass !== (n === 3)
      || state.positions.some((x, i) => Math.abs(x - state.WW * (i + 0.5) / n) > 0.01))
      throw new Error(`${n} players: ${JSON.stringify({ state, errors })}`);
    console.log(`${n} players: ${expected}, ${n} launchers, pass/power controls and shared TV HUD ok`);
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

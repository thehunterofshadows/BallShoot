/* Browser check for issue #13: local two-player Co-op Clear on the 16/15 board. For each
   display shape it asserts the whole board is on screen, uniformly scaled, and that the
   camera never moves while both players aim and fire; then it toggles the window size to
   prove a re-fit leaves the game alone. Writes screenshots/coop2-<name>.png.
   Run: docker compose run --rm --no-deps screens node scripts/coop2-probe.mjs */
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
await mkdir(join(root, 'screenshots'), { recursive:true });
const browser = await chromium.launch({ args:['--no-sandbox'] });
const SHAPES = [
  { name:'1080p-tv',     width:1920, height:1080, dsf:1, display:'tv' },
  { name:'4k-tv',        width:1920, height:1080, dsf:2, display:'tv' },
  { name:'16x10-tv',     width:1920, height:1200, dsf:1, display:'tv' },
  { name:'ultrawide-tv', width:2560, height:1080, dsf:1, display:'tv' },
  { name:'1080p-desktop',width:1920, height:1080, dsf:1, display:'desktop' },
  { name:'window',       width:1280, height:800,  dsf:1, display:'desktop' },
];
const failures = [];
try {
  for (const s of SHAPES) {
    const context = await browser.newContext({ viewport:{ width:s.width, height:s.height }, deviceScaleFactor:s.dsf });
    await context.addInitScript(d => localStorage.setItem('bt_prefs', JSON.stringify({ displayMode:d })), s.display);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil:'load' });
    await page.waitForFunction(() => document.querySelector('coop-bubbles')?.settings?.players);
    await page.evaluate(() => { const g = document.querySelector('coop-bubbles');
      g.settings.players = 2; g.settings.human = [true, true, false, false]; g.settings.mode = 'clear'; g.settings.level = 1; g.resetGame(); });
    await page.locator('coop-bubbles').locator('.localPlay').click(); await page.evaluate(() => { const g = document.querySelector('coop-bubbles'); if (g._padPickActive) g.finishPadPick(true); if (g._profilePickActive) { g._pp.panels.forEach(p => { p.choice = { type: 'guest' }; p.view = 'ready'; }); g.ppStart(); } }); // Player Select (#18): everyone as Guest
    await page.locator('coop-bubbles').locator('.start').click();
    await page.waitForTimeout(400);
    const box = () => page.evaluate(() => { const g = document.querySelector('coop-bubbles'), r = g.canvas.getBoundingClientRect();
      return { x:r.x, y:r.y, w:r.width, h:r.height, VW:g.VW, H:g.H, WW:g.WW, cols:g.cols, camX:g.camX, grid:g.grid.size, score:g.score, state:g.state }; });
    const a = await box();
    // Aim both launchers hard into the corners and fire a few times; sample the camera.
    const cams = await page.evaluate(async () => { const g = document.querySelector('coop-bubbles'), seen = new Set();
      for (let k = 0; k < 6; k++) { g.players.forEach((p, i) => { p.angle = (i ? -1 : 1) * (0.4 + k * 0.13); p.reload = 0; g.fire(i); });
        for (let f = 0; f < 20; f++) { await new Promise(r => requestAnimationFrame(r)); seen.add(g.camX); } }
      return [...seen]; });
    await page.screenshot({ path:join(root, 'screenshots', `coop2-${s.name}.png`) });
    // A display change re-fits the static composition without resetting play.
    const before = await box();
    await page.setViewportSize({ width:Math.round(s.width * 0.8), height:Math.round(s.height * 0.8) });
    await page.waitForTimeout(300);
    const after = await box();
    await page.setViewportSize({ width:s.width, height:s.height });
    await page.waitForTimeout(300);
    const back = await box();
    const fits = r => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= s.width + 0.5 && r.y + r.h <= s.height + 0.5;
    const uniform = r => Math.abs(r.w / r.h - r.VW / r.H) < 0.01;
    const problems = [];
    if (errors.length) problems.push('errors ' + errors.join('; '));
    if (a.cols !== 16 || a.VW !== a.WW || a.VW !== 920) problems.push(`board ${a.cols} cols, VW ${a.VW}, WW ${a.WW}`);
    if (s.display === 'desktop' && !fits(a)) problems.push('board clipped ' + JSON.stringify(a));
    if (!uniform(a) || !uniform(back)) problems.push('stretched ' + JSON.stringify(a));
    if (cams.some(c => c !== 0)) problems.push('camera moved ' + cams);
    if (after.grid !== before.grid && after.score === before.score && after.state !== before.state) problems.push('resize reset play');
    if (Math.abs(back.w - a.w) > 1) problems.push('re-fit did not return');
    console.log(`${s.name.padEnd(14)} ${s.width}x${s.height}@${s.dsf} board ${a.w.toFixed(0)}x${a.h.toFixed(0)} at ${a.x.toFixed(0)},${a.y.toFixed(0)} · bubble ${(56 * a.w / a.VW * s.dsf).toFixed(0)}px · camera ${cams.join(',')} ${problems.length ? 'FAIL ' + problems.join(' | ') : 'ok'}`);
    if (problems.length) failures.push(s.name);
    await context.close();
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
if (failures.length) { console.error('failed: ' + failures.join(', ')); process.exit(1); }

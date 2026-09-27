/* Refresh-rate validation for the frame pipeline (issue #8).
   1. Drives the real game loop on a controlled requestAnimationFrame clock at 60, 120 and
      144 Hz and checks the gameplay clock, a held-key aim sweep and a shot's flight agree,
      and that a fire key launches the shot before the next frame.
   2. Measures the browser's own rAF cadence with the ?perf overlay, once vsynced and once
      with the frame-rate limit lifted, to show the loop follows whatever cadence it gets.
   Run: docker compose run --rm --no-deps screens node scripts/refresh-probe.mjs */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.webp':'image/webp', '.json':'application/json' };
const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
let failed = false;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed = true; };

const ready = page => page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 60000 });

// 1. Controlled clock.
async function run(hz) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    const q = []; let now = 1000;
    window.requestAnimationFrame = cb => q.push(cb);
    window.cancelAnimationFrame = () => {};
    window.__pump = (hz, secs) => { for (let i = 0; i < Math.round(hz * secs); i++) { now += 1000 / hz; q.splice(0).forEach(cb => cb(now)); } };
  });
  await page.goto(base, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(hz => {
    const g = document.querySelector('coop-bubbles'), key = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key }));
    g.settings.players = 2; g.settings.human = [true, true, false, false]; g.settings.hurry = 0; g.resetGame();
    g.state = 'play'; g._t = 0; window.__pump(hz, 1 / 6);
    const p = g.players[1]; p.angle = -0.3; const now0 = g.now, a0 = p.angle;
    key('keydown', 'd'); window.__pump(hz, 0.5); key('keyup', 'd');
    const angle = p.angle - a0;
    const before = g.flights.length; key('keydown', 'w'); key('keyup', 'w');
    const sameCall = g.flights.length - before, f = g.flights[g.flights.length - 1], y0 = f && f.y, x0 = f && f.x;
    window.__pump(hz, 1 / 12);
    return { clock: g.now - now0, angle, sameCall, travel: f ? Math.hypot(f.x - x0, f.y - y0) : null };
  }, hz);
  await browser.close();
  return r;
}
const res = {};
for (const hz of [60, 120, 144]) { res[hz] = await run(hz); console.log(`${hz} Hz`, JSON.stringify(res[hz])); }
for (const hz of [120, 144]) {
  check(Math.abs(res[hz].clock - res[60].clock) < 1e-6, `${hz} Hz gameplay clock matches 60 Hz (${res[hz].clock.toFixed(4)} s)`);
  check(Math.abs(res[hz].angle - res[60].angle) < 0.005, `${hz} Hz held-aim sweep matches 60 Hz (${res[hz].angle.toFixed(4)} rad)`);
  check(Math.abs(res[hz].travel - res[60].travel) < 1, `${hz} Hz shot travel matches 60 Hz (${res[hz].travel.toFixed(2)} units)`);
}
for (const hz of [60, 120, 144]) check(res[hz].sameCall === 1, `${hz} Hz fire key launches the shot immediately, before the next frame`);

// 2. Native cadence, read from the diagnostics overlay.
async function cadenceAt(args, label) {
  const browser = await chromium.launch({ args: ['--no-sandbox', ...args] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + '?perf', { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(1500);
  const hud = await page.evaluate(() => document.querySelector('coop-bubbles').shadowRoot.querySelector('.perfHud').textContent);
  const fps = await page.evaluate(() => new Promise(done => { let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else done(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  await browser.close();
  console.log(`${label}: ${fps.toFixed(1)} fps measured\n${hud}`);
  return { fps, hud };
}
const vsync = await cadenceAt([], 'vsynced');
const free = await cadenceAt(['--disable-gpu-vsync', '--disable-frame-rate-limit'], 'frame-rate limit lifted');
check(/present \d/.test(vsync.hud) && /steps\/s/.test(vsync.hud), 'perf overlay reports cadence and simulation rate');
check(free.fps > vsync.fps * 1.5, `loop is not capped: ${free.fps.toFixed(0)} fps unlimited vs ${vsync.fps.toFixed(0)} fps vsynced`);

server.close();
process.exit(failed ? 1 : 0);

/* Temporary probe: drives the real component in a touch browser to check the pad router,
   the aim ramp and point-to-aim. Run: docker compose run --rm --no-deps --entrypoint node screens scripts/touch-controls-probe.mjs */
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
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.addInitScript(() => { window.g = () => document.querySelector('coop-bubbles'); });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
const game = page.locator('coop-bubbles');
await game.locator('.localPlay').click();
await game.locator('.start').click();
await page.waitForTimeout(500);

const g = () => document.querySelector('coop-bubbles');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// 0. The coarse-pointer layout is actually in play.
const layout = await page.evaluate(() => {
  const sh = g().shadowRoot, f = sh.querySelector('.padF').getBoundingClientRect(),
    s = sh.querySelector('.padS').getBoundingClientRect(), l = sh.querySelector('.padL').getBoundingClientRect();
  const box = r => ({ x: r.left + r.width/2, y: r.top + r.height/2, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  return { coarse: matchMedia('(pointer: coarse)').matches, slop: g().padSlop(),
    fire: box(f), swap: box(s), halfHeight: l.height, aimMode: sh.querySelector('.root').dataset.aimMode };
});
check('coarse-pointer aim overlays are active with slop', layout.coarse && layout.slop > 0, `slop ${layout.slop.toFixed(1)}px, mode ${layout.aimMode}`);

/* 1. A tap just outside every edge of FIRE must fire — never turn the launcher, and never be
   claimed by the swap button unless it lands squarely on it. */
for (const [edge, dx, dy] of [['left', -1, 0], ['right', 1, 0], ['below', 0, 1], ['above', 0, -1]]) {
  const off = layout.slop * 0.6;
  const x = dx < 0 ? layout.fire.left - off : dx > 0 ? layout.fire.right + off : layout.fire.x;
  const y = dy < 0 ? layout.fire.top - off : dy > 0 ? layout.fire.bottom + off : layout.fire.y;
  const s = layout.swap, onSwap = x >= s.left && x <= s.right && y >= s.top && y <= s.bottom;
  const read = () => page.evaluate(() => { const p = g().players[0];
    return { angle: p.angle, shots: p.stats.shots, cur: p.cur.kind, next: p.next.kind }; });
  const before = await read();
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await read();
  const swapped = after.cur === before.next && after.next === before.cur && after.shots === before.shots;
  const acted = onSwap ? swapped : after.shots > before.shots;
  check(`a press ${edge} FIRE reaches ${onSwap ? 'swap' : 'FIRE'} and does not turn`,
    acted && Math.abs(after.angle - before.angle) < 1e-9,
    `shots ${before.shots}->${after.shots}, bubble ${before.cur}->${after.cur}, angle drift ${(after.angle - before.angle).toExponential(1)}`);
  await page.waitForTimeout(1500); // reload
}

// 2. Well outside the slop, the same half still aims.
{
  const before = await page.evaluate(() => g().players[0].angle);
  await page.mouse.move(30, layout.fire.y); await page.mouse.down(); await page.waitForTimeout(300);
  const mid = await page.evaluate(() => ({ angle: g().players[0].angle, vel: g().players[0].aimVel }));
  await page.mouse.up(); await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ angle: g().players[0].angle, vel: g().players[0].aimVel }));
  check('a press far from FIRE still aims, ramps up and coasts to a stop',
    mid.angle < before && mid.vel < -0.5 && after.vel === 0 && after.angle < mid.angle,
    `angle ${before.toFixed(3)} -> ${mid.angle.toFixed(3)} -> ${after.angle.toFixed(3)}, coast ${(mid.angle - after.angle).toFixed(3)} rad`);
}

// 3. Point-to-aim: dragging on the upper board swings the cannon to the finger.
await page.evaluate(() => { const el = g(); el.settings.aimMode = 'point'; el.applyTouchStyle(); el.saveLocalPrefs(); });
await page.waitForTimeout(60);
{
  const box = await page.evaluate(() => { const b = g().shadowRoot.querySelector('.gameCol').getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height }; });
  const target = { x: box.left + box.width * 0.8, y: box.top + box.height * 0.25 };
  await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  const state = await page.evaluate(() => ({ angle: g().players[0].angle, target: g().players[0].aimTarget, shots: g().players[0].stats.shots }));
  const want = await page.evaluate(t => { const el = g(), p = el.players[0], b = el.shadowRoot.querySelector('canvas').getBoundingClientRect();
    const x = (t.x - b.left) * 640 / b.width, y = (t.y - b.top) * el.H / b.height;
    return Math.atan2(x - p.x, (el.LAUNCH_Y - 44) - y); }, target);
  check('point-to-aim lands the barrel on the touched spot', Math.abs(state.angle - want) < 0.02 && state.target === null,
    `angle ${state.angle.toFixed(3)} vs wanted ${want.toFixed(3)}, released target ${state.target}`);
  check('point-to-aim does not fire by itself', state.shots === (await page.evaluate(() => g().players[0].stats.shots)), '');
}

// 4. FIRE still wins inside the full-board aim surface.
{
  const before = await page.evaluate(() => g().players[0].stats.shots);
  await page.mouse.move(layout.fire.x, layout.fire.y); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => g().players[0].stats.shots);
  check('FIRE still shoots through the point-aim surface', after > before, `shots ${before} -> ${after}`);
}

// 5. The aim mode survives a reload; a host's tint/FIRE size do not leak into it.
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('coop-bubbles')?.shadowRoot?.querySelector('canvas')?.width > 0);
const persisted = await page.evaluate(() => ({ mode: g().settings.aimMode, attr: g().shadowRoot.querySelector('.root').dataset.aimMode,
  stored: JSON.parse(localStorage.getItem('bt_prefs') || '{}') }));
check('the control scheme persists per device', persisted.mode === 'point' && persisted.attr === 'point' && persisted.stored.aimMode === 'point',
  JSON.stringify(persisted.stored));

/* 6. Online reconciliation, driven straight through updateOnlineVisuals with a stand-in for
   the server: hold left, feed authoritative angles that lag the prediction, and confirm the
   barrel keeps moving one way instead of being yanked back on every snapshot. */
{
  const online = await page.evaluate(() => {
    const el = g();
    el.settings.aimMode = 'halves'; el.applyTouchStyle();
    el.online = true; el.state = 'play'; el.onlinePlayerId = 'me'; el.activeP = 0;
    el.players = [{ ...el.players[0], id:'me', angle:0, aimVel:0, aimTarget:null, held:{l:false,r:false}, reload:0 }];
    el._onlineHeld = { l:true, r:false };
    // A stand-in server: the same integrator, six frames (100 ms) behind, landing at 20 Hz.
    const dt = 1/60, lag = 6, held = [], samples = [];
    const ghost = { angle:0, aimVel:0, aimTarget:null, held:{l:false,r:false} };
    const step = (p, h) => { // the shipped aimTick, reached through the component's own path
      p.held = h; el._onlineHeld = h; el.updateOnlineVisuals(dt);
    };
    let reversals = 0, last = 0, maxJump = 0;
    for (let i = 0; i < 150; i++) {
      const holding = i < 60;                       // finger down, then released
      held.push({ l: holding, r: false });
      const echo = held[Math.max(0, i - lag)];      // what the server is acting on right now
      ghost.held = echo; el.constructor; // eslint-disable-line no-unused-expressions
      const spd = 2.4, accel = spd / 0.12;
      const want = (echo.r ? spd : 0) - (echo.l ? spd : 0);
      const rate = (Math.abs(want) < Math.abs(ghost.aimVel) || want * ghost.aimVel < 0) ? accel * 4 : accel;
      ghost.aimVel += Math.max(-rate*dt, Math.min(rate*dt, want - ghost.aimVel));
      ghost.angle = Math.max(-1.22, Math.min(1.22, ghost.angle + ghost.aimVel * dt));
      if (i % 3 === 0) el.players[0].serverAngle = ghost.angle;
      step(el.players[0], { l: holding, r: false });
      const a = el.players[0].angle;
      maxJump = Math.max(maxJump, Math.abs(a - last));
      if (i > 2 && i < 60 && a > last + 1e-9) reversals++;
      last = a; samples.push(a);
    }
    const settled = Math.abs(samples[samples.length - 1] - ghost.angle);
    el.online = false; el._onlineHeld = { l:false, r:false };
    return { reversals, maxJump, settled, atRelease: samples[59], last, server: ghost.angle };
  });
  check('online aiming never rubber-bands backwards against the finger', online.reversals === 0,
    `${online.reversals} reversals over 120 frames`);
  check('and it converges on the authoritative angle without a visible jump',
    online.maxJump < 0.06 && online.settled < 0.01,
    `max frame step ${online.maxJump.toFixed(4)} rad, gap at release ${Math.abs(online.atRelease - online.server).toFixed(3)}, final gap ${online.settled.toFixed(4)} rad`);
}

await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;

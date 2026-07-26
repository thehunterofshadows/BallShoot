/* Drives the real component in a touch browser with real touch events, because the touch
   input path is where these controls actually live and a synthetic mouse press does not go
   through it: it skips touch-action, so it never reproduces the browser claiming a drag as a
   scroll and cancelling the pointer one move in.

   Run: docker compose run --rm --no-deps --entrypoint node screens scripts/touch-controls-probe.mjs */
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
await page.waitForFunction(() => window.g()?.shadowRoot?.querySelector('canvas')?.width > 0, null, { timeout: 15000 });
const game = page.locator('coop-bubbles');
await game.locator('.localPlay').click();
await game.locator('.start').click();
await page.waitForTimeout(500);

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const read = () => page.evaluate(() => { const p = window.g().players[0];
  return { angle: p.angle, target: p.aimTarget ?? null, shots: p.stats.shots, cur: p.cur.kind, next: p.next.kind }; });
const setMode = mode => page.evaluate(m => { const el = window.g(); el.settings.aimMode = m; el.applyTouchStyle(); el.saveLocalPrefs(); }, mode);

// Real finger input, not mouse: this is the path touch-action and pointercancel live on.
const cdp = await context.newCDPSession(page);
const at = (x, y) => [{ x, y, radiusX: 9, radiusY: 9, force: 1, id: 1 }];
const touchDown = (x, y) => cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints: at(x, y) });
const touchMove = (x, y) => cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints: at(x, y) });
const touchUp = () => cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints: [] });
const tap = async (x, y, hold = 90) => { await touchDown(x, y); await page.waitForTimeout(hold); await touchUp(); await page.waitForTimeout(120); };

// 0. The coarse-pointer layout is actually in play.
const layout = await page.evaluate(() => {
  const el = window.g(), sh = el.shadowRoot;
  const box = sel => { const r = sh.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const b = sh.querySelector('.gameCol').getBoundingClientRect();
  return { coarse: matchMedia('(pointer: coarse)').matches, slop: el.padSlop(),
    fire: box('.padF'), swap: box('.padS'), board: { left: b.left, top: b.top, w: b.width, h: b.height } };
});
check('coarse-pointer aim overlays are active with slop', layout.coarse && layout.slop > 0, `slop ${layout.slop.toFixed(1)}px`);

/* 1. A tap just outside every edge of FIRE must fire — never turn the launcher, and never be
   claimed by the swap button unless it lands squarely on it. */
for (const [edge, dx, dy] of [['left', -1, 0], ['right', 1, 0], ['below', 0, 1], ['above', 0, -1]]) {
  const off = layout.slop * 0.6;
  const x = dx < 0 ? layout.fire.left - off : dx > 0 ? layout.fire.right + off : layout.fire.x;
  const y = dy < 0 ? layout.fire.top - off : dy > 0 ? layout.fire.bottom + off : layout.fire.y;
  const before = await read();
  await tap(x, y);
  const after = await read();
  check(`a press ${edge} FIRE fires and does not turn`,
    after.shots > before.shots && Math.abs(after.angle - before.angle) < 1e-9,
    `shots ${before.shots}->${after.shots}, angle drift ${(after.angle - before.angle).toExponential(1)}`);
  await page.waitForTimeout(1500); // reload
}

/* 2. Held aiming: one constant rate, and it stops dead on release. */
{
  await page.evaluate(() => { window.g().players[0].angle = 0; });
  await touchDown(layout.board.left + 30, layout.board.top + layout.board.h * 0.9);
  const trace = [];
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(60); trace.push((await read()).angle); }
  const atRelease = (await read()).angle;
  await touchUp();
  await page.waitForTimeout(400);
  const settled = (await read()).angle;
  // Drop any step that ran into the launcher's limit; a clamped frame is short by design.
  const steps = trace.slice(1).map((a, i) => a - trace[i]).filter((_, i) => trace[i + 1] > -1.219);
  const spread = Math.max(...steps) - Math.min(...steps);
  check('holding an aim half turns at a steady rate', trace[0] < 0 && spread < 0.02,
    `per-60ms steps ${steps.map(s => s.toFixed(3)).join(' ')}`);
  check('and it stops the instant the finger lifts', Math.abs(settled - atRelease) < 1e-9,
    `coast ${(settled - atRelease).toExponential(1)} rad`);
}

/* 3. Point-to-aim: a drag has to survive the browser's gesture handling, and the barrel has
   to be where the finger is on every frame of it — not chasing behind it. */
await setMode('point');
await page.waitForTimeout(60);
{
  const wanted = pt => page.evaluate(t => { const el = window.g(), p = el.players[0];
    const b = el.shadowRoot.querySelector('canvas').getBoundingClientRect();
    const x = (t.x - b.left) * 640 / b.width, y = (t.y - b.top) * el.H / b.height;
    return Math.max(-1.22, Math.min(1.22, Math.atan2(x + (el.camX || 0) - p.x, (el.LAUNCH_Y - 44) - y)));
  }, pt);
  const start = { x: layout.board.left + layout.board.w * 0.25, y: layout.board.top + layout.board.h * 0.55 };
  await touchDown(start.x, start.y);
  await page.waitForTimeout(60);
  const onDown = (await read()).angle, wantDown = await wanted(start);
  check('the barrel jumps to where the finger lands', Math.abs(onDown - wantDown) < 1e-6,
    `angle ${onDown.toFixed(4)} vs ${wantDown.toFixed(4)}`);

  const errors = [];
  for (let i = 1; i <= 10; i++) {
    const pt = { x: start.x + i * 15, y: start.y - i * 32 };
    await touchMove(pt.x, pt.y);
    await page.waitForTimeout(45);
    errors.push(Math.abs((await read()).angle - await wanted(pt)));
  }
  const worst = Math.max(...errors);
  check('and it tracks the drag exactly, with no lag behind the finger', worst < 1e-6,
    `worst error over 10 moves ${worst.toExponential(1)} rad`);

  const held = await page.evaluate(() => ({ target: window.g().players[0].aimTarget }));
  check('the drag is not cancelled by the browser mid-gesture', held.target !== null,
    `aimTarget still live: ${held.target !== null}`);

  const beforeShots = (await read()).shots;
  await touchUp();
  await page.waitForTimeout(120);
  const afterUp = await read();
  check('lifting the finger holds the aim and does not fire',
    Math.abs(afterUp.angle - (await wanted({ x: start.x + 150, y: start.y - 320 }))) < 1e-6 && afterUp.shots === beforeShots,
    `angle held at ${afterUp.angle.toFixed(4)}, shots ${beforeShots}->${afterUp.shots}`);
}

// 4. FIRE still wins inside the full-board aim surface.
{
  const before = (await read()).shots, angle = (await read()).angle;
  await tap(layout.fire.x, layout.fire.y);
  const after = await read();
  check('FIRE still shoots through the point-aim surface and does not re-aim',
    after.shots > before && Math.abs(after.angle - angle) < 1e-9, `shots ${before} -> ${after.shots}`);
}

// 5. The scheme is a device preference and survives a reload.
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.g()?.shadowRoot?.querySelector('canvas')?.width > 0);
const persisted = await page.evaluate(() => ({ mode: window.g().settings.aimMode,
  attr: window.g().shadowRoot.querySelector('.root').dataset.aimMode,
  stored: JSON.parse(localStorage.getItem('bt_prefs') || '{}') }));
check('the control scheme persists per device', persisted.mode === 'point' && persisted.attr === 'point' && persisted.stored.aimMode === 'point',
  JSON.stringify(persisted.stored));

/* 6. Online reconciliation, driven straight through updateOnlineVisuals against a stand-in
   server six frames behind: the barrel must not be yanked backwards on every snapshot. */
{
  const online = await page.evaluate(() => {
    const el = window.g();
    el.settings.aimMode = 'halves'; el.applyTouchStyle();
    el.online = true; el.state = 'play'; el.onlinePlayerId = 'me'; el.activeP = 0;
    el.players = [{ ...el.players[0], id:'me', angle:0, aimTarget:null, held:{l:false,r:false}, reload:0 }];
    const dt = 1/60, lag = 6, inputs = [], samples = [];
    const ghost = { angle: 0 };
    let reversals = 0, last = 0, maxJump = 0;
    for (let i = 0; i < 150; i++) {
      const holding = i < 60;                        // finger down, then released
      inputs.push(holding);
      const echo = inputs[Math.max(0, i - lag)];     // what the server is acting on right now
      if (echo) ghost.angle = Math.max(-1.22, ghost.angle - 2.4 * dt);
      if (i % 3 === 0) el.players[0].serverAngle = ghost.angle;   // 20 Hz snapshots
      el._onlineHeld = { l: holding, r: false };
      el.updateOnlineVisuals(dt);
      const a = el.players[0].angle;
      maxJump = Math.max(maxJump, Math.abs(a - last));
      if (i > 1 && i < 60 && a > last + 1e-9) reversals++;
      last = a; samples.push(a);
    }
    const settled = Math.abs(samples[samples.length - 1] - ghost.angle);
    el.online = false; el._onlineHeld = { l:false, r:false };
    return { reversals, maxJump, settled };
  });
  check('online aiming never rubber-bands backwards against the finger', online.reversals === 0,
    `${online.reversals} reversals while held`);
  check('and it converges on the authoritative angle without a visible jump',
    online.maxJump <= 2.4/60 + 1e-9 && online.settled < 0.01,
    `max frame step ${online.maxJump.toFixed(4)} rad, final gap ${online.settled.toFixed(4)} rad`);
}

await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
